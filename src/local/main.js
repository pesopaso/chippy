// SPDX-License-Identifier: Apache-2.0
//
// main.js — application bootstrap and screen router (classic script).
// Loads LAST, after format/io/store/ui/discussion/pages/dashboard have populated
// window.Chippy. No import/export, so the whole app runs from a file:// origin.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  // Single source of truth for the version. Used for display and as the cache-bust
  // query param on the CSS/JS tags in app.html (bump both together on release).
  const VERSION = '3.0.0-dev.81';
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

  // About dialog: version, licence, and project link.
  function showAbout() {
    const ui = Chippy.ui;
    if (!ui || !ui.showModal) return;
    ui.showModal('', (modal, close) => {
      modal.classList.add('modal-about');
      const mk = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls)  e.className   = cls;
        if (text != null) e.textContent = text;
        return e;
      };
      const mkLink = (text, href) => {
        const a = mk('a', 'md-link', text);
        a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
        return a;
      };

      // Header row: title + version top-left, icon right.
      const header = mk('div', 'about-header');
      const titleCol = mk('div', 'about-title-col');
      titleCol.appendChild(mk('div', 'about-title', 'About Chippy'));
      titleCol.appendChild(mk('div', 'about-version', 'Version ' + VERSION));
      const logo = document.createElement('img');
      logo.src = 'chippy-icon.svg?v=' + VERSION;
      logo.alt = 'Chippy'; logo.className = 'about-logo';
      header.append(titleCol, logo);
      modal.appendChild(header);

      // Description paragraphs.
      const paras = [
        'Chippy takes its name from the fish-and-chips shop.',
        'Chippy supports you to gather chips of information from discussions and exchanges. ' +
        'Set and progress on goals you care about. Track and execute tasks you want — or need — ' +
        'to move forward. Follow up on things outside your direct control. Over time, those chips ' +
        'add up into something solid you can act on.',
        'The name also carries a nod to putting the fish on the table — the discipline of naming ' +
        'the difficult thing directly rather than leaving it to fester. A team that can surface ' +
        'what’s really going on, and work through it honestly, gets somewhere.',
        'Chippy keeps you close to what’s actually happening — across your topics, your goals, ' +
        'your exchanges — so when the moment comes, you’re ready.'
      ];
      for (const text of paras) modal.appendChild(mk('p', 'about-desc', text));

      // Separator.
      modal.appendChild(mk('hr', 'about-sep'));

      // External References.
      const compHead = mk('div', 'about-meta-head', 'External References');
      modal.appendChild(compHead);
      const compList = mk('ul', 'about-meta-list');
      const compItem = mk('li');
      compItem.appendChild(mkLink('DOMPurify 3.2.6', 'https://github.com/cure53/DOMPurify'));
      compItem.appendChild(document.createTextNode(' — HTML sanitisation by Cure53'));
      compList.appendChild(compItem);
      modal.appendChild(compList);

      // Licence.
      const linksRow = mk('div', 'about-links-row');
      linksRow.appendChild(mkLink('Apache 2.0 Licence', 'https://www.apache.org/licenses/LICENSE-2.0'));
      modal.appendChild(linksRow);

      // Separator before repository.
      modal.appendChild(mk('hr', 'about-sep'));

      // Repository.
      modal.appendChild(mk('div', 'about-meta-head', 'Repository'));
      const repoList = mk('ul', 'about-meta-list');
      const repoItem = mk('li');
      repoItem.appendChild(mkLink('Chippy GitHub Repo', 'https://github.com/pesopaso/chippy'));
      repoList.appendChild(repoItem);
      modal.appendChild(repoList);

      const row = mk('div', 'modal-actions');
      const ok  = mk('button', 'btn-primary', 'Close');
      ok.addEventListener('click', close);
      row.appendChild(ok);
      modal.appendChild(row);
    });
  }

  // Help dialog: a sectioned reference for the whole app (R49).
  function showHelp() {
    const ui = Chippy.ui;
    if (!ui || !ui.showModal) return;
    const mk = (tag, text) => { const e = document.createElement(tag); if (text != null) e.textContent = text; return e; };

    ui.showModal('Chippy — Help', (modal, close) => {
      // section(title, introText|null, [[term, description], …])
      function section(title, intro, items) {
        modal.appendChild(Object.assign(mk('h4', title), { className: 'help-h' }));
        if (intro) modal.appendChild(mk('p', intro));
        if (items && items.length) {
          const ul = mk('ul'); ul.className = 'help-list';
          for (const [term, desc] of items) {
            const li = mk('li');
            li.appendChild(mk('strong', term + ' — '));
            li.appendChild(document.createTextNode(desc));
            ul.appendChild(li);
          }
          modal.appendChild(ul);
        }
      }
      // Render rows as <code>syntax</code> — description.
      function codeList(items) {
        const ul = mk('ul'); ul.className = 'help-list help-md';
        for (const [syntax, desc] of items) {
          const li = mk('li');
          li.appendChild(mk('code', syntax));
          li.appendChild(document.createTextNode(' — ' + desc));
          ul.appendChild(li);
        }
        modal.appendChild(ul);
      }
      // Render the actual coloured chips so they're recognisable.
      // items: [[className, chipText, meaning], …]
      function chipLegend(subTitle, items) {
        modal.appendChild(Object.assign(mk('div', subTitle), { className: 'help-sub' }));
        const ul = mk('ul'); ul.className = 'help-list help-chips';
        for (const [cls, text, meaning] of items) {
          const li = mk('li');
          li.appendChild(Object.assign(mk('span', text), { className: cls }));
          li.appendChild(document.createTextNode(' ' + meaning));
          ul.appendChild(li);
        }
        modal.appendChild(ul);
      }

      section('Navigation', 'The left sidebar lists your discussions and opens the cross-discussion pages.', [
        ['Discussions', 'grouped by tag; favourites (★) are pinned on top; each row shows a comment-count chip on the right.'],
        ['Search discussions', 'filters the sidebar list by name (× clears).'],
        ['Page buttons', 'open the overview pages — see "Page overview" below.'],
        ['Open Folder', 'connect your local data folder; the status line then shows discussion / tag / name counts.'],
        ['Narrow screens (<800px)', 'three tabs under the top bar — Navigation, Discussion, Tasks & Goals — switch which panel is shown.']
      ]);

      section('Discussion', 'The middle column is where you read and write a discussion.', [
        ['Title & actions', 'the discussion name with its comment count; on the right: ★ favourite, ↻ reload from disk, ⬇ export a contribution summary, 🗄 archive (renames the file to *.archive.md — nothing is deleted).'],
        ['Description', 'editable notes for the discussion (✎ at the top-right); the "Description" label hides once it has text.'],
        ['New comment', 'type a note — #tag to classify, @ to mention a name, Ctrl+V to paste an image. Below the box: tag chips on the left; goal link, due date and Save on the right. The box clears after saving.'],
        ['Search this discussion', 'filters the comments below by #tag / @name / free text.'],
        ['History', 'comments grouped by day, newest first; today reads "Today".']
      ]);

      section('Right column', 'A live summary of the discussion, each section scrolls on its own.', [
        ['Open Tasks', 'your open tasks — priority and state squares on the left, controls on the right.'],
        ['Goals', 'highlighted with a goal tint; ⚡ action, ✎ edit, ✓ achieved, ✕ canceled at the bottom-right.'],
        ['Links', 'links found in the comments and description, deduped (images excluded); ✎ renames a link.'],
        ['Images', 'a gallery of pasted images; click one for the full-screen carousel.']
      ]);

      section('Comments — functions & special tags',
        'Comments support Markdown (headings, bold/italic, lists, code, quotes), auto-linked URLs, @[Name] mentions and inline images.', [
        ['Actions', '✎ edit inline (tags are editable here — type #tag or use "+ tag"; × removes one), ⚡ add a dated action, 🔇 mute, ➜ move to another discussion, 🗑 delete.'],
        ['"Updated:"', 'added automatically when you edit a comment on a later day than it was created.'],
        ['Classify', '#task, #followup or #goal turn a comment into that item type.'],
        ['Priority', '#high / #medium / #low (the priority square cycles them).'],
        ['Reserved tags (hidden from the chip row)', 'state tags (opentask, inprogresstask, checktask, onholdtask, purgatorytask, resolvedtask, obsoletetask, resolvedfollowup), goal states (achievedgoal, canceledgoal), muted:<date> (temporary mute) and goal-<id> (links a comment to a goal).']
      ]);
      chipLegend('Priority chips (click to cycle):', [
        ['prio-square prio-high', 'HI', 'high'],
        ['prio-square prio-medium', 'MI', 'medium'],
        ['prio-square prio-low', 'LO', 'low (default)']
      ]);

      section('Markdown syntax', 'Comment and description text is rendered as Markdown.', null);
      codeList([
        ['# H1  …  ###### H6', 'headings'],
        ['**bold**   __bold__', 'bold'],
        ['*italic*   _italic_', 'italic'],
        ['~~strike~~', 'strikethrough'],
        ['`code`', 'inline code'],
        ['``` … ```', 'fenced code block (fences on their own lines)'],
        ['> quote', 'blockquote'],
        ['- item   * item', 'bullet list'],
        ['1. item', 'numbered list'],
        ['---', 'horizontal rule'],
        ['[label](https://…)', 'link'],
        ['![alt](path.jpg)', 'image — or just paste with Ctrl+V'],
        ['https://…', 'bare URLs link automatically'],
        ['@[Full Name]', 'name mention (becomes a chip)'],
        ['#tag', 'tag — classifies the comment'],
        ['blank line', 'separates paragraphs']
      ]);

      section('Tasks, FollowUps & Goals', 'Classified comments gain a state machine and controls.', [
        ['Task states', 'OPEN, WIP (in progress), CHK (check), HOLD (on hold), PRGT (purgatory), DONE (resolved), OBSL (obsolete) — click the state square for the menu.'],
        ['Collapse', 'DONE / OBSL (and achieved/canceled goals) collapse to one line; click ▸ to expand.'],
        ['FollowUps', 'behave like tasks; resolving one marks it resolvedfollowup.'],
        ['Goals', '✓ achieve or ✕ cancel writes an "Achieved:" / "Canceled:" marker; goals are visually highlighted. Link a comment to a goal, and double-click any task/goal to jump to its source entry.'],
        ['Mute', 'hides a task for 5 days (muted:<date>) to cut noise in Ro3 and the kanban.']
      ]);
      chipLegend('Task-state chips (click the square for the menu):', [
        ['state-square state-open', 'OPEN', 'open'],
        ['state-square state-inprogresstask', 'WIP', 'in progress'],
        ['state-square state-checktask', 'CHK', 'needs a check'],
        ['state-square state-onholdtask', 'HOLD', 'on hold'],
        ['state-square state-purgatorytask', 'PRGT', 'purgatory'],
        ['state-square state-resolvedtask', 'DONE', 'resolved'],
        ['state-square state-obsoletetask', 'OBSL', 'obsolete']
      ]);

      section('Page overview', 'Sidebar buttons open these cross-discussion pages, each with the unified #tag / @name / free-text search.', [
        ['Comments', 'every comment across all discussions.'],
        ['Tasks', 'all open tasks.'],
        ['Goals', 'all open goals.'],
        ['Links', 'all links, deduped (images excluded), renameable.'],
        ['Images', 'every image; click for the carousel.'],
        ['Names', '@[Name] references — counts, last-seen and a drill-down.'],
        ['Tags', 'every tag with its total uses and the date last used.'],
        ['Kanban', 'drag tasks between state columns; the DONE column shows ~2 months.'],
        ['Ro3', 'Rule of Three — one task per priority; Refresh re-rolls.'],
        ['Activity', 'charts: comment inflow, task/goal states, monthly timeline, an open-task burndown, and tasks-created-per-day by state.'],
        ['AI Summary', 'generate a summary of your comments via a local LLM.']
      ]);

      section('AI Summary — settings', 'The Summary page talks to a local, OpenAI-compatible LLM endpoint.', [
        ['Endpoint & model', 'set the API URL and model name; both are saved to summary.md and your browser.'],
        ['Range', 'choose day, week or month of comments to summarise.'],
        ['Generate', 'posts the selected comments to the endpoint and renders the reply (sanitised).'],
        ['Saved summaries', 'each generated summary is kept as a card you can edit, delete, or move into a discussion as a comment.']
      ]);

      const rowEl = mk('div'); rowEl.className = 'modal-actions';
      const ok = mk('button', 'Close'); ok.className = 'btn-primary'; ok.addEventListener('click', close);
      rowEl.appendChild(ok); modal.appendChild(rowEl);
    });
  }

  // Slim layout under 800px (R36): three tabs under the top chrome show one
  // region at a time — Navigation (sidebar), Discussion (middle), Tasks & Goals (right).
  function setSlimTab(tab) {
    const t = (tab === 'nav' || tab === 'right') ? tab : 'mid';
    document.body.classList.remove('slim-nav', 'slim-mid', 'slim-right');
    document.body.classList.add('slim-' + t);
    document.querySelectorAll('.slim-tab').forEach(b => b.classList.toggle('active', b.dataset.slim === t));
  }
  Chippy.setSlimTab = setSlimTab;

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

    const about = document.getElementById('btnAbout');
    if (about) about.addEventListener('click', showAbout);

    const help = document.getElementById('btnHelp');
    if (help) help.addEventListener('click', showHelp);

    const printBtn = document.getElementById('btnPrintChrome');
    if (printBtn) printBtn.addEventListener('click', () => window.print());

    setSlimTab('mid');
    document.querySelectorAll('.slim-tab').forEach(b =>
      b.addEventListener('click', () => setSlimTab(b.dataset.slim)));
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
            // Load every discussion in the background so the sidebar can show
            // per-discussion comment counts, then re-render once they're in.
            if (store.ensureAllLoaded) {
              store.ensureAllLoaded().then(() => { if (pages) pages.renderSidebar(); }).catch(() => {});
            }
            break;
          case 'memberSelected':
            if (pages) { pages.noteRecent(cs.name); pages.renderSidebar(); pages.renderRecent(); }
            if (Chippy.discussion) Chippy.discussion.render(store.getActiveMember(), { fresh: true });
            if (pages) pages.showScreen('member');
            // Slim mode: jump from the Navigation tab to the Discussion tab.
            if (document.body.classList.contains('slim')) setSlimTab('mid');
            break;
          // Single-entry mutations: update just that card in place on the
          // discussion screen (keeps scroll exactly put); full refresh elsewhere.
          case 'taskStateChanged':
          case 'priorityChanged':
          case 'dueChanged':
          case 'actionAppended':
          case 'muteToggled':
          case 'goalStateChanged':
          case 'entryEdited': {
            const onMember = pages && pages.getCurrentScreen && pages.getCurrentScreen() === 'member';
            const handled = onMember && Chippy.discussion && Chippy.discussion.refreshEntry &&
              Chippy.discussion.refreshEntry(cs.entryId);
            if (!handled && pages) pages.refresh();
            break;
          }
          case 'memberReloaded':
          case 'entryAdded':
          case 'entryMoved':
          case 'entryDeleted':
          case 'linkRenamed':
          case 'summarySaved':
          case 'summaryDeleted':
          case 'summaryMoved':
            if (pages) pages.refresh();
            // Comment counts in the sidebar can change with these mutations.
            if (pages && (cs.type === 'entryAdded' || cs.type === 'entryDeleted' || cs.type === 'entryMoved')) {
              pages.renderSidebar();
            }
            break;
          case 'favoriteToggled':
            if (pages) pages.renderSidebar();
            break;
          case 'discussionArchived':
            if (pages) { pages.renderSidebar(); pages.showScreen('welcome'); }
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
