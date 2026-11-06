// Carrega os dados estáticos do campus (locais, polígono, cache do Overpass).
// Substitui a injeção via f-string que o IFrota.py fazia no gerar_mapa().
import { PATHS, COR_HEX } from "./config.js";

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao carregar ${url}: ${r.status}`);
  return r.json();
}

// locais.json como está no arquivo (o main compara versões e escolhe a fonte).
export async function carregarLocaisBrutos() {
  return fetchJSON(PATHS.locais);
}

// Campos de runtime derivados do arquivo (cor da categoria em hex).
export function prepararLocais(arr) {
  return arr.map(l => ({ ...l, cor_hex: COR_HEX[l.cor || "green"] || "#5cb85c" }));
}

export async function carregarCampusPoly() {
  const gj = await fetchJSON(PATHS.campus);
  // campus.geojson pode ser uma Feature ou FeatureCollection. Extrai o anel externo.
  const feat = gj.type === "FeatureCollection" ? gj.features[0] : gj;
  if (!feat || !feat.geometry) return null;
  const g = feat.geometry;
  if (g.type === "Polygon") return g.coordinates[0].map(([lon, lat]) => [lat, lon]);
  if (g.type === "MultiPolygon") return g.coordinates[0][0].map(([lon, lat]) => [lat, lon]);
  return null;
}

export async function carregarOverpass() {
  try {
    return await fetchJSON(PATHS.overpass);
  } catch (e) {
    console.warn("[IFrota] Cache Overpass não encontrado, seguindo sem ele:", e);
    return [];
  }
}

// demo=true carrega os eventos de exemplo (modo apresentação) no lugar dos reais.
export async function carregarEventos({ demo = false } = {}) {
  const url = demo ? PATHS.eventosDemo : PATHS.eventos;
  try {
    return await fetchJSON(url);
  } catch (e) {
    console.warn(`[IFrota] ${url} não encontrado, seguindo sem eventos:`, e);
    return [];
  }
}

// Eventos com `sala` acontecem numa sala de um prédio/bloco (`local`): vão para
// sala.evento, onde o card, o marcador e a sidebar já os procuram. Devolve só os
// eventos de topo (waypoint inteiro ou ponto temporário).
export function separarEventosDeSala(locais, eventos) {
  const topo = [];
  for (const ev of eventos || []) {
    if (!ev.sala) { topo.push(ev); continue; }
    const l = locais.find((x) => x.nome === ev.local);
    const salas = !l ? [] : l.andares ? l.andares.flatMap((a) => a.salas || []) : (l.salas || []);
    const s = salas.find((x) => x.nome === ev.sala);
    if (!s) { console.warn(`[IFrota] evento "${ev.nome}": sala "${ev.sala}" não encontrada em "${ev.local}"`); continue; }
    const { local, sala, ...evSala } = ev;
    s.evento = evSala;
  }
  return topo;
}
