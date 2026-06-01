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

  /* ------------------------------ export ------------------------------- */

  Chippy.store = Object.assign(
    {
      subscribe, openFolder, selectMember, setActiveScreen, setTheme,
      toggleFavorite, reloadMember, setPrep, addEntry,
      // pure helpers exposed for the UI and for tests
      nowISO, mintGoalId, extractInlineTags, autoLinkUrls, extractNameTokens,
      _state: state
    },
    selectors
  );
})(typeof globalThis !== 'undefined' ? globalThis : this);
