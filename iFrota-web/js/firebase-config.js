// Configuração do Firebase — COLE AQUI os dados do SEU projeto Firebase.
// Veja docs/FIREBASE-SETUP.md para o passo a passo de como obter esses valores.
//
// Enquanto os valores estiverem com "COLE_..." o app roda normal, só sem os
// recursos de nuvem (galeria mostra apenas as fotos locais; sem login/upload).
export const FIREBASE_CONFIG = {
  apiKey: "COLE_SUA_API_KEY",
  authDomain: "COLE_SEU_PROJETO.firebaseapp.com",
  projectId: "COLE_SEU_PROJECT_ID",
  storageBucket: "COLE_SEU_PROJETO.appspot.com",
  messagingSenderId: "COLE_SEU_SENDER_ID",
  appId: "COLE_SEU_APP_ID",
};

// true quando a config foi preenchida de verdade (não são mais placeholders).
export function firebaseConfigurado() {
  return !!FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith("COLE_");
}
