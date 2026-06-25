// Integração Firebase — Auth (login admin), Firestore (metadados das fotos) e
// Storage (arquivos). Carregamento LAZY via CDN ESM e tolerante a falhas: se não
// houver config ou estiver offline, tudo degrada e o app segue funcionando.
import { FIREBASE_CONFIG, firebaseConfigurado } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.0";

let _ready = null;     // Promise<api|null>
let _api = null;       // { auth, db, storage, fns... }
let _user = null;      // usuário logado (ou null)
const _authSubs = [];  // callbacks de mudança de auth

// Inicializa o Firebase uma única vez. Retorna a API ou null (não configurado/falha).
export function initFirebase() {
  if (_ready) return _ready;
  if (!firebaseConfigurado()) { _ready = Promise.resolve(null); return _ready; }
  _ready = (async () => {
    try {
      const [{ initializeApp }, authMod, fsMod, stMod] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-firestore.js`),
        import(`${SDK}/firebase-storage.js`),
      ]);
      const app = initializeApp(FIREBASE_CONFIG);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      const storage = stMod.getStorage(app);
      _api = { app, auth, db, storage, authMod, fsMod, stMod };
      authMod.onAuthStateChanged(auth, (u) => {
        _user = u;
        _authSubs.forEach((cb) => { try { cb(u); } catch { /* ignore */ } });
      });
      console.log("[IFrota] Firebase pronto");
      return _api;
    } catch (e) {
      console.warn("[IFrota] Firebase indisponível:", e);
      _api = null;
      return null;
    }
  })();
  return _ready;
}

export function firebaseAtivo() { return firebaseConfigurado(); }
export function usuarioAtual() { return _user; }
export function onAuth(cb) {
  _authSubs.push(cb);
  // estado atual de forma ASSÍNCRONA — evita rodar durante o init do chamador
  // (quando variáveis com `let` ainda estão na TDZ).
  queueMicrotask(() => cb(_user));
}

// ── AUTH ───────────────────────────────────────────────────────────────────────
export async function login(email, senha) {
  const api = await initFirebase();
  if (!api) throw new Error("Firebase não configurado");
  const cred = await api.authMod.signInWithEmailAndPassword(api.auth, email, senha);
  return cred.user;
}
export async function logout() {
  const api = await initFirebase();
  if (api) await api.authMod.signOut(api.auth);
}

// ── FOTOS (Firestore + Storage) ─────────────────────────────────────────────────
function _slug(s) {
  return (s || "local").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "local";
}

// Lista as fotos (URLs) de um waypoint, ordenadas por data. [] se indisponível.
export async function listarFotos(localNome) {
  const api = await initFirebase();
  if (!api) return [];
  try {
    const { collection, query, where, orderBy, getDocs } = api.fsMod;
    const q = query(
      collection(api.db, "fotos"),
      where("local", "==", localNome),
      orderBy("criadoEm", "asc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("[IFrota] listarFotos falhou:", e);
    return [];
  }
}

// Faz upload de um arquivo pro waypoint e registra os metadados. Requer login.
export async function enviarFoto(localNome, file) {
  const api = await initFirebase();
  if (!api) throw new Error("Firebase não configurado");
  if (!_user) throw new Error("Faça login de admin para enviar fotos");
  const { ref, uploadBytes, getDownloadURL } = api.stMod;
  const { collection, addDoc, serverTimestamp } = api.fsMod;
  const path = `fotos/${_slug(localNome)}/${Date.now()}_${_slug(file.name)}`;
  const sref = ref(api.storage, path);
  await uploadBytes(sref, file, { contentType: file.type || "image/jpeg" });
  const url = await getDownloadURL(sref);
  const docRef = await addDoc(collection(api.db, "fotos"), {
    local: localNome, url, path,
    autorEmail: _user.email || "",
    criadoEm: serverTimestamp(),
  });
  return { id: docRef.id, url, path };
}

// Remove uma foto (doc + arquivo). Requer login.
export async function removerFoto(foto) {
  const api = await initFirebase();
  if (!api || !_user) throw new Error("Sem permissão");
  const { doc, deleteDoc } = api.fsMod;
  const { ref, deleteObject } = api.stMod;
  if (foto.path) { try { await deleteObject(ref(api.storage, foto.path)); } catch { /* já removido */ } }
  await deleteDoc(doc(api.db, "fotos", foto.id));
}
