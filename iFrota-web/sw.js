// Service Worker do IFrota — cache offline do app shell, dados e libs.
// Estratégias:
//   - app shell + dados locais → cache-first (precache no install)
//   - libs CDN (maplibre, fontawesome) → stale-while-revalidate
//   - tiles/glyphs do mapa → cache-first com cache em runtime (cap simples)
const VERSION = "ifrota-v40";
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
    ).then(() => self.clients.claim()),
  );
});

function isTileRequest(url) {
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
        if (hit) return hit;
        try {
          const resp = await fetch(request);
          if (resp.ok) cache.put(request, resp.clone());
          return resp;
        } catch {
          return hit || Response.error();
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
