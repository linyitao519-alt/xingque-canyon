// 无画面规则验证：npm test   （先 npm run build）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game, LANES, TEAMS } from '../dist/sim.js';
import { Polyline } from '../dist/nav.js';

const load = (f) => JSON.parse(readFileSync(new URL('../assets/data/' + f, import.meta.url), 'utf8'));
const map = load('map.json'), rules = load('match-rules.json');
const scenery = load('scenery.json');
const extra = scenery.props.filter((p) => p.blockRadius > 0).map((p) => ({ x: p.pos[0], y: p.pos[1], r: p.blockRadius }));
const mk = (over = {}) => new Game(map, { ...rules, ...over }, extra);
const run = (g, secs, each) => { for (let t = 0; t < secs && !g.over; t += 1 / 30) { g.update(1 / 30); each?.(g); } };
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** 在指定位置放一个红方近战兵当靶子 */
const dummy = (g, x, y, hp = 1000) => {
  const m = { id: 90000 + g.minions.length, team: 'red', x, y, r: 6, hp, maxHp: hp, alive: true, brush: -1, revealUntil: 0, slowUntil: 0, slowFrac: 0, rootUntil: 0, hitT: -9, faceX: -1, faceY: 0,
    kind: 'minion', mkind: 'melee', lane: 'mid', speed: 0, range: 0, dmg: 0, interval: 99, atkCd: 99, atkT: -9, progress: 0, target: null, moving: false };
  g.minions.push(m); return m;
};

test('三路都出兵：首波每队每路 2 近战 + 1 远程', () => {
  const g = mk(); run(g, 6);
  for (const team of TEAMS) for (const lane of LANES) {
    const ms = g.minions.filter((m) => m.team === team && m.lane === lane);
    assert.equal(ms.length, 3, `${team} ${lane}`);
    assert.deepEqual(ms.map((m) => m.mkind).sort(), ['melee', 'melee', 'ranged']);
  }
});

test('小兵沿路推进、在路中交战，全程不穿塔不进岩体', () => {
  const g = mk(); let fought = false;
  const raw = Object.fromEntries(LANES.map((l) => [l, new Polyline(map.lanes[l].blueToRed)]));
  run(g, 75, () => {
    for (const m of g.minions) {
      for (const c of g.colliders) assert.ok(Math.hypot(m.x - c.x, m.y - c.y) >= c.r + m.r - 1.5, '小兵进入了碰撞体');
      const p = raw[m.lane].at(raw[m.lane].project(m.x, m.y));
      assert.ok(Math.hypot(m.x - p[0], m.y - p[1]) < map.lanes[m.lane].nominalWidth, '小兵离开了自己的路');
      if (m.target && m.target.kind === 'minion') fought = true;
    }
  });
  assert.ok(fought, '双方小兵应当交战');
});

test('寻路绕开岩体；摇杆顶着岩体也只会贴边滑过', () => {
  const g = mk(), rock = map.staticObstacles[0], R = rock.radius + rules.heroDefaults.collisionRadius;
  const from = [rock.center[0] - 90, rock.center[1] + 4], to = [rock.center[0] + 90, rock.center[1] - 4];
  assert.equal(g.heroGrid.lineClear(...from, ...to), false, '直线应被岩体挡住');
  const path = [from, ...g.heroGrid.findPath(...from, ...to)];
  for (let i = 1; i < path.length; i++) for (let k = 0; k <= 20; k++) {
    const x = path[i - 1][0] + ((path[i][0] - path[i - 1][0]) * k) / 20, y = path[i - 1][1] + ((path[i][1] - path[i - 1][1]) * k) / 20;
    assert.ok(Math.hypot(x - rock.center[0], y - rock.center[1]) >= R, '路径穿过了岩体');
  }
  assert.ok(Math.hypot(path.at(-1)[0] - to[0], path.at(-1)[1] - to[1]) < 1);
  const p = g.player; p.x = from[0]; p.y = from[1]; g.input.mx = 1;
  run(g, 3.5, () => assert.ok(Math.hypot(p.x - rock.center[0], p.y - rock.center[1]) >= R - 0.01, '玩家进入了岩体'));
  assert.ok(p.x > rock.center[0] + rock.radius, '玩家应当滑过岩体继续前进');
});

