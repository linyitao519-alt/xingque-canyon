// 六名英雄 18 个技能的规则测试（docs/claude-prompt.md 第 8 节逐条）+ 通用回归。node --test tests/skills.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, HERO_IDS } from '../dist/sim.js';
import * as Skills from '../dist/skills.js';

const load = (f) => JSON.parse(readFileSync(new URL('../assets/data/' + f, import.meta.url), 'utf8'));
const map = load('map.json'), rules = load('match-rules.json');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const run = (g, secs) => { const n = Math.round(secs * 60); for (let i = 0; i < n; i++) g.update(1 / 60); };
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const S = (hero, id) => rules.heroes[hero].skills.find((s) => s.id === id);
const slot = (hero, id) => rules.heroes[hero].skills.findIndex((s) => s.id === id);

/** 玩家用指定英雄站在 (600,600) 面朝 +x；其余英雄不动；不出兵；塔不开火；没有布景碰撞 */
function setup(hero) {
  const g = new Game(structuredClone(map), structuredClone(rules));
  g.playerHero = hero; g.reset();
  g.controlBot = () => {}; g.nextWave = 1e9;
  for (const t of g.towers) t.range = 0;
  const p = g.player; p.x = 600; p.y = 600; p.faceX = 1; p.faceY = 0;
  const free = { red: g.heroes.filter((h) => h.team === 'red'), blue: g.heroes.filter((h) => h.team === 'blue' && h !== p) };
  const place = (team) => (x, y, hp = 1000) => { const h = free[team].shift(); h.x = x; h.y = y; h.hp = h.maxHp = hp; h.faceX = team === 'red' ? -1 : 1; h.faceY = 0; h.sk.px = x; h.sk.py = y; return h; };
  g.update(1 / 60);
  return { g, p, foe: place('red'), ally: place('blue') };
}
const minion = (g, x, y, hp = 1000) => {
  const m = { id: 90000 + g.minions.length, team: 'red', x, y, r: 6, hp, maxHp: hp, alive: true, brush: -1, revealUntil: 0, slowUntil: 0, slowFrac: 0, rootUntil: 0, moonUntil: 0, hitT: -9, faceX: -1, faceY: 0,
    kind: 'minion', mkind: 'melee', lane: 'mid', speed: 0, range: 0, dmg: 0, interval: 99, atkCd: 99, atkT: -9, progress: 0, target: null, moving: false };
  g.minions.push(m); return m;
};
const cast = (g, hero, id, aim) => g.castSkill(slot(hero, id), { x: 0, y: 0, dx: 1, dy: 0, ...aim });
const casts = (g) => g.events.filter((e) => e.type === 'cast').length;

