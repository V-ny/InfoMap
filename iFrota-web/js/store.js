// Persistência leve via localStorage. Sprint 3 migra favoritos/config pra IndexedDB.
const K = {
  dark: "ifrota:dark",
  fav: "ifrota:favoritos",
  pos: "ifrota:last_pos",
};

export const store = {
  getDark()      { return localStorage.getItem(K.dark) === "1"; },
  setDark(v)     { localStorage.setItem(K.dark, v ? "1" : "0"); },

  getFavoritos() {
    try { return JSON.parse(localStorage.getItem(K.fav) || "[]"); }
    catch { return []; }
  },
  setFavoritos(arr) { localStorage.setItem(K.fav, JSON.stringify(arr)); },
  toggleFavorito(nome) {
    const arr = this.getFavoritos();
    const i = arr.indexOf(nome);
    if (i >= 0) arr.splice(i, 1); else arr.push(nome);
    this.setFavoritos(arr);
    return i < 0;  // true = agora é favorito
  },
  isFavorito(nome) { return this.getFavoritos().includes(nome); },

  getLastPos() {
    try { return JSON.parse(localStorage.getItem(K.pos) || "null"); }
    catch { return null; }
  },
  setLastPos(latlon) { localStorage.setItem(K.pos, JSON.stringify(latlon)); },
};
