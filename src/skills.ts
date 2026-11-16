// 六名英雄的技能结算（v0.17）。规格见 docs/claude-prompt.md 第 2 节；数值全部读 match-rules.json 的 heroes.<id>.skills。
// 这个文件只有规则，没有任何绘制。Game 把施法、每步推进、伤害前后、可见性、移速和普攻射程都委托到这里。
/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any; type U = any; type H = any;

const hyp = Math.hypot, clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dist = (a: U, b: U) => hyp(a.x - b.x, a.y - b.y);
/** 点到线段的距离，同时给出沿线段的投影长度 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
  if (L2 < 1e-9) return [hyp(px - ax, py - ay), 0];
  const k = clamp(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1);
  return [hyp(px - ax - vx * k, py - ay - vy * k), k * Math.sqrt(L2)];
}

export interface SkillState {
  casting: { i: number; s: any; aim: any; left: number; castId: number; veiled: boolean; plan: any } | null;
  charge: { i: number; t0: number; factor: number } | null;
  guard: { dx: number; dy: number; until: number; budget: number; blocked: number; flashT: number } | null;
  ward: { ally: H; until: number; budget: number } | null; wardBy: H | null;
  thread: { ally: H; until: number } | null; threadBy: H | null;
  veilUntil: number; exposedUntil: number; stanceUntil: number;
  forced: { dx: number; dy: number; left: number; speed: number; wall: { dmg: number; stun: number; src: H } | null } | null;
  dash: any;
  shields: { amt: number; until: number; fx?: string }[];
  slows: { frac: number; until: number }[];
  marks: Record<string, { src: number; until: number } | undefined>;
  reaped: { src: number; until: number; castId: number } | null;
  refunded: Set<number>;
  px: number; py: number; teleported: boolean; tpAt: number;
  lastAccept: number; aiNext: number; aiCharge: boolean;
}
export function newState(): SkillState {
  return { casting: null, charge: null, guard: null, ward: null, wardBy: null, thread: null, threadBy: null, veilUntil: 0, exposedUntil: 0, stanceUntil: 0, forced: null, dash: null,
    shields: [], slows: [], marks: {}, reaped: null, refunded: new Set(), px: NaN, py: NaN, teleported: false, tpAt: -9, lastAccept: -9, aiNext: 0, aiCharge: false };
}
const st = (u: U): SkillState => (u.sk ??= newState());

export function reset(g: G): void {
  g.crescents = []; g.zones = []; g.lamps = []; g.traps = []; g.rings = []; g.flyers = []; g.castSeq = 0;
}
/** 阵亡清理：个人增益、连线、蓄力、前摇、自身位移都清掉；已放出去的飞行物和放置物留到自然结束 */
export function clear(g: G, h: H): void {
  const s = st(h);
  if (s.ward) { st(s.ward.ally).wardBy = null; s.ward = null; }
  if (s.wardBy) { st(s.wardBy).ward = null; s.wardBy = null; }
  if (s.thread) { st(s.thread.ally).threadBy = null; s.thread = null; }
  if (s.threadBy) { st(s.threadBy).thread = null; s.threadBy = null; }
  s.casting = null; s.charge = null; s.guard = null; s.veilUntil = 0; s.stanceUntil = 0; s.forced = null; s.dash = null; s.shields = []; s.slows = []; s.marks = {}; s.reaped = null; s.aiCharge = false;
  h.shield = 0; h.stunned = false;
  for (const c of g.crescents) if (c.src === h && c.back) c.left = 0;                 // 已在返程的弦月立即消散
  g.crescents = g.crescents.filter((c: any) => !(c.src === h && c.back));
}

// ---------------------------------------------------------------- 几何与移动
export function walkable(g: G, x: number, y: number, r = 6): boolean {
  const b = g.map.world.playableBounds;
  if (x < b[0] + r || x > b[2] - r || y < b[1] + r || y > b[3] - r) return false;
  for (const c of g.colliders) if (hyp(x - c.x, y - c.y) < c.r + r - 0.01) return false;
  return true;
}
/** 扫掠圆直线移动：碰到岩体、存活建筑或地图边界就停在前面，不沿墙滑。返回实际走的距离和是否撞到 */
export function sweep(g: G, u: U, dx: number, dy: number, want: number): { moved: number; hit: boolean } {
  let moved = 0; const step = 1.5;
  while (moved < want - 1e-6) {
    const s = Math.min(step, want - moved), nx = u.x + dx * s, ny = u.y + dy * s;
    if (!walkable(g, nx, ny, u.r)) return { moved, hit: true };
    u.x = nx; u.y = ny; moved += s;
  }
  return { moved, hit: false };
}
export function clearLen(g: G, x: number, y: number, dx: number, dy: number, len: number, r: number): number {
  for (let d = 0; d <= len; d += 1.5) if (!walkable(g, x + dx * d, y + dy * d, r)) return Math.max(0, d - 1.5);
  return len;
}
const enemies = (g: G, team: string): U[] => [...g.heroes, ...g.minions].filter((u: U) => u.alive && u.team !== team);
const enemyHeroes = (g: G, team: string): H[] => g.heroes.filter((u: H) => u.alive && u.team !== team);
const allies = (g: G, h: H, self = false): H[] => g.heroes.filter((u: H) => u.alive && u.team === h.team && (self || u !== h));
const byId = (a: U, b: U) => a.id - b.id;

// ---------------------------------------------------------------- 状态
export function addSlow(g: G, u: U, frac: number, secs: number): void {
  const s = st(u); s.slows = s.slows.filter((x) => x.until > g.time); s.slows.push({ frac, until: g.time + secs });
  let best = s.slows[0]; for (const x of s.slows) if (x.frac > best.frac) best = x;
  u.slowFrac = best.frac; u.slowUntil = Math.max(...s.slows.filter((x) => x.frac === best.frac).map((x) => x.until));
}
const slowOf = (g: G, u: U): number => { let f = 0; for (const x of st(u).slows) if (x.until > g.time && x.frac > f) f = x.frac; return f; };
export function root(g: G, u: U, secs: number): void { u.rootUntil = Math.max(u.rootUntil, g.time + secs); }
export function stun(g: G, u: U, secs: number): void {
  root(g, u, secs);
  if (u.kind !== 'hero') return;
  u.stunned = true; const s = st(u);
  s.casting = null; s.charge = null; s.guard = null; s.aiCharge = false; u.windup = null;
  if (s.dash) s.dash = null;                                                          // 眩晕打断本人的冲刺和跃击
  breakVeil(g, u);
}
export function mark(g: G, u: U, kind: string, src: H, secs: number): void { st(u).marks[kind] = { src: src.id, until: g.time + secs }; if (kind === 'moon') u.moonUntil = g.time + secs; }
export const hasMark = (g: G, u: U, kind: string, src: H): boolean => { const m = st(u).marks[kind]; return !!m && m.src === src.id && m.until > g.time; };
function takeMark(g: G, u: U, kind: string, src: H): boolean { if (!hasMark(g, u, kind, src)) return false; st(u).marks[kind] = undefined; if (kind === 'moon') u.moonUntil = 0; return true; }
export function addShield(g: G, h: H, amt: number, secs: number, fx?: string): void { st(h).shields.push({ amt, until: g.time + secs, fx }); syncShield(g, h); }
function syncShield(g: G, h: H): void {
  const s = st(h); s.shields = s.shields.filter((x) => x.until > g.time && x.amt > 1e-6);
  let best: any = null; for (const x of s.shields) if (!best || x.amt > best.amt) best = x;
  h.shield = best ? best.amt : 0; h.shieldUntil = best ? best.until : 0; h.shieldFx = best?.fx;
}
const veiled = (g: G, h: H): boolean => h.kind === 'hero' && st(h).veilUntil > g.time;
function breakVeil(g: G, h: H): void { const s = st(h); if (s.veilUntil > g.time) { s.veilUntil = 0; s.exposedUntil = Math.max(s.exposedUntil, g.time + 0.35); g.events.push({ type: 'veilEnd', t: g.time, x: h.x, y: h.y, who: h.id }); } }
const stanceOn = (g: G, h: H): boolean => st(h).stanceUntil > g.time;