// ================================================================ 星璃
test('弦月：双程目标扣 112 并带 4 秒同源月痕；只被单程命中的扣 70；中间的单位不挡', () => {
  const { g, p } = setup('xingli'); const a = minion(g, 680, 600), mid = minion(g, 720, 600), b = minion(g, 750, 600);
  assert.ok(cast(g, 'xingli', 'crescent', {}).ok);
  for (let i = 0; i < 90; i++) { g.update(1 / 60); if (b.hp < 1000 && b.x === 750) b.y = 900; }          // b 被去程打到后离开路径
  assert.ok(near(a.hp, 1000 - 112), `a ${a.hp}`); assert.ok(near(mid.hp, 1000 - 112)); assert.ok(near(b.hp, 930), `b ${b.hp}`);
  assert.ok(Skills.hasMark(g, a, 'moon', p)); assert.ok(near(a.sk.marks.moon.until - g.time, 4, 1.2));
  assert.equal(g.crescents.length, 0); assert.ok(near(p.cds[0], 4.5, 1.6));
});
test('定星：带同源月痕的目标掉 100、定身 0.8 秒、月痕清掉；别的来源留下的月痕不被消费', () => {
  const { g, p } = setup('xingli'); const x = minion(g, 660, 590), y = minion(g, 660, 610);
  Skills.mark(g, x, 'moon', p, 4); Skills.mark(g, y, 'moon', { id: 424242 }, 4);
  assert.ok(cast(g, 'xingli', 'beacon', { x: 660, y: 600 }).ok); const t0 = g.time; run(g, 0.2);
  assert.ok(near(x.hp, 900)); assert.ok(near(x.rootUntil - t0, 0.18 + 0.8, 0.03)); assert.ok(!Skills.hasMark(g, x, 'moon', p));
  assert.ok(near(y.hp, 945)); assert.ok(y.sk.marks.moon && y.sk.marks.moon.src === 424242 && y.rootUntil === 0);
  assert.ok(x.slowFrac === 0.35 && x.slowUntil > g.time);
});
test('星河阵：圈内静留的目标六跳加末爆共扣 200；末爆前离圈的不被定身、不补月痕', () => {
  const { g, p, foe } = setup('xingli'); const stay = foe(660, 600), leave = foe(680, 600);
  assert.ok(cast(g, 'xingli', 'starfield', { x: 660, y: 600 }).ok); run(g, 0.25 + 2.8);
  leave.x = 900; leave.y = 600; const hpL = leave.hp; run(g, 0.6);
  assert.ok(near(stay.hp, 800), `stay ${stay.hp}`); assert.ok(stay.rootUntil > g.time - 0.6 && Skills.hasMark(g, stay, 'moon', p));
  assert.equal(leave.hp, hpL); assert.equal(leave.rootUntil, 0); assert.ok(!Skills.hasMark(g, leave, 'moon', p)); assert.equal(g.zones.length, 0);
});

// ================================================================ 玄垣
test('举盾：正面 100 只扣 35，侧背 100 全吃；多次正面命中总格挡不超过 135', () => {
  const { g, p, foe } = setup('xuanyuan'); const front = foe(650, 600), back = foe(550, 600);
  assert.ok(cast(g, 'xuanyuan', 'guard', {}).ok); run(g, 0.1); const hp = p.hp;
  g.damage(front, p, 100); assert.ok(near(p.hp, hp - 35));
  g.damage(back, p, 100); assert.ok(near(p.hp, hp - 135));
  g.damage(front, p, 100); g.damage(front, p, 100); g.damage(front, p, 100);
  assert.ok(near(p.sk.guard.blocked, 135)); assert.ok(near(p.hp, hp - 135 - 35 - 95 - 100), `hp ${hp - p.hp}`);
});
test('盾撞：强化后把目标推到实墙上共掉 78 并眩晕 0.7 秒；自然推完只掉 44', () => {
  let { g, p, foe } = setup('xuanyuan'); let e = foe(640, 600); g.colliders.push({ x: 695, y: 600, r: 10 });
  cast(g, 'xuanyuan', 'guard', {}); run(g, 0.1); g.damage(e, p, 100); assert.ok(p.sk.guard.blocked >= 45);
  assert.ok(cast(g, 'xuanyuan', 'ram', {}).ok); run(g, 1.2);
  assert.ok(near(e.hp, 1000 - 78), `e ${e.hp}`); assert.ok(e.x > 660 && e.x < 676, `e.x ${e.x}`); assert.equal(p.sk.guard, null);
  ({ g, p, foe } = setup('xuanyuan')); e = foe(640, 600);
  assert.ok(cast(g, 'xuanyuan', 'ram', {}).ok); run(g, 0.3); assert.ok(!e.stunned);
  run(g, 0.9); assert.ok(near(e.hp, 1000 - 44)); assert.ok(near(e.x, 682, 0.01), `e.x ${e.x}`); assert.ok(p.x > 610 && p.x < 640);
});
test('护阵：100 合格伤害分成 55 与 45，再各自过护盾；塔的伤害不转移', () => {
  const { g, p, foe, ally } = setup('xuanyuan'); const a = ally(640, 600), e = foe(700, 600);
  assert.ok(cast(g, 'xuanyuan', 'ward', { x: 640, y: 600 }).ok); run(g, 0.25);
  assert.ok(near(a.shield, 72)); const hpA = a.hp, hpP = p.hp;
  g.damage(e, a, 100); assert.ok(near(a.shield, 17), `shield ${a.shield}`); assert.equal(a.hp, hpA); assert.ok(near(p.hp, hpP - 45));
  g.damage(g.towers.find((t) => t.team === 'red'), a, 60); assert.ok(near(a.hp, hpA - 43)); assert.ok(near(p.hp, hpP - 45));
  a.x = 600 + 140; run(g, 0.05); assert.equal(p.sk.ward, null);
});

