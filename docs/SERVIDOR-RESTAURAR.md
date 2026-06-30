# IFrota — Backend próprio (fotos + contas) — ARQUIVADO p/ restaurar

> **Status:** REVERTIDO em 28/06/2026. O app voltou ao backend **LOCAL**
> (`iFrota-web/js/fotos-store.js` — IndexedDB + login local). Este arquivo guarda
> TUDO que foi implementado para o seu **PC virar servidor de fotos+contas**
> (acesso de longe via ngrok/Cloudflare), caso queira restaurar no futuro.
>
> Para restaurar: recrie os 2 arquivos abaixo e re-aplique as 4 edições no app.
> Tudo é Node puro (zero dependências) — não precisa `npm install`.

## Visão geral do que isso fazia

- Seu PC roda uma **API** (Node puro) que guarda **contas** (`data/users.json`,
  senha com `scrypt`+salt) e **fotos** (`data/fotos.json` + `uploads/<id>.jpg`).
- O app continua hospedado à parte (GitHub Pages / APK); **só** login/cadastro/fotos
  batem no servidor. Mapa/rotas seguem locais.
- Acesso de longe (fora da rede) por **túnel** → URL pública HTTPS:
  - **ngrok** com domínio fixo grátis (escolha): `ngrok http --domain=seunome.ngrok-free.app 3000`
  - ou Cloudflare: `cloudflared tunnel --url http://localhost:3000` (URL muda a cada start).
- O app aponta pro servidor por um **campo "Servidor"** no menu lateral (cola a URL,
  salva no aparelho) — funciona no APK sem precisar de `?api=`. Também aceita
  `?api=<URL>` na barra de endereço (web).
- **Gotcha ngrok:** as chamadas mandam o header `ngrok-skip-browser-warning: true`
  (senão o ngrok free devolve uma página HTML de aviso no lugar do JSON). Por isso o
  servidor **precisa** listar esse header em `Access-Control-Allow-Headers` (senão o
  preflight CORS bloqueia login/upload/teste).
- **GPS:** geolocalização exige contexto seguro (HTTPS/localhost). App público HTTPS
  + API via túnel HTTPS = ok. No APK o webview é seguro (GPS ok).

---

## PASSO 1 — recriar `server/server.js`

