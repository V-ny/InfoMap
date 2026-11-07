// Ajusta o projeto Android gerado pelo Capacitor (android/ não é versionado, então
// um `npx cap add android` do zero sai sem estes ajustes). Idempotente — o
// `npm run sync` roda a cada build.
//   - permissões de localização (o plugin de geolocalização exige no manifest)
//   - versionName/versionCode a partir do package.json (o APK novo instala por
//     cima do antigo e a versão aparece nas configurações do Android)
//   - assinatura do assembleRelease com a chave de ~/.ifrota (npm run keystore)
//   - ícone do app e tela de abertura do IF-rota (no lugar dos padrões do Capacitor)
import { readFile, writeFile, copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MANIFEST = "android/app/src/main/AndroidManifest.xml";
const GRADLE = "android/app/build.gradle";

if (!existsSync(MANIFEST)) {
  console.error("[preparar-android] android/ não existe — rode antes: npx cap add android");
  process.exit(1);
}

const PERMISSOES = [
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
];

let manifest = await readFile(MANIFEST, "utf8");
const faltando = PERMISSOES.filter((p) => !manifest.includes(p.match(/android:name="([^"]+)"/)[0]));
if (faltando.length) {
  manifest = manifest.replace("</manifest>", faltando.map((p) => `    ${p}\n`).join("") + "</manifest>");
  await writeFile(MANIFEST, manifest);
}
console.log(`[preparar-android] manifest: ${faltando.length ? `+${faltando.length} permissão(ões)` : "ok"}`);

// 1.2.3 → versionCode 10203 (sempre cresce junto com a versão).
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const [maj, min, pat] = version.split(".").map((n) => parseInt(n, 10) || 0);
const code = maj * 10000 + min * 100 + pat;
let gradle = await readFile(GRADLE, "utf8");
gradle = gradle
  .replace(/versionCode \d+/, `versionCode ${code}`)
  .replace(/versionName "[^"]*"/, `versionName "${version}"`);

// Assinatura de release. O bloco lê ~/.ifrota/release.properties em tempo de
// build — senhas nunca entram no projeto. Sem a chave, o release sai sem
// assinatura (o debug continua funcionando normalmente).
const MARCA = "// IFROTA-ASSINATURA";
if (!gradle.includes(MARCA)) {
  gradle += `
${MARCA} — gerado por tools/preparar-android.mjs (não editar).
def ifrotaChave = new File(System.getProperty("user.home"), ".ifrota/release.properties")
if (ifrotaChave.exists()) {
    def ifrotaProps = new Properties()
    ifrotaChave.withInputStream { ifrotaProps.load(it) }
    android {
        signingConfigs {
            ifrota {
                storeFile file(ifrotaProps["storeFile"])
                storePassword ifrotaProps["storePassword"]
                keyAlias ifrotaProps["keyAlias"]
                keyPassword ifrotaProps["keyPassword"]
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.ifrota
            }
        }
    }
}
`;
}
await writeFile(GRADLE, gradle);
console.log(`[preparar-android] versão: ${version} (code ${code})`);
const temChave = existsSync(join(homedir(), ".ifrota", "release.properties"));
console.log(`[preparar-android] assinatura de release: ${temChave ? "ok (~/.ifrota)" : "SEM CHAVE — rode npm run keystore (uma vez)"}`);

// ── Identidade visual: ícone do app + tela de abertura ───────────────────────
// Sem isto o APK sai com o logo do Capacitor. Tudo em XML + cópia dos PNGs de
// icons/ (sem ferramenta de imagem): o Android redimensiona os bitmaps.
const RES = "android/app/src/main/res";
const XML = '<?xml version="1.0" encoding="utf-8"?>\n';
const NS = 'xmlns:android="http://schemas.android.com/apk/res/android"';
await mkdir(`${RES}/drawable-xxxhdpi`, { recursive: true });
// xxxhdpi = 4x → os 512 px viram 128 dp em qualquer tela.
await copyFile("icons/icon-512-maskable.png", `${RES}/drawable-xxxhdpi/ifrota_icone_cheio.png`);
await copyFile("icons/icon-512.png", `${RES}/drawable-xxxhdpi/ifrota_icone.png`);
await writeFile(`${RES}/values/ifrota.xml`, XML +
  "<resources>\n" +
  '    <color name="ifrota_fundo">#F4ECD9</color>\n' +     // fundo do ícone maskable
  '    <color name="ifrota_splash">#0a0a0a</color>\n' +    // = SplashScreen.backgroundColor
  "</resources>\n");
// Ícone adaptativo (Android 8+): o maskable com 12% de margem cabe na área
// segura de qualquer máscara (círculo, gota, quadrado).
await writeFile(`${RES}/drawable/ifrota_icone_fg.xml`, XML +
  `<inset ${NS} android:drawable="@drawable/ifrota_icone_cheio" android:inset="12%" />\n`);
for (const nome of ["ic_launcher", "ic_launcher_round"]) {
  await writeFile(`${RES}/mipmap-anydpi-v26/${nome}.xml`, XML +
    `<adaptive-icon ${NS}>\n` +
    '    <background android:drawable="@color/ifrota_fundo" />\n' +
    '    <foreground android:drawable="@drawable/ifrota_icone_fg" />\n' +
    "</adaptive-icon>\n");
}
// Ícone legado (Android 5–7).
for (const pasta of (await readdir(RES)).filter((d) => /^mipmap-[a-z]+dpi$/.test(d))) {
  for (const nome of ["ic_launcher", "ic_launcher_round"]) {
    await copyFile("icons/icon-512.png", `${RES}/${pasta}/${nome}.png`);
  }
}
// Tela de abertura: ícone centralizado no fundo escuro. Os splash.png do
// Capacitor (por densidade/orientação) teriam prioridade sobre o XML — saem.
for (const pasta of (await readdir(RES)).filter((d) => d.startsWith("drawable"))) {
  await rm(`${RES}/${pasta}/splash.png`, { force: true });
}
await writeFile(`${RES}/drawable/splash.xml`, XML +
  `<layer-list ${NS}>\n` +
  '    <item android:drawable="@color/ifrota_splash" />\n' +
  '    <item><bitmap android:gravity="center" android:src="@drawable/ifrota_icone" /></item>\n' +
  "</layer-list>\n");
// Android 12+ desenha a própria abertura (ícone do app sobre uma cor): mesma cor.
const STYLES = `${RES}/values/styles.xml`;
let styles = await readFile(STYLES, "utf8");
if (!styles.includes("windowSplashScreenBackground")) {
  styles = styles.replace('<item name="android:background">@drawable/splash</item>',
    '<item name="android:background">@drawable/splash</item>\n' +
    '        <item name="windowSplashScreenBackground">@color/ifrota_splash</item>');
  await writeFile(STYLES, styles);
}
console.log("[preparar-android] ícone e tela de abertura: ok");
