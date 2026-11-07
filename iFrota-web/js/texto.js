// Utilidades de texto para a UI: escape de HTML (os dados vêm do repositório,
// do import do admin e de formulários — nada disso pode virar marcação) e
// normalização para busca sem acento ("predio" acha "Prédio").

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

// Nome de ícone FontAwesome vindo dos dados → só [a-z0-9-] (vai em atributo).
export function icone(nome, padrao = "map-marker") {
  const n = String(nome || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return n || padrao;
}

// Minúsculas, sem acentos e com espaços colapsados.
export function normalizar(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}
