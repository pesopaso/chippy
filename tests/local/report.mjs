// SPDX-License-Identifier: Apache-2.0
//
// Pure parsers for the two test runners' structured output, turning each into a
// flat list of { phase, name, status } where status is passed|failed|skipped.
// Kept separate from run.mjs so they can be tested without running a pipeline.

// node:test TAP -> results. Matches `ok/not ok N - <name>` with optional
// `# SKIP` / `# TODO` directive.
export function parseTap(text, phase) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.*)$/);
    if (!m) continue;
    let name = m[2];
    let status = m[1] === 'not ok' ? 'failed' : 'passed';
    if (/\s+#\s+(SKIP|TODO)\b/i.test(name)) { status = 'skipped'; name = name.replace(/\s+#\s+(SKIP|TODO).*$/i, ''); }
    out.push({ phase, name: name.trim(), status });
  }
  return out;
}

// Playwright JSON report -> results. Walks suites/specs recursively (file suite
// -> describe suites -> specs), reads each spec's last test result. fixme/skip
// tests report status 'skipped'.
export function parsePlaywright(json, phase) {
  const out = [];
  const norm = s => (s === 'passed' ? 'passed' : s === 'skipped' ? 'skipped' : 'failed');
  // The suite that directly contains a spec is its describe block — the page/
  // surface. Use it as context unless it's the file-level suite (path/filename).
  const isFileSuite = t => !t || t.includes('/') || /\.(spec|test)\.[mc]?js$/.test(t);
  const walk = suite => {
    const ctx = isFileSuite(suite.title) ? '' : suite.title;
    for (const spec of (suite.specs || [])) {
      const res = ((spec.tests || [])[0] || {}).results || [];
      const st = res.length ? res[res.length - 1].status : 'skipped';
      out.push({
        phase,
        name: ctx ? `${ctx} › ${spec.title}` : spec.title,
        status: spec.ok && st === 'passed' ? 'passed' : norm(st)
      });
    }
    for (const sub of (suite.suites || [])) walk(sub);
  };
  for (const s of (json && json.suites || [])) walk(s);
  return out;
}
