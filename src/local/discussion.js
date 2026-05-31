// SPDX-License-Identifier: Apache-2.0
//
// discussion.js — the per-discussion authoring screen (classic → window.Chippy.discussion).
// Step 6 skeleton: member header (title, favorite, reload), preparation area
// (rendered markdown <-> edit), an entry-input placeholder (pipeline in Step 7),
// and the day-grouped history. Rendered markdown goes through Chippy.ui.safeSetHtml.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  const store = () => Chippy.store;
  const ui = () => Chippy.ui;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function isFavorite(name) {
    const d = store().getDiscussions().find(x => x.name === name);
    return !!(d && d.favorite);
  }

  function renderPrep(member) {
    const wrap = el('div', 'prep-section');
    const bar = el('div', 'prep-bar');
    bar.append(el('span', 'section-label', 'Preparation'));
    const editBtn = el('span', 'prep-edit-btn', '✎');
    editBtn.title = 'Edit preparation';
    bar.append(editBtn);
    wrap.append(bar);

    const view = el('div', 'prep-view');
    function renderView() {
      if (member.prep) {
        ui().safeSetHtml(view, ui().renderEntryText(member.prep));
      } else {
        view.replaceChildren(el('span', 'prep-empty', 'No preparation notes yet.'));
      }
    }
    renderView();
    wrap.append(view);

    let editing = false;
    editBtn.addEventListener('click', () => {
      if (editing) return;
      editing = true;
      const ta = el('textarea', 'prep-edit');
      ta.value = member.prep || '';
      wrap.replaceChild(ta, view);
      ta.focus();

      let finished = false;
      async function done(save) {
        if (finished) return;
        finished = true;
        if (save) {
          const text = ta.value.trim();
          member.prep = text;
          await store().setPrep(member.name, text);
        }
        renderView();
        if (ta.parentNode === wrap) wrap.replaceChild(view, ta);
        editing = false;
      }
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); }
        else if (e.key === 'Escape') { e.preventDefault(); done(false); }
      });
      ta.addEventListener('blur', () => done(true));
    });

    return wrap;
  }

  function renderHistory(member) {
    const wrap = el('div', 'history-list');
    const entries = member.entries || [];
    if (!entries.length) { wrap.append(el('div', 'history-empty', 'No entries yet.')); return wrap; }
    let lastDay = null, dayGroup = null;
    for (const e of entries) {
      const day = (e.created_at || '').slice(0, 10);
      if (day !== lastDay) {
        dayGroup = el('div', 'day-group');
        dayGroup.append(el('div', 'day-label', day));
        wrap.append(dayGroup);
        lastDay = day;
      }
      const div = el('div', 'history-entry');
      div.append(el('div', 'entry-time', e.created_at));
      const bodyEl = el('div', 'entry-text');
      ui().safeSetHtml(bodyEl, ui().renderEntryText(e.body || ''));
      div.append(bodyEl);
      dayGroup.append(div);
    }
    return wrap;
  }

  function render(member) {
    const screen = document.getElementById('memberScreen');
    if (!screen || !member) return;
    screen.replaceChildren();

    // Header
    const header = el('div', 'member-header');
    header.append(el('h1', 'member-title', member.name));
    const actions = el('div', 'member-header-actions');
    const star = el('span', 'favorite-btn' + (isFavorite(member.name) ? ' on' : ''),
      isFavorite(member.name) ? '★' : '☆');
    star.title = 'Toggle favorite';
    star.addEventListener('click', () => store().toggleFavorite(member.name));
    const reload = el('span', 'reload-btn', '↻');
    reload.title = 'Reload from disk';
    reload.addEventListener('click', () => store().reloadMember(member.name));
    actions.append(star, reload);
    header.append(actions);
    screen.append(header);

    // Split view
    const split = el('div', 'split-view');
    const left = el('div', 'split-left');
    const right = el('div', 'split-right');

    left.append(renderPrep(member));

    // Entry-input placeholder (full write pipeline in Step 7).
    const entryBox = el('div', 'entry-box');
    const ta = el('textarea', 'entry-input');
    ta.id = 'entryInput';
    ta.placeholder = 'Write a note…  (entry pipeline arrives in Step 7)';
    entryBox.append(ta);
    left.append(entryBox);

    left.append(renderHistory(member));

    right.append(el('div', 'panel-placeholder', 'Tasks, goals, links & gallery — Steps 8–10.'));

    split.append(left, right);
    screen.append(split);

    // Auto-focus the entry input on select (R1).
    setTimeout(() => ta.focus(), 0);
  }

  Chippy.discussion = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
