// Armazenamento LOCAL das edições do admin: pontos de interesse criados, eventos
// configurados e eventos-base desativados. Tudo em localStorage (simula web).
// O main.js mescla esses dados com os arquivos base (locais.json / eventos.json).
import { COR_HEX } from "./config.js";

const K_LOCAIS = "ifrota:locais-custom";
const K_EVENTOS = "ifrota:eventos-custom";
const K_DESATIV = "ifrota:eventos-desativados";
const K_CARDAPIOS = "ifrota:cardapios";

function _get(key) { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } }
function _getObj(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } }
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

// ── Cardápios semanais (sobrepõem o do JSON, por nome de ponto) ──────────────────
export function getCardapios() { return _getObj(K_CARDAPIOS); }   // { nome: cardapio }
export function setCardapio(nome, cardapio) { const m = getCardapios(); m[nome] = cardapio; _set(K_CARDAPIOS, m); }
export function removeCardapio(nome) { const m = getCardapios(); delete m[nome]; _set(K_CARDAPIOS, m); }
// Aplica os cardápios do admin sobre os locais (sobrepõe o do JSON).
export function mesclarCardapios(locais) {
  const m = getCardapios();
  for (const l of locais || []) { if (m[l.nome]) l.cardapio = m[l.nome]; }
  return locais;
}

// Limpa TUDO que foi criado localmente (pontos/eventos/cardápios/desativações).
// Útil após os pontos já terem sido gravados no data/locais.json (senão duplicam).
export function limparTudoCustom() {
  [K_LOCAIS, K_EVENTOS, K_DESATIV, K_CARDAPIOS].forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
}

// ── Exportar / Importar todas as edições do admin (backup / transferência) ──────
// Junta tudo num objeto p/ baixar como JSON e restaurar em outro navegador/celular.
export function exportarDados() {
  return {
    _app: "ifrota", _formato: 1, _exportadoEm: new Date().toISOString(),
    locais: getLocaisCustom(),
    eventos: getEventosCustom(),
    desativados: getDesativados(),
    cardapios: getCardapios(),
  };
}
function _mergePorChave(atual, novos, chave) {
  const map = new Map(atual.map((x) => [x[chave], x]));
  for (const n of novos) map.set(n[chave], n);   // novos sobrepõem por chave
  return [...map.values()];
}
// mesclar=true: soma aos dados atuais (não apaga o que já existe). false: substitui.
export function importarDados(obj, { mesclar = true } = {}) {
  if (!obj || typeof obj !== "object") throw new Error("Arquivo inválido");
  if (Array.isArray(obj.locais)) {
    _set(K_LOCAIS, mesclar ? _mergePorChave(getLocaisCustom(), obj.locais, "nome") : obj.locais);
  }
  if (Array.isArray(obj.eventos)) {
    _set(K_EVENTOS, mesclar ? _mergePorChave(getEventosCustom(), obj.eventos, "id") : obj.eventos);
  }
  if (Array.isArray(obj.desativados)) {
    _set(K_DESATIV, mesclar ? [...new Set([...getDesativados(), ...obj.desativados])] : obj.desativados);
  }
  if (obj.cardapios && typeof obj.cardapios === "object") {
    _set(K_CARDAPIOS, mesclar ? { ...getCardapios(), ...obj.cardapios } : obj.cardapios);
  }
  return {
    locais: Array.isArray(obj.locais) ? obj.locais.length : 0,
    eventos: Array.isArray(obj.eventos) ? obj.eventos.length : 0,
  };
}
