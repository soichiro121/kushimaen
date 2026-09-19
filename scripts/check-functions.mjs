/**
 * Loads the serverless functions the way Vercel loads them.
 *
 *   npm run check:functions
 *
 * WHY THIS EXISTS
 *   The test suite runs under Vitest, which resolves and transforms modules with
 *   Vite. Vercel does neither: it hands the compiled output to Node's own ESM
 *   loader. Those two disagree, and the gap is not theoretical - it took the whole
 *   backend down. `import rules from './v3.json'` is fine under Vite and throws
 *   ERR_IMPORT_ATTRIBUTE_MISSING under Node ESM, so every function died at module
 *   load while all 264 tests stayed green. The game reads a dead `/api/health` as
 *   "no server", so the only symptom was a silent drop to LOCAL MODE.
 *
 * WHAT IT DOES
 *   Compiles `api/`, `server/` and `shared/` with Node's own module settings, then
 *   imports each compiled entry point in a real Node process and calls it with a
 *   real `Request`. No Vite anywhere in the path.
 *
 * BUILD-TIME TOOL. Never runs in the browser or in a function.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'node_modules', '.cache', 'functions-check');

/** Every `api/**\/*.ts`, discovered rather than listed. */
function entryPoints(dir = join(ROOT, 'api')) {
  const found = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) found.push(...entryPoints(path));
    else if (item.name.endsWith('.ts')) found.push(path);
  }
  return found.sort();
}

const entries = entryPoints();
if (entries.length === 0) throw new Error('no api/ entry points found');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.info(`[check:functions] compiling ${entries.length} entry points with Node's module settings`);
execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
    ...entries.map((entry) => relative(ROOT, entry)),
    '--outDir', OUT,
    '--rootDir', '.',
    // Exactly what Node does, which is the whole point of this check.
    '--module', 'nodenext',
    '--moduleResolution', 'nodenext',
    '--resolveJsonModule',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
    '--target', 'es2022',
    '--types', 'node',
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

// The compiled tree needs to be ESM, the same as the real package.
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

let failures = 0;
for (const entry of entries) {
  const name = relative(ROOT, entry).split(sep).join('/');
  const compiled = join(OUT, relative(ROOT, entry).replace(/\.ts$/, '.js'));

  try {
    const module = await import(pathToFileURL(compiled).href);
    const handler = module.default;

    if (typeof handler?.fetch !== 'function') {
      throw new Error('default export is not { fetch } - Vercel would call it as a Node (req, res) handler');
    }

    console.info(`[check:functions] ${name.padEnd(34)} loads, exports { fetch }`);
  } catch (error) {
    failures += 1;
    const code = error?.code ? `${error.code}: ` : '';
    console.error(`[check:functions] ${name.padEnd(34)} FAILED  ${code}${error?.message ?? error}`);
  }
}

// One end-to-end call, because loading is not the same as working - and this is the
// exact request whose failure puts every player into LOCAL MODE.
try {
  const { default: health } = await import(pathToFileURL(join(OUT, 'api', 'health.js')).href);
  const response = await health.fetch(new Request('https://komato.test/api/health'));
  const body = await response.json();
  if (response.status !== 200 || body.status !== 'ok') {
    throw new Error(`expected 200/ok, got ${response.status}/${body.status}`);
  }
  console.info(`[check:functions] /api/health answers 200 ok (configVersion ${body.configVersion})`);
} catch (error) {
  failures += 1;
  console.error(`[check:functions] /api/health FAILED  ${error?.message ?? error}`);
}

if (failures > 0) {
  console.error(`[check:functions] ${failures} failure(s) - this is what the deployment would do`);
  process.exit(1);
}
console.info('[check:functions] all entry points load under Node ESM');