/** 移速倍率：先取最强的加速，再乘最强的减速，再乘自身技能带来的减速（举盾、鹰眼、蓄力） */
export function speedMul(g: G, u: U): number {
  let m = 1 - slowOf(g, u);
  if (u.kind !== 'hero') return m;
  const s = st(u); let haste = g.time < u.hasteUntil ? u.hasteFrac : 0;
  if ((s.thread && s.thread.until > g.time) || (s.threadBy && (st(s.threadBy).thread?.until ?? 0) > g.time)) haste = Math.max(haste, skillOf(g, s.thread ? u : s.threadBy, 'thread')?.hasteFraction ?? 0.14);
  if (s.veilUntil > g.time) haste = Math.max(haste, skillOf(g, u, 'veil')?.hasteFraction ?? 0.16);
  m *= 1 + haste;
  if (s.guard) m *= 1 - (skillOf(g, u, 'guard')?.selfSlowFraction ?? 0.24);
  if (s.stanceUntil > g.time) m *= 1 - (skillOf(g, u, 'stance')?.selfSlowFraction ?? 0.3);
  if (s.charge) m *= skillOf(g, u, 'draw')?.chargeMoveMultiplier ?? 0.66;
  return m;
}
const skillOf = (g: G, h: H, id: string): any => g.skillsOf(h).find((s: any) => s.id === id);
export const attackRange = (g: G, h: H): number => h.ba.range + (stanceOn(g, h) ? skillOf(g, h, 'stance')?.bonusAttackRange ?? 35 : 0);
/** 普攻出手时的伤害：鹰眼期间打严格远于阈值的非建筑目标有额外伤害 */
export function attackDamage(g: G, h: H, t: U): number {
  const s = skillOf(g, h, 'stance');
  return h.ba.damage + (stanceOn(g, h) && s && t.kind !== 'tower' && t.kind !== 'core' && dist(h, t) > s.farThreshold ? s.farAttackBonus : 0);
}
/** 能不能起手普攻：前摇、蓄力、突进、被推拉时不行 */
export const canAttack = (g: G, h: H): boolean => { const s = st(h); return !s.casting && !s.charge && !s.dash; };
export function onAttack(g: G, h: H): void { breakVeil(g, h); }
export const busy = (h: H): boolean => !!st(h).dash;

// ---------------------------------------------------------------- 可见性
export function visible(g: G, u: U, team: string, base: boolean): boolean {
  if (u.team === team || u.kind !== 'hero') return base;
  const s = st(u);
  if (s.veilUntil > g.time) {                                                         // 主动匿影：32 内有对方英雄才显形；伏矢等明确揭露可压制
    if (s.exposedUntil > g.time) return true;
    const rv = skillOf(g, u, 'veil')?.proximityReveal ?? 32;
    return g.heroes.some((e: H) => e.alive && e.team === team && dist(e, u) <= rv);
  }
  if (base || s.exposedUntil > g.time) return true;
  for (const l of g.lamps) if (l.team === team && hyp(u.x - l.x, u.y - l.y) <= l.r) return true;      // 落灯照亮草丛
  return false;
}

// ---------------------------------------------------------------- 伤害前后
/** 进入扣血前的处理：护阵分流 → 举盾格挡 → 护盾吸收。返回最终扣到生命上的数值。 */
export function preDamage(g: G, src: U | null, tgt: U, amount: number, opts: any = {}): number {
  if (tgt.kind !== 'hero') return amount;
  const s = st(tgt), T = g.time, kind = opts.kind;
  // 护阵：敌方英雄或小兵的直接伤害按比例转给玄垣
  if (s.wardBy && src && (src.kind === 'hero' || src.kind === 'minion') && src.team !== tgt.team && !['zone', 'trap', 'ring', 'redirect'].includes(kind)) {
    const p = s.wardBy, w = st(p).ward;
    if (w && w.until > T && p.alive && w.budget > 1e-6) {
      const part = Math.min(amount * (skillOf(g, p, 'ward')?.redirectFraction ?? 0.45), w.budget);
      w.budget -= part; amount -= part;
      g.events.push({ type: 'redirect', t: T, x: tgt.x, y: tgt.y, x2: p.x, y2: p.y, amount: part });
      g.damage(src, p, part, { kind: 'redirect' });
      if (w.budget <= 1e-6) endWard(p);
    }
  }
  // 举盾：攻击者在盾面 ±60° 内才挡
  if (s.guard && s.guard.until > T && src && s.guard.budget > 1e-6) {
    const ax = src.x - tgt.x, ay = src.y - tgt.y, d = hyp(ax, ay), gd = skillOf(g, tgt, 'guard');
    if (d > 1e-6 && gd && (ax * s.guard.dx + ay * s.guard.dy) / d >= Math.cos(((gd.angleDeg ?? 120) * Math.PI) / 360) - 1e-9) {
      const b = Math.min(amount * gd.blockFraction, s.guard.budget);
      s.guard.budget -= b; s.guard.blocked += b; s.guard.flashT = T; amount -= b;
      g.events.push({ type: 'block', t: T, x: tgt.x, y: tgt.y, amount: b });
    }
  }
  // 护盾：以最大的一份为池，扣减同时作用在所有重叠份额上
  syncShield(g, tgt);
  if (tgt.shield > 0 && amount > 0) { const ab = Math.min(tgt.shield, amount); for (const x of s.shields) x.amt = Math.max(0, x.amt - ab); amount -= ab; syncShield(g, tgt); }
  return amount;
}
function endWard(p: H): void { const w = st(p).ward; if (w) { st(w.ally).wardBy = null; st(p).ward = null; } }
export function postDamage(g: G, src: U | null, tgt: U, dealt: number, died: boolean): void {
  if (tgt.kind !== 'hero') return;
  const s = st(tgt);
  if (dealt > 1e-9) breakVeil(g, tgt);                                                // 掉了实际生命才破隐，被护盾全吸收不算
  if (died && s.reaped && src && src.id === s.reaped.src && g.time <= s.reaped.until + 1e-9 && src.alive) refund(g, src, s.reaped.castId);
  if (died) clear(g, tgt);
}
function refund(g: G, h: H, castId: number): void {
  const s = st(h); if (s.refunded.has(castId)) return; s.refunded.add(castId);
  const sk = g.skillsOf(h), bi = sk.findIndex((x: any) => x.id === 'backstep'), vi = sk.findIndex((x: any) => x.id === 'veil'), rp = skillOf(g, h, 'reap');
  if (bi >= 0) h.cds[bi] = 0;
  if (vi >= 0) h.cds[vi] = Math.max(0, h.cds[vi] - (rp?.veilCooldownReduction ?? 4));
  g.events.push({ type: 'refund', t: g.time, x: h.x, y: h.y, who: h.id });
}