// ================================================================ 鹤灯
test('落灯：圈内缺血的队友待满 6 秒共回 78，圈外不回；新灯替换旧灯', () => {
  const { g, p, ally } = setup('hedeng'); const a = ally(640, 600), out = ally(640, 700); a.hp = 500; out.hp = 500; p.hp = p.maxHp;
  assert.ok(cast(g, 'hedeng', 'perch', { x: 650, y: 600 }).ok); run(g, 0.2); assert.equal(g.lamps.length, 1);
  run(g, 6.2); assert.ok(near(a.hp, 578), `a ${a.hp}`); assert.equal(out.hp, 500); assert.equal(g.lamps.length, 0);
  p.cds[0] = 0; cast(g, 'hedeng', 'perch', { x: 650, y: 600 }); run(g, 0.3); p.cds[0] = 0; cast(g, 'hedeng', 'perch', { x: 560, y: 600 }); run(g, 0.3);
  assert.equal(g.lamps.length, 1); assert.equal(g.lamps[0].x, 560);
});
test('鹤引：连线期间双方移速 +14%；拉开到 138 以外的下一步就断线并撤销加速', () => {
  const { g, p, ally } = setup('hedeng'); const a = ally(650, 600);
  assert.ok(cast(g, 'hedeng', 'thread', { x: 650, y: 600 }).ok); run(g, 0.15);
  assert.ok(near(Skills.speedMul(g, p), 1.14)); assert.ok(near(Skills.speedMul(g, a), 1.14));
  a.x = 600 + 139; g.update(1 / 60); assert.equal(p.sk.thread, null); assert.ok(near(Skills.speedMul(g, p), 1)); assert.ok(near(Skills.speedMul(g, a), 1));
});
test('归鹤：两条路线都经过的同一名队友只回 72；有灯起飞加 35 护盾；灯被消耗', () => {
  const { g, p, ally } = setup('hedeng'); const linked = ally(700, 600), both = ally(660, 590); p.hp = 100; linked.hp = 100; both.hp = 100;
  cast(g, 'hedeng', 'perch', { x: 660, y: 600 }); run(g, 0.2); cast(g, 'hedeng', 'thread', { x: 700, y: 600 }); run(g, 0.15);
  assert.ok(cast(g, 'hedeng', 'recall', { tap: true }).ok); run(g, 0.9);
  assert.ok(near(both.hp, 172), `both ${both.hp}`); assert.ok(near(both.shield, 35)); assert.ok(near(p.hp, 172)); assert.ok(near(linked.hp, 172)); assert.equal(g.lamps.length, 0); assert.equal(g.flyers.length, 0);
});

