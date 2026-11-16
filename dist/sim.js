// 对局模拟层：不依赖 DOM，可在 Node 里无画面运行（见 tests/）。
// 数值全部来自 assets/data/map.json 与 match-rules.json。
import { NavGrid, Polyline, inTriangle, triArea } from './nav.js';
export const LANES = ['north', 'mid', 'south'];
export const TEAMS = ['blue', 'red'];
export const enemyOf = (t) => (t === 'blue' ? 'red' : 'blue');
// 角色 ID 与名字取自 xingque-runtime-assets 的 README；赤檐是新增的红方近战长枪手（首版仍共用普攻）
const HERO_ROSTER = {
    blue: [{ sprite: 'xingli', name: '星璃' }, { sprite: 'xuanyuan', name: '玄垣' }, { sprite: 'hedeng', name: '鹤灯' }],
    red: [{ sprite: 'yelan', name: '夜岚' }, { sprite: 'feixian', name: '绯弦' }, { sprite: 'chiyan', name: '赤檐' }],
};
const MINION_R = 6;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export class Game {
    map;
    rules;
    extra;
    time = 0;
    over = false;
    winner = null;
    heroes = [];
    minions = [];
    towers = [];
    cores;
    projectiles = [];
    crescents = [];
    marks = [];
    events = [];
    kills = { blue: 0, red: 0 };
    player;
    /** 玩家输入：移动向量（长度≤1）和普攻键是否按住 */
    input = { mx: 0, my: 0, attack: false };
    /** 调试/演示：让 AI 代打玩家英雄 */
    autopilot = false;
    towersBy;
    lanePath;
    heroGrid;
    minionGrid;
    colliders = [];
    nextId = 1;
    nextWave = 0;
    pending = [];
    occ = [[], []];
    navDirty = false;
    waves = 0;
    /** extra = 布景里会挡路的物件（assets/data/scenery.json 中 blockRadius>0 的岩石和树） */
    constructor(map, rules, extra = []) {
        this.map = map;
        this.rules = rules;
        this.extra = extra;
        const w = map.world;
        this.heroGrid = new NavGrid(w.width, w.height, 6, w.playableBounds);
        this.minionGrid = new NavGrid(w.width, w.height, 6, w.playableBounds);
        this.reset();
    }
    // ---------------------------------------------------------------- 初始化 / 重开
    reset() {
        const { map, rules } = this;
        this.time = 0;
        this.over = false;
        this.winner = null;
        this.heroes = [];
        this.minions = [];
        this.towers = [];
        this.projectiles = [];
        this.crescents = [];
        this.marks = [];
        this.events = [];
        this.pending = [];
        this.kills = { blue: 0, red: 0 };
        this.input = { mx: 0, my: 0, attack: false };
        this.nextWave = rules.wave.firstSpawnSeconds;
        this.waves = 0;
        const base = (team, x, y, r, hp) => ({
            id: this.nextId++, team, x, y, r, hp, maxHp: hp, alive: true, brush: -1, revealUntil: 0,
            slowUntil: 0, slowFrac: 0, rootUntil: 0, hitT: -9, faceX: team === 'blue' ? 1 : -1, faceY: 0,
        });
        this.cores = {};
        this.towersBy = { blue: {}, red: {} };
        for (const team of TEAMS) {
            const c = map.teams[team].core;
            this.cores[team] = { ...base(team, c[0], c[1], rules.core.collisionRadius, rules.core.hp), kind: 'core' };
            for (const lane of LANES) {
                // 兵线从本方水晶出发的原始折线，用来给塔排解锁顺序：离本方水晶最远的是外塔(1)。
                // map.json 里蓝方上路/红方下路的 t1~t3 编号与"1 为外塔"的图例相反，这里按实际位置排。
                const raw = new Polyline(team === 'blue' ? map.lanes[lane].blueToRed : [...map.lanes[lane].blueToRed].reverse());
                const list = map.lanes[lane].towers[team].map((t) => ({ t, p: raw.project(t.position[0], t.position[1]) }))
                    .sort((a, b) => b.p - a.p)
                    .map(({ t }, i) => ({
                    ...base(team, t.position[0], t.position[1], rules.tower.collisionRadius, rules.tower.hp), kind: 'tower',
                    jsonId: t.id, lane, order: i + 1, range: rules.tower.attackRange, atkCd: 0, target: null, covered: false,
                }));
                this.towersBy[team][lane] = list;
                this.towers.push(...list);
            }
            const lanes = team === 'blue' ? ['mid', ...rules.mode.blueBotLanes] : rules.mode.redBotLanes;
            const sp = map.teams[team].heroSpawn, hd = rules.heroDefaults;
            HERO_ROSTER[team].forEach((def, i) => {
                const spawn = [sp[0] + (i - 1) * 18, sp[1]];
                const h = {
                    ...base(team, spawn[0], spawn[1], hd.collisionRadius, hd.hp), kind: 'hero', sprite: def.sprite, name: def.name,
                    isPlayer: team === 'blue' && i === 0, lane: lanes[i], speed: hd.moveSpeed, atkCd: 0, atkT: -9, windup: null,
                    respawn: 0, spawn, ai: 'lane', moving: false, path: null, pi: 0, pgx: 0, pgy: 0, repath: 0,
                    cds: [0, 0, 0], castT: -9, kills: 0, deaths: 0, fwd: 0,
                };
                this.heroes.push(h);
                if (h.isPlayer)
                    this.player = h;
            });
        }
        this.rebuildNav();
        for (const h of this.heroes)
            this.resolve(h);
    }
    rebuildNav() {
        const { map } = this;
        this.colliders = map.staticObstacles.map((o) => ({ x: o.center[0], y: o.center[1], r: o.radius }));
        this.colliders.push(...this.extra);
        for (const t of this.towers)
            if (t.alive)
                this.colliders.push(t);
        for (const team of TEAMS)
            if (this.cores[team].alive)
                this.colliders.push(this.cores[team]);
        this.heroGrid.rebuild(this.colliders, this.rules.heroDefaults.collisionRadius + 3);
        this.minionGrid.rebuild(this.colliders, MINION_R + 3);
        this.lanePath = { blue: {}, red: {} };
        for (const team of TEAMS)
            for (const lane of LANES) {
                const wp = team === 'blue' ? this.map.lanes[lane].blueToRed : [...this.map.lanes[lane].blueToRed].reverse();
                const off = this.rules.core.collisionRadius + 14;
                const toward = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return [a[0] + ((b[0] - a[0]) / d) * off, a[1] + ((b[1] - a[1]) / d) * off]; };
                const targets = [...wp.slice(1, -1), toward(wp[wp.length - 1], wp[wp.length - 2])];
                const pts = [toward(wp[0], wp[1])];
                for (const w of targets) {
                    const cur = pts[pts.length - 1];
                    pts.push(...this.minionGrid.findPath(cur[0], cur[1], w[0], w[1]));
                }
                this.lanePath[team][lane] = new Polyline(pts);
            }
        for (const m of this.minions)
            m.progress = this.lanePath[m.team][m.lane].project(m.x, m.y);
        for (const h of this.heroes)
            h.path = null;
        this.navDirty = false;
    }
    // ---------------------------------------------------------------- 规则查询
    towerAttackable(t) { return t.alive && (t.order === 1 || !this.towersBy[t.team][t.lane][t.order - 2].alive); }
    coreAttackable(team) { return this.cores[team].alive && LANES.some((l) => this.towersBy[team][l].every((t) => !t.alive)); }
    attackable(u) {
        if (!u.alive)
            return false;
        if (u.kind === 'tower')
            return this.towerAttackable(u);
        if (u.kind === 'core')
            return this.coreAttackable(u.team);
        return true;
    }
    /** 草丛可见性：建筑恒可见；草丛里的单位只对同阵营、同草丛的敌人或被短时揭露时可见。 */
    visible(u, team) {
        if (u.team === team || u.kind === 'tower' || u.kind === 'core' || u.brush < 0)
            return true;
        return u.revealUntil > this.time || this.occ[team === 'blue' ? 0 : 1][u.brush] === true;
    }
    brushAt(x, y) {
        const b = this.map.brush;
        for (let i = 0; i < b.length; i++)
            if (Math.hypot(x - b[i].center[0], y - b[i].center[1]) <= b[i].radius)
                return i;
        return -1;
    }
    /** 敌方塔的危险区内且没有己方小兵顶塔。 */
    unsafe(team, x, y) {
        for (const t of this.towers)
            if (t.alive && t.team !== team && !t.covered && Math.hypot(t.x - x, t.y - y) < t.range + 14)
                return true;
        return false;
    }
    enemiesOf(team) {
        const out = [];
        for (const h of this.heroes)
            if (h.alive && h.team !== team)
                out.push(h);
        for (const m of this.minions)
            if (m.alive && m.team !== team)
                out.push(m);
        return out;
    }
    enemyStructures(team) {
        const e = enemyOf(team);
        const out = this.towers.filter((t) => t.team === e && this.towerAttackable(t));
        if (this.coreAttackable(e))
            out.push(this.cores[e]);
        return out;
    }
    // ---------------------------------------------------------------- 主循环
    update(dt) {
        let left = dt;
        while (left > 1e-6 && !this.over) {
            const s = Math.min(left, 1 / 30);
            this.step(s);
            left -= s;
        }
    }
    step(dt) {
        this.time += dt;
        if (this.time >= this.rules.mode.maxSeconds) {
            this.finish('draw');
            return;
        }
        this.spawnWaves();
        this.occ = [[], []];
        for (const u of [...this.heroes, ...this.minions]) {
            u.brush = u.alive ? this.brushAt(u.x, u.y) : -1;
            if (u.brush >= 0)
                this.occ[u.team === 'blue' ? 0 : 1][u.brush] = true;
        }
        for (const t of this.towers) {
            t.covered = false;
            if (t.alive)
                for (const m of this.minions)
                    if (m.alive && m.team !== t.team && dist(m, t) <= t.range) {
                        t.covered = true;
                        break;
                    }
        }
        for (const h of this.heroes)
            this.updateHero(h, dt);
        for (const m of this.minions)
            if (m.alive)
                this.updateMinion(m, dt);
        for (const t of this.towers)
            if (t.alive)
                this.updateTower(t, dt);
        this.updateProjectiles(dt);
        this.updateCrescents(dt);
        this.marks = this.marks.filter((m) => m.expire > this.time);
        this.separate();
        if (this.minions.some((m) => !m.alive))
            this.minions = this.minions.filter((m) => m.alive);
        if (this.events.length > 80)
            this.events = this.events.filter((e) => this.time - e.t < 2.5);
        if (this.navDirty)
            this.rebuildNav();
    }
    finish(winner) {
        this.over = true;
        this.winner = winner;
        this.input = { mx: 0, my: 0, attack: false };
        this.events.push({ type: 'end', t: this.time, x: 0, y: 0, winner });
    }
    spawnWaves() {
        const w = this.rules.wave;
        while (this.time >= this.nextWave) {
            for (const team of TEAMS)
                for (const lane of LANES)
                    w.units.forEach((kind, i) => this.pending.push({ t: this.nextWave + i * w.spacingSeconds, team, lane, kind }));
            this.nextWave += w.intervalSeconds;
            this.waves++;
        }
        if (!this.pending.length)
            return;
        const rest = [];
        for (const p of this.pending) {
            if (p.t > this.time) {
                rest.push(p);
                continue;
            }
            const st = w[p.kind], [x, y] = this.lanePath[p.team][p.lane].at(2);
            this.minions.push({
                id: this.nextId++, team: p.team, x, y, r: MINION_R, hp: st.hp, maxHp: st.hp, alive: true, brush: -1, revealUntil: 0,
                slowUntil: 0, slowFrac: 0, rootUntil: 0, hitT: -9, faceX: p.team === 'blue' ? 1 : -1, faceY: 0,
                kind: 'minion', mkind: p.kind, lane: p.lane, speed: st.moveSpeed, range: st.attackRange, dmg: st.attackDamage,
                interval: st.attackInterval, atkCd: 0, atkT: -9, progress: 2, target: null, moving: false,
            });
        }
        this.pending = rest;
    }
    // ---------------------------------------------------------------- 移动与碰撞
    resolve(u) {
        for (let it = 0; it < 2; it++)
            for (const c of this.colliders) {
                const dx = u.x - c.x, dy = u.y - c.y, R = c.r + u.r, d2 = dx * dx + dy * dy;
                if (d2 >= R * R)
                    continue;
                const d = Math.sqrt(d2);
                if (d < 1e-4) {
                    u.x = c.x + R;
                    continue;
                }
                u.x = c.x + (dx / d) * R;
                u.y = c.y + (dy / d) * R;
            }
        const b = this.map.world.playableBounds;
        u.x = Math.min(b[2] - u.r, Math.max(b[0] + u.r, u.x));
        u.y = Math.min(b[3] - u.r, Math.max(b[1] + u.r, u.y));
    }
    moveUnit(u, dx, dy, dt, maxDist = Infinity) {
        const L = Math.hypot(dx, dy);
        if (L < 1e-6 || this.time < u.rootUntil)
            return;
        const sp = u.speed * (this.time < u.slowUntil ? 1 - u.slowFrac : 1);
        const s = Math.min(sp * dt, maxDist);
        u.x += (dx / L) * s;
        u.y += (dy / L) * s;
        u.faceX = dx / L;
        u.faceY = dy / L;
        u.moving = true;
        this.resolve(u);
    }
    heroGoto(h, gx, gy, dt) {
        const d = Math.hypot(gx - h.x, gy - h.y);
        if (d < 1.5)
            return;
        if (this.heroGrid.lineClear(h.x, h.y, gx, gy)) {
            h.path = null;
            this.moveUnit(h, gx - h.x, gy - h.y, dt, d);
            return;
        }
        h.repath -= dt;
        if (!h.path || h.repath <= 0 || Math.hypot(gx - h.pgx, gy - h.pgy) > 20) {
            h.path = this.heroGrid.findPath(h.x, h.y, gx, gy);
            h.pi = 0;
            h.pgx = gx;
            h.pgy = gy;
            h.repath = 0.8;
        }
        while (h.pi < h.path.length && Math.hypot(h.path[h.pi][0] - h.x, h.path[h.pi][1] - h.y) < 3)
            h.pi++;
        const p = h.pi < h.path.length ? h.path[h.pi] : [gx, gy];
        this.moveUnit(h, p[0] - h.x, p[1] - h.y, dt, Math.hypot(p[0] - h.x, p[1] - h.y));
    }
    separate() {
        const ms = this.minions;
        for (let i = 0; i < ms.length; i++) {
            const a = ms[i];
            if (!a.alive)
                continue;
            for (let j = i + 1; j < ms.length; j++) {
                const b = ms[j];
                if (!b.alive)
                    continue;
                const dx = b.x - a.x, dy = b.y - a.y, R = a.r + b.r, d2 = dx * dx + dy * dy;
                if (d2 >= R * R || d2 < 1e-6)
                    continue;
                const d = Math.sqrt(d2), push = (R - d) / 2;
                a.x -= (dx / d) * push;
                a.y -= (dy / d) * push;
                b.x += (dx / d) * push;
                b.y += (dy / d) * push;
            }
        }
    }
    // ---------------------------------------------------------------- 伤害
    damage(src, tgt, amount) {
        if (!tgt.alive || this.over || !this.attackable(tgt))
            return;
        tgt.hp -= amount;
        tgt.hitT = this.time;
        if (tgt.kind === 'tower' || tgt.kind === 'core')
            this.events.push({ type: 'structHit', t: this.time, x: tgt.x, y: tgt.y, team: tgt.team }); // 只给音效/特效用
        if (src && src.kind === 'hero' && tgt.kind === 'hero')
            // 塔下打英雄：射程内的敌方塔立即切到攻击者
            for (const t of this.towers)
                if (t.alive && t.team === tgt.team && dist(t, src) <= t.range && this.visible(src, t.team))
                    t.target = src;
        if (src === this.player || tgt === this.player)
            this.events.push({ type: 'dmg', t: this.time, x: tgt.x, y: tgt.y, amount, mine: src === this.player });
        if (tgt.hp > 0)
            return;
        tgt.hp = 0;
        tgt.alive = false;
        if (tgt.kind === 'hero') {
            tgt.respawn = this.rules.heroDefaults.respawnSeconds;
            tgt.windup = null;
            tgt.path = null;
            tgt.deaths++;
            this.kills[enemyOf(tgt.team)]++;
            if (src && src.kind === 'hero')
                src.kills++;
            this.events.push({ type: 'heroDown', t: this.time, x: tgt.x, y: tgt.y, team: tgt.team });
        }
        else if (tgt.kind === 'tower') {
            this.navDirty = true;
            this.events.push({ type: 'towerDown', t: this.time, x: tgt.x, y: tgt.y, team: tgt.team });
        }
        else if (tgt.kind === 'core') {
            this.events.push({ type: 'coreDown', t: this.time, x: tgt.x, y: tgt.y, team: tgt.team });
            this.finish(enemyOf(tgt.team));
        }
        else
            this.events.push({ type: 'minionDown', t: this.time, x: tgt.x, y: tgt.y, team: tgt.team });
    }
    reveal(u, secs = 1.5) { if (u.brush >= 0)
        u.revealUntil = Math.max(u.revealUntil, this.time + secs); }
    // ---------------------------------------------------------------- 英雄
    updateHero(h, dt) {
        if (!h.alive) {
            h.respawn -= dt;
            if (h.respawn <= 0) {
                h.alive = true;
                h.hp = h.maxHp;
                h.x = h.spawn[0];
                h.y = h.spawn[1];
                h.ai = 'lane';
                h.atkCd = 0;
                h.fwd = 0;
                h.slowUntil = h.rootUntil = h.revealUntil = 0;
                this.resolve(h);
                this.events.push({ type: 'respawn', t: this.time, x: h.x, y: h.y, team: h.team });
            }
            return;
        }
        h.atkCd = Math.max(0, h.atkCd - dt);
        for (let i = 0; i < 3; i++)
            h.cds[i] = Math.max(0, h.cds[i] - dt);
        const sp = this.map.teams[h.team].heroSpawn, b = this.rules.bots;
        if (h.hp < h.maxHp && Math.hypot(h.x - sp[0], h.y - sp[1]) <= b.baseHealRadius)
            h.hp = Math.min(h.maxHp, h.hp + b.baseHealingHpPerSecond * dt);
        if (h.windup && (h.windup.t -= dt) <= 0) {
            const t = h.windup.target;
            h.windup = null;
            const ba = this.rules.heroDefaults.basicAttack;
            if (t.alive && dist(h, t) - t.r <= ba.range + 30) {
                this.projectiles.push({ x: h.x, y: h.y, target: t, src: h, dmg: ba.damage, speed: 300, style: 'hero', team: h.team });
                this.reveal(h);
                this.events.push({ type: 'shot', t: this.time, x: h.x, y: h.y, player: h.isPlayer });
            }
        }
        h.moving = false;
        if (h.isPlayer && !this.autopilot)
            this.controlPlayer(h, dt);
        else
            this.controlBot(h, dt);
    }
    /** 普攻：0.18s 前摇后在释放点生成弹体。 */
    heroAttack(h, t) {
        if (h.atkCd > 0 || h.windup)
            return false;
        h.windup = { t: 0.18, target: t };
        h.atkCd = this.rules.heroDefaults.basicAttack.interval;
        h.atkT = this.time;
        const d = dist(h, t) || 1;
        h.faceX = (t.x - h.x) / d;
        h.faceY = (t.y - h.y) / d;
        return true;
    }
    /** 星璃普攻选敌：射程内英雄优先，其次小兵，最后可攻击建筑。 */
    pickPlayerTarget(h = this.player, extra = 0) {
        const range = this.rules.heroDefaults.basicAttack.range + extra;
        const pick = (list) => {
            let best = null, bd = Infinity;
            for (const u of list) {
                if (!u.alive || !this.visible(u, h.team))
                    continue;
                const d = dist(h, u) - u.r;
                if (d <= range && d < bd) {
                    bd = d;
                    best = u;
                }
            }
            return best;
        };
        return pick(this.heroes.filter((u) => u.team !== h.team)) || pick(this.minions.filter((u) => u.team !== h.team)) || pick(this.enemyStructures(h.team));
    }
    controlPlayer(h, dt) {
        const { mx, my, attack } = this.input, L = Math.hypot(mx, my);
        if (L > 0.08)
            this.moveUnit(h, mx, my, dt);
        if (attack) {
            const t = this.pickPlayerTarget(h);
            if (t)
                this.heroAttack(h, t);
        }
    }
    /** AI 站位：跟在本路最前的己方小兵身后；没有兵时守在本路最外侧的己方塔后。 */
    laneAnchorProgress(h) {
        const path = this.lanePath[h.team][h.lane];
        const own = this.towersBy[h.team][h.lane].find((t) => t.alive);
        let hold = own ? path.project(own.x, own.y) - 24 : 70;
        let front = -Infinity;
        for (const m of this.minions)
            if (m.alive && m.team === h.team && m.lane === h.lane)
                front = Math.max(front, m.progress);
        let p = Math.max(hold, front - 26);
        // 状态健康时守住已推进到的位置（停在下一座敌塔射程外），等下一波兵
        const et = this.towersBy[enemyOf(h.team)][h.lane].find((t) => t.alive);
        const edge = et ? path.project(et.x, et.y) - (et.range + 30) : path.length - 40;
        if (h.hp / h.maxHp > 0.5)
            p = Math.max(p, Math.min(h.fwd, edge));
        for (let i = 0; i < 40 && p > hold; i++) {
            const q = path.at(p);
            if (!this.unsafe(h.team, q[0], q[1]))
                break;
            p -= 12;
        }
        h.fwd = p = Math.max(20, Math.min(path.length - 4, p));
        return p;
    }
    botAlong(h, targetP, dt) {
        const path = this.lanePath[h.team][h.lane];
        const my = path.project(h.x, h.y);
        const [gx, gy] = path.at(my + Math.max(-60, Math.min(60, targetP - my)));
        this.heroGoto(h, gx, gy, dt);
    }
    controlBot(h, dt) {
        const B = this.rules.bots, range = this.rules.heroDefaults.basicAttack.range;
        const frac = h.hp / h.maxHp;
        if (h.ai === 'lane' && frac < B.retreatBelowHpFraction)
            h.ai = 'retreat';
        if (h.ai === 'retreat') {
            if (frac >= B.rejoinAboveHpFraction)
                h.ai = 'lane';
            else {
                // 低血沿本路退回出生点，在回血阈值以上再上线
                if (this.lanePath[h.team][h.lane].project(h.x, h.y) > 60)
                    this.botAlong(h, 0, dt);
                else if (Math.hypot(h.x - h.spawn[0], h.y - h.spawn[1]) > 6)
                    this.heroGoto(h, h.spawn[0], h.spawn[1], dt);
                return;
            }
        }
        const anchorP = this.laneAnchorProgress(h);
        if (B.avoidEnemyTowerUnlessAlliedMinionInRange && this.unsafe(h.team, h.x, h.y)) {
            this.botAlong(h, anchorP, dt);
            return;
        }
        const [ax, ay] = this.lanePath[h.team][h.lane].at(anchorP);
        let best = null, bs = Infinity;
        const consider = (u, pri) => {
            if (!u.alive || !this.visible(u, h.team))
                return;
            const d = dist(h, u), need = d - u.r - range;
            if (need > 70)
                return;
            if (need > 0 && Math.hypot(u.x - ax, u.y - ay) > B.chaseMaxDistance + range)
                return;
            if (need > 0 && this.unsafe(h.team, h.x + ((u.x - h.x) / d) * (need + 3), h.y + ((u.y - h.y) / d) * (need + 3)))
                return;
            const s = (pri === 0 && need > 8 ? 2 : pri) * 1000 + Math.max(0, need) * 3 + (u.hp / u.maxHp) * 30;
            if (s < bs) {
                bs = s;
                best = u;
            }
        };
        // 站在敌塔射程内时不主动打英雄（会被塔转火），除非能收掉残血
        const underTower = this.towers.some((t) => t.alive && t.team !== h.team && dist(t, h) <= t.range + 6);
        for (const u of this.heroes)
            if (u.team !== h.team && (!underTower || u.hp <= 80))
                consider(u, 0);
        for (const u of this.minions)
            if (u.team !== h.team)
                consider(u, 1);
        // 兵线进塔（或水晶已暴露）时优先拆建筑
        for (const u of this.enemyStructures(h.team))
            consider(u, u.kind === 'core' ? -1 : 0.5); // 水晶暴露时集火水晶
        const t = best;
        if (!t) {
            this.botAlong(h, anchorP, dt);
            return;
        }
        const need = dist(h, t) - t.r - range;
        if (need > -4)
            this.heroGoto(h, t.x, t.y, dt);
        if (need <= 0)
            this.heroAttack(h, t);
        if (h.isPlayer && t.kind !== 'tower' && t.kind !== 'core')
            this.autoSkills(h, t);
    }
    /** 代打时的技能使用（仅 autopilot）。 */
    autoSkills(h, t) {
        const [cres, bea, con] = this.rules.xingli.skills;
        const d = dist(h, t) || 1, ux = (t.x - h.x) / d, uy = (t.y - h.y) / d;
        if (h.cds[0] <= 0 && d < cres.range - 8)
            this.castCrescent(ux, uy);
        if (h.cds[1] <= 0 && d < bea.castRange - 26) {
            const s = this.marks.length % 2 ? 1 : -1;
            this.castBeacon(t.x - uy * 24 * s, t.y + ux * 24 * s);
        }
        if (h.cds[2] <= 0 && this.marks.length === 2) {
            const mx = (this.marks[0].x + this.marks[1].x) / 2, my = (this.marks[0].y + this.marks[1].y) / 2;
            const ex = t.x - mx, ey = t.y - my, L = Math.hypot(ex, ey) || 1;
            let px = t.x + (ex / L) * 34, py = t.y + (ey / L) * 34;
            const pd = Math.hypot(px - h.x, py - h.y);
            if (pd > con.castRange) {
                px = h.x + ((px - h.x) / pd) * con.castRange;
                py = h.y + ((py - h.y) / pd) * con.castRange;
            }
            const a = [this.marks[0].x, this.marks[0].y], b = [this.marks[1].x, this.marks[1].y];
            if (inTriangle([t.x, t.y], a, b, [px, py]))
                this.castConstellation(px, py);
        }
    }
    // ---------------------------------------------------------------- 星璃技能
    canCast(i) {
        if (this.over)
            return { ok: false, reason: 'over' };
        if (!this.player.alive)
            return { ok: false, reason: 'dead' };
        if (this.player.cds[i] > 0)
            return { ok: false, reason: 'cooldown' };
        return { ok: true };
    }
    /** 弦月：沿方向飞行的窄月牙，穿透并对路径上每个敌方单位结算一次。 */
    castCrescent(dx, dy) {
        const c = this.canCast(0);
        if (!c.ok)
            return c;
        const h = this.player, s = this.rules.xingli.skills[0];
        let L = Math.hypot(dx, dy);
        if (L < 1e-6) {
            dx = h.faceX;
            dy = h.faceY;
            L = Math.hypot(dx, dy) || 1;
        }
        dx /= L;
        dy /= L;
        this.crescents.push({ x: h.x, y: h.y, dx, dy, left: s.range, hit: new Set(), src: h });
        h.cds[0] = s.cooldownSeconds;
        h.castT = this.time;
        h.faceX = dx;
        h.faceY = dy;
        this.reveal(h);
        this.events.push({ type: 'cast', t: this.time, x: h.x, y: h.y, skill: 0 });
        return { ok: true };
    }
    /** 定星：落点范围伤害+减速，并留下星标（最多保留最近两枚）。 */
    castBeacon(x, y) {
        const c = this.canCast(1);
        if (!c.ok)
            return c;
        const h = this.player, s = this.rules.xingli.skills[1];
        if (Math.hypot(x - h.x, y - h.y) > s.castRange + 0.5)
            return { ok: false, reason: 'range' };
        for (const u of this.enemiesOf(h.team))
            if (Math.hypot(u.x - x, u.y - y) <= s.radius + u.r * 0.5) {
                u.slowUntil = this.time + s.slowSeconds;
                u.slowFrac = s.slowFraction;
                u.revealUntil = this.time + 1.5;
                this.damage(h, u, s.damage);
            }
        this.marks.push({ x, y, expire: this.time + s.markLifetimeSeconds, born: this.time });
        while (this.marks.length > s.maxActiveMarks)
            this.marks.shift();
        h.cds[1] = s.cooldownSeconds;
        h.castT = this.time;
        this.reveal(h);
        this.events.push({ type: 'beacon', t: this.time, x, y, r: s.radius });
        return { ok: true };
    }
    /** 三星结界能否以该落点成立（给瞄准提示用）。 */
    constellationCheck(x, y) {
        const h = this.player, s = this.rules.xingli.skills[2];
        if (this.marks.length < s.requiresActiveMarks)
            return { ok: false, reason: 'marks' };
        if (Math.hypot(x - h.x, y - h.y) > s.castRange + 0.5)
            return { ok: false, reason: 'range' };
        if (triArea([this.marks[0].x, this.marks[0].y], [this.marks[1].x, this.marks[1].y], [x, y]) < s.minimumTriangleArea)
            return { ok: false, reason: 'area' };
        return { ok: true };
    }
    /** 三星结界：两枚星标 + 落点围成三角，命中其中敌人并定身，随后消耗两枚星标。条件不满足时取消且不进冷却。 */
    castConstellation(x, y) {
        const c = this.canCast(2);
        if (!c.ok)
            return c;
        const v = this.constellationCheck(x, y);
        if (!v.ok)
            return v;
        const h = this.player, s = this.rules.xingli.skills[2];
        const a = [this.marks[0].x, this.marks[0].y], b = [this.marks[1].x, this.marks[1].y], p = [x, y];
        let hits = 0;
        for (const u of this.enemiesOf(h.team))
            if (inTriangle([u.x, u.y], a, b, p)) {
                u.rootUntil = this.time + s.rootSeconds;
                u.revealUntil = this.time + 1.5;
                hits++;
                this.damage(h, u, s.damage);
            }
        this.marks = [];
        h.cds[2] = s.cooldownSeconds;
        h.castT = this.time;
        this.reveal(h);
        this.events.push({ type: 'triangle', t: this.time, x, y, pts: [a, b, p], hits });
        return { ok: true };
    }
    updateCrescents(dt) {
        const s = this.rules.xingli.skills[0], speed = 430;
        for (const c of this.crescents) {
            const stepLen = Math.min(speed * dt, c.left), nx = c.x + c.dx * stepLen, ny = c.y + c.dy * stepLen;
            for (const u of this.enemiesOf(c.src.team)) {
                if (c.hit.has(u.id))
                    continue;
                const t = Math.max(0, Math.min(stepLen, (u.x - c.x) * c.dx + (u.y - c.y) * c.dy));
                if (Math.hypot(c.x + c.dx * t - u.x, c.y + c.dy * t - u.y) <= s.width / 2 + u.r) {
                    c.hit.add(u.id);
                    u.revealUntil = this.time + 1.5;
                    this.damage(c.src, u, s.damage);
                    this.events.push({ type: 'hit', t: this.time, x: u.x, y: u.y });
                }
            }
            c.x = nx;
            c.y = ny;
            c.left -= stepLen;
        }
        this.crescents = this.crescents.filter((c) => c.left > 0.01);
    }
    // ---------------------------------------------------------------- 小兵
    updateMinion(m, dt) {
        m.atkCd = Math.max(0, m.atkCd - dt);
        m.moving = false;
        const aggro = Math.max(m.range + 26, 78);
        let t = m.target;
        if (t && (!this.attackable(t) || !this.visible(t, m.team) || dist(m, t) - t.r > aggro + 20))
            t = null;
        // 优先敌方小兵，其次英雄，最后可攻击建筑
        if (!t || t.kind !== 'minion') {
            const pick = (list, rad) => {
                let best = null, bd = Infinity;
                for (const u of list) {
                    if (u.team === m.team || !u.alive || !this.visible(u, m.team))
                        continue;
                    const d = dist(m, u) - u.r;
                    if (d <= rad && d < bd) {
                        bd = d;
                        best = u;
                    }
                }
                return best;
            };
            t = pick(this.minions, aggro) || (t && t.kind === 'hero' ? t : pick(this.heroes, aggro * 0.85)) || t || pick(this.enemyStructures(m.team), aggro);
        }
        m.target = t;
        if (t) {
            const d = dist(m, t), need = d - t.r - m.range;
            if (need > 0)
                this.moveUnit(m, t.x - m.x, t.y - m.y, dt, need + 0.5);
            else {
                m.faceX = (t.x - m.x) / (d || 1);
                m.faceY = (t.y - m.y) / (d || 1);
                if (m.atkCd <= 0) {
                    m.atkCd = m.interval;
                    m.atkT = this.time;
                    this.reveal(m);
                    if (m.mkind === 'melee')
                        this.damage(m, t, m.dmg);
                    else
                        this.projectiles.push({ x: m.x, y: m.y, target: t, src: m, dmg: m.dmg, speed: 230, style: 'minion', team: m.team });
                }
            }
            m.progress = this.lanePath[m.team][m.lane].project(m.x, m.y);
            return;
        }
        // 脱战后回到原来的路线继续推进
        const path = this.lanePath[m.team][m.lane];
        m.progress = path.project(m.x, m.y);
        const [gx, gy] = path.at(m.progress + 14);
        this.moveUnit(m, gx - m.x, gy - m.y, dt);
    }
    // ---------------------------------------------------------------- 防御塔
    updateTower(t, dt) {
        t.atkCd = Math.max(0, t.atkCd - dt);
        let g = t.target;
        // 锁定目标离开范围、死亡或不可见时重新索敌
        if (g && (!g.alive || dist(t, g) > t.range || !this.visible(g, t.team)))
            g = null;
        if (!g) {
            const pick = (list) => {
                let best = null, bd = Infinity;
                for (const u of list) {
                    if (u.team === t.team || !u.alive || !this.visible(u, t.team))
                        continue;
                    const d = dist(t, u);
                    if (d <= t.range && d < bd) {
                        bd = d;
                        best = u;
                    }
                }
                return best;
            };
            g = pick(this.minions) || pick(this.heroes);
        }
        t.target = g;
        if (g && t.atkCd <= 0) {
            t.atkCd = this.rules.tower.attackInterval;
            this.projectiles.push({ x: t.x, y: t.y, target: g, src: t, dmg: this.rules.tower.attackDamage, speed: 320, style: 'tower', team: t.team });
            this.events.push({ type: 'towerShot', t: this.time, x: t.x, y: t.y });
        }
    }
    updateProjectiles(dt) {
        const keep = [];
        for (const p of this.projectiles) {
            if (!p.target.alive)
                continue;
            const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy), s = p.speed * dt;
            if (d <= s + p.target.r * 0.6) {
                this.damage(p.src, p.target, p.dmg);
                this.events.push({ type: 'hit', t: this.time, x: p.target.x, y: p.target.y });
                if (this.over)
                    return;
                continue;
            }
            p.x += (dx / d) * s;
            p.y += (dy / d) * s;
            keep.push(p);
        }
        this.projectiles = keep;
    }
}
