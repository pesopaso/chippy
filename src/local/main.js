// SPDX-License-Identifier: Apache-2.0
//
// main.js — application bootstrap and screen router (classic script).
// Loads LAST, after format/io/store/ui/discussion/pages/dashboard have populated
// window.Chippy. No import/export, so the whole app runs from a file:// origin.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  // Single source of truth for the version. Used for display and as the cache-bust
  // query param on the CSS/JS tags in app.html (bump both together on release).
  const VERSION = '3.0.0-dev.14';
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
    if (help) help.addEventListener('click', () => alert('Help — coming in a later step.'));

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
