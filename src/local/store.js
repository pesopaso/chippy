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
    nav: { discussions: [], theme: 'dark' }, // from navigation.md
    tags: [],                                 // from tags.md (the union)
    names: [],                                // from names.md
    members: new Map(),                       // name -> member | null (lazy)
    activeMemberName: null,
    activeScreen: 'welcome',
    ui: { filters: {}, search: '', draft: null }
  };

  /* ---------------------------- event emitter -------------------------- */

  const subscribers = new Set();

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function emit(changeSet) {
    for (const fn of subscribers) {
      try { fn(changeSet); }
      catch (err) { console.error('[chippy] subscriber error:', err); }
    }
  }

  /* ------------------------------ helpers ------------------------------ */

  const CLOSED_TASK = new Set(['resolvedtask', 'obsoletetask', 'resolvedfollowup']);
  const CLOSED_GOAL = new Set(['achievedgoal', 'canceledgoal', 'resolvedgoal']);

  function isTaskEntry(e) {
    return e.tags && (e.tags.includes('task') || e.tags.includes('followup'));
  }
  function isOpenTask(e) {
    return isTaskEntry(e) && !e.tags.some(t => CLOSED_TASK.has(t));
  }
  function isGoalEntry(e) {
    return e.tags && e.tags.includes('goal');
  }
  function isOpenGoal(e) {
    return isGoalEntry(e) && !e.tags.some(t => CLOSED_GOAL.has(t));
  }

  function io() {
    if (!Chippy.io) throw new Error('Chippy.io not loaded — io.js must load before store.js');
    return Chippy.io;
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
    // Open tasks/goals for a given member object (or the active member if omitted).
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

  // Open a folder: hydrate nav/tags/names only. Discussion bodies are NOT read —
  // members start null (lazy) and load on selectMember.
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

  // Lazy-load one discussion the first time it is selected; cache it thereafter.
  async function selectMember(name) {
    if (!state.members.has(name)) state.members.set(name, null);
    if (state.members.get(name) === null) {
      const member = await io().loadDiscussion(state.dirHandle, name);
      state.members.set(name, member);
    }
    state.activeMemberName = name;
    state.activeScreen = 'member';
    emit({ type: 'memberSelected', name });
    return state.members.get(name);
  }

  function setActiveScreen(name) {
    state.activeScreen = name;
    emit({ type: 'screenChanged', name });
  }

  function setTheme(theme) {
    state.nav.theme = theme === 'light' ? 'light' : 'dark';
    emit({ type: 'themeChanged', theme: state.nav.theme });
    // Persistence of the theme into navigation.md is wired in a later step.
  }

  /* ------------------------------ export ------------------------------- */

  Chippy.store = Object.assign(
    { subscribe, openFolder, selectMember, setActiveScreen, setTheme, _state: state },
    selectors
  );
})(typeof globalThis !== 'undefined' ? globalThis : this);
