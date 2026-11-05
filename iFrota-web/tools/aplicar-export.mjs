// Aplica um backup exportado pelo admin nos dados publicados do app.
//
//   npm run aplicar-export -- caminho/ifrota-dados.json          (grava)
//   npm run aplicar-export -- caminho/ifrota-dados.json --previa  (só mostra)
//
// Depois: conferir o diff, commitar e dar push — o GitHub Pages republica e os
// estudantes recebem a atualização. No aparelho do admin, use "Limpar dados
// criados localmente" para não ver os itens duplicados (local + publicado).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mesclarExport } from "./mesclar-export.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAIS = join(RAIZ, "data", "locais.json");
const EVENTOS = join(RAIZ, "data", "eventos.json");

const args = process.argv.slice(2);
const previa = args.includes("--previa");
const arquivo = args.find((a) => !a.startsWith("--"));
if (!arquivo) {
  console.error("Uso: npm run aplicar-export -- <ifrota-dados.json> [--previa]");
  process.exit(1);
}

const ler = (f) => JSON.parse(readFileSync(f, "utf8"));
const { locais, eventos, resumo } = mesclarExport(ler(LOCAIS), ler(EVENTOS), ler(arquivo));

const linha = (rotulo, lista) => { if (lista.length) console.log(`  ${rotulo}: ${lista.join(", ")}`); };
console.log(previa ? "Prévia (nada foi gravado):" : "Aplicado:");
linha("locais novos", resumo.locaisNovos);
linha("locais atualizados", resumo.locaisAtualizados);
linha("eventos novos", resumo.eventosNovos);
linha("eventos atualizados", resumo.eventosAtualizados);
linha("eventos removidos", resumo.eventosRemovidos);
linha("cardápios", resumo.cardapios);
resumo.avisos.forEach((a) => console.warn(`  aviso: ${a}`));

if (!previa) {
  // Mesma formatação dos arquivos atuais (locais: 4 espaços; eventos: 2) para
  // o diff mostrar só o que mudou.
  writeFileSync(LOCAIS, JSON.stringify(locais, null, 4));
  writeFileSync(EVENTOS, JSON.stringify(eventos, null, 2) + "\n");
  console.log("\nPróximo passo: git diff iFrota-web/data, depois commit + push.");
}