// ---------------------------------------------------------------- 施法：受理 → 前摇 → 出手
const MOBILE = new Set(['ram', 'backstep', 'ring']);
/** 吸附目标：离落点最近、其次 ID；点按时取离施法者最近的 */
function snap(g: G, h: H, s: any, aim: any, pool: H[]): H | null {
  const range = s.castRange, sr = s.snapRadius ?? 32;
  let c = pool.filter((u) => dist(u, h) <= range + 1e-6);
  if (aim.target != null) return c.find((u) => u.id === aim.target) ?? null;
  if (aim.tap) return c.sort((a, b) => dist(a, h) - dist(b, h) || byId(a, b))[0] ?? null;
  c = c.filter((u) => hyp(u.x - aim.x, u.y - aim.y) <= sr + 1e-6);
  return c.sort((a, b) => hyp(a.x - aim.x, a.y - aim.y) - hyp(b.x - aim.x, b.y - aim.y) || byId(a, b))[0] ?? null;
}
export const snapPreview = (g: G, h: H, s: any, aim: any): H | null => {
  if (s.id === 'ward' || s.id === 'thread') return snap(g, h, s, aim, allies(g, h));
  if (s.id === 'backstep') return snap(g, h, s, aim, enemyHeroes(g, h.team).filter((e) => g.visible(e, h.team)));
  return null;
};
/** 狐步的落脚点：目标身后 21，不行就绕目标 ±30/60/90° 找，且夜岚到落点的直线不能穿实体障碍 */
export function backstepSpot(g: G, h: H, t: H, s: any): [number, number] | null {
  let fx = t.faceX, fy = t.faceY; const fl = hyp(fx, fy);
  if (fl < 1e-6) { fx = t.x - h.x; fy = t.y - h.y; const l = hyp(fx, fy) || 1; fx /= l; fy /= l; fx = -fx; fy = -fy; } else { fx /= fl; fy /= fl; }
  const base = Math.atan2(-fy, -fx), R = s.behindDistance ?? 21;
  for (const off of [0, 30, -30, 60, -60, 90, -90]) {
    const a = base + (off * Math.PI) / 180, x = t.x + Math.cos(a) * R, y = t.y + Math.sin(a) * R;
    if (!walkable(g, x, y, h.r)) continue;
    const dx = x - h.x, dy = y - h.y, L = hyp(dx, dy);
    if (L > 1e-6 && clearLen(g, h.x, h.y, dx / L, dy / L, L, 2) < L - 1.6) continue;
    return [x, y];
  }
  return null;
}
/** 出手前的合法性：返回执行计划或失败原因。受理时算一次，前摇结束时再算一次。 */
function plan(g: G, h: H, s: any, aim: any): any {
  const d = hyp(aim.x - h.x, aim.y - h.y);
  const inRange = () => d <= (s.castRange ?? Infinity) + 0.5;
  switch (s.id) {
    case 'beacon': case 'starfield': return inRange() ? { ok: true } : { ok: false, reason: 'range' };
    case 'perch': case 'snare': case 'ring': if (!inRange()) return { ok: false, reason: 'range' }; return walkable(g, aim.x, aim.y, s.id === 'ring' ? h.r : 4) ? { ok: true } : { ok: false, reason: 'spot' };
    case 'ward': case 'thread': { const t = snap(g, h, s, aim, allies(g, h)); return t ? { ok: true, target: t } : { ok: false, reason: 'target' }; }
    case 'backstep': {
      const t = snap(g, h, s, aim, enemyHeroes(g, h.team).filter((e) => g.visible(e, h.team)));
      if (!t) return { ok: false, reason: 'target' };
      const spot = backstepSpot(g, h, t, s); return spot ? { ok: true, target: t, spot } : { ok: false, reason: 'spot' };
    }
    default: return { ok: true };
  }
}
export function beginCharge(g: G, i: number, h: H = g.player): any {
  const s = g.skillsOf(h)[i], k = st(h);
  if (!s || s.aim !== 'charge') return { ok: false, reason: 'none' };
  if (g.over) return { ok: false, reason: 'over' }; if (!h.alive) return { ok: false, reason: 'dead' };
  if (h.cds[i] > 0) return { ok: false, reason: 'cooldown' };
  if (k.casting || k.dash || h.stunned || k.charge) return { ok: false, reason: 'busy' };
  k.charge = { i, t0: g.time, factor: stanceOn(g, h) ? s.chargeTimeMultiplier ?? skillOf(g, h, 'stance')?.chargeTimeMultiplier ?? 0.72 : 1 }; h.windup = null;
  return { ok: true };
}
export function cancelCharge(g: G, h: H = g.player): void { st(h).charge = null; st(h).aiCharge = false; }
export function chargeQ(g: G, h: H): number { const c = st(h).charge; if (!c) return 0; const s = g.skillsOf(h)[c.i]; return clamp((g.time - c.t0) / (s.maxChargeSeconds * c.factor), 0, 1); }

export function cast(g: G, i: number, aim: any, h: H): any {
  if (g.over) return { ok: false, reason: 'over' };
  if (!h.alive) return { ok: false, reason: 'dead' };
  const k = st(h), s = g.skillsOf(h)[i]; if (!s) return { ok: false, reason: 'none' };
  if (h.cds[i] > 0) return { ok: false, reason: 'cooldown' };
  if (k.casting || k.dash || h.stunned) return { ok: false, reason: 'busy' };
  if (k.charge && k.charge.i !== i) return { ok: false, reason: 'busy' };
  if (MOBILE.has(s.id) && g.time < h.rootUntil) return { ok: false, reason: 'rooted' };          // 定身时不能自己突进、跃击、闪现
  aim = { ...aim };
  let L = hyp(aim.dx ?? 0, aim.dy ?? 0);
  if (L < 1e-6) { aim.dx = h.faceX; aim.dy = h.faceY; L = hyp(aim.dx, aim.dy) || 1; }
  aim.dx /= L; aim.dy /= L;
  if (s.aim === 'charge') { aim.q = k.charge ? chargeQ(g, h) : clamp(aim.q ?? 0, 0, 1); k.charge = null; k.aiCharge = false; }
  const p = plan(g, h, s, aim); if (!p.ok) return p;
  if (p.target) aim.target = p.target.id;
  k.casting = { i, s, aim, left: s.windupSeconds ?? 0, castId: ++g.castSeq, veiled: veiled(g, h), plan: p }; k.lastAccept = g.time;
  h.windup = null; h.castT = g.time;
  if (s.aim === 'direction' || s.aim === 'charge') { h.faceX = aim.dx; h.faceY = aim.dy; }
  if (k.casting.left <= 1e-9) fire(g, h);
  return { ok: true, castId: g.castSeq };
}
function fire(g: G, h: H): void {
  const k = st(h), c = k.casting!; k.casting = null;
  const s = c.s, aim = c.aim, T = g.time;
  if (!h.alive || h.stunned) return;
  if (MOBILE.has(s.id) && T < h.rootUntil) return;
  const p = plan(g, h, s, aim); if (!p.ok) { g.events.push({ type: 'castFail', t: T, x: h.x, y: h.y, who: h.id, reason: p.reason }); return; }
  h.cds[c.i] = s.cooldownSeconds; h.castT = T; if (h.brush >= 0) h.revealUntil = Math.max(h.revealUntil, T + 1.5);
  const wasVeiled = c.veiled && veiled(g, h);
  if (s.id !== 'veil') breakVeil(g, h);
  const ev = { castId: c.castId, heroId: h.sprite, skillId: s.id, casterId: h.id, slot: c.i, dx: aim.dx, dy: aim.dy, team: h.team };
  g.events.push({ type: 'cast', t: T, x: h.x, y: h.y, skill: c.i, ...ev });
  EFFECT[s.id]?.(g, h, s, aim, p, ev, wasVeiled);
}
const hitEv = (g: G, u: U) => g.events.push({ type: 'hit', t: g.time, x: u.x, y: u.y });
const push = (g: G, u: H, dx: number, dy: number, left: number, speed: number, wall: any = null) => { if (u.alive && left > 0.01) st(u).forced = { dx, dy, left, speed, wall }; };