```js
// IFrota — servidor BÁSICO de fotos + contas (backend do app), para o PC do TCC.
// Node puro (módulos nativos http/fs/crypto) — ZERO dependências, sem npm install.
// Guarda tudo em arquivos: data/users.json, data/fotos.json e uploads/*.jpg.
// API-only com CORS (o app continua hospedado à parte; só as chamadas de
// fotos/contas batem aqui). Exponha de longe:
//   node server/server.js
//   ngrok http --domain=seunome.ngrok-free.app 3000   (ou cloudflared)
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const UP = path.join(ROOT, "uploads");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UP, { recursive: true });
const USERS_F = path.join(DATA, "users.json");
const FOTOS_F = path.join(DATA, "fotos.json");

function loadJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } }
function saveJSON(f, v) { fs.writeFileSync(f, JSON.stringify(v, null, 2)); }

// ── Auth helpers ────────────────────────────────────────────────────────────
function hashSenha(senha, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(senha), salt, 32).toString("hex");
  return salt + ":" + h;
}
function checkSenha(senha, stored) {
  const [salt, h] = String(stored).split(":");
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(String(senha), salt, 32).toString("hex");
  const a = Buffer.from(h, "hex"), b = Buffer.from(calc, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function makeUser(email, senha, admin) {
  return { email: String(email).toLowerCase(), senha: hashSenha(senha), admin: !!admin };
}
function pub(u) { return u ? { email: u.email, admin: !!u.admin } : null; }

// ── Estado (persistido em disco) ────────────────────────────────────────────
let users = loadJSON(USERS_F, null);
if (!users) {
  users = [makeUser("admin@ifrota.com", "1234", true)];   // conta admin padrão
  saveJSON(USERS_F, users);
  console.log("[IFrota API] seed admin@ifrota.com / 1234 criado");
}
let fotos = loadJSON(FOTOS_F, []);
const tokens = new Map();   // token -> email (em memória; reiniciar o servidor desloga)

function novoToken(email) {
  const t = crypto.randomBytes(24).toString("hex");
  tokens.set(t, String(email).toLowerCase());
  return t;
}
function userFromAuth(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers["authorization"] || "");
  if (!m) return null;
  const email = tokens.get(m[1]);
  return email ? users.find((u) => u.email === email) || null : null;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, ngrok-skip-browser-warning");
}
function send(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > 12 * 1024 * 1024) { req.destroy(); reject(new Error("Imagem grande demais")); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

// ── Servidor ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }

  // imagens enviadas (estáticas)
  if (req.method === "GET" && p.startsWith("/uploads/")) {
    const file = path.join(UP, path.basename(p));
    return fs.readFile(file, (e, data) => {
      if (e) { cors(res); res.writeHead(404); return res.end("not found"); }
      cors(res);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
      res.end(data);
    });
  }

  try {
    if (p === "/api/register" && req.method === "POST") {
      const b = await readBody(req);
      const email = String(b.email || "").trim().toLowerCase();
      const senha = String(b.senha || "");
      if (!email || !senha) return send(res, 400, { erro: "Preencha e-mail e senha" });
      if (senha.length < 4) return send(res, 400, { erro: "Senha muito curta (mín. 4)" });
      if (users.some((x) => x.email === email)) return send(res, 409, { erro: "E-mail já cadastrado" });
      const nu = makeUser(email, senha, false);
      users.push(nu); saveJSON(USERS_F, users);
      return send(res, 200, { token: novoToken(email), user: pub(nu) });
    }

    if (p === "/api/login" && req.method === "POST") {
      const b = await readBody(req);
      const email = String(b.email || "").trim().toLowerCase();
      const us = users.find((x) => x.email === email);
      if (!us || !checkSenha(String(b.senha || ""), us.senha)) {
        return send(res, 401, { erro: "E-mail ou senha inválidos" });
      }
      return send(res, 200, { token: novoToken(email), user: pub(us) });
    }

    if (p === "/api/me" && req.method === "GET") {
      return send(res, 200, { user: pub(userFromAuth(req)) });
    }

    if (p === "/api/logout" && req.method === "POST") {
      const m = /^Bearer\s+(.+)$/.exec(req.headers["authorization"] || "");
      if (m) tokens.delete(m[1]);
      return send(res, 200, { ok: true });
    }

    if (p === "/api/fotos" && req.method === "GET") {
      const localNome = u.searchParams.get("local") || "";
      const lst = fotos
        .filter((f) => f.local === localNome)
        .sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0))
        .map((f) => ({ id: f.id, url: "/uploads/" + f.arquivo, criadoEm: f.criadoEm, autor: f.autor }));
      return send(res, 200, { fotos: lst });
    }

    if (p === "/api/fotos" && req.method === "POST") {
      const us = userFromAuth(req);
      if (!us) return send(res, 401, { erro: "Faça login para enviar fotos" });
      const b = await readBody(req);
      const localNome = String(b.local || "");
      const m = /^data:image\/\w+;base64,(.+)$/s.exec(String(b.dataUrl || ""));
      if (!localNome || !m) return send(res, 400, { erro: "Dados inválidos" });
      const id = crypto.randomBytes(8).toString("hex");
      const arquivo = id + ".jpg";
      fs.writeFileSync(path.join(UP, arquivo), Buffer.from(m[1], "base64"));
      const reg = { id, local: localNome, arquivo, criadoEm: Date.now(), autor: us.email };
      fotos.push(reg); saveJSON(FOTOS_F, fotos);
      return send(res, 200, { id, url: "/uploads/" + arquivo });
    }

    if (p.startsWith("/api/fotos/") && req.method === "DELETE") {
      const us = userFromAuth(req);
      if (!us) return send(res, 401, { erro: "Sem permissão" });
      const id = decodeURIComponent(p.slice("/api/fotos/".length));
      const i = fotos.findIndex((f) => String(f.id) === id);
      if (i >= 0) {
        const [rm] = fotos.splice(i, 1); saveJSON(FOTOS_F, fotos);
        try { fs.unlinkSync(path.join(UP, rm.arquivo)); } catch { /* já não existe */ }
      }
      return send(res, 200, { ok: true });
    }

    // status simples
    if (p === "/" || p === "/api") {
      return send(res, 200, { ok: true, app: "IFrota API", usuarios: users.length, fotos: fotos.length });
    }
    return send(res, 404, { erro: "Rota não encontrada" });
  } catch (e) {
    return send(res, 500, { erro: e.message || "Erro interno" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[IFrota API] no ar em http://localhost:${PORT}  (rede: 0.0.0.0:${PORT})`);
  console.log("[IFrota API] exponha de longe:  ngrok http --domain=seunome.ngrok-free.app " + PORT);
});
```

Crie também `server/.gitignore`:

```
# dados gerados em runtime (contas, fotos) — não versionar
data/
uploads/
node_modules/
```

Rodar: `node server/server.js` → `http://localhost:3000`. Admin padrão **admin@ifrota.com / 1234**.

