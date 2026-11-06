// Atualização de conteúdo sem reinstalar o APK. No app nativo, locais.json e
// eventos.json são buscados de DADOS_REMOTOS (o repositório no GitHub) a cada
// abertura; a última cópia válida fica salva no aparelho para uso offline.
// Ordem de preferência: remoto (se respondeu) → cópia salva → o que veio no APK.
import { DADOS_REMOTOS } from "./config.js";

const CHAVE = "ifrota:dados-remotos";
const TIMEOUT_MS = 8000;

// Ativo no APK (Capacitor) ou com ?remoto=1 no navegador. Em dev, servindo a
// pasta local, fica desligado: senão o GitHub sobrescreveria as edições locais.
export function remotoAtivo() {
  if (!DADOS_REMOTOS) return false;
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("remoto")) return true;
  return !!window.Capacitor?.isNativePlatform?.();
}

// Só aceita o que o app consegue exibir: um arquivo quebrado no repositório não
// pode derrubar o app de todo mundo.
export function dadosValidos(locais, eventos) {
  return Array.isArray(locais) && locais.length > 0 &&
    locais.every((l) => l && typeof l.nome === "string" &&
      Array.isArray(l.coords) && l.coords.length === 2 && l.coords.every(Number.isFinite)) &&
    Array.isArray(eventos) && eventos.every((e) => e && typeof e.nome === "string");
}

// Cópia salva — ignorada se for mais antiga que o build do app instalado (um
// APK novo traz dados pelo menos tão novos quanto ela).
export function dadosSalvos(buildGerado = 0) {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE));
    if (!s || s.salvoEm < buildGerado || !dadosValidos(s.locais, s.eventos)) return null;
    return s;
  } catch { return null; }
}

async function baixar(arquivo, signal) {
  const r = await fetch(DADOS_REMOTOS + arquivo, { cache: "no-cache", signal });
  if (!r.ok) throw new Error(`${arquivo}: HTTP ${r.status}`);
  return r.json();
}

// Baixa os dois arquivos; devolve {locais, eventos} válidos (e já salvos) ou
// null se offline/timeout/inválido.
export async function buscarDadosRemotos() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const [locais, eventos] = await Promise.all([
      baixar("locais.json", ctrl.signal),
      baixar("eventos.json", ctrl.signal),
    ]);
    if (!dadosValidos(locais, eventos)) {
      console.warn("[IFrota] dados remotos inválidos — mantendo os atuais");
      return null;
    }
    try { localStorage.setItem(CHAVE, JSON.stringify({ salvoEm: Date.now(), locais, eventos })); } catch { /* cheio */ }
    return { locais, eventos };
  } catch (e) {
    console.warn("[IFrota] sem dados remotos:", e.message || e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Informações do build (versão + data), gravadas pelo build-www.mjs. Em dev o
// arquivo não existe → null.
export async function carregarBuild() {
  try {
    const r = await fetch("./build.json", { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
