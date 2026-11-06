// Monta a pasta www/ (webDir do Capacitor) copiando apenas os assets do app —
// sem node_modules, android/, scripts de dev. Rode antes de `npx cap sync`.
import { cp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const OUT = "www";
const ITEMS = [
  "index.html",
  "manifest.json",
  "sw.js",
  "css",
  "js",
  "data",
  "vendor",
  "icons",
  "fotos",
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const item of ITEMS) {
  if (!existsSync(item)) {
    console.warn(`[build-www] aviso: ${item} não encontrado, pulando`);
    continue;
  }
  await cp(item, `${OUT}/${item}`, { recursive: true });
}

// Versão + data do build: exibidas no painel e usadas pelo app para descartar
// uma cópia de dados remotos mais antiga que o próprio APK (js/remoto.js).
const { version } = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(`${OUT}/build.json`, JSON.stringify({ versao: version, gerado: Date.now() }) + "\n");

console.log(`[build-www] www/ montado com ${ITEMS.length} itens (v${version})`);
