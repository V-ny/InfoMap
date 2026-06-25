// Carrega os dados estáticos do campus (locais, polígono, cache do Overpass).
// Substitui a injeção via f-string que o IFrota.py fazia no gerar_mapa().
import { PATHS, COR_HEX } from "./config.js";

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Falha ao carregar ${url}: ${r.status}`);
  return r.json();
}

export async function carregarLocais() {
  const arr = await fetchJSON(PATHS.locais);
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

export async function carregarEventos() {
  try {
    return await fetchJSON(PATHS.eventos);
  } catch (e) {
    console.warn("[IFrota] eventos.json não encontrado, seguindo sem eventos:", e);
    return [];
  }
}
