// Service Worker do IFrota — cache offline do app shell, dados e libs.
// Estratégias:
//   - app shell + dados locais → cache-first (precache no install)
//   - libs CDN (maplibre, fontawesome) → stale-while-revalidate
//   - tiles/glyphs do mapa → cache-first com cache em runtime (cap simples)
const VERSION = "ifrota-v42";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const TILE_CACHE = `${VERSION}-tiles`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/reset.css",
  "./css/theme.css",
  "./css/map.css",
  "./css/ui.css",
  "./js/config.js",
  "./js/data.js",
  "./js/geo.js",
  "./js/store.js",
  "./js/map.js",
  "./js/campus.js",
  "./js/markers.js",
  "./js/location.js",
  "./js/routing.js",
  "./js/eventos.js",
  "./js/sons.js",
  "./js/fotos-store.js",
  "./js/admin-store.js",
  "./js/ui.js",
  "./js/ui-admin.js",
  "./js/main.js",
  "./vendor/maplibre/maplibre-gl.js",
  "./vendor/maplibre/maplibre-gl.css",
  "./vendor/fontawesome/css/font-awesome.min.css",
  "./vendor/fontawesome/fonts/fontawesome-webfont.woff2",
  "./data/locais.json",
  "./data/campus.geojson",
  "./data/overpass-cache.json",
  "./data/style-dark.json",
  "./data/eventos.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim())
      .then(() => trimTileCache(true)),
  );
});

// Cap do cache de tiles: sem isso ele cresce sem limite no dispositivo. A Cache
// API mantém a ordem de inserção e o put() re-insere no FIM, então reinserir no
// hit transforma o corte FIFO num LRU barato (protege os tiles mais usados, que
// são a visão padrão do campus). O trim roda a cada N puts, não a cada fetch —
// o cap é indicativo, pode passar um pouco entre trims.
const TILE_CACHE_MAX = 600;
const TRIM_A_CADA = 25;
let _putsDesdeTrim = 0;
async function trimTileCache(force) {
  if (!force && ++_putsDesdeTrim < TRIM_A_CADA) return;
  _putsDesdeTrim = 0;
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - TILE_CACHE_MAX))) {
    await cache.delete(k);
  }
}

function isTileRequest(url) {
  // Só recursos REMOTOS do mapa. Assets same-origin (ex.: o woff2 do FontAwesome,
  // que casa com /fonts/) ficam no branch do shell — têm precache e não podem
  // ser expulsos pelo trim do cache de tiles.
  if (url.startsWith(self.location.origin)) return false;
  return /tiles\.openfreemap\.org/.test(url) ||
         /\.pbf($|\?)/.test(url) ||
         /\/fonts\//.test(url);
}

function isCDNLib(url) {
  return /unpkg\.com/.test(url) || /cdnjs\.cloudflare\.com/.test(url);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = request.url;

  // Tiles e glyphs do mapa — cache-first em cache dedicado
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) {
          // LRU barato: re-inserir move a entrada pro fim da fila do trim.
          event.waitUntil(cache.put(request, hit.clone()).catch(() => {}));
          return hit;
        }
        try {
          const resp = await fetch(request);
          if (resp.ok) {
            // waitUntil segura o SW vivo até o put (e o trim) completarem —
            // sem isso o navegador pode encerrar o worker e abortar o put.
            event.waitUntil(
              cache.put(request, resp.clone()).then(() => trimTileCache(false)),
            );
          }
          return resp;
        } catch {
          return Response.error();
        }
      }),
    );
    return;
  }

  // Libs de CDN — stale-while-revalidate
  if (isCDNLib(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const fetching = fetch(request).then((resp) => {
          if (resp.ok) cache.put(request, resp.clone());
          return resp;
        }).catch(() => hit);
        return hit || fetching;
      }),
    );
    return;
  }

  // App shell e dados locais — NETWORK-FIRST: sempre busca a versão atual quando
  // online (evita servir JS/CSS/HTML desencontrados em dev e no APK, que carrega
  // do servidor local). Cai pro cache só quando offline.
  event.respondWith(
    fetch(request).then((resp) => {
      if (resp.ok && url.startsWith(self.location.origin)) {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
      }
      return resp;
    }).catch(() =>
      caches.match(request).then((hit) => hit || caches.match("./index.html")),
    ),
  );
});
