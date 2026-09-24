// SPDX-License-Identifier: Apache-2.0
//
// chippy-tools.mjs — the Chippy MCP server's tools and JSON-RPC dispatcher.
//
// Loads the app's own classic scripts (format.js, taxonomy.js, io.js,
// store.js) under Node and points io.js at a real data folder through the
// node-fs-access.mjs shim. Every read and write therefore goes through exactly
// the same code the browser app uses — header format, write rules, action
// bullets, tag/name indexes, filename migration — nothing is re-implemented.
//
// Freshness: the folder is the source of truth and the app (or a sync client)
// may change it at any time, so every tool call first re-reads the folder
// (store.openFolder on the first call, store.reloadFolder afterwards). Tool
// calls are serialized, so a write always starts from what is on disk now.
//
// Sensitivity: Chippy's `sensitive` marker keeps entries and whole
// discussions out of AI summaries. The MCP server honors it the same way —
// sensitive data is hidden from every tool unless the server is started with
// --include-sensitive.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { NodeDirectoryHandle } from './node-fs-access.mjs';

import '../src/local/format.js';
import '../src/local/taxonomy.js';
import '../src/local/io.js';
import '../src/local/store.js';

const Chippy = globalThis.Chippy;
const store = Chippy.store;
const io = Chippy.io;
const T = Chippy.tags;

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function chippyVersion() {
  try {
    const main = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'local', 'main.js'), 'utf8');
    const m = main.match(/const VERSION = '([^']+)'/);
    return m ? m[1] : '0.0.0';
  } catch (_) { return '0.0.0'; }
}

/* ------------------------------ vocabulary ----------------------------- */

const KINDS = ['comment', 'task', 'followup', 'goal', 'idea'];
const PRIORITY_IN = { high: 'high', hi: 'high', medium: 'medium', mi: 'medium', low: 'low', lo: 'low' };

// Accepted spellings -> store state keys, per entry type.
const TASK_STATE_IN = {
  open: 'open', wip: 'inprogress', inprogress: 'inprogress', 'in progress': 'inprogress',
  chk: 'check', check: 'check', hold: 'onhold', onhold: 'onhold', 'on hold': 'onhold',
  prgt: 'purgatory', purgatory: 'purgatory', done: 'resolved', resolved: 'resolved',
  obsl: 'obsolete', obsolete: 'obsolete'
};
const GOAL_STATE_IN = { open: 'open', achieved: 'achieved', archived: 'achieved', canceled: 'canceled', cancelled: 'canceled' };
const IDEA_STATE_IN = { considered: 'considered', explored: 'explored', realized: 'realized', shelved: 'shelved' };

const IDEA_TAG_STATE = { exploredidea: 'Explored', promoteditea: 'Promoted', realizedidea: 'Realized', shelvedidea: 'Shelved' };

function stateOf(e) {
  const type = T.entryType(e);
  const tags = e.tags || [];
  if (type === 'task' || type === 'followup') return T.STATE_SQUARE[T.stateKeyOf(tags)][0];
  if (type === 'goal') {
    if (tags.includes('achievedgoal') || tags.includes('resolvedgoal')) return 'Achieved';
    if (tags.includes('canceledgoal')) return 'Canceled';
    return 'Open';
  }
  if (type === 'idea') {
    for (const t of tags) if (IDEA_TAG_STATE[t]) return IDEA_TAG_STATE[t];
    return 'Considered';
  }
  return null;
}

// true/false for stateful entries, null for plain comments.
function isOpen(e) {
  const s = stateOf(e);
  if (s == null) return null;
  return !['DONE', 'OBSL', 'Achieved', 'Canceled', 'Realized', 'Shelved'].includes(s);
}

class ToolError extends Error {}

// Any generation of the navigation file marks a folder Chippy has opened (io.js loadIndexes).
const NAV_FILES = ['navigation.sys.chippy.md', 'navigation.chippy.md', 'navigation.md'];

/* ------------------------------ server ---------------------------------- */

