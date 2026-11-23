/**
 * ELK's layout in a worker (ELK task, R13): elkjs's own worker script, which answers `elk-api.js`'s messages
 * once it runs where there is `self` and no `document`. Bundled by webpack as validation's worker is
 * (`new Worker(new URL(…, import.meta.url))`), so the web app and the desktop renderer load it from the app.
 */
import 'elkjs/lib/elk-worker.min.js';
