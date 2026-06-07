// SPDX-License-Identifier: Apache-2.0
//
// Tiny progress reporter: prints a line when each test STARTS and ENDS, so a run
// that hangs or breaks shows exactly which test it stopped on (the last START
// with no matching END is the culprit). No START lines at all => the break is
// before tests run (web server / collection / fixture import).

import { basename } from 'node:path';

const where = t => {
  const f = t.location ? basename(t.location.file) : '?';
  const suite = t.parent && t.parent.title ? t.parent.title + ' › ' : '';
  return `[${f}] ${suite}${t.title}`;
};

export default class ProgressReporter {
  onBegin(_config, suite) {
    process.stdout.write(`\n[progress] running ${suite.allTests().length} tests\n`);
  }
  onTestBegin(test) {
    process.stdout.write(`[progress] ▶ START ${where(test)}\n`);
  }
  onTestEnd(test, result) {
    process.stdout.write(`[progress] ■ END   ${where(test)} — ${result.status.toUpperCase()} (${Math.round(result.duration)}ms)\n`);
  }
  onError(error) {
    process.stdout.write(`[progress] ✖ RUNNER ERROR: ${error.message || error}\n`);
  }
  onEnd(result) {
    process.stdout.write(`[progress] run finished: ${result.status}\n`);
  }
}
