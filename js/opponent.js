/* opponent.js — 這一站的 🐾 動物對手接線(本站專屬;動物引擎 animals.js、人聲 voice.js、three-shim.js 三支與 skill animal-opponent-kit 同一份,不在這裡改)
 *
 * 對手是誰就坐誰:Lv.1 初級 🐰 白兔 / Lv.2 中級 🐱 橘貓 / Lv.3 高級 🐻 棕熊 / Lv.4 大師 🦉 貓頭鷹;📅 每日殘局 = 🦉 守黑方。
 * 本站永遠是人對 AI(沒有兩人同機),所以每局都坐;2D 視角看不到牠(正俯視)⇒ 2D 時收起,切回 3D 再坐回來。
 * ★ 這一站的世界是 **Z-up**(棋盤躺在 XY 平面、3D 模式 camera.up = +Z),而動物引擎假設 Y-up(頭頂在本地 +y、跳起來是 +y)
 *   ⇒ 動物全部掛在一個轉了 +90°(繞 X)的父群組 petRoot 底下:petRoot 本地 (x, y, z) → 世界 (x, -z, y)。
 *   引擎只動本地 y(跳 / 呼吸)⇒ 世界裡就是往上跳;headTop() / worldToLocal() 都經過父矩陣,對的。
 *   ⚠ 不用引擎的 lookAt(它拿世界座標算,而且 up 是 +Y)—— 傳 lookAt:null,自己設 group.rotation.y 朝棋盤中心。
 * ★ 座位永遠在「相機的對面」(跟 gomoku3d / 3D-Xiangqi 同一條):每幀量相機方位角,變了(2° 一格)就重擺;🔃 換邊也跟著坐到對面。
 *   坐的距離 = 盤緣(矩形,照方向算)+ 1.25 × scale(掌心搭到盤沿)。人執黑時 AI 是紅方,牠一樣坐在你對面(看的是螢幕,不是棋色)。
 * ★ 相機讓位:renderer.fitExtra(dir) 回牠的頭頂(+耳朵),fitCamera 把距離最多拉到 1.28 倍(棋盤最多縮 ~22%);正俯視 / 2D 不讓。
 * ★ 純觀感:不進 raycast、不進 AI、不影響棋力。三段 voice / mute / off 記在 localStorage(自己的鍵,不進存檔 / 偏好)。
 */
import * as THREE from 'three';
import { AnimalFigures, ANIMALS, HEAD_TOP_LOCAL_Y } from './animals.js';

export { ANIMALS };
export const LEVEL_ANIMAL = { easy: 'rabbit', medium: 'cat', hard: 'bear', master: 'owl' };
export const PET_KEY = 'xiangqi-arena-pet';
export const PET_MODES = ['voice', 'mute', 'off'];
export function loadPetMode() { try { const v = localStorage.getItem(PET_KEY); return PET_MODES.includes(v) ? v : 'voice'; } catch { return 'voice'; } }
export function savePetMode(m) { try { localStorage.setItem(PET_KEY, m); } catch { /* 私密模式:這場有效 */ } }
/** 這一局該坐哪一隻:每日殘局 🦉;不然照難度 */
export function animalFor(daily, difficulty) {
  if (daily) return 'owl';
  return LEVEL_ANIMAL[difficulty] || 'cat';
}

const SEAT = 'ai';
/* 動物多大?跟 3D-Xiangqi 同一個盤(90×85、棋子直徑 8)同一個數:0.215 倍 ⇒ 7.4(頭直徑 ≈ 兩顆棋子)。
   0.24 倍時頭頂 NDC 剛好 0.97、但貓 / 熊的耳尖被切幾 px,讓位已頂到 1.28 上限救不回 ⇒ 縮一點 + 取景點加 EAR_ROOM。 */
const SCALE_PER_HALF = 0.215 / 1.3;
const PITCH_HIDE = 76;      // 俯角 ≥ 這個就不為牠讓位(正俯視看不到牠)
const YAW_STEP_DEG = 2;     // 相機方位角每差 2° 才重擺(OrbitControls 阻尼期間每幀都在微動)
const EAR_ROOM = 0.55;      // 取景點比頭頂再高一點,耳尖才不會貼邊被切(本地單位)