test('中路底图里的桥柱和岩石：有碰撞、不压兵线、不堵野区入口；河道可蹚；兵线照常通过', () => {
  const g = mk(), mid = new Polyline(map.lanes.mid.blueToRed);
  assert.equal(extra.length, 10);   // 4 根桥柱和 6 块岩石均使用实际落点与碰撞
  const r = scenery.backdrop.worldRect;
  let minLane = Infinity;
  for (const p of scenery.props.filter((p) => p.blockRadius > 0)) {
    const [x, y] = p.pos, q = mid.at(mid.project(x, y));
    minLane = Math.min(minLane, Math.hypot(x - q[0], y - q[1]) - p.blockRadius);
    // 野区入口点上必须站得下一个英雄（半径 10）并留有余量
    for (const e of map.jungleEntrances) assert.ok(Math.hypot(x - e[0], y - e[1]) - p.blockRadius >= rules.heroDefaults.collisionRadius + 4, p.id + ' 堵住野区入口');
    assert.ok(x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1, p.id + ' 不在底图范围内');
  }
  // 小兵贴着中线走（寻路余量 9），带碰撞的物件内沿离中线至少 36 就不会挤到兵线（实测最近的是西桥柱 39.3）
  assert.ok(minLane >= 36, `布景离中路中线太近（最近 ${minLane.toFixed(1)}）`);
  for (const id of ['rock-e', 'pillar-n']) {
    const o = scenery.props.find((p) => p.id === id), pl = g.player, R = o.blockRadius + rules.heroDefaults.collisionRadius;
    pl.x = o.pos[0] - 50; pl.y = o.pos[1] - 6; g.input.mx = 1; g.input.my = 0;
    run(g, 3.5, () => assert.ok(Math.hypot(pl.x - o.pos[0], pl.y - o.pos[1]) >= R - 0.01, '玩家穿进了 ' + id));
    assert.ok(pl.x > o.pos[0], `应当贴着 ${id} 滑过（x=${pl.x.toFixed(0)}）`);
  }
  // 河道本身不挡路（map.json: blocksMovement=false）：从西岸直穿到东岸
  const riverGame = mk(), pl = riverGame.player; pl.x = 433; pl.y = 509; riverGame.input.mx = 0.733; riverGame.input.my = -0.68;
  run(riverGame, 120 / rules.heroDefaults.moveSpeed);
  assert.ok((pl.x - 473) * 0.733 + (pl.y - 472) * -0.68 > 40, `应能蹚过河道（${pl.x.toFixed(0)},${pl.y.toFixed(0)}）`);
  g.input.mx = g.input.my = 0;
  // 新塔位下双方一塔都在桥外，兵线在桥面上相遇：蓝兵要上桥过半、红兵也要上桥
  let blueOn = false, redOn = false;
  run(g, 40, () => { for (const m of g.minions) if (m.lane === 'mid') { if (m.team === 'blue' && m.x > 585) blueOn = true; if (m.team === 'red' && m.x < 615) redOn = true; } });
  assert.ok(blueOn && redOn, `双方中路小兵都应走上桥面（蓝 ${blueOn} 红 ${redOn}）`);
});

