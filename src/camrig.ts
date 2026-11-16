// 镜头试验层：屏高两档切换、敌塔屏边提示、塔偏移（仅 102 档）、技能瞄准取景。
// 只动镜头和提示，不碰模拟层——两档的射程、移速、碰撞、技能判定完全相同。
import { Camera } from './render.js';
import type { Game, Tower } from './sim.js';
import type { Hud } from './hud.js';

export interface TowerHint { tower: Tower; /** 箭头在屏幕上的位置与朝向 */ x: number; y: number; angle: number; locked: boolean }
export const ZOOMS = [102, 120];
const BASE = { VIEW_H: 120, UNIT: 0.66, STRUCT: 0.62 };

export class CamRig {
  opts = { /** 敌塔屏边提示（默认开） */ hint: true, /** 塔偏移（调试选项，默认关；只在 102 档生效） */ towerOffset: false, /** 技能瞄准取景：false 关（正式默认——站定施法不带动画面）；'soft' 减幅档（?aimcam=1）；true 完整取景（?aimcam=full，v11 的做法） */ aimCam: false as boolean | 'soft', /** ?cam=v11：跟随速率 7、阵亡后横扫回基地（只用于前后对比） */ legacy: false };
  /** 实测得到的塔偏移上限（世界单位） */
  readonly towerCap = { x: 19, y: 26 };
  mode: 'none' | 'tower' | 'aim' = 'none';
  hints: TowerHint[] = [];
  private tx = 0; private ty = 0;           // 目标偏移
  private hold = 0;                          // 塔偏移的保持时间：刚脱离锁定时先不回中，避免在射程边缘来回走时镜头跟着抽动
  private lastTower: Tower | null = null;
  private wasAlive = true;
  /** 敌塔锁定提示：塔在取景框内 → 玩家脚下细红环；塔出框 → 屏边红箭头。alpha/flash 给渲染用（flash 是锁定瞬间的提亮，0.3 秒衰减） */
  lock: { tower: Tower | null; mode: 'none' | 'ring' | 'arrow'; alpha: number; flash: number } = { tower: null, mode: 'none', alpha: 0, flash: 0 };
  /** 每座塔"是否在取景框内"的判定带 14px 回差，底座贴着框边进出时不会在红环和箭头之间来回闪 */
  private inFrame = new Map<number, boolean>();
  private vx = 0; private vy = 0;           // 偏移的当前速度

  constructor(private game: Game, private cam: Camera, private hud: Hud) {}

  get viewH(): number { return Camera.VIEW_H; }
  setViewH(v: number): void {
    const k = v / BASE.VIEW_H;
    Camera.VIEW_H = v; Camera.UNIT_SCALE = BASE.UNIT * k; Camera.STRUCT_SCALE = BASE.STRUCT * k;
    this.cam.resize(this.cam.W, this.cam.H); this.cam.ox = this.cam.oy = this.tx = this.ty = this.vx = this.vy = 0; this.cam.snap(this.cam.fx, this.cam.fy);
  }
  toggleZoom(): void { this.setViewH(ZOOMS[(ZOOMS.indexOf(Camera.VIEW_H) + 1) % ZOOMS.length]); }

  /** 把一个世界点带进安全取景框所需的最小镜头位移（世界单位），按"镜头没有偏移时"的画面计算，避免自己追自己。 */
  private need(wx: number, wy: number, pad = 0): [number, number] {
    const c = this.cam, r = this.hud.safeRect(), [sx, sy] = c.toScreenAt(wx, wy, c.fx, c.fy), vz = c.z * Camera.KY;
    const dx = sx < r[0] + pad ? (sx - r[0] - pad) / c.z : sx > r[2] - pad ? (sx - r[2] + pad) / c.z : 0;
    const dy = sy < r[1] + pad ? (sy - r[1] - pad) / vz : sy > r[3] - pad ? (sy - r[3] + pad) / vz : 0;
    return [dx, dy];
  }

