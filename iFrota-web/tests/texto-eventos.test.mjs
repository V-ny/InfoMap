// Testes de utilidades da UI (npm test):
//   - texto.js: escape de HTML, nome de ícone seguro, normalização da busca
//   - eventos.js: escolha do evento quando há mais de um no mesmo local
import { esc, icone, normalizar } from "../js/texto.js";
import { indexarPorLocal } from "../js/eventos.js";

let fail = 0;
function assert(cond, msg) {
  if (cond) console.log("  ok -", msg);
  else { console.error("  FALHOU -", msg); fail++; }
}

console.log("texto:");
assert(esc(`<img src=x onerror="a()">&'`) === "&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;", "esc neutraliza marcação e aspas");
assert(esc(null) === "" && esc(42) === "42", "esc aceita null e números");
assert(icone('star" onclick="x') === "staronclickx", "icone remove o que sairia do atributo");
assert(icone("") === "map-marker" && icone(undefined, "star") === "star", "icone vazio cai no padrão");
assert(normalizar("  Prédio   da GRADUAÇÃO ") === "predio da graduacao", "normalizar tira acento, caixa e espaços extras");
assert(normalizar("Refeitório").includes(normalizar("refeitorio")), "busca sem acento encontra nome acentuado");

console.log("indexarPorLocal:");
const ymd = (diasAFrente) => {
  const d = new Date(); d.setDate(d.getDate() + diasAFrente);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const TODOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const futuro = { nome: "Futuro", local: "Ginásio", data: ymd(10) };
const agora = { nome: "Agora", local: "Ginásio", dias: TODOS };   // sem janela → ativo o dia todo
const cedo = { nome: "Em 3 dias", local: "Biblioteca", data: ymd(3) };
const tarde = { nome: "Em 10 dias", local: "Biblioteca", data: ymd(10) };
const idx = indexarPorLocal([futuro, agora, tarde, cedo, { nome: "Sem local", dias: TODOS }]);
assert(idx.get("Ginásio") === agora, "evento ativo agora vence, mesmo vindo depois na lista");
assert(idx.get("Biblioteca") === cedo, "sem ativo, vence a próxima ocorrência mais cedo");
assert(idx.size === 2, "eventos sem `local` não entram no índice");

console.log(fail ? `\n${fail} asserção(ões) FALHARAM` : "\nTodos os testes passaram.");
process.exit(fail ? 1 : 0);
