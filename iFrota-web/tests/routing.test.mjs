// Teste de fumaça do routing.js — roda em Node puro (npm test), sem browser.
// Monta uma rede sintética com 2 fragmentos de rua separados por um vão de
// ~41 m (o Bridge 1 deve conectar) + uma espora vertical, e valida:
//   - A* (heap) acha rota entre os fragmentos;
//   - virtualMap marca conectores e o vão como virtuais (tracejado);
//   - tracking: ETA/remaining sobre a rota e reroute na 3ª leitura off-route;
//   - construção da rede + rota em tempo aceitável numa malha maior.
import { initRouting, calcularRota, atualizarTracking } from "../js/routing.js";

let fail = 0;
function assert(cond, msg) {
  if (cond) { console.log("  ok -", msg); }
  else { console.error("  FALHOU -", msg); fail++; }
}

// ── Malha sintética (coords GeoJSON = [lon, lat]) ──────────────────────────
function linha(coords) {
  return { geometry: { type: "LineString", coordinates: coords } };
}
const Y = -22.52;
const fragA = [];   // x de -43.9960 a -43.9940, passo 0.0002 (~20 m), 11 pontos
for (let i = 0; i <= 10; i++) fragA.push([+(-43.9960 + i * 0.0002).toFixed(5), Y]);
const fragB = [];   // x de -43.9936 a -43.9920 (vão de ~41 m até o fragA), 9 pontos
for (let i = 0; i <= 8; i++) fragB.push([+(-43.9936 + i * 0.0002).toFixed(5), Y]);
// espora vertical que termina ~17 m acima do fragA (exercita os bridges)
const espora = [[-43.9950, -22.51965], [-43.9950, -22.51985]];

const campusPoly = [   // [lat, lon] — retângulo em volta de tudo
  [-22.5230, -43.9970], [-22.5230, -43.9910],
  [-22.5170, -43.9910], [-22.5170, -43.9970],
];

// Mapa falso: só o que o routing usa fora do desenho animado.
const fakeMap = {
  once() { /* não dispara o preload — o teste chama calcularRota direto */ },
  querySourceFeatures() { return [linha(fragA), linha(fragB), linha(espora)]; },
  areTilesLoaded() { return true; },
  isStyleLoaded() { return true; },
  getLayer() { return undefined; },
  getSource() { return undefined; },
  addSource() {}, addLayer() {}, removeLayer() {}, removeSource() {},
  flyTo() {}, fitBounds() {},
};

initRouting(fakeMap, campusPoly, []);

// ── Rota do início do fragA até o fim do fragB ─────────────────────────────
console.log("calcularRota:");
const dest = { nome: "Bloco X", coords: [Y - 0.00005, -43.9922] };
const r = calcularRota(Y - 0.00005, -43.9958, dest, { animate: false });

assert(r.modo === "mapa", `modo = "mapa" (veio "${r.modo}")`);
assert(r.coords.length > 4, `rota com ${r.coords.length} pontos (> 4)`);
// distância em linha reta ~370 m; a rota deve ficar entre isso e o dobro
assert(r.dist >= 350 && r.dist <= 750, `dist = ${r.dist} m (esperado ~370-750)`);
const vm = r.virtualMap || [];   // null em modo linha-reta — não derrubar o teste
assert(vm[0] === true, "1º segmento (posição→rede) é virtual");
assert(vm[vm.length - 1] === true, "último segmento (rede→destino) é virtual");
assert(vm.slice(1, -1).some(Boolean), "vão entre fragmentos marcado como virtual (tracejado)");
const lons = r.coords.map((c) => c[1]);
assert(lons.every((x, i) => i === 0 || x >= lons[i - 1] - 0.0001),
  "rota avança monotonicamente para o destino (sem zigue-zague)");

// Recalcular deve dar resultado idêntico — prova que o undo das injeções
// (_removerInjetado) devolveu a rede cacheada ao estado original.
const rBis = calcularRota(Y - 0.00005, -43.9958, dest, { animate: false });
assert(rBis.dist === r.dist && rBis.coords.length === r.coords.length,
  "2ª rota idêntica à 1ª (undo das injeções restaurou a rede)");

// ── Tracking / reroute ──────────────────────────────────────────────────────
console.log("atualizarTracking:");
// optional chaining em tudo: um retorno null deve virar FALHOU, não TypeError
const sobre = atualizarTracking(Y, -43.9950);          // em cima da rota
assert(sobre?.offDist < 10, `sobre a rota: offDist = ${sobre?.offDist} m (< 10)`);
assert(sobre?.reroute === false, "sobre a rota: sem reroute");
assert(sobre?.remaining > 0 && sobre?.remaining < r.dist, `remaining = ${sobre?.remaining} m (< dist total)`);

const fora = [Y + 0.0005, -43.9950];                    // ~55 m ao norte da rota
const t1 = atualizarTracking(...fora);
const t2 = atualizarTracking(...fora);
const t3 = atualizarTracking(...fora);
assert(t1?.reroute === false && t2?.reroute === false, "off-route: 2 leituras ainda não disparam");
assert(t3?.reroute === true, "off-route: 3ª leitura consecutiva dispara reroute");

// ── Performance da construção (malha maior e mais densa que o campus) ───────
console.log("performance:");
const muitas = [];
for (let i = 0; i < 40; i++) {
  const yy = Y + i * 0.0001;
  const pts = [];
  for (let j = 0; j <= 20; j++) pts.push([+(-43.9960 + j * 0.0002).toFixed(5), +yy.toFixed(5)]);
  muitas.push(linha(pts));
}
initRouting({ ...fakeMap, querySourceFeatures: () => muitas }, campusPoly, []);
const t0 = performance.now();
const r2 = calcularRota(Y, -43.9958, { nome: "Y", coords: [Y + 0.0035, -43.9922] }, { animate: false });
const ms = performance.now() - t0;
assert(r2.modo === "mapa", `rede grande: modo = "mapa"`);
assert(ms < 3000, `rede densa (~1200 nós): rota em ${ms.toFixed(0)} ms (< 3000)`);

console.log(fail ? `\n${fail} asserção(ões) FALHARAM` : "\nTodos os testes passaram.");
process.exit(fail ? 1 : 0);
