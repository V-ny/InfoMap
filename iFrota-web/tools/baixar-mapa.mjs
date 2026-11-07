// Baixa o mapa base do campus para dentro do app (vendor/mapa/), para ele abrir
// 100% offline — inclusive na 1ª abertura do APK. A área navegável (maxBounds do
// map.js) cabe em poucos tiles: as vector tiles do OpenFreeMap vão até o zoom 14
// e o MapLibre amplia (overzoom) daí até o 21.
//   - tiles/14/x/y.pbf   vector tiles (OpenMapTiles) que cobrem a área
//   - style-light.json   estilo Positron, apontando para os arquivos locais
//   - sprites/           ícones do estilo (1x e 2x)
//   - fonts/             glifos das fontes usadas pelos dois estilos (claro/escuro)
// Rode de novo para atualizar com dados mais novos do OpenStreetMap:
//   node tools/baixar-mapa.mjs
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { SW, NE } from "../js/config.js";

const OUT = "vendor/mapa";
const BASE = "https://tiles.openfreemap.org";
const Z = 14;
const MARGEM = 0.005;   // a mesma folga do maxBounds em js/map.js
// Faixas Unicode baixadas: Latin-1 (acentos do português), Latin Extended-A e
// pontuação geral (travessão, aspas curvas).
const FAIXAS = ["0-255", "256-511", "8192-8447"];
// Placeholder resolvido em runtime (js/map.js) para a URL absoluta da pasta.
const LOCAL = "mapa-local://";

async function baixar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
const baixarJSON = async (url) => JSON.parse((await baixar(url)).toString("utf8"));
async function salvar(caminho, dados) {
  await mkdir(caminho.slice(0, caminho.lastIndexOf("/")), { recursive: true });
  await writeFile(caminho, dados);
  return dados.length;
}

function tile(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  return [x, y];
}

await rm(OUT, { recursive: true, force: true });
let total = 0;

// ── Tiles ────────────────────────────────────────────────────────────────────
const tilejson = await baixarJSON(`${BASE}/planet`);
const modelo = tilejson.tiles[0];
const [x0, y0] = tile(NE[0] + MARGEM, SW[1] - MARGEM, Z);   // canto noroeste
const [x1, y1] = tile(SW[0] - MARGEM, NE[1] + MARGEM, Z);   // canto sudeste
let nTiles = 0;
for (let x = x0; x <= x1; x++) {
  for (let y = y0; y <= y1; y++) {
    const url = modelo.replace("{z}", Z).replace("{x}", x).replace("{y}", y);
    total += await salvar(`${OUT}/tiles/${Z}/${x}/${y}.pbf`, await baixar(url));
    nTiles++;
  }
}

// ── Estilo claro (Positron) → arquivos locais ────────────────────────────────
const style = await baixarJSON(`${BASE}/styles/positron`);
// Relevo sombreado raster (Natural Earth) só aparece em zoom baixo — fora daqui.
for (const [id, src] of Object.entries(style.sources)) {
  if (id !== "openmaptiles") {
    delete style.sources[id];
    style.layers = style.layers.filter((l) => l.source !== id);
  }
}
style.sources.openmaptiles = {
  type: "vector",
  tiles: [`${LOCAL}tiles/{z}/{x}/{y}.pbf`],
  minzoom: Z,
  maxzoom: Z,
  attribution: tilejson.attribution,
};
// Nomes de fonte sem espaço ("Noto-Sans-Regular"): o nome vira o caminho do
// arquivo de glifos, e assim a URL não depende de como cada servidor (http.server,
// WebView do Capacitor) decodifica o %20.
const semEspaco = (f) => f.replace(/ /g, "-");
for (const l of style.layers) {
  const f = l.layout?.["text-font"];
  if (Array.isArray(f)) l.layout["text-font"] = f.map(semEspaco);
}
style.sprite = `${LOCAL}sprites/ofm`;
style.glyphs = `${LOCAL}fonts/{fontstack}/{range}.pbf`;
total += await salvar(`${OUT}/style-light.json`, JSON.stringify(style));

// ── Sprites ──────────────────────────────────────────────────────────────────
const spriteRemoto = (await baixarJSON(`${BASE}/styles/positron`)).sprite;
for (const sufixo of [".json", ".png", "@2x.json", "@2x.png"]) {
  total += await salvar(`${OUT}/sprites/ofm${sufixo}`, await baixar(spriteRemoto + sufixo));
}

// ── Fontes (claro + escuro) ──────────────────────────────────────────────────
const escuro = JSON.parse(await readFile("data/style-dark.json", "utf8"));
const fontes = new Set();
for (const l of [...style.layers, ...escuro.layers]) {
  const f = l.layout?.["text-font"];
  if (Array.isArray(f)) f.forEach((x) => fontes.add(semEspaco(x)));
}
for (const fonte of fontes) {
  const remota = fonte.replace(/-/g, " ");   // nome original no OpenFreeMap
  for (const faixa of FAIXAS) {
    total += await salvar(`${OUT}/fonts/${fonte}/${faixa}.pbf`,
      await baixar(`${BASE}/fonts/${encodeURIComponent(remota)}/${faixa}.pbf`));
  }
}

console.log(`[baixar-mapa] ${nTiles} tiles z${Z} (x ${x0}-${x1}, y ${y0}-${y1}), ` +
  `${fontes.size} fontes, sprites — ${(total / 1024).toFixed(0)} KB em ${OUT}/`);