const EFFECT: Record<string, (g: G, h: H, s: any, aim: any, p: any, ev: any, wasVeiled: boolean) => void> = {
  // —— 星璃 ——
  crescent(g, h, s, aim, _p, ev) {
    g.crescents.push({ kind: 'crescent', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, left: s.range, speed: s.speed ?? 430, width: s.width, damage: s.damage, hit: new Set(), src: h, style: 'crescent', fx: 'fx-xingli-crescent',
      ret: s.returns ? s.returnDamageFraction : 0, retSpeed: s.returnSpeed ?? 490, retMax: s.returnMaxSeconds ?? 0.85, back: false, backT: 0, mark: s.markSeconds ?? 0, base: s.damage, ...ev });
  },
  beacon(g, h, s, aim) {
    for (const u of enemies(g, h.team)) {
      if (hyp(u.x - aim.x, u.y - aim.y) > s.radius + 1e-6) continue;
      let dmg = s.damage; addSlow(g, u, s.slowFraction, s.slowSeconds); hitEv(g, u);
      if (takeMark(g, u, 'moon', h)) { dmg += s.markBonusDamage; root(g, u, s.markRootSeconds); g.events.push({ type: 'detonate', t: g.time, x: u.x, y: u.y }); }
      g.damage(h, u, dmg, { kind: 'skill' });
    }
    g.events.push({ type: 'beacon', t: g.time, x: aim.x, y: aim.y, r: s.radius, fx: 'fx-xingli-beacon' });
  },
  starfield(g, h, s, aim) {
    g.zones.push({ x: aim.x, y: aim.y, r: s.radius, born: g.time, until: g.time + s.seconds, next: g.time + s.tickSeconds, tick: s.tickSeconds, dmg: s.tickDamage, slow: s.slowFraction, slowSecs: s.slowSeconds ?? 0.65,
      final: s.finalDamage, finalRoot: s.finalRootSeconds, mark: s.markSeconds ?? 0, src: h, team: h.team, n: 0, ticks: Math.round(s.seconds / s.tickSeconds) });
    g.events.push({ type: 'zone', t: g.time, x: aim.x, y: aim.y, r: s.radius });
  },
  // —— 玄垣 ——
  guard(g, h, s, aim) { st(h).guard = { dx: aim.dx, dy: aim.dy, until: g.time + s.seconds, budget: s.guardBudget, blocked: 0, flashT: -9 }; h.faceX = aim.dx; h.faceY = aim.dy; g.events.push({ type: 'guard', t: g.time, x: h.x, y: h.y, who: h.id }); },
  ram(g, h, s, aim, _p, ev) {
    const k = st(h), gs = skillOf(g, h, 'guard'), emp = !!(k.guard && k.guard.until > g.time && k.guard.blocked >= (gs?.guardChargeThreshold ?? 45));
    k.guard = null;
    k.dash = { type: 'ram', dx: aim.dx, dy: aim.dy, left: s.range, speed: s.speed, s, emp, hit: new Set(), ...ev }; h.faceX = aim.dx; h.faceY = aim.dy;
    g.events.push({ type: 'dash', t: g.time, x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, r: s.range, fx: 'fx-xuanyuan-ram', emp, who: h.id });
  },
  ward(g, h, s, _aim, p) {
    endWard(h); const a = p.target, ka = st(a);
    if (ka.wardBy) endWard(ka.wardBy);
    addShield(g, a, s.shield, s.seconds, 'fx-xuanyuan-bulwark');
    st(h).ward = { ally: a, until: g.time + s.seconds, budget: s.redirectBudget }; ka.wardBy = h;
    g.events.push({ type: 'buff', t: g.time, x: a.x, y: a.y, r: 22, secs: s.seconds, who: a.id });
  },
  // —— 鹤灯 ——
  perch(g, h, s, aim) {
    g.lamps = g.lamps.filter((l: any) => l.owner !== h);
    g.lamps.push({ x: aim.x, y: aim.y, r: s.radius, born: g.time, until: g.time + s.seconds, next: g.time + s.tickSeconds, tick: s.tickSeconds, heal: s.healAllies, owner: h, team: h.team });
    g.events.push({ type: 'lamp', t: g.time, x: aim.x, y: aim.y, r: s.radius });
  },
  thread(g, h, s, _aim, p) {
    const k = st(h); if (k.thread) st(k.thread.ally).threadBy = null;
    const a = p.target, ka = st(a); if (ka.threadBy && ka.threadBy !== h) st(ka.threadBy).thread = null;
    k.thread = { ally: a, until: g.time + s.seconds }; ka.threadBy = h;
    g.events.push({ type: 'thread', t: g.time, x: h.x, y: h.y, x2: a.x, y2: a.y });
  },
  recall(g, h, s) {
    const lamp = g.lamps.find((l: any) => l.owner === h), k = st(h), link = k.thread && k.thread.until > g.time && k.thread.ally.alive ? k.thread.ally : null;
    const maxLen = Math.min(s.range, link ? skillOf(g, h, 'thread')?.healRouteLength ?? s.range : s.range), set = new Set<number>();
    const sx = lamp ? lamp.x : h.x, sy = lamp ? lamp.y : h.y, shield = lamp ? s.shield : 0;
    if (lamp) g.lamps = g.lamps.filter((l: any) => l !== lamp);
    const ends: [number, number][] = [];
    if (lamp) ends.push([h.x, h.y]);
    if (link) ends.push([link.x, link.y]);
    const burst = (x: number, y: number) => { for (const a of allies(g, h, true)) if (!set.has(a.id) && hyp(a.x - x, a.y - y) <= s.width / 2 + 1e-6) healOne(g, h, a, s, shield, set); };
    if (!ends.length) { burst(h.x, h.y); g.events.push({ type: 'buff', t: g.time, x: h.x, y: h.y, r: s.width / 2, secs: 0.4, who: h.id }); return; }
    for (const [ex, ey] of ends) {
      let dx = ex - sx, dy = ey - sy; const L = hyp(dx, dy);
      if (L < 1e-6) { burst(sx, sy); continue; }
      dx /= L; dy /= L;
      g.flyers.push({ x: sx, y: sy, dx, dy, left: Math.min(L, maxLen), speed: s.speed, width: s.width, set, s, shield, owner: h, team: h.team, fx: 'fx-hedeng-recall' });
    }
  },
  // —— 夜岚 ——
  veil(g, h, s) { st(h).veilUntil = g.time + s.seconds; g.events.push({ type: 'veil', t: g.time, x: h.x, y: h.y, who: h.id, team: h.team }); },
  backstep(g, h, s, _aim, p, _ev, wasVeiled) {
    const t = p.target, [x, y] = p.spot, ox = h.x, oy = h.y;
    h.x = x; h.y = y; st(h).teleported = true; st(h).tpAt = g.time; const d = hyp(t.x - x, t.y - y) || 1; h.faceX = (t.x - x) / d; h.faceY = (t.y - y) / d;
    g.events.push({ type: 'blink', t: g.time, x: ox, y: oy, x2: x, y2: y });
    hitEv(g, t); g.damage(h, t, s.damage + (wasVeiled ? s.hiddenBonusDamage : 0), { kind: 'skill' });
    if (t.alive) mark(g, t, 'hunt', h, s.markSeconds);
  },
  reap(g, h, s, aim, _p, ev) {
    const cos = Math.cos((s.angleDeg * Math.PI) / 360);
    for (const u of enemies(g, h.team)) {
      const ux = u.x - h.x, uy = u.y - h.y, d = hyp(ux, uy);
      if (d > s.range + 1e-6 || (d > 1e-6 && (ux * aim.dx + uy * aim.dy) / d < cos - 1e-9)) continue;
      let dmg = s.damage;
      if (u.kind === 'hero') {
        if (u.hp <= u.maxHp * s.executeThreshold + 1e-9) dmg += s.executeBonusDamage;
        if (takeMark(g, u, 'hunt', h)) dmg += s.markBonusDamage;
        st(u).reaped = { src: h.id, until: g.time + s.refreshWindowSeconds, castId: ev.castId };
      }
      hitEv(g, u); g.damage(h, u, dmg, { kind: 'skill' });
    }
    g.events.push({ type: 'cone', t: g.time, x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, r: s.range, angle: (s.angleDeg * Math.PI) / 180, fx: 'fx-yelan-reap' });
  },
  // —— 绯弦 ——
  draw(g, h, s, aim, _p, ev) {
    const q = aim.q ?? 0, range = s.minRange + (s.range - s.minRange) * q, dmg = s.minDamage + (s.damage - s.minDamage) * q;
    g.crescents.push({ kind: 'draw', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, left: range, speed: s.speed, width: s.width, damage: dmg, base: dmg, hit: new Set(), src: h, style: 'bolt', fx: 'fx-feixian-draw',
      ret: 0, mark: 0, second: s.secondaryDamageMultiplier, bonus: s.markBonusDamage, first: true, q, ...ev });
  },
  snare(g, h, s, aim) {
    const mine = g.traps.filter((t: any) => t.owner === h);
    if (mine.length >= s.maxObjects) g.traps = g.traps.filter((t: any) => t !== mine[0]);
    g.traps.push({ x: aim.x, y: aim.y, r: s.radius, born: g.time, armAt: g.time + s.armingSeconds, until: g.time + s.seconds, owner: h, team: h.team, s });
    g.events.push({ type: 'trapSet', t: g.time, x: aim.x, y: aim.y, r: s.radius, team: h.team });
  },
  stance(g, h, s) { st(h).stanceUntil = g.time + s.seconds; g.events.push({ type: 'stance', t: g.time, x: h.x, y: h.y, who: h.id, r: h.ba.range + s.bonusAttackRange }); },
  // —— 赤檐 ——
  hook(g, h, s, aim) {
    const len = clearLen(g, h.x, h.y, aim.dx, aim.dy, s.range, 2), ex = h.x + aim.dx * len, ey = h.y + aim.dy * len;
    const hits = enemies(g, h.team).map((u) => ({ u, sd: segDist(u.x, u.y, h.x, h.y, ex, ey) })).filter((o) => o.sd[0] <= s.width / 2 + 1e-6).sort((a, b) => a.sd[1] - b.sd[1] || byId(a.u, b.u));
    let end = len;
    for (const { u, sd } of hits) {
      hitEv(g, u);
      if (u.kind !== 'hero') { g.damage(h, u, s.damage, { kind: 'skill' }); continue; }
      end = sd[1]; addSlow(g, u, s.slowFraction, s.slowSeconds); g.damage(h, u, s.damage, { kind: 'skill' });
      const d = dist(u, h), pull = Math.min(s.pullDistance, d - s.minSeparation);
      if (u.alive && pull > 0.01) push(g, u, (h.x - u.x) / d, (h.y - u.y) / d, pull, s.pullSpeed);
      g.events.push({ type: 'hooked', t: g.time, x: u.x, y: u.y, x2: h.x, y2: h.y });
      break;
    }
    g.events.push({ type: 'lineFx', t: g.time, x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, r: end, w: s.width, fx: 'fx-chiyan-hook' });
  },
  sweep(g, h, s, aim) {
    const cos = Math.cos((s.angleDeg * Math.PI) / 360);
    for (const u of enemies(g, h.team)) {
      const ux = u.x - h.x, uy = u.y - h.y, d = hyp(ux, uy);
      if (d > s.range + 1e-6 || (d > 1e-6 && (ux * aim.dx + uy * aim.dy) / d < cos - 1e-9)) continue;
      hitEv(g, u); g.damage(h, u, s.damage, { kind: 'skill' });
      if (u.kind === 'hero' && u.alive) push(g, u, d > 1e-6 ? ux / d : aim.dx, d > 1e-6 ? uy / d : aim.dy, s.pushDistance, s.pushSpeed);
    }
    g.events.push({ type: 'cone', t: g.time, x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, r: s.range, angle: (s.angleDeg * Math.PI) / 180, fx: 'fx-chiyan-sweep' });
  },
  ring(g, h, s, aim, _p, ev) {
    let dx = aim.x - h.x, dy = aim.y - h.y; const L = hyp(dx, dy);
    if (L < 1e-6) { land(g, h, s, ev); return; }
    dx /= L; dy /= L; h.faceX = dx; h.faceY = dy;
    st(h).dash = { type: 'leap', dx, dy, left: L, speed: s.leapSpeed, s, total: L, ...ev };
    g.events.push({ type: 'leap', t: g.time, x: h.x, y: h.y, x2: aim.x, y2: aim.y, who: h.id });
  },
};
function healOne(g: G, h: H, a: H, s: any, shield: number, set: Set<number>): void {
  set.add(a.id); const before = a.hp; a.hp = Math.min(a.maxHp, a.hp + s.heal);
  if (shield > 0) addShield(g, a, shield, s.shieldSeconds ?? 2, 'fx-xuanyuan-bulwark');
  g.events.push({ type: 'heal', t: g.time, x: a.x, y: a.y, amount: a.hp - before, shield, mine: a === g.player || h === g.player });
}
function land(g: G, h: H, s: any, ev: any): void {
  for (const u of enemies(g, h.team)) if (dist(u, h) <= s.radius + 1e-6) { hitEv(g, u); g.damage(h, u, s.damage, { kind: 'skill' }); }
  const band = s.width / 2, was = new Map<number, boolean>();
  for (const e of g.heroes) if (e.team !== h.team) was.set(e.id, Math.abs(dist(e, h) - s.radius) <= band);
  g.rings.push({ x: h.x, y: h.y, r: s.radius, band, born: g.time, until: g.time + s.seconds, owner: h, team: h.team, s, hit: new Set(), was, ...ev });
  g.events.push({ type: 'ringLand', t: g.time, x: h.x, y: h.y, r: s.radius });
}

