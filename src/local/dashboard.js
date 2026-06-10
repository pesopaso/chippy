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
    const c = { comment: 0, task: 0, followup: 0, goal: 0 };
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
  function monthlyTimeline(entries) {
    const map = new Map();
    for (const e of entries) {
      const mo = (e.created_at || '').slice(0, 7);
      if (!mo) continue;
      if (!map.has(mo)) map.set(mo, { month: mo, comments: 0, tasks: 0, links: 0, images: 0 });
      const r = map.get(mo);
      const ty = entryType(e);
      if (ty === 'comment') r.comments++;
      else if (ty === 'task' || ty === 'followup') r.tasks++;
      r.links += linkCount(e.body);
      r.images += imageCount(e.body);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }
  function cumulative(entries) {
    const tl = monthlyTimeline(entries);
    let total = 0;
    return tl.map(r => { total += r.comments + r.tasks; return { month: r.month, total }; });
  }

  // The month (YYYY-MM) a task was closed: the latest "→ DONE"/"→ OBSL" action
  // bullet, or the legacy Resolved:/Obsolete: marker as fallback.
  function closedMonthOf(e) {
    const body = e.body || '';
    let last = null, m;
    const act = /^- (\d{4}-\d{2})-\d{2} : → (?:DONE|OBSL)$/gm;
    while ((m = act.exec(body))) if (!last || m[1] > last) last = m[1];
    if (last) return last;
    const mk = body.match(/(?:Resolved|Obsolete): (\d{4}-\d{2})/);
    return mk ? mk[1] : null;
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
  // Burndown: open task/followup count at the end of each month = created up to
  // that month minus those closed (Resolved:/Obsolete:) up to that month.
  function taskBurndown(entries) {
    const tasks = entries.filter(e => {
      const t = e.tags || []; return t.includes('task') || t.includes('followup');
    });
    if (!tasks.length) return [];
    const months = new Set();
    for (const e of tasks) {
      const cm = (e.created_at || '').slice(0, 7); if (cm) months.add(cm);
      const clm = closedMonthOf(e); if (clm) months.add(clm);
    }
    months.add(new Date().toISOString().slice(0, 7));
    const sorted = [...months].filter(Boolean).sort();
    if (!sorted.length) return [];
    return monthsBetween(sorted[0], sorted[sorted.length - 1]).map(mo => {
      let open = 0;
      for (const e of tasks) {
        const cm = (e.created_at || '').slice(0, 7);
        if (!cm || cm > mo) continue;            // not yet created
        const clm = closedMonthOf(e);
        if (clm && clm <= mo) continue;          // already closed
        open++;
      }
      return { month: mo, open };
    });
  }

  // Tasks grouped by the day they were created, counted by current state, for a
  // stacked per-day bar chart.
  const EXEC_STATES = [
    ['open', '--orange', 'OPEN'], ['inprogress', '--state-wip', 'WIP'],
    ['check', '--state-chk', 'CHK'], ['onhold', '--yellow', 'HOLD'],
    ['purgatory', '--muted', 'PRGT'], ['resolved', '--green', 'DONE'],
    ['obsolete', '--border', 'OBSL']
  ];
  // Consecutive YYYY-MM-DD strings from start to end inclusive.
  function daysBetween(start, end) {
    const out = [];
    const d = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00');
    let guard = 0;
    while (d <= e && guard++ < 4000) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function emptyExecRow(day) {
    const r = { day, total: 0 };
    for (const [k] of EXEC_STATES) r[k] = 0;
    return r;
  }
  function taskExecution(entries) {
    const map = new Map();
    for (const e of entries) {
      const t = e.tags || [];
      if (!(t.includes('task') || t.includes('followup'))) continue;
      const day = (e.created_at || '').slice(0, 10);
      if (!day) continue;
      if (!map.has(day)) map.set(day, emptyExecRow(day));
      const r = map.get(day);
      r[stateKeyOf(t)]++; r.total++;
    }
    const days = [...map.keys()].sort();
    if (!days.length) return [];
    // Fill every calendar day in the span, so days with no tasks show as gaps.
    return daysBetween(days[0], days[days.length - 1]).map(day => map.get(day) || emptyExecRow(day));
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
    const max = Math.max(1, ...rows.flatMap(r => [r.comments, r.tasks, r.links, r.images]));
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const x = i => pad + (rows.length === 1 ? 0 : i * (W - 2 * pad) / (rows.length - 1));
    const y = v => H - pad - (v / max) * (H - 2 * pad);
    const series = [['comments', VAR('--accent')], ['tasks', VAR('--orange')], ['links', VAR('--green')], ['images', VAR('--pink')]];
    for (const [key, color] of series) {
      const pts = rows.map((r, i) => `${x(i)},${y(r[key])}`).join(' ');
      s.append(svg('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': 2 }));
    }
    box.append(s);
    return box;
  }

  function burndown(rows) {
    const box = el('div', 'chart wide');
    box.append(el('div', 'chart-title', 'Open tasks over time (burndown)'));
    if (!rows.length) { box.append(el('div', 'panel-empty', 'No data.')); return box; }
    const W = Math.max(320, rows.length * 40), H = 140, pad = 24;
    const max = Math.max(1, ...rows.map(r => r.open));
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
    const x = i => pad + (rows.length === 1 ? 0 : i * (W - 2 * pad) / (rows.length - 1));
    const y = v => H - pad - (v / max) * (H - 2 * pad);
    const linePts = rows.map((r, i) => `${x(i)},${y(r.open)}`).join(' ');
    s.append(svg('polygon', { points: `${x(0)},${y(0)} ${linePts} ${x(rows.length - 1)},${y(0)}`,
      fill: VAR('--orange'), 'fill-opacity': '0.15' }));
    s.append(svg('polyline', { points: linePts, fill: 'none', stroke: VAR('--orange'), 'stroke-width': 2 }));
    s.append(svg('line', { x1: pad, y1: y(0), x2: W - pad, y2: y(0), stroke: VAR('--border'), 'stroke-width': 1 }));
    const tmax = svg('text', { x: pad, y: y(max) - 4, fill: VAR('--muted'), 'font-size': 10 });
    tmax.textContent = String(max); s.append(tmax);
    const t0 = svg('text', { x: x(0), y: H - 6, fill: VAR('--muted'), 'font-size': 10 });
    t0.textContent = rows[0].month; s.append(t0);
    if (rows.length > 1) {
      const t1 = svg('text', { x: W - pad, y: H - 6, fill: VAR('--muted'), 'font-size': 10, 'text-anchor': 'end' });
      t1.textContent = rows[rows.length - 1].month; s.append(t1);
    }
    box.append(s);
    return box;
  }

  function executionChart(rows) {
    const box = el('div', 'chart wide');
    box.append(el('div', 'chart-title', 'Tasks created per day (by current state)'));
    if (!rows.length) { box.append(el('div', 'panel-empty', 'No data.')); return box; }
    const n = rows.length, bw = 16, gap = 8, pad = 24, H = 170;
    const labelStep = Math.ceil(n / 12); // thin the x-axis labels when many days
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
        const tt = svg('title'); tt.textContent = `${r.day} · ${label}: ${c}`; rect.append(tt);
        s.append(rect);
      }
      if (r.total > 0) {
        const total = svg('text', { x: x + bw / 2, y: (H - pad) - r.total * scale - 3, fill: VAR('--muted'), 'font-size': 9, 'text-anchor': 'middle' });
        total.textContent = String(r.total); s.append(total);
      }
      if (i % labelStep === 0) {
        const dl = svg('text', { x: x + bw / 2, y: H - pad + 10, fill: VAR('--muted'), 'font-size': 8, 'text-anchor': 'end', transform: `rotate(-60 ${x + bw / 2} ${H - pad + 10})` });
        dl.textContent = r.day.slice(5); s.append(dl);
      }
    });
    box.append(s);
    const legend = el('div', 'pie-legend');
    for (const [, varName, label] of EXEC_STATES) {
      const row = el('div', 'legend-row');
      const sw = el('span', 'legend-swatch'); sw.style.background = VAR(varName);
      row.append(sw, el('span', 'legend-label', label));
      legend.append(row);
    }
    box.append(legend);
    return box;
  }

  /* ------------------------------ render ------------------------------- */

  function render(container) {
    if (!container) return;
    container.replaceChildren();
    const entries = store().collectEntries();

    const grid = el('div', 'chart-grid');
    // Five time-range comment-inflow pies.
    const TYPE_COLORS = [['comment', VAR('--accent')], ['task', VAR('--orange')], ['followup', VAR('--followup')], ['goal', VAR('--goal')]];
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
    container.append(grid);

    container.append(timeline(monthlyTimeline(entries)));
    container.append(burndown(taskBurndown(entries)));
    container.append(executionChart(taskExecution(entries)));
  }

  Chippy.dashboard = {
    render,
    // pure aggregations exposed for tests
    inflowByRange, taskStateCounts, goalStateCounts, monthlyTimeline, cumulative, entryType,
    taskBurndown, closedMonthOf, monthsBetween, taskExecution, daysBetween
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
