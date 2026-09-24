/**
 * A minimal static file server for the browser smoke suite.
 *
 * Written by hand rather than pulled in as a dependency for two reasons:
 * the suite needs no more than "GET a file out of `dist/web`", and it needs
 * *correct* `Content-Type` headers for the few types this app actually loads —
 * notably `application/wasm`, without which Chrome refuses
 * `WebAssembly.instantiateStreaming` and Oxigraph never initialises, and
 * `text/turtle` for the bundled metamodel graphs.
 *
 * Binds to an ephemeral port so several runs can overlap, and serves only
 * paths that resolve inside the served root.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  // Load-bearing: Chrome rejects a streamed WASM module served as octet-stream.
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.ttl': 'text/turtle; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticServer {
  /** Origin the server is reachable at, e.g. `http://127.0.0.1:41234`. */
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** Serve `root` over HTTP on an ephemeral localhost port. */
export async function startStaticServer(root: string): Promise<StaticServer> {
  const absoluteRoot = path.resolve(root);

  const server: Server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(requestUrl.pathname);
      const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
      const filePath = path.resolve(absoluteRoot, relative);

      // Refuse anything that escapes the served root.
      if (filePath !== absoluteRoot && !filePath.startsWith(absoluteRoot + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      try {
        const stats = await stat(filePath);
        if (stats.isDirectory()) {
          response.writeHead(404).end('Not Found');
          return;
        }
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': String(stats.size),
          'Cache-Control': 'no-store',
        });
        createReadStream(filePath).pipe(response);
      } catch {
        response.writeHead(404).end('Not Found');
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('static server did not bind to a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