export class Opponent {
  constructor(renderer, voice) {
    this.r = renderer;
    this.voice = voice || null;
    this.figs = null; this.root = null; this.scene = null;
    this.kind = null;
    this.mode = loadPetMode();
    this._seatKey = null;
    this.thinkCount = 0;
    this.chat = { idleMs: 0, said: 0, first: 15000, every: 30000, max: 2, log: [] };
    renderer.fitExtra = (dir) => this.fitPoints(dir);
  }
  /** 坐著而且看得到:沒關、有人坐、而且是 3D 視角(2D 正俯視看不到牠,不畫、不讓位) */
  get on() { return this.mode !== 'off' && !!this.kind && this.r.viewMode !== '2d'; }
  get voiceOn() { return this.mode === 'voice'; }
  get emoji() { return this.kind ? ANIMALS[this.kind].emoji : ''; }
  get name() { return this.kind ? ANIMALS[this.kind].name : ''; }
  get figure() { return this.figs ? this.figs.bySeat(SEAT) : null; }

  /** 每局 initScene 都是新的 scene ⇒ 每局重掛(舊 scene 連同舊動物一起被丟掉) */
  attach(scene) {
    if (this.scene === scene && this.figs) return;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'petRoot';
    this.root.rotation.x = Math.PI / 2;          // 本地 Y-up → 世界 Z-up
    scene.add(this.root);
    this.figs = new AnimalFigures(this.root);
    this.kind = null; this._seatKey = null;
  }

  setMode(m) {
    if (!PET_MODES.includes(m)) return false;
    this.mode = m; savePetMode(m);
    if (this.figs) this.figs.setVisible(this.on);
    this.r.fitCamera();
    return true;
  }

  /** 每局開始(或難度改了)叫一次(attach 之後):換人就換動物;null 收起 */
  seat(kind) {
    if (!this.figs) return;
    if (kind !== this.kind) {
      this.kind = kind;
      if (!kind) this.figs.remove(SEAT);
      else this._sit(this.figs.setKind(SEAT, kind, this._placement()));
      this._seatKey = this._key();
      this.chat.idleMs = 0; this.chat.said = 0; this.thinkCount = 0;
    }
    this.figs.setVisible(this.on);
    this.figs.cancel(SEAT);
    this.r.fitCamera();
  }

  /* ── 幾何:相機方位(世界 XY)、盤緣距離、大小、凳深 ── */
  _dir(dir) {
    if (dir) return { cx: dir.x, cy: dir.y, cz: dir.z };
    const cam = this.r.camera, t = this.r.controls ? this.r.controls.target : null;
    if (!cam) return { cx: 0, cy: -1, cz: 0 };
    const v = cam.position.clone(); if (t) v.sub(t);
    const n = v.length() || 1;
    return { cx: v.x / n, cy: v.y / n, cz: v.z / n };
  }
  _geom(dir) {
    const r = this.r;
    const halfX = r.BOARD_WIDTH / 2, halfY = r.BOARD_HEIGHT / 2;
    const scale = Math.max(halfX, halfY) * SCALE_PER_HALF;
    const d = this._dir(dir);
    const h = Math.hypot(d.cx, d.cy) || 1;                  // 只取水平分量(正俯視時退回開場方向 -Y)
    const ux = h < 1e-3 ? 0 : d.cx / h, uy = h < 1e-3 ? -1 : d.cy / h;
    const edge = Math.min(halfX / Math.max(Math.abs(ux), 1e-6), halfY / Math.max(Math.abs(uy), 1e-6));   // 矩形盤緣沿這個方向多遠
    const R = edge + 1.25 * scale;                          // 掌心(本地 z≈1.34)剛好搭到盤沿
    const dy = 0 - 0.4 * scale;                             // 掌心(本地 y 0.4)落在盤面 z=0
    const floorZ = Number.isFinite(r.floorZ) ? r.floorZ : -r.BOARD_THICKNESS;
    const legDrop = (dy - floorZ) / scale;                  // 凳底落到棋盤底(makeAnimal 有 0.7 的下限,再深也只是伸到桌底、看不到)
    return { scale, R, dy, legDrop, floorZ, ux, uy, pitchDeg: Math.asin(Math.max(-1, Math.min(1, d.cz))) * 180 / Math.PI };
  }
  _key() { const g = this._geom(); return Math.round(Math.atan2(g.ux, g.uy) * 180 / Math.PI / YAW_STEP_DEG); }
  /** 世界 (wx, wy) = 相機對面 = (-ux R, -uy R);petRoot 本地 (lx, lz) = (wx, -wy) */
  _placement() {
    const g = this._geom();
    const lx = -g.ux * g.R, lz = g.uy * g.R;
    return { pos: { x: lx, y: 0, z: lz }, lookAt: null, scale: g.scale, dy: g.dy, legDrop: g.legDrop, yaw: Math.atan2(-lx, -lz) };
  }
  _sit(f) { if (f && f.group) f.group.rotation.set(0, f.pose.yaw || 0, 0); }
  /** 取景點:頭頂 + 耳朵(照 fitCamera 決定的方向算,不等人物真的擺過去);2D / 正俯視回空陣列 = 不讓位 */
  fitPoints(dir) {
    if (!this.on) return [];
    const g = this._geom(dir);
    if (g.pitchDeg >= PITCH_HIDE) return [];
    return [new THREE.Vector3(-g.ux * g.R, -g.uy * g.R, g.dy + (HEAD_TOP_LOCAL_Y + EAR_ROOM) * g.scale)];
  }

