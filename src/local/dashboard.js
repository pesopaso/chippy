// SPDX-License-Identifier: Apache-2.0
//
// dashboard.js — the Activity view (classic script → window.Chippy.dashboard).
// Hand-rolled SVG charts, no external library. Depends only on Chippy.store
// (selectors) and Chippy.ui. Aggregations are pure and unit-tested.

(function (root) {
  const Chippy = (root.Chippy = root.Chippy || {});
  const store = () => Chippy.store;

  const SVGNS = 'http://www.w3.org/2000/svg';

  /* --------------------------- aggregations ---------------------------- */

  // Tag taxonomy lives in taxonomy.js (Chippy.tags); aliased here for brevity.
  const entryType = Chippy.tags.entryType;
  const stateKeyOf = Chippy.tags.stateKeyOf;
  function withinRange(dateStr, range) {
    if (range === 'all') return true;
    const d = new Date(String(dateStr).replace(' ', 'T'));
    if (isNaN(d)) return false;
    const days = { week: 7, month: 30, quarter: 91, year: 365 }[range];
    const cut = new Date(); cut.setDate(cut.getDate() - days);
    return d >= cut;
  }
  const linkCount = body => ((String(body).match(/\[[^\]]+\]\(([^)]+)\)/g) || []).length);
  const imageCount = body => ((String(body).match(/!\[[^\]]*\]\(/g) || []).length);

  function inflowByRange(entries, range) {
    const c = { comment: 0, task: 0, followup: 0, goal: 0, idea: 0 };
    for (const e of entries) if (withinRange(e.created_at, range)) c[entryType(e)]++;
    return c;
  }
  function taskStateCounts(entries) {
    const c = { open: 0, inprogress: 0, check: 0, onhold: 0, purgatory: 0, resolved: 0, obsolete: 0 };
    for (const e of entries) {
      const t = e.tags || [];
      if (t.includes('task') || t.includes('followup')) c[stateKeyOf(t)]++;
    }
    return c;
  }
  function goalStateCounts(entries) {
    const c = { open: 0, achieved: 0, canceled: 0 };
    for (const e of entries) {
      const t = e.tags || [];
      if (!t.includes('goal')) continue;
      if (t.includes('achievedgoal')) c.achieved++;
      else if (t.includes('canceledgoal')) c.canceled++;
      else c.open++;
    }
    return c;
  }
  function ideaStateCounts(entries) {
    const c = { considered: 0, explored: 0, promoted: 0, shelved: 0 };
    for (const e of entries) {
      const t = e.tags || [];
      if (!t.includes('idea')) continue;
      if (t.includes('exploredidea')) c.explored++;
      else if (t.includes('promoteditea')) c.promoted++;
      else if (t.includes('shelvedidea')) c.shelved++;
      else c.considered++;
    }
    return c;
  }
  function monthlyTimeline(entries) {
    const map = new Map();
    const row = mo => {
      if (!map.has(mo)) map.set(mo, { month: mo, comments: 0, tasks: 0, ideas: 0, links: 0, images: 0, actions: 0, stateChanges: 0 });
      return map.get(mo);
    };
    // A dated action bullet: "- YYYY-MM-DD : text"; a "→ " right after the
    // colon marks a state-change bullet. Each is counted in the month of ITS
    // OWN date (an action logged in June on a March task belongs to June).
    const BULLET = /^- (\d{4}-\d{2})-\d{2} : (→ )?/gm;
    for (const e of entries) {
      const mo = (e.created_at || '').slice(0, 7);
      if (!mo) continue;
      const r = row(mo);
      const ty = entryType(e);
      if (ty === 'comment') r.comments++;
      else if (ty === 'task' || ty === 'followup') r.tasks++;
      else if (ty === 'idea') r.ideas++;
      r.links += linkCount(e.body);
      r.images += imageCount(e.body);
      let m;
      BULLET.lastIndex = 0;
      while ((m = BULLET.exec(String(e.body || '')))) {
        const br = row(m[1]);
        if (m[2]) br.stateChanges++; else br.actions++;
      }
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }
  function cumulative(entries) {
    const tl = monthlyTimeline(entries);
    let total = 0;
    return tl.map(r => { total += r.comments + r.tasks; return { month: r.month, total }; });
  }

  // Consecutive YYYY-MM strings from start to end inclusive.
  function monthsBetween(start, end) {
    const out = []; let [y, m] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }
  // Tasks over time by state: rebuild each task's state history from its dated
  // action bullets ("- YYYY-MM-DD : → WIP") plus legacy Resolved:/Obsolete:
  // markers, then sample the whole population at the end of every month. DONE
  // and OBSL are excluded from the chart by design.
  //
  // Robustness to the past — state-change actions were introduced later, so
  // history can be incomplete:
  //   - a task WITH recorded transitions is assumed OPEN from creation until
  //     its first one (every task starts open);
  //   - a task with NO recorded history is assumed to have held its CURRENT
  //     state since creation — so a long-closed task without records never
  //     fabricates an open period in the past;
  //   - if the reconstructed history disagrees with the current tag state
  //     (changes made before action logging, hand-edited files), a synthetic
  //     transition today snaps the final sample to the truth, keeping this
  //     chart consistent with the "Task states" pie.
  const ACTION_TO_KEY = { OPEN: 'open', WIP: 'inprogress', CHK: 'check', HOLD: 'onhold', PRGT: 'purgatory', DONE: 'resolved', OBSL: 'obsolete' };
  const AREA_STATES = [
    ['open', '--orange', 'OPEN'], ['inprogress', '--state-wip', 'WIP'],
    ['check', '--state-chk', 'CHK'], ['onhold', '--yellow', 'HOLD'],
    ['purgatory', '--muted', 'PRGT']
  ];

  // One task's dated state history: [{date: 'YYYY-MM-DD', key}] sorted, first
  // entry at creation. Returns null when the entry has no usable created_at.
  function taskTransitions(e, todayDay) {
    const created = (e.created_at || '').slice(0, 10);
    if (!created) return null;
    const cur = stateKeyOf(e.tags || []);
    const tr = [];
    let m;
    const act = /^- (\d{4}-\d{2}-\d{2}) : → (OPEN|WIP|CHK|HOLD|PRGT|DONE|OBSL)$/gm;
    while ((m = act.exec(e.body || ''))) tr.push({ date: m[1], key: ACTION_TO_KEY[m[2]] });
    const legacy = /(Resolved|Obsolete): (\d{4}-\d{2}(?:-\d{2})?)/g;
    while ((m = legacy.exec(e.body || ''))) {
      tr.push({ date: m[2].length === 7 ? m[2] + '-01' : m[2], key: m[1] === 'Obsolete' ? 'obsolete' : 'resolved' });
    }
    tr.sort((a, b) => a.date.localeCompare(b.date));
    tr.unshift({ date: created, key: tr.length ? 'open' : cur });
    if (tr[tr.length - 1].key !== cur) tr.push({ date: todayDay, key: cur });
    return { created, tr };
  }

  function taskStatesOverTime(entries, todayDay) {
    todayDay = todayDay || new Date().toISOString().slice(0, 10);
    const tasks = [];
    for (const e of entries) {
      const t = e.tags || [];
      if (!(t.includes('task') || t.includes('followup'))) continue;
      const x = taskTransitions(e, todayDay);
      if (x) tasks.push(x);
    }
    if (!tasks.length) return [];
    const first = tasks.map(t => t.created.slice(0, 7)).sort()[0];
    return monthsBetween(first, todayDay.slice(0, 7)).map(mo => {
      const sample = mo + '-99'; // string-sorts after every real day of the month
      const row = { month: mo, open: 0, inprogress: 0, check: 0, onhold: 0, purgatory: 0 };
      for (const { created, tr } of tasks) {
        if (created > sample) continue;
        let key = null;
        for (const t of tr) { if (t.date <= sample) key = t.key; else break; }
        if (key != null && row[key] !== undefined) row[key]++;
      }
      return row;
    });
  }

  // Tasks grouped by the ISO week (Monday) they were created in, counted by current state, for a
  // stacked per-week bar chart.
  const EXEC_STATES = [
    ['open', '--orange', 'OPEN'], ['inprogress', '--state-wip', 'WIP'],
    ['check', '--state-chk', 'CHK'], ['onhold', '--yellow', 'HOLD'],
    ['purgatory', '--muted', 'PRGT'], ['resolved', '--green', 'DONE'],
    ['obsolete', '--border', 'OBSL']
  ];
  // The Monday (YYYY-MM-DD) of the ISO week containing the given day.
  // All date math here is UTC-only: mixing a LOCAL-midnight Date with
  // toISOString() (UTC) shifts the day for every timezone ahead of UTC, which
  // made bucket keys and the filled week list disagree — and the chart empty.
  function weekOf(dayStr) {
    const d = new Date(String(dayStr) + 'T00:00:00Z');
    if (isNaN(d)) return null;
    const shift = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    d.setUTCDate(d.getUTCDate() - shift);
    return d.toISOString().slice(0, 10);
  }
  // Consecutive week-start (Monday) YYYY-MM-DD strings from start to end inclusive.
  function weeksBetween(start, end) {
    const out = [];
    const d = new Date(start + 'T00:00:00Z'), e = new Date(end + 'T00:00:00Z');
    let guard = 0;
    while (d <= e && guard++ < 600) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
    return out;
  }
  function emptyExecRow(week) {
    const r = { week, total: 0 };
    for (const [k] of EXEC_STATES) r[k] = 0;
    return r;
  }
  function taskExecution(entries) {
    const map = new Map();
    for (const e of entries) {
      const t = e.tags || [];
      if (!(t.includes('task') || t.includes('followup'))) continue;
      const week = weekOf((e.created_at || '').slice(0, 10));
      if (!week) continue;
      if (!map.has(week)) map.set(week, emptyExecRow(week));
      const r = map.get(week);
      r[stateKeyOf(t)]++; r.total++;
    }
    const weeks = [...map.keys()].sort();
    if (!weeks.length) return [];
    // Fill every calendar week in the span, so weeks with no tasks show as gaps.
    return weeksBetween(weeks[0], weeks[weeks.length - 1]).map(w => map.get(w) || emptyExecRow(w));
  }

  /* ------------------------------- SVG --------------------------------- */

  function svg(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const VAR = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

  function pie(title, pairs) { // pairs: [[label, count, color]]
    const total = pairs.reduce((s, p) => s + p[1], 0);
    const box = el('div', 'chart');
    box.append(el('div', 'chart-title', title));
    if (!total) { box.append(el('div', 'panel-empty', 'No data.')); return box; }
    const size = 120, r = 56, cx = 60, cy = 60;
    const s = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
    let a0 = -Math.PI / 2;
    for (const [, count, color] of pairs) {
      if (!count) continue;
      const a1 = a0 + (count / total) * Math.PI * 2;
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      s.append(svg('path', { d: `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`, fill: color }));
      a0 = a1;
    }
    const wrap = el('div', 'pie-wrap'); wrap.append(s);
    const legend = el('div', 'pie-legend');
    for (const [label, count, color] of pairs) {
      if (!count) continue;
      const row = el('div', 'legend-row');
      const sw = el('span', 'legend-swatch'); sw.style.background = color;
      row.append(sw, el('span', 'legend-label', `${label} ${count} (${Math.round(count / total * 100)}%)`));
      legend.append(row);
    }
    wrap.append(legend); box.append(wrap);
    return box;
  }

  function timeline(rows) {
    const box = el('div', 'chart wide');
    box.append(el('div', 'chart-title', 'Activity over time'));
    if (!rows.length) { box.append(el('div', 'panel-empty', 'No data.')); return box; }
    const W = Math.max(320, rows.length * 40), H = 140, pad = 24;
    const series = [
      ['comments', VAR('--accent'), 'Comments'], ['tasks', VAR('--orange'), 'Tasks'],
      ['ideas', VAR('--idea'), 'Ideas'], ['links', VAR('--green'), 'Links'],
      ['images', VAR('--pink'), 'Images'], ['actions', VAR('--yellow'), 'Actions'],
      ['stateChanges', VAR('--muted'), 'State changes']
    ];
    const max = Math.max(1, ...rows.flatMap(r => series.map(([k]) => r[k] || 0)));
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const x = i => pad + (rows.length === 1 ? 0 : i * (W - 2 * pad) / (rows.length - 1));
    const y = v => H - pad - (v / max) * (H - 2 * pad);
    for (const [key, color, label] of series) {
      const pts = rows.map((r, i) => `${x(i)},${y(r[key] || 0)}`).join(' ');
      const line = svg('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2 });
      const tt = svg('title'); tt.textContent = label; line.append(tt);
      s.append(line);
    }
    // First/last month labels for orientation (matches the other wide charts).
    const t0 = svg('text', { x: x(0), y: H - 6, fill: VAR('--muted'), 'font-size': 10 });
    t0.textContent = rows[0].month; s.append(t0);
    if (rows.length > 1) {
      const t1 = svg('text', { x: W - pad, y: H - 6, fill: VAR('--muted'), 'font-size': 10, 'text-anchor': 'end' });
      t1.textContent = rows[rows.length - 1].month; s.append(t1);
    }
    const legend = el('div', 'pie-legend');
    for (const [, color, label] of series) {
      const lr = el('div', 'legend-row');
      const sw = el('span', 'legend-swatch'); sw.style.background = color;
      lr.append(sw, el('span', 'legend-label', label));
      legend.append(lr);
    }
    // Chart and legend side by side: the legend column costs no extra height.
    const flexRow = el('div', 'chart-flex');
    flexRow.append(s, legend);
    box.append(flexRow);
    return box;
  }

  function stateAreas(rows) {
    const box = el('div', 'chart wide');
    box.append(el('div', 'chart-title', 'Tasks over time (by state)'));
    if (!rows.length) { box.append(el('div', 'panel-empty', 'No data.')); return box; }
    // A single month cannot span an area — draw it as two identical points.
    const draw = rows.length === 1 ? [rows[0], rows[0]] : rows;
    const W = Math.max(320, draw.length * 40), H = 170, pad = 24;
    const max = Math.max(1, ...draw.map(r => AREA_STATES.reduce((t, [k]) => t + r[k], 0)));
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const x = i => pad + i * (W - 2 * pad) / (draw.length - 1);
    const y = v => H - pad - (v / max) * (H - 2 * pad);
    // Stack bottom-up in AREA_STATES order: each band sits on the previous sum.
    const base = draw.map(() => 0);
    for (const [key, varName, label] of AREA_STATES) {
      const tops = draw.map((r, i) => base[i] + r[key]);
      const upper = draw.map((r, i) => `${x(i)},${y(tops[i])}`);
      const lower = draw.map((r, i) => `${x(i)},${y(base[i])}`).reverse();
      const poly = svg('polygon', { points: upper.concat(lower).join(' '),
        fill: VAR(varName), 'fill-opacity': '0.75', stroke: VAR(varName), 'stroke-width': 1 });
      const tt = svg('title'); tt.textContent = label; poly.append(tt);
      s.append(poly);
      for (let i = 0; i < draw.length; i++) base[i] = tops[i];
    }
    s.append(svg('line', { x1: pad, y1: y(0), x2: W - pad, y2: y(0), stroke: VAR('--border'), 'stroke-width': 1 }));
    const tmax = svg('text', { x: pad, y: y(max) - 4, fill: VAR('--muted'), 'font-size': 10 });
    tmax.textContent = String(max); s.append(tmax);
    const t0 = svg('text', { x: x(0), y: H - 6, fill: VAR('--muted'), 'font-size': 10 });
    t0.textContent = rows[0].month; s.append(t0);
    if (rows.length > 1) {
      const t1 = svg('text', { x: W - pad, y: H - 6, fill: VAR('--muted'), 'font-size': 10, 'text-anchor': 'end' });
      t1.textContent = rows[rows.length - 1].month; s.append(t1);
    }
    const legend = el('div', 'pie-legend');
    for (const [, varName, label] of AREA_STATES) {
      const row = el('div', 'legend-row');
      const sw = el('span', 'legend-swatch'); sw.style.background = VAR(varName);
      row.append(sw, el('span', 'legend-label', label));
      legend.append(row);
    }
    const flexRow = el('div', 'chart-flex');
    flexRow.append(s, legend);
    box.append(flexRow);
    return box;
  }

  function executionChart(rows) {
    const box = el('div', 'chart wide');
    box.append(el('div', 'chart-title', 'Tasks created per week (by current state)'));
    if (!rows.length) { box.append(el('div', 'panel-empty', 'No data.')); return box; }
    const n = rows.length, bw = 16, gap = 8, pad = 24, H = 170;
    const labelStep = Math.ceil(n / 12); // thin the x-axis labels when many weeks
    const W = Math.max(320, pad * 2 + n * (bw + gap));
    const max = Math.max(1, ...rows.map(r => r.total));
    const scale = (H - 2 * pad) / max;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'xMidYMid meet' });
    s.append(svg('line', { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, stroke: VAR('--border'), 'stroke-width': 1 }));
    rows.forEach((r, i) => {
      const x = pad + i * (bw + gap);
      let yTop = H - pad;
      for (const [key, varName, label] of EXEC_STATES) {
        const c = r[key]; if (!c) continue;
        const h = c * scale; yTop -= h;
        const rect = svg('rect', { x, y: yTop, width: bw, height: h, fill: VAR(varName) });
        const tt = svg('title'); tt.textContent = `week of ${r.week} · ${label}: ${c}`; rect.append(tt);
        s.append(rect);
      }
      if (r.total > 0) {
        const total = svg('text', { x: x + bw / 2, y: (H - pad) - r.total * scale - 3, fill: VAR('--muted'), 'font-size': 9, 'text-anchor': 'middle' });
        total.textContent = String(r.total); s.append(total);
      }
      if (i % labelStep === 0) {
        const dl = svg('text', { x: x + bw / 2, y: H - pad + 10, fill: VAR('--muted'), 'font-size': 8, 'text-anchor': 'end', transform: `rotate(-60 ${x + bw / 2} ${H - pad + 10})` });
        dl.textContent = r.week.slice(5); s.append(dl);
      }
    });
    const legend = el('div', 'pie-legend');
    for (const [, varName, label] of EXEC_STATES) {
      const row = el('div', 'legend-row');
      const sw = el('span', 'legend-swatch'); sw.style.background = VAR(varName);
      row.append(sw, el('span', 'legend-label', label));
      legend.append(row);
    }
    const flexRow = el('div', 'chart-flex');
    flexRow.append(s, legend);
    box.append(flexRow);
    return box;
  }

  /* ------------------------------ render ------------------------------- */

  function render(container) {
    if (!container) return;
    container.replaceChildren();
    const entries = store().collectEntries();

    const grid = el('div', 'chart-grid');
    // Five time-range comment-inflow pies.
    const TYPE_COLORS = [['comment', VAR('--accent')], ['task', VAR('--orange')], ['followup', VAR('--followup')], ['goal', VAR('--goal')], ['idea', VAR('--idea')]];
    for (const [range, title] of [['week', 'Last Week'], ['month', 'Last Month'], ['quarter', 'Last Quarter'], ['year', 'Last Year'], ['all', 'All Time']]) {
      const c = inflowByRange(entries, range);
      grid.append(pie(title, TYPE_COLORS.map(([k, col]) => [k, c[k], col])));
    }
    // Task states.
    const ts = taskStateCounts(entries);
    grid.append(pie('Task states', [
      ['OPEN', ts.open, VAR('--orange')], ['WIP', ts.inprogress, VAR('--state-wip')],
      ['CHK', ts.check, VAR('--state-chk')], ['HOLD', ts.onhold, VAR('--yellow')],
      ['PRGT', ts.purgatory, VAR('--muted')], ['DONE', ts.resolved, VAR('--green')],
      ['OBSL', ts.obsolete, VAR('--border')]
    ]));
    // Goal states.
    const gs = goalStateCounts(entries);
    grid.append(pie('Goal states', [
      ['Open', gs.open, VAR('--goal')], ['Achieved', gs.achieved, VAR('--green')], ['Canceled', gs.canceled, VAR('--red')]
    ]));
    // Idea states (colors match the idea state badges in style.css).
    const is = ideaStateCounts(entries);
    grid.append(pie('Idea states', [
      ['Considered', is.considered, '#b3e5fc'], ['Explored', is.explored, '#fff9c4'],
      ['Promoted', is.promoted, '#c8e6c9'], ['Shelved', is.shelved, '#e0e0e0']
    ]));
    container.append(grid);

    container.append(timeline(monthlyTimeline(entries)));
    container.append(stateAreas(taskStatesOverTime(entries)));
    container.append(executionChart(taskExecution(entries)));
  }

  Chippy.dashboard = {
    render,
    // pure aggregations exposed for tests
    inflowByRange, taskStateCounts, goalStateCounts, ideaStateCounts, monthlyTimeline, cumulative, entryType,
    taskStatesOverTime, taskTransitions, monthsBetween, taskExecution, weekOf, weeksBetween
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
