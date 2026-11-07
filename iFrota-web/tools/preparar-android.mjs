// Ajusta o projeto Android gerado pelo Capacitor (android/ não é versionado, então
// um `npx cap add android` do zero sai sem estes ajustes). Idempotente — o
// `npm run sync` roda a cada build.
//   - permissões de localização (o plugin de geolocalização exige no manifest)
//   - versionName/versionCode a partir do package.json (o APK novo instala por
//     cima do antigo e a versão aparece nas configurações do Android)
//   - assinatura do assembleRelease com a chave de ~/.ifrota (npm run keystore)
import { readFile, writeFile } from "node:fs/promises";
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
