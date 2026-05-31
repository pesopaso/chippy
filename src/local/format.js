// SPDX-License-Identifier: Apache-2.0
//
// format.js — persistence layer: pure parse/serialize transforms.
//
// No I/O, no DOM — importable in Node so the regression harness can wire to it.
// The on-disk format is specified in ../../documentation/datadefinition.md and
// pinned byte-for-byte by ../../regressionharness. Serialization must round-trip
// canonical files exactly: serialize(parse(file)) === file.
//
// Files in LF. Discussion layout:
//   # <name>
//   <optional legacy "> Tag:/Group:/Archived:" lines — read, never written>
//   ## Preparation
//
//   <prep lines, may be empty>
//   ## Entries
//
//   ### <created_at> | tags: a, b | goal: <text> | due: <YYYY-MM-DD>
//
//   <body>
//
//   ### ...

/* ----------------------------- helpers --------------------------------- */

function stripBlankEdges(s) {
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

/* --------------------------- discussion -------------------------------- */

function parseEntryHeader(headerText, body) {
  const parts = headerText.split(' | ');
  const created_at = parts[0];
  let tags = [];
  let goal = null;
  let due = null;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('tags:')) {
      const v = p.slice('tags:'.length).trim();
      tags = v ? v.split(', ').filter(Boolean) : [];
    } else if (p.startsWith('goal: ')) {
      goal = p.slice('goal: '.length);
    } else if (p.startsWith('due: ')) {
      due = p.slice('due: '.length);
    }
  }
  return { created_at, tags, goal, due, body };
}

function serializeEntryHeader(e) {
  let h = e.created_at;
  if (e.tags && e.tags.length) h += ' | tags: ' + e.tags.join(', ');
  if (e.goal != null) h += ' | goal: ' + e.goal;
  if (e.due != null) h += ' | due: ' + e.due;
  return h;
}

export function parseDiscussion(md, filename) {
  const lines = md.split('\n');

  // Title — first "# " line.
  let name = '';
  for (const l of lines) {
    if (l.startsWith('# ')) { name = l.slice(2); break; }
  }
  if (!name && filename) name = String(filename).replace(/\.md$/i, '');

  const prepIdx = lines.findIndex(l => l === '## Preparation');
  const entriesIdx = lines.findIndex(l => l === '## Entries');

  // Legacy metadata (read-only; never re-serialized).
  let group = null;
  let archived = false;
  const metaEnd = prepIdx === -1 ? lines.length : prepIdx;
  for (let k = 0; k < metaEnd; k++) {
    const m = lines[k].match(/^> (?:Tag|Group): (.+)$/);
    if (m) group = m[1];
    if (/^> Archived:\s*true\s*$/i.test(lines[k])) archived = true;
  }

  // Preparation block.
  let prep = '';
  if (prepIdx !== -1 && entriesIdx !== -1 && entriesIdx > prepIdx) {
    prep = stripBlankEdges(lines.slice(prepIdx + 1, entriesIdx).join('\n'));
  }

  // Entries — split on lines beginning with "### ".
  const entries = [];
  if (entriesIdx !== -1) {
    let cur = null;
    for (let k = entriesIdx + 1; k < lines.length; k++) {
      const l = lines[k];
      if (l.startsWith('### ')) {
        if (cur) entries.push(cur);
        cur = { header: l.slice(4), bodyLines: [] };
      } else if (cur) {
        cur.bodyLines.push(l);
      }
    }
    if (cur) entries.push(cur);
  }

  const parsedEntries = entries.map(e =>
    parseEntryHeader(e.header, stripBlankEdges(e.bodyLines.join('\n')))
  );

  return { name, group, archived, prep, entries: parsedEntries };
}

export function serializeDiscussion(member) {
  let out = '# ' + member.name + '\n\n## Preparation\n\n';
  if (member.prep) out += member.prep + '\n';
  out += '\n## Entries\n\n';
  for (const e of member.entries) {
    out += '### ' + serializeEntryHeader(e) + '\n\n' + e.body + '\n\n';
  }
  return out;
}

/* ----------------------------- navigation ------------------------------ */

function sliceSection(md, heading) {
  // Return the lines under `heading` (e.g. "## Discussions") up to the next
  // "## " heading or end of file.
  const lines = md.split('\n');
  const start = lines.findIndex(l => l === heading);
  if (start === -1) return [];
  const out = [];
  for (let k = start + 1; k < lines.length; k++) {
    if (lines[k].startsWith('## ')) break;
    out.push(lines[k]);
  }
  return out;
}

