import * as Skills from './skills.js';
const TAU = Math.PI * 2;
const hyp = Math.hypot;
const sk = (u) => u.sk ?? null;
/** 朝右的条形贴图（锚点在图中心）：中心放在 (x,y)，沿 (dx,dy) 旋转，长 len、高 hgt */
function strip(c, img, x, y, dx, dy, len, hgt, alpha = 1) {
    if (!img)
        return false;
    c.save();
    c.translate(x, y);
    c.rotate(Math.atan2(dy, dx));
    if (dx < 0)
        c.scale(1, -1);
    c.globalAlpha *= alpha;
    c.drawImage(img, -len / 2, -hgt / 2, len, hgt);
    c.restore();
    return true;
}
/** 两端拉伸的连线贴图：(0,64)→(512,64) */
function link(c, img, x1, y1, x2, y2, hgt, alpha, col) {
    const L = hyp(x2 - x1, y2 - y1);
    if (L < 1)
        return;
    c.save();
    c.translate(x1, y1);
    c.rotate(Math.atan2(y2 - y1, x2 - x1));
    c.globalAlpha *= alpha;
    if (img)
        c.drawImage(img, 0, -hgt / 2, L, hgt);
    else {
        c.strokeStyle = col;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(L, 0);
        c.stroke();
    }
    c.restore();
}
/** 居中的贴地贴图 */
function disc(c, img, x, y, size, alpha = 1, rot = 0) {
    if (!img)
        return false;
    c.save();
    c.translate(x, y);
    if (rot)
        c.rotate(rot);
    c.globalAlpha *= alpha;
    c.drawImage(img, -size / 2, -size / 2, size, size);
    c.restore();
    return true;
}
/** 扇形贴图（锚点在左边中点、开口朝右），裁切到真实扇形 */
function wedge(c, img, x, y, dx, dy, r, angle, alpha) {
    const a0 = Math.atan2(dy, dx), half = angle / 2;
    c.save();
    c.beginPath();
    c.moveTo(x, y);
    c.arc(x, y, r, a0 - half, a0 + half);
    c.closePath();
    if (img) {
        c.clip();
        c.translate(x, y);
        c.rotate(a0);
        c.globalAlpha *= alpha;
        c.drawImage(img, 0, -r * 1.08, r * 1.08, r * 2.16);
    }
    else {
        c.fillStyle = `rgba(255,240,210,${0.4 * alpha})`;
        c.fill();
    }
    c.restore();
}
const ring = (c, x, y, r, col, lw = 1.5, dash) => { c.strokeStyle = col; c.lineWidth = lw; if (dash)
    c.setLineDash(dash); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); if (dash)
    c.setLineDash([]); };