  update(dt: number): void {
    const g = this.game, p = g.player, c = this.cam, cap = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    let tx = 0, ty = 0, mode: CamRig['mode'] = 'none';
    const aim = this.hud.aim;
    if (this.opts.aimCam && aim && p.alive && Math.hypot(aim.ax, aim.ay) >= 0.18) {
      // 技能瞄准：用 aimWorld() 的落点决定取景方向。上限 = 玩家自己仍留在安全框内（留 44px）
      const w = this.hud.aimWorld(aim), r = this.hud.safeRect(), [px, py] = c.toScreenAt(p.x, p.y, c.fx, c.fy), vz = c.z * Camera.KY, m = 44;
      const [dx, dy] = this.need(w.x, w.y, aim.i === 1 ? g.rules.xingli.skills[1].radius * c.z * 0.6 : 10);
      tx = Math.max(-(r[2] - m - px) / c.z, Math.min((px - r[0] - m) / c.z, dx));
      ty = Math.max(-(r[3] - m - py) / vz, Math.min((py - r[1] - m) / vz, dy));
      // 减幅档（?aimcam=1）：偏移上限 横 24px / 纵 18px，够提示方向，不把画面甩出去；?aimcam=full 是 v11 的完整取景
      if (this.opts.aimCam === 'soft') { tx = cap(tx, 24 / c.z); ty = cap(ty, 18 / vz); }
      mode = 'aim';
    } else if (this.opts.towerOffset && Camera.VIEW_H < 120 && p.alive) {
      // 塔偏移：只在敌塔锁定玩家且塔底座出屏时触发，用最小位移把底座拉回安全框
      const t = g.towers.find((t) => t.alive && t.team !== p.team && t.target === p) ?? null;
      if (t) { this.lastTower = t; this.hold = 0.7; } else this.hold -= dt;
      const tw = t ?? (this.hold > 0 && this.lastTower?.alive ? this.lastTower : null);
      /* 拉进框内 18px，超过提示的 14px 回差，箭头才会让位 */ if (tw) { const [dx, dy] = this.need(tw.x, tw.y, 18); tx = cap(dx, this.towerCap.x); ty = cap(dy, this.towerCap.y); if (dx || dy) mode = 'tower'; }
    }
    this.mode = mode; this.tx = tx; this.ty = ty;
    // 临界阻尼平滑（速度连续，不会在锁定/解锁的瞬间出现单帧跳变）：瞄准取景 0.16s（实战复测后从 0.10 放慢，起步不再猛甩），塔偏移 0.4s，回中 0.3s
    const soft = this.opts.aimCam === 'soft', st = mode === 'aim' ? (soft ? 0.3 : 0.16) : mode === 'tower' ? 0.4 : soft ? 0.6 : 0.3;
    [c.ox, this.vx] = damp(c.ox, tx, this.vx, st, dt); [c.oy, this.vy] = damp(c.oy, ty, this.vy, st, dt);
    if (tx === 0 && Math.abs(c.ox) < 0.03 && Math.abs(this.vx) < 0.2) { c.ox = 0; this.vx = 0; }
    if (ty === 0 && Math.abs(c.oy) < 0.03 && Math.abs(this.vy) < 0.2) { c.oy = 0; this.vy = 0; }
    // 镜头只跟英雄的逻辑世界坐标。阵亡后停在倒下的位置（不再横扫回基地），复活时直接切到出生点
    if (p.alive) { if (!this.wasAlive && !this.opts.legacy) c.snap(p.x, p.y); c.follow(p.x, p.y, dt); }
    else if (this.opts.legacy) c.follow(p.spawn[0], p.spawn[1], dt);
    else c.follow(c.fx, c.fy, dt);
    this.wasAlive = p.alive;
    this.updateHints(dt);
  }

  /** 屏边提示与锁定提示。
   *  · 在敌塔射程内、塔底座出了取景框 → 框边箭头（未锁定橙色，已锁定红色）——沿用原有的预警逻辑
   *  · 被敌塔实际锁定（以模拟层的 tower.target 为准）且塔在取景框内 → 玩家脚下红环
   *  同一座塔只会是红环或箭头其中之一。 */
  private updateHints(dt: number): void {
    this.hints = [];
    const g = this.game, p = g.player, c = this.cam, L = this.lock;
    let locker: Tower | null = null, lockerIn = false;
    if (p.alive && !g.over) {
      const r = this.hud.safeRect(), [px, py] = c.toScreen(p.x, p.y, 12 * Camera.UNIT_SCALE), H = 14;
      for (const t of g.towers) {
        if (!t.alive || t.team === p.team || Math.hypot(t.x - p.x, t.y - p.y) > t.range) { this.inFrame.delete(t.id); continue; }
        const [sx, sy] = c.toScreen(t.x, t.y), was = this.inFrame.get(t.id);
        const m = was === undefined ? 0 : was ? -H : H;                                   // 之前在框内：要出框 14px 才算出；之前在框外：要进框 14px 才算进
        const inside = sx >= r[0] + m && sx <= r[2] - m && sy >= r[1] + m && sy <= r[3] - m;
        this.inFrame.set(t.id, inside);
        const locked = t.target === p;
        if (locked && !locker) { locker = t; lockerIn = inside; }
        if (inside || !this.opts.hint) continue;
        // 从玩家指向塔的射线与取景框的交点
        const dx = sx - px, dy = sy - py; let k = 1;
        if (dx > 0) k = Math.min(k, (r[2] - px) / dx); else if (dx < 0) k = Math.min(k, (r[0] - px) / dx);
        if (dy > 0) k = Math.min(k, (r[3] - py) / dy); else if (dy < 0) k = Math.min(k, (r[1] - py) / dy);
        // 箭头圆心沿射线往回收一点；再整体夹在"箭头区"里——上沿比取景框低 0.115 屏高，光晕和感叹号都不会碰到计时条
        const inset = c.H * 0.06, len = Math.hypot(dx, dy) || 1, mg = c.H * 0.075;
        const hx = Math.max(r[0] + mg, Math.min(r[2] - mg, px + dx * k - (dx / len) * inset)), hy = Math.max(r[1] + c.H * 0.115, Math.min(r[3] - mg, py + dy * k - (dy / len) * inset));
        this.hints.push({ tower: t, x: hx, y: hy, angle: Math.atan2(dy, dx), locked });
      }
    } else this.inFrame.clear();
    // 锁定提示的状态
    const mode: 'none' | 'ring' | 'arrow' = !locker ? 'none' : lockerIn ? 'ring' : 'arrow';
    if (locker && locker !== L.tower) L.flash = 1;                                         // 新的一次锁定：提亮
    L.tower = locker; L.mode = mode;
    L.flash = Math.max(0, L.flash - dt / 0.3);
    L.alpha = mode === 'ring' && this.opts.hint ? 1 : Math.max(0, L.alpha - dt / 0.18);    // 常亮；解除或改成箭头后 0.18 秒淡出
  }
}

/** 临界阻尼弹簧（同 Unity 的 SmoothDamp）：返回 [新位置, 新速度] */
function damp(cur: number, target: number, vel: number, smoothTime: number, dt: number): [number, number] {
  if (dt <= 0) return [cur, vel];
  const w = 2 / smoothTime, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x), ch = cur - target, tmp = (vel + w * ch) * dt;
  return [target + (ch + tmp) * e, (vel - w * tmp) * e];
}