---

## PASSO 2 — recriar `iFrota-web/js/server-store.js`

```js
// Backend de fotos + contas via SERVIDOR (o PC de casa, exposto por túnel).
// Mesma interface do fotos-store.js, então a ui.js não muda.
//
// Configurar a URL: campo "Servidor" no menu, ou ?api=https://SEU-TUNEL na barra
// (persiste em localStorage["ifrota:api"]). Vazio → volta ao modo LOCAL.
//
// Sem API configurada → DELEGA pro backend local (js/fotos-store.js). Assim o app
// funciona offline e em desenvolvimento sem precisar do servidor no ar.
import * as local from "./fotos-store.js";

function resolveApiBase() {
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (q !== null) {
      const v = q.trim().replace(/\/+$/, "");
      if (v) localStorage.setItem("ifrota:api", v); else localStorage.removeItem("ifrota:api");
    }
  } catch { /* sem location (testes) */ }
  try { return (localStorage.getItem("ifrota:api") || "").replace(/\/+$/, ""); } catch { return ""; }
}
const API = resolveApiBase();
export function modoServidor() { return !!API; }

// URL atual salva (p/ pré-preencher o campo "Servidor" no menu).
export function urlServidor() { try { return localStorage.getItem("ifrota:api") || ""; } catch { return ""; } }
// Define/limpa o servidor (o app deve recarregar depois — API é lido no load).
// Vazio → volta ao modo LOCAL. Troca de servidor desloga (limpa o token).
export function definirServidor(url) {
  const v = String(url || "").trim().replace(/\/+$/, "");
  try {
    if (v) localStorage.setItem("ifrota:api", v); else localStorage.removeItem("ifrota:api");
    localStorage.removeItem("ifrota:token");
  } catch { /* ignore */ }
  return v;
}
// Ping no /api da URL informada (ou da atual) — true se respondeu como IFrota API.
export async function testarServidor(url) {
  const base = String(url || API).trim().replace(/\/+$/, "");
  if (!base) return false;
  try {
    const r = await fetch(base + "/api", { headers: { "ngrok-skip-browser-warning": "true" } });
    if (!r.ok) return false;
    const d = await r.json().catch(() => ({}));
    return !!d.ok;
  } catch { return false; }
}

// ── Estado de auth (modo servidor) ──────────────────────────────────────────
const TKEY = "ifrota:token";
const _subs = [];
let _user = null;
function _emit() { _subs.forEach((cb) => { try { cb(_user); } catch { /* ignore */ } }); }
function _token() { try { return localStorage.getItem(TKEY) || ""; } catch { return ""; } }

async function api(pathName, { method = "GET", body, auth = false } = {}) {
  // "ngrok-skip-browser-warning" evita a página de aviso do ngrok free (que
  // devolveria HTML no lugar do JSON da API).
  const headers = { "ngrok-skip-browser-warning": "true" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && _token()) headers["Authorization"] = "Bearer " + _token();
  let r;
  try {
    r = await fetch(API + pathName, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Servidor indisponível — verifique a conexão");
  }
  const txt = await r.text();
  let data = {}; try { data = txt ? JSON.parse(txt) : {}; } catch { /* resposta não-JSON */ }
  if (!r.ok) throw new Error(data.erro || `Erro ${r.status}`);
  return data;
}
const absoluta = (url) => (url && url.startsWith("http") ? url : API + url);

// Restaura a sessão (modo servidor): valida o token guardado.
if (API && _token()) {
  api("/api/me", { auth: true })
    .then((d) => { _user = d.user || null; if (!_user) { try { localStorage.removeItem(TKEY); } catch {} } _emit(); })
    .catch(() => { /* offline: mantém deslogado, sem quebrar */ });
}

// ── Interface pública (idêntica ao fotos-store.js) ──────────────────────────
export function fotosAtivo() { return true; }
export function usuarioAtual() { return API ? _user : local.usuarioAtual(); }
export function ehAdmin() { return API ? !!(_user && _user.admin) : local.ehAdmin(); }
export function onAuth(cb) {
  if (!API) return local.onAuth(cb);
  _subs.push(cb);
  queueMicrotask(() => cb(_user));
}

export async function registrar(email, senha) {
  if (!API) return local.registrar(email, senha);
  const d = await api("/api/register", { method: "POST", body: { email, senha } });
  try { localStorage.setItem(TKEY, d.token); } catch {}
  _user = d.user; _emit();
  return _user;
}

export async function login(email, senha) {
  if (!API) return local.login(email, senha);
  const d = await api("/api/login", { method: "POST", body: { email, senha } });
  try { localStorage.setItem(TKEY, d.token); } catch {}
  _user = d.user; _emit();
  return _user;
}

export async function logout() {
  if (!API) return local.logout();
  try { await api("/api/logout", { method: "POST", auth: true }); } catch { /* desloga local mesmo assim */ }
  try { localStorage.removeItem(TKEY); } catch {}
  _user = null; _emit();
}

export async function listarFotos(localNome) {
  if (!API) return local.listarFotos(localNome);
  if (!localNome) return [];
  const d = await api("/api/fotos?local=" + encodeURIComponent(localNome));
  return (d.fotos || []).map((f) => ({ id: f.id, url: absoluta(f.url), criadoEm: f.criadoEm, autor: f.autor }));
}

export async function enviarFoto(localNome, file) {
  if (!API) return local.enviarFoto(localNome, file);
  if (!_user) throw new Error("Faça login para enviar fotos");
  if (!localNome) throw new Error("Local inválido");
  const dataUrl = await _resize(file);   // o app já comprime antes de subir
  const d = await api("/api/fotos", { method: "POST", auth: true, body: { local: localNome, dataUrl } });
  return { id: d.id, url: absoluta(d.url) };
}

export async function removerFoto(foto) {
  if (!API) return local.removerFoto(foto);
  if (!foto || foto.id == null) return;
  await api("/api/fotos/" + encodeURIComponent(foto.id), { method: "DELETE", auth: true });
}

// Redimensiona/comprime a imagem para um dataURL JPEG (igual ao fotos-store.js).
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
```

