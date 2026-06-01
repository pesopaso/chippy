// SPDX-License-Identifier: Apache-2.0
//
// discussion.js — the per-discussion authoring screen (classic → window.Chippy.discussion).
// Member header, preparation area, the entry-input write pipeline UI (tag chips,
// #/@ autocomplete, goal-link, due date, draft autosave), and the day-grouped
// history with reserved-tag markers. Rendered markdown goes through Chippy.ui.safeSetHtml.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  const store = () => Chippy.store;
  const ui = () => Chippy.ui;

  const HIDDEN_TAG = /^(task|followup|goal|opentask|inprogresstask|checktask|onholdtask|purgatorytask|resolvedtask|obsoletetask|resolvedfollowup|achievedgoal|canceledgoal|resolvedgoal|high|medium|low|goal-[a-z0-9]{5}|muted:.*)$/;
  const STATE_LABEL = {
    inprogresstask: 'WIP', checktask: 'CHK', onholdtask: 'HOLD',
    purgatorytask: 'PRGT', resolvedtask: 'DONE', obsoletetask: 'OBSL'
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function isFavorite(name) {
    const d = store().getDiscussions().find(x => x.name === name);
    return !!(d && d.favorite);
  }
  function draftKey(name) { return 'nb_draft_' + name; }

  /* ------------------------------ prep area ---------------------------- */

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
      if (member.prep) ui().safeSetHtml(view, ui().renderEntryText(member.prep));
      else view.replaceChildren(el('span', 'prep-empty', 'No preparation notes yet.'));
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
        if (finished) return; finished = true;
        if (save) { member.prep = ta.value.trim(); await store().setPrep(member.name, member.prep); }
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

  /* ----------------------------- entry input --------------------------- */

  function renderEntryBox(member, onSaved) {
    const box = el('div', 'entry-box');
    const chips = el('div', 'entry-chips');
    const ta = el('textarea', 'entry-input');
    ta.id = 'entryInput';
    ta.placeholder = 'Write a note…  #tag to classify, @ to mention a name';
    const dropdown = el('div', 'ac-dropdown hidden');

    const controls = el('div', 'entry-controls');
    const goalSel = el('select', 'goal-link');
    goalSel.append(new Option('No goal link', ''));
    for (const g of store().getGoals(member)) {
      const id = (g.tags || []).find(t => /^goal-[a-z0-9]{5}$/.test(t));
      if (id) goalSel.append(new Option((g.body || '').split('\n')[0].slice(0, 40), id));
    }
    const due = el('input', 'entry-due'); due.type = 'date'; due.title = 'Due date';
    const saveBtn = el('button', 'btn-primary', 'Save'); saveBtn.id = 'btnSaveEntry';
    controls.append(goalSel, due, saveBtn);

    let selectedTags = [];

    function renderChips() {
      chips.replaceChildren();
      selectedTags.forEach((t, idx) => {
        const c = el('span', 'tag-chip', t);
        const x = el('span', 'tag-chip-x', '×');
        x.addEventListener('click', () => { selectedTags.splice(idx, 1); renderChips(); saveDraft(); });
        c.append(x); chips.append(c);
      });
    }

    // Draft autosave (300ms debounce).
    const saveDraft = debounce(() => {
      try {
        localStorage.setItem(draftKey(member.name),
          JSON.stringify({ text: ta.value, tags: selectedTags, updated_at: store().nowISO() }));
      } catch (_) { /* ignore */ }
    }, 300);
    function clearDraft() { try { localStorage.removeItem(draftKey(member.name)); } catch (_) {} }

    // Restore a draft if present.
    try {
      const raw = localStorage.getItem(draftKey(member.name));
      if (raw) { const d = JSON.parse(raw); ta.value = d.text || ''; selectedTags = d.tags || []; }
    } catch (_) {}

    function hideDropdown() { dropdown.classList.add('hidden'); dropdown.replaceChildren(); }
    function showSuggestions(list, onPick) {
      dropdown.replaceChildren();
      if (!list.length) { hideDropdown(); return; }
      for (const item of list.slice(0, 8)) {
        const row = el('div', 'ac-option', item);
        row.addEventListener('mousedown', (e) => { e.preventDefault(); onPick(item); });
        dropdown.append(row);
      }
      dropdown.classList.remove('hidden');
    }

    // #tag extraction on space + #/@ autocomplete.
    ta.addEventListener('input', () => {
      saveDraft();
      const val = ta.value;
      // Extract a completed "#tag " into a chip.
      const tagMatch = val.match(/(^|\s)#([a-zA-Z0-9][a-zA-Z0-9-]*)\s$/);
      if (tagMatch) {
        const t = tagMatch[2].toLowerCase();
        if (!selectedTags.includes(t)) selectedTags.push(t);
        ta.value = val.slice(0, tagMatch.index) + (tagMatch[1] || '');
        renderChips(); hideDropdown(); saveDraft(); return;
      }
      // Autocomplete on the current token.
      const upto = val.slice(0, ta.selectionStart);
      const tagTok = upto.match(/(?:^|\s)#([a-zA-Z0-9-]*)$/);
      const nameTok = upto.match(/(?:^|\s)@([^\]]*)$/);
      if (tagTok) {
        const q = tagTok[1].toLowerCase();
        showSuggestions(store().getTagUnion().filter(t => t.includes(q) && !HIDDEN_TAG.test(t)),
          (t) => { ta.value = upto.slice(0, upto.length - tagTok[1].length) + t + ' ' + val.slice(ta.selectionStart);
                   if (!selectedTags.includes(t)) selectedTags.push(t);
                   ta.value = ta.value.replace(new RegExp('#' + t + ' '), ''); renderChips(); hideDropdown(); ta.focus(); });
      } else if (nameTok) {
        const q = nameTok[1].toLowerCase();
        showSuggestions(store().getNames().filter(n => n.toLowerCase().includes(q)),
          (n) => { const before = upto.slice(0, upto.length - 1 - nameTok[1].length);
                   ta.value = before + '@[' + n + '] ' + val.slice(ta.selectionStart);
                   hideDropdown(); ta.focus(); saveDraft(); });
      } else hideDropdown();
    });

    async function save() {
      const text = ta.value.trim();
      if (!text && !selectedTags.length) return;
      await store().addEntry(member.name, {
        text, tags: selectedTags.slice(),
        goalLinkId: goalSel.value || null,
        due: due.value || null
      });
      ta.value = ''; selectedTags = []; due.value = ''; goalSel.value = '';
      renderChips(); clearDraft(); hideDropdown();
      if (ui().showToast) ui().showToast('Comment saved', 'success');
      if (onSaved) onSaved();
    }
    saveBtn.addEventListener('click', save);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && dropdown.classList.contains('hidden')) { e.preventDefault(); save(); }
      else if (e.key === 'Escape') hideDropdown();
    });

    renderChips();
    box.append(chips, ta, dropdown, controls);
    return box;
  }

  /* ------------------------------ history ------------------------------ */

  function entryKindClass(tags) {
    if (tags.includes('goal')) return 'entry-goal';
    if (tags.includes('followup')) return 'entry-followup';
    if (tags.includes('task')) return 'entry-task';
    return '';
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
        wrap.append(dayGroup); lastDay = day;
      }
      const tags = e.tags || [];
      const div = el('div', 'history-entry ' + entryKindClass(tags));

      const meta = el('div', 'entry-meta');
      meta.append(el('span', 'entry-time', e.created_at));
      const stateTag = tags.find(t => STATE_LABEL[t]);
      if (stateTag) meta.append(el('span', 'state-square state-' + stateTag, STATE_LABEL[stateTag]));
      for (const t of tags) if (!HIDDEN_TAG.test(t)) meta.append(el('span', 'tag-chip', t));
      div.append(meta);

      const bodyEl = el('div', 'entry-text');
      ui().safeSetHtml(bodyEl, ui().renderEntryText(e.body || ''));
      div.append(bodyEl);

      // Multi-line expand indicator.
      if ((e.body || '').includes('\n')) {
        div.classList.add('collapsed');
        const tri = el('span', 'expand-tri', '▸');
        tri.addEventListener('click', () => {
          div.classList.toggle('collapsed');
          tri.textContent = div.classList.contains('collapsed') ? '▸' : '▾';
        });
        meta.append(tri);
      }
      dayGroup.append(div);
    }
    return wrap;
  }

  /* ------------------------------- render ------------------------------ */

  function render(member) {
    const screen = document.getElementById('memberScreen');
    if (!screen || !member) return;
    screen.replaceChildren();

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

    const split = el('div', 'split-view');
    const left = el('div', 'split-left');
    const right = el('div', 'split-right');

    left.append(renderPrep(member));
    left.append(renderEntryBox(member));
    left.append(renderHistory(member));
    right.append(el('div', 'panel-placeholder', 'Tasks, goals, links & gallery — Steps 8–10.'));

    split.append(left, right);
    screen.append(split);

    const input = document.getElementById('entryInput');
    if (input) setTimeout(() => input.focus(), 0);
  }

  Chippy.discussion = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
