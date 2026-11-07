// Cria (uma única vez) a chave que assina o APK de release. Todo APK futuro
// precisa ser assinado com ESTA chave — senão o Android recusa instalar por cima
// do anterior e cada estudante teria de desinstalar o app. A chave de debug não
// serve: ela é diferente em cada computador.
//
// Fica fora do repositório e do OneDrive, em %USERPROFILE%\.ifrota\:
//   ifrota-release.jks      a chave
//   release.properties      caminho + senha (lido pelo Gradle, ver preparar-android)
// FAÇA BACKUP dessa pasta (pendrive, gerenciador de senhas). Perdeu = o app
// instalado nunca mais recebe atualização.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = join(homedir(), ".ifrota");
const JKS = join(DIR, "ifrota-release.jks");
const PROPS = join(DIR, "release.properties");

if (existsSync(JKS) || existsSync(PROPS)) {
  console.error(`[keystore] já existe uma chave em ${DIR} — nada foi alterado.`);
  console.error("[keystore] Ela é a única que atualiza o app instalado; não apague nem substitua.");
  process.exit(1);
}

const exe = process.platform === "win32" ? "keytool.exe" : "keytool";
const keytool = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", exe) : exe;
const senha = randomBytes(18).toString("base64url");   // 24 caracteres
const alias = "ifrota";

await mkdir(DIR, { recursive: true });
try {
  execFileSync(keytool, [
    "-genkeypair", "-keystore", JKS, "-storetype", "PKCS12",
    "-alias", alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
    "-storepass", senha, "-keypass", senha,
    "-dname", "CN=IF-rota, O=IF-rota, C=BR",
  ], { stdio: ["ignore", "ignore", "inherit"] });
} catch (e) {
  console.error(`[keystore] falha ao rodar o keytool (${keytool}). Defina JAVA_HOME para o JDK 17.`);
  process.exit(1);
}

// Formato .properties: barras normais no caminho (a contrabarra é escape lá).
await writeFile(PROPS, [
  `storeFile=${JKS.replace(/\\/g, "/")}`,
  `storePassword=${senha}`,
  `keyAlias=${alias}`,
  `keyPassword=${senha}`,
  "",
].join("\n"));

console.log(`[keystore] chave criada em ${DIR}`);
console.log("[keystore] FAÇA BACKUP DESSA PASTA. Sem ela o app instalado não recebe mais atualizações.");
console.log("[keystore] Próximo passo: npm run sync  →  gradlew assembleRelease");
