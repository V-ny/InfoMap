// Testes dos dados publicados e do pipeline de atualização (npm test):
//   - mesclarExport: backup do admin → locais.json / eventos.json
//   - separarEventosDeSala: eventos com `sala` vão para dentro do prédio/bloco
//   - sanidade dos arquivos reais em data/ (o que os estudantes vão receber)
import { readFileSync } from "node:fs";
import { mesclarExport } from "../tools/mesclar-export.mjs";
import { separarEventosDeSala } from "../js/data.js";

let fail = 0;
function assert(cond, msg) {
  if (cond) console.log("  ok -", msg);
  else { console.error("  FALHOU -", msg); fail++; }
}

// ── mesclarExport ────────────────────────────────────────────────────────────
console.log("mesclarExport:");
const locais = [
  { nome: "Biblioteca", coords: [-22.52, -43.99], cor: "blue", cat: "Ensino" },
  { nome: "Refeitório", coords: [-22.521, -43.991], tipo: "refeitorio" },
];
const eventos = [
  { nome: "Semana X", local: "Biblioteca", dias: ["seg"] },
  { nome: "Feira Y", coords: [-22.52, -43.99], dias: ["sab"] },
];
const exp = {
  _app: "ifrota", _formato: 1,
  locais: [
    { nome: "Ginásio", coords: [-22.519, -43.992], cor: "green", custom: true, cor_hex: "#5cb85c" },
    { nome: "Biblioteca", coords: [-22.52, -43.99], cor: "red", cat: "Ensino", custom: true },
  ],
  eventos: [{ id: "ev_1", custom: true, nome: "Palestra Z", local: "Ginásio", dias: ["qua"], horaInicio: "19:00" }],
  desativados: ["Feira Y"],
  cardapios: { "Refeitório": { inicio: "2026-11-02", fim: "2026-11-06", dias: { seg: ["Arroz"] } }, "Fantasma": { dias: {} } },
};
const r = mesclarExport(locais, eventos, exp);

assert(r.locais.length === 3, `3 locais após o merge (veio ${r.locais.length})`);
const gin = r.locais.find((l) => l.nome === "Ginásio");
assert(gin && !("custom" in gin) && !("cor_hex" in gin), "local novo entra sem campos de runtime (custom, cor_hex)");
assert(r.locais.find((l) => l.nome === "Biblioteca").cor === "red", "local existente é atualizado (upsert por nome)");
assert(r.eventos.every((e) => e.nome !== "Feira Y"), "evento desativado sai do eventos.json");
const pal = r.eventos.find((e) => e.nome === "Palestra Z");
assert(pal && !("id" in pal) && !("custom" in pal), "evento novo entra sem id/custom");
assert(r.locais.find((l) => l.nome === "Refeitório").cardapio?.inicio === "2026-11-02", "cardápio gravado no refeitório");
assert(r.resumo.avisos.some((a) => a.includes("Fantasma")), "cardápio de local inexistente vira aviso, não erro");
assert(locais[0].cor === "blue" && eventos.length === 2, "entradas originais não são mutadas");

let lancou = false;
try { mesclarExport(locais, eventos, { locais: [] }); } catch { lancou = true; }
assert(lancou, "arquivo sem _app: \"ifrota\" é rejeitado");

// ── separarEventosDeSala ─────────────────────────────────────────────────────
console.log("separarEventosDeSala:");
const predios = [
  { nome: "Prédio A", andares: [{ nome: "Térreo", salas: [{ nome: "Lab 1" }, { nome: "Sala 2" }] }] },
  { nome: "Bloco B", salas: [{ nome: "Sala 9" }] },
];
const topo = separarEventosDeSala(predios, [
  { nome: "Maratona", local: "Prédio A", sala: "Lab 1", dias: ["seg"], horaInicio: "08:00" },
  { nome: "Aula aberta", local: "Bloco B", sala: "Sala 9", dias: ["ter"] },
  { nome: "Show", local: "Bloco B", dias: ["sex"] },
  { nome: "Perdido", local: "Prédio A", sala: "Não existe", dias: ["seg"] },
]);
const lab = predios[0].andares[0].salas[0];
assert(lab.evento?.nome === "Maratona", "evento de sala anexado à sala do prédio (andares)");
assert(lab.evento && !("local" in lab.evento) && !("sala" in lab.evento), "evento anexado sem os campos de roteamento");
assert(predios[1].salas[0].evento?.nome === "Aula aberta", "evento de sala anexado em bloco (salas diretas)");
assert(topo.length === 1 && topo[0].nome === "Show", "só eventos sem `sala` voltam como topo; sala inexistente é descartada");

// ── Sanidade dos dados publicados ────────────────────────────────────────────
console.log("dados publicados (data/):");
const ler = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const pub = ler("locais.json");
const nomes = pub.map((l) => l.nome);
assert(new Set(nomes).size === nomes.length, `nomes de locais únicos (${nomes.length} locais)`);
assert(pub.every((l) => Array.isArray(l.coords) && l.coords.length === 2 && l.coords.every(Number.isFinite)),
  "todo local tem coords [lat, lon] numéricas");
const evPub = ler("eventos.json");
assert(evPub.every((e) => !e.local || nomes.includes(e.local)), "eventos publicados apontam para locais existentes");
const demo = ler("eventos.demo.json");
assert(demo.every((e) => !e.local || nomes.includes(e.local)), "eventos de demonstração apontam para locais existentes");

console.log(fail ? `\n${fail} asserção(ões) FALHARAM` : "\nTodos os testes passaram.");
process.exit(fail ? 1 : 0);
