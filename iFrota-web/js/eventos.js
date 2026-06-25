// Sistema de eventos — waypoints especiais (estrela dourada) ativos em certos
// dias da semana, opcionalmente dentro de um período (inicio/fim) e dentro de
// uma JANELA DE HORÁRIO no dia (horaInicio/horaFim). O ícone de evento aparece
// na hora de início e some na hora de término, acompanhando o relógio do sistema.
import { COR_HEX } from "./config.js";

const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

// Horários-padrão do campus (períodos de aula) — usados como opções no formulário
// do admin. Agrupados por turno; cada slot é [inicio, fim] em "HH:MM".
export const HORARIOS_PADRAO = [
  { turno: "Manhã", slots: [["08:00", "08:45"], ["08:45", "09:30"], ["09:30", "10:15"], ["10:30", "11:15"], ["11:15", "12:00"]] },
  { turno: "Tarde", slots: [["13:00", "13:45"], ["13:45", "14:30"], ["14:30", "15:15"], ["15:30", "16:15"], ["16:15", "17:00"]] },
  { turno: "Noite", slots: [["18:00", "18:45"], ["18:45", "19:30"], ["19:30", "20:15"], ["20:30", "21:15"], ["21:15", "22:00"]] },
];

// ── Relógio: HORA DA WEB (com fallback offline e override de debug) ──────────────
// O relógio do dispositivo pode estar errado, então a base do tempo é a hora da
// web (NTP via API pública). Guardamos só o OFFSET (web − dispositivo) e somamos
// ao Date.now(); assim, mesmo offline, seguimos usando o último offset conhecido.
// ?dia=qua&hora=19:30 ainda força dia/hora para testes.
let _override = null;   // { dia: idx|null, hora: minutos|null }
let _webOffset = 0;     // ms: horaWeb − horaDispositivo
try {
  const v = Number(localStorage.getItem("ifrota:hora-offset"));
  if (Number.isFinite(v)) _webOffset = v;
} catch { /* sem localStorage (ex.: testes Node) */ }

export function setRelogioOverride(o) { _override = o; }
export function getHoraOffset() { return _webOffset; }
export function setHoraOffset(ms) {
  _webOffset = ms;
  try { localStorage.setItem("ifrota:hora-offset", String(ms)); } catch { /* ignore */ }
}

export function agoraReal() {
  const d = new Date(Date.now() + _webOffset);
  if (_override) {
    if (_override.dia != null) d.setDate(d.getDate() + (_override.dia - d.getDay()));
    if (_override.hora != null) d.setHours(Math.floor(_override.hora / 60), _override.hora % 60, 0, 0);
  }
  return d;
}

// Busca a hora da web (UTC) e atualiza o offset. Retorna o offset (ms) ou null se
// todas as fontes falharem (offline) — nesse caso mantém o último offset salvo.
export async function sincronizarHoraWeb() {
  const fontes = [
    { url: "https://timeapi.io/api/Time/current/zone?timeZone=UTC",
      epoch: (j) => Date.UTC(j.year, j.month - 1, j.day, j.hour, j.minute, j.seconds, j.milliSeconds || 0) },
    { url: "https://worldclockapi.com/api/json/utc/now",
      epoch: (j) => Date.parse(j.currentDateTime) },
  ];
  for (const f of fontes) {
    try {
      const t0 = Date.now();
      const resp = await fetch(f.url, { cache: "no-store" });
      if (!resp.ok) continue;
      const web = f.epoch(await resp.json());
      if (!Number.isFinite(web)) continue;
      const t1 = Date.now();
      // compensa ~metade da latência: a hora do servidor vale pelo meio do RTT
      const offset = web + Math.round((t1 - t0) / 2) - t1;
      setHoraOffset(offset);
      return offset;
    } catch { /* tenta a próxima fonte */ }
  }
  return null;
}