test('中路塔位（v9 试玩版）：双方一塔在桥外并关于桥心对称；桥心有一小段双方塔都打不到', () => {
  const g = mk(), C = [600, 600], R = rules.tower.attackRange, mid = new Polyline(map.lanes.mid.blueToRed), riv = new Polyline(map.river.centerline);
  const B = g.towersBy.blue.mid, Rd = g.towersBy.red.mid, d = (t) => Math.hypot(t.x - C[0], t.y - C[1]);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.hypot(B[i].x + Rd[i].x - 1200, B[i].y + Rd[i].y - 1200) <= 1.5, `第 ${i + 1} 座塔应关于桥心对称`);
    const q = mid.at(mid.project(B[i].x, B[i].y)); assert.ok(Math.hypot(B[i].x - q[0], B[i].y - q[1]) < 2, '塔应在中路中线上');
  }
  // 一塔在桥外的陆地上：离河道中线的距离 > 河道半宽 + 塔半径，且离桥心 > 射程
  for (const t of [B[0], Rd[0]]) { const w = riv.at(riv.project(t.x, t.y)); assert.ok(Math.hypot(t.x - w[0], t.y - w[1]) > map.river.nominalWidth / 2 + rules.tower.collisionRadius + 40); assert.ok(d(t) > R); }
  assert.ok(Math.abs(d(B[0]) - d(Rd[0])) < 1 && d(B[1]) - d(B[0]) >= 120 && d(B[2]) - d(B[1]) >= 120, `塔间距 ${[d(B[0]), d(B[1]), d(B[2])].map((v) => v.toFixed(0))}`);
  // 用实际的塔索敌来验证：没有小兵时，站在桥心 3 秒不会被任何塔锁定；沿路朝红方走 20 个单位就会被红一塔锁定
  const pl = g.player, foe = g.heroes.filter((h) => h.team === 'red'); for (const h of g.heroes) if (h !== pl) h.speed = 0;
  pl.x = 600; pl.y = 600; let hit = false;
  run(g, 3, () => { if (g.towers.some((t) => t.target === pl)) hit = true; });
  assert.equal(hit, false, '桥心不应被塔锁定');
  const L = [0.7335, -0.6797]; let safe = 0;
  for (let s = -40; s <= 40; s += 0.5) if (g.towers.every((t) => t.team === 'blue' || Math.hypot(t.x - (600 + L[0] * s), t.y - (600 + L[1] * s)) > t.range) && g.towers.every((t) => t.team === 'red' || Math.hypot(t.x - (600 + L[0] * s), t.y - (600 + L[1] * s)) > t.range)) safe += 0.5;
  assert.ok(safe >= 20 && safe <= 30, `沿中路双方塔都打不到的长度应是一小段（实际 ${safe}）`);
  pl.x = 600 + L[0] * 20; pl.y = 600 + L[1] * 20; g.update(1 / 30);
  assert.equal(Rd[0].target, pl, '越过中线 20 单位应被红一塔锁定');
  // 塔和布景、岩体、野区入口：塔与碰撞物之间要么留得下一个英雄（≥ 20），要么本来就贴在一起不构成夹缝；入口净空 ≥ 60
  for (const t of [...B, ...Rd]) for (const e of map.jungleEntrances) assert.ok(Math.hypot(t.x - e[0], t.y - e[1]) - t.r >= 60, t.jsonId + ' 离野区入口太近');
  for (const t of [B[0], Rd[0]]) for (const c of g.colliders) if (c !== t) assert.ok(Math.hypot(t.x - c.x, t.y - c.y) - t.r - c.r >= 20 || c.kind === 'tower' || c.kind === 'core', t.jsonId + ' 与碰撞物之间夹缝过窄');
});

