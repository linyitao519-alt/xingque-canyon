// 平衡跑批：六名英雄各自在蓝方中路由 AI 托管打 20 局（种子 1–20），双方 AI 技能开启，
// 对手中路按其余五名英雄轮转、每个对手 4 局。用法：node tools/balance.mjs [英雄id ...]
import { readFileSync } from 'node:fs';
import { Game, HERO_IDS } from '../dist/sim.js';
const load = (f) => JSON.parse(readFileSync(new URL('../assets/data/' + f, import.meta.url), 'utf8'));
const map = load('map.json'), rules = load('match-rules.json'), scen = load('scenery.json');
const props = (scen.props ?? []).filter((p) => p.blockRadius > 0).map((p) => ({ x: p.pos[0], y: p.pos[1], r: p.blockRadius }));
const only = process.argv.slice(2), rows = [];
for (const hero of HERO_IDS) {
  if (only.length && !only.includes(hero)) continue;
  const foes = HERO_IDS.filter((h) => h !== hero); let W = 0, L = 0, D = 0, dur = 0; const draws = [], per = {};
  for (let seed = 1; seed <= 20; seed++) {
    const foe = foes[(seed - 1) % 5];
    const g = new Game(structuredClone(map), structuredClone(rules), props);
    g.playerHero = hero; g.enemyMid = foe; g.seed = seed; g.aiSkills = true; g.reset(); g.autopilot = true;
    let n = 0; while (!g.over && n++ < 40000) g.update(1 / 30);
    dur += g.time; per[foe] ??= [0, 0, 0];
    if (g.winner === 'blue') { W++; per[foe][0]++; } else if (g.winner === 'red') { L++; per[foe][1]++; } else { D++; per[foe][2]++; draws.push(seed); }
  }
  rows.push({ hero, W, L, D, rate: W / 20, avg: dur / 20, draws, per });
  console.log(`${hero.padEnd(9)} W/L/D ${W}/${L}/${D}  胜率 ${(W * 5).toFixed(0)}%  平均 ${(dur / 20).toFixed(0)}s  平局种子 [${draws}]  对手 ${Object.entries(per).map(([k, v]) => `${k}:${v.join('-')}`).join(' ')}`);
}
console.log(JSON.stringify(rows));
