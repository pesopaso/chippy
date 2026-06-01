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
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // A goal's unique identity tag: goal-<5 base36 chars>.
  function mintGoalId(rng) {
    rng = rng || Math.random;
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
    await io().saveNav(state.nav);
    emit({ type: 'favoriteToggled', name, favorite: d.favorite });
  }

  async function reloadMember(name) {
    const member = await io().loadDiscussion(state.dirHandle, name);
    state.members.set(name, member);
    emit({ type: 'memberReloaded', name });
    return member;
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
    if (tagsChanged) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.tags); }

    let namesChanged = false;
    for (const n of extractNameTokens(body)) if (!state.names.includes(n)) { state.names.push(n); namesChanged = true; }
    if (namesChanged) { state.names.sort((a, b) => a.localeCompare(b)); await io().saveNames(state.names); }

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

  function findEntry(name, entryId) {
    const m = state.members.get(name);
    if (!m) return [null, null];
    return [m, (m.entries || []).find(e => e.created_at === entryId) || null];
  }

  async function ensureTagsInUnion(tags) {
    let changed = false;
    for (const t of tags) if (!state.tags.includes(t)) { state.tags.push(t); changed = true; }
    if (changed) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.tags); }
  }

  function isMuted(e) {
    const t = (e.tags || []).find(x => x.startsWith('muted:'));
    if (!t) return false;
    return t.slice('muted:'.length) >= nowISO().slice(0, 10); // expired -> not muted
  }

  // Set a task/followup state: strip every state tag, add the one new tag
  // (resolved on a followup -> resolvedfollowup), and append Resolved:/Obsolete:
  // markers before any action section. (datadefinition §2.1-2.2)
  async function setTaskState(name, entryId, stateKey) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    const isFollowup = e.tags.includes('followup');
    e.tags = e.tags.filter(t =>
      !STATE_TAGS.includes(t) && !LEGACY_STATE.includes(t) && t !== 'resolvedfollowup');
    let newTag = STATE_TO_TAG[stateKey];
    if (stateKey === 'resolved' && isFollowup) newTag = 'resolvedfollowup';
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

  async function cyclePriority(name, entryId) {
    const [m, e] = findEntry(name, entryId);
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

  async function setDue(name, entryId, due) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    e.due = due || null;
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'dueChanged', name, entryId, due: e.due });
  }

  // Append a dated action bullet, consolidating into one action section at the
  // end of the body. (skill resolution-actions rules / datadefinition §2.1)
  async function appendAction(name, entryId, text) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    const { pre, bullets } = splitTrailingActions(e.body);
    bullets.push('- ' + nowISO().slice(0, 10) + ' : ' + text);
    e.body = pre + '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'actionAppended', name, entryId });
  }

  // Toggle a 5-day mute (muted:<expiry>). (v2.3)
  async function toggleMute(name, entryId) {
    const [m, e] = findEntry(name, entryId);
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

  /* ------------------------------ export ------------------------------- */

  Chippy.store = Object.assign(
    {
      subscribe, openFolder, selectMember, setActiveScreen, setTheme,
      toggleFavorite, reloadMember, setPrep, addEntry,
      setTaskState, cyclePriority, setDue, appendAction, toggleMute, isMuted,
      // pure helpers exposed for the UI and for tests
      nowISO, mintGoalId, extractInlineTags, autoLinkUrls, extractNameTokens,
      splitTrailingActions, actionLabelFor,
      _state: state
    },
    selectors
  );
})(typeof globalThis !== 'undefined' ? globalThis : this);