test('塔序：外塔→中塔→内塔依次解锁，任一路打穿后水晶才可被攻击', () => {
  const g = mk();
  for (const team of TEAMS) for (const lane of LANES) {
    const raw = new Polyline(team === 'blue' ? map.lanes[lane].blueToRed : [...map.lanes[lane].blueToRed].reverse());
    const prog = g.towersBy[team][lane].map((t) => raw.project(t.x, t.y));
    assert.ok(prog[0] > prog[1] && prog[1] > prog[2], `${team} ${lane} 的 1 号塔应是离本方水晶最远的外塔`);
  }
  const [t1, t2, t3] = g.towersBy.red.mid, core = g.cores.red, p = g.player;
  g.damage(p, t2, 100); g.damage(p, t3, 100); g.damage(p, core, 100);
  assert.deepEqual([t2.hp, t3.hp, core.hp], [rules.tower.hp, rules.tower.hp, rules.core.hp], '未解锁的建筑不应掉血');
  g.damage(p, t1, 9999); assert.equal(t1.alive, false);
  assert.ok(g.towerAttackable(t2) && !g.towerAttackable(t3) && !g.coreAttackable('red'));
  g.damage(p, t2, 9999); g.damage(p, core, 100); assert.equal(core.hp, rules.core.hp);
  g.damage(p, t3, 9999); assert.ok(g.coreAttackable('red'));
  g.damage(p, core, rules.core.hp);
  assert.ok(g.over && g.winner === 'blue');
});

test('塔优先打小兵；敌方英雄在塔下攻击己方英雄时立即转火', () => {
  const g = mk(), tw = g.towersBy.red.mid[0], p = g.player, foe = g.heroes.find((h) => h.team === 'red' && h.lane === 'mid');
  g.minions.push({ ...dummy(g, 0, 0), team: 'blue', x: tw.x - 60, y: tw.y + 60, id: 77777 }); g.minions.shift();
  p.x = tw.x - 70; p.y = tw.y + 50; foe.x = tw.x + 20; foe.y = tw.y - 20; foe.speed = 0;
  g.update(1 / 30);
  assert.equal(tw.target?.kind, 'minion');
  g.damage(p, foe, 10);
  assert.equal(tw.target, p);
});

test('星璃技能：弦月、定星（最多两枚星标）、三星结界（缺标记/面积不足时取消且不进冷却）', () => {
  const g = mk(), p = g.player, [S0, S1, S2] = rules.xingli.skills;
  p.x = 600; p.y = 700; g.update(1 / 30);
  const a = dummy(g, 680, 700), far = dummy(g, 600 + S0.range + 40, 700);
  assert.ok(g.castCrescent(1, 0).ok); run(g, 0.6);
  assert.equal(a.hp, 1000 - S0.damage, '弦月命中'); assert.equal(far.hp, 1000, '射程外不命中');
  assert.ok(p.cds[0] > S0.cooldownSeconds - 1); assert.equal(g.castCrescent(1, 0).reason, 'cooldown');
  // 三星结界：缺标记
  assert.equal(g.castConstellation(650, 660).reason, 'marks'); assert.equal(p.cds[2], 0);
  // 定星
  assert.equal(g.castBeacon(p.x + S1.castRange + 30, p.y).reason, 'range'); assert.equal(p.cds[1], 0);
  assert.ok(g.castBeacon(680, 690).ok);
  assert.equal(a.hp, 1000 - S0.damage - S1.damage, '定星伤害'); assert.ok(a.slowUntil > g.time && a.slowFrac === S1.slowFraction, '定星减速');
  p.cds[1] = 0; g.castBeacon(650, 740); p.cds[1] = 0; g.castBeacon(700, 740);
  assert.equal(g.marks.length, S1.maxActiveMarks, '只保留最近两枚');
  assert.deepEqual(g.marks.map((m) => [m.x, m.y]), [[650, 740], [700, 740]]);
  // 面积不足 / 超射程 → 取消，冷却和星标都保留
  assert.equal(g.castConstellation(675, 741).reason, 'area');
  assert.equal(g.castConstellation(p.x, p.y - S2.castRange - 20).reason, 'range');
  assert.equal(p.cds[2], 0); assert.equal(g.marks.length, 2);
  // 成功：三角内命中 + 定身，消耗星标并进冷却
  const hp0 = a.hp; a.y = 720; a.x = 676;
  assert.ok(g.castConstellation(676, 690).ok);
  assert.equal(a.hp, hp0 - S2.damage); assert.ok(a.rootUntil > g.time);
  assert.equal(g.marks.length, 0); assert.equal(p.cds[2], S2.cooldownSeconds);
  // 星标寿命
  p.cds[1] = 0; g.castBeacon(650, 740); run(g, S1.markLifetimeSeconds + 0.2); assert.equal(g.marks.length, 0, '星标到时消失');
});

