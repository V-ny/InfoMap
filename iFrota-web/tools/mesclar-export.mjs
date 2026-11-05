// Mescla um backup exportado pelo admin ("Exportar dados (JSON)" no app) nos
// dados publicados (data/locais.json e data/eventos.json). Função pura: recebe
// os arrays e devolve os novos, sem tocar em disco — o CLI é aplicar-export.mjs.
//
// Mesmas regras que o app aplica em runtime (admin-store.js), agora gravadas:
//   - locais:      upsert por nome (o do admin prevalece sobre o publicado)
//   - eventos:     upsert por nome
//   - desativados: removidos do eventos.json
//   - cardapios:   gravados em locais[nome].cardapio

// Campos que só existem em runtime ou no armazenamento local — não vão pro JSON.
const CAMPOS_RUNTIME_LOCAL = ["custom", "cor_hex", "isEvento", "evento", "_temp"];
const CAMPOS_RUNTIME_EVENTO = ["id", "custom", "_quando", "_sala"];

function sem(obj, campos) {
  const out = { ...obj };
  for (const c of campos) delete out[c];
  return out;
}

function upsertPorNome(lista, novo) {
  const i = lista.findIndex((x) => x.nome === novo.nome);
  if (i >= 0) lista[i] = novo;
  else lista.push(novo);
  return i >= 0 ? "atualizado" : "novo";
}

export function mesclarExport(locais, eventos, exp) {
  if (!exp || typeof exp !== "object" || exp._app !== "ifrota") {
    throw new Error('Arquivo não é um export do IF-rota (falta "_app": "ifrota")');
  }
  const outLocais = locais.map((l) => ({ ...l }));
  let outEventos = eventos.map((e) => ({ ...e }));
  const resumo = { locaisNovos: [], locaisAtualizados: [], eventosNovos: [], eventosAtualizados: [], eventosRemovidos: [], cardapios: [], avisos: [] };

  for (const l of exp.locais || []) {
    if (!l || !l.nome || !Array.isArray(l.coords)) {
      resumo.avisos.push(`local ignorado (sem nome ou coords): ${JSON.stringify(l).slice(0, 60)}`);
      continue;
    }
    const r = upsertPorNome(outLocais, sem(l, CAMPOS_RUNTIME_LOCAL));
    (r === "novo" ? resumo.locaisNovos : resumo.locaisAtualizados).push(l.nome);
  }

  const desativados = new Set(exp.desativados || []);
  const antes = outEventos.length;
  outEventos = outEventos.filter((e) => {
    if (!desativados.has(e.nome)) return true;
    resumo.eventosRemovidos.push(e.nome);
    return false;
  });
  if (desativados.size && outEventos.length === antes) {
    resumo.avisos.push(`desativados sem correspondência no eventos.json: ${[...desativados].join(", ")}`);
  }

  for (const ev of exp.eventos || []) {
    if (!ev || !ev.nome) { resumo.avisos.push("evento sem nome ignorado"); continue; }
    if (ev.local && !outLocais.some((l) => l.nome === ev.local)) {
      resumo.avisos.push(`evento "${ev.nome}": local "${ev.local}" não existe no locais.json`);
    }
    const r = upsertPorNome(outEventos, sem(ev, CAMPOS_RUNTIME_EVENTO));
    (r === "novo" ? resumo.eventosNovos : resumo.eventosAtualizados).push(ev.nome);
  }

  for (const [nome, cardapio] of Object.entries(exp.cardapios || {})) {
    const l = outLocais.find((x) => x.nome === nome);
    if (!l) { resumo.avisos.push(`cardápio de "${nome}" ignorado: local não existe`); continue; }
    l.cardapio = cardapio;
    resumo.cardapios.push(nome);
  }

  return { locais: outLocais, eventos: outEventos, resumo };
}
