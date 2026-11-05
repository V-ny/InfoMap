// Modos de uso do app. O padrão é o PÚBLICO (estudantes): sem área de conta nem
// gestão — o que o admin edita fica só no aparelho dele até ser publicado (ver
// README → "Atualizar o conteúdo"), então mostrar a gestão a todos só confunde.
//   - Modo admin: ?admin=1 liga e fica salvo NESTE aparelho; ?admin=0 desliga.
//     No APK (sem barra de endereço): 7 toques no título "IF-rota".
//   - Modo demo: ?demo=1 carrega data/eventos.demo.json (apresentações do TCC).
const K_ADMIN = "ifrota:modo-admin";
const params = new URLSearchParams(location.search);

function lerModoAdmin() {
  try {
    if (params.get("admin") === "1") localStorage.setItem(K_ADMIN, "1");
    else if (params.get("admin") === "0") localStorage.removeItem(K_ADMIN);
    return localStorage.getItem(K_ADMIN) === "1";
  } catch {
    return params.get("admin") === "1";
  }
}

export const MODO_ADMIN = lerModoAdmin();
export const MODO_DEMO = params.get("demo") === "1";

// Liga/desliga o modo admin neste aparelho. Retorna o novo estado; quem chama
// recarrega a página (a UI é montada uma vez, no bootstrap).
export function alternarModoAdmin() {
  const novo = !MODO_ADMIN;
  try {
    if (novo) localStorage.setItem(K_ADMIN, "1");
    else localStorage.removeItem(K_ADMIN);
  } catch { /* sem localStorage: segue sem persistir */ }
  return novo;
}
