# Configuração do Firebase — Fotos da galeria

Sistema de fotos: **admins logados** (e-mail/senha) enviam fotos que ficam visíveis
para **todos os usuários**. Sem isso configurado, o app funciona normal (galeria só
com as fotos locais).

Tudo no plano **gratuito** (Spark) do Firebase.

---

## 1. Criar o projeto

1. Acesse https://console.firebase.google.com e clique **Adicionar projeto**.
2. Dê um nome (ex: `ifrota`), pode desativar o Google Analytics.

## 2. Registrar o app web e pegar a config

1. No painel do projeto, clique no ícone **</> (Web)**.
2. Apelido: `ifrota-web`. **Não** marque Hosting. Clique **Registrar**.
3. Vai aparecer um trecho `const firebaseConfig = { ... }`. Copie os valores.
4. Cole em **`js/firebase-config.js`** (substitua os `COLE_...`):

```js
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "ifrota-xxxx.firebaseapp.com",
  projectId: "ifrota-xxxx",
  storageBucket: "ifrota-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...:web:abc...",
};
```

> Esses valores **não são segredo** (vão pro client mesmo). A segurança vem das
> regras (passo 6) + login.

## 3. Ativar Authentication (e-mail/senha)

1. Menu **Authentication → Get started**.
2. Aba **Sign-in method → Email/Password → Ativar → Salvar**.

## 4. Criar o(s) usuário(s) admin

1. Aba **Users → Add user**.
2. Informe **e-mail e senha** do admin (ex: `admin@ifrota.com`). Repita pra cada admin.
3. Só quem tiver conta aqui consegue enviar fotos.

## 5. Criar Firestore e Storage

- **Firestore Database → Criar banco de dados → Modo de produção → (região) → Ativar.**
- **Storage → Get started → Modo de produção → (região) → Concluir.**

## 6. Regras de segurança (leitura pública, escrita só logado)

**Firestore** (aba Firestore → Rules):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /fotos/{doc} {
      allow read: if true;                       // todos veem
      allow create, delete: if request.auth != null;  // só admin logado
      allow update: if false;
    }
  }
}
```

**Storage** (aba Storage → Rules):
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /fotos/{allPaths=**} {
      allow read: if true;                  // todos veem
      allow write: if request.auth != null; // só admin logado
    }
  }
}
```
Clique **Publicar** em cada uma.

> **Restringir a e-mails específicos** (opcional): troque `request.auth != null` por
> `request.auth.token.email in ['admin@ifrota.com', 'outro@ifrota.com']`.

## 7. Testar

1. Recarregue o app (`?nosw=1` se estiver em dev).
2. Abra o menu lateral → seção **ADMIN** → **Entrar como admin** → use o e-mail/senha do passo 4.
3. Abra um waypoint, expanda o card (swipe up), na **GALERIA** clique **Adicionar foto**.
4. A foto aparece pra qualquer usuário que abrir aquele waypoint (Firestore + Storage).
5. Como admin, dá pra **remover** uma foto da nuvem (lixeira no canto da foto).

---

## Como funciona no código

- `js/firebase-config.js` — só a config (você edita).
- `js/firebase.js` — init lazy + `login/logout/onAuth` + `listarFotos/enviarFoto/removerFoto`.
  Carrega o SDK do Firebase via CDN só quando há config; tolera falha/offline.
- Galeria (`ui.js`) mescla **fotos locais** (`locais.json`) + **fotos da nuvem** (Firestore).
- Estrutura no Firestore: coleção `fotos`, doc `{ local, url, path, autorEmail, criadoEm }`.
- Arquivos no Storage: `fotos/<slug-do-local>/<timestamp>_<arquivo>`.

## Observações

- As **tiles do mapa** e agora as **fotos da nuvem** precisam de internet. O resto do app
  (mapa cacheado, navegação, agenda) continua offline.
- No APK (Capacitor), funciona igual — o SDK carrega da CDN na 1ª vez (precisa de internet).
