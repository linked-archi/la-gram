/**
 * A recorded Git host for the provider tests: each route answers one request,
 * and every request is kept to check — its URL, method, headers and body.
 * No network.
 */
import type { FetchFn } from '../providers/provider.js';

export interface Route {
  method: string;
  /** The URL, exactly, or a pattern. */
  url: string | RegExp;
  status?: number;
  /** A JSON body. */
  body?: unknown;
  /** A text body, instead of JSON. */
  text?: string;
  headers?: Record<string, string>;
}

export interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/** A host that answers the routes, in order of matching; a request no route matches is a test failure. */
export function fakeHost(routes: Route[]): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    calls.push({
      method,
      url,
      headers,
      ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
    });
    const route = routes.find((r) => r.method === method && (typeof r.url === 'string' ? r.url === url : r.url.test(url)));
    if (!route) throw new Error(`No route for ${method} ${url}`);
    const status = route.status ?? 200;
    const body = route.text ?? (route.body === undefined ? '' : JSON.stringify(route.body));
    return new Response(status === 204 ? null : body, { status, headers: route.headers ?? {} });
  };
  return { fetch, calls };
}

/** A fetch that cannot reach anything. */
export const unreachable: FetchFn = async () => {
  throw new TypeError('Failed to fetch');
};
