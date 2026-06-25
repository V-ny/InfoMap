# Empacotamento Android (APK) — IFrota Web

Três caminhos pra transformar o PWA em APK. Todos partem do app já pronto em `iFrota-web/`.

---

## ✅ O que foi feito (Capacitor — APK offline) — receita reproduzível

APK gerado: `IFrota-debug.apk` (~4.5 MB, `com.ifrota.app`, minSdk 22, targetSdk 34).

### Ferramentas (instaladas via winget)
```powershell
winget install OpenJS.NodeJS.LTS          # Node 24
winget install Microsoft.OpenJDK.17       # JDK 17
# Android SDK via cmdline-tools (baixado manualmente, ver abaixo)
```

### Setup do Capacitor (uma vez)
```powershell
cd iFrota-web
$env:NODE_OPTIONS = "--use-system-ca"     # contorna SSL do Avast (ver nota)
npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6
node build-www.mjs                         # monta www/ (webDir)
npx cap add android
```

### Build do APK (cada vez que mudar o web)
```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd iFrota-web
node build-www.mjs ; npx cap sync android
cd android
.\gradlew.bat assembleDebug --no-daemon --console=plain
# → app/build/outputs/apk/debug/app-debug.apk
```

### ⚠️ Pegadinhas desta máquina (Avast Antivirus)
O Avast faz interceptação TLS (MITM), quebrando a validação de certificado de
ferramentas que não usam o trust store do Windows:
1. **npm:** `$env:NODE_OPTIONS = "--use-system-ca"`.
2. **Java/sdkmanager/Gradle:** importar a root `Avast Web/Mail Shield Root` num cacerts
   copiado e apontar via `-Djavax.net.ssl.trustStore` (já configurado em
   `android/gradle.properties`).
3. **sdkmanager licenças:** o prompt lê do console, trava headless. Solução: escrever os
   hashes em `Sdk/licenses/android-sdk-license` direto (hashes públicos de CI).

### Pendente (Sprint 5)
- GPS real: adicionar `ACCESS_FINE_LOCATION` no `AndroidManifest.xml` + plugin
  `@capacitor/geolocation`. Posição manual (tap) já funciona offline.
- Tiles do mapa ainda precisam de internet (vetorial streaming).

---

## Pré-requisito comum: hospedagem HTTPS (caminhos A e B)

TWA (Trusted Web Activity) abre uma URL HTTPS. Opções gratuitas:

- **GitHub Pages** — push do `iFrota-web/` num repo, ativa Pages → `https://usuario.github.io/repo/`
- **Netlify / Vercel** — arrasta a pasta, recebe URL HTTPS na hora
- **Cloudflare Pages** — idem

> O caminho **C (Capacitor)** NÃO precisa de hospedagem — empacota os assets dentro do APK.

---

## Caminho A — PWABuilder (cloud, ZERO instalação local) ⭐ recomendado p/ TCC

1. Hospede o PWA (ver acima) e copie a URL HTTPS.
2. Acesse https://www.pwabuilder.com e cole a URL.
3. Ele audita o PWA (manifest, SW, ícones — o IFrota já passa em tudo).
4. Clique **Package For Stores → Android → Generate**.
5. Baixe o `.zip`: contém `app-release-signed.apk`, a chave de assinatura e o
   `assetlinks.json`.
6. Instale o APK no celular (ative "fontes desconhecidas").

**Prós:** sem instalar nada, gera APK assinado + chave + assetlinks automaticamente.
**Contras:** depende da URL hospedada (o app abre a URL; SW cacheia após 1ª carga).

---

## Caminho B — Bubblewrap (local)

Requer **Node.js** (o Bubblewrap baixa sozinho JDK 17 + Android SDK ~1 GB na 1ª vez).

```powershell
winget install OpenJS.NodeJS.LTS      # instala Node + npm
npm install -g @bubblewrap/cli

# Aponta pro manifest hospedado
bubblewrap init --manifest https://SEU-HOST/manifest.json
bubblewrap build                       # gera app-release-signed.apk
```

Na 1ª execução o Bubblewrap pergunta se pode baixar JDK + Android SDK (aceite).
Ele também gera/gerencia a keystore de assinatura.

**Prós:** controle local, reproduzível, versionável.
**Contras:** ~1 GB de download, ainda precisa da URL HTTPS.

---

## Caminho C — Capacitor (local, APK 100% offline)

Empacota os assets DENTRO do APK — não precisa de hospedagem. Ideal pra campus com
sinal fraco. Requer **Node.js + Android Studio** (Android SDK).

```powershell
winget install OpenJS.NodeJS.LTS
# Android Studio: instala o SDK + build-tools
winget install Google.AndroidStudio

cd iFrota-web
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init IFrota com.ifrota.app --web-dir .
npx cap add android
npx cap sync
npx cap open android        # abre no Android Studio → Build > Build APK(s)
```

**Prós:** APK autônomo, funciona offline sem 1ª carga online.
**Contras:** toolchain mais pesado (Android Studio), mais passos de config.

---

## Digital Asset Links (apenas TWA — caminhos A e B)

Pra remover a barra de URL do Chrome no TWA, hospede em `/.well-known/assetlinks.json`
o conteúdo gerado pelo PWABuilder/Bubblewrap (contém o SHA-256 da chave de assinatura).
Sem isso o app funciona, mas mostra uma fina barra com o domínio.

---

## Recomendação para o TCC

1. **Demo rápida / entrega:** Caminho **A (PWABuilder)** — APK assinado em minutos.
2. **Defesa técnica / app offline:** Caminho **C (Capacitor)** — autônomo, impressiona
   mais na banca por não depender de internet.

A monografia pode citar os três como alternativas de empacotamento PWA→Android,
justificando a escolha pela infraestrutura disponível.
