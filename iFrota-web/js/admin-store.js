// Armazenamento LOCAL das edições do admin: pontos de interesse criados, eventos
// configurados e eventos-base desativados. Tudo em localStorage (simula web).
// O main.js mescla esses dados com os arquivos base (locais.json / eventos.json).
import { COR_HEX } from "./config.js";

const K_LOCAIS = "ifrota:locais-custom";
const K_EVENTOS = "ifrota:eventos-custom";
const K_DESATIV = "ifrota:eventos-desativados";

function _get(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
function _set(key, v) { localStorage.setItem(key, JSON.stringify(v)); }

// ── Pontos de interesse (waypoints) criados pelo admin ──────────────────────────
export function getLocaisCustom() { return _get(K_LOCAIS); }
export function addLocalCustom(local) {
  const arr = getLocaisCustom();
  arr.push({ ...local, custom: true });
  _set(K_LOCAIS, arr);
}
export function removeLocalCustom(nome) {
  _set(K_LOCAIS, getLocaisCustom().filter((l) => l.nome !== nome));
}

// ── Eventos configurados pelo admin ────────────────────────────────────────────
export function getEventosCustom() { return _get(K_EVENTOS); }
export function addEventoCustom(ev) {
  const arr = getEventosCustom();
  const id = "ev_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  arr.push({ ...ev, id, custom: true });
  _set(K_EVENTOS, arr);
  return id;
}
export function removeEventoCustom(id) {
  _set(K_EVENTOS, getEventosCustom().filter((e) => e.id !== id));
}

// ── Eventos-base (eventos.json) desativados pelo admin ──────────────────────────
export function getDesativados() { return _get(K_DESATIV); }
export function desativarBase(nome) {
  const s = getDesativados();
  if (!s.includes(nome)) { s.push(nome); _set(K_DESATIV, s); }
}
export function reativarBase(nome) {
  _set(K_DESATIV, getDesativados().filter((n) => n !== nome));
}

// ── Merge com os dados base ─────────────────────────────────────────────────────
export function mesclarLocais(base) {
  const custom = getLocaisCustom().map((l) => ({
    ...l, cor_hex: COR_HEX[l.cor || "green"] || "#5cb85c",
  }));
  // remove duplicados por nome (custom prevalece)
  const nomesCustom = new Set(custom.map((l) => l.nome));
  return base.filter((l) => !nomesCustom.has(l.nome)).concat(custom);
}

export function mesclarEventos(base) {
  const desativados = new Set(getDesativados());
  const baseAtivos = (base || []).filter((ev) => !desativados.has(ev.nome));
  return baseAtivos.concat(getEventosCustom());
}