test('普攻选敌：英雄 > 小兵 > 可攻击建筑；按住普攻能打出伤害', () => {
  const g = mk(), p = g.player; p.x = 600; p.y = 700; g.update(1 / 30);
  const m = dummy(g, 650, 700), foe = g.heroes.find((h) => h.team === 'red' && h.lane === 'mid');
  assert.equal(g.pickPlayerTarget(), m);
  foe.x = 680; foe.y = 700; foe.speed = 0;
  assert.equal(g.pickPlayerTarget(), foe);
  g.input.attack = true; run(g, 1.2);
  assert.ok(foe.hp <= rules.heroDefaults.hp - rules.heroDefaults.basicAttack.damage);
});

test('草丛：敌人在草里不可见，同草丛或被揭露后可见', () => {
  const g = mk(), b = map.brush[3], foe = g.heroes.find((h) => h.team === 'red' && h.lane === 'mid'), p = g.player;
  foe.x = b.center[0]; foe.y = b.center[1]; foe.speed = 0; p.x = b.center[0] + 60; p.y = b.center[1]; g.update(1 / 30);
  assert.equal(g.visible(foe, 'blue'), false); assert.equal(g.pickPlayerTarget(), null);
  p.x = b.center[0] + 5; g.update(1 / 30); assert.equal(g.visible(foe, 'blue'), true);
  p.x = b.center[0] + 60; g.update(1 / 30); assert.equal(g.visible(foe, 'blue'), false);
  foe.revealUntil = g.time + 1; assert.equal(g.visible(foe, 'blue'), true);
});

test('AI：低血退回出生点，回血到阈值以上重新上线；没有己方小兵时不进敌塔', () => {
  const g = mk(), bot = g.heroes.find((h) => h.team === 'red' && h.lane === 'north');
  // 小兵死光后 AI 可能还站在塔下，但必须马上撤出；更不能在没兵时主动走进去
  let entered = false, maxDwell = 0; const prev = new Map(), dwell = new Map();
  run(g, 150, () => {
    for (const h of g.heroes) for (const t of g.towers) {
      if (h.isPlayer || !h.alive || !t.alive || t.team === h.team) continue;
      const k = h.id + ':' + t.id, dist = d(t, h), was = prev.get(k) ?? Infinity; prev.set(k, dist);
      if (!t.covered && was >= t.range && dist < t.range) entered = true;
      const dw = !t.covered && dist < t.range ? (dwell.get(k) ?? 0) + 1 / 30 : 0; dwell.set(k, dw); maxDwell = Math.max(maxDwell, dw);
    }
  });
  assert.equal(entered, false, 'AI 不应在没有小兵顶塔时走进敌塔射程');
  assert.ok(maxDwell < 2, `失去小兵掩护后应立刻撤出塔下（最长滞留 ${maxDwell.toFixed(2)}s）`);
  bot.hp = bot.maxHp * 0.2; g.update(1 / 30); assert.equal(bot.ai, 'retreat');
  let reached = false, rejoinHp = -1;
  run(g, 60, () => { if (Math.hypot(bot.x - bot.spawn[0], bot.y - bot.spawn[1]) < rules.bots.baseHealRadius) reached = true; if (reached && rejoinHp < 0 && bot.ai === 'lane') rejoinHp = bot.hp; });
  assert.ok(reached, '应退回出生点'); assert.ok(rejoinHp >= 0, '回血后应重新上线');
  assert.ok(rejoinHp >= bot.maxHp * rules.bots.rejoinAboveHpFraction - 1, '重新上线时血量应在阈值以上');
});

