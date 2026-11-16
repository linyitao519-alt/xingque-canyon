// 动画选帧规则（纯函数，无画面）：node --test tests/anim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pickFrame } from '../dist/sprites.js';
const def = JSON.parse(readFileSync(new URL('../assets/anim/anim.json', import.meta.url), 'utf8'));
const rules = JSON.parse(readFileSync(new URL('../assets/data/match-rules.json', import.meta.url), 'utf8'));
const st = def.states;

test('动画清单：六名英雄 + 四种小兵，每个三条帧带都在', () => {
  assert.deepEqual(Object.keys(def.units).sort(), ['chiyan', 'feixian', 'hedeng', 'melee-blue', 'melee-red', 'ranged-blue', 'ranged-red', 'xingli', 'xuanyuan', 'yelan']);
  for (const u of Object.values(def.units)) for (const s of ['idle', 'run', 'attack']) assert.ok(existsSync(new URL(`../assets/anim/${u.file}-${s}.png`, import.meta.url)), u.file + '-' + s);
  assert.deepEqual([st.idle.frames, st.run.frames, st.attack.frames], [4, 6, 4]);
});

test('静止播 idle、移动播 run，都循环', () => {
  const seen = new Set(), seenRun = new Set();
  for (let t = 0; t < 3; t += 1 / 30) {
    const a = pickFrame(st, { t, moving: false, atk: 9, seed: 0 }); assert.equal(a.state, 'idle'); seen.add(a.frame);
    const b = pickFrame(st, { t, moving: true, atk: 9, seed: 0 }); assert.equal(b.state, 'run'); seenRun.add(b.frame);
  }
  assert.equal(seen.size, 4); assert.equal(seenRun.size, 6);
});

test('出手后 attack 完整播一遍再回到 idle/run；英雄的出手帧落在普攻前摇结束的时刻', () => {
  const frames = [];
  for (let atk = 0; atk < 0.6; atk += 1 / 60) { const f = pickFrame(st, { t: 5, moving: true, atk, seed: 0 }); if (f.state === 'attack') frames.push(f.frame); else break; }
  assert.deepEqual([...new Set(frames)], [0, 1, 2, 3]);
  assert.equal(pickFrame(st, { t: 5, moving: true, atk: st.attack.frames / st.attack.fps + 0.01, seed: 0 }).state, 'run');
  const windup = 0.18;                                             // sim.ts 里英雄普攻的前摇
  assert.equal(pickFrame(st, { t: 0, moving: false, atk: windup + 0.005, seed: 0 }).frame, st.attack.release);
  assert.ok(st.attack.frames / st.attack.fps < rules.heroDefaults.basicAttack.interval, '攻击动画必须短于攻击间隔');
});

test('小兵：伤害是瞬时结算的，所以从出手帧直接播起', () => {
  const lead = st.attack.release / st.attack.fps;
  const f0 = pickFrame(st, { t: 0, moving: false, atk: 0, seed: 3 }, lead); assert.deepEqual([f0.state, f0.frame], ['attack', st.attack.release]);
  assert.equal(pickFrame(st, { t: 0, moving: false, atk: 0.25, seed: 3 }, lead).state, 'idle');
});

test('跑步帧跟着走过的距离走：与时间无关，走满一圈六帧各出现一次；下一帧只在每帧末段淡入', () => {
  const at = (phase, t = 123.4) => pickFrame(st, { t, moving: true, atk: 9, seed: 5, phase }, 0, def.blend);
  assert.equal(at(0.3, 999).frame, at(0.3).frame);
  const seen = []; for (let p = 0; p < 1; p += 1 / 60) seen.push(at(p).frame);
  assert.deepEqual([...new Set(seen)], [0, 1, 2, 3, 4, 5]);
  assert.equal(at(0.01).mix, 0); assert.ok(at(1 / 6 - 0.005).mix > 0.5); assert.equal(at(1 / 6 - 0.005).next, 1); assert.equal(at(5.9 / 6).next, 0);
});
