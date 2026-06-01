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

  function entryType(e) {
    const t = e.tags || [];
    if (t.includes('goal')) return 'goal';
    if (t.includes('followup')) return 'followup';
    if (t.includes('task')) return 'task';
    return 'comment';
  }
  function stateKeyOf(t) {
    if (t.includes('inprogresstask') || t.includes('inprogress')) return 'inprogress';
    if (t.includes('checktask')) return 'check';
    if (t.includes('onholdtask') || t.includes('onhold')) return 'onhold';
    if (t.includes('purgatorytask') || t.includes('purgatory')) return 'purgatory';
    if (t.includes('resolvedtask') || t.includes('resolvedfollowup')) return 'resolved';
    if (t.includes('obsoletetask')) return 'obsolete';
    return 'open';
  }
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
  }

  Chippy.dashboard = {
    render,
    // pure aggregations exposed for tests
    inflowByRange, taskStateCounts, goalStateCounts, monthlyTimeline, cumulative, entryType
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
