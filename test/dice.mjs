/* dice.test.mjs — 🎲 擲骰決定先後的純邏輯(js/dice-toss.js 與 skill dice-coin-toss 同一份) */
import { resolveOrder, resolveCoin } from "../js/dice-toss.js";
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log("  ✗ " + m); } };
const seq = (a) => { let i = 0; return () => a[i++ % a.length]; };
const face = (v) => (v - 1) / 6 + 0.01;          // rng 值 → 那個點數

// 兩人:5 對 3 ⇒ 0 先
let r = resolveOrder(2, seq([face(5), face(3)]));
ok(r.order.join() === "0,1" && r.rounds.length === 1, `5 vs 3 ⇒ 0 先(${r.order})`);
// 同點重擲:4/4 → 2/6 ⇒ 1 先,擲了兩輪
r = resolveOrder(2, seq([face(4), face(4), face(2), face(6)]));
ok(r.order.join() === "1,0" && r.rounds.length === 2, `同點重擲 ⇒ 1 先、兩輪(${r.order} / ${r.rounds.length})`);
// 四人:6,3,6,1 ⇒ 0 和 2 重擲(2 勝),3 最後;只有打平的重擲
r = resolveOrder(4, seq([face(6), face(3), face(6), face(1), face(2), face(5)]));
ok(r.order.join() === "2,0,1,3" && r.rounds[1].length === 2, `四人只重擲打平的(${r.order})`);
// 隨機 2000 次:永遠是排列、兩人先手率 ≈ 50%
let first0 = 0;
for (let i = 0; i < 2000; i++) {
  const o = resolveOrder(3).order;
  if ([...o].sort().join() !== "0,1,2") { ok(false, "不是排列 " + o); break; }
  if (resolveOrder(2).order[0] === 0) first0++;
}
ok(first0 > 880 && first0 < 1120, `兩人先手率公平(${first0}/2000)`);
ok(resolveCoin(() => 0.1).order.join() === "0,1" && resolveCoin(() => 0.9).order.join() === "1,0", "硬幣正面 0 先、反面 1 先");
console.log(fail ? `🔴 dice ${fail} 項紅` : "✅ dice 5 項全過");
process.exit(fail ? 1 : 0);