// ---------------------------------------------------------------- 每步推进
/** 英雄自己的技能状态推进。返回 true 表示这一步不能自由行动（被推拉、突进、跃击或眩晕）。 */
export function heroTick(g: G, h: H, dt: number): boolean {
  const k = st(h), T = g.time;
  if (isNaN(k.px)) { k.px = h.x; k.py = h.y; }
  syncShield(g, h);
  if (T >= h.rootUntil) h.stunned = false;
  if (k.guard && k.guard.until <= T) k.guard = null;
  if (k.ward && (k.ward.until <= T || !k.ward.ally.alive || dist(k.ward.ally, h) > (skillOf(g, h, 'ward')?.breakRange ?? 132))) endWard(h);
  if (k.thread && (k.thread.until <= T || !k.thread.ally.alive || dist(k.thread.ally, h) > (skillOf(g, h, 'thread')?.breakRange ?? 138))) { st(k.thread.ally).threadBy = null; k.thread = null; }
  // 被推、被拉：受控位移，撞到实体就停
  if (k.forced) {
    const f = k.forced, want = Math.min(f.speed * dt, f.left), r = sweep(g, h, f.dx, f.dy, want); f.left -= r.moved; h.moving = false;
    if (r.hit) { if (f.wall && h.alive) { hitEv(g, h); stun(g, h, f.wall.stun); g.damage(f.wall.src, h, f.wall.dmg, { kind: 'skill' }); g.events.push({ type: 'wallHit', t: T, x: h.x, y: h.y }); } k.forced = null; }
    else if (f.left <= 0.01) k.forced = null;
    return true;
  }
  if (h.stunned) return true;
  if (k.dash) { k.dash.type === 'ram' ? stepRam(g, h, dt) : stepLeap(g, h, dt); return true; }
  if (k.guard) { h.faceX = k.guard.dx; h.faceY = k.guard.dy; }
  if (k.casting) { k.casting.left -= dt; if (k.casting.left <= 1e-9) fire(g, h); }
  return false;
}
/** 举盾期间朝向固定：英雄走完位后再把朝向拧回盾面 */
export function afterMove(g: G, h: H): void { const k = st(h); if (k.guard) { h.faceX = k.guard.dx; h.faceY = k.guard.dy; } }
function stepRam(g: G, h: H, dt: number): void {
  const d = st(h).dash, s = d.s, ox = h.x, oy = h.y, want = Math.min(d.speed * dt, d.left), r = sweep(g, h, d.dx, d.dy, want);
  h.moving = true; d.left -= r.moved;
  const half = s.width / 2, hits = enemies(g, h.team).filter((u) => !d.hit.has(u.id)).map((u) => ({ u, sd: segDist(u.x, u.y, ox, oy, h.x, h.y) })).filter((o) => o.sd[0] <= half + 1e-6).sort((a, b) => a.sd[1] - b.sd[1] || byId(a.u, b.u));
  for (const { u, sd } of hits) {
    d.hit.add(u.id); hitEv(g, u);
    if (u.kind !== 'hero') { g.damage(h, u, s.damage, { kind: 'skill' }); continue; }
    const back = Math.max(0, sd[1] - 1); h.x = ox + d.dx * Math.min(back, r.moved); h.y = oy + d.dy * Math.min(back, r.moved);       // 停在接触位置
    g.damage(h, u, s.damage, { kind: 'skill' });
    if (u.alive) push(g, u, d.dx, d.dy, s.pushDistance + (d.emp ? s.guardBonusPush : 0), s.pushSpeed, { dmg: s.wallDamage, stun: s.stunSeconds, src: h });
    st(h).dash = null; return;
  }
  if (r.hit || d.left <= 0.01) st(h).dash = null;
}
function stepLeap(g: G, h: H, dt: number): void {
  const d = st(h).dash, want = Math.min(d.speed * dt, d.left), r = sweep(g, h, d.dx, d.dy, want);
  h.moving = true; d.left -= r.moved;
  if (r.hit || d.left <= 0.01) { st(h).dash = null; land(g, h, d.s, { castId: d.castId, heroId: d.heroId, skillId: d.skillId }); }
}

