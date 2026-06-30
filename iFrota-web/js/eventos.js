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

// ── Recorrência (por DATA) ──────────────────────────────────────────────────────
// Modos: "semanal" (dias[]), "unica" (data "YYYY-MM-DD"), "mensal" por dia-do-mês
// (diaMes 1..31) OU pela Nª ocorrência do dia da semana no mês (semanaMes 1..5|"ultima").
// Sempre limitado pelo período inicio/fim (datas). Ignora a hora.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function diasNoMes(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

export function ocorreNaData(ev, d = agoraReal()) {
  if (!ev) return false;
  const ymd = ymdLocal(d);
  if (ev.inicio && ymd < ev.inicio) return false;
  if (ev.fim && ymd > ev.fim) return false;
  const rep = ev.repete || (ev.data ? "unica" : "semanal");
  if (rep === "unica") return ev.data === ymd;
  if (rep === "mensal") {
    if (ev.diaMes) return d.getDate() === +ev.diaMes;
    if (ev.semanaMes && ev.dias && ev.dias.includes(DOW[d.getDay()])) {
      if (ev.semanaMes === "ultima") return d.getDate() + 7 > diasNoMes(d);
      return Math.floor((d.getDate() - 1) / 7) + 1 === +ev.semanaMes;
    }
    return false;
  }
  return !!(ev.dias && ev.dias.includes(DOW[d.getDay()]));   // semanal
}

// Compat: "ocorre hoje" (nível de DIA) — usado pela agenda/grade semanal.
export function eventoAtivoHoje(ev, hoje = agoraReal()) { return ocorreNaData(ev, hoje); }

// "20:15–22:00" (duração), "a partir de 20:15" (só início) ou "" (dia todo).
export function formatarJanela(ev) {
  if (!ev || !ev.horaInicio) return "";
  return ev.horaFim ? `${ev.horaInicio}–${ev.horaFim}` : `a partir de ${ev.horaInicio}`;
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

// ── Eventos em containers (prédios/blocos) ──────────────────────────────────────
// Salas de um container: bloco → `salas`; prédio → salas de todos os `andares`.
export function salasDoContainer(local) {
  if (!local) return [];
  if (Array.isArray(local.andares)) return local.andares.flatMap((a) => a.salas || []);
  if (Array.isArray(local.salas)) return local.salas;
  return [];
}
// Alguma sala do container tem evento ATIVO AGORA? (propaga a cor pro marcador-pai)
export function eventoAtivoNoContainer(local, agora = agoraReal()) {
  return salasDoContainer(local).some((s) => s.evento && eventoAtivoAgora(s.evento, agora));
}

// ── Próximas ocorrências (horizonte configurável; ciente da janela) ─────────────
// Data da próxima ocorrência a partir de agora (null se nenhuma no horizonte). Se
// HOJE a janela já terminou, pula pra próxima — não conta um evento já encerrado.
export function proximaOcorrenciaData(ev, horizonte = 60) {
  const base = agoraReal();
  const baseDia = new Date(base); baseDia.setHours(0, 0, 0, 0);
  for (let i = 0; i <= horizonte; i++) {
    const d = new Date(baseDia); d.setDate(baseDia.getDate() + i);
    if (!ocorreNaData(ev, d)) continue;
    if (i === 0) {
      const j = janelaDoEvento(ev, base);
      if (j && minutosAgora(base) >= j[1]) continue;   // já encerrou hoje
    }
    return d;
  }
  return null;
}

// Eventos com ao menos uma ocorrência futura dentro do horizonte (dias). Substitui
// o antigo "próximos 7 dias" — pega também mensais/futuros.
export function eventosProximosDias(eventos, horizonte = 31) {
  return (eventos || []).filter((ev) => proximaOcorrenciaData(ev, horizonte) != null);
}

const NOMES_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
// Rótulo: Hoje / Amanhã / dia da semana (<7d) / "Seg 06/07" (além disso).
export function proximaOcorrencia(ev) {
  const d = proximaOcorrenciaData(ev);
  if (!d) return "";
  const base = agoraReal(); base.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - base.getTime()) / 86400000);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  if (diff < 7) return NOMES_DIA[d.getDay()];
  return `${NOMES_DIA[d.getDay()].slice(0, 3)} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
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
