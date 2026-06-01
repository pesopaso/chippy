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
  const recent = []; // discussion names, insertion order, max 10

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showScreen(name) {
    currentScreen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(SCREEN_IDS[name] || (name + 'Screen'));
    if (target) target.classList.add('active');
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
    const discs = store().getDiscussions().filter(d => !d.archived);
    const q = searchQuery.trim().toLowerCase();
    const filtered = q ? discs.filter(d => d.name.toLowerCase().includes(q)) : discs;

    const groups = new Map();
    for (const d of filtered) {
      const key = d.tag || 'Untagged';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }

    const active = store().getActiveMemberName();
    body.replaceChildren();
    for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const items = groups.get(key).slice().sort((a, b) => {
        const fa = a.favorite ? 0 : 1, fb = b.favorite ? 0 : 1;
        return fa !== fb ? fa - fb : a.name.localeCompare(b.name);
      });
      const grp = el('div', 'member-group');
      grp.append(el('div', 'member-group-header', key));
      for (const d of items) {
        const item = el('div', 'member-item' +
          (d.name === active ? ' active' : '') + (d.favorite ? ' favorite' : ''));
        item.append(el('span', 'member-avatar', getInitials(d.name)));
        item.append(el('span', 'member-name', d.name));
        const star = el('span', 'fav-star', d.favorite ? '★' : '☆');
        star.title = 'Toggle favorite';
        star.addEventListener('click', (e) => { e.stopPropagation(); store().toggleFavorite(d.name); });
        item.append(star);
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

  const HIDDEN_TAG = /^(task|followup|goal|opentask|inprogresstask|checktask|onholdtask|purgatorytask|resolvedtask|obsoletetask|resolvedfollowup|achievedgoal|canceledgoal|resolvedgoal|high|medium|low|goal-[a-z0-9]{5}|muted:.*)$/;
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

  function crossScreen(id, title, build) {
    const screen = document.getElementById(id);
    if (!screen) return;
    screen.replaceChildren();
    const header = el('div', 'member-header');
    header.append(el('h1', 'member-title', title));
    screen.append(header);
    const body = el('div', 'cross-body');
    screen.append(makeSearchBar(q => { body.replaceChildren(); build(body, q); }), body);
    build(body, '');
  }

  function entryRow(e, opts) {
    opts = opts || {};
    const row = el('div', 'cross-entry');
    const meta = el('div', 'entry-meta');
    const mn = el('span', 'member-name-label', e._member);
    mn.addEventListener('click', () => store().selectMember(e._member));
    meta.append(mn, el('span', 'entry-time', e.created_at));
    for (const t of (e.tags || [])) if (!HIDDEN_TAG.test(t)) meta.append(el('span', 'tag-chip', t));
    row.append(meta);
    const b = el('div', 'entry-text');
    ui().safeSetHtml(b, ui().renderEntryText(opts.firstLineOnly ? (e.body || '').split('\n')[0] : (e.body || '')));
    row.append(b);
    return row;
  }

  function openComments() {
    crossScreen('allCommentsScreen', 'All Comments', (c, q) => {
      const items = store().applyUnifiedFilter(store().collectEntries(), q)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (!items.length) { c.append(el('div', 'panel-empty', 'No comments.')); return; }
      for (const e of items) c.append(entryRow(e));
    });
  }
  function openTasks() {
    crossScreen('allTasksScreen', 'All Tasks', (c, q) => {
      const items = store().applyUnifiedFilter(store().collectEntries(), q)
        .filter(e => (e.tags || []).some(t => t === 'task' || t === 'followup') && !(e.tags || []).some(t => CLOSED_TASK.includes(t)))
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
      if (!items.length) { c.append(el('div', 'panel-empty', 'No open tasks.')); return; }
      for (const e of items) c.append(entryRow(e, { firstLineOnly: true }));
    });
  }
  function openGoals() {
    crossScreen('allGoalsScreen', 'All Goals', (c, q) => {
      const items = store().applyUnifiedFilter(store().collectEntries(), q)
        .filter(e => (e.tags || []).includes('goal') && !(e.tags || []).some(t => CLOSED_GOAL.includes(t)));
      if (!items.length) { c.append(el('div', 'panel-empty', 'No open goals.')); return; }
      for (const e of items) c.append(entryRow(e, { firstLineOnly: true }));
    });
  }
  function openLinks() {
    crossScreen('allLinksScreen', 'All Links', (c, q) => {
      const seen = new Set(), links = [];
      for (const [name, m] of store()._state.members) {
        if (!m) continue;
        for (const l of store().getLinks(m)) if (!seen.has(l.url)) { seen.add(l.url); links.push(Object.assign({ _member: name }, l)); }
      }
      const ql = q.trim().toLowerCase();
      const shown = ql ? links.filter(l => (l.label + ' ' + l.url).toLowerCase().includes(ql.replace(/^#|^@/, ''))) : links;
      if (!shown.length) { c.append(el('div', 'panel-empty', 'No links.')); return; }
      for (const l of shown) {
        const row = el('div', 'link-item');
        const a = el('a', 'md-link', l.label); a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        row.append(a, el('span', 'member-name-label', l._member));
        c.append(row);
      }
    });
  }
  function openImages() {
    crossScreen('allImagesScreen', 'All Images', (c) => {
      const refs = [];
      const re = /!\[[^\]]*\]\(([^)]+)\)/g;
      for (const [, m] of store()._state.members) {
        if (!m) continue;
        for (const e of (m.entries || [])) { let mm; while ((mm = re.exec(e.body || ''))) refs.push(mm[1]); }
      }
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
    });
  }
  function openNames() {
    crossScreen('allNamesScreen', 'All Names', (c, q) => {
      const ql = q.trim().toLowerCase().replace(/^@/, '');
      const names = store().getAllNames().filter(n => !ql || n.name.toLowerCase().includes(ql));
      if (!names.length) { c.append(el('div', 'panel-empty', 'No names.')); return; }
      for (const n of names) {
        const row = el('details', 'all-names-item');
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
    });
  }

  const CROSS = {
    allComments: openComments, allTasks: openTasks, allGoals: openGoals,
    allLinks: openLinks, allImages: openImages, allNames: openNames
  };

  async function openCrossView(name) {
    if (!CROSS[name]) return;
    await store().ensureAllLoaded();
    CROSS[name]();
    showScreen(name);
  }

  Chippy.pages = { showScreen, getCurrentScreen, renderSidebar, renderRecent, noteRecent, getInitials, openCrossView, init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