// ================================================================ 夜岚
test('匿影：33 外的敌人看不到也点不中，进到 32 内显形；掉了实际生命后匿影结束', () => {
  const { g, p, foe } = setup('yelan'); const e = foe(633, 600);
  assert.ok(cast(g, 'yelan', 'veil', { tap: true }).ok); run(g, 0.15);
  assert.equal(g.visible(p, 'red'), false); assert.equal(g.pickPlayerTarget(e), null);
  e.x = 632; assert.equal(g.visible(p, 'red'), true); e.x = 633;
  Skills.addShield(g, p, 20, 2); g.damage(e, p, 10); assert.ok(p.sk.veilUntil > g.time, '被护盾全吸收不破隐');
  g.damage(e, p, 30); assert.equal(p.sk.veilUntil, 0); assert.equal(g.visible(p, 'red'), true);
});
test('狐步：闪到目标身后扣 48，匿影起手扣 70；落脚点全被堵时坐标和冷却都不变', () => {
  let { g, p, foe } = setup('yelan'); let e = foe(660, 600);
  assert.ok(cast(g, 'yelan', 'backstep', { x: 660, y: 600 }).ok); run(g, 0.2);
  assert.ok(near(e.hp, 952)); assert.ok(near(p.x, 681) && near(p.y, 600), `p ${p.x},${p.y}`); assert.ok(Skills.hasMark(g, e, 'hunt', p));
  ({ g, p, foe } = setup('yelan')); e = foe(660, 600);
  cast(g, 'yelan', 'veil', { tap: true }); run(g, 0.15); cast(g, 'yelan', 'backstep', { x: 660, y: 600 }); run(g, 0.2);
  assert.ok(near(e.hp, 930)); assert.equal(p.sk.veilUntil, 0);
  ({ g, p, foe } = setup('yelan')); e = foe(660, 600); g.colliders.push({ x: 660, y: 600, r: 27 });
  const r = cast(g, 'yelan', 'backstep', { x: 660, y: 600 }); run(g, 0.3);
  assert.equal(r.ok, false); assert.equal(r.reason, 'spot'); assert.equal(p.x, 600); assert.equal(p.cds[1], 0); assert.equal(casts(g), 0);
});
test('断月：窗口内同一夜岚补刀返还一次狐步、匿影冷却减 4；队友补刀不返还', () => {
  let { g, p, foe, ally } = setup('yelan'); let e = foe(630, 600); e.hp = 200;
  p.cds[0] = 10; p.cds[1] = 5;
  assert.ok(cast(g, 'yelan', 'reap', {}).ok); run(g, 0.25);
  assert.ok(near(e.hp, 200 - 128), `e ${e.hp}`);
  g.damage(p, e, 100); assert.equal(e.alive, false); assert.equal(p.cds[1], 0); assert.ok(near(p.cds[0], 10 - 0.25 - 4, 0.02), `veil cd ${p.cds[0]}`);
  ({ g, p, foe, ally } = setup('yelan')); e = foe(630, 600); e.hp = 200; const a = ally(600, 640); p.cds[1] = 5;
  cast(g, 'yelan', 'reap', {}); run(g, 0.25); g.damage(a, e, 100); assert.equal(e.alive, false); assert.ok(p.cds[1] > 4);
});

// ================================================================ 绯弦
test('满弦：q=0 / q=1 的射程与伤害是 105/48 和 182/100；后续目标吃 65%；取消不进冷却、不发事件', () => {
  let { g, p } = setup('feixian'); let a = minion(g, 700, 600), b = minion(g, 716, 600);
  assert.ok(cast(g, 'feixian', 'draw', { q: 0 }).ok); run(g, 0.6); assert.ok(near(a.hp, 952)); assert.equal(b.hp, 1000);
  ({ g, p } = setup('feixian')); a = minion(g, 700, 600); b = minion(g, 780, 600); const c = minion(g, 795, 600);
  cast(g, 'feixian', 'draw', { q: 1 }); run(g, 0.7); assert.ok(near(a.hp, 900)); assert.ok(near(b.hp, 935)); assert.equal(c.hp, 1000);
  ({ g, p } = setup('feixian'));
  assert.ok(g.beginCharge(0).ok); run(g, 0.5); assert.ok(near(g.chargeQ(), 0.5 / 1.15, 0.03)); assert.ok(near(Skills.speedMul(g, p), 0.66));
  g.cancelCharge(); run(g, 0.3); assert.equal(p.cds[0], 0); assert.equal(casts(g), 0); assert.equal(g.crescents.length, 0);
  g.beginCharge(0); run(g, 2); assert.equal(g.chargeQ(), 1); assert.ok(g.castSkill(0, { x: 0, y: 0, dx: 1, dy: 0 }).ok); run(g, 0.12); assert.ok(near(g.crescents[0].base, 100));
});
test('伏矢：小兵踩不触发；布防后敌方英雄触发一次，掉 25、定身并留猎标；第三个陷阱淘汰最早的', () => {
  const { g, p, foe } = setup('feixian'); const m = minion(g, 650, 600);
  assert.ok(cast(g, 'feixian', 'snare', { x: 650, y: 600 }).ok); run(g, 0.16 + 0.45 + 0.1);
  assert.equal(m.hp, 1000); assert.equal(g.traps.length, 1);
  const e = foe(900, 600); e.x = 655; e.y = 600; const t0 = g.time; g.update(1 / 60);
  assert.ok(near(e.hp, 975)); assert.ok(near(e.rootUntil - t0, 0.85, 0.03)); assert.ok(Skills.hasMark(g, e, 'snare', p)); assert.equal(g.traps.length, 0);
  for (const x of [560, 580, 620]) { p.cds[1] = 0; cast(g, 'feixian', 'snare', { x, y: 640 }); run(g, 0.2); }
  assert.deepEqual(g.traps.map((t) => t.x), [580, 620]);
  // 猎标让下一发满弦对首个目标多 23
  m.y = 900; e.x = 700; e.y = 600; p.cds[0] = 0; const hp = e.hp; cast(g, 'feixian', 'draw', { q: 0 }); run(g, 0.5); assert.ok(near(e.hp, hp - 48 - 23)); assert.ok(!Skills.hasMark(g, e, 'snare', p));
});
test('鹰眼：130 外的英雄能被普攻且伤害 47；结束后射程回到 112；打塔没有额外 11', () => {
  const { g, p, foe } = setup('feixian'); const e = foe(730, 600);
  assert.equal(g.pickPlayerTarget(), null);
  assert.ok(cast(g, 'feixian', 'stance', { tap: true }).ok); run(g, 0.15);
  assert.equal(g.pickPlayerTarget(), e); assert.ok(near(Skills.speedMul(g, p), 0.7));
  g.input.attack = true; run(g, 0.75); g.input.attack = false; run(g, 0.3); assert.ok(near(e.hp, 1000 - 47), `e ${e.hp}`);
  assert.equal(Skills.attackDamage(g, p, g.towers[0]), 36);
  run(g, 5); assert.equal(g.pickPlayerTarget(), null); assert.equal(Skills.attackRange(g, p), 112);
});

