// SPDX-License-Identifier: Apache-2.0
//
// store.js — single source of truth (classic script → window.Chippy.store).
//
// Holds the entire in-memory application state and is the only path that mutates
// it. Reads go through selectors; writes go through actions that persist via
// Chippy.io and then emit a change set. Presentation scripts subscribe and
// re-render. Must load AFTER io.js. See ../../documentation/target-architecture.md.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  /* ------------------------------ state -------------------------------- */

  const state = {
    folderReady: false,
    dirHandle: null,
    nav: { discussions: [], theme: 'dark' },
    tags: [],
    names: [],
    members: new Map(),       // name -> member | null (lazy)
    activeMemberName: null,
    activeScreen: 'welcome',
    ui: { filters: {}, search: '', draft: null }
  };

  /* ---------------------------- event emitter -------------------------- */

  const subscribers = new Set();
  function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
  function emit(changeSet) {
    for (const fn of subscribers) {
      try { fn(changeSet); } catch (err) { console.error('[chippy] subscriber error:', err); }
    }
  }

  /* ------------------------------ helpers ------------------------------ */

  const CLOSED_TASK = new Set(['resolvedtask', 'obsoletetask', 'resolvedfollowup']);
  const CLOSED_GOAL = new Set(['achievedgoal', 'canceledgoal', 'resolvedgoal']);
  const PRIORITY = ['high', 'medium', 'low'];
  const KINDS = ['task', 'followup', 'goal'];

  const isTaskEntry = e => e.tags && (e.tags.includes('task') || e.tags.includes('followup'));
  const isOpenTask = e => isTaskEntry(e) && !e.tags.some(t => CLOSED_TASK.has(t));
  const isGoalEntry = e => e.tags && e.tags.includes('goal');
  const isOpenGoal = e => isGoalEntry(e) && !e.tags.some(t => CLOSED_GOAL.has(t));

  function io() {
    if (!Chippy.io) throw new Error('Chippy.io not loaded — io.js must load before store.js');
    return Chippy.io;
  }

  /* --------------------------- write-rule helpers ---------------------- */

  // created_at with seconds, local time: "YYYY-MM-DD HH:MM:SS".
  function nowISO(d) {
    // Test-only seam: window.__chippyTest.now() supplies a deterministic clock.
    d = d || (root.__chippyTest && root.__chippyTest.now && root.__chippyTest.now()) || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // A goal's unique identity tag: goal-<5 base36 chars>.
  function mintGoalId(rng) {
    // Test-only seam: window.__chippyTest.rng supplies a deterministic PRNG.
    rng = rng || (root.__chippyTest && root.__chippyTest.rng) || Math.random;
    let s = '';
    for (let i = 0; i < 5; i++) s += Math.floor(rng() * 36).toString(36);
    return 'goal-' + s;
  }

  // Inline #tag extraction (the # trigger): returns { text, tags } with the
  // #tokens removed from text. "# Heading" (space after #) is left untouched.
  function extractInlineTags(text) {
    const tags = [];
    const out = String(text).replace(/(^|\s)#([a-zA-Z0-9][a-zA-Z0-9-]*)/g,
      (m, pre, tag) => { tags.push(tag.toLowerCase()); return pre; });
    return { text: out, tags };
  }

  // Bare http(s) URLs -> [label](url). A word immediately before becomes the
  // label (underscores -> spaces); otherwise the domain. URLs already inside a
  // [label](url) span are left alone (they sit after "](", not after whitespace,
  // so the leading (^|\s) anchor never matches there).
  function autoLinkUrls(text) {
    return String(text).replace(
      /(^|\s)(?:(\S+)\s+)?(https?:\/\/[^\s)]+)/g,
      (m, lead, word, url) => {
        if (word) return `${lead}[${word.replace(/_/g, ' ')}](${url})`;
        const domain = url.replace(/^https?:\/\//, '').split('/')[0];
        return `${lead}[${domain}](${url})`;
      }
    );
  }

  // Write rules for an edited tag set (promotion via the inline editor):
  // dedupe, keep only the last priority typed (so a newly added one wins over
  // the existing), default 'low' when a kind tag is present without priority,
  // and mint a goal identity tag when an entry becomes a goal. Pure.
  function applyEditTagRules(tags, rng) {
    let out = [];
    let prio = null;
    for (const t of tags) {
      if (PRIORITY.includes(t)) { prio = t; continue; } // last priority wins
      if (!out.includes(t)) out.push(t);
    }
    if (out.includes('goal') && !out.some(t => /^goal-[a-z0-9]{5}$/.test(t))) {
      out.push(mintGoalId(rng));
    }
    if (!prio && out.some(t => KINDS.includes(t))) prio = 'low';
    if (prio) out.push(prio);
    return out;
  }

  // Names referenced as @[Full Name] in body text.
  function extractNameTokens(text) {
    const names = [];
    const re = /@\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(String(text)))) names.push(m[1]);
    return names;
  }

  /* ------------------------------ selectors ---------------------------- */

  const selectors = {
    isFolderReady: () => state.folderReady,
    getTheme: () => state.nav.theme,
    getDiscussions: () => state.nav.discussions,
    getTagUnion: () => state.tags,
    getNames: () => state.names,
    getDirHandle: () => state.dirHandle,
    getActiveScreen: () => state.activeScreen,
    getActiveMemberName: () => state.activeMemberName,
    getMember: (name) => state.members.get(name) || null,
    isLoaded: (name) => !!state.members.get(name),
    getActiveMember: () =>
      state.activeMemberName ? (state.members.get(state.activeMemberName) || null) : null,
    getOpenTasks: (member) => {
      const m = member || selectors.getActiveMember();
      return m && m.entries ? m.entries.filter(isOpenTask) : [];
    },
    getGoals: (member) => {
      const m = member || selectors.getActiveMember();
      return m && m.entries ? m.entries.filter(isOpenGoal) : [];
    },
    getDiscussionTags: () => {
      const seen = new Set();
      const tags = [];
      for (const d of state.nav.discussions) {
        if (d.tag && !seen.has(d.tag)) { seen.add(d.tag); tags.push(d.tag); }
      }
      return tags.sort((a, b) => a.localeCompare(b));
    }
  };

  /* ------------------------------ actions ------------------------------ */

  async function openFolder() {
    const dir = await io().openFolder();
    const { nav, tags, names } = await io().loadIndexes(dir);
    // Folder is the source of truth: discussion files may be added or removed by
    // outside/automated processes, so reconcile the nav list with what is on
    // disk at startup (drop missing, add new). Persist only if it changed.
    let activeNav = nav;
    try {
      const r = await io().reconcileNavWithFiles(dir, nav);
      activeNav = r.nav;
      if (r.changed) await io().saveNav(dir, activeNav);
    } catch (err) {
      console.error('[chippy] nav reconcile failed:', err);
    }
    state.dirHandle = dir;
    state.nav = activeNav;
    state.tags = tags;
    state.names = names;
    state.members = new Map(activeNav.discussions.map(d => [d.name, null]));
    state.activeMemberName = null;
    state.folderReady = true;
    emit({ type: 'folderOpened', discussions: activeNav.discussions.length });
    return state;
  }

  // Self-healing registries: whenever a discussion's entries are (re)loaded,
  // re-register any tag or @[Name] reference that is missing from the
  // persisted unions. Recovers a lost or blanked tags/names index (e.g. after
  // an interrupted migration) from the data that is still in the entries.
  async function registerMemberRefs(m) {
    if (!m || !m.entries || !state.dirHandle) return;
    let tagsChanged = false, namesChanged = false;
    for (const e of m.entries) {
      for (const t of (e.tags || [])) {
        if (t && !state.tags.includes(t)) { state.tags.push(t); tagsChanged = true; }
      }
      for (const n of extractNameTokens(e.body || '')) {
        if (n && !state.names.includes(n)) { state.names.push(n); namesChanged = true; }
      }
    }
    if (tagsChanged) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.dirHandle, state.tags); }
    if (namesChanged) { state.names.sort((a, b) => a.localeCompare(b)); await io().saveNames(state.dirHandle, state.names); }
  }

  async function selectMember(name) {
    if (!state.members.has(name)) state.members.set(name, null);
    if (state.members.get(name) === null) {
      const m = await io().loadDiscussion(state.dirHandle, name);
      state.members.set(name, m);
      await registerMemberRefs(m);
    }
    state.activeMemberName = name;
    state.activeScreen = 'member';
    emit({ type: 'memberSelected', name });
    return state.members.get(name);
  }

  function setActiveScreen(name) { state.activeScreen = name; emit({ type: 'screenChanged', name }); }

  function setTheme(theme) {
    state.nav.theme = theme === 'light' ? 'light' : 'dark';
    emit({ type: 'themeChanged', theme: state.nav.theme });
  }

  async function toggleFavorite(name) {
    const d = state.nav.discussions.find(x => x.name === name);
    if (!d) return;
    d.favorite = !d.favorite;
    await io().saveNav(state.dirHandle, state.nav);
    emit({ type: 'favoriteToggled', name, favorite: d.favorite });
  }

  async function setDiscussionTag(name, tag) {
    const d = state.nav.discussions.find(x => x.name === name);
    if (!d) return;
    d.tag = tag || null;
    await io().saveNav(state.dirHandle, state.nav);
    emit({ type: 'discussionTagChanged', name, tag: d.tag });
  }

  async function reloadMember(name) {
    const member = await io().loadDiscussion(state.dirHandle, name);
    state.members.set(name, member);
    await registerMemberRefs(member);
    emit({ type: 'memberReloaded', name });
    return member;
  }

  // Archive a discussion: rename its file to *.archive.md on disk, drop it from
  // the navigation index (so it's no longer listed or loaded), and forget any
  // cached copy. (R-archive)
  async function archiveDiscussion(name) {
    await io().archiveDiscussion(state.dirHandle, name);
    state.nav.discussions = state.nav.discussions.filter(d => d.name !== name);
    state.members.delete(name);
    if (state.activeMemberName === name) state.activeMemberName = null;
    await io().saveNav(state.dirHandle, state.nav);
    emit({ type: 'discussionArchived', name });
  }

  // Rename a discussion: renames the .md file, moves the image folder, updates
  // the nav entry and member cache, and emits 'discussionRenamed'. (R64)
  async function renameDiscussion(oldName, newName) {
    const trimmed = newName && newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const existing = new Set(state.nav.discussions.map(d => d.name));
    if (existing.has(trimmed)) throw new Error('A discussion named "' + trimmed + '" already exists.');
    await io().renameDiscussion(state.dirHandle, oldName, trimmed);
    const nav = state.nav.discussions.find(d => d.name === oldName);
    if (nav) nav.name = trimmed;
    const wasLoaded = !!state.members.get(oldName); // truthy = member was in cache
    state.members.delete(oldName);
    if (!wasLoaded) state.members.set(trimmed, null); // preserve lazy-load slot
    if (state.activeMemberName === oldName) state.activeMemberName = trimmed;
    await io().saveNav(state.dirHandle, state.nav);
    // Reload the renamed discussion from disk so that image refs in the in-memory
    // cache point to the new folder name. reloadMember emits 'memberReloaded'
    // which triggers pages.refresh() and re-renders the discussion view with
    // correct images — this must happen before 'discussionRenamed' fires so the
    // sidebar and recent bar update after the view is already correct.
    if (wasLoaded) await reloadMember(trimmed);
    emit({ type: 'discussionRenamed', oldName, name: trimmed });
  }

  // Create a new empty discussion: write its .md file, register it in navigation,
  // and cache the empty member object. Appends _2, _3, … if the base name is
  // already taken. Opens the new discussion immediately. (R60)
  async function createDiscussion(name) {
    if (!state.folderReady) return;
    const existing = new Set(state.nav.discussions.map(d => d.name));
    let uniqueName = name;
    let suffix = 2;
    while (existing.has(uniqueName)) uniqueName = name + '_' + suffix++;
    const member = { name: uniqueName, group: null, archived: false, prep: '', entries: [] };
    await io().saveDiscussion(state.dirHandle, member);
    state.nav.discussions.push({ name: uniqueName, favorite: false, archived: false, tag: null });
    state.members.set(uniqueName, member);
    await io().saveNav(state.dirHandle, state.nav);
    emit({ type: 'discussionCreated', name: uniqueName });
    await selectMember(uniqueName);
  }

  async function setPrep(name, prep) {
    const m = state.members.get(name);
    if (!m) return;
    m.prep = prep;
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'prepSaved', name });
  }

  // Create a new entry applying all write rules; persist the file + indexes.
  // opts: { text, tags=[], goalLinkId=null, due=null }
  async function addEntry(name, opts) {
    opts = opts || {};
    const m = state.members.get(name);
    if (!m) throw new Error('member not loaded: ' + name);

    const body = autoLinkUrls(String(opts.text || '').trim());
    if (!body) return null; // empty body is not retained

    const tags = (opts.tags || []).map(t => String(t).trim()).filter(Boolean);
    let goal = null;

    if (tags.includes('goal') && !tags.some(t => /^goal-[a-z0-9]{5}$/.test(t))) {
      tags.push(mintGoalId());
    }
    if (opts.goalLinkId) {
      if (!tags.includes(opts.goalLinkId)) tags.push(opts.goalLinkId);
      const g = (m.entries || []).find(e =>
        e.tags && e.tags.includes('goal') && e.tags.includes(opts.goalLinkId));
      if (g) goal = (g.body || '').split('\n')[0];
    }
    if (tags.some(t => KINDS.includes(t)) && !tags.some(t => PRIORITY.includes(t))) {
      tags.push('low');
    }

    const entry = { created_at: nowISO(), tags, goal, due: opts.due || null, body };
    m.entries.push(entry);

    let tagsChanged = false;
    for (const t of tags) if (!state.tags.includes(t)) { state.tags.push(t); tagsChanged = true; }
    if (tagsChanged) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.dirHandle, state.tags); }

    let namesChanged = false;
    for (const n of extractNameTokens(body)) if (!state.names.includes(n)) { state.names.push(n); namesChanged = true; }
    if (namesChanged) { state.names.sort((a, b) => a.localeCompare(b)); await io().saveNames(state.dirHandle, state.names); }

    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'entryAdded', name, entry });
    return entry;
  }

  /* --------------------- task / followup management -------------------- */

  const STATE_TAGS = ['opentask', 'inprogresstask', 'checktask', 'onholdtask',
                      'purgatorytask', 'resolvedtask', 'obsoletetask'];
  const LEGACY_STATE = ['inprogress', 'onhold', 'purgatory'];
  const STATE_TO_TAG = {
    open: null, inprogress: 'inprogresstask', check: 'checktask', onhold: 'onholdtask',
    purgatory: 'purgatorytask', resolved: 'resolvedtask', obsolete: 'obsoletetask'
  };
  const ACTION_HEADERS = new Set(['Task Resolution Actions', 'Followup Actions', 'Goal Actions']);
  const BULLET_RE = /^- \d{4}-\d{2}-\d{2} : /;

  function actionLabelFor(e) {
    if (e.tags.includes('goal')) return 'Goal Actions';
    if (e.tags.includes('followup')) return 'Followup Actions';
    return 'Task Resolution Actions';
  }

  // Split a body into its description (`pre`) and the trailing action bullets,
  // consuming any trailing run of blank / bullet / action-header lines.
  function splitTrailingActions(body) {
    const lines = String(body).split('\n');
    const bullets = [];
    let k = lines.length - 1;
    while (k >= 0) {
      const l = lines[k], tr = l.trim();
      if (tr === '') { k--; continue; }
      if (BULLET_RE.test(l)) { bullets.unshift(l); k--; continue; }
      if (ACTION_HEADERS.has(tr)) { k--; continue; }
      break;
    }
    return { pre: lines.slice(0, k + 1).join('\n').replace(/\n+$/, ''), bullets };
  }

  // --- Three-part body model (datadefinition §2.1) ---
  // A body consists of at most three things: the comment text, a single
  // "Updated:" line, and one trailing action section. Legacy lifecycle markers
  // (Resolved:/Obsolete:/Achieved:/Canceled:/Moved from:) are preserved
  // verbatim but never written anew — new state changes are logged as action
  // bullets instead.
  const LEGACY_MARKER_RE = /^((Resolved|Obsolete|Achieved|Canceled): |Moved from .+: )\d{4}-\d{2}-\d{2}/;
  const UPDATED_RE = /^Updated: \d{4}-\d{2}-\d{2}/;

  // Split a body into { comment, markers, updated, bullets }. Multiple legacy
  // "Updated:" lines collapse to the most recent one.
  function splitBodyParts(body) {
    const { pre, bullets } = splitTrailingActions(body);
    const markers = [];
    let updated = null;
    const rest = [];
    for (const l of pre.split('\n')) {
      const tr = l.trim();
      if (UPDATED_RE.test(tr)) { if (!updated || tr > updated) updated = tr; continue; }
      if (LEGACY_MARKER_RE.test(tr)) { markers.push(tr); continue; }
      rest.push(l);
    }
    const comment = rest.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { comment, markers, updated, bullets };
  }

  // Reassemble the canonical body: comment, legacy markers, the Updated line,
  // then the action section last — blank-line separated.
  function joinBodyParts(parts, e) {
    let body = parts.comment || '';
    for (const mk of parts.markers) body += (body ? '\n\n' : '') + mk;
    if (parts.updated) body += (body ? '\n\n' : '') + parts.updated;
    if (parts.bullets.length) {
      body += (body ? '\n\n' : '') + actionLabelFor(e) + '\n' + parts.bullets.join('\n');
    }
    return body;
  }

  // Log a state change as a dated action bullet: "- YYYY-MM-DD : → LABEL".
  function logStateAction(e, label) {
    const parts = splitBodyParts(e.body);
    parts.bullets.push('- ' + nowISO().slice(0, 10) + ' : → ' + label);
    e.body = joinBodyParts(parts, e);
  }

  // Locate an entry by created_at. When several entries share a timestamp the
  // optional idx hint (the entry's position in m.entries) disambiguates them —
  // it's only trusted if that slot still carries the same created_at, otherwise
  // we fall back to the first timestamp match.
  function findEntry(name, entryId, idx) {
    const m = state.members.get(name);
    if (!m) return [null, null];
    const entries = m.entries || [];
    if (typeof idx === 'number' && idx >= 0 && idx < entries.length &&
        entries[idx] && entries[idx].created_at === entryId) {
      return [m, entries[idx]];
    }
    return [m, entries.find(e => e.created_at === entryId) || null];
  }

  async function ensureTagsInUnion(tags) {
    let changed = false;
    for (const t of tags) if (!state.tags.includes(t)) { state.tags.push(t); changed = true; }
    if (changed) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.dirHandle, state.tags); }
  }

  function isMuted(e) {
    const t = (e.tags || []).find(x => x.startsWith('muted:'));
    if (!t) return false;
    return t.slice('muted:'.length) >= nowISO().slice(0, 10); // expired -> not muted
  }

  // Set a task/followup state: strip every state tag, add the one new tag, and
  // log the transition as an action bullet ("- YYYY-MM-DD : → LABEL") in the
  // entry's action section. No new Resolved:/Obsolete: marker lines are written
  // (existing legacy markers are preserved). Followups use the same states as
  // tasks (resolved -> resolvedtask, no resolvedfollowup); legacy
  // resolvedfollowup is still stripped and still read as DONE elsewhere.
  // (datadefinition §2.1-2.2)
  async function setTaskState(name, entryId, stateKey, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    const prevKey = Chippy.tags.stateKeyOf(e.tags);
    e.tags = e.tags.filter(t =>
      !STATE_TAGS.includes(t) && !LEGACY_STATE.includes(t) && t !== 'resolvedfollowup');
    const newTag = STATE_TO_TAG[stateKey];
    if (newTag) e.tags.push(newTag);

    if (stateKey !== prevKey) {
      logStateAction(e, (Chippy.tags.STATE_SQUARE[stateKey] || [stateKey])[0]);
    }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'taskStateChanged', name, entryId, stateKey });
  }

  async function cyclePriority(name, entryId, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    const order = ['high', 'medium', 'low'];
    const cur = e.tags.find(t => order.includes(t));
    const next = order[((cur ? order.indexOf(cur) : 2) + 1) % 3];
    e.tags = e.tags.filter(t => !order.includes(t));
    e.tags.push(next);
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'priorityChanged', name, entryId, priority: next });
  }

  async function setDue(name, entryId, due, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    e.due = due || null;
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'dueChanged', name, entryId, due: e.due });
  }

  // Append a dated action bullet, consolidating into one action section at the
  // end of the body. (skill resolution-actions rules / datadefinition §2.1)
  async function appendAction(name, entryId, text, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    const { pre, bullets } = splitTrailingActions(e.body);
    bullets.push('- ' + nowISO().slice(0, 10) + ' : ' + text);
    e.body = pre + '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
    // Actions often reference other people — register any new @[Name] like
    // addEntry/editEntry do.
    let namesChanged = false;
    for (const n of extractNameTokens(text)) {
      if (!state.names.includes(n)) { state.names.push(n); namesChanged = true; }
    }
    if (namesChanged) { state.names.sort((a, b) => a.localeCompare(b)); await io().saveNames(state.dirHandle, state.names); }
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'actionAppended', name, entryId });
  }

  // Toggle a 5-day mute (muted:<expiry>). (v2.3)
  async function toggleMute(name, entryId, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    const muted = e.tags.find(t => t.startsWith('muted:'));
    if (muted) e.tags = e.tags.filter(t => t !== muted);
    else {
      const d = new Date(); d.setDate(d.getDate() + 5);
      const p = n => String(n).padStart(2, '0');
      e.tags.push(`muted:${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'muteToggled', name, entryId });
  }

  /* ----------------------------- goals --------------------------------- */

  const GOAL_STATE_TAGS = ['achievedgoal', 'canceledgoal', 'resolvedgoal'];
  const GOAL_STATE_LABEL = { achieved: 'Achieved', canceled: 'Canceled', open: 'Open' };

  // Goal state: 'achieved' (achievedgoal tag), 'canceled' (canceledgoal), or
  // 'open' (no closed tag). The transition is logged as a Goal Actions bullet;
  // no new Achieved:/Canceled: marker lines are written (legacy markers are
  // preserved). (datadefinition §2.1-2.2)
  async function setGoalState(name, entryId, stateKey, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    const prev = e.tags.includes('achievedgoal') || e.tags.includes('resolvedgoal') ? 'achieved'
      : e.tags.includes('canceledgoal') ? 'canceled' : 'open';
    e.tags = e.tags.filter(t => !GOAL_STATE_TAGS.includes(t));
    if (stateKey === 'achieved') e.tags.push('achievedgoal');
    else if (stateKey === 'canceled') e.tags.push('canceledgoal');
    if (stateKey !== prev) logStateAction(e, GOAL_STATE_LABEL[stateKey] || stateKey);
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'goalStateChanged', name, entryId, stateKey });
  }

  // Edit an entry's comment part. Only the comment text is replaced — the
  // Updated line and the action section are preserved untouched. A single
  // "Updated:" line records the latest edit: refreshed in place on every
  // subsequent edit, never duplicated. (R41 / v1.42, revised)
  async function editEntry(name, entryId, opts, idx) {
    opts = opts || {};
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    if (Array.isArray(opts.tags)) e.tags = applyEditTagRules(opts.tags);
    if (opts.text != null) {
      const parts = splitBodyParts(e.body);
      parts.comment = autoLinkUrls(String(opts.text).trim());
      const created = (e.created_at || '').slice(0, 10);
      if (nowISO().slice(0, 10) !== created) parts.updated = 'Updated: ' + nowISO();
      e.body = joinBodyParts(parts, e);
      // Register any @[Name] first referenced in the edited text, exactly like
      // addEntry does on creation — a name may be entered via edit too.
      let namesChanged = false;
      for (const n of extractNameTokens(e.body)) {
        if (!state.names.includes(n)) { state.names.push(n); namesChanged = true; }
      }
      if (namesChanged) { state.names.sort((a, b) => a.localeCompare(b)); await io().saveNames(state.dirHandle, state.names); }
    }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'entryEdited', name, entryId });
  }

  /* --------------------------- links + move ---------------------------- */

  function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Extract links from a text: markdown [label](url) plus bare http(s) URLs.
  function extractLinks(text) {
    const out = [], seen = new Set();
    const s = String(text || '');
    let m;
    const md = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = md.exec(s))) {
      if (s[m.index - 1] === '!') continue; // image reference ![alt](src), not a link
      if (!seen.has(m[2])) { seen.add(m[2]); out.push({ label: m[1], url: m[2] }); }
    }
    const bare = /(^|\s)(https?:\/\/[^\s)]+)/g;
    while ((m = bare.exec(s))) if (!seen.has(m[2])) {
      seen.add(m[2]); out.push({ label: m[2].replace(/^https?:\/\//, '').split('/')[0], url: m[2] });
    }
    return out;
  }

  // Aggregate + dedupe links across a member's prep and all entry bodies.
  function getLinks(member) {
    const m = member || selectors.getActiveMember();
    if (!m) return [];
    const map = new Map(); // url -> { label, url, date } (newest occurrence wins)
    const consider = (text, date) => {
      for (const l of extractLinks(text)) {
        const ex = map.get(l.url);
        if (!ex || (date || '') > (ex.date || '')) map.set(l.url, { label: l.label, url: l.url, date: date || '' });
      }
    };
    for (const e of (m.entries || [])) consider(e.body || '', e.created_at || '');
    consider(m.prep || '', '');
    return [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // Rename a link's display title in its source text (matched by URL). (R44)
  async function renameLink(name, url, newLabel) {
    const m = state.members.get(name);
    if (!m) return;
    const re = new RegExp('\\[[^\\]]*\\]\\(' + escRegex(url) + '\\)', 'g');
    const rep = '[' + newLabel + '](' + url + ')';
    if (m.prep) m.prep = m.prep.replace(re, rep);
    for (const e of (m.entries || [])) e.body = (e.body || '').replace(re, rep);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'linkRenamed', name, url });
  }

  // Move an entry to another discussion: transfer its images, rewrite refs, add
  // a "Moved from <source>: <ts>" marker. (R29, R36)
  async function moveEntry(name, entryId, targetName) {
    const src = state.members.get(name);
    if (!src) return;
    const idx = (src.entries || []).findIndex(e => e.created_at === entryId);
    if (idx < 0) return;
    const entry = src.entries[idx];

    let tgt = state.members.get(targetName);
    if (!tgt) { tgt = await io().loadDiscussion(state.dirHandle, targetName); state.members.set(targetName, tgt); }

    // Transfer referenced images and rewrite their refs.
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let mm; const refs = [];
    while ((mm = imgRe.exec(entry.body || ''))) refs.push(mm[1]);
    for (const ref of refs) {
      if (io().isSafeImagePath(ref)) {
        const newRef = await io().ImageStore.moveImage(state.dirHandle, ref, targetName);
        if (newRef) entry.body = entry.body.split('](' + ref + ')').join('](' + newRef + ')');
      }
    }

    // "Moved from" marker before any action section.
    const { pre, bullets } = splitTrailingActions(entry.body);
    let body = pre + '\n\nMoved from ' + src.name + ': ' + nowISO();
    if (bullets.length) body += '\n\n' + actionLabelFor(entry) + '\n' + bullets.join('\n');
    entry.body = body;

    src.entries.splice(idx, 1);
    tgt.entries.push(entry);
    tgt.entries.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

    await io().saveDiscussion(state.dirHandle, src);
    await io().saveDiscussion(state.dirHandle, tgt);
    emit({ type: 'entryMoved', from: name, to: targetName, entryId });
  }

  // Delete an entry and any image files it references. (v1.22)
  async function deleteEntry(name, entryId) {
    const m = state.members.get(name);
    if (!m) return;
    const idx = (m.entries || []).findIndex(e => e.created_at === entryId);
    if (idx < 0) return;
    const entry = m.entries[idx];
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let mm;
    while ((mm = imgRe.exec(entry.body || ''))) { try { await io().ImageStore.deleteImage(state.dirHandle, mm[1]); } catch (_) {} }
    m.entries.splice(idx, 1);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'entryDeleted', name, entryId });
  }

  /* ------------------------------ images ------------------------------- */

  async function saveImage(name, blob) { return io().ImageStore.saveImage(state.dirHandle, name, blob); }
  async function getImageUrl(ref) { return io().ImageStore.getImageUrl(state.dirHandle, ref); }

  /* --------------------- cross-discussion + search --------------------- */

  // Lazy-load every non-archived discussion (for cross-views), caching each.
  // A discussion whose file can't be read — missing, renamed outside the app, or
  // an unmaterialized cloud placeholder (OneDrive/SharePoint "Files On-Demand") —
  // is skipped instead of aborting the whole load; its name and the error are
  // collected and returned so the caller can surface them to the user. The cache
  // slot is left null so a later open retries (e.g. once the placeholder hydrates).
  async function ensureAllLoaded() {
    const failed = [];
    for (const d of state.nav.discussions) {
      if (!d.archived && state.members.get(d.name) === null) {
        try {
          const m = await io().loadDiscussion(state.dirHandle, d.name);
          state.members.set(d.name, m);
          await registerMemberRefs(m);
        } catch (err) {
          failed.push({ name: d.name, error: (err && err.name) || 'Error' });
          console.warn('[chippy] could not load discussion "' + d.name + '":', err);
        }
      }
    }
    if (failed.length) emit({ type: 'discussionsLoadFailed', failed });
    return failed;
  }

  // All loaded entries, each shallow-tagged with its _member (read-only views).
  function collectEntries(opts) {
    const out = [];
    const discTag = opts && opts.discTag;
    for (const [name, m] of state.members) {
      if (!m) continue;
      if (discTag) {
        const nav = state.nav.discussions.find(d => d.name === name);
        if (!nav || nav.tag !== discTag) continue;
      }
      (m.entries || []).forEach((e, i) => out.push(Object.assign({ _member: name, _idx: i }, e)));
    }
    return out;
  }

  // Parse a unified query: "#tag", "@Name"/"@[Full Name]", and freetext.
  function parseSearchQuery(q) {
    const tags = [], names = [], rest = [];
    const re = /@\[([^\]]+)\]|@(\S+)|#(\S+)|(\S+)/g;
    let m;
    while ((m = re.exec(String(q || '')))) {
      if (m[1] != null) names.push(m[1].toLowerCase());
      else if (m[2] != null) names.push(m[2].toLowerCase());
      else if (m[3] != null) tags.push(m[3].toLowerCase());
      else if (m[4] != null) rest.push(m[4]);
    }
    return { tags, names, text: rest.join(' ').toLowerCase() };
  }

  // Does an entry satisfy a parsed query? Tags AND names AND freetext.
  function entryMatches(e, parsed) {
    const tags = (e.tags || []).map(t => t.toLowerCase());
    for (const t of parsed.tags) if (!tags.some(x => x.includes(t))) return false;
    if (parsed.names.length) {
      const en = extractNameTokens(e.body || '').map(x => x.toLowerCase());
      for (const n of parsed.names) if (!en.some(x => x.includes(n))) return false;
    }
    if (parsed.text && !(e.body || '').toLowerCase().includes(parsed.text)) return false;
    return true;
  }

  function applyUnifiedFilter(entries, query) {
    const parsed = parseSearchQuery(query);
    return entries.filter(e => entryMatches(e, parsed));
  }

  // Aggregate @[Name] references across all loaded entries: count, last-seen,
  // discussions, and recent excerpts. Registry names with zero mentions go last.
  function getAllNames(discTag) {
    const map = new Map();
    for (const n of state.names) map.set(n, { name: n, count: 0, lastSeen: null, discussions: new Set(), excerpts: [] });
    for (const [mname, m] of state.members) {
      if (!m) continue;
      if (discTag) {
        const nav = state.nav.discussions.find(d => d.name === mname);
        if (!nav || nav.tag !== discTag) continue;
      }
      for (const e of (m.entries || [])) {
        for (const nm of extractNameTokens(e.body || '')) {
          if (!map.has(nm)) map.set(nm, { name: nm, count: 0, lastSeen: null, discussions: new Set(), excerpts: [] });
          const rec = map.get(nm);
          rec.count++;
          rec.discussions.add(mname);
          if (!rec.lastSeen || (e.created_at || '') > rec.lastSeen) rec.lastSeen = e.created_at;
          rec.excerpts.push({ date: e.created_at, discussion: mname, body: e.body });
        }
      }
    }
    const arr = [...map.values()];
    arr.forEach(r => {
      r.discussions = [...r.discussions];
      r.excerpts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      r.excerpts = r.excerpts.slice(0, 10);
    });
    arr.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '') || a.name.localeCompare(b.name));
    return discTag ? arr.filter(n => n.count > 0) : arr;
  }

  // Aggregate user-facing #tags across all loaded entries: total count and the
  // most recent use. Reserved/state/priority/goal-id/muted tags are excluded.
  function getAllTags(discTag) {
    const map = new Map();
    for (const [mname, m] of state.members) {
      if (!m) continue;
      if (discTag) {
        const nav = state.nav.discussions.find(d => d.name === mname);
        if (!nav || nav.tag !== discTag) continue;
      }
      for (const e of (m.entries || [])) {
        for (const t of (e.tags || [])) {
          if (HIDDEN_TAG.test(t)) continue;
          if (!map.has(t)) map.set(t, { tag: t, count: 0, lastUsed: null });
          const rec = map.get(t);
          rec.count++;
          if (!rec.lastUsed || (e.created_at || '') > rec.lastUsed) rec.lastUsed = e.created_at;
        }
      }
    }
    const arr = [...map.values()];
    arr.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || '') || a.tag.localeCompare(b.tag));
    return arr;
  }

  /* --------------------------- kanban / Ro3 ---------------------------- */

  // The date an entry was resolved: the latest "→ DONE" action bullet, or the
  // legacy "Resolved: <date>" marker as fallback.
  function resolvedDate(e) {
    const body = e.body || '';
    let last = null, m;
    const act = /^- (\d{4}-\d{2}-\d{2}) : → DONE$/gm;
    while ((m = act.exec(body))) if (!last || m[1] > last) last = m[1];
    if (last) return last;
    const mk = body.match(/Resolved: (\d{4}-\d{2}-\d{2})/);
    return mk ? mk[1] : null;
  }
  // True if not resolved, or resolved within the last `months`. (Done-column limit)
  function doneRecent(e, months) {
    const d = resolvedDate(e);
    if (!d) return true;
    const c = new Date(); c.setMonth(c.getMonth() - months);
    const p = n => String(n).padStart(2, '0');
    const cutoff = `${c.getFullYear()}-${p(c.getMonth() + 1)}-${p(c.getDate())}`;
    return d >= cutoff;
  }

  // Open task/followup candidates for Ro3: not closed, not muted.
  function getRo3Candidates(discTag) {
    return collectEntries({ discTag }).filter(e => {
      const t = e.tags || [];
      if (!(t.includes('task') || t.includes('followup'))) return false;
      if (t.some(x => ['resolvedtask', 'obsoletetask', 'resolvedfollowup'].includes(x))) return false;
      if (isMuted(e)) return false;
      return true;
    });
  }

  // Pick up to 3: one high, one medium, one low; fill from any bucket if empty.
  function pickRo3(cands, rng) {
    rng = rng || Math.random;
    const by = { high: [], medium: [], low: [], none: [] };
    for (const c of cands) {
      const p = (c.tags || []).find(t => t === 'high' || t === 'medium' || t === 'low') || 'none';
      by[p].push(c);
    }
    const take = arr => arr.length ? arr.splice(Math.floor(rng() * arr.length), 1)[0] : null;
    const out = [];
    for (const p of ['high', 'medium', 'low']) { const x = take(by[p]); if (x) out.push(x); }
    const rest = [].concat(by.high, by.medium, by.low, by.none);
    while (out.length < 3 && rest.length) { const x = take(rest); if (x) out.push(x); }
    return out;
  }

  /* -------------------------- summary + export ------------------------- */

  const HIDDEN_TAG = Chippy.tags.RESERVED; // taxonomy.js — single source of truth

  function shortId(rng) {
    rng = rng || Math.random;
    let s = '';
    for (let i = 0; i < 5; i++) s += Math.floor(rng() * 36).toString(36);
    return s;
  }

  async function loadSummary() {
    const text = await io().readSummary(state.dirHandle);
    return text ? Chippy.format.parseSummary(text) : { api_url: null, api_model: null, summaries: [] };
  }
  async function saveSummaryConfig(api_url, api_model) {
    const s = await loadSummary();
    s.api_url = api_url; s.api_model = api_model;
    await io().writeSummary(state.dirHandle, Chippy.format.serializeSummary(s));
  }
  async function appendSummary(card) {
    const s = await loadSummary();
    s.summaries.unshift(card); // newest first
    await io().writeSummary(state.dirHandle, Chippy.format.serializeSummary(s));
    emit({ type: 'summarySaved' });
  }
  async function deleteSummary(id) {
    const s = await loadSummary();
    s.summaries = s.summaries.filter(c => c.id !== id);
    await io().writeSummary(state.dirHandle, Chippy.format.serializeSummary(s));
    emit({ type: 'summaryDeleted' });
  }
  async function updateSummary(id, body) {
    const s = await loadSummary();
    const c = s.summaries.find(x => x.id === id);
    if (!c) return;
    c.body = String(body).trim();
    await io().writeSummary(state.dirHandle, Chippy.format.serializeSummary(s));
    emit({ type: 'summarySaved' });
  }
  // Move a generated summary into a discussion: create an entry there, drop the card.
  async function moveSummaryToDiscussion(id, targetName) {
    const s = await loadSummary();
    const c = s.summaries.find(x => x.id === id);
    if (!c) return;
    await addEntry(targetName, { text: c.body });
    await deleteSummary(id);
    emit({ type: 'summaryMoved', id, to: targetName });
  }

  // Build a Markdown contribution summary for a discussion (mid/end-year reviews).
  function exportContribution(member) {
    let md = '# ' + member.name + ' — Contribution Summary\n\n';
    md += 'Generated: ' + nowISO() + '\n';
    const entries = member.entries || [];
    if (!entries.length) return md + '\n_No entries._\n';
    let lastDay = null;
    for (const e of entries) {
      const day = (e.created_at || '').slice(0, 10);
      if (day !== lastDay) { md += '\n## ' + day + '\n\n'; lastDay = day; }
      const vis = (e.tags || []).filter(t => !HIDDEN_TAG.test(t));
      md += '- ' + (e.body || '').split('\n')[0] + (vis.length ? '  [' + vis.join(', ') + ']' : '') + '\n';
    }
    return md;
  }

  /* ------------------------------ export ------------------------------- */

  Chippy.store = Object.assign(
    {
      subscribe, openFolder, selectMember, setActiveScreen, setTheme,
      toggleFavorite, setDiscussionTag, reloadMember, archiveDiscussion, renameDiscussion, createDiscussion, setPrep, addEntry,
      setTaskState, cyclePriority, setDue, appendAction, toggleMute, isMuted,
      setGoalState, editEntry, getLinks, renameLink, moveEntry, deleteEntry,
      saveImage, getImageUrl,
      ensureAllLoaded, collectEntries, applyUnifiedFilter, getAllNames, getAllTags,
      getRo3Candidates, pickRo3, doneRecent, resolvedDate,
      loadSummary, saveSummaryConfig, appendSummary, deleteSummary, updateSummary, moveSummaryToDiscussion, exportContribution, shortId,
      // pure helpers exposed for the UI and for tests
      nowISO, mintGoalId, extractInlineTags, autoLinkUrls, extractNameTokens, applyEditTagRules,
      splitTrailingActions, splitBodyParts, joinBodyParts, actionLabelFor, extractLinks, parseSearchQuery,
      _state: state
    },
    selectors
  );
})(typeof globalThis !== 'undefined' ? globalThis : this);