// "HH:MM" → minutos desde a meia-noite (ou null se inválido).
function hhmmParaMin(s) {
  if (!s || typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

export function minutosAgora(d = agoraReal()) {
  return d.getHours() * 60 + d.getMinutes();
}

export function hojeKey() {
  return DOW[agoraReal().getDay()];
}

// ── Atividade por DIA (dia da semana + período de datas) ────────────────────────
// Evento ocorre HOJE? (ignora a hora — usado pela lista lateral dos 7 dias)
export function eventoAtivoHoje(ev, hoje = agoraReal()) {
  const k = DOW[hoje.getDay()];
  if (!ev.dias || !ev.dias.includes(k)) return false;
  // Data LOCAL (não toISOString, que é UTC e viraria o dia à noite no Brasil).
  const ymd = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  if (ev.inicio && ymd < ev.inicio) return false;
  if (ev.fim && ymd > ev.fim) return false;
  return true;
}

export function eventosAtivosHoje(eventos) {
  return (eventos || []).filter((ev) => eventoAtivoHoje(ev));
}

// ── Janela de HORÁRIO no dia ────────────────────────────────────────────────────
// Retorna [iniMin, fimMin) da janela de atividade do evento no dia, ou null quando
// não há janela definida (= ativo o dia inteiro). Prefere horaInicio/horaFim
// explícitos; na ausência, deriva o início do menor horário da agenda daquele dia.
export function janelaDoEvento(ev, hoje = agoraReal()) {
  let ini = hhmmParaMin(ev.horaInicio);
  let fim = hhmmParaMin(ev.horaFim);
  if (ini == null && ev.horarios) {
    const itens = ev.horarios[DOW[hoje.getDay()]];
    if (itens && itens.length) {
      const mins = itens.map((it) => hhmmParaMin(it[0])).filter((x) => x != null);
      if (mins.length) ini = Math.min(...mins);
    }
  }
  if (ini == null) return null;        // sem janela → dia inteiro
  if (fim == null) fim = 24 * 60;      // só início → até o fim do dia
  return [ini, fim];
}

// Evento está ativo AGORA? (ocorre hoje E a hora atual está dentro da janela)
export function eventoAtivoAgora(ev, agora = agoraReal()) {
  if (!eventoAtivoHoje(ev, agora)) return false;
  const j = janelaDoEvento(ev, agora);
  if (!j) return true;                 // sem janela → ativo o dia todo
  const m = minutosAgora(agora);
  return m >= j[0] && m < j[1];
}

export function eventosAtivosAgora(eventos, agora = agoraReal()) {
  return (eventos || []).filter((ev) => eventoAtivoAgora(ev, agora));
}

// ── Próximos 7 dias (lista lateral) ─────────────────────────────────────────────
// Eventos com ao menos uma ocorrência nos próximos 7 dias (incluindo hoje).
export function eventosProximos7Dias(eventos) {
  const hoje = agoraReal();
  return (eventos || []).filter((ev) => {
    for (let i = 0; i < 7; i++) {
      const d = new Date(hoje);
      d.setDate(hoje.getDate() + i);
      if (eventoAtivoHoje(ev, d)) return true;
    }
    return false;
  });
}

// Rótulo da próxima ocorrência do evento (Hoje / Amanhã / nome do dia).
export function proximaOcorrencia(ev) {
  const hoje = agoraReal();
  const nomes = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  for (let i = 0; i < 7; i++) {
    const d = new Date(hoje);
    d.setDate(hoje.getDate() + i);
    if (eventoAtivoHoje(ev, d)) {
      if (i === 0) return "Hoje";
      if (i === 1) return "Amanhã";
      return nomes[d.getDay()];
    }
  }
  return "";
}

// Conjunto de chaves de dia em que o evento ocorre (pra pintar a agenda de dourado).
export function diasDoEvento(ev) {
  return new Set(ev && ev.dias ? ev.dias : []);
}

// Resolve a posição [lat, lon] do evento: usa coords próprias (temporário) ou
// as coords do waypoint existente referenciado em `local`.
export function coordsDoEvento(ev, locais) {
  if (ev.coords) return ev.coords;
  const l = (locais || []).find((x) => x.nome === ev.local);
  return l ? l.coords : null;
}

// Constrói um "local" (waypoint) a partir de um evento temporário (sem waypoint
// existente). Marca isEvento + guarda o evento pra a agenda/estilo.
export function eventoParaLocal(ev) {
  return {
    nome: ev.nome,
    coords: ev.coords,
    cor: ev.cor || "orange",
    cor_hex: COR_HEX[ev.cor || "orange"] || "#f0ad4e",
    icone: ev.icone || "star",
    cat: ev.cat || "Eventos",
    desc: ev.desc || "",
    agenda: ev.horarios || {},
    isEvento: true,
    evento: ev,
  };
}

// Indexa eventos por nome de waypoint existente (local) pra lookup rápido.
export function indexarPorLocal(eventos) {
  const m = new Map();
  for (const ev of eventos || []) {
    if (ev.local) m.set(ev.local, ev);
  }
  return m;
}
