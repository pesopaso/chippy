// SPDX-License-Identifier: Apache-2.0
//
// store.js — single source of truth (classic script → window.Chippy.store).
//
// Holds the entire in-memory application state and is the only path that mutates
// it. Reads go through selectors; writes go through actions that persist via
// Chippy.io and then emit a change set. Presentation scripts subscribe and
// re-render. Must load AFTER io.js. See ../../documentation/target-architecture.md.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});

  /* ------------------------------ state -------------------------------- */

  const state = {
    folderReady: false,
    dirHandle: null,
    nav: { discussions: [], theme: 'dark' },
    tags: [],
    names: [],
    members: new Map(),       // name -> member | null (lazy)
    activeMemberName: null,
    activeScreen: 'welcome',
    ui: { filters: {}, search: '', draft: null }
  };

  /* ---------------------------- event emitter -------------------------- */

  const subscribers = new Set();
  function subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
  function emit(changeSet) {
    for (const fn of subscribers) {
      try { fn(changeSet); } catch (err) { console.error('[chippy] subscriber error:', err); }
    }
  }

  /* ------------------------------ helpers ------------------------------ */

  const CLOSED_TASK = new Set(['resolvedtask', 'obsoletetask', 'resolvedfollowup']);
  const CLOSED_GOAL = new Set(['achievedgoal', 'canceledgoal', 'resolvedgoal']);
  const PRIORITY = ['high', 'medium', 'low'];
  const KINDS = ['task', 'followup', 'goal'];

  const isTaskEntry = e => e.tags && (e.tags.includes('task') || e.tags.includes('followup'));
  const isOpenTask = e => isTaskEntry(e) && !e.tags.some(t => CLOSED_TASK.has(t));
  const isGoalEntry = e => e.tags && e.tags.includes('goal');
  const isOpenGoal = e => isGoalEntry(e) && !e.tags.some(t => CLOSED_GOAL.has(t));

  function io() {
    if (!Chippy.io) throw new Error('Chippy.io not loaded — io.js must load before store.js');
    return Chippy.io;
  }

  /* --------------------------- write-rule helpers ---------------------- */

  // created_at with seconds, local time: "YYYY-MM-DD HH:MM:SS".
  function nowISO(d) {
    d = d || new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  // A goal's unique identity tag: goal-<5 base36 chars>.
  function mintGoalId(rng) {
    rng = rng || Math.random;
    let s = '';
    for (let i = 0; i < 5; i++) s += Math.floor(rng() * 36).toString(36);
    return 'goal-' + s;
  }

  // Inline #tag extraction (the # trigger): returns { text, tags } with the
  // #tokens removed from text. "# Heading" (space after #) is left untouched.
  function extractInlineTags(text) {
    const tags = [];
    const out = String(text).replace(/(^|\s)#([a-zA-Z0-9][a-zA-Z0-9-]*)/g,
      (m, pre, tag) => { tags.push(tag.toLowerCase()); return pre; });
    return { text: out, tags };
  }

  // Bare http(s) URLs -> [label](url). A word immediately before becomes the
  // label (underscores -> spaces); otherwise the domain. URLs already inside a
  // [label](url) span are left alone (they sit after "](", not after whitespace,
  // so the leading (^|\s) anchor never matches there).
  function autoLinkUrls(text) {
    return String(text).replace(
      /(^|\s)(?:(\S+)\s+)?(https?:\/\/[^\s)]+)/g,
      (m, lead, word, url) => {
        if (word) return `${lead}[${word.replace(/_/g, ' ')}](${url})`;
        const domain = url.replace(/^https?:\/\//, '').split('/')[0];
        return `${lead}[${domain}](${url})`;
      }
    );
  }

  // Names referenced as @[Full Name] in body text.
  function extractNameTokens(text) {
    const names = [];
    const re = /@\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(String(text)))) names.push(m[1]);
    return names;
  }

  /* ------------------------------ selectors ---------------------------- */

  const selectors = {
    isFolderReady: () => state.folderReady,
    getTheme: () => state.nav.theme,
    getDiscussions: () => state.nav.discussions,
    getTagUnion: () => state.tags,
    getNames: () => state.names,
    getDirHandle: () => state.dirHandle,
    getActiveScreen: () => state.activeScreen,
    getActiveMemberName: () => state.activeMemberName,
    getMember: (name) => state.members.get(name) || null,
    isLoaded: (name) => !!state.members.get(name),
    getActiveMember: () =>
      state.activeMemberName ? (state.members.get(state.activeMemberName) || null) : null,
    getOpenTasks: (member) => {
      const m = member || selectors.getActiveMember();
      return m && m.entries ? m.entries.filter(isOpenTask) : [];
    },
    getGoals: (member) => {
      const m = member || selectors.getActiveMember();
      return m && m.entries ? m.entries.filter(isOpenGoal) : [];
    }
  };

  /* ------------------------------ actions ------------------------------ */

  async function openFolder() {
    const dir = await io().openFolder();
    const { nav, tags, names } = await io().loadIndexes(dir);
    state.dirHandle = dir;
    state.nav = nav;
    state.tags = tags;
    state.names = names;
    state.members = new Map(nav.discussions.map(d => [d.name, null]));
    state.activeMemberName = null;
    state.folderReady = true;
    emit({ type: 'folderOpened', discussions: nav.discussions.length });
    return state;
  }

  async function selectMember(name) {
    if (!state.members.has(name)) state.members.set(name, null);
    if (state.members.get(name) === null) {
      state.members.set(name, await io().loadDiscussion(state.dirHandle, name));
    }
    state.activeMemberName = name;
    state.activeScreen = 'member';
    emit({ type: 'memberSelected', name });
    return state.members.get(name);
  }

  function setActiveScreen(name) { state.activeScreen = name; emit({ type: 'screenChanged', name }); }

  function setTheme(theme) {
    state.nav.theme = theme === 'light' ? 'light' : 'dark';
    emit({ type: 'themeChanged', theme: state.nav.theme });
  }

  async function toggleFavorite(name) {
    const d = state.nav.discussions.find(x => x.name === name);
    if (!d) return;
    d.favorite = !d.favorite;
    await io().saveNav(state.dirHandle, state.nav);
    emit({ type: 'favoriteToggled', name, favorite: d.favorite });
  }

  async function reloadMember(name) {
    const member = await io().loadDiscussion(state.dirHandle, name);
    state.members.set(name, member);
    emit({ type: 'memberReloaded', name });
    return member;
  }

  async function setPrep(name, prep) {
    const m = state.members.get(name);
    if (!m) return;
    m.prep = prep;
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'prepSaved', name });
  }

  // Create a new entry applying all write rules; persist the file + indexes.
  // opts: { text, tags=[], goalLinkId=null, due=null }
  async function addEntry(name, opts) {
    opts = opts || {};
    const m = state.members.get(name);
    if (!m) throw new Error('member not loaded: ' + name);

    const body = autoLinkUrls(String(opts.text || '').trim());
    if (!body) return null; // empty body is not retained

    const tags = (opts.tags || []).map(t => String(t).trim()).filter(Boolean);
    let goal = null;

    if (tags.includes('goal') && !tags.some(t => /^goal-[a-z0-9]{5}$/.test(t))) {
      tags.push(mintGoalId());
    }
    if (opts.goalLinkId) {
      if (!tags.includes(opts.goalLinkId)) tags.push(opts.goalLinkId);
      const g = (m.entries || []).find(e =>
        e.tags && e.tags.includes('goal') && e.tags.includes(opts.goalLinkId));
      if (g) goal = (g.body || '').split('\n')[0];
    }
    if (tags.some(t => KINDS.includes(t)) && !tags.some(t => PRIORITY.includes(t))) {
      tags.push('low');
    }

    const entry = { created_at: nowISO(), tags, goal, due: opts.due || null, body };
    m.entries.push(entry);

    let tagsChanged = false;
    for (const t of tags) if (!state.tags.includes(t)) { state.tags.push(t); tagsChanged = true; }
    if (tagsChanged) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.dirHandle, state.tags); }

    let namesChanged = false;
    for (const n of extractNameTokens(body)) if (!state.names.includes(n)) { state.names.push(n); namesChanged = true; }
    if (namesChanged) { state.names.sort((a, b) => a.localeCompare(b)); await io().saveNames(state.dirHandle, state.names); }

    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'entryAdded', name, entry });
    return entry;
  }

  /* --------------------- task / followup management -------------------- */

  const STATE_TAGS = ['opentask', 'inprogresstask', 'checktask', 'onholdtask',
                      'purgatorytask', 'resolvedtask', 'obsoletetask'];
  const LEGACY_STATE = ['inprogress', 'onhold', 'purgatory'];
  const STATE_TO_TAG = {
    open: null, inprogress: 'inprogresstask', check: 'checktask', onhold: 'onholdtask',
    purgatory: 'purgatorytask', resolved: 'resolvedtask', obsolete: 'obsoletetask'
  };
  const ACTION_HEADERS = new Set(['Task Resolution Actions', 'Followup Actions', 'Goal Actions']);
  const BULLET_RE = /^- \d{4}-\d{2}-\d{2} : /;

  function actionLabelFor(e) {
    if (e.tags.includes('goal')) return 'Goal Actions';
    if (e.tags.includes('followup')) return 'Followup Actions';
    return 'Task Resolution Actions';
  }

  // Split a body into its description (`pre`) and the trailing action bullets,
  // consuming any trailing run of blank / bullet / action-header lines.
  function splitTrailingActions(body) {
    const lines = String(body).split('\n');
    const bullets = [];
    let k = lines.length - 1;
    while (k >= 0) {
      const l = lines[k], tr = l.trim();
      if (tr === '') { k--; continue; }
      if (BULLET_RE.test(l)) { bullets.unshift(l); k--; continue; }
      if (ACTION_HEADERS.has(tr)) { k--; continue; }
      break;
    }
    return { pre: lines.slice(0, k + 1).join('\n').replace(/\n+$/, ''), bullets };
  }

  function findEntry(name, entryId) {
    const m = state.members.get(name);
    if (!m) return [null, null];
    return [m, (m.entries || []).find(e => e.created_at === entryId) || null];
  }

  async function ensureTagsInUnion(tags) {
    let changed = false;
    for (const t of tags) if (!state.tags.includes(t)) { state.tags.push(t); changed = true; }
    if (changed) { state.tags.sort((a, b) => a.localeCompare(b)); await io().saveTags(state.dirHandle, state.tags); }
  }

  function isMuted(e) {
    const t = (e.tags || []).find(x => x.startsWith('muted:'));
    if (!t) return false;
    return t.slice('muted:'.length) >= nowISO().slice(0, 10); // expired -> not muted
  }

  // Set a task/followup state: strip every state tag, add the one new tag
  // (resolved on a followup -> resolvedfollowup), and append Resolved:/Obsolete:
  // markers before any action section. (datadefinition §2.1-2.2)
  async function setTaskState(name, entryId, stateKey) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    const isFollowup = e.tags.includes('followup');
    e.tags = e.tags.filter(t =>
      !STATE_TAGS.includes(t) && !LEGACY_STATE.includes(t) && t !== 'resolvedfollowup');
    let newTag = STATE_TO_TAG[stateKey];
    if (stateKey === 'resolved' && isFollowup) newTag = 'resolvedfollowup';
    if (newTag) e.tags.push(newTag);

    if (stateKey === 'resolved' || stateKey === 'obsolete') {
      const { pre, bullets } = splitTrailingActions(e.body);
      const marker = (stateKey === 'resolved' ? 'Resolved: ' : 'Obsolete: ') + nowISO();
      let body = pre + '\n\n' + marker;
      if (bullets.length) body += '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
      e.body = body;
    }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'taskStateChanged', name, entryId, stateKey });
  }

  async function cyclePriority(name, entryId) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    const order = ['high', 'medium', 'low'];
    const cur = e.tags.find(t => order.includes(t));
    const next = order[((cur ? order.indexOf(cur) : 2) + 1) % 3];
    e.tags = e.tags.filter(t => !order.includes(t));
    e.tags.push(next);
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'priorityChanged', name, entryId, priority: next });
  }

  async function setDue(name, entryId, due) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    e.due = due || null;
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'dueChanged', name, entryId, due: e.due });
  }

  // Append a dated action bullet, consolidating into one action section at the
  // end of the body. (skill resolution-actions rules / datadefinition §2.1)
  async function appendAction(name, entryId, text) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    const { pre, bullets } = splitTrailingActions(e.body);
    bullets.push('- ' + nowISO().slice(0, 10) + ' : ' + text);
    e.body = pre + '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'actionAppended', name, entryId });
  }

  // Toggle a 5-day mute (muted:<expiry>). (v2.3)
  async function toggleMute(name, entryId) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    const muted = e.tags.find(t => t.startsWith('muted:'));
    if (muted) e.tags = e.tags.filter(t => t !== muted);
    else {
      const d = new Date(); d.setDate(d.getDate() + 5);
      const p = n => String(n).padStart(2, '0');
      e.tags.push(`muted:${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'muteToggled', name, entryId });
  }

  /* ----------------------------- goals --------------------------------- */

  const GOAL_STATE_TAGS = ['achievedgoal', 'canceledgoal', 'resolvedgoal'];

  // Append a "<Label>: <ts>" marker before any trailing action section.
  function insertMarker(e, label) {
    const { pre, bullets } = splitTrailingActions(e.body);
    let b = pre + '\n\n' + label + ': ' + nowISO();
    if (bullets.length) b += '\n\n' + actionLabelFor(e) + '\n' + bullets.join('\n');
    return b;
  }

  // Goal state: 'achieved' (achievedgoal + Achieved: marker), 'canceled'
  // (canceledgoal + Canceled:), or 'open' (no closed tag). (datadefinition §2.2)
  async function setGoalState(name, entryId, stateKey) {
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    e.tags = e.tags.filter(t => !GOAL_STATE_TAGS.includes(t));
    if (stateKey === 'achieved') { e.tags.push('achievedgoal'); e.body = insertMarker(e, 'Achieved'); }
    else if (stateKey === 'canceled') { e.tags.push('canceledgoal'); e.body = insertMarker(e, 'Canceled'); }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'goalStateChanged', name, entryId, stateKey });
  }

  // Edit an entry's body (and optionally tags). Appends an "Updated:" marker only
  // when edited on a different calendar day than its creation. (R41 / v1.42)
  async function editEntry(name, entryId, opts) {
    opts = opts || {};
    const [m, e] = findEntry(name, entryId);
    if (!e) return;
    if (Array.isArray(opts.tags)) e.tags = opts.tags.slice();
    if (opts.text != null) {
      e.body = autoLinkUrls(String(opts.text).trim());
      const created = (e.created_at || '').slice(0, 10);
      const today = nowISO().slice(0, 10);
      if (today !== created && !e.body.split('\n').some(l => l.startsWith('Updated: ' + today))) {
        e.body = insertMarker(e, 'Updated');
      }
    }
    await ensureTagsInUnion(e.tags);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'entryEdited', name, entryId });
  }

  /* --------------------------- links + move ---------------------------- */

  function escRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Extract links from a text: markdown [label](url) plus bare http(s) URLs.
  function extractLinks(text) {
    const out = [], seen = new Set();
    const s = String(text || '');
    let m;
    const md = /\[([^\]]+)\]\(([^)]+)\)/g;
    while ((m = md.exec(s))) if (!seen.has(m[2])) { seen.add(m[2]); out.push({ label: m[1], url: m[2] }); }
    const bare = /(^|\s)(https?:\/\/[^\s)]+)/g;
    while ((m = bare.exec(s))) if (!seen.has(m[2])) {
      seen.add(m[2]); out.push({ label: m[2].replace(/^https?:\/\//, '').split('/')[0], url: m[2] });
    }
    return out;
  }

  // Aggregate + dedupe links across a member's prep and all entry bodies.
  function getLinks(member) {
    const m = member || selectors.getActiveMember();
    if (!m) return [];
    const seen = new Set(), out = [];
    const texts = [m.prep || ''].concat((m.entries || []).map(e => e.body || ''));
    for (const t of texts) for (const l of extractLinks(t)) if (!seen.has(l.url)) { seen.add(l.url); out.push(l); }
    return out;
  }

  // Rename a link's display title in its source text (matched by URL). (R44)
  async function renameLink(name, url, newLabel) {
    const m = state.members.get(name);
    if (!m) return;
    const re = new RegExp('\\[[^\\]]*\\]\\(' + escRegex(url) + '\\)', 'g');
    const rep = '[' + newLabel + '](' + url + ')';
    if (m.prep) m.prep = m.prep.replace(re, rep);
    for (const e of (m.entries || [])) e.body = (e.body || '').replace(re, rep);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'linkRenamed', name, url });
  }

  // Move an entry to another discussion: transfer its images, rewrite refs, add
  // a "Moved from <source>: <ts>" marker. (R29, R36)
  async function moveEntry(name, entryId, targetName) {
    const src = state.members.get(name);
    if (!src) return;
    const idx = (src.entries || []).findIndex(e => e.created_at === entryId);
    if (idx < 0) return;
    const entry = src.entries[idx];

    let tgt = state.members.get(targetName);
    if (!tgt) { tgt = await io().loadDiscussion(state.dirHandle, targetName); state.members.set(targetName, tgt); }

    // Transfer referenced images and rewrite their refs.
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let mm; const refs = [];
    while ((mm = imgRe.exec(entry.body || ''))) refs.push(mm[1]);
    for (const ref of refs) {
      if (io().isSafeImagePath(ref)) {
        const newRef = await io().ImageStore.moveImage(state.dirHandle, ref, targetName);
        if (newRef) entry.body = entry.body.split('](' + ref + ')').join('](' + newRef + ')');
      }
    }

    // "Moved from" marker before any action section.
    const { pre, bullets } = splitTrailingActions(entry.body);
    let body = pre + '\n\nMoved from ' + src.name + ': ' + nowISO();
    if (bullets.length) body += '\n\n' + actionLabelFor(entry) + '\n' + bullets.join('\n');
    entry.body = body;

    src.entries.splice(idx, 1);
    tgt.entries.push(entry);
    tgt.entries.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));

    await io().saveDiscussion(state.dirHandle, src);
    await io().saveDiscussion(state.dirHandle, tgt);
    emit({ type: 'entryMoved', from: name, to: targetName, entryId });
  }

  // Delete an entry and any image files it references. (v1.22)
  async function deleteEntry(name, entryId) {
    const m = state.members.get(name);
    if (!m) return;
    const idx = (m.entries || []).findIndex(e => e.created_at === entryId);
    if (idx < 0) return;
    const entry = m.entries[idx];
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let mm;
    while ((mm = imgRe.exec(entry.body || ''))) { try { await io().ImageStore.deleteImage(state.dirHandle, mm[1]); } catch (_) {} }
    m.entries.splice(idx, 1);
    await io().saveDiscussion(state.dirHandle, m);
    emit({ type: 'entryDeleted', name, entryId });
  }

  /* ------------------------------ images ------------------------------- */

  async function saveImage(name, blob) { return io().ImageStore.saveImage(state.dirHandle, name, blob); }
  async function getImageUrl(ref) { return io().ImageStore.getImageUrl(state.dirHandle, ref); }

  /* --------------------- cross-discussion + search --------------------- */

  // Lazy-load every non-archived discussion (for cross-views), caching each.
  async function ensureAllLoaded() {
    for (const d of state.nav.discussions) {
      if (!d.archived && state.members.get(d.name) === null) {
        state.members.set(d.name, await io().loadDiscussion(state.dirHandle, d.name));
      }
    }
  }

  // All loaded entries, each shallow-tagged with its _member (read-only views).
  function collectEntries() {
    const out = [];
    for (const [name, m] of state.members) {
      if (!m) continue;
      for (const e of (m.entries || [])) out.push(Object.assign({ _member: name }, e));
    }
    return out;
  }

  // Parse a unified query: "#tag", "@Name"/"@[Full Name]", and freetext.
  function parseSearchQuery(q) {
    const tags = [], names = [], rest = [];
    const re = /@\[([^\]]+)\]|@(\S+)|#(\S+)|(\S+)/g;
    let m;
    while ((m = re.exec(String(q || '')))) {
      if (m[1] != null) names.push(m[1].toLowerCase());
      else if (m[2] != null) names.push(m[2].toLowerCase());
      else if (m[3] != null) tags.push(m[3].toLowerCase());
      else if (m[4] != null) rest.push(m[4]);
    }
    return { tags, names, text: rest.join(' ').toLowerCase() };
  }

  // Does an entry satisfy a parsed query? Tags AND names AND freetext.
  function entryMatches(e, parsed) {
    const tags = (e.tags || []).map(t => t.toLowerCase());
    for (const t of parsed.tags) if (!tags.some(x => x.includes(t))) return false;
    if (parsed.names.length) {
      const en = extractNameTokens(e.body || '').map(x => x.toLowerCase());
      for (const n of parsed.names) if (!en.some(x => x.includes(n))) return false;
    }
    if (parsed.text && !(e.body || '').toLowerCase().includes(parsed.text)) return false;
    return true;
  }

  function applyUnifiedFilter(entries, query) {
    const parsed = parseSearchQuery(query);
    return entries.filter(e => entryMatches(e, parsed));
  }

  // Aggregate @[Name] references across all loaded entries: count, last-seen,
  // discussions, and recent excerpts. Registry names with zero mentions go last.
  function getAllNames() {
    const map = new Map();
    for (const n of state.names) map.set(n, { name: n, count: 0, lastSeen: null, discussions: new Set(), excerpts: [] });
    for (const [mname, m] of state.members) {
      if (!m) continue;
      for (const e of (m.entries || [])) {
        for (const nm of extractNameTokens(e.body || '')) {
          if (!map.has(nm)) map.set(nm, { name: nm, count: 0, lastSeen: null, discussions: new Set(), excerpts: [] });
          const rec = map.get(nm);
          rec.count++;
          rec.discussions.add(mname);
          if (!rec.lastSeen || (e.created_at || '') > rec.lastSeen) rec.lastSeen = e.created_at;
          rec.excerpts.push({ date: e.created_at, discussion: mname, body: e.body });
        }
      }
    }
    const arr = [...map.values()];
    arr.forEach(r => {
      r.discussions = [...r.discussions];
      r.excerpts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      r.excerpts = r.excerpts.slice(0, 10);
    });
    arr.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || '') || a.name.localeCompare(b.name));
    return arr;
  }

  /* ------------------------------ export ------------------------------- */

  Chippy.store = Object.assign(
    {
      subscribe, openFolder, selectMember, setActiveScreen, setTheme,
      toggleFavorite, reloadMember, setPrep, addEntry,
      setTaskState, cyclePriority, setDue, appendAction, toggleMute, isMuted,
      setGoalState, editEntry, getLinks, renameLink, moveEntry, deleteEntry,
      saveImage, getImageUrl,
      ensureAllLoaded, collectEntries, applyUnifiedFilter, getAllNames,
      // pure helpers exposed for the UI and for tests
      nowISO, mintGoalId, extractInlineTags, autoLinkUrls, extractNameTokens,
      splitTrailingActions, actionLabelFor, extractLinks, parseSearchQuery,
      _state: state
    },
    selectors
  );
})(typeof globalThis !== 'undefined' ? globalThis : this);
