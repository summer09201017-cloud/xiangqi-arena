// test/vertag.mjs — 守「版號與改版簡歷」不漂(0904 立)
//
// 由來:index.html 的 verTag 是**靜態**的,而 sw.js 的 CACHE_NAME 每次改版都會 bump。
//   0904 實錘:verTag 停在 v2、站上其實已經是 v5 —— v3/v4/v5 三版的改動一個字都沒寫進去,
//   而且它把版號少標了一號。**沒有任何測試會紅、畫面也沒有錯誤**,只有人去看才發現。
// ⇒ 這支就是那個「人」。它不管文案寫得好不好(白話品質只有人能判斷),
//   只守三件機器驗得出來的事:①版號對得上 ②前幾版沒有跳號 ③徽章三件套都在。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
let bad = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  \u2713 ' : '  \u2717 ') + name + (detail ? '  \u2014 ' + detail : ''));
  if (!ok) bad++;
};

const swV = (sw.match(/CACHE_NAME\s*=\s*'[^']*-v(\d+)'/) || [])[1];
check('sw.js \u62bd\u5f97\u51fa CACHE_NAME \u7248\u865f', !!swV, 'v' + swV);

const tag = (html.match(/id="verTag"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '';
const tagV = (tag.match(/v(\d+)/) || [])[1];   // 本版一定排在最前面
check('\u2605 verTag \u7684\u7248\u865f == sw.js \u7684 CACHE_NAME\uff08\u6539\u7248\u5fd8\u4e86\u66f4\u65b0\u9019\u884c \u21d2 \u9019\u689d\u7d05\uff09',
  tagV === swV, 'verTag v' + tagV + ' vs sw v' + swV);

check('verTag \u5e36\u65e5\u671f\uff08\u5bb6\u9577/\u8001\u5e2b\u8981\u770b\u5f97\u51fa\u591a\u65b0\uff09', /\u7248\u672c v\d+[(\uff08]\d{4}-\d{2}-\d{2}[)\uff09]/.test(tag));

// 前幾版:必須從 vN-1 一路往下、不跳號(跳號=有一版沒寫進來)
const prev = [...tag.matchAll(/\u524d\u5e7e\u7248[:\uff1a]v(\d+)/g)].map((m) => Number(m[1]));
check('\u6709\u5217\u300c\u524d\u5e7e\u7248\u300d', prev.length > 0, prev.join(','));
const want = [];
for (let v = Number(swV) - 1; v >= Number(swV) - prev.length; v--) want.push(v);
check('\u2605 \u524d\u5e7e\u7248\u4e0d\u8df3\u865f\uff08\u8df3\u865f = \u6709\u4e00\u7248\u6c92\u5beb\u9032\u4f86\uff09',
  prev.length > 0 && JSON.stringify(prev) === JSON.stringify(want), prev.join(',') + ' \u9810\u671f ' + want.join(','));

// 徽章三件套(A 部分):頁面不寫死版號,靠 SW 回報
check('\u5fbd\u7ae0\u5bb9\u5668 #appVerBadge \u5728', /id="appVerBadge"/.test(html));
check('\u5fbd\u7ae0\u6709\u554f SW \u62ff\u7248\u672c\uff08\u9801\u9762\u4e0d\u5beb\u6b7b\u7248\u865f\uff09', /GET_VERSION/.test(html) && /SW_VERSION/.test(html));
check('sw.js \u6709\u56de\u7b54 GET_VERSION', /GET_VERSION/.test(sw) && /SW_VERSION/.test(sw));
check('\u5fbd\u7ae0\u6703\u6de1\u51fa\uff08\u4e0d\u906e\u4f4f\u6309\u9215\u7684\u5b57\uff09', /appVerBadge[\s\S]{0,600}opacity\s*=\s*'0'/.test(html));

console.log((bad ? '🔴' : '🟢') + ' vertag: ' + (9 - bad) + '/9 \u9805\u901a\u904e');
process.exit(bad ? 1 : 0);
