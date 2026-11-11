/**
 * The documentation's commands (mkdocs.yml, docs-site/), always in the
 * project's own Python environment, .venv-docs:
 *
 *   npm run docs:setup                  make .venv-docs and install requirements-docs.txt into it
 *   npm run docs:build [-- <args>]      mkdocs build --strict, into dist/web/docs/
 *   npm run docs:serve [-- <args>]      mkdocs serve: http://127.0.0.1:8000/la-gram/docs/, live
 *
 * The interpreter is .venv-docs' (bin/python; Scripts\python.exe on Windows),
 * whatever venv is active: $VIRTUAL_ENV is ignored, so another project's
 * MkDocs or Material never builds this site. $PYTHON names the Python setup
 * makes the venv from (3.11 or later; python3 by default). Before build and
 * serve, check_env.py confirms the venv has exactly the versions the file pins.
 * Arguments after the subcommand go to pip (setup) or MkDocs, as they are.
 * Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WINDOWS = process.platform === 'win32';
const VENV = path.join(ROOT, '.venv-docs');
const VENV_PYTHON = WINDOWS ? path.join(VENV, 'Scripts', 'python.exe') : path.join(VENV, 'bin', 'python');
const LOCK = 'requirements-docs.txt';
const CHECK_ENV = path.join('scripts', 'docs', 'check_env.py');
/** Prints the interpreter's major.minor, and fails when it is older than 3.11. */
const VERSION_CHECK = "import sys; print('%d.%d' % sys.version_info[:2]); sys.exit(0 if sys.version_info >= (3, 11) else 1)";

const NO_ENVIRONMENT =
  'No Python environment for the documentation, or not the one requirements-docs.txt pins: ' +
  'run npm run docs:setup (Python 3.11 or later).';

const USAGE = `Usage: node scripts/docs/run.mjs <setup|build|serve> [arguments…]

  setup   make .venv-docs (from $PYTHON, else ${WINDOWS ? 'python' : 'python3'}; Python 3.11 or later)
          and install requirements-docs.txt into it, exactly: pip --no-deps, then pip check
  build   mkdocs build --strict, into dist/web/docs/
  serve   mkdocs serve, with live reload, at http://127.0.0.1:8000/la-gram/docs/

Arguments after the subcommand are passed on: to pip install (setup) or to MkDocs.`;

/** What every child gets: Material's MkDocs 2.0 notice is not printed on every build. */
const ENV = { ...process.env, NO_MKDOCS_2_WARNING: 'true' };

function spawn(command, args, options = {}) {
  return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false, env: ENV, ...options });
}

/** The child's own exit status; 1 when a signal ended it. */
function status(result) {
  return result.status ?? 1;
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

/** Run a step; stop with its status when it fails. */
function step(command, args) {
  const result = spawn(command, args);
  if (result.error) fail(`${command}: ${result.error.message}`, 1);
  if (result.status !== 0) process.exit(status(result));
}

/** An interpreter's major.minor and whether it is 3.11 or later; `null` when it does not start. */
function pythonVersion(python) {
  const result = spawn(python, ['-c', VERSION_CHECK], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (result.error || result.status === null) return null;
  return { version: result.stdout.trim(), supported: result.status === 0 };
}

/** .venv-docs matches requirements-docs.txt, or the runner stops with exit 2. */
function checkEnvironment() {
  if (!existsSync(VENV_PYTHON)) fail(NO_ENVIRONMENT);
  const result = spawn(VENV_PYTHON, [CHECK_ENV, LOCK]);
  if (result.error || result.status !== 0) fail(NO_ENVIRONMENT);
}

function setup(args) {
  const base = process.env.PYTHON || (WINDOWS ? 'python' : 'python3');
  const found = pythonVersion(base);
  if (!found) fail(`No Python at ${base}: install Python 3.11 or later, or name one with PYTHON=<path>.`);
  if (!found.supported) {
    fail(`${base} is Python ${found.version}; the documentation needs 3.11 or later: name one with PYTHON=<path>.`);
  }
  if (!existsSync(path.join(VENV, 'pyvenv.cfg'))) step(base, ['-m', 'venv', VENV]);
  const venv = pythonVersion(VENV_PYTHON);
  if (!venv) fail(`.venv-docs has no Python that runs (${VENV_PYTHON}): remove it and run npm run docs:setup again.`);
  if (!venv.supported) {
    fail(
      `.venv-docs uses Python ${venv.version}: remove it and run npm run docs:setup again ` +
        '(PYTHON=<a Python 3.11 or later>).',
    );
  }
  // Exactly the list, and nothing it leaves out: --no-deps installs only what
  // it names, and pip check fails if a package needs one it does not.
  step(VENV_PYTHON, ['-m', 'pip', 'install', '--no-deps', '--requirement', LOCK, ...args]);
  step(VENV_PYTHON, ['-m', 'pip', 'check']);
  step(VENV_PYTHON, [CHECK_ENV, LOCK]);
}

function mkdocs(command, args) {
  checkEnvironment();
  const result = spawn(VENV_PYTHON, ['-m', 'mkdocs', ...command, ...args]);
  if (result.error) fail(`${VENV_PYTHON}: ${result.error.message}`, 1);
  process.exit(status(result));
}

const [subcommand, ...args] = process.argv.slice(2);
switch (subcommand) {
  case 'setup':
    setup(args);
    break;
  case 'build':
    mkdocs(['build', '--strict'], args);
    break;
  case 'serve':
    mkdocs(['serve'], args);
    break;
  default:
    fail(USAGE);
}