  /** 🐾 反應 + 🗣 人聲同一個入口(沒動物 / 2D ⇒ 全部略過) */
  react(kind, voiceEvent, delayMs = 0) {
    if (!this.kind || !this.figs) return false;
    const ok = this.figs.react(SEAT, kind);
    if (voiceEvent && this.on && this.voiceOn && this.voice) this.voice.say(this.kind, voiceEvent, delayMs);
    return ok;
  }
  /** 🤔 AI 開始想:姿勢每次都做,人聲每三手唸一次(太頻繁會煩) */
  think() { this.thinkCount++; return this.react('think', this.thinkCount % 3 === 1 ? 'think' : null); }
  cancel() { if (this.figs) this.figs.cancel(SEAT); }

  /** 每幀:2D/3D 切換同步顯示;相機方位變了就重擺;idle;閒聊計時(waiting = 正在等你走) */
  update(dt, { focus = null, waiting = false, reduced = false } = {}) {
    if (!this.figs) return;
    if (this.figs.on !== this.on) this.figs.setVisible(this.on);
    if (this.kind && this.on) {
      const k = this._key();
      if (k !== this._seatKey) { this._seatKey = k; const p = this._placement(); this.figs.place(SEAT, p); this._sit(this.figure); }
    }
    this.figs.update(dt, { focus, turn: null, reduced });
    const c = this.chat;
    if (!waiting || !this.on) { c.idleMs = 0; c.said = 0; return; }
    c.idleMs += dt * 1000;
    if (c.said >= c.max || c.idleMs < c.first + c.said * c.every) return;
    c.said++;
    const ev = 'chat' + (1 + Math.floor(Math.random() * 3));
    c.log.push(ev); if (c.log.length > 20) c.log.shift();
    this.react('chat', ev);
  }
  /** 任何輸入 ⇒ 你在動,閒聊計時歸零 */
  noteInput() { this.chat.idleMs = 0; this.chat.said = 0; }

  headTop() { return this.figs ? this.figs.headTop(SEAT) : null; }
  /** smoke 用:一次把「哪一隻、看不看得到、頭頂在不在畫面、凳子有沒有落地、坐哪邊」量出來(螢幕 px 照畫布在頁面上的位置算,驗 HUD 蓋臉用) */
  probe() {
    const f = this.figure;
    if (!f) return { kind: this.kind, on: this.on, figure: false, mode: this.mode };
    const cam = this.r.camera;
    const top = this.figs.headTop(SEAT).project(cam);
    const ctr = this.figs.headCenter(SEAT).project(cam);
    const stool = f.group.localToWorld(new THREE.Vector3(0, -f.pose.legDrop, 0));
    const rect = this.r.renderer && this.r.renderer.domElement ? this.r.renderer.domElement.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const px = (v) => ({ x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height });
    const c = px(ctr), t = px(top), rad = Math.hypot(c.x - t.x, c.y - t.y);
    const wp = f.group.getWorldPosition(new THREE.Vector3());
    return {
      kind: this.kind, on: this.on, figure: true, visible: f.group.visible, mode: this.mode,
      head: { x: +top.x.toFixed(3), y: +top.y.toFixed(3), inside: Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 },
      headBox: { l: Math.round(c.x - rad), t: Math.round(c.y - rad), r: Math.round(c.x + rad), b: Math.round(c.y + rad) },
      stoolZ: +stool.z.toFixed(3), floorZ: this._geom().floorZ,
      pos: { x: +wp.x.toFixed(2), y: +wp.y.toFixed(2) },      // 世界 XY:相機在 -Y 時牠在 +Y
      scale: +f.pose.scale.toFixed(3),
    };
  }
}