const cross = (c, x, y, s, col) => { c.strokeStyle = col; c.lineWidth = 2.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x + s, y - s); c.lineTo(x - s, y + s); c.stroke(); };
function capsule(c, x, y, dx, dy, len, w) {
    const a = Math.atan2(dy, dx), r = w / 2;
    c.beginPath();
    c.arc(x, y, r, a + Math.PI / 2, a - Math.PI / 2);
    c.arc(x + dx * len, y + dy * len, r, a - Math.PI / 2, a + Math.PI / 2);
    c.closePath();
}
/** 持续状态与一次性反馈。see(u)：玩家一方此刻能不能看到这个单位。 */
export function drawStates(c, fx, g, see) {
    const T = g.time, me = g.player.team, G = g;
    // ---- 地上的东西
    for (const z of G.zones) { // 星河阵：外缘贴合半径，每秒转 24°
        const fade = Math.min(1, (T - z.born) / 0.2), life = (T - z.born) / (z.until - z.born), ph = ((T - z.born) % z.tick) / z.tick;
        c.fillStyle = `rgba(150,110,255,${0.14 * fade})`;
        c.beginPath();
        c.arc(z.x, z.y, z.r, 0, TAU);
        c.fill();
        disc(c, fx['fx-xingli-starfield'], z.x, z.y, z.r * 2, 0.92 * fade, (T * 24 * Math.PI) / 180);
        ring(c, z.x, z.y, z.r, `rgba(215,190,255,${0.9 * fade})`, 1.6);
        ring(c, z.x, z.y, z.r * (0.25 + 0.75 * ph), `rgba(255,240,200,${0.6 * (1 - ph) * fade})`, 2 * (1 - ph) + 0.5);
        c.strokeStyle = `rgba(255,233,168,${0.9 * fade})`;
        c.lineWidth = 1.4;
        c.beginPath();
        c.arc(z.x, z.y, z.r + 3, -Math.PI / 2, -Math.PI / 2 + (1 - life) * TAU);
        c.stroke();
    }
    for (const l of G.lamps) { // 落灯
        const fade = Math.min(1, (T - l.born) / 0.25) * Math.min(1, Math.max(0, (l.until - T) / 0.5)), ph = ((T - l.born) % l.tick) / l.tick;
        disc(c, fx['fx-hedeng-perch'], l.x, l.y, l.r * 2, 0.9 * fade);
        ring(c, l.x, l.y, l.r, `rgba(255,214,140,${(l.team === me ? 0.85 : 0.5) * fade})`, 1.4);
        if (l.team === me)
            ring(c, l.x, l.y, l.r * ph, `rgba(190,255,200,${0.5 * (1 - ph) * fade})`, 1.6);
    }
    for (const t of G.traps) { // 伏矢：只有自己人看得见
        if (t.team !== me)
            continue;
        const arm = Math.min(1, (T - t.born) / Math.max(0.01, t.armAt - t.born)), fade = Math.min(1, Math.max(0, (t.until - T) / 0.6));
        disc(c, fx['fx-feixian-snare'], t.x, t.y, t.r * 2, (0.3 + 0.6 * arm) * fade);
        ring(c, t.x, t.y, t.r, `rgba(255,170,90,${(0.35 + 0.5 * arm) * fade})`, 1.2, arm < 1 ? [4, 4] : undefined);
    }
    for (const r of G.rings) { // 枪围：边线带总厚 = band
        const fade = Math.min(1, (T - r.born) / 0.15) * Math.min(1, Math.max(0, (r.until - T) / 0.5)), band = r.band ?? 17;
        c.strokeStyle = `rgba(255,96,60,${0.22 * fade})`;
        c.lineWidth = band;
        c.beginPath();
        c.arc(r.x, r.y, r.r, 0, TAU);
        c.stroke();
        disc(c, fx['fx-chiyan-ring'], r.x, r.y, (r.r + band / 2) * 2, 0.95 * fade);
        ring(c, r.x, r.y, r.r, `rgba(255,190,150,${0.9 * fade})`, 1.3);
        c.strokeStyle = `rgba(255,233,168,${0.8 * fade})`;
        c.lineWidth = 1.2;
        c.beginPath();
        c.arc(r.x, r.y, r.r + band / 2 + 2, -Math.PI / 2, -Math.PI / 2 + ((r.until - T) / (r.until - r.born)) * TAU);
        c.stroke();
    }
    for (const f of G.flyers)
        if (!strip(c, fx[f.fx], f.x, f.y, f.dx, f.dy, f.width * 2, f.width)) {
            c.fillStyle = 'rgba(255,240,200,.9)';
            c.beginPath();
            c.arc(f.x, f.y, 6, 0, TAU);
            c.fill();
        } // 归鹤
    // ---- 英雄身上的状态
    for (const h of g.heroes) {
        const k = sk(h);
        if (!k || !h.alive || !see(h))
            continue;
        const mine = h.team === me;
        if (k.guard && k.guard.until > T) { // 举盾：朝锁定方向的盾面；挡到伤害闪一下，额度耗尽变淡
            const gd = k.guard, spent = gd.blocked >= gd.budget - 1e-6, fl = Math.max(0, 1 - (T - gd.flashT) / 0.18), R = 30;
            wedge(c, fx['fx-xuanyuan-guard'], h.x, h.y, gd.dx, gd.dy, R, (120 * Math.PI) / 180, spent ? 0.35 : 0.85);
            const a0 = Math.atan2(gd.dy, gd.dx);
            c.strokeStyle = `rgba(255,${spent ? 200 : 236},${spent ? 170 : 190},${(spent ? 0.4 : 0.9) + fl * 0.1})`;
            c.lineWidth = 2 + fl * 3;
            c.beginPath();
            c.arc(h.x, h.y, R, a0 - Math.PI / 3, a0 + Math.PI / 3);
            c.stroke();
        }
        if (k.dash && k.dash.type === 'ram') {
            c.save();
            if (k.dash.emp)
                c.globalCompositeOperation = 'lighter';
            strip(c, fx['fx-xuanyuan-ram'], h.x + k.dash.dx * 8, h.y + k.dash.dy * 8, k.dash.dx, k.dash.dy, 60, 30, 0.95);
            c.restore();
            if (k.dash.emp)
                ring(c, h.x, h.y, 17, 'rgba(255,225,140,.9)', 2);
        }
        if (k.ward && k.ward.until > T) {
            const a = k.ward.ally;
            link(c, fx['fx-xuanyuan-ward'], h.x, h.y, a.x, a.y, 14, 0.9, 'rgba(255,225,150,.9)');
        }
        if (k.thread && k.thread.until > T) {
            const a = k.thread.ally, s = g.skillsOf(h).find((x) => x.id === 'thread'), d = hyp(a.x - h.x, a.y - h.y), near = s ? Math.max(0, (d - (s.breakRange - 22)) / 22) : 0;
            link(c, fx['fx-hedeng-thread'], h.x, h.y, a.x, a.y, 12, 0.9 - 0.4 * near * (0.5 + 0.5 * Math.sin(T * 14)), 'rgba(190,255,225,.9)');
            for (const u of [h, a]) {
                const ph = T * 5;
                c.strokeStyle = 'rgba(190,255,225,.85)';
                c.lineWidth = 1.6;
                for (let i = 0; i < 3; i++) {
                    c.beginPath();
                    c.arc(u.x, u.y, 17.5, ph + i * 2.09, ph + i * 2.09 + 0.8);
                    c.stroke();
                }
            }
        }
        if (k.veilUntil > T && mine)
            ring(c, h.x, h.y, 32, 'rgba(190,150,255,.55)', 1.1, [3, 4]); // 匿影：近身显形距离（只给自己人看）
        if (k.forced) {
            c.strokeStyle = 'rgba(255,255,255,.5)';
            c.lineWidth = 2;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(h.x, h.y);
            c.lineTo(h.x - k.forced.dx * 12, h.y - k.forced.dy * 12);
            c.stroke();
        }
        if (k.casting && h === g.player && k.casting.left > 0) {
            const s = k.casting.s, f = 1 - k.casting.left / Math.max(0.01, s.windupSeconds);
            c.strokeStyle = 'rgba(255,255,255,.8)';
            c.lineWidth = 2;
            c.beginPath();
            c.arc(h.x, h.y, 19, -Math.PI / 2, -Math.PI / 2 + f * TAU);
            c.stroke();
        }
        if (h.shield > 0)
            ring(c, h.x, h.y, 15.5, 'rgba(255,255,255,.85)', 1.6, [5, 4]);
        if (h.stunned && T < h.rootUntil) {
            c.fillStyle = 'rgba(255,235,150,.95)';
            for (let i = 0; i < 3; i++) {
                const a = T * 6 + i * 2.09;
                c.beginPath();
                c.arc(h.x + Math.cos(a) * 9, h.y - 2 + Math.sin(a) * 4, 1.8, 0, TAU);
                c.fill();
            }
        }
    }
    // ---- 标记：月痕（公开）、猎痕（夜岚一方）、猎标（被揭露时）
    for (const u of [...g.heroes, ...g.minions]) {
        if (!u.alive || !see(u))
            continue;
        const m = u.sk?.marks;
        if (!m)
            continue;
        if (m.moon && m.moon.until > T) {
            if (!disc(c, fx['fx-xingli-moonmark'], u.x, u.y, (u.r + 9) * 2, 0.95, T * 0.8)) {
                const a = T * 2.2;
                c.strokeStyle = 'rgba(255,233,168,.95)';
                c.lineWidth = 2.2;
                c.beginPath();
                c.arc(u.x, u.y, u.r + 5, a, a + 2.2);
                c.stroke();
            }
        }
        if (m.hunt && m.hunt.until > T && u.team !== me) {
            c.strokeStyle = 'rgba(200,130,255,.95)';
            c.lineWidth = 1.8;
            c.lineCap = 'round';
            for (const o of [-3, 3]) {
                c.beginPath();
                c.moveTo(u.x + o - 3, u.y - 20);
                c.quadraticCurveTo(u.x + o + 2, u.y - 16, u.x + o - 1, u.y - 11);
                c.stroke();
            }
        }
        if (m.snare && m.snare.until > T) {
            c.fillStyle = 'rgba(255,150,60,.95)';
            c.beginPath();
            c.moveTo(u.x, u.y - 12);
            c.lineTo(u.x - 4.5, u.y - 20);
            c.lineTo(u.x, u.y - 18);
            c.lineTo(u.x + 4.5, u.y - 20);
            c.closePath();
            c.fill();
        }
    }
    // ---- 一次性反馈
    for (const e of g.events) {
        const age = T - e.t;
        if (age < 0 || age > 1)
            continue;
        switch (e.type) {
            case 'cone':
                if (age < 0.24)
                    wedge(c, fx[e.fx], e.x, e.y, e.dx, e.dy, e.r, e.angle, age < 0.12 ? 1 : 1 - (age - 0.12) / 0.12);
                break;
            case 'zoneEnd':
                if (age < 0.2) {
                    const k = age / 0.2;
                    disc(c, fx['fx-xingli-starfield'], e.x, e.y, 132 * (1 + 0.08 * k), 1 - k, (T * 24 * Math.PI) / 180);
                    ring(c, e.x, e.y, 66, `rgba(255,245,215,${1 - k})`, 3 * (1 - k) + 1);
                }
                break;
            case 'detonate':
                if (age < 0.3) {
                    const k = age / 0.3;
                    ring(c, e.x, e.y, 8 + 22 * k, `rgba(255,240,190,${1 - k})`, 3 * (1 - k) + 1);
                }
                break;
            case 'block':
                if (age < 0.2)
                    ring(c, e.x, e.y, 14 + 30 * age, `rgba(255,236,180,${1 - age / 0.2})`, 2.5);
                break;
            case 'redirect':
                if (age < 0.22) {
                    const k = age / 0.22;
                    c.strokeStyle = `rgba(255,245,200,${1 - k})`;
                    c.lineWidth = 3;
                    c.beginPath();
                    c.moveTo(e.x, e.y);
                    c.lineTo(e.x + (e.x2 - e.x) * Math.min(1, k * 1.6), e.y + (e.y2 - e.y) * Math.min(1, k * 1.6));
                    c.stroke();
                }
                break;
            case 'buff':
                if (age < 0.6) {
                    const k = age / 0.6, r = e.r * (0.3 + 0.7 * k);
                    c.fillStyle = `rgba(190,255,225,${0.16 * (1 - k)})`;
                    c.beginPath();
                    c.arc(e.x, e.y, r, 0, TAU);
                    c.fill();
                    ring(c, e.x, e.y, r, `rgba(190,255,225,${0.9 * (1 - k)})`, 3 * (1 - k) + 0.8);
                }
                break;
            case 'veil':
                if (age < 0.45 && e.team === me)
                    disc(c, fx['fx-yelan-veil'], e.x, e.y, 44 * (0.8 + 0.5 * age / 0.45), 1 - age / 0.45);
                break;
            case 'veilEnd':
                if (age < 0.25)
                    ring(c, e.x, e.y, 10 + 40 * age, `rgba(200,150,255,${1 - age / 0.25})`, 1.6);
                break;
            case 'blink':
                if (age < 0.18) {
                    const L = hyp(e.x2 - e.x, e.y2 - e.y) || 1, a = 1 - age / 0.18;
                    if (!strip(c, fx['fx-yelan-backstep'], (e.x + e.x2) / 2, (e.y + e.y2) / 2, (e.x2 - e.x) / L, (e.y2 - e.y) / L, L + 16, 22, a)) {
                        c.strokeStyle = `rgba(200,150,255,${a})`;
                        c.lineWidth = 3;
                        c.beginPath();
                        c.moveTo(e.x, e.y);
                        c.lineTo(e.x2, e.y2);
                        c.stroke();
                    }
                }
                break;
            case 'trapSet':
                if (age < 0.3 && e.team === me)
                    ring(c, e.x, e.y, e.r * (0.4 + 2 * age), `rgba(255,190,110,${1 - age / 0.3})`, 2);
                break;
            case 'trapHit':
                if (age < 0.4) {
                    const k = age / 0.4;
                    c.save();
                    c.globalCompositeOperation = 'lighter';
                    disc(c, fx['fx-feixian-snare'], e.x, e.y, e.r * 2 * (1 + 0.15 * k), 1 - k);
                    c.restore();
                    ring(c, e.x, e.y, e.r, `rgba(255,200,120,${1 - k})`, 3 * (1 - k) + 1);
                }
                break;
            case 'stance':
                if (age < 0.35)
                    disc(c, fx['fx-feixian-stance'], e.x, e.y, 46 * (0.8 + 0.6 * age / 0.35), 1 - age / 0.35);
                if (age < 0.9 && e.who === g.player.id)
                    ring(c, g.player.x, g.player.y, e.r, `rgba(255,190,120,${0.7 * (1 - age / 0.9)})`, 1.4, [6, 5]);
                break;
            case 'lineFx':
                if (age < 0.2) {
                    const a = 1 - age / 0.2;
                    if (!strip(c, fx[e.fx], e.x + e.dx * e.r / 2, e.y + e.dy * e.r / 2, e.dx, e.dy, e.r + 10, Math.max(e.w * 1.9, (e.r + 10) / 2), a)) {
                        c.strokeStyle = `rgba(255,170,130,${a})`;
                        c.lineWidth = 3;
                        c.beginPath();
                        c.moveTo(e.x, e.y);
                        c.lineTo(e.x + e.dx * e.r, e.y + e.dy * e.r);
                        c.stroke();
                    }
                }
                break;
            case 'hooked':
                if (age < 0.3) {
                    c.strokeStyle = `rgba(255,200,170,${0.9 * (1 - age / 0.3)})`;
                    c.lineWidth = 1.8;
                    c.setLineDash([4, 3]);
                    c.beginPath();
                    c.moveTo(e.x, e.y);
                    c.lineTo(e.x2, e.y2);
                    c.stroke();
                    c.setLineDash([]);
                }
                break;
            case 'leap':
                if (age < 0.3) {
                    c.strokeStyle = `rgba(255,170,130,${0.7 * (1 - age / 0.3)})`;
                    c.lineWidth = 2;
                    c.setLineDash([5, 4]);
                    c.beginPath();
                    c.moveTo(e.x, e.y);
                    c.lineTo(e.x2, e.y2);
                    c.stroke();
                    c.setLineDash([]);
                }
                break;
            case 'ringLand':
                if (age < 0.3) {
                    const k = age / 0.3;
                    c.fillStyle = `rgba(255,150,100,${0.3 * (1 - k)})`;
                    c.beginPath();
                    c.arc(e.x, e.y, e.r, 0, TAU);
                    c.fill();
                    ring(c, e.x, e.y, e.r * (0.6 + 0.4 * k), `rgba(255,235,200,${1 - k})`, 3.5 * (1 - k) + 1);
                }
                break;
            case 'ringHit':
            case 'wallHit':
                if (age < 0.25) {
                    const k = age / 0.25;
                    c.strokeStyle = `rgba(255,245,220,${1 - k})`;
                    c.lineWidth = 2;
                    c.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const a = i * 1.05;
                        c.moveTo(e.x + Math.cos(a) * (4 + 6 * k), e.y + Math.sin(a) * (4 + 6 * k));
                        c.lineTo(e.x + Math.cos(a) * (9 + 14 * k), e.y + Math.sin(a) * (9 + 14 * k));
                    }
                    c.stroke();
                }
                break;
            case 'heal':
                if (age < 0.5)
                    ring(c, e.x, e.y, 9 + 16 * age, `rgba(150,255,170,${0.8 * (1 - age / 0.5)})`, 1.8);
                break;
        }
    }
}
/** 玩家的瞄准预告：形状、起点、方向、单位都和实际判定一致。 */
export function drawAim(c, g, i, w, cancel) {
    const p = g.player, s = g.skillsOf(p)[i];
    if (!s || !p.alive)
        return;
    const bad = cancel || !w.ok, col = bad ? '255,110,90' : '140,230,255', hot = '255,233,168';
    const fill = (a = 0.22) => { c.fillStyle = `rgba(${col},${a})`; c.fill(); }, edge = (lw = 1.5) => { c.strokeStyle = `rgba(${col},.9)`; c.lineWidth = lw; c.stroke(); };
    const rangeRing = (r) => ring(c, p.x, p.y, r, `rgba(${col},.6)`, 1.1, [5, 5]);
    const foes = () => [...g.heroes, ...g.minions].filter((u) => u.alive && u.team !== p.team && g.visible(u, p.team));
    const inCone = (u, r, deg) => { const dx = u.x - p.x, dy = u.y - p.y, d = hyp(dx, dy); return d <= r + 1e-6 && (d < 1e-6 || (dx * w.dx + dy * w.dy) / d >= Math.cos((deg * Math.PI) / 360) - 1e-9); };
    switch (s.id) {
        case 'crescent':
        case 'draw':
        case 'hook':
        case 'ram': {
            let len = s.range;
            const wd = s.width ?? 22;
            if (s.id === 'draw')
                len = s.minRange + (s.range - s.minRange) * (w.q ?? 0);
            if (s.id === 'hook')
                len = Skills.clearLen(g, p.x, p.y, w.dx, w.dy, s.range, 2);
            if (s.id === 'ram')
                len = Skills.clearLen(g, p.x, p.y, w.dx, w.dy, s.range, p.r) + p.r;
            capsule(c, p.x, p.y, w.dx, w.dy, len, wd);
            fill();
            edge();
            if (s.id === 'draw' && (w.q ?? 0) < 1) {
                capsule(c, p.x, p.y, w.dx, w.dy, s.range, wd);
                c.strokeStyle = `rgba(${col},.35)`;
                c.lineWidth = 1;
                c.setLineDash([4, 4]);
                c.stroke();
                c.setLineDash([]);
            }
            if (s.id === 'crescent') {
                c.strokeStyle = `rgba(${col},.55)`;
                c.lineWidth = 1.2;
                c.setLineDash([3, 4]);
                c.beginPath();
                c.moveTo(p.x + w.dx * len, p.y + w.dy * len);
                c.quadraticCurveTo(p.x + w.dx * len * 0.5 - w.dy * 14, p.y + w.dy * len * 0.5 + w.dx * 14, p.x, p.y);
                c.stroke();
                c.setLineDash([]);
            } // 回程只提示会折返
            if (s.id === 'hook' || s.id === 'ram') { // 第一个会被拉/推的英雄，以及预计终点
                let best = null, bd = 1e9;
                for (const u of foes()) {
                    if (u.kind !== 'hero')
                        continue;
                    const dx = u.x - p.x, dy = u.y - p.y, al = dx * w.dx + dy * w.dy, pr = Math.abs(dx * -w.dy + dy * w.dx);
                    if (al >= 0 && al <= len + (s.id === 'ram' ? u.r : 0) && pr <= wd / 2 + (s.id === 'ram' ? u.r : 0) && al < bd) {
                        best = u;
                        bd = al;
                    }
                }
                if (best) {
                    ring(c, best.x, best.y, best.r + 4, `rgba(${hot},.95)`, 1.8);
                    const sgn = s.id === 'hook' ? -1 : 1, dist = s.id === 'hook' ? Math.max(0, Math.min(s.pullDistance, hyp(best.x - p.x, best.y - p.y) - s.minSeparation)) : s.pushDistance;
                    const bx = s.id === 'hook' ? (p.x - best.x) / (hyp(best.x - p.x, best.y - p.y) || 1) : w.dx, by = s.id === 'hook' ? (p.y - best.y) / (hyp(best.x - p.x, best.y - p.y) || 1) : w.dy;
                    const go = Math.min(dist, Skills.clearLen(g, best.x, best.y, bx, by, dist, best.r)), ex = best.x + bx * go, ey = best.y + by * go;
                    void sgn;
                    c.strokeStyle = `rgba(${hot},.9)`;
                    c.lineWidth = 1.5;
                    c.setLineDash([3, 3]);
                    c.beginPath();
                    c.moveTo(best.x, best.y);
                    c.lineTo(ex, ey);
                    c.stroke();
                    c.setLineDash([]);
                    ring(c, ex, ey, 4, `rgba(${hot},.95)`, 1.5);
                }
            }
            break;
        }
        case 'guard':
        case 'reap':
        case 'sweep': {
            const r = s.id === 'guard' ? 40 : s.range, deg = s.id === 'guard' ? 120 : s.angleDeg, a0 = Math.atan2(w.dy, w.dx), half = (deg * Math.PI) / 360;
            c.beginPath();
            c.moveTo(p.x, p.y);
            c.arc(p.x, p.y, r, a0 - half, a0 + half);
            c.closePath();
            fill(s.id === 'guard' ? 0.14 : 0.24);
            edge();
            if (s.id === 'reap')
                for (const u of foes())
                    if (u.kind === 'hero' && inCone(u, r, deg) && u.hp / u.maxHp <= s.executeThreshold)
                        ring(c, u.x, u.y, u.r + 5, 'rgba(255,90,90,.95)', 2.2);
            if (s.id === 'sweep')
                for (const u of foes())
                    if (u.kind === 'hero' && inCone(u, r, deg)) {
                        const dx = u.x - p.x, dy = u.y - p.y, d = hyp(dx, dy) || 1;
                        c.strokeStyle = `rgba(${hot},.95)`;
                        c.lineWidth = 2;
                        c.beginPath();
                        c.moveTo(u.x, u.y);
                        c.lineTo(u.x + (dx / d) * 16, u.y + (dy / d) * 16);
                        c.stroke();
                        ring(c, u.x + (dx / d) * 16, u.y + (dy / d) * 16, 2, `rgba(${hot},.95)`, 2);
                    }
            break;
        }
        case 'beacon':
        case 'starfield':
        case 'perch':
        case 'snare':
        case 'ring': {
            rangeRing(s.castRange);
            c.beginPath();
            c.arc(w.x, w.y, s.radius, 0, TAU);
            fill();
            edge();
            if (s.id === 'ring') {
                const band = s.width ?? 17;
                c.strokeStyle = `rgba(${col},.28)`;
                c.lineWidth = band;
                c.beginPath();
                c.arc(w.x, w.y, s.radius, 0, TAU);
                c.stroke();
            }
            if (w.reason === 'spot')
                cross(c, w.x, w.y, 7, 'rgba(255,110,90,.95)');
            if (s.id === 'beacon')
                for (const u of foes())
                    if (hyp(u.x - w.x, u.y - w.y) <= s.radius + 1e-6 && Skills.hasMark(g, u, 'moon', p))
                        ring(c, u.x, u.y, u.r + 5, `rgba(${hot},.95)`, 2.2);
            break;
        }
        case 'ward':
        case 'thread':
        case 'backstep': {
            rangeRing(s.castRange);
            if (s.id === 'thread')
                ring(c, p.x, p.y, s.breakRange, 'rgba(255,170,120,.3)', 1, [2, 6]);
            ring(c, w.x, w.y, s.snapRadius, `rgba(${col},.75)`, 1.2, [3, 3]);
            const t = w.target;
            if (t) {
                ring(c, t.x, t.y, t.r + 5, `rgba(${hot},.95)`, 2);
                if (s.id === 'backstep') {
                    if (w.spot) {
                        c.strokeStyle = `rgba(${col},.8)`;
                        c.lineWidth = 1.4;
                        c.setLineDash([3, 3]);
                        c.beginPath();
                        c.moveTo(p.x, p.y);
                        c.lineTo(w.spot[0], w.spot[1]);
                        c.stroke();
                        c.setLineDash([]);
                        c.fillStyle = `rgba(${col},.85)`;
                        c.beginPath();
                        c.arc(w.spot[0], w.spot[1], 4, 0, TAU);
                        c.fill();
                    }
                    else
                        cross(c, t.x, t.y, 7, 'rgba(255,110,90,.95)');
                }
                else {
                    c.strokeStyle = `rgba(${hot},.85)`;
                    c.lineWidth = 1.6;
                    c.beginPath();
                    c.moveTo(p.x, p.y);
                    c.lineTo(t.x, t.y);
                    c.stroke();
                }
            }
            break;
        }
        case 'recall': { // 点按：按住时把当前路线画出来
            const lamp = g.lamps.find((l) => l.owner === p), k = sk(p), ally = k?.thread && k.thread.until > g.time ? k.thread.ally : null, sx = lamp ? lamp.x : p.x, sy = lamp ? lamp.y : p.y;
            const seg = (ex, ey) => { const L = hyp(ex - sx, ey - sy); if (L < 1)
                return; capsule(c, sx, sy, (ex - sx) / L, (ey - sy) / L, Math.min(L, s.range), s.width); fill(0.16); edge(1.2); };
            if (lamp)
                seg(p.x, p.y);
            if (ally)
                seg(ally.x, ally.y);
            if (!lamp && !ally) {
                c.beginPath();
                c.arc(p.x, p.y, s.width / 2, 0, TAU);
                fill();
                edge();
            }
            break;
        }
        case 'veil':
            ring(c, p.x, p.y, s.proximityReveal ?? 32, `rgba(${col},.8)`, 1.3, [3, 4]);
            break;
        case 'stance':
            ring(c, p.x, p.y, p.ba.range + s.bonusAttackRange, `rgba(${col},.8)`, 1.3, [6, 5]);
            break;
    }
}
