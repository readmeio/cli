import nock from 'nock';

// Listener from the most recent mockFetch() call. Hosts with no interceptor
// emit nock's "no match" event; resetFetchMocks() detaches it.
let unmatchedListener = null;

/**
 * Drop interceptors installed by mockFetch() and allow real network connects
 * again. Safe to call when nothing was mocked.
 */
export function resetFetchMocks() {
  if (unmatchedListener) {
    nock.emitter.off('no match', unmatchedListener);
    unmatchedListener = null;
  }
  nock.cleanAll();
  nock.enableNetConnect();
}

/**
 * Intercept native `fetch` with nock.
 *
 * `routes` maps an absolute URL to a string body (HTTP 200), an `Error`
 * (the request fails), or `{ body, status, ok, finalUrl }`. A `finalUrl`
 * that differs from the request is served as a redirect, so `response.url`
 * is the URL fetch actually landed on. `*` applies to any other path on an
 * intercepted origin. Everything else on those origins is a 404, and any
 * other origin is refused.
 *
 * @param {Record<string, string | Error | { body?: string, status?: number, ok?: boolean, finalUrl?: string }>} [routes]
 * @param {{ origins?: string[], fallback?: (href: string) => [number, string] | undefined }} [options]
 * @returns {string[]} Every request URL nock observed, including redirect hops
 *   and hosts that were refused.
 */
export function mockFetch(routes = {}, options = {}) {
  resetFetchMocks();

  const seen = [];
  unmatchedListener = request => {
    if (request?.url) seen.push(request.url);
  };
  nock.emitter.on('no match', unmatchedListener);
  nock.disableNetConnect();

  const table = new Map();
  const origins = new Set(options.origins || []);
  const explicit = [];
  let star = null;

  for (const [href, raw] of Object.entries(routes)) {
    if (href === '*') {
      const route = normalizeRoute(raw);
      if (!route.error) star = { status: route.status, body: route.body };
      continue;
    }

    const route = normalizeRoute(raw);
    const key = stripHash(href);
    origins.add(new URL(key).origin);
    explicit.push([key, route]);
  }

  // Explicit URLs win over a redirect target synthesized from another route.
  const explicitKeys = new Set(explicit.map(([key]) => key));
  for (const [key, route] of explicit) {
    if (route.error) {
      table.set(key, { error: route.error });
      continue;
    }
    const landed = route.finalUrl ? stripHash(route.finalUrl) : null;
    if (landed && landed !== key) {
      table.set(key, { redirectTo: route.finalUrl });
      origins.add(new URL(landed).origin);
      continue;
    }
    table.set(key, { status: route.status, body: route.body });
  }
  for (const [key, route] of explicit) {
    if (route.error || !route.finalUrl) continue;
    const landed = stripHash(route.finalUrl);
    if (landed === key || explicitKeys.has(landed) || table.has(landed)) continue;
    table.set(landed, { status: route.status, body: route.body });
  }

  for (const origin of origins) {
    nock(origin)
      .persist()
      .get(() => true)
      .reply(request => {
        const href = request.url;
        seen.push(href);
        const hit = table.get(stripHash(href));
        if (hit?.error) throw hit.error;
        if (hit?.redirectTo) return [302, '', { Location: hit.redirectTo }];
        if (hit) return [hit.status, hit.body];

        if (options.fallback) {
          const answered = options.fallback(href);
          if (answered) return answered;
        }
        if (star) return [star.status, star.body];
        return [404, ''];
      });
  }

  return seen;
}

function normalizeRoute(entry) {
  if (entry instanceof Error) return { error: entry };
  if (typeof entry === 'string') return { status: 200, body: entry };
  return {
    status: entry.status ?? (entry.ok === false ? 404 : 200),
    body: entry.body || '',
    finalUrl: entry.finalUrl || null,
  };
}

function stripHash(href) {
  const url = new URL(href);
  url.hash = '';
  return url.href;
}