---

## PASSO 3 — edições no app (re-aplicar)

### 3a) `iFrota-web/js/ui.js` — trocar o import do backend

DE (modo local, atual):
```js
import { fotosAtivo, registrar, login, logout, onAuth, ehAdmin, listarFotos, enviarFoto, removerFoto } from "./fotos-store.js";
```
PARA (modo servidor):
```js
// Backend de fotos+contas: server-store decide em runtime entre o SERVIDOR (PC de
// casa, via campo "Servidor"/?api=) e o LOCAL (IndexedDB, quando sem URL).
import { fotosAtivo, registrar, login, logout, onAuth, ehAdmin, listarFotos, enviarFoto, removerFoto,
         modoServidor, urlServidor, definirServidor, testarServidor } from "./server-store.js";
```

### 3b) `iFrota-web/js/ui.js` — fiação da seção "Servidor"

Inserir logo após o bloco de login (depois de
`$("login-senha").addEventListener("keydown", ...)`, antes de `// ── GESTÃO ADMIN`):

```js
  // ── SERVIDOR (backend de fotos+contas: PC de casa via ngrok/Cloudflare) ──
  // O campo deixa o APK/web apontar pro seu servidor sem precisar de ?api= na URL.
  function srvStatus() {
    const el = $("srv-status");
    if (modoServidor()) {
      let host = urlServidor();
      try { host = new URL(urlServidor()).host; } catch { /* mantém a URL crua */ }
      el.textContent = "Conectado: " + host;
      el.className = "srv-status on";
    } else {
      el.textContent = "Modo local (sem servidor)";
      el.className = "srv-status off";
    }
  }
  $("srv-url").value = urlServidor();
  srvStatus();
  $("srv-salvar").onclick = () => {
    const v = definirServidor($("srv-url").value);
    showToast(v ? "Conectando ao servidor…" : "Voltando ao modo local…");
    setTimeout(() => location.reload(), 600);   // API é lida no load → recarrega
  };
  $("srv-testar").onclick = async () => {
    const url = $("srv-url").value.trim();
    const el = $("srv-status");
    if (!url && !modoServidor()) { showToast("Informe a URL do servidor"); return; }
    el.textContent = "Testando…"; el.className = "srv-status off";
    const ok = await testarServidor(url);
    el.textContent = ok ? "Servidor respondeu ✓" : "Sem resposta do servidor";
    el.className = ok ? "srv-status on" : "srv-status erro";
  };
```