export function createChippyServer(opts) {
  const folder = path.resolve(opts.folder);
  const readOnly = !!opts.readOnly;
  const includeSensitive = !!opts.includeSensitive;
  const log = opts.log || ((...a) => console.error('[chippy-mcp]', ...a));

  const dirHandle = new NodeDirectoryHandle(folder);
  let opened = false;
  let queue = Promise.resolve();

  function serialized(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function refresh() {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      throw new ToolError('Chippy data folder not found: ' + folder);
    }
    // Only work on a folder Chippy has already set up — never initialize an
    // arbitrary folder someone pointed the server at by mistake.
    if (!NAV_FILES.some(f => fs.existsSync(path.join(folder, f)))) {
      throw new ToolError('Not a Chippy data folder (no navigation.sys.chippy.md): ' + folder + '. Open it once in the Chippy app first.');
    }
    // store.js is a process-wide singleton: (re)open when this server's folder
    // is not the one it currently holds.
    if (!opened || store._state.dirHandle !== dirHandle) {
      // io.openFolder() returns this injected handle instead of showing the
      // browser's folder picker (the same seam the headless tests use).
      globalThis.__chippyTest = Object.assign(globalThis.__chippyTest || {}, { dirHandle });
      await store.openFolder();
      opened = true;
    }
    await store.reloadFolder(); // fresh indexes + every discussion re-read from disk
  }

  const S = () => store._state;
  const navOf = (name) => S().nav.discussions.find(d => d.name === name);
  const discussionSensitive = (name) => !!(navOf(name) || {}).sensitive;
  const visible = (name, e) => includeSensitive || (!discussionSensitive(name) && !store.isSensitiveEntry(e));

  // Resolve a user-supplied discussion name: exact, case-insensitive, or file stem.
  function resolveDiscussion(input, { allowArchived = false } = {}) {
    const q = String(input || '').trim();
    if (!q) throw new ToolError('discussion is required');
    const all = S().nav.discussions;
    const lc = q.toLowerCase();
    const stem = io.sanitizeName(q.replace(/(\.archive)?\.chippy\.md$/i, ''));
    const d = all.find(x => x.name === q) ||
              all.find(x => x.name.toLowerCase() === lc) ||
              all.find(x => io.sanitizeName(x.name) === stem);
    const listable = all.filter(x => !x.archived && (includeSensitive || !x.sensitive)).map(x => x.name);
    if (!d || (d.sensitive && !includeSensitive)) {
      // A sensitive discussion is reported like a missing one: its name is not disclosed.
      if (d && d.sensitive) throw new ToolError('Discussion "' + q + '" is not available to AI tools (marked sensitive).');
      throw new ToolError('No discussion named "' + q + '". Known: ' + listable.join(', '));
    }
    if (d.archived && !allowArchived) throw new ToolError('Discussion "' + d.name + '" is archived.');
    const m = S().members.get(d.name);
    if (!m) throw new ToolError('Discussion "' + d.name + '" could not be loaded (file missing or not synced yet).');
    return { name: d.name, member: m };
  }

  // Locate an entry by (created_at, idx) — created_at alone is not unique.
  function locate(name, member, created_at, idx) {
    const entries = member.entries || [];
    if (typeof idx === 'number') {
      const e = entries[idx];
      if (e && (!created_at || e.created_at === created_at)) return { e, idx };
      if (!created_at) throw new ToolError('No entry at idx ' + idx + ' in "' + name + '".');
    }
    if (!created_at) throw new ToolError('created_at is required.');
    const hits = [];
    entries.forEach((e, i) => { if (e.created_at === created_at) hits.push(i); });
    if (!hits.length) throw new ToolError('No entry with created_at "' + created_at + '" in "' + name + '".');
    if (hits.length > 1) throw new ToolError('Several entries share created_at "' + created_at + '" (idx ' + hits.join(', ') + '); pass idx to choose.');
    return { e: entries[hits[0]], idx: hits[0] };
  }

  // Writes always target the origin of a linked entry, like the app does.
  async function locateForWrite(args) {
    const { name, member } = resolveDiscussion(args.discussion);
    const { e, idx } = locate(name, member, args.created_at, args.idx);
    if (!visible(name, e)) throw new ToolError('That entry is marked sensitive and is not available to AI tools.');
    if (store.isReference(e, name)) {
      const r = await store.resolveOrigin(e);
      if (r.broken) throw new ToolError('This is a reference to a linked entry whose origin cannot be found.');
      if (!visible(r.name, r.entry)) throw new ToolError('The origin of this linked entry is marked sensitive.');
      return { name: r.name, member: r.member, e: r.entry, idx: r.idx };
    }
    return { name, member, e, idx };
  }

  function view(name, e, idx, { full = true } = {}) {
    const parts = store.splitBodyParts(e.body || '');
    const tags = e.tags || [];
    const out = {
      discussion: name,
      created_at: e.created_at,
      idx,
      type: T.entryType(e),
      state: stateOf(e),
      priority: T.PRIO_LABEL[T.priorityOf(tags)] || null,
      due: e.due || null,
      tags: tags.filter(t => !T.isReserved(t))
    };
    const lt = T.linkTagOf(tags);
    if (lt) {
      out.link = lt;
      if (store.isReference(e, name)) out.reference_to = T.parseLinkTag(lt).stem;
    }
    const gid = tags.find(t => /^goal-[a-z0-9]{5}$/.test(t));
    if (gid) out.goal_id = gid;
    if (e.goal) out.goal = e.goal;
    if (tags.some(t => t.startsWith('muted:'))) out.muted = store.isMuted(e);
    out.text = full ? parts.comment : parts.comment.split('\n')[0].slice(0, 200);
    if (full) {
      if (parts.updated) out.updated = parts.updated.replace(/^Updated: /, '');
      if (parts.bullets.length) out.actions = parts.bullets.map(b => b.slice(2));
      if (parts.markers.length) out.markers = parts.markers;
    }
    return out;
  }

  function cleanTags(list) {
    const out = [];
    for (const raw of list || []) {
      const t = String(raw).trim().replace(/^#/, '').toLowerCase();
      if (!t) continue;
      if (/[,|\n]/.test(t)) throw new ToolError('Tags may not contain ",", "|" or line breaks: ' + raw);
      if (T.isReserved(t)) throw new ToolError('"' + t + '" is a reserved tag managed by Chippy; use kind/priority/state instead.');
      if (!out.includes(t)) out.push(t);
    }
    return out;
  }

  function checkDue(due) {
    if (due == null || due === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due))) throw new ToolError('due must be YYYY-MM-DD');
    return String(due);
  }

  function checkPriority(p) {
    const v = PRIORITY_IN[String(p).toLowerCase()];
    if (!v) throw new ToolError('priority must be high, medium or low');
    return v;
  }

  function sortEntries(list, sort) {
    const byCreated = (a, b) => a.created_at.localeCompare(b.created_at) || a.idx - b.idx;
    if (sort === 'oldest') return list.sort(byCreated);
    if (sort === 'priority') {
      const rank = p => ({ HI: 0, MI: 1, LO: 2 }[p] ?? 3);
      return list.sort((a, b) => rank(a.priority) - rank(b.priority) || byCreated(a, b));
    }
    return list.sort((a, b) => byCreated(b, a));
  }

  async function applyState(name, e, idx, wanted) {
    const type = T.entryType(e);
    const w = String(wanted || '').trim().toLowerCase();
    if (type === 'task' || type === 'followup') {
      const key = TASK_STATE_IN[w];
      if (!key) throw new ToolError('Task states: OPEN, WIP, CHK, HOLD, PRGT, DONE, OBSL.');
      await store.setTaskState(name, e.created_at, key, idx);
    } else if (type === 'goal') {
      const key = GOAL_STATE_IN[w];
      if (!key) throw new ToolError('Goal states: Open, Achieved, Canceled.');
      await store.setGoalState(name, e.created_at, key, idx);
    } else if (type === 'idea') {
      if (w === 'promoted') throw new ToolError('Ideas become Promoted by creating a task or goal from them — use promote_idea.');
      const key = IDEA_STATE_IN[w];
      if (!key) throw new ToolError('Idea states: Considered, Explored, Realized, Shelved (Promoted via promote_idea).');
      await store.updateIdeaState(name, e.created_at, key, idx);
    } else {
      throw new ToolError('Plain comments have no state.');
    }
  }

  /* ------------------------------ tools --------------------------------- */

  const entryRef = {
    discussion: { type: 'string', description: 'Discussion name (as returned by list_discussions).' },
    created_at: { type: 'string', description: 'The entry\'s created_at timestamp, e.g. "2026-09-20 14:03:11".' },
    idx: { type: 'integer', minimum: 0, description: 'The entry\'s idx from a previous result. Needed when several entries share created_at.' }
  };

  const tools = [
    {
      name: 'list_discussions',
      description: 'List the discussions in the Chippy notebook with their sidebar group, flags and counts of entries and open tasks/ideas/goals.',
      inputSchema: { type: 'object', properties: {
        include_archived: { type: 'boolean', description: 'Also list archived discussions (without counts). Default false.' }
      } },
      async run(a) {
        const rows = [];
        for (const d of S().nav.discussions) {
          if (d.archived && !a.include_archived) continue;
          if (d.sensitive && !includeSensitive) continue;
          const row = { name: d.name, group: d.tag || null };
          if (d.favorite) row.favorite = true;
          if (d.archived) { row.archived = true; rows.push(row); continue; }
          const m = S().members.get(d.name);
          if (!m) { row.unreadable = true; rows.push(row); continue; }
          const es = m.entries.filter(e => visible(d.name, e) && !store.isReference(e, d.name));
          const open = k => es.filter(e => k.includes(T.entryType(e)) && isOpen(e)).length;
          row.entries = es.length;
          row.open_tasks = open(['task', 'followup']);
          row.open_ideas = open(['idea']);
          row.open_goals = open(['goal']);
          if (es.length) row.last_entry = es.reduce((x, e) => (e.created_at > x ? e.created_at : x), '');
          rows.push(row);
        }
        return { discussions: rows };
      }
    },
    {
      name: 'read_discussion',
      description: 'Read one discussion: its preparation notes and its entries (oldest first) with type, state, priority, due date, tags, text and dated actions. Use created_at + idx from here to address an entry in the write tools.',
      inputSchema: { type: 'object', required: ['discussion'], properties: {
        discussion: entryRef.discussion,
        include_closed: { type: 'boolean', description: 'Include DONE/OBSL tasks, closed goals and realized/shelved ideas. Default true.' },
        last: { type: 'integer', minimum: 1, description: 'Only the most recent N entries.' }
      } },
      async run(a) {
        const { name, member } = resolveDiscussion(a.discussion);
        let list = member.entries.map((e, i) => [e, i]).filter(([e]) => visible(name, e));
        if (a.include_closed === false) list = list.filter(([e]) => isOpen(e) !== false);
        if (a.last) list = list.slice(-a.last);
        return {
          discussion: name,
          group: (navOf(name) || {}).tag || null,
          prep: member.prep || '',
          entries: list.map(([e, i]) => view(name, e, i))
        };
      }
    },
    {
      name: 'search_entries',
      description: 'Search entries across all discussions. `query` uses Chippy\'s search syntax: #tag, @Name or @[Full Name], and free text (all must match). A linked entry appears once, at its origin.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'e.g. "#dev", "@[Anna Wehrli] budget", "deploy". Empty matches everything.' },
        type: { type: 'string', enum: ['any', ...KINDS], description: 'Entry type filter. Default any.' },
        open_only: { type: 'boolean', description: 'Only open tasks/followups/goals/ideas. Default false.' },
        state: { type: 'string', description: 'Exact state label, e.g. OPEN, WIP, HOLD, Explored.' },
        discussion: { type: 'string', description: 'Limit to one discussion.' },
        sort: { type: 'string', enum: ['newest', 'oldest', 'priority'], description: 'priority = HI, MI, LO, oldest first within a priority. Default newest.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 50.' },
        full: { type: 'boolean', description: 'Return full text and actions instead of the first line. Default false.' }
      } },
      async run(a) {
        let entries = store.collectEntries();
        if (a.discussion) {
          const { name } = resolveDiscussion(a.discussion);
          entries = entries.filter(e => e._member === name);
        }
        entries = entries.filter(e => visible(e._member, e) && !(navOf(e._member) || {}).archived);
        if (a.query) entries = store.applyUnifiedFilter(entries, a.query);
        if (a.type && a.type !== 'any') entries = entries.filter(e => T.entryType(e) === a.type);
        if (a.open_only) entries = entries.filter(e => isOpen(e) === true);
        if (a.state) entries = entries.filter(e => (stateOf(e) || '').toLowerCase() === String(a.state).toLowerCase());
        const views = sortEntries(entries.map(e => view(e._member, e, e._idx, { full: !!a.full })), a.sort);
        return { total: views.length, entries: views.slice(0, a.limit || 50) };
      }
    },
    {
      name: 'add_entry',
      write: true,
      description: 'Append a new entry to a discussion with Chippy\'s write rules (timestamp, default priority LO for tasks/goals/ideas, goal id, tag and name indexes). Optional initial state, e.g. HOLD for a proposal the user should approve first.',
      inputSchema: { type: 'object', required: ['discussion', 'text'], properties: {
        discussion: entryRef.discussion,
        text: { type: 'string', description: 'Entry body (Markdown). Mention people as @[Full Name].' },
        kind: { type: 'string', enum: KINDS, description: 'Default comment.' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        due: { type: 'string', description: 'YYYY-MM-DD' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Free-form tags, e.g. ["dev"]. Reserved tags are rejected.' },
        state: { type: 'string', description: 'Initial state, e.g. HOLD for a task or Explored for an idea.' }
      } },
      async run(a) {
        const { name } = resolveDiscussion(a.discussion);
        const text = String(a.text || '').trim();
        if (!text) throw new ToolError('text must not be empty');
        const kind = a.kind || 'comment';
        if (!KINDS.includes(kind)) throw new ToolError('kind must be one of ' + KINDS.join(', '));
        const tags = cleanTags(a.tags);
        if (kind !== 'comment') tags.unshift(kind);
        if (a.priority) {
          if (kind === 'comment') throw new ToolError('priority applies to tasks, followups, goals and ideas');
          tags.push(checkPriority(a.priority));
        }
        if (a.state && kind === 'comment') throw new ToolError('Plain comments have no state.');
        const due = checkDue(a.due);
        const created = await store.addEntry(name, { text, tags, due });
        if (!created) throw new ToolError('The entry was not created (empty text).');
        const m = S().members.get(name);
        const idx = m.entries.lastIndexOf(created);
        if (a.state) {
          const w = String(a.state).trim().toLowerCase();
          const isDefault = kind === 'idea' ? w === 'considered' : w === 'open';
          if (!isDefault) await applyState(name, created, idx, a.state);
        }
        return { created: view(name, m.entries[idx], idx) };
      }
    },
    {
      name: 'set_state',
      write: true,
      description: 'Change the state of a task/followup (OPEN, WIP, CHK, HOLD, PRGT, DONE, OBSL), goal (Open, Achieved, Canceled) or idea (Considered, Explored, Realized, Shelved). Logs a dated "→ STATE" action like the app. For a linked reference, the origin entry is changed.',
      inputSchema: { type: 'object', required: ['discussion', 'created_at', 'state'], properties: {
        ...entryRef, state: { type: 'string' }
      } },
      async run(a) {
        const t = await locateForWrite(a);
        await applyState(t.name, t.e, t.idx, a.state);
        return { updated: view(t.name, t.e, t.idx) };
      }
    },
    {
      name: 'append_action',
      write: true,
      description: 'Append a dated action bullet ("- YYYY-MM-DD : text") to an entry\'s action log, for progress notes, decisions and results.',
      inputSchema: { type: 'object', required: ['discussion', 'created_at', 'text'], properties: {
        ...entryRef, text: { type: 'string', description: 'One line; line breaks are joined.' }
      } },
      async run(a) {
        const t = await locateForWrite(a);
        const text = String(a.text || '').replace(/\s*\n\s*/g, ' ').trim();
        if (!text) throw new ToolError('text must not be empty');
        await store.appendAction(t.name, t.e.created_at, text, t.idx);
        return { updated: view(t.name, t.e, t.idx) };
      }
    },
    {
      name: 'update_entry',
      write: true,
      description: 'Change an entry\'s text, priority, due date or free-form tags. A text edit replaces only the comment part and keeps the action log; on a later day an "Updated:" line is written, like in the app.',
      inputSchema: { type: 'object', required: ['discussion', 'created_at'], properties: {
        ...entryRef,
        text: { type: 'string' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        due: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null / "" to clear.' },
        add_tags: { type: 'array', items: { type: 'string' } },
        remove_tags: { type: 'array', items: { type: 'string' } }
      } },
      async run(a) {
        const t = await locateForWrite(a);
        const type = T.entryType(t.e);
        const add = cleanTags(a.add_tags);
        const remove = cleanTags(a.remove_tags);
        const prio = a.priority ? checkPriority(a.priority) : null;
        if (prio && type === 'comment') throw new ToolError('priority applies to tasks, followups, goals and ideas');
        const due = 'due' in a ? checkDue(a.due) : undefined;
        if (a.text != null && !String(a.text).trim()) throw new ToolError('text must not be empty');
        const opts = {};
        if (prio || add.length || remove.length) {
          const tags = t.e.tags.filter(x => !remove.includes(x));
          for (const x of add) if (!tags.includes(x)) tags.push(x);
          if (prio) tags.push(prio); // applyEditTagRules: the last priority wins
          opts.tags = tags;
        }
        if (a.text != null) opts.text = a.text;
        if (opts.tags || opts.text != null) await store.editEntry(t.name, t.e.created_at, opts, t.idx);
        if (due !== undefined) await store.setDue(t.name, t.e.created_at, due, t.idx);
        return { updated: view(t.name, t.e, t.idx) };
      }
    },
    {
      name: 'promote_idea',
      write: true,
      description: 'Create a task (from an Explored or Promoted idea) or a goal (from a Promoted idea) in the same discussion. The idea becomes Promoted and both entries get cross-linking action bullets, exactly like the app\'s → Task… / → Goal… menu.',
      inputSchema: { type: 'object', required: ['discussion', 'created_at', 'kind'], properties: {
        ...entryRef,
        kind: { type: 'string', enum: ['task', 'goal'] },
        title: { type: 'string', description: 'Text of the new task/goal. Defaults to the idea\'s first line.' }
      } },
      async run(a) {
        const t = await locateForWrite(a);
        if (T.entryType(t.e) !== 'idea') throw new ToolError('That entry is not an idea.');
        const st = stateOf(t.e);
        if (a.kind === 'task' && !['Explored', 'Promoted'].includes(st)) throw new ToolError('Tasks can be created from Explored or Promoted ideas (this one is ' + st + ').');
        if (a.kind === 'goal' && st !== 'Promoted') throw new ToolError('Goals can only be created from Promoted ideas (this one is ' + st + ').');
        if (a.kind !== 'task' && a.kind !== 'goal') throw new ToolError('kind must be task or goal');
        const created = await store.promoteIdea(t.name, t.e.created_at, a.kind, a.title, t.idx);
        if (!created) throw new ToolError('Promotion was refused.');
        const m = S().members.get(t.name);
        return { idea: view(t.name, t.e, m.entries.indexOf(t.e)), created: view(t.name, created, m.entries.lastIndexOf(created)) };
      }
    },
    {
      name: 'create_discussion',
      write: true,
      description: 'Create a new, empty discussion. A taken name gets a _2, _3… suffix, like in the app.',
      inputSchema: { type: 'object', required: ['name'], properties: {
        name: { type: 'string' }
      } },
      async run(a) {
        const name = String(a.name || '').trim();
        if (!name) throw new ToolError('name must not be empty');
        const before = new Set(S().nav.discussions.map(d => d.name));
        try { await store.createDiscussion(name); }
        catch (err) { throw new ToolError(err && err.message || String(err)); }
        const created = S().nav.discussions.find(d => !before.has(d.name));
        if (!created) throw new ToolError('The discussion was not created.');
        return { created: created.name, file: io.discussionFilename(io.sanitizeName(created.name)) };
      }
    }
  ];

  const active = tools.filter(t => !(readOnly && t.write));
  const byName = new Map(active.map(t => [t.name, t]));

  async function callTool(name, args) {
    const tool = byName.get(name);
    if (!tool) return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
    try {
      const result = await serialized(async () => { await refresh(); return tool.run(args || {}); });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
    } catch (err) {
      if (!(err instanceof ToolError)) log('tool ' + name + ' failed:', (err && err.stack) || err);
      return { content: [{ type: 'text', text: 'Error: ' + ((err && err.message) || String(err)) }], isError: true };
    }
  }

  const instructions =
    'Chippy is a personal Markdown notebook organised in discussions. Entries are comments, tasks, followups, goals and ideas. ' +
    'Address an entry by discussion + created_at + idx, as returned by read_discussion or search_entries. ' +
    'Prefer append_action for progress notes over rewriting an entry\'s text. ' +
    'When proposing new work for the user, create tasks with state HOLD so the user can approve them.' +
    (readOnly ? ' This server is read-only.' : '');

  /* --------------------------- JSON-RPC dispatch --------------------------- */

  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  // One incoming JSON-RPC message -> the response object, or null when none is due.
  async function handle(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      return fail(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid Request');
    }
    if (typeof msg.method !== 'string') return null; // a response — this server sends no requests
    if (msg.id === undefined || msg.id === null) return null; // notification: initialized, cancelled, …
    const p = msg.params || {};
    switch (msg.method) {
      case 'initialize': {
        const v = PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0];
        return ok(msg.id, {
          protocolVersion: v,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'chippy', title: 'Chippy notebook', version: chippyVersion() },
          instructions
        });
      }
      case 'ping':
        return ok(msg.id, {});
      case 'tools/list':
        return ok(msg.id, { tools: active.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !t.write, destructiveHint: false, idempotentHint: !t.write, openWorldHint: false }
        })) });
      case 'tools/call':
        if (!p.name || !byName.has(p.name)) return fail(msg.id, -32602, 'Unknown tool: ' + p.name);
        return ok(msg.id, await callTool(p.name, p.arguments));
      default:
        return fail(msg.id, -32601, 'Method not found: ' + msg.method);
    }
  }

  return { handle, callTool, tools: active, folder, readOnly, includeSensitive };
}
