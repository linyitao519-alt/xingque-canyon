// 镜头与世界渲染。地面用世界坐标直接作画（斜俯视 = Y 方向压缩 KY），
// 立起来的对象（岩体、塔、单位）按世界 Y 排序后逐个调用 sprites.ts 里的独立绘制对象。
import { Game, Hero, LANES, MapData, Minion, TEAMS, Team, Unit } from './sim.js';
import { AnimInfo, HeroNames, SpriteHeight, SpriteState, Sprites, TEAM, animQuads, rng } from './sprites.js';
import { ThreeLayer } from './three_layer.js';
import type { Hud } from './hud.js';

export interface Scenery {
  /** 自带斜俯视投影的整张地面图：anchorPx ↔ anchorWorld，pxPerUnit = 横向每世界单位多少像素，ky = 图里的地面纵向压缩 */
  backdrop?: { file: string; size: [number, number]; anchorPx: [number, number]; anchorWorld: [number, number]; pxPerUnit: number; ky: number; worldRect: [number, number, number, number] };
  /** 画在底图里的桥柱、岩石：只提供碰撞 */
  props: { id: string; kind: string; pos: [number, number]; blockRadius: number }[];
  /** 从底图抠出的前景遮挡片：base 是触地点的世界坐标，w/h 是世界单位下的宽高 */
  occluders?: { id: string; file: string; base: [number, number]; ax: number; ay: number; w: number; h: number }[];
}

type C = CanvasRenderingContext2D;

/** 固定斜俯视镜头。三个标定值取自 art/camera-hud-concept.png（见 README「镜头标定」）。 */
export class Camera {
  // 三个互相独立的标定量，都对照 art/camera-hud-concept.png（1896×830）量取：
  /** ① 镜头缩放：屏幕高度能装下多少世界单位。正式默认 102（桥面约占 0.67 屏高）；120 保留为调试档（?viewh=120） */
  static VIEW_H = 102;
  /** 地面纵向压缩（固定俯角）：参考稿地面圆环高宽比 ≈ 0.70，中路屏幕斜率 0.90×0.70 ≈ 0.63 */
  static readonly KY = 0.636;
  /** ② 单位显示尺度：英雄和小兵贴图的整体倍率，不影响地图比例。参考稿英雄 ≈ 20% 屏高、小兵 ≈ 10% */
  static UNIT_SCALE = 0.561;
  /** 塔和水晶贴图的倍率（碰撞半径不变） */
  static STRUCT_SCALE = 0.527;
  /** ③ 镜头跟随位置：英雄脚底在屏幕上的位置（参考稿约 0.48, 0.61；身体中心落在画面正中附近，前方多留一点） */
  static readonly AX = 0.47; static readonly AY = 0.62;
  x = 0; y = 0; z = 1; W = 1; H = 1;
  /** 跟随中心（平滑后的玩家位置）和附加的取景偏移；最终镜头位置 = 跟随中心 + 偏移 */
  fx = 0; fy = 0; ox = 0; oy = 0;

  /** 跟随的收敛速率（1/秒）。18：以移速 84 匀速走时镜头落后约 4.7 世界单位（18px），松手后 0.17 秒内停稳。v11 是 7（落后 12 单位、约 46px，急转向时画面来回荡） */
  rate = 18;
  /** 设备像素比：镜头位置对齐到设备像素，地面贴图不会因为亚像素位移而忽清忽糊 */
  dpr = 1; pixelSnap = true;
  resize(W: number, H: number): void { this.W = W; this.H = H; this.z = H / Camera.VIEW_H; }
  snap(tx: number, ty: number): void { this.fx = tx; this.fy = ty; this.x = tx + this.ox; this.y = ty + this.oy; this.clamp(); }
  follow(tx: number, ty: number, dt: number): void {
    const k = 1 - Math.exp(-dt * this.rate);
    this.fx += (tx - this.fx) * k; this.fy += (ty - this.fy) * k;
    // 贴近目标后直接落到目标上，不拖一条很长的亚像素尾巴
    if (Math.abs(tx - this.fx) < 0.02) this.fx = tx; if (Math.abs(ty - this.fy) < 0.02) this.fy = ty;
    this.x = this.fx + this.ox; this.y = this.fy + this.oy; this.clamp();
  }
  /** 假设镜头中心在 (cx, cy) 时某个世界点的屏幕位置（用于"不含偏移"的判断） */
  toScreenAt(wx: number, wy: number, cx: number, cy: number): [number, number] {
    return [(wx - cx) * this.z + this.W * Camera.AX, (wy - cy) * this.z * Camera.KY + this.H * Camera.AY];
  }
  /** 到达地图边缘时限位（允许露出 40 单位的边缘装饰）。 */
  private clamp(): void {
    const M = 40, hw0 = (this.W * Camera.AX) / this.z, hw1 = (this.W * (1 - Camera.AX)) / this.z;
    const vz = this.z * Camera.KY, hh0 = (this.H * Camera.AY) / vz, hh1 = (this.H * (1 - Camera.AY)) / vz;
    const lim = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
    this.x = lim(this.x, -M + hw0, 1200 + M - hw1); this.y = lim(this.y, -M + hh0, 1200 + M - hh1);
    if (this.pixelSnap) { const qx = this.z * this.dpr, qy = qx * Camera.KY; this.x = Math.round(this.x * qx) / qx; this.y = Math.round(this.y * qy) / qy; }
  }
  toScreen(wx: number, wy: number, h = 0): [number, number] {
    return [(wx - this.x) * this.z + this.W * Camera.AX, (wy - this.y) * this.z * Camera.KY + this.H * Camera.AY - h * this.z];
  }
  /** 当前可见的世界范围 [x0,y0,x1,y1] */
  view(): [number, number, number, number] {
    const vz = this.z * Camera.KY;
    return [this.x - (this.W * Camera.AX) / this.z, this.y - (this.H * Camera.AY) / vz, this.x + (this.W * (1 - Camera.AX)) / this.z, this.y + (this.H * (1 - Camera.AY)) / vz];
  }
}

function tile(size: number, paint: (c: C, wrap: (fn: (ox: number, oy: number) => void) => void) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  paint(c, (fn) => { for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(ox, oy); });
  return cv;
}

export class Renderer {
  private ctx: C;
  private grass!: CanvasPattern; private stone!: CanvasPattern; private stoneMid!: CanvasPattern; private water!: CanvasPattern;
  private tufts: { x: number; y: number; k: number }[] = [];
  private pines: { x: number; y: number; seed: number }[] = [];
  private map: MapData;
  dpr = 1;
  /** ?debug=1 时显示塔的射程圈等调试标记；默认隐藏 */
  debug = false;
  /** 敌塔攻击范围边线（正式开启；?towerring=0 关） */
  towerRings = true;
  private waterSpan = 64; private waterPx = 256;
  private grass2!: CanvasPattern; private stone2!: CanvasPattern; private water2!: CanvasPattern;
  private scenery: Scenery | null = null;
  private river!: { water: Path2D; bank: Path2D; deep: Path2D };
  private slabs: { x: number; y: number; a: number; w: number; h: number; tone: number }[] = [];
  private pebbles: { x: number; y: number; r: number; tone: number }[] = [];
  private lilies: { x: number; y: number; r: number; a: number }[] = [];
  private reeds: { x: number; y: number; h: number; seed: number }[] = [];
  private edgeStones: { x: number; y: number; a: number; w: number; h: number; tone: number }[] = [];
  private bites: { x: number; y: number; r: number }[] = [];
  private blotches: { x: number; y: number; r: number; dark: boolean }[] = [];
  private stains: { x: number; y: number; r: number; moss: boolean }[] = [];

  constructor(private canvas: HTMLCanvasElement, private game: Game, private cam: Camera, private hud: Hud) {
    this.ctx = canvas.getContext('2d')!;
    this.map = game.map;
    this.loadFx();
    this.buildPatterns();
    this.secondLayers();
    this.buildRiver();
    this.buildDecor();
    this.buildBrushStyles();
  }

