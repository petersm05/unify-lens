// build: assets/index-Cv3jIbij.js assets/index-nsNAPRvI.css
/**
 * Offline launch and instant start-up.
 *
 * Only the app's own shell is cached — never a GraphQL response, never anything
 * from Cognito, never `config.json`. Those are cross-origin or deliberately
 * uncached, and a stale answer from any of them would be worse than a slow one.
 *
 * There is no build-time asset manifest. Vite emits content-hashed filenames
 * that this file cannot know, so instead it fetches `index.html` during install
 * and precaches whatever that document references. One less build step to keep
 * in step with reality.
 */

// Bump to retire every previously cached shell.
const CACHE = 'lens-shell-v1';

/** Stable paths worth having before they are asked for. */
const SHELL = [
  './',
  './manifest.webmanifest',
  './brand/mark.svg',
  './brand/favicon-32.png',
  './brand/apple-touch-icon.png',
  './brand/icon-192.png',
  './brand/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);

      // Read the entry document and precache the bundle it points at, so the
      // very first visit is enough to make the next one work offline.
      const assets = [];
      try {
        const response = await fetch('./', { cache: 'reload' });
        if (response.ok) {
          await cache.put('./', response.clone());
          const html = await response.text();
          for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
            assets.push(match[1]);
          }
        }
      } catch {
        // Offline during install: the shell fills in as things are requested.
      }

      // Individually, so one missing icon cannot fail the whole install.
      await Promise.all(
        [...SHELL, ...assets].map((path) =>
          cache.add(path).catch(() => undefined),
        ),
      );

      // Deliberately no skipWaiting here. A new worker taking over while the
      // page is still running the previous bundle means the two disagree about
      // what the app is. It waits instead, the page offers the update, and only
      // an explicit message below hands it control.
      
    })(),
  );
});

// Sent by the page when someone accepts the update. Taking over is then a
// decision that was asked for, and the page reloads itself on controllerchange.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** Drops cached bundles that the current document no longer references. */
async function pruneAssets(cache, html) {
  const wanted = new Set();
  for (const match of html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)) {
    wanted.add(match[1]);
  }
  // An empty set means the document was not what we expected; keeping
  // everything is the safer misreading.
  if (wanted.size === 0) return;

  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    const index = path.indexOf('assets/');
    if (index === -1) continue;
    if (!wanted.has(path.slice(index))) await cache.delete(request);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Anything not served from this app is none of our business: the API, the
  // token endpoints and a tenant's env.js all have to reach the network.
  if (url.origin !== self.location.origin) return;
  // Which environment a deployment points at must never come from a cache.
  if (url.pathname.endsWith('/config.json')) return;

  // The entry document decides which bundle to load, so a new deploy has to be
  // able to win. Network first, cache only as the offline answer.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          const copy = fresh.clone();
          await cache.put('./', copy.clone());
          // A deploy renames every asset, so the ones this document no longer
          // mentions are dead weight. Without this the cache only ever grows:
          // roughly two megabytes of orphaned bundle per release.
          //
          // waitUntil is only legal while the event is still active, and this
          // point is several awaits into handling it. Where a browser refuses,
          // the tidy-up is still worth starting — it simply loses the promise
          // that the worker stays alive for it, and catches up next launch.
          // What must not happen is the refusal escaping into respondWith,
          // where it would fail the navigation itself.
          const pruning = pruneAssets(cache, await copy.text());
          try {
            event.waitUntil(pruning);
          } catch {
            void pruning;
          }
          return fresh;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(request)) ?? (await cache.match('./')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed filenames name their own content, so a hit can never be stale.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      })(),
    );
    return;
  }

  // Everything else of ours — icons, the manifest — answers from cache and
  // refreshes behind the reader.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      const network = fetch(request)
        .then(async (fresh) => {
          if (fresh.ok) await cache.put(request, fresh.clone());
          return fresh;
        })
        .catch(() => hit ?? Response.error());
      return hit ?? network;
    })(),
  );
});
