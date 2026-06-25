# Implementação futura — Fotos na nuvem com Firebase (ADIADO)

> Decisão: por ora as fotos são salvas **localmente** (IndexedDB) com um **usuário
> registrado local**, simulando uma implementação web (ver `js/fotos-store.js`).
> O backend Firebase abaixo já está **codificado e pronto**, só desativado. Quando
> quiser fotos compartilhadas de verdade entre dispositivos, é só reativar.

## O que já existe (dormente)

- **`js/firebase-config.js`** — placeholders da config do projeto Firebase.
- **`js/firebase.js`** — init lazy + `login/logout/onAuth` + `listarFotos/enviarFoto/removerFoto`
  (Auth e-mail/senha, Firestore pros metadados, Storage pros arquivos). Tolerante a
  falha/sem config.
- **`FIREBASE-SETUP.md`** — passo a passo completo (criar projeto, colar config, ativar
  Auth, criar usuários admin, Firestore/Storage, regras de segurança).

Esses arquivos **não são usados** enquanto o app está no modo local. Ficam parados sem
efeito (o `firebase.js` só faz algo se a config estiver preenchida).

## Como reativar o Firebase no lugar do local

1. Preencher `js/firebase-config.js` e seguir o `FIREBASE-SETUP.md` (passos 3–6).
2. Em `js/ui.js`, trocar o import do backend de fotos:
   ```js
   // de:
   import { ... } from "./fotos-store.js";
   // para:
   import { firebaseAtivo as fotosAtivo, login, logout, onAuth, listarFotos, enviarFoto, removerFoto } from "./firebase.js";
   ```
   (e remover o uso de `registrar`, que é só do modo local).
3. Em `js/main.js`, voltar a chamar `initFirebase()`.

A interface (modal de login, seção de conta, botões de upload/delete na galeria) é a
**mesma** nos dois modos — só muda de onde as fotos vêm/vão.

## Diferença entre os modos

| | Local (atual) | Firebase (futuro) |
|---|---|---|
| Onde salva | IndexedDB do dispositivo | Storage + Firestore (nuvem) |
| Quem vê | Só quem usa o mesmo dispositivo | Todos os usuários, qualquer dispositivo |
| Usuário | Cadastro/login local (localStorage) | Auth e-mail/senha real |
| Internet | Não precisa | Precisa |
| Uso | Simulação / demo do TCC | Produção real |
