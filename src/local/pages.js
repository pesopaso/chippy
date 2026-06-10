// SPDX-License-Identifier: Apache-2.0
//
// pages.js — screen router + sidebar navigation (classic script → window.Chippy.pages).
// Cross-discussion list views land here in later steps. Reads the store and
// dispatches store actions; builds DOM with createElement/textContent (no raw
// innerHTML — rendered markdown goes through Chippy.ui.safeSetHtml). Loads after store.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  const store = () => Chippy.store;
  const ui = () => Chippy.ui;

  const SCREEN_IDS = { welcome: 'welcomeScreen', member: 'memberScreen' };

  let currentScreen = 'welcome';
  let searchQuery = '';
  let activeTagFilter = null; // null = show all discussions; string = filter sidebar to this disc tag
  // Cross-view disc tag filters (null = show all, string = filter to that disc tag). Ref: R63.
  let allCommentsTagFilter = null;
  let allTasksTagFilter = null;   // shared with Kanban
  let allGoalsTagFilter = null;
  let allImagesTagFilter = null;
  let allLinksTagFilter = null;
  let allNamesTagFilter = null;
  let allTagsTagFilter = null;
  let ro3TagFilter = null;
  const recent = []; // discussion names, insertion order, max 10

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const PRINT_SCREENS = new Set(['member', 'allComments', 'allTasks', 'allGoals', 'allImages', 'allLinks', 'allNames', 'allTags']);

  function showScreen(name) {
    currentScreen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(SCREEN_IDS[name] || (name + 'Screen'));
    if (target) target.classList.add('active');
    const pb = document.getElementById('btnPrintChrome');
    if (pb) pb.classList.toggle('hidden', !PRINT_SCREENS.has(name)); // hidden on kanban/ro3/activity/summary/welcome
  }
  function getCurrentScreen() { return currentScreen; }

  // Avatar initials: multi-word -> first letter of each word (up to 3);
  // single word -> first char + up to two later uppercase letters; underscores
  // count as word separators.
  function getInitials(name) {
    const words = String(name || '').trim().split(/[\s_]+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length > 1) return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
    const w = words[0];
    const ups = (w.slice(1).match(/[A-Z]/g) || []).slice(0, 2).join('');
    return (w[0] + ups).toUpperCase();
  }

  function noteRecent(name) {
    if (!recent.includes(name)) { recent.push(name); if (recent.length > 10) recent.shift(); }
  }

  function renderRecent() {
    const bar = document.getElementById('recentBar');
    if (!bar) return;
    const active = store().getActiveMemberName();
    bar.replaceChildren();
    for (const name of recent) {
      const b = el('button', 'recent-btn' + (name === active ? ' active' : ''), name);
      b.title = name;
      b.addEventListener('click', () => store().selectMember(name));
      bar.appendChild(b);
    }
  }

  function renderSidebar() {
    const body = document.querySelector('#sidebar .sidebar-body');
    if (!body) return;
    // "summary" needs no special-casing anymore: app files live in the
    // .chippy.md namespace and the legacy-index migration drops the polluted
    // nav entry, so a discussion named "summary" is legitimate. (v3.3)
    const discs = store().getDiscussions().filter(d => !d.archived);

    // Auto-reset activeTagFilter if its tag no longer exists in the nav.
    const allTags = store().getDiscussionTags ? store().getDiscussionTags() : [];
    if (activeTagFilter && !allTags.includes(activeTagFilter)) activeTagFilter = null;

    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? discs.filter(d => d.name.toLowerCase().includes(q)) : discs;

    const groups = new Map();
    for (const d of filtered) {
      const key = d.tag || 'Untagged';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    // When a tag filter is active, omit the Untagged group entirely.
    if (activeTagFilter) groups.delete('Untagged');

    const active = store().getActiveMemberName();
    body.replaceChildren();

    // Tag filter buttons row — only when there are tagged discussions.
    if (allTags.length) {
      const filterRow = el('div', 'sidebar-disc-tag-filters');
      filterRow.id = 'sidebarDiscTagFilters';
      body.append(filterRow);
      if (ui() && ui().renderDiscTagFilterButtons) {
        ui().renderDiscTagFilterButtons({
          containerId: 'sidebarDiscTagFilters',
          getFilter: () => activeTagFilter,
          setFilter: (f) => { activeTagFilter = f; },
          onRender: renderSidebar
        });
      }
    }

    // Named-tag groups alphabetically first, Untagged last.
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === 'Untagged') return 1;
      if (b === 'Untagged') return -1;
      return a.localeCompare(b);
    });
    const visibleKeys = activeTagFilter
      ? sortedKeys.filter(k => k === activeTagFilter)
      : sortedKeys;

    for (const key of visibleKeys) {
      const items = (groups.get(key) || []).slice().sort((a, b) => {
        const fa = a.favorite ? 0 : 1, fb = b.favorite ? 0 : 1;
        return fa !== fb ? fa - fb : a.name.localeCompare(b.name);
      });
      const grp = el('div', 'member-group');
      const hdr = el('div', 'member-group-header', key);
      if (key !== 'Untagged' && ui() && ui().getDiscTagColor) {
        const color = ui().getDiscTagColor(key, allTags);
        hdr.style.borderLeft = '3px solid ' + color;
        hdr.style.paddingLeft = '6px';
        hdr.style.color = color;
      }
      grp.append(hdr);
      for (const d of items) {
        const item = el('div', 'member-item' +
          (d.name === active ? ' active' : '') + (d.favorite ? ' favorite' : ''));
        item.append(el('span', 'member-avatar', getInitials(d.name)));
        item.append(el('span', 'member-name', d.name));
        const star = el('span', 'fav-star', d.favorite ? '★' : '☆');
        star.title = 'Toggle favorite';
        star.addEventListener('click', (e) => { e.stopPropagation(); store().toggleFavorite(d.name); });
        item.append(star);
        const m = store().getMember(d.name);
        if (m && m.entries) item.append(el('span', 'member-count-badge', String(m.entries.length)));
        item.addEventListener('click', () => store().selectMember(d.name));
        grp.append(item);
      }
      body.append(grp);
    }
  }

  function init() {
    const search = document.getElementById('sidebarSearch');
    const clear = document.getElementById('sidebarSearchClear');
    if (search) {
      search.addEventListener('input', () => {
        searchQuery = search.value;
        if (clear) clear.classList.toggle('hidden', !search.value);
        search.classList.toggle('filter-active', !!search.value);
        renderSidebar();
      });
    }
    if (clear) {
      clear.addEventListener('click', () => {
        search.value = ''; searchQuery = '';
        clear.classList.add('hidden');
        search.classList.remove('filter-active');
        renderSidebar(); search.focus();
      });
    }
    document.querySelectorAll('.nav-btn[data-screen]').forEach(b =>
      b.addEventListener('click', () => openCrossView(b.dataset.screen)));
  }

  /* ---------------------- cross-discussion views ----------------------- */

  const HIDDEN_TAG = Chippy.tags.RESERVED; // taxonomy.js — single source of truth
  const CLOSED_TASK = ['resolvedtask', 'obsoletetask', 'resolvedfollowup'];
  const CLOSED_GOAL = ['achievedgoal', 'canceledgoal', 'resolvedgoal'];

  function makeSearchBar(onChange) {
    const wrap = el('div', 'list-search-wrap');
    const inp = el('input', 'list-search');
    inp.type = 'text';
    inp.placeholder = 'Search... use #tag or @name to filter';
    const clr = el('button', 'search-clear hidden', '×');
    inp.addEventListener('input', () => {
      clr.classList.toggle('hidden', !inp.value);
      inp.classList.toggle('filter-active', !!inp.value);
      onChange(inp.value);
    });
    clr.addEventListener('click', () => {
      inp.value = ''; clr.classList.add('hidden'); inp.classList.remove('filter-active');
      onChange(''); inp.focus();
    });
    wrap.append(inp, clr);
    return wrap;
  }

  function crossScreen(id, title, build, count, preSearch) {
    const screen = document.getElementById(id);
    if (!screen) return;
    screen.replaceChildren();
    const header = el('div', 'member-header');
    header.append(el('h1', 'member-title', title));
    if (count != null) header.append(el('span', 'member-count', count + (count === 1 ? ' comment' : ' comments')));
    screen.append(header);
    if (preSearch) preSearch(screen);
    const body = el('div', 'cross-body');
    screen.append(makeSearchBar(q => { body.replaceChildren(); build(body, q); }), body);
    build(body, '');
  }

  // Helper: append a disc-tag filter-buttons row to a cross-view screen.
  function addCrossDiscFilter(screen, containerId, getFilter, setFilter, onRender) {
    const wrap = el('div', 'cross-disc-tag-filters');
    wrap.id = containerId;
    screen.append(wrap);
    if (ui().renderDiscTagFilterButtons) {
      ui().renderDiscTagFilterButtons({ containerId, getFilter, setFilter, onRender });
    }
  }

  // Every cross-view row is the shared, fully-interactive comment card.
  function entryRow(e, extra) {
    return ui().entryCard(e, Object.assign({ member: e._member, showMember: true, idx: e._idx }, extra || {}));
  }

  // All Comments / All Tasks are overview pages: drop edit/move/delete and keep
  // the action/mute controls on the right.
  const OVERVIEW_OPTS = { hideEdit: true, hideMove: true, hideDelete: true, controlsRight: true };
  // All Goals: same trimming, plus the achieve (✓) / cancel (✕) controls.
  const GOAL_OVERVIEW_OPTS = { hideEdit: true, hideMove: true, hideDelete: true, controlsRight: true, goalControls: true };

  function openComments() {
    // Counter = the sum of every discussion's comments (all loaded entries).
    const total = store().collectEntries().length;
    crossScreen('allCommentsScreen', 'All Comments', (c, q) => {
      const items = store().applyUnifiedFilter(store().collectEntries({ discTag: allCommentsTagFilter }), q)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (!items.length) { c.append(el('div', 'panel-empty', 'No comments.')); return; }
      for (const e of items) c.append(entryRow(e, OVERVIEW_OPTS));
    }, total, (screen) => addCrossDiscFilter(screen, 'allCommentsFilters',
      () => allCommentsTagFilter, v => { allCommentsTagFilter = v; }, openComments));
  }
  function openTasks() {
    crossScreen('allTasksScreen', 'All Tasks', (c, q) => {
      const items = store().applyUnifiedFilter(store().collectEntries({ discTag: allTasksTagFilter }), q)
        .filter(e => (e.tags || []).some(t => t === 'task' || t === 'followup') && !(e.tags || []).some(t => CLOSED_TASK.includes(t)))
        .sort((a, b) => {
          const ma = store().isMuted(a) ? 1 : 0, mb = store().isMuted(b) ? 1 : 0;
          if (ma !== mb) return ma - mb;                                // muted go to the bottom
          return (b.created_at || '').localeCompare(a.created_at || ''); // else newest first
        });
      if (!items.length) { c.append(el('div', 'panel-empty', 'No open tasks.')); return; }
      for (const e of items) c.append(entryRow(e, Object.assign({}, OVERVIEW_OPTS, { dim: store().isMuted(e) })));
    }, undefined, (screen) => addCrossDiscFilter(screen, 'allTasksFilters',
      () => allTasksTagFilter, v => { allTasksTagFilter = v; }, openTasks));
  }
  function openGoals() {
    crossScreen('allGoalsScreen', 'All Goals', (c, q) => {
      const items = store().applyUnifiedFilter(store().collectEntries({ discTag: allGoalsTagFilter }), q)
        .filter(e => (e.tags || []).includes('goal') && !(e.tags || []).some(t => CLOSED_GOAL.includes(t)))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')); // newest first
      if (!items.length) { c.append(el('div', 'panel-empty', 'No open goals.')); return; }
      for (const e of items) c.append(entryRow(e, GOAL_OVERVIEW_OPTS));
    }, undefined, (screen) => addCrossDiscFilter(screen, 'allGoalsFilters',
      () => allGoalsTagFilter, v => { allGoalsTagFilter = v; }, openGoals));
  }
  function openLinks() {
    crossScreen('allLinksScreen', 'All Links', (c, q) => {
      const seen = new Set(), links = [];
      for (const [name, m] of store()._state.members) {
        if (!m) continue;
        if (allLinksTagFilter) {
          const disc = (store().getDiscussions() || []).find(d => d.name === name);
          if (!disc || disc.tag !== allLinksTagFilter) continue;
        }
        for (const l of store().getLinks(m)) if (!seen.has(l.url)) { seen.add(l.url); links.push(Object.assign({ _member: name }, l)); }
      }
      links.sort((a, b) => (b.date || '').localeCompare(a.date || '')); // newest first
      const ql = q.trim().toLowerCase();
      const shown = ql ? links.filter(l => (l.label + ' ' + l.url).toLowerCase().includes(ql.replace(/^#|^@/, ''))) : links;
      if (!shown.length) { c.append(el('div', 'panel-empty', 'No links.')); return; }
      for (const l of shown) {
        const row = el('div', 'link-item');
        const a = el('a', 'md-link', l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        row.append(a, el('span', 'member-name-label', l._member));
        c.append(row);
      }
    }, undefined, (screen) => addCrossDiscFilter(screen, 'allLinksFilters',
      () => allLinksTagFilter, v => { allLinksTagFilter = v; }, openLinks));
  }
  function openImages() {
    crossScreen('allImagesScreen', 'All Images', (c) => {
      const withDate = [];
      const re = /!\[[^\]]*\]\(([^)]+)\)/g;
      for (const e of store().collectEntries({ discTag: allImagesTagFilter })) {
        let mm; while ((mm = re.exec(e.body || ''))) withDate.push({ ref: mm[1], date: e.created_at || '' });
      }
      withDate.sort((a, b) => (b.date || '').localeCompare(a.date || '')); // newest first
      const refs = withDate.map(x => x.ref);
      if (!refs.length) { c.append(el('div', 'panel-empty', 'No images.')); return; }
      const grid = el('div', 'gallery-grid');
      refs.forEach((ref, idx) => {
        const thumb = el('img', 'gallery-thumb');
        store().getImageUrl(ref).then(u => { if (u) thumb.src = u; }).catch(() => {});
        thumb.addEventListener('click', async () => {
          const all = await Promise.all(refs.map(r => store().getImageUrl(r).catch(() => null)));
          ui().showImageOverlay(all.filter(Boolean), idx);
        });
        grid.append(thumb);
      });
      c.append(grid);
    }, undefined, (screen) => addCrossDiscFilter(screen, 'allImagesFilters',
      () => allImagesTagFilter, v => { allImagesTagFilter = v; }, openImages));
  }
  function openNames() {
    crossScreen('allNamesScreen', 'All Names', (c, q) => {
      const ql = q.trim().toLowerCase().replace(/^@/, '');
      const names = store().getAllNames(allNamesTagFilter).filter(n => !ql || n.name.toLowerCase().includes(ql));
      if (!names.length) { c.append(el('div', 'panel-empty', 'No names.')); return; }
      for (const n of names) {
        const row = el('details', 'all-names-item name-row');
        const sum = el('summary', 'all-names-summary');
        sum.append(el('span', 'member-name-label', n.name));
        sum.append(el('span', 'name-count', n.count + ' mentions'));
        if (n.lastSeen) sum.append(el('span', 'entry-time', 'last ' + n.lastSeen.slice(0, 10)));
        sum.append(el('span', 'name-discs', n.discussions.slice(0, 4).join(', ') + (n.discussions.length > 4 ? ' +' + (n.discussions.length - 4) : '')));
        row.append(sum);
        for (const ex of n.excerpts) {
          const exr = el('div', 'name-excerpt');
          exr.append(el('span', 'entry-time', (ex.date || '').slice(0, 16) + ' · ' + ex.discussion + ' · '));
          const b = el('span'); ui().safeSetHtml(b, ui().renderEntryText((ex.body || '').split('\n')[0]));
          exr.append(b);
          row.append(exr);
        }
        c.append(row);
      }
    }, undefined, (screen) => addCrossDiscFilter(screen, 'allNamesFilters',
      () => allNamesTagFilter, v => { allNamesTagFilter = v; }, openNames));
  }

  function openTags() {
    crossScreen('allTagsScreen', 'All Tags', (c, q) => {
      const ql = q.trim().toLowerCase().replace(/^#/, '');
      const tags = store().getAllTags(allTagsTagFilter).filter(t => !ql || t.tag.toLowerCase().includes(ql));
      if (!tags.length) { c.append(el('div', 'panel-empty', 'No tags.')); return; }
      for (const t of tags) {
        const row = el('div', 'all-tags-item tag-row');
        row.append(el('span', 'tag-chip', t.tag));
        row.append(el('span', 'name-count', t.count + (t.count === 1 ? ' use' : ' uses')));
        if (t.lastUsed) row.append(el('span', 'entry-time', 'last ' + t.lastUsed.slice(0, 10)));
        c.append(row);
      }
    }, undefined, (screen) => addCrossDiscFilter(screen, 'allTagsFilters',
      () => allTagsTagFilter, v => { allTagsTagFilter = v; }, openTags));
  }

  /* ------------------------------ kanban ------------------------------- */

  const KANBAN_COLS = [['open', 'OPEN'], ['inprogress', 'WIP'], ['check', 'CHK'],
                       ['onhold', 'HOLD'], ['purgatory', 'PRGT'], ['resolved', 'DONE']];
  const PRIO_LABEL = Chippy.tags.PRIO_LABEL; // taxonomy.js
  let kanbanFocus = false; // when on, hide the HOLD and PRGT columns

  // Tag taxonomy lives in taxonomy.js (Chippy.tags); aliased here for brevity.
  const stateKeyOf = Chippy.tags.stateKeyOf;
  const prioOf = (tags) => Chippy.tags.priorityOf(tags) || 'low'; // pages defaults to 'low'

  // The card currently being dragged. Relying on this instead of dataTransfer
  // makes drops reliable on file:// (where getData can come back empty) and
  // immune to the drag starting on a child node (e.g. an image in the card).
  let kanbanDrag = null;

  function kanbanCard(e) {
    const card = el('div', 'kanban-card' + (e.tags.includes('followup') ? ' followup' : '') + (store().isMuted(e) ? ' muted' : ''));
    card.draggable = true;
    const ref = { m: e._member, id: e.created_at, idx: e._idx };
    card.addEventListener('dragstart', ev => {
      kanbanDrag = ref;
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', JSON.stringify(ref)); } catch (_) {}
    });
    card.addEventListener('dragend', () => { kanbanDrag = null; });
    const meta = el('div', 'kanban-card-meta');
    const p = prioOf(e.tags);
    meta.append(el('span', 'prio-square prio-' + p, PRIO_LABEL[p]));
    const who = el('span', 'member-name-label', e._member); who.title = 'Open this discussion';
    who.addEventListener('mousedown', ev => ev.stopPropagation());
    who.addEventListener('click', ev => { ev.stopPropagation(); store().selectMember(e._member); });
    meta.append(who);
    if (/!\[[^\]]*\]\(/.test(e.body || '')) meta.append(el('span', 'cam-icon', '📷'));
    // Action + mute, pushed to the right (don't let them start a drag).
    meta.append(el('span', 'meta-spacer'));
    const stop = (el2) => { el2.draggable = false; el2.addEventListener('mousedown', ev => ev.stopPropagation()); };
    const act = el('span', 'icon-btn act', '⚡'); act.title = 'Add action'; stop(act);
    act.addEventListener('click', (ev) => { ev.stopPropagation();
      ui().showActionModal('Add action', (text) => store().appendAction(e._member, e.created_at, text, e._idx)); });
    const mute = el('span', 'icon-btn', store().isMuted(e) ? '🔈' : '🔇'); mute.title = 'Mute / unmute'; stop(mute);
    mute.addEventListener('click', (ev) => { ev.stopPropagation(); store().toggleMute(e._member, e.created_at, e._idx); });
    meta.append(act, mute);
    card.append(meta);
    const txt = el('div', 'kanban-card-text clamp');
    ui().safeSetHtml(txt, ui().renderEntryText(e.body || ''));
    txt.querySelectorAll('img').forEach(i => { i.draggable = false; });
    const moreTxt = /\n/.test(e.body || '') || (e.body || '').length > 60;
    if (moreTxt) {
      txt.classList.add('expandable');
      txt.addEventListener('mousedown', ev => ev.stopPropagation()); // don't start a drag
      txt.addEventListener('click', (ev) => {
        if (ev.target.closest('a, img, .name-chip')) return;
        txt.classList.toggle('clamp');
      });
    }
    card.append(txt);
    return card;
  }

  function openKanban() {
    const screen = document.getElementById('kanbanScreen');
    if (!screen) return;
    screen.replaceChildren();
    const header = el('div', 'member-header'); header.append(el('h1', 'member-title', 'Kanban'));
    const focusBtn = el('button', 'btn-sm kanban-focus-btn' + (kanbanFocus ? ' active' : ''), '◎ Focus');
    focusBtn.title = 'Focus: hide the HOLD and PRGT columns';
    focusBtn.addEventListener('click', () => { kanbanFocus = !kanbanFocus; openKanban(); });
    header.append(focusBtn);
    screen.append(header);
    addCrossDiscFilter(screen, 'kanbanFilters',
      () => allTasksTagFilter, v => { allTasksTagFilter = v; }, openKanban);
    const board = el('div', 'kanban-board');
    const tasks = store().collectEntries({ discTag: allTasksTagFilter }).filter(e => {
      const t = e.tags || [];
      return (t.includes('task') || t.includes('followup')) && !t.includes('obsoletetask');
    });
    const rank = e => ({ high: 0, medium: 1, low: 2 })[prioOf(e.tags)] ?? 3;
    const cols = kanbanFocus ? KANBAN_COLS.filter(([k]) => k !== 'onhold' && k !== 'purgatory') : KANBAN_COLS;
    for (const [key, label] of cols) {
      const col = el('div', 'kanban-col');
      col.append(el('div', 'kanban-col-header', label));
      let colTasks = tasks.filter(e => stateKeyOf(e.tags) === key);
      if (key === 'resolved') colTasks = colTasks.filter(e => store().doneRecent(e, 2));
      colTasks.sort((a, b) => {
        const ma = store().isMuted(a) ? 1 : 0, mb = store().isMuted(b) ? 1 : 0;
        return ma !== mb ? ma - mb : rank(a) - rank(b);
      });
      for (const e of colTasks) col.append(kanbanCard(e));
      col.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; col.classList.add('drag-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async ev => {
        ev.preventDefault(); col.classList.remove('drag-over');
        let ref = kanbanDrag;
        if (!ref) { try { ref = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch (_) {} }
        kanbanDrag = null;
        if (!ref || !ref.id) return;
        try {
          await store().setTaskState(ref.m, ref.id, key, ref.idx);
          openKanban();
        } catch (_) {}
      });
      board.append(col);
    }
    screen.append(board);
  }

  /* ----------------------------- Rule of Three ------------------------- */

  let ro3Pick = null; // session-persistent selection

  // Re-resolve a picked entry to the live store entry, so a card reflects the
  // current state after a mutation (the pick is a shallow copy whose tags array
  // goes stale when setTaskState reassigns the original's tags).
  function liveEntry(p) {
    const m = store().getMember && store().getMember(p._member);
    const entries = (m && m.entries) || [];
    let live = (typeof p._idx === 'number' && entries[p._idx] && entries[p._idx].created_at === p.created_at)
      ? entries[p._idx]
      : entries.find(x => x.created_at === p.created_at);
    return live ? Object.assign({ _member: p._member, _idx: entries.indexOf(live) }, live) : p;
  }

  function ro3Card(e) {
    // No outer wrapper — the unified comment box is the whole card (avoids a double box).
    // Ro3 is a focus view: just state/priority and the action/mute controls (right-aligned).
    return ui().entryCard(e, { member: e._member, showMember: true, idx: e._idx,
      hideEdit: true, hideMove: true, hideDelete: true, controlsRight: true });
  }

  const ro3Key = p => p._member + '|' + p.created_at;

  // Keep the current picks, but drop any that have been muted and backfill from
  // the candidate pool (open/non-closed/non-muted) up to 3. Resolved/obsolete
  // picks are kept so their final state stays visible until the next refresh.
  function reconcileRo3() {
    const picks = (ro3Pick || []).map(liveEntry);
    const kept = picks.filter(p => !store().isMuted(p));
    const keys = new Set(kept.map(ro3Key));
    if (kept.length < 3) {
      const pool = store().getRo3Candidates(ro3TagFilter).filter(c => !keys.has(ro3Key(c)));
      for (const f of store().pickRo3(pool)) {
        if (kept.length >= 3) break;
        if (!keys.has(ro3Key(f))) { kept.push(f); keys.add(ro3Key(f)); }
      }
    }
    ro3Pick = kept;
  }

  function openRo3() {
    const screen = document.getElementById('ro3Screen');
    if (!screen) return;
    screen.replaceChildren();
    const header = el('div', 'member-header');
    header.append(el('h1', 'member-title', 'Rule of Three'));
    header.append(el('div', 'meta-spacer'));
    const refresh = el('button', 'btn-sm', '↻ Refresh');
    refresh.addEventListener('click', () => { ro3Pick = store().pickRo3(store().getRo3Candidates(ro3TagFilter)); openRo3(); });
    header.append(refresh);
    screen.append(header);
    addCrossDiscFilter(screen, 'ro3Filters',
      () => ro3TagFilter, v => { ro3TagFilter = v; ro3Pick = null; }, openRo3);
    reconcileRo3(); // drop muted picks, backfill to 3
    const cont = el('div', 'ro3-cards');
    if (!ro3Pick.length) cont.append(el('div', 'panel-empty', 'No open tasks.'));
    else for (const e of ro3Pick) cont.append(ro3Card(liveEntry(e)));
    screen.append(cont);
  }

  function openActivity() {
    const screen = document.getElementById('activityScreen');
    if (!screen) return;
    screen.replaceChildren();
    const header = el('div', 'member-header'); header.append(el('h1', 'member-title', 'Activity'));
    screen.append(header);
    const body = el('div', 'dashboard-body'); screen.append(body);
    if (Chippy.dashboard) Chippy.dashboard.render(body);
  }

  /* ----------------------------- AI Summary ---------------------------- */

  function inRange(dateStr, range) {
    const d = new Date(String(dateStr).replace(' ', 'T'));
    if (isNaN(d)) return false;
    const days = { day: 1, week: 7, month: 30 }[range] || 7;
    const cut = new Date(); cut.setDate(cut.getDate() - days);
    return d >= cut;
  }
  function buildPrompt(entries) {
    const byDisc = new Map();
    for (const e of entries) {
      if (!byDisc.has(e._member)) byDisc.set(e._member, []);
      byDisc.get(e._member).push((e.created_at || '') + ' — ' + (e.body || '').split('\n')[0]);
    }
    let p = 'Summarize the following notebook activity. Return an OVERALL block, then for each ' +
      'discussion a "DISCUSSION: <name>" line followed by "SUMMARY:" and "ACTIVITY:" blocks.\n\n';
    for (const [name, lines] of byDisc) p += 'DISCUSSION: ' + name + '\n' + lines.join('\n') + '\n\n';
    return p;
  }

  async function openSummary() {
    const screen = document.getElementById('summaryScreen');
    if (!screen) return;
    screen.replaceChildren();
    screen.append((() => { const h = el('div', 'member-header'); h.append(el('h1', 'member-title', 'AI Summary')); return h; })());

    const cfg = await store().loadSummary();
    const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const cfgRow = el('div', 'summary-config');
    const url = el('input', 'summary-input'); url.type = 'text'; url.placeholder = 'http://localhost:11434/v1/chat/completions';
    url.value = cfg.api_url || lsGet('chippy_api_url') || '';
    const model = el('input', 'summary-input'); model.type = 'text'; model.placeholder = 'llama3';
    model.value = cfg.api_model || lsGet('chippy_api_model') || '';
    cfgRow.append(url, model); screen.append(cfgRow);

    const ctrl = el('div', 'summary-ctrl'); let range = 'week';
    for (const r of ['day', 'week', 'month']) {
      const b = el('button', 'btn-sm' + (r === range ? ' active' : ''), 'This ' + r);
      b.addEventListener('click', () => { range = r; ctrl.querySelectorAll('.btn-sm').forEach(x => x.classList.remove('active')); b.classList.add('active'); });
      ctrl.append(b);
    }
    const gen = el('button', 'btn-primary', 'Generate'); ctrl.append(gen);
    screen.append(ctrl);
    const out = el('div', 'summary-output entry-text'); screen.append(out);

    const list = el('div', 'summary-list');
    for (const c of (cfg.summaries || [])) {
      const synthetic = { created_at: c.created_at, tags: [], body: c.body };
      const card = ui().entryCard(synthetic, {
        onEdit: (text) => store().updateSummary(c.id, text),
        onMove: (target) => store().moveSummaryToDiscussion(c.id, target),
        onDelete: () => store().deleteSummary(c.id)
      });
      const box = el('div', 'summary-card');
      box.append(el('div', 'summary-meta', (c.range || '') + ' · ' + (c.created_at || '') + (c.model ? ' · ' + c.model : '')));
      box.append(card);
      list.append(box);
    }
    screen.append(list);

    gen.addEventListener('click', async () => {
      try { localStorage.setItem('chippy_api_url', url.value); localStorage.setItem('chippy_api_model', model.value); } catch (_) {}
      await store().saveSummaryConfig(url.value, model.value);
      gen.disabled = true; gen.textContent = 'Generating…'; out.textContent = '';
      try {
        const entries = store().collectEntries().filter(e => inRange(e.created_at, range));
        const res = await fetch(url.value, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.value, messages: [{ role: 'user', content: buildPrompt(entries) }], stream: false })
        });
        const data = await res.json();
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || JSON.stringify(data);
        ui().safeSetHtml(out, ui().renderEntryText(content));
        await store().appendSummary({
          created_at: store().nowISO(), range, id: store().shortId(),
          model: model.value || null, tokens: (data.usage && data.usage.total_tokens) || null, body: content
        });
        openSummary();
      } catch (err) {
        out.textContent = 'Error: ' + (err && err.message || err);
      } finally { gen.disabled = false; gen.textContent = 'Generate'; }
    });
  }

  const CROSS = {
    allComments: openComments, allTasks: openTasks, allGoals: openGoals,
    allLinks: openLinks, allImages: openImages, allNames: openNames, allTags: openTags,
    kanban: openKanban, ro3: openRo3, activity: openActivity, summary: openSummary
  };

  // Reset maps for disc tag filters so each page starts at "All" on fresh navigation.
  const DISC_FILTER_RESET = {
    allComments: () => { allCommentsTagFilter = null; },
    allTasks:    () => { allTasksTagFilter = null; },
    allGoals:    () => { allGoalsTagFilter = null; },
    allImages:   () => { allImagesTagFilter = null; },
    allLinks:    () => { allLinksTagFilter = null; },
    allNames:    () => { allNamesTagFilter = null; },
    allTags:     () => { allTagsTagFilter = null; },
    kanban:      () => { allTasksTagFilter = null; },
    ro3:         () => { ro3TagFilter = null; },
  };

  async function openCrossView(name) {
    if (!CROSS[name]) return;
    if (DISC_FILTER_RESET[name]) DISC_FILTER_RESET[name]();
    const failed = await store().ensureAllLoaded();
    if (failed && failed.length && ui() && ui().showToast) {
      const names = failed.map(f => f.name).join(', ');
      const plural = failed.length === 1 ? 'discussion' : 'discussions';
      ui().showToast('Couldn’t load ' + failed.length + ' ' + plural + ': ' + names +
        '. Check the file exists in the data folder (or, if it’s on OneDrive/SharePoint, that it’s downloaded).', 'error');
    }
    CROSS[name]();
    showScreen(name);
    // Slim mode: cross-views are single-column — show them on the Discussion tab.
    if (document.body.classList.contains('slim') && Chippy.setSlimTab) Chippy.setSlimTab('mid');
  }

  // Re-render whatever screen is active (after a card mutation).
  function refresh() {
    if (currentScreen === 'member') {
      if (Chippy.discussion) Chippy.discussion.render(store().getActiveMember());
    } else if (CROSS[currentScreen]) {
      CROSS[currentScreen]();
    }
  }

  Chippy.pages = { showScreen, getCurrentScreen, renderSidebar, renderRecent, noteRecent, getInitials, openCrossView, refresh, init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