/** 全局推进：飞行物、星河阵、灯、陷阱、归鹤、枪围越线。在所有单位移动之后调用。 */
export function update(g: G, dt: number): void {
  const T = g.time;
  // —— 直线弹：弦月（折返）与满弦 ——
  for (const c of g.crescents) {
    const ox = c.x, oy = c.y; let stepLen: number;
    if (c.back) {
      c.backT += dt; const bx = c.src.x - c.x, by = c.src.y - c.y, L = hyp(bx, by);
      if (!c.src.alive || L <= 12 || c.backT > c.retMax) { c.left = 0; continue; }
      c.dx = bx / L; c.dy = by / L; stepLen = Math.min(c.retSpeed * dt, L); c.left = L;
    } else stepLen = Math.min(c.speed * dt, c.left);
    c.x += c.dx * stepLen; c.y += c.dy * stepLen;
    const hits = enemies(g, c.src.team).filter((u) => !c.hit.has(u.id)).map((u) => ({ u, sd: segDist(u.x, u.y, ox, oy, c.x, c.y) })).filter((o) => o.sd[0] <= c.width / 2 + 1e-6).sort((a, b) => a.sd[1] - b.sd[1] || byId(a.u, b.u));
    for (const { u } of hits) {
      c.hit.add(u.id); hitEv(g, u);
      if (c.kind === 'draw') {
        let dmg = c.first ? c.base : c.base * c.second;
        if (c.first && takeMark(g, u, 'snare', c.src)) { dmg += c.bonus; g.events.push({ type: 'detonate', t: T, x: u.x, y: u.y }); }
        c.first = false; g.damage(c.src, u, dmg, { kind: 'proj' });
      } else {
        g.damage(c.src, u, c.damage, { kind: 'proj' });
        if (u.alive && c.mark) mark(g, u, 'moon', c.src, c.mark);
      }
    }
    if (!c.back) {
      c.left -= stepLen;
      if (c.left <= 0.01 && c.ret > 0 && c.src.alive) { c.back = true; c.backT = 0; c.damage = c.base * c.ret; c.hit = new Set(); c.left = 1; }
    }
  }
  g.crescents = g.crescents.filter((c: any) => c.left > 0.01);
  // —— 星河阵 ——
  for (const z of g.zones) {
    const inside = () => enemies(g, z.team).filter((u) => hyp(u.x - z.x, u.y - z.y) <= z.r + 1e-6);
    while (z.n < z.ticks && z.next <= T + 1e-9) {
      for (const u of inside()) { addSlow(g, u, z.slow, z.slowSecs); hitEv(g, u); g.damage(z.src, u, z.dmg, { kind: 'zone' }); }
      z.n++; z.next += z.tick;
    }
    if (z.n >= z.ticks && !z.done) {
      z.done = true;
      for (const u of inside()) { root(g, u, z.finalRoot); g.damage(z.src, u, z.final, { kind: 'zone' }); if (u.alive && z.mark) mark(g, u, 'moon', z.src, z.mark); }
      g.events.push({ type: 'beacon', t: T, x: z.x, y: z.y, r: z.r, fx: 'fx-xingli-beacon', quiet: true }, { type: 'zoneEnd', t: T, x: z.x, y: z.y });
    }
  }
  g.zones = g.zones.filter((z: any) => !z.done);
  // —— 落灯：每秒给圈内友方英雄回血，含最后一跳 ——
  for (const l of g.lamps) {
    while (l.next <= T + 1e-9 && l.next <= l.until + 1e-9) {
      for (const a of g.heroes) if (a.alive && a.team === l.team && hyp(a.x - l.x, a.y - l.y) <= l.r + 1e-6 && a.hp < a.maxHp) { const b = a.hp; a.hp = Math.min(a.maxHp, a.hp + l.heal); g.events.push({ type: 'heal', t: T, x: a.x, y: a.y, amount: a.hp - b, mine: a === g.player }); }
      l.next += l.tick;
    }
  }
  g.lamps = g.lamps.filter((l: any) => T < l.until + 1e-9 && l.next <= l.until + 1e-9);
  // —— 伏矢：布防后第一个踩进来的敌方英雄触发 ——
  for (const t of g.traps) {
    if (T < t.armAt) continue;
    const c = g.heroes.filter((e: H) => e.alive && e.team !== t.team && hyp(e.x - t.x, e.y - t.y) <= t.r + 1e-6).sort((a: H, b: H) => hyp(a.x - t.x, a.y - t.y) - hyp(b.x - t.x, b.y - t.y) || byId(a, b))[0];
    if (!c) continue;
    t.done = true; root(g, c, t.s.rootSeconds); st(c).exposedUntil = Math.max(st(c).exposedUntil, T + t.s.revealSeconds); c.revealUntil = Math.max(c.revealUntil, T + t.s.revealSeconds);
    g.damage(t.owner, c, t.s.damage, { kind: 'trap' }); if (c.alive) mark(g, c, 'snare', t.owner, t.s.markSeconds);
    g.events.push({ type: 'trapHit', t: T, x: t.x, y: t.y, r: t.r });
  }
  g.traps = g.traps.filter((t: any) => !t.done && T < t.until);
  // —— 归鹤 ——
  for (const f of g.flyers) {
    const ox = f.x, oy = f.y, stepLen = Math.min(f.speed * dt, f.left); f.x += f.dx * stepLen; f.y += f.dy * stepLen; f.left -= stepLen;
    for (const a of g.heroes) if (a.alive && a.team === f.team && !f.set.has(a.id) && segDist(a.x, a.y, ox, oy, f.x, f.y)[0] <= f.width / 2 + 1e-6) healOne(g, f.owner, a, f.s, f.shield, f.set);
  }
  g.flyers = g.flyers.filter((f: any) => f.left > 0.01);
  // —— 枪围：敌方英雄这一步的位移线段碰到边线带就触发（每人每圈一次）——
  for (const r of g.rings) {
    for (const e of g.heroes) {
      if (e.team === r.team) continue;
      const k = st(e), ex = e.x, ey = e.y, sx = k.teleported || isNaN(k.px) ? ex : k.px, sy = k.teleported || isNaN(k.py) ? ey : k.py;
      const inBand = (x: number, y: number) => Math.abs(hyp(x - r.x, y - r.y) - r.r) <= r.band + 1e-9;
      const was = r.was.get(e.id) ?? false; r.was.set(e.id, inBand(ex, ey));
      if (!e.alive || r.hit.has(e.id) || was) continue;
      const dmin = segDist(r.x, r.y, sx, sy, ex, ey)[0], dmax = Math.max(hyp(sx - r.x, sy - r.y), hyp(ex - r.x, ey - r.y));
      if (dmin <= r.r + r.band && dmax >= r.r - r.band) {
        r.hit.add(e.id); addSlow(g, e, r.s.slowFraction, r.s.slowSeconds); g.damage(r.owner, e, r.s.entryDamage, { kind: 'ring' });
        g.events.push({ type: 'ringHit', t: T, x: e.x, y: e.y });
      }
    }
  }
  g.rings = g.rings.filter((r: any) => T < r.until);
  for (const h of g.heroes) { const k = st(h); k.px = h.x; k.py = h.y; k.teleported = false; }
}

