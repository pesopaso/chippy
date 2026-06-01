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

  // Scroll to a history entry by created_at; optionally open its inline edit.
  function scrollToEntry(entryId, openEdit) {
    const id = (window.CSS && CSS.escape) ? CSS.escape(entryId) : entryId;
    const div = document.querySelector('.history-entry[data-entry-id="' + id + '"]');
    if (!div) return;
    div.scrollIntoView({ behavior: 'smooth', block: 'center' });
    div.classList.add('flash');
    setTimeout(() => div.classList.remove('flash'), 1500);
    if (openEdit) { const b = div.querySelector('.entry-edit-btn'); if (b) b.click(); }
  }

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
      const closed = tags.some(t => ['resolvedtask', 'obsoletetask', 'resolvedfollowup'].includes(t));
      const div = el('div', 'history-entry ' + entryKindClass(tags) + (closed ? ' closed collapsed' : ''));
      div.dataset.entryId = e.created_at;

      const meta = el('div', 'entry-meta');
      meta.append(el('span', 'entry-time', e.created_at));
      const stateTag = tags.find(t => STATE_LABEL[t]);
      if (stateTag) meta.append(el('span', 'state-square state-' + stateTag, STATE_LABEL[stateTag]));
      for (const t of tags) if (!HIDDEN_TAG.test(t)) meta.append(el('span', 'tag-chip', t));
      const editBtn = el('span', 'entry-edit-btn icon-btn', '✎');
      editBtn.title = 'Edit';
      meta.append(editBtn);
      div.append(meta);

      const bodyEl = el('div', 'entry-text');
      ui().safeSetHtml(bodyEl, ui().renderEntryText(e.body || ''));
      div.append(bodyEl);

      // Inline edit (re-render happens via the entryEdited event on save).
      let editing = false;
      editBtn.addEventListener('click', () => {
        if (editing) return;
        editing = true;
        const ta = el('textarea', 'entry-edit-area');
        ta.value = e.body || '';
        div.replaceChild(ta, bodyEl);
        ta.focus();
        let fin = false;
        function done(save) {
          if (fin) return; fin = true;
          if (save) { store().editEntry(member.name, e.created_at, { text: ta.value }); return; }
          if (ta.parentNode === div) div.replaceChild(bodyEl, ta);
          editing = false;
        }
        ta.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
        });
        ta.addEventListener('blur', () => done(true));
      });

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

  /* --------------------------- tasks panel ----------------------------- */

  const PRIO_RANK = { high: 0, medium: 1, low: 2 };
  const PRIO_LABEL = { high: 'HI', medium: 'MI', low: 'LO' };
  const STATE_SQUARE = {
    open: ['OPEN', 'state-open'], inprogress: ['WIP', 'state-inprogresstask'],
    check: ['CHK', 'state-checktask'], onhold: ['HOLD', 'state-onholdtask'],
    purgatory: ['PRGT', 'state-purgatorytask'], resolved: ['DONE', 'state-resolvedtask'],
    obsolete: ['OBSL', 'state-obsoletetask']
  };
  function priorityOf(tags) { return tags.find(t => PRIO_RANK[t] !== undefined) || null; }
  function stateKeyOf(tags) {
    if (tags.includes('inprogresstask') || tags.includes('inprogress')) return 'inprogress';
    if (tags.includes('checktask')) return 'check';
    if (tags.includes('onholdtask') || tags.includes('onhold')) return 'onhold';
    if (tags.includes('purgatorytask') || tags.includes('purgatory')) return 'purgatory';
    if (tags.includes('resolvedtask') || tags.includes('resolvedfollowup')) return 'resolved';
    if (tags.includes('obsoletetask')) return 'obsolete';
    return 'open';
  }
  function ageDays(createdAt) {
    const d = new Date(String(createdAt || '').replace(' ', 'T'));
    return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  const firstLine = body => String(body || '').split('\n')[0];

  function renderTaskRow(member, t) {
    const muted = store().isMuted(t);
    const row = el('div', 'task-item' + (t.tags.includes('followup') ? ' followup' : '') + (muted ? ' muted' : ''));

    const prio = priorityOf(t.tags) || 'low';
    const ps = el('span', 'prio-square prio-' + prio, PRIO_LABEL[prio]);
    ps.title = 'Change priority';
    ps.addEventListener('click', () => store().cyclePriority(member.name, t.created_at));

    const sk = stateKeyOf(t.tags);
    const [slabel, scls] = STATE_SQUARE[sk];
    const ss = el('span', 'state-square ' + scls, slabel);
    ss.title = 'Change state';
    ss.addEventListener('click', () =>
      ui().showStateDropdown(ss, sk, (key) => store().setTaskState(member.name, t.created_at, key)));

    const txt = el('div', 'task-text');
    ui().safeSetHtml(txt, ui().renderEntryText(firstLine(t.body)));
    txt.addEventListener('dblclick', () => scrollToEntry(t.created_at));

    const top = el('div', 'task-top');
    top.append(ps, ss, txt);

    const meta = el('div', 'task-meta');
    const age = ageDays(t.created_at);
    if (age != null) meta.append(el('span', 'task-age', age + 'd'));
    const due = el('input', 'task-due'); due.type = 'date'; if (t.due) due.value = t.due;
    due.title = 'Due date';
    due.addEventListener('change', () => store().setDue(member.name, t.created_at, due.value || null));
    const act = el('span', 'icon-btn act', '⚡'); act.title = 'Add action';
    act.addEventListener('click', () =>
      ui().showActionModal('Add action', (text) => store().appendAction(member.name, t.created_at, text)));
    const mute = el('span', 'icon-btn', '🔇'); mute.title = muted ? 'Unmute' : 'Mute 5 days';
    mute.addEventListener('click', () => store().toggleMute(member.name, t.created_at));
    const done = el('span', 'icon-btn done', '✓'); done.title = 'Resolve';
    done.addEventListener('click', () => store().setTaskState(member.name, t.created_at, 'resolved'));
    meta.append(due, act, mute, done);

    row.append(top, meta);
    return row;
  }

  function renderTasksPanel(member) {
    const wrap = el('div', 'tasks-section');
    wrap.append(el('div', 'section-label', 'Open Tasks'));
    const tasks = store().getOpenTasks(member).slice().sort((a, b) => {
      const ma = store().isMuted(a) ? 1 : 0, mb = store().isMuted(b) ? 1 : 0;
      if (ma !== mb) return ma - mb;
      const pa = PRIO_RANK[priorityOf(a.tags)] ?? 3, pb = PRIO_RANK[priorityOf(b.tags)] ?? 3;
      if (pa !== pb) return pa - pb;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
    if (!tasks.length) { wrap.append(el('div', 'panel-empty', 'No open tasks.')); return wrap; }
    for (const t of tasks) wrap.append(renderTaskRow(member, t));
    return wrap;
  }

  /* --------------------------- goals panel ----------------------------- */

  function renderGoalRow(member, g) {
    const row = el('div', 'goal-item');
    const txt = el('div', 'goal-text');
    ui().safeSetHtml(txt, ui().renderEntryText(firstLine(g.body)));
    txt.addEventListener('dblclick', () => scrollToEntry(g.created_at));

    const meta = el('div', 'goal-meta');
    if (g.due) meta.append(el('span', 'task-age', 'due ' + g.due));
    const act = el('span', 'icon-btn', '⚡'); act.title = 'Add action';
    act.addEventListener('click', () =>
      ui().showActionModal('Add action', (text) => store().appendAction(member.name, g.created_at, text)));
    const edit = el('span', 'icon-btn', '✎'); edit.title = 'Edit goal';
    edit.addEventListener('click', () => scrollToEntry(g.created_at, true));
    const ach = el('span', 'icon-btn done', '✓'); ach.title = 'Achieved';
    ach.addEventListener('click', () => store().setGoalState(member.name, g.created_at, 'achieved'));
    const can = el('span', 'icon-btn cancel', '✕'); can.title = 'Canceled';
    can.addEventListener('click', () => store().setGoalState(member.name, g.created_at, 'canceled'));
    meta.append(act, edit, ach, can);

    row.append(txt, meta);
    return row;
  }

  function renderGoalsPanel(member) {
    const wrap = el('div', 'goals-section');
    wrap.append(el('div', 'section-label', 'Goals'));
    const goals = store().getGoals(member);
    if (!goals.length) { wrap.append(el('div', 'panel-empty', 'No open goals.')); return wrap; }
    for (const g of goals) wrap.append(renderGoalRow(member, g));
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
    right.append(renderTasksPanel(member));
    right.append(renderGoalsPanel(member));
    right.append(el('div', 'panel-placeholder', 'Links & gallery — Step 10.'));

    split.append(left, right);
    screen.append(split);

    const input = document.getElementById('entryInput');
    if (input) setTimeout(() => input.focus(), 0);
  }

  Chippy.discussion = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
