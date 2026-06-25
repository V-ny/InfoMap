// Backend LOCAL de fotos — simula uma implementação web client-side:
//  - Usuário registrado (cadastro/login) persistido em localStorage.
//  - Fotos salvas no IndexedDB do dispositivo (redimensionadas), por waypoint.
// Mesma "interface" do firebase.js, então a UI não muda. Troque o import na ui.js
// pra firebase.js quando quiser o modo nuvem (ver docs/IMPLEMENTACAO-FUTURA-FIREBASE.md).

// ── AUTH LOCAL ────────────────────────────────────────────────────────────────
const UKEY = "ifrota:usuarios";   // [{ email, senha }]
const SKEY = "ifrota:sessao";     // email logado
const _subs = [];
let _user = null;   // definido após _getUsuarios estar disponível (ver restoreSessao)

function _getUsuarios() {
  try { return JSON.parse(localStorage.getItem(UKEY) || "[]"); } catch { return []; }
}
function _setUsuarios(arr) { localStorage.setItem(UKEY, JSON.stringify(arr)); }
// "hash" simples — só ofusca (é simulação local, não produção).
function _hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Garante a conta admin padrão (admin@ifrota.com / 1234) na primeira execução.
(function seedAdmin() {
  const us = _getUsuarios();
  if (!us.some((u) => u.email === "admin@ifrota.com")) {
    us.push({ email: "admin@ifrota.com", senha: _hash("1234"), admin: true });
    _setUsuarios(us);
  }
})();

// Restaura a sessão persistida (depois que usuários/seed existem).
(function restoreSessao() {
  const e = localStorage.getItem(SKEY);
  if (!e) return;
  const u = _getUsuarios().find((x) => x.email === e);
  _user = u ? { email: u.email, admin: !!u.admin } : { email: e };
})();

// É admin? (a conta padrão tem admin:true; libera gestão de pontos/eventos)
export function ehAdmin() { return !!(_user && _user.admin); }
function _emit() { _subs.forEach((cb) => { try { cb(_user); } catch { /* ignore */ } }); }

export function fotosAtivo() { return true; }   // backend local sempre disponível
export function usuarioAtual() { return _user; }
export function onAuth(cb) { _subs.push(cb); queueMicrotask(() => cb(_user)); }

export async function registrar(email, senha) {
  email = (email || "").trim().toLowerCase();
  if (!email || !senha) throw new Error("Preencha e-mail e senha");
  if (senha.length < 4) throw new Error("Senha muito curta (mín. 4)");
  const us = _getUsuarios();
  if (us.some((u) => u.email === email)) throw new Error("E-mail já cadastrado");
  us.push({ email, senha: _hash(senha) });
  _setUsuarios(us);
  localStorage.setItem(SKEY, email);
  _user = { email, admin: false };
  _emit();
  return _user;
}

export async function login(email, senha) {
  email = (email || "").trim().toLowerCase();
  const u = _getUsuarios().find((x) => x.email === email);
  if (!u || u.senha !== _hash(senha)) throw new Error("E-mail ou senha inválidos");
  localStorage.setItem(SKEY, email);
  _user = { email: u.email, admin: !!u.admin };
  _emit();
  return _user;
}

export async function logout() {
  localStorage.removeItem(SKEY);
  _user = null;
  _emit();
}

// ── INDEXEDDB (fotos) ─────────────────────────────────────────────────────────
const DB_NAME = "ifrota-fotos";
const STORE = "fotos";
let _dbPromise = null;

function _db() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        os.createIndex("local", "local", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function _tx(mode, fn) {
  return _db().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let out;
    Promise.resolve(fn(store)).then((v) => { out = v; });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

// Redimensiona/comprime a imagem antes de salvar (como faria um upload web).
function _resize(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width >= height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL("image/jpeg", quality)); }
      catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagem inválida")); };
    img.src = url;
  });
}

// Lista as fotos de um waypoint (ordenadas por data). [{ id, url, criadoEm, autor }]
export async function listarFotos(localNome) {
  if (!localNome) return [];
  const todas = await _tx("readonly", (store) => new Promise((resolve, reject) => {
    const idx = store.index("local");
    const req = idx.getAll(localNome);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
  todas.sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
  return todas.map((f) => ({ id: f.id, url: f.dataUrl, criadoEm: f.criadoEm, autor: f.autor }));
}

// Salva uma foto pro waypoint (requer login). Redimensiona e grava no IndexedDB.
export async function enviarFoto(localNome, file) {
  if (!_user) throw new Error("Faça login para enviar fotos");
  if (!localNome) throw new Error("Local inválido");
  const dataUrl = await _resize(file);
  const reg = { local: localNome, dataUrl, criadoEm: Date.now(), autor: _user.email };
  const id = await _tx("readwrite", (store) => new Promise((resolve, reject) => {
    const req = store.add(reg);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  return { id, url: dataUrl };
}

// Remove uma foto (requer login).
export async function removerFoto(foto) {
  if (!_user) throw new Error("Sem permissão");
  if (!foto || foto.id == null) return;
  await _tx("readwrite", (store) => new Promise((resolve, reject) => {
    const req = store.delete(foto.id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}