// ---------------------------------------------------------------- AI 施法（?aiskills=1、托管、平衡跑批）
export function ai(g: G, h: H): void {
  if (!h.alive || !(g.aiSkills || (h.isPlayer && g.autopilot))) return;
  const k = st(h), T = g.time;
  if (k.aiCharge) { aiDraw(g, h); return; }
  if (T < k.aiNext || T - k.lastAccept < 0.35 || k.casting || k.dash || h.stunned) return;
  k.aiNext = T + 0.2;
  const sk = g.skillsOf(h), idx = (id: string) => sk.findIndex((s: any) => s.id === id), ready = (id: string) => { const i = idx(id); return i >= 0 && h.cds[i] <= 0; };
  const E: H[] = enemyHeroes(g, h.team).filter((e) => g.visible(e, h.team)).sort((a, b) => dist(a, h) - dist(b, h)), e0 = E[0], d0 = e0 ? dist(e0, h) : 1e9;
  const M: U[] = g.minions.filter((m: U) => m.alive && m.team !== h.team && g.visible(m, h.team));
  const A = allies(g, h), retreat = h.ai === 'retreat', hpf = (u: H) => u.hp / u.maxHp;
  const at = (u: U) => { const d = dist(u, h) || 1; return { x: u.x, y: u.y, dx: (u.x - h.x) / d, dy: (u.y - h.y) / d, target: undefined as any }; };
  const go = (id: string, aim: any) => cast(g, idx(id), aim, h).ok;
  const safe = (x: number, y: number) => !g.unsafe(h.team, x, y);
  switch (h.sprite) {
    case 'xingli': {
      if (retreat) return;
      const marked = E.find((e) => hasMark(g, e, 'moon', h) && dist(e, h) <= 140);
      if (marked && ready('beacon') && go('beacon', at(marked))) return;
      if (ready('starfield')) {
        for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) { const mx = (E[i].x + E[j].x) / 2, my = (E[i].y + E[j].y) / 2; if (dist(E[i], E[j]) <= 100 && hyp(mx - h.x, my - h.y) <= 150 && go('starfield', { x: mx, y: my, dx: 0, dy: 0 })) return; }
        const held = E.find((e) => T < e.rootUntil && dist(e, h) <= 150 && M.filter((m) => dist(m, e) <= 66).length >= 2);
        if (held && go('starfield', at(held))) return;
      }
      if (ready('crescent')) {
        if (e0 && d0 <= 158 && go('crescent', at(e0))) return;
        const m = M.filter((m) => dist(m, h) <= 150).sort((a, b) => dist(a, h) - dist(b, h))[0];
        if (m) { const a = at(m), n = M.filter((u) => { const sd = segDist(u.x, u.y, h.x, h.y, h.x + a.dx * 165, h.y + a.dy * 165); return sd[0] <= 13; }).length; if (n >= 2 && go('crescent', a)) return; }
      }
      if (ready('beacon')) { const c = M.find((m) => dist(m, h) <= 140 && M.filter((u) => dist(u, m) <= 42).length >= 3); if (c && go('beacon', at(c))) return; }
      return;
    }
    case 'xuanyuan': {
      if (ready('ward')) { const a = A.find((a) => hpf(a) <= 0.55 && dist(a, h) <= 108 && E.some((e) => dist(e, a) <= 75)); if (a && go('ward', { ...at(a), target: a.id })) return; }
      if (ready('guard')) {
        const thr = E.find((e) => dist(e, h) <= e.ba.range + 14) ?? g.projectiles.find((p: any) => p.target === h && p.team !== h.team)?.src;
        if (thr && go('guard', at(thr))) return;
      }
      if (!retreat && ready('ram') && e0 && d0 <= 72 && T >= h.rootUntil) {
        const a = at(e0), emp = !!(k.guard && k.guard.blocked >= 45), wall = clearLen(g, e0.x, e0.y, a.dx, a.dy, emp ? 60 : 42, e0.r) < (emp ? 60 : 42) - 1.6;
        if ((wall || emp || hpf(e0) <= 0.5) && safe(e0.x, e0.y) && go('ram', a)) return;
      }
      return;
    }
    case 'hedeng': {
      const hurt = allies(g, h, true).filter((a) => a.maxHp - a.hp >= 45).sort((a, b) => hpf(a) - hpf(b));
      if (ready('recall')) {
        const link = k.thread?.ally, cand = [h, ...(link ? [link] : [])].filter((a) => a.maxHp - a.hp >= 35);
        if ((cand.length >= 2 || cand.some((a) => hpf(a) <= 0.4)) && go('recall', { x: h.x, y: h.y, dx: 0, dy: 0 })) return;
      }
      if (ready('perch')) { const a = hurt.find((a) => dist(a, h) <= 130 && walkable(g, a.x, a.y, 4)); if (a && go('perch', at(a))) return; }
      if (ready('thread')) { const a = A.filter((a) => dist(a, h) <= 110).find((a) => (hpf(a) <= 0.7 && a.ai === 'retreat') || a.maxHp - a.hp >= 35); if (a && go('thread', { ...at(a), target: a.id })) return; }
      return;
    }
    case 'yelan': {
      if (ready('reap') && !retreat) { const t = E.find((e) => dist(e, h) <= 46 && (hpf(e) <= 0.28 || e.hp <= 76 + (hasMark(g, e, 'hunt', h) ? 12 : 0))); if (t && go('reap', at(t))) return; }
      if (ready('backstep') && !retreat && T >= h.rootUntil) { const t = E.find((e) => dist(e, h) <= 92 && (hpf(e) <= 0.6 || veiled(g, h)) && safe(e.x, e.y)); if (t && go('backstep', { ...at(t), target: t.id })) return; }
      if (ready('veil')) { if ((retreat && hpf(h) <= 0.4) || E.some((e) => { const d = dist(e, h); return d >= 80 && d <= 140 && hpf(e) <= 0.65 && safe(e.x, e.y); })) { if (go('veil', { x: h.x, y: h.y, dx: 0, dy: 0 })) return; } }
      return;
    }
    case 'feixian': {
      if (retreat) return;
      if (ready('stance') && e0 && d0 >= 100 && d0 <= 150 && !E.some((e) => dist(e, h) <= 65) && go('stance', { x: h.x, y: h.y, dx: 0, dy: 0 })) return;
      if (ready('snare') && e0 && d0 <= 118) { const vx = e0.moving ? e0.faceX * e0.speed * 0.5 : 0, vy = e0.moving ? e0.faceY * e0.speed * 0.5 : 0; let x = e0.x + vx, y = e0.y + vy; if (hyp(x - h.x, y - h.y) > 121 || !walkable(g, x, y, 4)) { x = e0.x; y = e0.y; } if (walkable(g, x, y, 4) && go('snare', { x, y, dx: 0, dy: 0 })) return; }
      if (ready('draw') && !E.some((e) => dist(e, h) <= 55)) {
        const t = E.find((e) => hasMark(g, e, 'snare', h) && dist(e, h) <= 175) ?? (e0 && d0 <= 170 ? e0 : null);
        const many = !t && M.filter((m) => dist(m, h) <= 150).length >= 3;
        if ((t || many) && beginCharge(g, idx('draw'), h).ok) { k.aiCharge = true; return; }
      }
      return;
    }
    case 'chiyan': {
      if (ready('ring') && !retreat && T >= h.rootUntil) {
        for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) { const mx = (E[i].x + E[j].x) / 2, my = (E[i].y + E[j].y) / 2; if (dist(E[i], E[j]) <= 100 && hyp(mx - h.x, my - h.y) <= 97 && walkable(g, mx, my, h.r) && safe(mx, my) && go('ring', { x: mx, y: my, dx: 0, dy: 0 })) return; }
        const held = E.find((e) => (T < e.rootUntil || T < e.slowUntil) && dist(e, h) <= 97 && safe(e.x, e.y) && walkable(g, e.x, e.y, h.r));
        if (held && go('ring', at(held))) return;
      }
      if (ready('hook') && !retreat && e0 && d0 <= 80 && d0 > 34 && safe(h.x, h.y) && go('hook', at(e0))) return;
      if (ready('sweep') && e0 && d0 <= 55 && go('sweep', at(e0))) return;
      return;
    }
  }
}
function aiDraw(g: G, h: H): void {
  const k = st(h), i = g.skillsOf(h).findIndex((s: any) => s.id === 'draw');
  if (!k.charge) { k.aiCharge = false; return; }
  const E = enemyHeroes(g, h.team).filter((e) => g.visible(e, h.team)).sort((a, b) => dist(a, h) - dist(b, h));
  if (E.some((e) => dist(e, h) <= 50) || h.ai === 'retreat') { cancelCharge(g, h); return; }
  if (chargeQ(g, h) < 1) return;
  const t = E.find((e) => dist(e, h) <= 178) ?? g.minions.filter((m: U) => m.alive && m.team !== h.team && dist(m, h) <= 170).sort((a: U, b: U) => dist(a, h) - dist(b, h))[0];
  if (!t) { cancelCharge(g, h); return; }
  const lead = dist(t, h) / 520, px = t.x + (t.moving ? t.faceX * t.speed * lead : 0), py = t.y + (t.moving ? t.faceY * t.speed * lead : 0), d = hyp(px - h.x, py - h.y) || 1;
  cast(g, i, { x: px, y: py, dx: (px - h.x) / d, dy: (py - h.y) / d }, h);
}