  private buildPatterns(): void {
    const c = this.ctx, R = rng(11);
    // 青绿植被
    const g = tile(256, (c, wrap) => {
      c.fillStyle = '#769a62'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 46; i++) {
        const x = R() * 256, y = R() * 256, r = 14 + R() * 30, col = R() < 0.5 ? 'rgba(170,175,95,.16)' : 'rgba(60,105,70,.13)';
        wrap((ox, oy) => { c.fillStyle = col; c.beginPath(); c.ellipse(x + ox, y + oy, r, r * 0.7, 0, 0, 7); c.fill(); });
      }
      c.lineCap = 'round';
      for (let i = 0; i < 260; i++) {
        const x = R() * 256, y = R() * 256, h = 3 + R() * 5;
        c.strokeStyle = R() < 0.5 ? 'rgba(175,200,120,.5)' : 'rgba(55,95,60,.45)'; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (R() - 0.5) * 3, y - h); c.stroke();
      }
    });
    // 浅灰石路
    const s = tile(256, (c) => {
      c.fillStyle = '#958f80'; c.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 4; row++) {
        let x = -R() * 60;
        while (x < 256) {
          const w = 44 + R() * 50, l = 186 + Math.floor(R() * 24);
          for (const ox of [0, 256]) {
            c.fillStyle = `rgb(${l + 2},${l - 2},${l - 13})`; c.beginPath(); c.roundRect(x + ox + 2, row * 64 + 2, w - 4, 60, 5); c.fill();
            c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(x + ox + 5, row * 64 + 4, w - 10, 3);
          }
          x += w;
        }
      }
    });
    // 蓝绿河水
    const w = tile(256, (c, wrap) => {
      c.fillStyle = '#2f7f86'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 22; i++) {
        const x = R() * 256, y = R() * 256, r = 20 + R() * 40;
        wrap((ox, oy) => { c.fillStyle = i % 2 ? 'rgba(20,70,90,.26)' : 'rgba(80,170,160,.22)'; c.beginPath(); c.ellipse(x + ox, y + oy, r, r * 0.6, 0, 0, 7); c.fill(); });
      }
      c.lineCap = 'round';
      for (let i = 0; i < 34; i++) {
        const x = R() * 256, y = R() * 256, l = 14 + R() * 26, b = (R() - 0.5) * 12;
        wrap((ox, oy) => { c.strokeStyle = 'rgba(205,245,235,.34)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x + ox, y + oy); c.quadraticCurveTo(x + ox + l / 2, y + oy + b, x + ox + l, y + oy); c.stroke(); });
      }
    });
    this.grass = c.createPattern(g, 'repeat')!; this.grass.setTransform(new DOMMatrix().scale(64 / 256));
    this.stone = c.createPattern(s, 'repeat')!; this.stone.setTransform(new DOMMatrix().scale(44 / 256));
    this.stoneMid = c.createPattern(s, 'repeat')!; this.stoneMid.setTransform(new DOMMatrix().rotate(-42).scale(44 / 256));
    this.water = c.createPattern(w, 'repeat')!;
  }

  /** 同一张贴图换个角度和比例再叠一层，打散重复感。 */
  private secondLayers(src?: Record<string, { img: HTMLImageElement; span: number }>): void {
    const c = this.ctx;
    const mk = (base: CanvasPattern, k: string, rot: number, mul: number, fallbackSpan: number, fallbackPx: number) => {
      if (!src?.[k]) { const p = base; void rot; void mul; void fallbackSpan; void fallbackPx; return p; }
      const p = c.createPattern(src[k].img, 'repeat')!; p.setTransform(new DOMMatrix().rotate(rot).scale((src[k].span * mul) / src[k].img.naturalWidth)); return p;
    };
    this.grass2 = mk(this.grass, 'grass', 31, 2.6, 64, 256);
    this.stone2 = mk(this.stone, 'stone', 17, 2.1, 44, 256);
    this.water2 = mk(this.water, 'water', 90, 1.7, 64, 256);
  }

  /** 河道：把等宽的直线河岸换成宽窄起伏的岸线；并在中路交汇处一屏范围内摆护岸石、卵石、睡莲、矮草。 */
  private buildRiver(): void {
    const m = this.map, R = rng(77), half = m.river.nominalWidth / 2;
    // Chaikin 两次，磨掉折角
    let cl = m.river.centerline.map((p) => [p[0], p[1]] as [number, number]);
    for (let it = 0; it < 2; it++) {
      const o: [number, number][] = [cl[0]];
      for (let i = 0; i < cl.length - 1; i++) { const a = cl[i], b = cl[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
      o.push(cl[cl.length - 1]); cl = o;
    }
    // 等距重采样
    const pts: { x: number; y: number; tx: number; ty: number; s: number }[] = [];
    let acc = 0;
    for (let i = 0; i < cl.length - 1; i++) {
      const dx = cl[i + 1][0] - cl[i][0], dy = cl[i + 1][1] - cl[i][1], L = Math.hypot(dx, dy);
      for (let t = 0; t < L; t += 9) pts.push({ x: cl[i][0] + (dx * t) / L, y: cl[i][1] + (dy * t) / L, tx: dx / L, ty: dy / L, s: acc + t });
      acc += L;
    }
    const wob = (s: number, ph: number) => 6.5 * Math.sin(s * 0.021 + ph) + 3.5 * Math.sin(s * 0.063 + ph * 2.3) + 1.6 * Math.sin(s * 0.17 + ph * 0.7);
    const side = (sign: number, ph: number, extra: number) => pts.map((p) => { const w = half + wob(p.s, ph) + extra + (extra ? 2.5 * Math.sin(p.s * 0.11 + ph * 3) : 0); return [p.x - p.ty * w * sign, p.y + p.tx * w * sign] as [number, number]; });
    const closed = (a: [number, number][], b: [number, number][]) => {
      const q = [...a, ...[...b].reverse()], path = new Path2D();
      path.moveTo((q[0][0] + q[q.length - 1][0]) / 2, (q[0][1] + q[q.length - 1][1]) / 2);
      for (let i = 0; i < q.length; i++) { const n = q[(i + 1) % q.length]; path.quadraticCurveTo(q[i][0], q[i][1], (q[i][0] + n[0]) / 2, (q[i][1] + n[1]) / 2); }
      path.closePath(); return path;
    };
    const wl = side(1, 0.7, 0), wr = side(-1, 4.1, 0);
    const deep = new Path2D(); deep.moveTo(pts[0].x, pts[0].y); for (const p of pts) deep.lineTo(p.x, p.y);
    this.river = { water: closed(wl, wr), bank: closed(side(1, 0.7, 10), side(-1, 4.1, 10)), deep };

    // —— 岸线布景：只铺中路交汇处一屏范围，避开石路、野区入口 ——
    const C: [number, number] = [600, 600], RAD = 330;
    const mid = m.lanes.mid, laneClear = (x: number, y: number, pad: number) => this.distToPolyline(x, y, mid.blueToRed) > mid.nominalWidth / 2 + pad;
    const entClear = (x: number, y: number) => m.jungleEntrances.every((e) => Math.hypot(e[0] - x, e[1] - y) > 26);
    for (const [bank, sign] of [[wl, 1], [wr, -1]] as [[number, number][], number][]) {
      let run = 0;
      for (let i = 2; i < bank.length - 2; i++) {
        const [x, y] = bank[i], p = pts[i];
        if (Math.hypot(x - C[0], y - C[1]) > RAD || !laneClear(x, y, 9)) { run = 0; continue; }
        const nx = -p.ty * sign, ny = p.tx * sign, ang = Math.atan2(bank[i + 1][1] - bank[i - 1][1], bank[i + 1][0] - bank[i - 1][0]);
        if (run === 0 && R() < 0.2) run = 2 + Math.floor(R() * 3);
        if (run > 0) {                                   // 断续护岸：2~4 块一段，段与段之间留缺口
          run--; if (entClear(x, y)) this.slabs.push({ x: x + nx * (1.5 + R() * 2), y: y + ny * (1.5 + R() * 2), a: ang + (R() - 0.5) * 0.25, w: 9 + R() * 4, h: 5.5 + R() * 2, tone: R() });
          continue;
        }
        const k = R();
        if (k < 0.34) this.reeds.push({ x: x + nx * (2 + R() * 5), y: y + ny * (2 + R() * 5), h: 5 + R() * 3.5, seed: i });
        else if (k < 0.62) for (let j = 0; j < 2; j++) this.pebbles.push({ x: x - nx * (3 + R() * 9) + (R() - 0.5) * 6, y: y - ny * (3 + R() * 9) + (R() - 0.5) * 6, r: 1.2 + R() * 1.8, tone: R() });
        else if (k < 0.76) this.lilies.push({ x: x - nx * (11 + R() * 10), y: y - ny * (11 + R() * 10), r: 2.6 + R() * 1.8, a: R() * 6.28 });
      }
    }
    // —— 中路两侧：散落的边石和啃进路面的草，打破笔直的路沿（跨河那一段留给石阶）——
    const lp = mid.blueToRed;
    for (let i = 1; i < lp.length; i++) {
      const dx = lp[i][0] - lp[i - 1][0], dy = lp[i][1] - lp[i - 1][1], L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      for (let t = 0; t < L; t += 7) for (const sgn of [1, -1]) {
        const ex = lp[i - 1][0] + (dx * t) / L - (dy / L) * sgn * (mid.nominalWidth / 2), ey = lp[i - 1][1] + (dy * t) / L + (dx / L) * sgn * (mid.nominalWidth / 2);
        if (Math.hypot(ex - C[0], ey - C[1]) > RAD || this.distToPolyline(ex, ey, m.river.centerline) < half + 12) continue;
        const ox = (-dy / L) * sgn, oy = (dx / L) * sgn, k = R();
        if (k < 0.42) { const d = R() * 9 - 1; this.edgeStones.push({ x: ex + ox * d, y: ey + oy * d, a: ang + (R() - 0.5) * 0.5, w: 4.5 + R() * 5, h: 3.5 + R() * 3, tone: R() }); }
        else if (k < 0.7) this.bites.push({ x: ex - ox * (R() * 2.5), y: ey - oy * (R() * 2.5), r: 2.2 + R() * 3 });
        if (R() < 0.1) this.stains.push({ x: ex - ox * (6 + R() * 30), y: ey - oy * (6 + R() * 30), r: 7 + R() * 12, moss: R() < 0.6 });
      }
    }
    // —— 大尺度明暗斑，盖住贴图的周期 ——
    const b = m.world.playableBounds;
    for (let i = 0; i < 170; i++) this.blotches.push({ x: b[0] + R() * (b[2] - b[0]), y: b[1] + R() * (b[3] - b[1]), r: 45 + R() * 80, dark: R() < 0.5 });
  }

  /** 每个单位的动作平滑状态（朝向、最近一次移动、跑步相位）和统计（翻面次数、跑/停切换次数） */
  actors = new Map<number, { face: number; moveT: number; phase: number; x: number; y: number; seen: number; flips: number; toggles: number; run: boolean }>();
  /** 技能特效与弹体贴图（assets/fx）。没加载到的继续用代码画的占位 */
  fx: Record<string, HTMLImageElement> = {};
  loadFx(base = 'assets/fx/'): void {
    for (const n of ['crescent', 'beacon', 'beacon-burst', 'triangle-edge', 'triangle-vertex', 'hero-bolt', 'tower-bolt-blue', 'tower-bolt-red']) { const i = new Image(); i.onload = () => { this.fx[n] = i; }; i.src = base + n + '.png'; }
  }
  private backdropImg: HTMLImageElement | null = null;
  private occImgs: Record<string, HTMLImageElement> = {};
  /** 载入布景：底图和遮挡片异步加载，加载完成前后都能正常渲染。 */
  setScenery(sc: Scenery, base = 'assets/scene/'): void {
    this.scenery = sc;
    const load = (f: string, done: (i: HTMLImageElement) => void) => { const i = new Image(); i.onload = () => done(i); i.src = base + f + '.png'; };
    if (sc.backdrop) load(sc.backdrop.file, (i) => { this.backdropImg = i; this.groundRev++; });
    for (const o of sc.occluders ?? []) load(o.file, (i) => { this.occImgs[o.id] = i; });
  }
  get sceneReady(): boolean { return !!this.scenery && (!this.scenery.backdrop || !!this.backdropImg) && (this.scenery.occluders ?? []).every((o) => this.occImgs[o.id]); }
  /** 点是否落在底图覆盖范围内（留出羽化边）。底图盖住的地方不再画程序化的岸线装饰。 */
  private underBackdrop(x: number, y: number, inset = 10): boolean {
    const r = this.backdropImg && this.scenery?.backdrop?.worldRect;
    return !!r && x > r[0] + inset && x < r[2] - inset && y > r[1] + inset && y < r[3] - inset;
  }

  /** 用素材包的可平铺贴图替换程序生成的地表。span = 一张贴图铺多少世界单位。 */
  useTiles(t: Record<string, { img: HTMLImageElement; span: number }>): void {
    this.groundRev++;
    const c = this.ctx, mk = (k: string, rot = 0) => { const p = c.createPattern(t[k].img, 'repeat')!; p.setTransform(new DOMMatrix().rotate(rot).scale(t[k].span / t[k].img.naturalWidth)); return p; };
    if (t.grass) this.grass = mk('grass');
    if (t.stone) { this.stone = mk('stone'); this.stoneMid = mk('stone', -42); }
    if (t.water) { this.water = c.createPattern(t.water.img, 'repeat')!; this.waterSpan = t.water.span; this.waterPx = t.water.img.naturalWidth; }
    this.secondLayers(t);
  }

  private distToPolyline(x: number, y: number, pts: [number, number][]): number {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
    }
    return best;
  }

  /** 不参与碰撞的装饰：界内草簇小花，界外松树。 */
  /** 每个能隐身的草丛的样式：离河道近的用"河边长条草"（沿河岸方向排开的高芦苇），其余用"野区紧凑草"（挤成一团的阔叶草）。判定范围不变，都是铺满 radius 的圆。 */
  brushStyle: { variant: number; dir: number }[] = [];
  private buildBrushStyles(): void {
    const cl = this.map.river.centerline as [number, number][], half = this.map.river.nominalWidth / 2;
    this.brushStyle = this.map.brush.map((b) => {
      let best = 1e9, dir = 0;
      for (let i = 0; i < cl.length - 1; i++) {
        const [ax, ay] = cl[i], [bx, by] = cl[i + 1], vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
        const k = Math.max(0, Math.min(1, ((b.center[0] - ax) * vx + (b.center[1] - ay) * vy) / L2)), d = Math.hypot(b.center[0] - ax - vx * k, b.center[1] - ay - vy * k);
        if (d < best) { best = d; dir = Math.atan2(vy * Camera.KY, vx); }
      }
      return best < half + b.radius + 26 ? { variant: 1, dir } : { variant: 2, dir: 0 };
    });
  }

  private buildDecor(): void {
    const m = this.map, R = rng(2024), b = m.world.playableBounds;
    const onGround = (x: number, y: number) =>
      LANES.every((l) => this.distToPolyline(x, y, m.lanes[l].blueToRed) > m.lanes[l].nominalWidth / 2 + 5) &&
      this.distToPolyline(x, y, m.river.centerline) > m.river.nominalWidth / 2 + 6 &&
      m.staticObstacles.every((o) => Math.hypot(x - o.center[0], y - o.center[1]) > o.radius + 3) &&
      m.neutralObjectives.every((o) => Math.hypot(x - o.center[0], y - o.center[1]) > o.radius + 4) &&
      TEAMS.every((t) => Math.hypot(x - m.teams[t].core[0], y - m.teams[t].core[1]) > 80);
    for (let i = 0; i < 1500; i++) {
      const x = b[0] + R() * (b[2] - b[0]), y = b[1] + R() * (b[3] - b[1]);
      if (onGround(x, y)) this.tufts.push({ x, y, k: Math.floor(R() * 5) });
    }
    for (let i = 0; i < 230; i++) {
      const x = -30 + R() * 1260, y = -30 + R() * 1260;
      // 南侧的树会挡住近处的路面和 HUD，只留在足够靠外的位置
      if (x > b[0] - 12 && x < b[2] + 12 && y > b[1] - 12 && y < b[3] + 72) continue;
      this.pines.push({ x, y, seed: i * 7 + 3 });
    }
  }

  // ------------------------------------------------------------------ 主绘制
  /** three.js 渲染层；为 null 时整帧用 Canvas 2D 画（原来的路径） */
  three: ThreeLayer | null = null;
  private gcv: HTMLCanvasElement | null = null;
  private baked = new Map<string, { cv: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null>();
  private bakedPpu = 0;

  /** 地面内容变了就加一（底图加载完、换地表贴图），地面瓦片随之重烘 */
  groundRev = 0;
  /** ?ground=live：three.js 下地面仍每帧重画整屏（v12 的做法，只用于对比） */
  liveGround = false;
  private tiles = new Map<string, { cv: HTMLCanvasElement; used: number }>();
  private tileSig = '';
  private frameNo = 0;
  /** 性能统计（帧率显示和测试用）：本帧烘了几块地面瓦片、缓存里有几块、上传的动态纹理像素数 */
  perf = { baked: 0, tiles: 0, uploadPx: 0, bakedTotal: 0 };

  /** three.js 路径。
   *  · 地面（地表、河道、道路、底图）是静态的：按 256 设备像素一块烘成瓦片，贴在世界里随镜头移动，只在第一次进入视野时画一次、上传一次。
   *  · 贴地的提示和特效（脚环、技能范围、星标、草丛）每帧画到一张透明画布，分辨率上限 1.5 倍，作为一张贴图叠在地面上。
   *  · 立体层（岩石、树、塔、基地、单位、星盘）逐件作为贴图片提交；弹体、血条、名字和 HUD 画在最上层的 2D 画布上。 */
  private drawThree(now: number): void {
    const top = this.ctx, cam = this.cam, d = this.dpr, z = cam.z, KY = Camera.KY, T3 = this.three!, perf = this.perf;
    perf.baked = 0; perf.uploadPx = 0; this.frameNo++;
    T3.begin();
    if (!this.gcv) this.gcv = document.createElement('canvas');
    const g = this.gcv;
    if (this.liveGround) {
      if (g.width !== this.canvas.width || g.height !== this.canvas.height) { g.width = this.canvas.width; g.height = this.canvas.height; }
      const gx = g.getContext('2d')!; this.ctx = gx;
      try {
        gx.setTransform(1, 0, 0, 1, 0, 0); gx.fillStyle = '#1c2a22'; gx.fillRect(0, 0, g.width, g.height);
        gx.setTransform(d * z, 0, 0, d * z * KY, d * (cam.W * Camera.AX - cam.x * z), d * (cam.H * Camera.AY - cam.y * z * KY));
        this.drawGround(now); this.drawGroundFx();
        gx.setTransform(d, 0, 0, d, 0, 0); this.drawTufts(now);
      } finally { this.ctx = top; }
      T3.touch(g); T3.quad(g, 0, 0, cam.W, cam.H); perf.uploadPx = g.width * g.height;
    } else {
      // —— 静态地面瓦片 ——
      const TP = 256, px = d * z, py = d * z * KY, tw = TP / px, th = TP / py, sig = `${px.toFixed(4)}|${this.groundRev}`;
      if (sig !== this.tileSig) { for (const t of this.tiles.values()) T3.drop(t.cv); this.tiles.clear(); this.tileSig = sig; }
      const v = cam.view(), i0 = Math.floor(v[0] / tw), i1 = Math.floor(v[2] / tw), j0 = Math.floor(v[1] / th), j1 = Math.floor(v[3] / th);
      const bakeTile = (i: number, j: number) => {
        const cv = document.createElement('canvas'); cv.width = cv.height = TP + 2;                 // 四周多烘 1 像素，相邻瓦片互相压住，不露缝
        const c = cv.getContext('2d')!; this.ctx = c;
        try {
          c.fillStyle = '#1c2a22'; c.fillRect(0, 0, TP + 2, TP + 2);
          c.setTransform(px, 0, 0, py, 1 - i * TP, 1 - j * TP);
          this.drawGround(0, [i * tw - 2, j * th - 2, (i + 1) * tw + 2, (j + 1) * th + 2]);
        } finally { this.ctx = top; }
        perf.baked++; perf.bakedTotal++;
        const t = { cv, used: this.frameNo }; this.tiles.set(i + ',' + j, t); return t;
      };
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const t = this.tiles.get(i + ',' + j) ?? bakeTile(i, j); t.used = this.frameNo;
        const [sx, sy] = cam.toScreen(i * tw, j * th);
        T3.quad(t.cv, sx - 1 / d, sy - 1 / d, (TP + 2) / d, (TP + 2) / d);
      }
      // 视野外两圈提前烘好，每帧最多一块（先近后远），走动时进视野的瓦片都已经备好
      if (!perf.baked) ring: for (const k of [1, 2]) for (let j = j0 - k; j <= j1 + k; j++) for (let i = i0 - k; i <= i1 + k; i++) if (!this.tiles.has(i + ',' + j)) { bakeTile(i, j); break ring; }
      if (this.tiles.size > 220) { const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.tiles.size - 170); for (const [k, t] of old) { T3.drop(t.cv); this.tiles.delete(k); } }
      perf.tiles = this.tiles.size;
      // —— 贴地的提示与特效：透明画布，分辨率上限 1.5 倍 ——
      const fd = Math.min(d, 1.5), fw = Math.round(cam.W * fd), fh = Math.round(cam.H * fd);
      if (g.width !== fw || g.height !== fh) { g.width = fw; g.height = fh; }
      const gx = g.getContext('2d')!; this.ctx = gx;
      try {
        gx.setTransform(1, 0, 0, 1, 0, 0); gx.clearRect(0, 0, fw, fh);
        gx.setTransform(fd * z, 0, 0, fd * z * KY, fd * (cam.W * Camera.AX - cam.x * z), fd * (cam.H * Camera.AY - cam.y * z * KY));
        this.drawGroundFx();
        gx.setTransform(fd, 0, 0, fd, 0, 0); this.drawTufts(now);
      } finally { this.ctx = top; }
      T3.touch(g); T3.quad(g, 0, 0, cam.W, cam.H); perf.uploadPx = fw * fh;
    }
    top.setTransform(1, 0, 0, 1, 0, 0); top.clearRect(0, 0, this.canvas.width, this.canvas.height);
    top.setTransform(d, 0, 0, d, 0, 0);
    this.drawUpright(now);
    this.drawOverlays();
    T3.end();
  }

  /** 把一个静态贴图函数（岩石、树、塔、基地……）画到小画布上并裁到实际轮廓，之后每帧只是一张贴图片 */
  private bake(key: string, st: SpriteState, ppu: number): { cv: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
    if (Math.abs(ppu - this.bakedPpu) > 0.01) { for (const b of this.baked.values()) if (b) this.three?.drop(b.cv); this.baked.clear(); this.bakedPpu = ppu; }
    const id = `${key}|${st.team}|${st.seed}|${st.r ?? ''}|${st.h ?? ''}|${st.variant ?? ''}|${st.dead ? 1 : 0}|${st.locked ? 1 : 0}|${st.face}`;
    let b = this.baked.get(id);
    if (b !== undefined) return b;
    const L = 90, R = 90, U = 150, D = 50, W = Math.ceil((L + R) * ppu), H = Math.ceil((U + D) * ppu);     // 世界单位的画幅，足够放下基地
    const big = document.createElement('canvas'); big.width = W; big.height = H;
    const c = big.getContext('2d', { willReadFrequently: true })!;
    c.translate(L * ppu, U * ppu); c.scale(ppu, ppu); Sprites[key](c, st);
    const a = c.getImageData(0, 0, W, H).data; let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0, i = y * W * 4 + 3; x < W; x++, i += 4) if (a[i] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) b = null;
    else {
      const cv = document.createElement('canvas'); cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1; cv.getContext('2d')!.drawImage(big, -x0, -y0);
      b = { cv, x: x0 / ppu - L, y: y0 / ppu - U, w: cv.width / ppu, h: cv.height / ppu };
    }
    this.baked.set(id, b); return b;
  }

  draw(now: number): void {
    if (this.three) { this.drawThree(now); return; }
    const { ctx, cam, game } = this, d = this.dpr, z = cam.z, KY = Camera.KY;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1c2a22'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // —— 地面层：直接用世界坐标 ——
    ctx.setTransform(d * z, 0, 0, d * z * KY, d * (cam.W * Camera.AX - cam.x * z), d * (cam.H * Camera.AY - cam.y * z * KY));
    this.drawGround(now);
    this.drawGroundFx();
    // —— 立体层：CSS 像素坐标 ——
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.drawTufts(now);
    this.drawUpright(now);
    this.drawOverlays();
  }

  private line(pts: [number, number][]): void {
    const c = this.ctx; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  }

  private drawGround(now: number, v: [number, number, number, number] = this.cam.view()): void {
    const c = this.ctx, m = this.map, b = m.world.playableBounds;
    const vis = (x: number, y: number, pad: number) => x > v[0] - pad && x < v[2] + pad && y > v[1] - pad && y < v[3] + pad;
    c.lineJoin = 'round'; c.lineCap = 'round';
    // —— 草地：主贴图 + 换角度的大比例叠层 + 大尺度明暗斑 ——
    c.fillStyle = this.grass; c.fillRect(-120, -120, 1440, 1440);
    c.globalAlpha = 0.38; c.fillStyle = this.grass2; c.fillRect(-120, -120, 1440, 1440); c.globalAlpha = 1;
    for (const o of this.blotches) {
      if (!vis(o.x, o.y, o.r)) continue;
      const g = c.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r), col = o.dark ? '40,70,35' : '190,185,95';
      g.addColorStop(0, `rgba(${col},.2)`); g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g; c.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    }
    // 界外压暗 + 石质边界
    c.fillStyle = 'rgba(24,40,30,.62)'; c.beginPath(); c.rect(-120, -120, 1440, 1440); c.roundRect(b[0], b[1], b[2] - b[0], b[3] - b[1], 26); c.fill('evenodd');
    c.strokeStyle = '#8d8a7a'; c.lineWidth = 6; c.beginPath(); c.roundRect(b[0] - 3, b[1] - 3, b[2] - b[0] + 6, b[3] - b[1] + 6, 28); c.stroke();
    c.strokeStyle = 'rgba(217,182,92,.7)'; c.lineWidth = 1; c.stroke();
    // —— 河道（不阻挡移动）：泥岸 → 水面两层 → 浅滩亮边 → 河心加深 ——
    const sp = this.waterSpan;
    this.water.setTransform(new DOMMatrix().translate((now * 3) % sp, (now * 1.4) % sp).scale(sp / this.waterPx));
    this.water2.setTransform(new DOMMatrix().translate(-(now * 1.7) % (sp * 1.7), (now * 2.2) % (sp * 1.7)).rotate(90).scale((sp * 1.7) / this.waterPx));
    c.fillStyle = '#8c8660'; c.fill(this.river.bank);
    c.fillStyle = '#8c8660'; for (const o of m.neutralObjectives) { c.beginPath(); c.arc(o.center[0], o.center[1], o.radius + 7, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(70,62,40,.35)'; c.lineWidth = 1.2; c.stroke(this.river.bank);
    c.fillStyle = this.water; c.fill(this.river.water); for (const o of m.neutralObjectives) { c.beginPath(); c.arc(o.center[0], o.center[1], o.radius, 0, 7); c.fill(); }
    c.globalAlpha = 0.4; c.fillStyle = this.water2; c.fill(this.river.water); c.globalAlpha = 1;
    c.save(); c.clip(this.river.water);
    c.strokeStyle = 'rgba(190,235,215,.38)'; c.lineWidth = 14; c.stroke(this.river.water);       // 浅滩
    c.strokeStyle = 'rgba(235,250,240,.5)'; c.lineWidth = 2.2; c.stroke(this.river.water);        // 水线
    c.strokeStyle = 'rgba(8,60,75,.2)'; c.lineWidth = 40; c.stroke(this.river.deep); c.lineWidth = 22; c.stroke(this.river.deep);
    c.restore();
    for (const o of this.pebbles) { if (!vis(o.x, o.y, 4) || this.underBackdrop(o.x, o.y)) continue; const l = 150 + o.tone * 60; c.fillStyle = `rgba(${l},${l - 6},${l - 22},.85)`; c.beginPath(); c.ellipse(o.x, o.y, o.r, o.r * 0.8, o.tone * 3, 0, 7); c.fill(); }
    for (const o of this.lilies) {
      if (!vis(o.x, o.y, 6) || this.underBackdrop(o.x, o.y)) continue;
      c.fillStyle = '#5f9a4a'; c.beginPath(); c.moveTo(o.x, o.y); c.arc(o.x, o.y, o.r, o.a + 0.35, o.a + 6.0); c.closePath(); c.fill();
      c.fillStyle = 'rgba(150,200,110,.6)'; c.beginPath(); c.arc(o.x - o.r * 0.2, o.y - o.r * 0.2, o.r * 0.45, 0, 7); c.fill();
    }
    // 野区营地：首版只画空地（野怪未实装）
    for (const o of m.jungleCamps) {
      c.fillStyle = 'rgba(205,200,170,.38)'; c.beginPath(); c.arc(o.center[0], o.center[1], o.radius, 0, 7); c.fill();
    }
    // —— 三路石路：土质路肩 → 路沿 → 石板两层 ——
    for (const pass of [0, 1, 2, 3])
      for (const l of LANES) {
        const L = m.lanes[l];
        if (pass === 0) { c.strokeStyle = 'rgba(112,98,66,.42)'; c.lineWidth = L.nominalWidth + 18; }
        else if (pass === 1) { c.strokeStyle = '#7f7d6c'; c.lineWidth = L.nominalWidth + 5; }
        else if (pass === 2) { c.strokeStyle = l === 'mid' ? this.stoneMid : this.stone; c.lineWidth = L.nominalWidth; }
        else { c.globalAlpha = 0.3; c.strokeStyle = this.stone2; c.lineWidth = L.nominalWidth; }
        this.line(L.blueToRed); c.stroke(); c.globalAlpha = 1;
      }
    for (const o of this.stains) { if (!vis(o.x, o.y, o.r)) continue; const g = c.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r), col = o.moss ? '95,120,60' : '70,58,40'; g.addColorStop(0, `rgba(${col},.26)`); g.addColorStop(1, `rgba(${col},0)`); c.fillStyle = g; c.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); }
    if (!this.backdropImg) this.drawCrossing();
    // 路沿：啃进来的草、散落的边石
    for (const o of this.bites) { if (!vis(o.x, o.y, 8) || this.underBackdrop(o.x, o.y)) continue; c.fillStyle = this.grass; c.beginPath(); c.ellipse(o.x, o.y, o.r * 1.5, o.r * 0.7, o.x, 0, 7); c.fill(); }
    const slab = (o: { x: number; y: number; a: number; w: number; h: number; tone: number }, lift: number) => {
      c.save(); c.translate(o.x, o.y); c.rotate(o.a);
      const l = 164 + Math.floor(o.tone * 34);
      c.fillStyle = 'rgba(40,38,28,.35)'; c.beginPath(); c.roundRect(-o.w / 2 + 0.6, -o.h / 2 + lift, o.w, o.h, 1.6); c.fill();   // 很薄的侧面：看得出是贴地的矮石
      c.fillStyle = `rgb(${l + 8},${l - 2},${l - 20})`; c.beginPath(); c.roundRect(-o.w / 2, -o.h / 2, o.w, o.h, 1.6); c.fill();
      c.fillStyle = 'rgba(255,255,255,.2)'; c.fillRect(-o.w / 2 + 1, -o.h / 2 + 0.7, o.w - 2, 0.9);
      c.restore();
    };
    for (const o of this.edgeStones) if (vis(o.x, o.y, 10) && !this.underBackdrop(o.x, o.y)) slab(o, 0.9);
    for (const o of this.slabs) if (vis(o.x, o.y, 12) && !this.underBackdrop(o.x, o.y)) slab(o, 1.6);
    // —— 中路河口底图：它已经带斜俯视投影，所以把高度除以 ky 再交给地面变换，净效果是原样贴上去，不会被二次压缩 ——
    const bd = this.scenery?.backdrop;
    if (bd && this.backdropImg) {
      const x0 = bd.anchorWorld[0] - bd.anchorPx[0] / bd.pxPerUnit, y0 = bd.anchorWorld[1] - bd.anchorPx[1] / (bd.pxPerUnit * Camera.KY);
      c.drawImage(this.backdropImg, x0, y0, bd.size[0] / bd.pxPerUnit, bd.size[1] / (bd.pxPerUnit * Camera.KY));
    }
    // 基地广场
    for (const t of TEAMS) {
      const [x, y] = m.teams[t].core;
      if (!vis(x, y, 90)) continue;
      c.fillStyle = '#7f7d6c'; c.beginPath(); c.arc(x, y, 74, 0, 7); c.fill();
      c.fillStyle = this.stone; c.beginPath(); c.arc(x, y, 70, 0, 7); c.fill();
      c.strokeStyle = TEAM[t].main; c.globalAlpha = 0.55; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 58, 0, 7); c.stroke(); c.globalAlpha = 1;
      c.strokeStyle = 'rgba(217,182,92,.8)'; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 63, 0, 7); c.stroke();
      const [sx, sy] = m.teams[t].heroSpawn;
      c.fillStyle = TEAM[t].glow + '.14)'; c.beginPath(); c.arc(sx, sy, this.game.rules.bots.baseHealRadius, 0, 7); c.fill();
    }
    // 草丛地面、建筑和布景物件的接地影（会挡路的东西都有一圈深色接地影）
    for (const br of m.brush) { c.fillStyle = 'rgba(45,85,50,.5)'; c.beginPath(); c.arc(br.center[0], br.center[1], br.radius, 0, 7); c.fill(); }
    for (const t of this.game.towers) { c.fillStyle = 'rgba(40,45,35,.28)'; c.beginPath(); c.arc(t.x, t.y + 2, 21 * Camera.STRUCT_SCALE, 0, 7); c.fill(); }
  }

  /** 中路跨河处：罗盘纹、两侧下到水里的石阶和四角的桥头石。都是贴地的，可以走。 */
  private drawCrossing(): void {
    const c = this.ctx, lane = this.map.lanes.mid.nominalWidth / 2;
    c.save(); c.translate(600, 600); c.rotate(Math.atan2(-0.68, 0.733));       // x 轴沿中路朝红方，y 轴沿河道朝下游
    for (const sgn of [1, -1]) {
      for (let i = 2; i >= 0; i--) {                                             // 三级石阶，越往外越深
        const y0 = sgn * (lane + i * 6.2), len = 60 - i * 5;
        c.fillStyle = this.stone; c.fillRect(-len / 2, Math.min(y0, y0 + sgn * 6.2), len, 6.2);
        c.fillStyle = `rgba(20,95,100,${0.12 + i * 0.2})`; c.fillRect(-len / 2, Math.min(y0, y0 + sgn * 6.2), len, 6.2);
        c.fillStyle = 'rgba(40,36,26,.55)'; c.fillRect(-len / 2, y0 - (sgn > 0 ? 0 : 0.9), len, 0.9);                 // 踏步前沿
        c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(-len / 2, y0 + sgn * 1.1 - 0.4, len, 0.6);
      }
      for (const x of [-37, 37]) {                                                // 桥头石
        c.fillStyle = 'rgba(40,38,28,.4)'; c.beginPath(); c.roundRect(x - 5, sgn * (lane + 1) - 4.2, 11, 10, 1.5); c.fill();
        c.fillStyle = '#c9c0a8'; c.beginPath(); c.roundRect(x - 5.5, sgn * (lane + 1) - 5.5, 11, 10, 1.5); c.fill();
        c.strokeStyle = 'rgba(217,182,92,.8)'; c.lineWidth = 0.8; c.strokeRect(x - 3.2, sgn * (lane + 1) - 3.2, 6.4, 5.4);
      }
    }
    c.rotate(-Math.atan2(-0.68, 0.733));
    c.strokeStyle = 'rgba(217,182,92,.6)'; c.fillStyle = 'rgba(217,182,92,.28)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(0, 0, 26, 0, 7); c.stroke(); c.beginPath(); c.arc(0, 0, 20, 0, 7); c.stroke();
    c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? 9 : 24; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); const a2 = a + Math.PI / 8; c.lineTo(Math.cos(a2) * 4.5, Math.sin(a2) * 4.5); } c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  private see(u: Unit): boolean { return u.alive && this.game.visible(u, 'blue'); }

  /** 贴地的提示与特效：塔射程、脚底环、星标、技能瞄准、命中范围。 */
  private drawGroundFx(): void {
    const c = this.ctx, g = this.game, p = g.player, S = g.rules.xingli.skills, T = g.time, US = Math.max(0.75, Camera.UNIT_SCALE);
    // 敌方塔的攻击范围：玩家靠近（射程外 70 单位以内）时显示低透明度的贴地细边线，进入射程后提亮。
    // 半径直接用攻击判定的 t.range；不管塔当前打的是谁（小兵扛塔时也显示）。只画边线不填色，和技能瞄准范围叠在一起时不糊。
    // 被锁定的提示仍是脚下红环 / 屏边箭头。?debug=1 时额外加淡填充。
    if (this.towerRings) for (const t of g.towers) {
      if (!t.alive || t.team === p.team || !p.alive) continue;
      const dist = Math.hypot(t.x - p.x, t.y - p.y);
      if (dist > t.range + 70) continue;
      const inside = dist <= t.range, near = inside ? 1 : 1 - (dist - t.range) / 70;                     // 由远及近淡入
      if (this.debug) { c.fillStyle = t.target === p ? 'rgba(255,70,50,.16)' : 'rgba(255,120,90,.07)'; c.beginPath(); c.arc(t.x, t.y, t.range, 0, 7); c.fill(); }
      c.beginPath(); c.arc(t.x, t.y, t.range, 0, 7);
      c.strokeStyle = `rgba(40,10,6,${(inside ? 0.3 : 0.16) * near})`; c.lineWidth = inside ? 2.1 : 1.6; c.stroke();     // 深色衬底：亮地面上也看得见
      c.strokeStyle = inside ? 'rgba(255,96,72,.9)' : `rgba(255,150,120,${0.42 * near})`; c.lineWidth = inside ? 1.2 : 0.8; c.stroke();
    }
    // 影子与阵营脚环
    for (const m of g.minions) if (this.see(m)) { c.fillStyle = 'rgba(10,40,40,.3)'; c.beginPath(); c.arc(m.x, m.y, 6.5 * US, 0, 7); c.fill(); }
    for (const h of g.heroes) {
      if (!this.see(h)) continue;
      c.fillStyle = 'rgba(10,40,40,.34)'; c.beginPath(); c.arc(h.x, h.y, 10 * US, 0, 7); c.fill();
      c.strokeStyle = h.isPlayer ? '#8dffb0' : TEAM[h.team].main; c.lineWidth = h.isPlayer ? 2.2 : 1.8;
      c.beginPath(); c.arc(h.x, h.y, 13 * US, 0, 7); c.stroke();
      if (h.isPlayer) { const a = Math.atan2(h.faceY, h.faceX); c.fillStyle = '#8dffb0'; c.beginPath(); c.moveTo(h.x + Math.cos(a) * 20 * US, h.y + Math.sin(a) * 20 * US); c.lineTo(h.x + Math.cos(a + 0.35) * 14.5 * US, h.y + Math.sin(a + 0.35) * 14.5 * US); c.lineTo(h.x + Math.cos(a - 0.35) * 14.5 * US, h.y + Math.sin(a - 0.35) * 14.5 * US); c.fill(); }
      // 敌塔锁定：玩家脚下细红环（常亮），锁定瞬间外圈提亮一下
      const lk = h.isPlayer ? this.hud.rig?.lock : null;
      if (lk && (lk.alpha > 0.01 || lk.flash > 0.01)) {
        if (lk.alpha > 0.01) { c.strokeStyle = `rgba(255,62,46,${0.95 * lk.alpha})`; c.lineWidth = 1.1; c.beginPath(); c.arc(h.x, h.y, 16.5 * US, 0, 7); c.stroke(); }
        if (lk.flash > 0.01 && lk.mode === 'ring') { const k = 1 - lk.flash; c.strokeStyle = `rgba(255,150,120,${lk.flash})`; c.lineWidth = 3.2 * lk.flash + 0.8; c.beginPath(); c.arc(h.x, h.y, (16.5 + 9 * k) * US, 0, 7); c.stroke(); c.fillStyle = `rgba(255,70,50,${0.22 * lk.flash})`; c.beginPath(); c.arc(h.x, h.y, 16.5 * US, 0, 7); c.fill(); }
      }
      if (T < h.rootUntil) { c.strokeStyle = 'rgba(255,233,168,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(h.x, h.y, 17 * US, 0, 7); c.stroke(); }
    }
    // 星标
    if (g.marks.length === 2) { c.strokeStyle = 'rgba(255,233,168,.6)'; c.lineWidth = 1.2; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(g.marks[0].x, g.marks[0].y); c.lineTo(g.marks[1].x, g.marks[1].y); c.stroke(); c.setLineDash([]); }
    for (const m of g.marks) {
      const life = (m.expire - T) / S[1].markLifetimeSeconds, pulse = 1 + Math.sin(T * 5) * 0.08;
      c.fillStyle = 'rgba(255,225,150,.2)'; c.beginPath(); c.arc(m.x, m.y, 11 * pulse, 0, 7); c.fill();
      c.strokeStyle = '#ffe9a8'; c.lineWidth = 1.6; c.beginPath(); c.arc(m.x, m.y, 11, -Math.PI / 2, -Math.PI / 2 + life * Math.PI * 2); c.stroke();
      if (this.fx.beacon) { const sz = 30 * pulse; c.save(); c.translate(m.x, m.y); c.rotate(T * 0.5); c.drawImage(this.fx.beacon, -sz / 2, -sz / 2, sz, sz); c.restore(); }
      else {
        c.fillStyle = '#fff3c4'; c.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + T * 0.8, r = i % 2 ? 2.4 : 7.5; c.lineTo(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r); }
        c.closePath(); c.fill();
      }
    }
    // 事件特效
    for (const e of g.events) {
      const age = T - e.t;
      if (e.type === 'beacon' && age < 0.45) {
        const k = age / 0.45, burst = this.fx['beacon-burst'];
        if (burst) { const fw = burst.naturalWidth / 4, sz = e.r * 2.5; c.drawImage(burst, Math.min(3, Math.floor(k * 4)) * fw, 0, fw, burst.naturalHeight, e.x - sz / 2, e.y - sz / 2, sz, sz); }
        else { c.fillStyle = `rgba(255,225,150,${0.3 * (1 - k)})`; c.beginPath(); c.arc(e.x, e.y, e.r, 0, 7); c.fill(); }
        c.strokeStyle = `rgba(255,240,200,${0.8 * (1 - k)})`; c.lineWidth = 1.5; c.beginPath(); c.arc(e.x, e.y, e.r, 0, 7); c.stroke();   // 实际判定范围
      } else if (e.type === 'triangle' && age < 0.75) {
        const k = age / 0.75;
        c.beginPath(); c.moveTo(e.pts[0][0], e.pts[0][1]); c.lineTo(e.pts[1][0], e.pts[1][1]); c.lineTo(e.pts[2][0], e.pts[2][1]); c.closePath();
        c.fillStyle = `rgba(150,235,255,${0.36 * (1 - k)})`; c.fill();
        const edge = this.fx['triangle-edge'], vert = this.fx['triangle-vertex'];
        if (edge && vert) {
          c.globalAlpha = 1 - k * k;
          for (let i = 0; i < 3; i++) {
            const a = e.pts[i], b = e.pts[(i + 1) % 3], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            c.save(); c.translate(a[0], a[1]); c.rotate(Math.atan2(b[1] - a[1], b[0] - a[0])); c.drawImage(edge, 0, -7, L, 14); c.restore();
          }
          const vs = 26 + 10 * (1 - k);
          for (const v of e.pts) c.drawImage(vert, v[0] - vs / 2, v[1] - vs / 2, vs, vs);
          c.globalAlpha = 1;
        } else { c.strokeStyle = `rgba(255,233,168,${1 - k})`; c.lineWidth = 3; c.stroke(); }
      } else if ((e.type === 'towerDown' || e.type === 'coreDown') && age < 0.9) {
        const k = age / 0.9; c.strokeStyle = `rgba(255,255,255,${1 - k})`; c.lineWidth = 4; c.beginPath(); c.arc(e.x, e.y, 20 + k * 90, 0, 7); c.stroke();
      } else if ((e.type === 'heroDown' || e.type === 'respawn') && age < 0.6) {
        const k = age / 0.6; c.strokeStyle = TEAM[e.team as Team].glow + (1 - k) + ')'; c.lineWidth = 3; c.beginPath(); c.arc(e.x, e.y, 8 + k * 30, 0, 7); c.stroke();
      }
    }
    // 弦月
    if (!this.fx.crescent) for (const cr of g.crescents) {
      c.save(); c.translate(cr.x, cr.y); c.rotate(Math.atan2(cr.dy, cr.dx));
      c.fillStyle = 'rgba(190,240,255,.9)'; c.beginPath(); c.arc(-6, 0, S[0].width / 2 + 3, -1.25, 1.25); c.arc(-13, 0, S[0].width / 2 + 1, 1.0, -1.0, true); c.closePath(); c.fill();
      c.fillStyle = 'rgba(150,220,255,.25)'; c.fillRect(-40, -S[0].width / 2, 34, S[0].width);
      c.restore();
    }
    // 技能瞄准提示（按住显示范围）
    const aim = this.hud.aim;
    if (aim && p.alive) {
      const w = this.hud.aimWorld(aim), bad = aim.cancel || !w.ok;
      const col = bad ? '255,110,90' : '140,230,255';
      if (aim.i === 0) {
        c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(w.dy, w.dx));
        c.fillStyle = `rgba(${col},.26)`; c.fillRect(0, -S[0].width / 2, S[0].range, S[0].width);
        c.strokeStyle = `rgba(${col},.9)`; c.lineWidth = 1.5; c.strokeRect(0, -S[0].width / 2, S[0].range, S[0].width);
        c.fillStyle = `rgba(${col},.9)`; c.beginPath(); c.moveTo(S[0].range + 12, 0); c.lineTo(S[0].range, -S[0].width / 2 - 3); c.lineTo(S[0].range, S[0].width / 2 + 3); c.fill();
        c.restore();
      } else {
        const range = S[aim.i].castRange;
        c.strokeStyle = `rgba(${col},.75)`; c.lineWidth = 1.6; c.fillStyle = `rgba(${col},.06)`;
        c.beginPath(); c.arc(p.x, p.y, range, 0, 7); c.fill(); c.stroke();
        if (aim.i === 1) { c.fillStyle = `rgba(${col},.3)`; c.beginPath(); c.arc(w.x, w.y, S[1].radius, 0, 7); c.fill(); c.stroke(); }
        else {
          if (g.marks.length === 2) { c.beginPath(); c.moveTo(g.marks[0].x, g.marks[0].y); c.lineTo(g.marks[1].x, g.marks[1].y); c.lineTo(w.x, w.y); c.closePath(); c.fillStyle = `rgba(${col},.3)`; c.fill(); c.lineWidth = 2; c.stroke(); }
          c.fillStyle = `rgba(${col},.95)`; c.beginPath(); c.arc(w.x, w.y, 5, 0, 7); c.fill();
        }
      }
    }
  }

  private inView(x: number, y: number, pad: number): boolean {
    const v = this.cam.view(); return x > v[0] - pad && x < v[2] + pad && y > v[1] - pad && y < v[3] + pad * 2.2;
  }

  private drawTufts(now: number): void {
    const c = this.ctx, z = this.cam.z;
    const cols = ['#4c7f4a', '#9dbb72', '#f4f1e4', '#cfd8f0', '#ecd9a0'];
    for (let k = 0; k < 5; k++) {
      c.strokeStyle = c.fillStyle = cols[k]; c.lineWidth = Math.max(1, z * 0.5); c.lineCap = 'round'; c.beginPath();
      for (const t of this.tufts) {
        if (t.k !== k || !this.inView(t.x, t.y, 8)) continue;
        const [x, y] = this.cam.toScreen(t.x, t.y);
        if (k < 2) for (const dx of [-1.6, 0, 1.6]) { c.moveTo(x + dx * z, y); c.lineTo(x + dx * z * 1.8 + Math.sin(now * 1.5 + t.x) * z * 0.4, y - (3.5 + Math.abs(dx)) * z); }
        else { c.moveTo(x + z * 0.9, y - z * 1.6); c.arc(x, y - z * 1.6, z * 0.9, 0, 7); }
      }
      if (k < 2) c.stroke(); else c.fill();
    }
  }

  private sprite(key: string, wx: number, wy: number, st: Partial<SpriteState> & { team: Team }, alpha = 1, scale = 1): void {
    const c = this.ctx, [sx, sy] = this.cam.toScreen(wx, wy);
    if (this.three) {
      const S = this.cam.z * scale, full: SpriteState = { t: this.game.time, face: 1, moving: false, atk: 9, seed: 0, ky: Camera.KY, ...st }, f = full.face;
      const qs = animQuads(key, full);
      if (qs) { for (const q of qs) this.three.quad(q.img, f > 0 ? sx + q.x * S : sx - (q.x + q.w) * S, sy + q.y * S, q.w * S, q.h * S, f > 0 ? q.u0 : q.u1, f > 0 ? q.u1 : q.u0, alpha * q.alpha); return; }
      const b = this.bake(key, full, Math.round(S * this.dpr * 100) / 100);
      if (b) this.three.quad(b.cv, sx + b.x * S, sy + b.y * S, b.w * S, b.h * S, 0, 1, alpha);
      return;
    }
    c.save(); c.translate(sx, sy); c.scale(this.cam.z * scale, this.cam.z * scale); c.globalAlpha = alpha;
    Sprites[key](c, { t: this.game.time, face: 1, moving: false, atk: 9, seed: 0, ky: Camera.KY, ...st });
    c.restore();
  }

  private drawUpright(now: number): void {
    const g = this.game, m = this.map, items: { y: number; f: () => void }[] = [];
    const T = g.time;
    // 玩家走到岩石、松树、桥柱身后时，把挡住他的那一件淡出到 35%，不会整个人被盖住
    const P = g.player, hides = (x: number, y: number, halfW: number, height: number) => P.alive && P.y < y && Math.abs(P.x - x) < halfW && (y - P.y) * Camera.KY < height;
    m.staticObstacles.forEach((o, i) => { if (this.inView(o.center[0], o.center[1], o.radius + 20)) items.push({ y: o.center[1], f: () => this.sprite('rock', o.center[0], o.center[1], { team: 'blue', seed: i * 13 + 5, r: o.radius }, hides(o.center[0], o.center[1], o.radius * 1.3, o.radius * 1.6) ? 0.35 : 1) }); });
    m.brush.forEach((b, i) => {
      if (!this.inView(b.center[0], b.center[1], 40)) return;
      const st = this.brushStyle[i];
      items.push({ y: b.center[1] - b.radius, f: () => this.sprite('brush', b.center[0], b.center[1], { team: 'blue', seed: i * 31, r: b.radius, locked: false, variant: st.variant, dir: st.dir }) });
      items.push({ y: b.center[1] + b.radius, f: () => this.sprite('brush', b.center[0], b.center[1], { team: 'blue', seed: i * 31, r: b.radius, locked: true, variant: st.variant, dir: st.dir }, 0.9) });
    });
    // 底图里的桥柱和岩石：把同一张图上抠出的轮廓再画一遍，按触地点的世界 Y 排序，站在它们身后的单位就会被挡住
    for (const o of this.scenery?.occluders ?? []) {
      const img = this.occImgs[o.id];
      if (!img || !this.inView(o.base[0], o.base[1], 50)) continue;
      items.push({ y: o.base[1], f: () => { const [sx, sy] = this.cam.toScreen(o.base[0], o.base[1]), z = this.cam.z, c = this.ctx, ga = c.globalAlpha; const fade = hides(o.base[0], o.base[1], o.w * 0.5, o.h * 0.85) ? 0.35 : 1; if (this.three) { this.three.quad(img, sx - o.w * z * o.ax, sy - o.h * z * o.ay, o.w * z, o.h * z, 0, 1, fade); return; } c.globalAlpha = fade; c.drawImage(img, sx - o.w * z * o.ax, sy - o.h * z * o.ay, o.w * z, o.h * z); c.globalAlpha = ga; } });
    }
    for (const r of this.reeds) if (this.inView(r.x, r.y, 12) && !this.underBackdrop(r.x, r.y)) items.push({ y: r.y, f: () => this.sprite('reed', r.x, r.y, { team: 'blue', seed: r.seed, h: r.h }) });
    for (const p of this.pines) if (this.inView(p.x, p.y, 30)) items.push({ y: p.y, f: () => this.sprite('pine', p.x, p.y, { team: 'blue', seed: p.seed }, hides(p.x, p.y, 9, 30) ? 0.35 : 1) });
    for (const t of g.towers) if (this.inView(t.x, t.y, 40)) items.push({ y: t.y, f: () => this.sprite('tower', t.x, t.y, { team: t.team, seed: t.id, dead: !t.alive, locked: t.alive && !g.towerAttackable(t) }, 1, Camera.STRUCT_SCALE) });
    for (const team of TEAMS) { const k = g.cores[team]; if (this.inView(k.x, k.y, 80)) items.push({ y: k.y, f: () => this.sprite('core', k.x, k.y, { team, dead: !k.alive, locked: k.alive && !g.coreAttackable(team) }, 1, Camera.STRUCT_SCALE) }); }
    const unit = (u: Hero | Minion, key: string) => {
      if (!this.see(u) || !this.inView(u.x, u.y, 30)) return;
      items.push({ y: u.y, f: () => {
        // 动作平滑（每个单位记一份状态）：
        //  · 朝向带回差：几乎竖着走时 faceX 在 0 附近来回跳，贴图会左右乱翻——只有横向分量够大才换边
        //  · "在移动"保持 0.15 秒：AI 贴着站位点走走停停时不在跑步/待机之间来回闪
        //  · 跑步相位按实际走过的距离累计：步子和脚下的位移对得上
        let a = this.actors.get(u.id);
        if (!a) { a = { face: u.faceX >= 0 ? 1 : -1, moveT: -9, phase: (u.id % 7) / 7, x: u.x, y: u.y, seen: T, flips: 0, toggles: 0, run: false }; this.actors.set(u.id, a); }
        const smooth = AnimInfo.smooth, moved = Math.hypot(u.x - a.x, u.y - a.y);
        if (T - a.seen <= 0.5 && moved <= 40) a.phase += moved / (u.kind === 'hero' ? 33 : 17);   // 刚进视野或被传送的那一下不算进步子
        a.x = u.x; a.y = u.y; a.seen = T;
        const want = smooth ? (Math.abs(u.faceX) > 0.3 ? (u.faceX > 0 ? 1 : -1) : a.face) : u.faceX >= 0 ? 1 : -1;
        if (want !== a.face) { a.face = want; a.flips++; }
        if (u.moving) a.moveT = T;
        const run = smooth ? T - a.moveT < 0.15 : u.moving;
        if (run !== a.run) { a.run = run; a.toggles++; }
        const face = a.face;
        // 英雄放技能也播出手动作
        const atk = u.kind === 'hero' ? Math.min(T - u.atkT, T - u.castT) : T - u.atkT;
        this.sprite(key, u.x, u.y, { team: u.team, face, moving: run, atk, seed: u.id, phase: smooth ? a.phase : undefined }, u.brush >= 0 ? 0.62 : 1, Camera.UNIT_SCALE);
        if (T - u.hitT < 0.09) { const c = this.ctx, [sx, sy] = this.cam.toScreen(u.x, u.y, u.kind === 'hero' ? 15 : 8), r = (u.kind === 'hero' ? 12 : 7) * this.cam.z; c.fillStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.ellipse(sx, sy, r * 0.6 * Camera.UNIT_SCALE, r * 1.05 * Camera.UNIT_SCALE, 0, 0, 7); c.fill(); }
      } });
    };
    for (const mn of g.minions) unit(mn, mn.mkind === 'melee' ? 'minionMelee' : 'minionRanged');
    for (const h of g.heroes) unit(h, h.sprite);
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();
    // 弹体与命中火花
    const c = this.ctx, z = this.cam.z;
    const KY = Camera.KY, US = Camera.UNIT_SCALE;
    // 弦月：贴图朝右，月牙在图的右端；按屏幕上的飞行方向旋转，朝左飞时上下翻转保持正立
    if (this.fx.crescent) for (const cr of g.crescents) {
      const [x, y] = this.cam.toScreen(cr.x, cr.y, 9 * US), ang = Math.atan2(cr.dy * KY, cr.dx), L = 48 * z, img = this.fx.crescent;   // 贴图高 = L/2 ≈ 判定宽度 24
      c.save(); c.translate(x, y); c.rotate(ang); if (Math.cos(ang) < 0) c.scale(1, -1);
      c.drawImage(img, -L * 0.86, -L / 4, L, L / 2); c.restore();
    }
    for (const p of g.projectiles) {
      const hgt = (p.style === 'tower' ? 24 : p.style === 'hero' ? 16 : 8) * US, [x, y] = this.cam.toScreen(p.x, p.y, hgt);
      const img = p.style === 'tower' ? this.fx['tower-bolt-' + p.team] : p.style === 'hero' && p.src === g.player ? this.fx['hero-bolt'] : undefined;
      if (img) {
        const [tx, ty] = this.cam.toScreen(p.target.x, p.target.y, 12 * US), ang = Math.atan2(ty - y, tx - x), L = (p.style === 'tower' ? 30 : 24) * z * US;
        c.save(); c.translate(x, y); c.rotate(ang); if (Math.cos(ang) < 0) c.scale(1, -1);
        c.drawImage(img, -L * 0.72, -L / 4, L, L / 2); c.restore();
        continue;
      }
      const r = (p.style === 'tower' ? 3.4 : p.style === 'hero' ? 2.6 : 1.5) * z * US;
      const col = p.src === g.player ? '255,233,168' : p.team === 'blue' ? '140,225,255' : '255,150,125';
      c.fillStyle = `rgba(${col},.3)`; c.beginPath(); c.arc(x, y, r * 2.2, 0, 7); c.fill();
      c.fillStyle = `rgb(${col})`; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 0.45, 0, 7); c.fill();
    }
    for (const e of g.events) {
      const age = T - e.t;
      if (e.type === 'hit' && age < 0.18) {
        const [x, y] = this.cam.toScreen(e.x, e.y, 10), k = age / 0.18;
        c.strokeStyle = `rgba(255,255,255,${1 - k})`; c.lineWidth = 1.5; c.beginPath();
        for (let i = 0; i < 6; i++) { const a = i * 1.05 + e.t * 9; c.moveTo(x + Math.cos(a) * z * (2 + k * 4), y + Math.sin(a) * z * (2 + k * 4)); c.lineTo(x + Math.cos(a) * z * (4 + k * 8), y + Math.sin(a) * z * (4 + k * 8)); }
        c.stroke();
      }
    }
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, col: string): void {
    const c = this.ctx;
    c.fillStyle = 'rgba(8,20,22,.78)'; c.beginPath(); c.roundRect(x - w / 2 - 1, y - 1, w + 2, h + 2, 2); c.fill();
    c.fillStyle = col; c.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  /** 血条与伤害数字。队伍颜色由血条和脚环给出。 */
  private drawOverlays(): void {
    const c = this.ctx, g = this.game, cam = this.cam, H = cam.H, T = g.time;
    const col = (u: Unit) => (u === g.player ? '#6fe06a' : u.team === 'blue' ? '#4fb0f7' : '#ee5a47');
    for (const m of g.minions) if (this.see(m) && m.hp < m.maxHp) { const [x, y] = cam.toScreen(m.x, m.y, 22 * Camera.UNIT_SCALE); this.bar(x, y, H * 0.045, H * 0.008, m.hp / m.maxHp, col(m)); }
    for (const t of g.towers) if (t.alive && this.inView(t.x, t.y, 30)) { const [x, y] = cam.toScreen(t.x, t.y, SpriteHeight.tower * Camera.STRUCT_SCALE + 5); this.bar(x, y, H * 0.1, H * 0.012, t.hp / t.maxHp, col(t)); }
    for (const team of TEAMS) { const k = g.cores[team]; if (k.alive && this.inView(k.x, k.y, 60)) { const [x, y] = cam.toScreen(k.x, k.y, SpriteHeight.core * Camera.STRUCT_SCALE + 5); this.bar(x, y, H * 0.16, H * 0.016, k.hp / k.maxHp, col(k)); } }
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (const h of g.heroes) {
      if (!this.see(h)) continue;
      const [x, y] = cam.toScreen(h.x, h.y, (SpriteHeight[h.sprite] ?? 34) * Camera.UNIT_SCALE + 5), w = H * 0.125;
      this.bar(x, y, w, H * 0.017, h.hp / h.maxHp, col(h));
      c.strokeStyle = 'rgba(8,20,22,.6)'; c.lineWidth = 1; c.beginPath();
      for (let v = 100; v < h.maxHp; v += 100) { const tx = x - w / 2 + (w * v) / h.maxHp; c.moveTo(tx, y); c.lineTo(tx, y + H * 0.017); }
      c.stroke();
      c.font = `600 ${Math.round(H * 0.03)}px system-ui,"PingFang SC","Microsoft YaHei",sans-serif`;
      c.lineWidth = 3; c.strokeStyle = 'rgba(8,20,22,.7)'; const nm = HeroNames[h.sprite] ?? h.name; c.strokeText(nm, x, y - H * 0.012); c.fillStyle = '#fff'; c.fillText(nm, x, y - H * 0.012);
    }
    for (const e of g.events) {
      const age = T - e.t;
      if (e.type !== 'dmg' || age > 0.7) continue;
      const [x, y] = cam.toScreen(e.x, e.y, 30 + age * 22);
      c.globalAlpha = 1 - age / 0.7; c.font = `700 ${Math.round(H * (e.mine ? 0.042 : 0.036))}px system-ui,sans-serif`;
      c.lineWidth = 3; c.strokeStyle = 'rgba(8,20,22,.7)'; c.strokeText(String(Math.round(e.amount)), x, y);
      c.fillStyle = e.mine ? '#ffe9a8' : '#ff8c7a'; c.fillText(String(Math.round(e.amount)), x, y); c.globalAlpha = 1;
    }
  }
}
