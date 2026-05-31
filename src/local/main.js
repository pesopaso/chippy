// SPDX-License-Identifier: Apache-2.0
//
// main.js — application bootstrap and screen router (classic script).
// Loads LAST, after format/io/store/ui/discussion/pages/dashboard have populated
// window.Chippy. No import/export, so the whole app runs from a file:// origin.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  // Single source of truth for the version. Used for display and as the cache-bust
  // query param on the CSS/JS tags in app.html (bump both together on release).
  const VERSION = '3.0.0-dev.3';
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

    // Open Folder — minimal wiring against Chippy.io so the data folder can be
    // connected and verified now. Full store/sidebar wiring lands in later steps.
    const openBtn = document.getElementById('btnOpenFolder');
    const status = document.getElementById('folderStatus');
    const io = Chippy.io;
    if (openBtn && io) {
      openBtn.addEventListener('click', async () => {
        try {
          const dir = await io.openFolder();
          const { nav, tags, names } = await io.loadIndexes(dir);
          const discussions = await io.listDiscussions(dir);
          Chippy.dir = dir; // stash the handle for later steps
          if (status) {
            status.textContent =
              `Connected: ${discussions.length} discussions · ${tags.length} tags · ` +
              `${names.length} names · theme ${nav.theme}`;
            status.className = 'folder-status connected';
          }
        } catch (err) {
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