export function parseNav(md) {
  let theme = 'dark';
  const tm = md.match(/^> theme: (.+)$/m);
  if (tm) theme = tm[1].trim();

  const discussions = [];
  for (const line of sliceSection(md, '## Discussions')) {
    if (!line.startsWith('- ')) continue;
    const parts = line.slice(2).split(' | ');
    const d = { name: parts[0], tag: null, favorite: false, archived: false };
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith('tag: ')) d.tag = p.slice('tag: '.length);
      else if (p === 'favorite') d.favorite = true;
      else if (p === 'archived') d.archived = true;
    }
    discussions.push(d);
  }
  return { discussions, theme };
}

export function serializeNav(nav) {
  let out = '# Navigation\n\n';
  if (nav.theme && nav.theme !== 'dark') out += '> theme: ' + nav.theme + '\n\n';
  out += '## Discussions\n\n';
  for (const d of nav.discussions) {
    let line = '- ' + d.name;
    if (d.tag) line += ' | tag: ' + d.tag;
    if (d.favorite) line += ' | favorite';
    if (d.archived) line += ' | archived';
    out += line + '\n';
  }
  return out;
}

/* --------------------------- tags / names ------------------------------ */

function parseBulletList(md) {
  const out = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('- ')) out.push(line.slice(2));
  }
  return out;
}

function serializeBulletList(title, arr) {
  return '# ' + title + '\n\n' + arr.map(x => '- ' + x).join('\n') + '\n';
}

export function parseTags(md) { return parseBulletList(md); }
export function serializeTags(tags) { return serializeBulletList('Tags', tags); }
export function parseNames(md) { return parseBulletList(md); }
export function serializeNames(names) { return serializeBulletList('Names', names); }

/* --------------------- legacy single-file migration -------------------- */

// Older folders kept the tag union and name list inline in navigation.md as
// "## Tags" / "## Names" sections (datadefinition §3.4). When the dedicated
// tags.md / names.md files are absent, io.js reads those inline sections via
// this helper and writes them out to the split files.
export function migrateLegacyNav(md) {
  const nav = parseNav(md);
  const tags = sliceSection(md, '## Tags')
    .filter(l => l.startsWith('- ')).map(l => l.slice(2));
  const names = sliceSection(md, '## Names')
    .filter(l => l.startsWith('- ')).map(l => l.slice(2));
  return { discussions: nav.discussions, theme: nav.theme, tags, names };
}

/* ------------------------------ summary -------------------------------- */

// summary.md (datadefinition §4): "> api_url:" / "> api_model:" config lines,
// then one "### <created_at> | range: <r> | id: <id> [| model: <m>] [| tokens: <t>]"
// card per saved summary, each followed by its verbatim body.
export function parseSummary(md) {
  const result = { api_url: null, api_model: null, summaries: [] };
  const urlM = md.match(/^> api_url:\s*(.+)$/m);
  const modelM = md.match(/^> api_model:\s*(.+)$/m);
  if (urlM) result.api_url = urlM[1].trim();
  if (modelM) result.api_model = modelM[1].trim();

  const lines = md.split('\n');
  let cur = null;
  for (const l of lines) {
    if (l.startsWith('### ')) {
      if (cur) result.summaries.push(cur);
      const parts = l.slice(4).split(' | ');
      cur = { created_at: parts[0], range: null, id: null, model: null, tokens: null, bodyLines: [] };
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith('range: ')) cur.range = p.slice('range: '.length);
        else if (p.startsWith('id: ')) cur.id = p.slice('id: '.length);
        else if (p.startsWith('model: ')) cur.model = p.slice('model: '.length);
        else if (p.startsWith('tokens: ')) cur.tokens = p.slice('tokens: '.length);
      }
    } else if (cur) {
      cur.bodyLines.push(l);
    }
  }
  if (cur) result.summaries.push(cur);
  for (const s of result.summaries) {
    s.body = stripBlankEdges((s.bodyLines || []).join('\n'));
    delete s.bodyLines;
  }
  return result;
}

export function serializeSummary(s) {
  let out = '';
  if (s.api_url != null) out += '> api_url: ' + s.api_url + '\n';
  if (s.api_model != null) out += '> api_model: ' + s.api_model + '\n';
  if (out) out += '\n';
  for (const c of (s.summaries || [])) {
    let h = '### ' + c.created_at + ' | range: ' + c.range + ' | id: ' + c.id;
    if (c.model != null) h += ' | model: ' + c.model;
    if (c.tokens != null) h += ' | tokens: ' + c.tokens;
    out += h + '\n\n' + c.body + '\n\n';
  }
  return out;
}
