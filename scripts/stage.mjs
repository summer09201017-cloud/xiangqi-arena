/* 產出乾淨的部署包 .deploy/(給 wrangler pages deploy 用)。
   跑法:npm run stage

   為什麼要有這一步:`wrangler pages deploy <dir>` **沒有忽略檔機制**
   (`.assetsignore` 完全無效,manual-deploy-map 有實錄)⇒ 目錄裡有什麼就傳什麼。
   直接部署 repo 根目錄會把 test/ scripts/ screenshots/ node_modules/ 一起傳上去。

   ★ 刻意**不做**成 `npm run deploy` 把 wrangler 包在裡面:
     那樣 zero-pii-guard 看到的只是 `npm run deploy`,解析不到部署目錄 ⇒ 掃不到、等於關掉守門。
     那正是 deploy-flag-audit #32 在講的「守門存在不等於守門會攔」。
     ⇒ 部署那一行永遠明寫出來(README 有,manual-deploy-map 也登記了)。 */
import { cp, rm, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".deploy");

// 只有這些會上線。新增要上線的檔案時記得補這裡**和** sw.js 的 ASSETS_TO_CACHE。
const SHIP = ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "icons"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of SHIP) {
  await cp(path.join(root, item), path.join(out, item), { recursive: true });
}

const listed = await readdir(out);
console.log(`✅ .deploy/ 已備妥:${listed.join(" / ")}`);
console.log("\n部署(⚠ 一定要 --branch main,否則只建 preview、正式網址不動):");
console.log('  npx wrangler pages deploy .deploy --project-name incandescent-stroopwafel-31007a --branch main');
