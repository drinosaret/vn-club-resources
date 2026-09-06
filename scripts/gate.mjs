// Whether a change is finished: typecheck, lint, the dead-utility scan, and the backend tests,
// in increasing cost.
//
// Each check writes its output to a file rather than to this process. One lint run over the
// whole tree is hundreds of lines, and a terminal that has to scroll through them to reach a
// pass or fail buries the answer it was asked for.
//
// Lint is measured against a recorded baseline rather than against zero. The tree carries
// pre-existing errors that no single change is expected to clear, so the rule is that a change
// may not add to the count. Fixing some lowers the baseline, and the baseline file is committed
// beside the code so the count cannot quietly regress.
//
//   node scripts/gate.mjs              every check
//   node scripts/gate.mjs --no-api     skip the backend tests when Docker is not up
//   node scripts/gate.mjs --update     record the current lint count as the new baseline

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);

const LOG_DIR = path.join(repoRoot, 'logs', 'gate');
const BASELINE_FILE = path.join(repoRoot, 'scripts', 'lint-baseline.json');
fs.mkdirSync(LOG_DIR, { recursive: true });

function run(label, command, args, { capture = false } = {}) {
  const logFile = path.join(LOG_DIR, `${label}.log`);
  if (capture) {
    const r = spawnSync(command, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: true,
      maxBuffer: 64 * 1024 * 1024,
    });
    fs.writeFileSync(logFile, (r.stdout ?? '') + (r.stderr ?? ''), 'utf8');
    return { status: r.status ?? 1, stdout: r.stdout ?? '', logFile };
  }
  const fd = fs.openSync(logFile, 'w');
  try {
    const r = spawnSync(command, args, { cwd: repoRoot, stdio: ['ignore', fd, fd], shell: true });
    return { status: r.status ?? 1, stdout: '', logFile };
  } finally {
    fs.closeSync(fd);
  }
}

function tail(file, n) {
  if (!fs.existsSync(file)) return '(no output)';
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n).join('\n');
}

let failed = 0;

// 1. Types. This one is absolute: there is no baseline and no tolerance.
process.stdout.write('typecheck ... ');
const types = run('typecheck', 'npx', ['tsc', '--noEmit']);
if (types.status === 0) {
  console.log('ok');
} else {
  failed++;
  console.log('FAILED');
  console.log(tail(types.logFile, 25));
}

// 2. Lint, against the recorded count.
process.stdout.write('lint ..... ');
const lint = run('lint', 'npx', [
  'eslint', '--cache', '--cache-location', '.next/cache/eslint-gate/',
  '-f', 'json', 'app', 'components', 'lib',
], { capture: true });

let errorCount = null;
try {
  const report = JSON.parse(lint.stdout);
  errorCount = report.reduce((n, file) => n + file.errorCount, 0);
} catch {
  errorCount = null;
}

if (errorCount === null) {
  failed++;
  console.log('FAILED (could not parse the report)');
} else {
  const baseline = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).errors
    : errorCount;

  if (has('update') || !fs.existsSync(BASELINE_FILE)) {
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ errors: errorCount }, null, 2)}\n`, 'utf8');
    console.log(`baseline set to ${errorCount}`);
  } else if (errorCount > baseline) {
    failed++;
    console.log(`FAILED (${errorCount} errors, baseline ${baseline}, so this change added ${errorCount - baseline})`);
    const report = JSON.parse(lint.stdout);
    for (const file of report.filter((f) => f.errorCount > 0).slice(0, 8)) {
      const rel = path.relative(repoRoot, file.filePath);
      for (const m of file.messages.filter((m) => m.severity === 2).slice(0, 3)) {
        console.log(`  ${rel}:${m.line}  ${m.ruleId ?? 'error'}  ${m.message.slice(0, 90)}`);
      }
    }
  } else {
    console.log(errorCount < baseline ? `ok (${errorCount}, down from ${baseline})` : `ok (${errorCount})`);
    if (errorCount < baseline) {
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({ errors: errorCount }, null, 2)}\n`, 'utf8');
    }
  }
}

// 3. Utilities that cannot take effect. Cheap, and it catches a class of bug that is invisible
// in review: a utility beside a primitive that already sets the property is silently ignored.
if (!has('no-dead-utils')) {
  process.stdout.write('dead utils ... ');
  const dead = run('dead-utilities', 'node', ['scripts/dead-utilities.mjs']);
  if (dead.status === 0) {
    console.log('ok');
  } else {
    failed++;
    console.log('FAILED');
    console.log(tail(dead.logFile, 20));
  }
}

// 4. Backend tests. They run inside the container, which is where pytest lives.
if (!has('no-api')) {
  process.stdout.write('api tests  ... ');
  const api = run('api-test', 'npm', ['run', 'api:test']);
  if (api.status === 0) {
    console.log('ok');
  } else {
    failed++;
    console.log('FAILED');
    console.log(tail(api.logFile, 25));
  }
}

console.log(failed === 0 ? '\ngate: green' : `\ngate: ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
