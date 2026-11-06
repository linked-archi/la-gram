/**
 * la-gram-git's executable (`bin` in the package): runs the command line and
 * exits with its code. What la-gram logs as it loads metamodels is left out —
 * the standard output is the tool's (`diff` writes Markdown there) — unless
 * LA_GRAM_GIT_DEBUG is set; warnings go to the standard error as ever.
 *
 * It exits once its output is written: the editor's engine keeps timers (the
 * next validation, scheduled when a model opens) that would keep Node running.
 */
import { main } from './main.js';

if (!process.env['LA_GRAM_GIT_DEBUG']) {
  console.log = () => undefined;
  console.info = () => undefined;
  console.debug = () => undefined;
}

/** Exit once both streams have written what they hold. */
function exit(code: number): void {
  let pending = 2;
  const done = () => {
    if (--pending === 0) process.exit(code);
  };
  process.stdout.write('', done);
  process.stderr.write('', done);
}

main(process.argv.slice(2)).then(exit, (err: unknown) => {
  process.stderr.write(`la-gram-git: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  exit(2);
});
