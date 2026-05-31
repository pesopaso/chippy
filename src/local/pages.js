// SPDX-License-Identifier: Apache-2.0
//
// pages.js — screen router + sidebar navigation (classic script → window.Chippy.pages).
// Cross-discussion list views land here in later steps. Reads the store and
// dispatches store actions; builds DOM with createElement/textContent (no raw
// innerHTML — rendered markdown goes through Chippy.ui.safeSetHtml). Loads after store.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  const store = () => Chippy.store;

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
  }

  Chippy.pages = { showScreen, getCurrentScreen, renderSidebar, renderRecent, noteRecent, getInitials, init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
