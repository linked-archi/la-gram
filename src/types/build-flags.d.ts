/**
 * Build-time switches, set by webpack's `DefinePlugin` (`webpack.config.js`).
 * A branch on one that is `false` is dropped from the bundle, and with it what
 * only that branch imports.
 */

/** Whether the build has the Git storage module (`LA_GRAM_GIT=off` leaves it out; Req 18.1). */
declare const __LA_GRAM_GIT__: boolean;