// ================================================================ 赤檐
test('回钩：第一个英雄被拉到离出手位置不少于 29 处；他身后的英雄不受伤；被实体挡住时不中', () => {
  let { g, p, foe } = setup('chiyan'); let a = foe(670, 600), b = foe(680, 600); const m = minion(g, 640, 600);
  assert.ok(cast(g, 'chiyan', 'hook', {}).ok); run(g, 0.8);
  assert.ok(near(a.hp, 953)); assert.equal(b.hp, 1000); assert.ok(near(m.hp, 953)); assert.ok(near(d(a, p), 29, 0.01), `d ${d(a, p)}`); assert.equal(m.x, 640);
  ({ g, p, foe } = setup('chiyan')); a = foe(670, 600); g.colliders.push({ x: 640, y: 600, r: 8 });
  cast(g, 'chiyan', 'hook', {}); run(g, 0.5); assert.equal(a.hp, 1000); assert.equal(a.x, 670); assert.ok(p.cds[0] > 0, '成功出手后空掉不退冷却');
});
test('拒阵：扇内英雄扣 52 并被推到障碍前；扇内小兵扣 52 但不位移', () => {
  const { g, foe } = setup('chiyan'); const e = foe(640, 600), m = minion(g, 630, 615); g.colliders.push({ x: 676, y: 600, r: 8 });
  assert.ok(cast(g, 'chiyan', 'sweep', {}).ok); run(g, 0.8);
  assert.ok(near(e.hp, 948)); assert.ok(e.x > 650 && e.x < 659, `e.x ${e.x}`); assert.ok(near(m.hp, 948)); assert.equal(m.x, 630); assert.equal(m.y, 615);
});
test('枪围：敌方英雄被推过边线带时额外掉 26 一次，再次穿越不再掉；小兵穿越不触发', () => {
  const { g, p, foe } = setup('chiyan'); const e = foe(630, 600), m = minion(g, 600, 640);
  assert.ok(cast(g, 'chiyan', 'ring', { x: 600, y: 600 }).ok); run(g, 0.3);
  assert.equal(g.rings.length, 1); assert.ok(near(e.hp, 932)); assert.ok(near(m.hp, 932));
  assert.ok(cast(g, 'chiyan', 'sweep', {}).ok); run(g, 0.7);
  assert.ok(near(e.hp, 932 - 52 - 26), `e ${e.hp}`); assert.ok(e.x > 665); assert.ok(e.slowFrac === 0.38);
  const hp = e.hp; e.x = 600; g.update(1 / 60); e.x = 680; g.update(1 / 60); assert.equal(e.hp, hp);
  m.y = 680; g.update(1 / 60); assert.ok(near(m.hp, 932));
  run(g, 4); assert.equal(g.rings.length, 0);
});

