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
    }
  };

  /* ------------------------------ actions ------------------------------ */

  async function openFolder() {
    const dir = await io().openFolder();
    const { nav, tags, names } = await io().loadIndexes(dir);
    state.dirHandle = dir;
    state.nav = nav;
    state.tags = tags;
    state.names = names;
    state.members = new Map(nav.discussions.map(d => [d.name, null]));
    state.activeMemberName = null;
    state.folderReady = true;
    emit({ type: 'folderOpened', discussions: nav.discussions.length });
    return state;
  }

  async function selectMember(name) {
    if (!state.members.has(name)) state.members.set(name, null);
    if (state.members.get(name) === null) {
      state.members.set(name, await io().loadDiscussion(state.dirHandle, name));
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

  async function reloadMember(name) {
    const member = await io().loadDiscussion(state.dirHandle, name);
    state.members.set(name, member);
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
  // append Resolved:/Obsolete: markers before any action section. Followups now
  // use the same states as tasks (resolved -> resolvedtask, no resolvedfollowup);
  // legacy resolvedfollowup is still stripped and still read as DONE elsewhere.
  // (datadefinition §2.1-2.2)
  async function setTaskState(name, entryId, stateKey, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    e.tags = e.tags.filter(t =>
      !STATE_TAGS.includes(t) && !LEGACY_STATE.includes(t) && t !== 'resolvedfollowup');
    const newTag = STATE_TO_TAG[stateKey];
    if (newTag) e.tags.push(newTag);

    if (stateKey === 'resolved' || stateKey === 'obsolete') {
      const { pre, bullets } = splitTrailingActions(e.body);
      const marker = (stateKey === 'resolved' ? 'Resolved: ' : 'Obsolete: ') + nowISO();
      let body = pre + '\n\n' + marker;
      if (bullets.length) body += '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
      e.body = body;
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

  // Append a "<Label>: <ts>" marker before any trailing action section.
  function insertMarker(e, label) {
    const { pre, bullets } = splitTrailingActions(e.body);
    let b = pre + '\n\n' + label + ': ' + nowISO();
    if (bullets.length) b += '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
    return b;
  }

  // Goal state: 'achieved' (achievedgoal + Achieved: marker), 'canceled'
  // (canceledgoal + Canceled:), or 'open' (no closed tag). (datadefinition §2.2)
  async function setGoalState(name, entryId, stateKey, idx) {
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    e.tags = e.tags.filter(t => !GOAL_STATE_TAGS.includes(t));
    if (stateKey === 'achieved') { e.tags.push('achievedgoal'); e.body = insertMarker(e, 'Achieved'); }
    else if (stateKey === 'canceled') { e.tags.push('canceledgoal'); e.body = insertMarker(e, 'Canceled'); }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'goalStateChanged', name, entryId, stateKey });
  }

  // Edit an entry's body (and optionally tags). Appends an "Updated:" marker only
  // when edited on a different calendar day than its creation. (R41 / v1.42)
  async function editEntry(name, entryId, opts, idx) {
    opts = opts || {};
    const [m, e] = findEntry(name, entryId, idx);
    if (!e) return;
    if (Array.isArray(opts.tags)) e.tags = opts.tags.slice();
    if (opts.text != null) {
      e.body = autoLinkUrls(String(opts.text).trim());
      const created = (e.created_at || '').slice(0, 10);
      const today = nowISO().slice(0, 10);
      if (today !== created && !e.body.split('\n').some(l => l.startsWith('Updated: ' + today))) {
        e.body = insertMarker(e, 'Updated');
      }
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
  async function ensureAllLoaded() {
    for (const d of state.nav.discussions) {
      if (!d.archived && state.members.get(d.name) === null) {
        state.members.set(d.name, await io().loadDiscussion(state.dirHandle, d.name));
      }
    }
  }

  // All loaded entries, each shallow-tagged with its _member (read-only views).
  function collectEntries() {
    const out = [];
    for (const [name, m] of state.members) {
      if (!m) continue;
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
  function getAllNames() {
    const map = new Map();
    for (const n of state.names) map.set(n, { name: n, count: 0, lastSeen: null, discussions: new Set(), excerpts: [] });
    for (const [mname, m] of state.members) {
      if (!m) continue;
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
    return arr;
  }

  // Aggregate user-facing #tags across all loaded entries: total count and the
  // most recent use. Reserved/state/priority/goal-id/muted tags are excluded.
  function getAllTags() {
    const map = new Map();
    for (const [, m] of state.members) {
      if (!m) continue;
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

  // The "Resolved: <date>" marker date, if present.
  function resolvedDate(e) {
    const m = (e.body || '').match(/Resolved: (\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
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
  function getRo3Candidates() {
    return collectEntries().filter(e => {
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

  const HIDDEN_TAG = /^(task|followup|goal|opentask|inprogresstask|checktask|onholdtask|purgatorytask|resolvedtask|obsoletetask|resolvedfollowup|achievedgoal|canceledgoal|resolvedgoal|high|medium|low|goal-[a-z0-9]{5}|muted:.*)$/;

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
      toggleFavorite, reloadMember, archiveDiscussion, setPrep, addEntry,
      setTaskState, cyclePriority, setDue, appendAction, toggleMute, isMuted,
      setGoalState, editEntry, getLinks, renameLink, moveEntry, deleteEntry,
      saveImage, getImageUrl,
      ensureAllLoaded, collectEntries, applyUnifiedFilter, getAllNames, getAllTags,
      getRo3Candidates, pickRo3, doneRecent, resolvedDate,
      loadSummary, saveSummaryConfig, appendSummary, deleteSummary, updateSummary, moveSummaryToDiscussion, exportContribution, shortId,
      // pure helpers exposed for the UI and for tests
      nowISO, mintGoalId, extractInlineTags, autoLinkUrls, extractNameTokens,
      splitTrailingActions, actionLabelFor, extractLinks, parseSearchQuery,
      _state: state
    },
    selectors
  );
})(typeof globalThis !== 'undefined' ? globalThis : this);
