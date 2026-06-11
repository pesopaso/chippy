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

  const HIDDEN_TAG = Chippy.tags.RESERVED; // taxonomy.js — single source of truth

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

  // insertAtCursor and blobToJpeg moved to ui.js (shared with the inline
  // comment editor's paste handler); used here via ui().
  // Every image reference in the discussion with its entry's timestamp.
  function collectImages(member) {
    const out = []; const re = /!\[[^\]]*\]\(([^)]+)\)/g;
    for (const e of (member.entries || [])) {
      let m;
      while ((m = re.exec(e.body || ''))) out.push({ ref: m[1], date: e.created_at || '' });
    }
    return out;
  }
  function showMoveDialog(member, entryId) {
    const others = store().getDiscussions().filter(d => !d.archived && d.name !== member.name);
    ui().showModal('Move comment to…', (modal, close) => {
      const sel = el('select', 'modal-input');
      for (const d of others) sel.append(new Option(d.name, d.name));
      const row = el('div', 'modal-actions');
      const cancel = el('button', 'btn-sm', 'Cancel'); cancel.addEventListener('click', close);
      const mv = el('button', 'btn-primary', 'Move');
      mv.addEventListener('click', () => { if (sel.value) store().moveEntry(member.name, entryId, sel.value); close(); });
      row.append(cancel, mv); modal.append(sel, row);
    });
  }
  function showDeleteDialog(member, entryId, body) {
    ui().showModal('Delete comment?', (modal, close) => {
      modal.append(el('div', 'modal-preview', (body || '').split('\n')[0].slice(0, 120)));
      const row = el('div', 'modal-actions');
      const cancel = el('button', 'btn-sm', 'Cancel'); cancel.addEventListener('click', close);
      const del = el('button', 'btn-primary danger', 'Delete');
      del.addEventListener('click', () => { store().deleteEntry(member.name, entryId); close(); });
      row.append(cancel, del); modal.append(row);
    });
  }
  function downloadFile(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------ prep area ---------------------------- */

  function renderPrep(member) {
    const wrap = el('div', 'prep-section');
    const bar = el('div', 'prep-bar');
    const label = el('span', 'section-label', 'Description');
    bar.append(label);
    const editBtn = el('span', 'prep-edit-btn', '✎');
    editBtn.title = 'Edit description';
    bar.append(editBtn);
    wrap.append(bar);

    const view = el('div', 'prep-view');
    function renderView() {
      if (member.prep) {
        ui().safeSetHtml(view, ui().renderEntryText(member.prep));
        label.style.display = 'none';          // title redundant once there's text
      } else {
        view.replaceChildren(el('span', 'prep-empty', 'No description yet.'));
        label.style.display = '';
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

    // #tag extraction on space + #tag autocomplete. @-name autocomplete is the
    // shared ui helper (attached below), so the composer dropdown only handles
    // tags and hides itself while a name token is active.
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
      if (tagTok) {
        const q = tagTok[1].toLowerCase();
        showSuggestions(store().getTagUnion().filter(t => t.includes(q) && !HIDDEN_TAG.test(t)),
          (t) => { ta.value = upto.slice(0, upto.length - tagTok[1].length) + t + ' ' + val.slice(ta.selectionStart);
                   if (!selectedTags.includes(t)) selectedTags.push(t);
                   ta.value = ta.value.replace(new RegExp('#' + t + ' '), ''); renderChips(); hideDropdown(); ta.focus(); });
      } else hideDropdown();
    });
    ui().attachNameAutocomplete(ta, null, { allowNew: true });

    // Grow the box only when a line is created/removed, not on every keystroke.
    let prevLineCount = (ta.value.match(/\n/g) || []).length;
    ta.addEventListener('input', () => {
      const lines = (ta.value.match(/\n/g) || []).length;
      if (lines !== prevLineCount) { prevLineCount = lines; if (ui().autosizeTextarea) ui().autosizeTextarea(ta); }
    });

    // Clipboard image paste -> JPEG in the discussion subfolder + inline ref.
    ta.addEventListener('paste', async (ev) => {
      const items = (ev.clipboardData && ev.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.indexOf('image/') === 0) {
          ev.preventDefault();
          const jpeg = await ui().blobToJpeg(it.getAsFile());
          if (jpeg) {
            const ref = await store().saveImage(member.name, jpeg);
            ui().insertAtCursor(ta, '![image](' + ref + ')');
            saveDraft();
          }
          break;
        }
      }
    });

    async function save() {
      const text = ta.value.trim();
      if (!text && !selectedTags.length) return;
      const payload = {
        text, tags: selectedTags.slice(),
        goalLinkId: goalSel.value || null,
        due: due.value || null
      };
      // Clear the field, chips, and draft BEFORE awaiting: addEntry emits
      // 'entryAdded', which re-renders the discussion and rebuilds this box from
      // the stored draft. Clearing first means the rebuilt box comes up empty.
      ta.value = ''; selectedTags = []; due.value = ''; goalSel.value = '';
      renderChips(); clearDraft(); hideDropdown();
      await store().addEntry(member.name, payload);
      if (ui().showToast) ui().showToast('Comment saved', 'success');
      if (onSaved) onSaved();
    }
    saveBtn.addEventListener('click', save);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && dropdown.classList.contains('hidden')) { e.preventDefault(); save(); }
      else if (e.key === 'Escape') hideDropdown();
    });

    renderChips();
    // Textarea first; below it a footer row with tag chips on the left and the
    // goal link / due date / Save controls pushed to the right.
    const footer = el('div', 'entry-footer');
    footer.append(chips, controls);
    box.append(ta, dropdown, footer);
    // Size to the restored draft once mounted; rAF defers until the box is in the DOM.
    if (ui().autosizeTextarea) requestAnimationFrame(() => ui().autosizeTextarea(ta));
    return box;
  }

  /* ------------------------------ history ------------------------------ */

  function entryKindClass(tags) {
    if (tags.includes('goal')) return 'entry-goal';
    if (tags.includes('followup')) return 'entry-followup';
    if (tags.includes('task')) return 'entry-task';
    return '';
  }

  // Optional `query` filters to matching comments within this discussion only
  // (same #tag / @name / freetext syntax as the cross-views). The entry index
  // passed to entryCard is always the position in the full list, so mutations
  // still target the right entry even when filtered.
  function renderHistory(member, query) {
    const wrap = el('div', 'history-list');
    const all = member.entries || [];
    const match = (query && query.trim()) ? new Set(store().applyUnifiedFilter(all, query)) : null;
    const today = (store().nowISO ? store().nowISO() : new Date().toISOString()).slice(0, 10);
    let lastDay = null, dayGroup = null;
    const indexed = all.map((e, i) => ({ e, i }));
    for (const { e, i } of indexed.reverse()) { // newest day + entry first
      if (match && !match.has(e)) continue;
      const day = (e.created_at || '').slice(0, 10);
      if (day !== lastDay) {
        dayGroup = el('div', 'day-group');
        dayGroup.append(el('div', 'day-label', day === today ? 'Today' : day));
        wrap.append(dayGroup); lastDay = day;
      }
      dayGroup.append(ui().entryCard(e, { member: member.name, timeOnly: true, idx: i }));
    }
    if (!wrap.children.length) {
      wrap.append(el('div', 'history-empty', match ? 'No matching comments.' : 'No entries yet.'));
    }
    return wrap;
  }

  // Search box that filters this discussion's comment history.
  function makeDiscSearch(onChange) {
    const wrap = el('div', 'list-search-wrap');
    const inp = el('input', 'list-search'); inp.type = 'text';
    inp.placeholder = 'Search this discussion…  #tag or @name';
    ui().attachNameAutocomplete(inp);
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

  /* --------------------------- tasks panel ----------------------------- */

  // Tag taxonomy lives in taxonomy.js (Chippy.tags); aliased here for brevity.
  const PRIO_RANK = Chippy.tags.PRIO_RANK;
  const PRIO_LABEL = Chippy.tags.PRIO_LABEL;
  const STATE_SQUARE = Chippy.tags.STATE_SQUARE;
  const priorityOf = Chippy.tags.priorityOf;
  const stateKeyOf = Chippy.tags.stateKeyOf;
  function ageDays(createdAt) {
    const d = new Date(String(createdAt || '').replace(' ', 'T'));
    return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 86400000);
  }
  const firstLine = body => String(body || '').split('\n')[0];

  function renderTaskRow(member, t) {
    const muted = store().isMuted(t);
    const idx = (member.entries || []).indexOf(t); // disambiguates same-timestamp entries
    const row = el('div', 'task-item' + (t.tags.includes('followup') ? ' followup' : '') + (muted ? ' muted' : ''));

    const prio = priorityOf(t.tags) || 'low';
    const ps = el('span', 'prio-square prio-' + prio, PRIO_LABEL[prio]);
    ps.title = 'Change priority';
    ps.addEventListener('click', () => store().cyclePriority(member.name, t.created_at, idx));

    const sk = stateKeyOf(t.tags);
    const [slabel, scls] = STATE_SQUARE[sk];
    const ss = el('span', 'state-square ' + scls, slabel);
    ss.title = 'Change state';
    ss.addEventListener('click', () =>
      ui().showStateDropdown(ss, sk, (key) => store().setTaskState(member.name, t.created_at, key, idx)));

    // Show the full body clamped to one line; click expands when there's more.
    const txt = el('div', 'task-text clamp');
    ui().safeSetHtml(txt, ui().renderEntryText(t.body || ''));
    const moreTxt = /\n/.test(t.body || '') || (t.body || '').length > 60;
    if (moreTxt) {
      txt.classList.add('expandable');
      txt.addEventListener('click', (ev) => {
        if (ev.target.closest('a, img, .name-chip')) return;
        txt.classList.toggle('clamp');
      });
    }
    txt.addEventListener('dblclick', () => scrollToEntry(t.created_at));

    const top = el('div', 'task-top');
    top.append(txt);

    // All controls live on the bottom row, so the text up top gets the full width.
    const meta = el('div', 'task-meta');
    meta.append(ps, ss);
    // Spacer pushes the remaining controls (age, due, action, mute) to the right.
    meta.append(el('span', 'meta-spacer'));
    const age = ageDays(t.created_at);
    if (age != null) meta.append(el('span', 'task-age', age + 'd'));
    const due = el('input', 'task-due'); due.type = 'date'; if (t.due) due.value = t.due;
    due.title = 'Due date';
    due.addEventListener('change', () => store().setDue(member.name, t.created_at, due.value || null, idx));
    // No due date → collapse the field to just its calendar icon (CSS); a set
    // date shows the full field.
    if (!t.due) due.classList.add('collapsed');
    meta.append(due);
    const act = el('span', 'icon-btn act', '⚡'); act.title = 'Add action';
    act.addEventListener('click', () =>
      ui().showActionModal('Add action', (text) => store().appendAction(member.name, t.created_at, text, idx)));
    const mute = el('span', 'icon-btn', muted ? '🔈' : '🔇'); mute.title = muted ? 'Unmute' : 'Mute 5 days';
    mute.addEventListener('click', () => store().toggleMute(member.name, t.created_at, idx));
    meta.append(act, mute);

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
    const idx = (member.entries || []).indexOf(g); // disambiguates same-timestamp entries
    const row = el('div', 'goal-item');
    const txt = el('div', 'goal-text');
    ui().safeSetHtml(txt, ui().renderEntryText(firstLine(g.body)));
    txt.addEventListener('dblclick', () => scrollToEntry(g.created_at));

    const meta = el('div', 'goal-meta');
    if (g.due) meta.append(el('span', 'task-age', 'due ' + g.due));
    const act = el('span', 'icon-btn', '⚡'); act.title = 'Add action';
    act.addEventListener('click', () =>
      ui().showActionModal('Add action', (text) => store().appendAction(member.name, g.created_at, text, idx)));
    const edit = el('span', 'icon-btn', '✎'); edit.title = 'Edit goal';
    edit.addEventListener('click', () => scrollToEntry(g.created_at, true));
    const ach = el('span', 'icon-btn done', '✓'); ach.title = 'Achieved';
    ach.addEventListener('click', () => store().setGoalState(member.name, g.created_at, 'achieved', idx));
    const can = el('span', 'icon-btn cancel', '✕'); can.title = 'Canceled';
    can.addEventListener('click', () => store().setGoalState(member.name, g.created_at, 'canceled', idx));
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

  /* --------------------------- links + gallery ------------------------- */

  function renderLinksPanel(member) {
    const wrap = el('div', 'links-section');
    wrap.append(el('div', 'section-label', 'Links'));
    const links = store().getLinks(member);
    if (!links.length) { wrap.append(el('div', 'panel-empty', 'No links.')); return wrap; }
    const box = el('div', 'link-list');
    for (const l of links) {
      const row = el('div', 'link-item');
      const a = el('a', 'md-link', l.label);
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      const edit = el('span', 'icon-btn', '✎'); edit.title = 'Rename link';
      edit.addEventListener('click', () =>
        ui().showActionModal('Rename link', (newLabel) => store().renameLink(member.name, l.url, newLabel)));
      row.append(a, edit);
      box.append(row);
    }
    wrap.append(box);
    return wrap;
  }

  function renderGallery(member) {
    const items = collectImages(member).reverse(); // newest first
    const wrap = el('div', 'gallery-section');
    wrap.append(el('div', 'section-label', 'Images'));
    if (!items.length) { wrap.append(el('div', 'panel-empty', 'No images.')); return wrap; }
    const grid = el('div', 'gallery-grid');
    items.forEach((it, idx) => {
      const thumb = el('img', 'gallery-thumb');
      thumb.title = it.date;
      store().getImageUrl(it.ref).then(u => { if (u) thumb.src = u; }).catch(() => {});
      thumb.addEventListener('click', async () => {
        // Carousel with "<discussion> — <created_at>" captions below the image.
        const all = await Promise.all(items.map(async (x) => {
          const u = await store().getImageUrl(x.ref).catch(() => null);
          return u ? { url: u, label: member.name + ' — ' + x.date } : null;
        }));
        ui().showImageOverlay(all.filter(Boolean), idx);
      });
      grid.append(thumb);
    });
    wrap.append(grid);
    return wrap;
  }

  /* ----------------------- discussion tag editor ----------------------- */

  // Inline tag editor for a discussion (R62). Renders as:
  //   (a) no tag set  — a text input with datalist autocomplete; on Enter/blur calls
  //       store.setDiscussionTag(name, val). Empty val on blur is a no-op.
  //   (b) tag set     — a colored chip with an × remove button that calls
  //       store.setDiscussionTag(name, '').
  function renderDiscTag(member) {
    const wrap = el('div', 'disc-tag-row');

    function rebuild() {
      wrap.replaceChildren();
      const nav = store().getDiscussions().find(x => x.name === member.name);
      const cur = (nav && nav.tag) || '';
      const allTags = store().getDiscussionTags ? store().getDiscussionTags() : [];

      if (cur) {
        const color = (ui().getDiscTagColor) ? ui().getDiscTagColor(cur, allTags) : '#888';
        const chip = el('span', 'disc-tag-chip', cur);
        chip.style.background = color + '22';
        chip.style.borderColor = color;
        chip.style.color = color;
        const x = el('span', 'disc-tag-chip-x', '×');
        x.title = 'Remove tag';
        x.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus
        x.addEventListener('click', async () => {
          await store().setDiscussionTag(member.name, '');
          rebuild();
        });
        chip.append(x);
        wrap.append(chip);
      } else {
        const dlId = 'discTagList_' + member.name.replace(/\W+/g, '_');
        const dl = document.createElement('datalist');
        dl.id = dlId;
        for (const t of allTags) dl.append(new Option(t));
        const inp = el('input', 'disc-tag-input');
        inp.type = 'text';
        inp.placeholder = 'Add tag…';
        inp.setAttribute('list', dlId);
        let committed = false;
        const commit = async () => {
          if (committed) return; committed = true;
          const val = inp.value.trim();
          if (val) await store().setDiscussionTag(member.name, val);
          rebuild();
        };
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); inp.value = ''; inp.blur(); }
        });
        inp.addEventListener('blur', commit);
        wrap.append(dl, inp);
      }
    }
    rebuild();
    return wrap;
  }

  /* ------------------------------- render ------------------------------ */

  // Update just one entry's card in place (and the right panel) instead of
  // re-rendering the whole discussion — so the changed task's top stays exactly
  // where it is and nothing above it reflows. Returns false if it can't (then
  // the caller falls back to a full render).
  function refreshEntry(entryId) {
    const screen = document.getElementById('memberScreen');
    const member = store().getActiveMember();
    if (!screen || !member || !entryId) return false;
    const idx = (member.entries || []).findIndex(e => e.created_at === entryId);
    if (idx < 0) return false;
    const e = member.entries[idx];

    const list = screen.querySelector('.history-list');
    let replaced = false;
    if (list) {
      const cards = list.querySelectorAll('.entry-card');
      for (const old of cards) {
        if (old.dataset.entryId === entryId) {
          old.replaceWith(ui().entryCard(e, { member: member.name, timeOnly: true, idx }));
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) return false;

    // The right panel lists can change membership; re-render them but keep scroll.
    const right = screen.querySelector('.split-right');
    if (right) {
      const sc = right.scrollTop;
      right.replaceChildren(
        renderTasksPanel(member), renderGoalsPanel(member),
        renderLinksPanel(member), renderGallery(member));
      right.scrollTop = sc;
    }
    return true;
  }

  function render(member, opts) {
    opts = opts || {};
    const screen = document.getElementById('memberScreen');
    if (!screen || !member) return;
    // Preserve scroll across a re-render (a mutation shouldn't jump the view).
    // On a fresh discussion open (opts.fresh) we start at the top instead.
    const prevLeft = screen.querySelector('.split-left');
    const prevRight = screen.querySelector('.split-right');
    const sLeft = opts.fresh ? 0 : (prevLeft ? prevLeft.scrollTop : 0);
    const sRight = opts.fresh ? 0 : (prevRight ? prevRight.scrollTop : 0);
    const sScreen = opts.fresh ? 0 : screen.scrollTop;
    screen.replaceChildren();

    const header = el('div', 'member-header');
    const titleEl = el('h1', 'member-title', member.name);
    header.append(titleEl);
    const renameBtn = el('span', 'rename-btn', '✎');
    renameBtn.title = 'Rename discussion';
    renameBtn.addEventListener('click', () => {
      const input = el('input', 'rename-input');
      input.value = member.name;
      titleEl.replaceWith(input);
      renameBtn.remove();
      input.focus();
      input.select();
      let committed = false;
      const restoreTitle = () => {
        const fresh = el('h1', 'member-title', member.name);
        input.replaceWith(fresh);
        countEl.before(renameBtn);
      };
      const commit = async () => {
        if (committed) return;
        committed = true;
        const newName = input.value.trim();
        if (newName && newName !== member.name) {
          try { await store().renameDiscussion(member.name, newName); }
          catch (err) {
            committed = false;
            restoreTitle();
            if (ui().showToast) ui().showToast('Rename failed: ' + (err && err.message || err), 'error');
          }
        } else {
          restoreTitle();
        }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); committed = true; restoreTitle(); }
      });
    });
    header.append(renameBtn);
    const entryCount = (member.entries || []).length;
    const countEl = el('span', 'member-count', entryCount + (entryCount === 1 ? ' comment' : ' comments'));
    header.append(countEl);
    const actions = el('div', 'member-header-actions');
    const star = el('span', 'favorite-btn' + (isFavorite(member.name) ? ' on' : ''),
      isFavorite(member.name) ? '★' : '☆');
    star.title = 'Toggle favorite';
    star.addEventListener('click', () => store().toggleFavorite(member.name));
    const reload = el('span', 'reload-btn', '↻');
    reload.title = 'Reload from disk';
    reload.addEventListener('click', () => store().reloadMember(member.name));
    const exp = el('span', 'reload-btn', '⬇');
    exp.title = 'Export contribution summary (.md)';
    exp.addEventListener('click', () =>
      downloadFile(member.name + ' — Contribution Summary.md', store().exportContribution(member)));
    const arc = el('span', 'reload-btn', '🗄');
    arc.title = 'Archive this discussion';
    arc.addEventListener('click', () => {
      ui().showModal('Archive discussion?', (modal, close) => {
        const p = el('p');
        p.textContent = 'Archive "' + member.name + '"? Its file is renamed to *.archive.md and ' +
          'removed from the list. Nothing is deleted — restore it by renaming the file back.';
        modal.append(p);
        const row = el('div', 'modal-actions');
        const cancel = el('button', 'btn-sm', 'Cancel'); cancel.addEventListener('click', close);
        const ok = el('button', 'btn-primary danger', 'Archive');
        ok.addEventListener('click', async () => { close(); try { await store().archiveDiscussion(member.name); } catch (err) { if (ui().showToast) ui().showToast('Archive failed: ' + (err && err.message || err), 'error'); } });
        row.append(cancel, ok); modal.append(row);
      });
    });
    actions.append(star, reload, exp, arc);
    header.append(actions);

    const split = el('div', 'split-view');
    const left = el('div', 'split-left');
    const right = el('div', 'split-right');

    // Header lives at the top of the middle column so both columns run all the
    // way up to the top chrome (no full-width band pushing them down).
    left.append(header);
    left.append(renderDiscTag(member));
    left.append(renderPrep(member));
    left.append(renderEntryBox(member));
    // Per-discussion comment search: filters the history below it.
    const histHost = el('div', 'history-host');
    let histQuery = '';
    const drawHistory = () => histHost.replaceChildren(renderHistory(member, histQuery));
    left.append(makeDiscSearch(q => { histQuery = q; drawHistory(); }));
    drawHistory();
    left.append(histHost);
    right.append(renderTasksPanel(member));
    right.append(renderGoalsPanel(member));
    right.append(renderLinksPanel(member));
    right.append(renderGallery(member));

    split.append(left, right);
    screen.append(split);

    // Restore the prior scroll, then focus the entry box without scrolling to it.
    left.scrollTop = sLeft;
    right.scrollTop = sRight;
    screen.scrollTop = sScreen;
    const input = document.getElementById('entryInput');
    if (input) setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); } }, 0);
  }

  Chippy.discussion = { render, refreshEntry };
})(typeof globalThis !== 'undefined' ? globalThis : this);
