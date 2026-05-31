// SPDX-License-Identifier: Apache-2.0
//
// Chippy — application bootstrap and screen router.
// Per the target architecture, main.js owns startup and the router; all other
// scripts are flat siblings imported here. They are empty stubs at this stage
// (Step 1 scaffold); their responsibilities are filled in by later steps.

import './format.js';
import './io.js';
import './store.js';
import './ui.js';
import './discussion.js';
import './pages.js';
import './dashboard.js';

// Single source of truth for the version. Used for display and as the cache-bust
// query param on the CSS/JS links in app.html (bump both together on release).
export const VERSION = '3.0.0-dev.1';

const THEME_KEY = 'chippy_theme';

/** Apply a theme ('dark' | 'light') to <html>, swap the toggle icon, persist it. */
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('btnThemeToggle');
  if (btn) {
    btn.textContent = t === 'light' ? '☾' : '☀';
    btn.title = t === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
  try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* private mode: ignore */ }
}

function currentTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch (_) { return 'dark'; }
}

function init() {
  // Version chip in the top chrome.
  const ver = document.getElementById('appVersion');
  if (ver) ver.textContent = 'v' + VERSION;

  // First paint already used [data-theme] from the HTML; sync to stored choice.
  applyTheme(currentTheme());

  const themeBtn = document.getElementById('btnThemeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  }

  // Help + print are placeholders at this stage (wired in later steps).
  const help = document.getElementById('btnHelp');
  if (help) help.addEventListener('click', () => alert('Help — coming in a later step.'));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