test('玩家死亡后在己方基地复活', () => {
  const g = mk(), p = g.player; p.x = 600; p.y = 600;
  g.damage(g.towers[10], p, 9999); assert.equal(p.alive, false); assert.equal(g.kills.red, 1);
  assert.equal(g.castCrescent(1, 0).reason, 'dead');
  run(g, rules.heroDefaults.respawnSeconds - 0.5); assert.equal(p.alive, false);
  run(g, 1); assert.equal(p.alive, true); assert.equal(p.hp, p.maxHp);
  assert.ok(Math.hypot(p.x - map.teams.blue.heroSpawn[0], p.y - map.teams.blue.heroSpawn[1]) < 30);
});

test('整局（JSON 原始数值，玩家挂机）：红方按塔序推穿并摧毁水晶 → 结算停止 → 重开复位', () => {
  const g = mk(); const order = [];
  run(g, 480, () => { for (const t of g.towers) if (!t.alive && !order.includes(t)) order.push(t); });
  assert.ok(g.over && g.winner === 'red', `实际结果 ${g.winner} @${g.time.toFixed(0)}s`);
  assert.equal(g.cores.blue.alive, false);
  for (const t of order) for (const o of order) if (o.team === t.team && o.lane === t.lane && o.order < t.order) assert.ok(order.indexOf(o) < order.indexOf(t), '塔必须按顺序倒下');
  assert.ok(LANES.some((l) => g.towersBy.blue[l].every((t) => !t.alive)), '至少一路被打穿');
  const snap = [g.time, g.minions.length, g.projectiles.length, g.cores.red.hp];
  g.update(5); assert.deepEqual([g.time, g.minions.length, g.projectiles.length, g.cores.red.hp], snap, '结算后不再生成小兵和攻击');
  g.player.cds = [3, 2, 9]; g.marks.push({ x: 1, y: 1, expire: 9999, born: 0 });
  g.reset();
  assert.equal(g.over, false); assert.equal(g.time, 0); assert.equal(g.minions.length, 0); assert.equal(g.marks.length, 0);
  assert.ok(g.towers.length === 18 && g.towers.every((t) => t.alive && t.hp === rules.tower.hp));
  assert.ok(TEAMS.every((t) => g.cores[t].alive && g.cores[t].hp === rules.core.hp));
  assert.ok(g.heroes.every((h) => h.alive && h.hp === h.maxHp && h.revealUntil === 0 && h.cds.every((c) => c === 0)));
  assert.deepEqual(g.kills, { blue: 0, red: 0 });
  run(g, 6); assert.equal(g.minions.length, 18, '重开后重新出兵');
});

test('整局（AI 代打星璃）：原始 480 秒上限内判平局；放宽上限后蓝方按塔序推穿中路并摧毁水晶', () => {
  const a = mk(); a.autopilot = true; run(a, 481);
  assert.ok(a.over && a.winner === 'draw' && Math.abs(a.time - rules.mode.maxSeconds) < 0.1, '到达时间上限判平局');
  const g = mk({ mode: { ...rules.mode, maxSeconds: 900 } }); g.autopilot = true; const order = [];
  run(g, 900, () => { for (const t of g.towersBy.red.mid) if (!t.alive && !order.includes(t.order)) order.push(t.order); });
  assert.ok(g.over && g.winner === 'blue', `实际结果 ${g.winner} @${g.time.toFixed(0)}s`);
  assert.deepEqual(order, [1, 2, 3]);
  assert.ok(g.player.cds.some((c) => c > 0) || g.player.kills > 0, '代打使用了技能或取得击杀');
});

