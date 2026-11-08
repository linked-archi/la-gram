/**
 * `la-gram-git init github|gitlab|merge-driver`: set a model repository up.
 *
 * - `github` writes the workflow (`.github/workflows/la-gram-git.yml`);
 * - `gitlab` writes the job into a new `.gitlab-ci.yml`, or — one being there —
 *   beside it, to `include:`;
 * - `merge-driver` routes the model files to la-gram-git's merge in
 *   `.gitattributes` (committed: everyone's) and defines the driver in this
 *   clone's Git configuration (each clone's own; a clone without it merges the
 *   files as text, as before).
 *
 * The templates are the files in la-gram's `ci/` folder, shipped with the
 * package. Nothing is overwritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, topLevel } from './git.js';
import { MODEL_EXTENSIONS } from './models.js';

/** The driver's name in `.gitattributes` and the Git configuration. */
export const DRIVER = 'la-gram-git';

/** The folder holding `ci/`: found by walking up from this module, in la-gram's repository and in the package alike. */
export function templatesRoot(from = moduleFolder()): string {
  let folder = from;
  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(join(folder, 'ci', 'github', 'la-gram-git.yml'))) return join(folder, 'ci');
    const up = dirname(folder);
    if (up === folder) break;
    folder = up;
  }
  throw new Error(`The CI templates (ci/) were not found above ${from}.`);
}

/** Set the repository at `cwd` up; returns what was done, a line each. */
export function init(what: string, cwd = process.cwd(), templates = templatesRoot()): string[] {
  const top = topLevel(cwd);
  if (what === 'github') {
    const target = join(top, '.github', 'workflows', 'la-gram-git.yml');
    if (existsSync(target)) return [`${relativeTo(top, target)} is there already: left as it is.`];
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(templates, 'github', 'la-gram-git.yml'), 'utf8'));
    return [`Wrote ${relativeTo(top, target)}: commit it, and pull requests have their models checked.`];
  }
  if (what === 'gitlab') {
    const template = readFileSync(join(templates, 'gitlab', 'la-gram-git.gitlab-ci.yml'), 'utf8');
    const main = join(top, '.gitlab-ci.yml');
    if (!existsSync(main)) {
      writeFileSync(main, template);
      return ['Wrote .gitlab-ci.yml: commit it, and merge requests have their models checked.', ...tokenNote()];
    }
    const beside = join(top, 'la-gram-git.gitlab-ci.yml');
    if (existsSync(beside)) return ['la-gram-git.gitlab-ci.yml is there already: left as it is.'];
    writeFileSync(beside, template);
    return [
      'Wrote la-gram-git.gitlab-ci.yml beside your .gitlab-ci.yml. Include it there:',
      '  include:',
      '    - local: la-gram-git.gitlab-ci.yml',
      ...tokenNote(),
    ];
  }
  if (what === 'merge-driver') {
    const attributes = join(top, '.gitattributes');
    const existing = existsSync(attributes) ? readFileSync(attributes, 'utf8') : '';
    const lines = MODEL_EXTENSIONS.map((ext) => `*${ext} merge=${DRIVER}`).filter((line) => !existing.split('\n').includes(line));
    if (lines.length > 0) {
      const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
      writeFileSync(attributes, `${existing}${separator}# Model files merged by element (la-gram-git)\n${lines.join('\n')}\n`);
    }
    git(['config', `merge.${DRIVER}.name`, 'la-gram models, merged by element'], top);
    git(['config', `merge.${DRIVER}.driver`, `${DRIVER} merge %O %A %B %P`], top);
    return [
      lines.length > 0 ? `Added ${lines.length} line${lines.length === 1 ? '' : 's'} to .gitattributes: commit it.` : '.gitattributes routes the model files already.',
      `Defined the ${DRIVER} merge driver in this clone's Git configuration; each clone runs \`${DRIVER} init merge-driver\` once (with ${DRIVER} installed: npm install --global @linked-archi/la-gram-git).`,
    ];
  }
  throw new Error(`init takes github, gitlab or merge-driver, not "${what}".`);
}

function tokenNote(): string[] {
  return ['To comment on merge requests, add a project or group access token (role Reporter, scope api) as a masked CI/CD variable named LA_GRAM_GIT_TOKEN.'];
}

function relativeTo(top: string, path: string): string {
  return path.slice(top.length + 1);
}

function moduleFolder(): string {
  return dirname(fileURLToPath(import.meta.url));
}
