/**
 * Build-time switches, set by webpack's `DefinePlugin` (`webpack.config.js`).
 * A branch on one that is `false` is dropped from the bundle, and with it what
 * only that branch imports.
 */

/** Whether the build has the Git storage module (`LA_GRAM_GIT=off` leaves it out; Req 18.1). */
declare const __LA_GRAM_GIT__: boolean;

/** A digest of the bundled assets, put on their addresses (`assetUrl`); not defined under Vitest. */
declare const __LA_GRAM_ASSETS_VERSION__: string;

/**
 * la-gram's version and the open-source components it is built with, for About; the channel it is built for
 * (`LA_GRAM_CHANNEL`: `alpha`, or `''` for a release), which keeps its browser storage apart
 * (`storage-scope.ts`). Not defined under Vitest.
 */
declare const __LA_GRAM_BUILD__: {
  version: string;
  channel?: string;
  components: Array<{ name: string; version: string; license: string }>;
};
