// Feedback sonoro SUTIL via Web Audio API — tons curtos e baixos, sintetizados na
// hora (sem arquivos de áudio). Nada estridente: ondas seno, volume baixo, decay
// suave. Pode ser desligado (persistido em localStorage "ifrota:sons").
const KEY = "ifrota:sons";
let _ctx = null;

function ctx() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { _ctx = new AC(); } catch { _ctx = null; }
  return _ctx;
}

export function sonsAtivos() { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } }
export function setSons(on) { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ } }

// Uma nota suave (seno) com envelope rápido p/ não "clicar".
function nota(c, freq, t0, dur, vol) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);          // ataque curto
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);    // decay suave
  osc.connect(g); g.connect(c.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}

// seq: [[freq, atrasoMs, durMs, vol], ...]
function tocar(seq) {
  if (!sonsAtivos()) return;
  const c = ctx(); if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});   // libera após 1º gesto
  const now = c.currentTime + 0.005;
  for (const [f, atr, dur, vol] of seq) nota(c, f, now + atr / 1000, dur / 1000, vol);
}

// ── Os 3 sons (todos baixos e breves) ──────────────────────────────────────────
export function somPonto()       { tocar([[660, 0, 90, 0.05]]); }                          // clique num ponto: toque simples
export function somRota()        { tocar([[523, 0, 110, 0.06], [784, 75, 150, 0.06]]); }   // criar rota: duas notas subindo
export function somNotificacao() { tocar([[880, 0, 130, 0.06], [1175, 110, 190, 0.05]]); } // notificação: "ding" gentil