### 3c) `iFrota-web/index.html` — seção no menu lateral

Inserir antes de `<div class="panel-section" id="admin-section" ...>`:

```html
      <div class="panel-section" id="server-section">
        <div class="section-header">SERVIDOR (fotos e contas)</div>
        <div class="srv-status off" id="srv-status">Modo local (sem servidor)</div>
        <input id="srv-url" class="login-input srv-input" placeholder="https://seunome.ngrok-free.app" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false">
        <button class="login-btn" id="srv-salvar">Salvar e conectar</button>
        <button class="adm-loc-btn" id="srv-testar"><i class="fa fa-bolt"></i> Testar conexão</button>
        <div class="adm-hint">Cole a URL do seu servidor (ex.: ngrok). Vazio = modo local. O app recarrega ao salvar.</div>
      </div>
```

### 3d) `iFrota-web/css/ui.css` — estilos (após a regra `.adm-hint`)

```css
/* Seção SERVIDOR (backend de fotos+contas) */
.srv-status { font-size: 12px; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.srv-status.on { color: #2e8b57; }
.srv-status.off { color: var(--leg-tit); }
.srv-status.erro { color: #d9534f; }
body.dark .srv-status.on { color: #5fcf8a; }
.srv-status::before { content: "●"; font-size: 9px; }
#server-section .srv-input { margin-bottom: 8px; }
#server-section .adm-loc-btn { margin-top: 8px; }
```

### 3e) `iFrota-web/sw.js` — precache + versão

Adicionar `"./js/server-store.js",` logo depois de `"./js/fotos-store.js",` em
`SHELL_ASSETS`, e subir o `VERSION` (ex.: para `ifrota-v30`).

---

## PASSO 4 — usar

```bash
node server/server.js
ngrok http --domain=seunome.ngrok-free.app 3000     # winget install ngrok.ngrok
```
No app: menu → **SERVIDOR** → cola `https://seunome.ngrok-free.app` → **Salvar e conectar**.
Para desligar: campo vazio → Salvar (volta ao local).

## Verificações que passaram (28/06/2026)
curl register/login/upload/list/delete + 401; arquivos no disco; `/uploads` serve a
imagem; CORS preflight com o header ngrok (204 + `Access-Control-Allow-Headers`);
e2e no browser (`?api=http://localhost:3000` → login admin real, badge "Administrador",
gestão visível); campo "Servidor": status, Testar e Salvar gravando a URL.