// ================================================================ 通用回归
test('前摇被眩晕打断：不扣冷却、不发施法事件；定身时不能跃击但能站定施法', () => {
  let { g, p, foe } = setup('xingli'); const e = foe(660, 600);
  assert.ok(cast(g, 'xingli', 'starfield', { x: 660, y: 600 }).ok); Skills.stun(g, p, 0.5); run(g, 0.4);
  assert.equal(p.cds[2], 0); assert.equal(casts(g), 0); assert.equal(g.zones.length, 0);
  ({ g, p, foe } = setup('chiyan')); Skills.root(g, p, 1);
  assert.equal(cast(g, 'chiyan', 'ring', { x: 650, y: 600 }).reason, 'rooted'); assert.equal(p.cds[2], 0);
  assert.ok(cast(g, 'chiyan', 'sweep', {}).ok);
});
test('超距、没有目标、非法落点都不扣冷却；技能不伤塔和水晶', () => {
  let { g, p } = setup('xingli');
  assert.equal(cast(g, 'xingli', 'beacon', { x: 600 + 141, y: 600 }).reason, 'range'); assert.equal(p.cds[1], 0);
  ({ g, p } = setup('xuanyuan')); assert.equal(cast(g, 'xuanyuan', 'ward', { x: 640, y: 600 }).reason, 'target'); assert.equal(p.cds[2], 0);
  ({ g, p } = setup('hedeng')); g.colliders.push({ x: 650, y: 600, r: 12 }); assert.equal(cast(g, 'hedeng', 'perch', { x: 650, y: 600 }).reason, 'spot'); assert.equal(p.cds[0], 0);
  ({ g, p } = setup('xingli')); const tw = g.towers.find((t) => t.team === 'red' && t.lane === 'mid' && t.order === 1); p.x = tw.x - 60; p.y = tw.y; const hp = tw.hp;
  cast(g, 'xingli', 'crescent', {}); run(g, 1.2); p.cds[1] = 0; cast(g, 'xingli', 'beacon', { x: tw.x, y: tw.y }); run(g, 0.3); cast(g, 'xingli', 'starfield', { x: tw.x, y: tw.y }); run(g, 3.5);
  assert.equal(tw.hp, hp);
});
test('减速取最强、加速取最强；护盾取最大的一份且扣减同时作用于重叠份额', () => {
  const { g, p, foe } = setup('xuanyuan'); const e = foe(700, 600);
  Skills.addSlow(g, e, 0.2, 2); Skills.addSlow(g, e, 0.4, 1); assert.ok(near(Skills.speedMul(g, e), 0.6)); run(g, 1.1); assert.ok(near(Skills.speedMul(g, e), 0.8));
  Skills.addShield(g, p, 72, 3); Skills.addShield(g, p, 35, 3); const hp = p.hp;
  g.damage(e, p, 50); assert.ok(near(p.shield, 22)); assert.equal(p.hp, hp);
  g.damage(e, p, 30); assert.ok(near(p.shield, 0)); assert.ok(near(p.hp, hp - 8));
});
test('六名英雄各自托管、AI 技能全开打一局：都能结算，不报错', () => {
  for (const id of HERO_IDS) {
    const g = new Game(structuredClone(map), structuredClone(rules)); g.playerHero = id; g.aiSkills = true; g.reset(); g.autopilot = true;
    let n = 0; while (!g.over && n++ < 30000) g.update(1 / 30);
    assert.ok(g.over, `${id} 结算`);
    assert.ok(g.events.length >= 0);
  }
});
