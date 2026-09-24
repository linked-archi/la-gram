/**
 * Browser harness for the smoke suite.
 *
 * Launches the *system* Chrome — Playwright's own browser download is
 * deliberately skipped (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` at install time),
 * so there is no `~/.cache/ms-playwright` payload and nothing to keep in sync
 * with CI images. Both `channel: 'chrome'` and an explicit `executablePath`
 * were verified to work against Google Chrome 145 on this machine;
 * `channel: 'chrome'` is the default because it lets Playwright find Chrome by
 * its usual install locations rather than hard-coding one. Set
 * `LA_GRAM_CHROME=/path/to/chrome` to override.
 *
 * Everything the suite needs to judge "the page is healthy" is collected here:
 * console messages, uncaught exceptions, failed requests and non-2xx responses.
 */

import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type Page } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (`la-gram/`). */
export const PROJECT_ROOT = path.resolve(here, '../..');

/** What `npm run build:web` produces, and what the suite serves. */
export const WEB_DIST = path.join(PROJECT_ROOT, 'dist/web');

/** Gitignored sink for screenshots taken as a debugging aid. */
export const ARTIFACT_DIR = path.join(PROJECT_ROOT, 'test-results/browser');

/**
 * Console output the suite tolerates.
 *
 * Kept deliberately short, and each entry is a *known* development-build
 * notice rather than a category of message:
 *
 * 1. Lit's dev-mode banner. `lit` ships a development build by default and
 *    announces it on every load; the production build would drop it, but the
 *    bundle under test is the one that ships.
 * 2. Lit's "scheduled an update after an update completed" notice, which
 *    `sparql-editor` provokes by setting a property from its own first update.
 *    It is a dev-mode-only performance advisory — the same message already
 *    appears in the jsdom unit run.
 *
 * Note what is *not* here: the `vaapi` / GPU / `dbus` noise Chrome writes when
 * launched headless is written to the browser *process* stderr, not to the
 * page's console, so Playwright never surfaces it as a `console` event and it
 * needs no allowlisting at all.
 */
export const ALLOWED_CONSOLE_PATTERNS: readonly RegExp[] = [
  /Lit is in dev mode/i,
  /scheduled an update .* after an update completed/i,
];

/**
 * Request paths whose failure is not the application's fault.
 *
 * Chrome asks for a favicon on every navigation and the bundle ships none.
 */
export const ALLOWED_FAILED_PATHS: readonly RegExp[] = [/\/favicon\.ico$/];

export interface CapturedMessage {
  type: string;
  text: string;
  location: string;
}

export interface CapturedResponse {
  url: string;
  status: number;
}

/** Everything observed about a page load. */
export interface PageDiagnostics {
  console: CapturedMessage[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: CapturedResponse[];
  /** Console errors that survived {@link ALLOWED_CONSOLE_PATTERNS}. */
  unexpectedConsoleErrors: CapturedMessage[];
  /** Console warnings that survived {@link ALLOWED_CONSOLE_PATTERNS}. */
  unexpectedConsoleWarnings: CapturedMessage[];
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  diagnostics: PageDiagnostics;
  /** Absolute path of the screenshot written, for the run log. */
  screenshot(name: string): Promise<string>;
  close(): Promise<void>;
}

function isAllowed(text: string): boolean {
  return ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

function isAllowedPath(url: string): boolean {
  return ALLOWED_FAILED_PATHS.some((pattern) => pattern.test(url));
}

/** Launch Chrome and open a page with diagnostics wired up. */
export async function openSession(options?: {
  viewport?: { width: number; height: number };
}): Promise<BrowserSession> {
  const executablePath = process.env.LA_GRAM_CHROME;

  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    // `--no-sandbox` because the suite is expected to run in containers too;
    // `--disable-gpu` keeps the software rasteriser deterministic. Neither
    // affects layout, which is what the suite measures.
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: options?.viewport ?? { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  const diagnostics: PageDiagnostics = {
    console: [],
    pageErrors: [],
    failedRequests: [],
    badResponses: [],
    unexpectedConsoleErrors: [],
    unexpectedConsoleWarnings: [],
  };

  page.on('console', (message: ConsoleMessage) => {
    const location = message.location();
    const entry: CapturedMessage = {
      type: message.type(),
      text: message.text(),
      location: `${location.url}:${location.lineNumber}`,
    };
    diagnostics.console.push(entry);
    if (isAllowed(entry.text)) return;
    // A failed subresource is reported twice — once as a `requestfailed`/4xx
    // response and once as a console error whose *location* is the resource. The
    // path allowlist has to cover both or the favicon Chrome asks for on every
    // navigation fails the run.
    if (isAllowedPath(location.url)) return;
    if (entry.type === 'error') diagnostics.unexpectedConsoleErrors.push(entry);
    if (entry.type === 'warning') diagnostics.unexpectedConsoleWarnings.push(entry);
  });

  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(`${error.name}: ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    if (isAllowedPath(request.url())) return;
    diagnostics.failedRequests.push(
      `${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`,
    );
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (isAllowedPath(response.url())) return;
    diagnostics.badResponses.push({ url: response.url(), status: response.status() });
  });

  return {
    browser,
    context,
    page,
    diagnostics,
    screenshot: async (name: string) => {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      const file = path.join(ARTIFACT_DIR, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

/**
 * Wait until the app has mounted *and* announced its metamodel.
 *
 * Deliberately state-based, not time-based: `index.ts` publishes the App on
 * `window.__LA_GRAM_APP__` after `createApp()` resolves (which is gated on the
 * Oxigraph WASM init), and `announceLoadedMetamodel()` is what fills the
 * palette. Both are observable, so the suite polls for them instead of
 * sleeping.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = (window as unknown as Record<string, unknown>).__LA_GRAM_APP__ as
        | { loadedMetamodel?: unknown }
        | undefined;
      const ui = (window as unknown as Record<string, unknown>).__LA_GRAM_UI__;
      return Boolean(app?.loadedMetamodel) && Boolean(ui);
    },
    undefined,
    { timeout: 30_000 },
  );

  // `index.ts` assigns `__LA_GRAM_APP__` *after* calling
  // `announceLoadedMetamodel()`, so the palette regeneration has already run by
  // the time the wait above resolves. Lit's own render is a microtask later,
  // hence one further wait — on the sidebar panel, which is not the component
  // this suite is regression-testing, so readiness stays independent of the fix
  // under test.
  await page
    .locator('palette-panel')
    .locator('.palette-item')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 });
}
