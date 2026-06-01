// SPDX-License-Identifier: Apache-2.0
//
// main.js — application bootstrap and screen router (classic script).
// Loads LAST, after format/io/store/ui/discussion/pages/dashboard have populated
// window.Chippy. No import/export, so the whole app runs from a file:// origin.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  // Single source of truth for the version. Used for display and as the cache-bust
  // query param on the CSS/JS tags in app.html (bump both together on release).
  const VERSION = '3.0.0-dev.16';
  Chippy.VERSION = VERSION;

  const THEME_KEY = 'chippy_theme';

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    const btn = document.getElementById('btnThemeToggle');
    if (btn) {
      btn.textContent = t === 'light' ? '☾' : '☀';
      btn.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    }
    try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* private mode */ }
  }

  function currentTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) { return 'dark'; }
  }

  // Remove draft keys whose discussion no longer exists (rename/archive/delete).
  function cleanupOrphanDrafts() {
    const store = Chippy.store;
    if (!store) return;
    try {
      const names = new Set(store.getDiscussions().map(d => d.name));
      const remove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('nb_draft_') && !names.has(k.slice('nb_draft_'.length))) remove.push(k);
      }
      remove.forEach(k => localStorage.removeItem(k));
      if (remove.length) console.log(`[chippy] cleaned ${remove.length} orphaned draft(s)`);
    } catch (_) { /* ignore */ }
  }

  // Help dialog listing the cross-discussion pages and key behaviors (R49).
  function showHelp() {
    const ui = Chippy.ui;
    if (!ui || !ui.showModal) return;
    const mk = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; };
    const PAGES = [
      ['Comments', 'every entry across all discussions'],
      ['Tasks', 'open tasks across all discussions'],
      ['Goals', 'open goals across all discussions'],
      ['Links', 'deduped links from entries + prep (rename inline)'],
      ['Images', 'all images; click for the full-screen carousel'],
      ['Names', '@[Name] references — counts, last-seen, drill-down'],
      ['Kanban', 'drag cards between state columns'],
      ['Ro3', 'three tasks (one per priority); Refresh re-rolls'],
      ['Activity', 'charts: comment inflow, task/goal states, timeline'],
      ['AI Summary', 'generate a summary via a local LLM endpoint']
    ];
    ui.showModal('Chippy — Help', (modal, close) => {
      modal.appendChild(mk('p', 'Cross-discussion pages (sidebar buttons):'));
      const ul = mk('ul'); ul.className = 'help-list';
      for (const [n, d] of PAGES) {
        const li = mk('li'); const b = mk('strong', n + ' — '); li.appendChild(b);
        li.appendChild(document.createTextNode(d)); ul.appendChild(li);
      }
      modal.appendChild(ul);
      modal.appendChild(mk('p', 'Authoring: type #tag to classify, @ to mention a name, ' +
        'paste an image with Ctrl+V. Tasks have a state square (click for the menu), a priority ' +
        'square (click to cycle), due dates, ⚡ actions, mute, and ✓ resolve. Double-click a ' +
        'task/goal to jump to its entry; the ✎ pencil edits an entry inline. "Updated:" is added ' +
        'only when an entry is edited on a later day than it was created.'));
      const row = mk('div'); row.className = 'modal-actions';
      const ok = mk('button', 'Close'); ok.className = 'btn-primary'; ok.addEventListener('click', close);
      row.appendChild(ok); modal.appendChild(row);
    });
  }

  // Slim layout under 800px (R36): stack the columns; the sidebar sits on top.
  function checkSlimMode() {
    document.body.classList.toggle('slim', window.innerWidth < 800);
  }

  function init() {
    const ver = document.getElementById('appVersion');
    if (ver) ver.textContent = 'v' + VERSION;

    applyTheme(currentTheme());

    const themeBtn = document.getElementById('btnThemeToggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
      });
    }

    const help = document.getElementById('btnHelp');
    if (help) help.addEventListener('click', showHelp);

    const printBtn = document.getElementById('btnPrintChrome');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    checkSlimMode();
    window.addEventListener('resize', checkSlimMode);

    const pages = Chippy.pages;
    const store = Chippy.store;
    const status = document.getElementById('folderStatus');

    if (pages) pages.init();

    // Single subscriber: drive the sidebar, recent bar, and active screen from
    // store change events.
    if (store) {
      store.subscribe((cs) => {
        switch (cs.type) {
          case 'folderOpened':
            if (status) {
              status.textContent =
                `Connected: ${store.getDiscussions().length} discussions · ` +
                `${store.getTagUnion().length} tags · ${store.getNames().length} names · ` +
                `theme ${store.getTheme()}`;
              status.className = 'folder-status connected';
            }
            if (pages) { pages.renderSidebar(); pages.showScreen('welcome'); }
            cleanupOrphanDrafts();
            break;
          case 'memberSelected':
            if (pages) { pages.noteRecent(cs.name); pages.renderSidebar(); pages.renderRecent(); }
            if (Chippy.discussion) Chippy.discussion.render(store.getActiveMember());
            if (pages) pages.showScreen('member');
            break;
          case 'memberReloaded':
          case 'entryAdded':
          case 'taskStateChanged':
          case 'priorityChanged':
          case 'dueChanged':
          case 'actionAppended':
          case 'muteToggled':
          case 'goalStateChanged':
          case 'entryEdited':
          case 'entryMoved':
          case 'entryDeleted':
          case 'linkRenamed':
            if (Chippy.discussion) Chippy.discussion.render(store.getActiveMember());
            break;
          case 'favoriteToggled':
            if (pages) pages.renderSidebar();
            break;
        }
      });
    }

    // Open Folder button -> store.openFolder(); errors surface on the status line.
    const openBtn = document.getElementById('btnOpenFolder');
    if (openBtn && store) {
      openBtn.addEventListener('click', async () => {
        try { await store.openFolder(); }
        catch (err) {
          if (err && err.name === 'AbortError') return; // user dismissed picker
          if (status) {
            status.textContent = 'Could not open folder: ' + (err && err.message || err);
            status.className = 'folder-status error';
          }
          console.error('[chippy] openFolder failed:', err);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