// ---------------------------------------------------------------- 六名英雄可选
import { HERO_IDS as __IDS } from '../dist/sim.js';
test('六名英雄：换人后玩家在蓝方中路，被换下的星璃顶替原位置；数值来自 rules.heroes', () => {
  for (const id of __IDS) {
    const g = new Game(structuredClone(map), structuredClone(rules)); g.playerHero = id; g.reset();
    const d = rules.heroes[id];
    assert.equal(g.player.sprite, id); assert.equal(g.player.team, 'blue'); assert.equal(g.player.lane, 'mid');
    assert.equal(g.heroes.length, 6); assert.equal(new Set(g.heroes.map((h) => h.sprite)).size, 6, '六人各不相同');
    assert.equal(g.heroes.filter((h) => h.team === 'blue').length, 3);
    assert.equal(g.player.maxHp, d.hp ?? rules.heroDefaults.hp);
    assert.equal(g.player.ba.range, (d.basicAttack ?? rules.heroDefaults.basicAttack).range);
    assert.equal(g.skillsOf().length, 3);
  }
});
test('通用技能：直线、落点、扇形、突进、增益各自按规则结算并进入冷却', () => {
  const mk = (id) => { const g = new Game(structuredClone(map), structuredClone(rules)); g.playerHero = id; g.reset(); const p = g.player; p.x = 600; p.y = 600;
    const e = g.heroes.find((h) => h.team === 'red'); e.x = 630; e.y = 600; e.hp = e.maxHp = 1000; for (const h of g.heroes) if (h !== p && h !== e) { h.x = 100; h.y = 1100; } return { g, p, e }; };
  for (const id of __IDS.filter((i) => i !== 'xingli')) {
    rules.heroes[id].skills.forEach((s, i) => {
      const { g, p, e } = mk(id); const hp0 = e.hp, php = (p.hp = p.maxHp - 150);
      if (s.kind === 'ground-circle') { const r = g.castSkill(i, { x: e.x, y: e.y, dx: 1, dy: 0 }); assert.ok(r.ok); assert.equal(g.castSkill(i, { x: e.x, y: e.y, dx: 1, dy: 0 }).reason, 'cooldown'); }
      else assert.ok(g.castSkill(i, { x: e.x, y: e.y, dx: 1, dy: 0 }).ok, `${id} ${s.name}`);
      for (let k = 0; k < 30; k++) { e.x = Math.max(e.x, 615); g.update(1 / 60); }
      assert.equal(p.cds[i] > 0, true, `${id} ${s.name} 进入冷却`);
      if (s.damage) assert.ok(e.hp <= hp0 - s.damage + 1e-6, `${id} ${s.name} 造成伤害 ${hp0 - e.hp}`);
      if (s.kind === 'dash') assert.ok(p.x > 615 && !p.dash, `${id} ${s.name} 位移到 ${p.x.toFixed(0)}`);
      if (s.shield) assert.ok(p.shield > 0);
      if (s.heal) assert.ok(p.hp > php);
      if (s.attackIntervalMultiplier) assert.ok(g.time < p.atkBuffUntil);
    });
  }
  // 护盾先扣
  const { g, p, e } = mk('xuanyuan'); g.castSkill(2, { x: p.x, y: p.y, dx: 1, dy: 0 }); const hp = p.hp; g.damage(e, p, 100); assert.equal(p.hp, hp); assert.equal(p.shield, 60);
  // 眩晕期间不能出手
  const a = mk('chiyan'); a.g.castSkill(2, { x: a.e.x, y: a.e.y, dx: 1, dy: 0 }); for (let k = 0; k < 12; k++) a.g.update(1 / 60); assert.ok(a.e.stunned, '被破阵眩晕');
});
test('六名英雄各自托管打一局：都能跑到结算，不报错', () => {
  for (const id of __IDS) {
    const g = new Game(structuredClone(map), structuredClone(rules)); g.playerHero = id; g.reset(); g.autopilot = true;
    let n = 0; while (!g.over && n++ < 40000) g.update(1 / 30);
    assert.ok(g.over, `${id} 一局结束`);
  }
});
