export const TEAM = {
    blue: { main: '#3aa6e8', light: '#9fe6ff', dark: '#1f6fa8', glow: 'rgba(120,225,255,' },
    red: { main: '#e8604c', light: '#ffc0ae', dark: '#a83a2c', glow: 'rgba(255,150,125,' },
};
const GOLD = '#d9b65c', GOLD_D = '#a8843a', STONE = '#bfc4bb', STONE_D = '#8d958c', STONE_L = '#dfe3da';
export function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ell = (c, x, y, rx, ry) => { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); };
const poly = (c, p) => { c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2)
    c.lineTo(p[i], p[i + 1]); c.closePath(); };
/** 用透明 PNG 替换占位造型：锚点在图片底边中点。 */
export function imageSprite(img, w, h) {
    return (c, s) => { c.save(); c.scale(s.face, 1); c.drawImage(img, -w / 2, -h, w, h); c.restore(); };
}
function chibi(c, s, L) {
    const run = s.moving ? Math.sin(s.t * 15) : 0;
    const bob = s.moving ? Math.abs(run) * 1.3 : Math.sin(s.t * 2.4 + s.seed) * 0.5;
    const f = s.face, w = L.wide ?? 1;
    const lean = s.atk < 0.22 ? f * 1.6 * (1 - s.atk / 0.22) : 0;
    c.save();
    c.lineJoin = 'round';
    L.back?.(c, s, bob);
    // 腿
    c.fillStyle = '#3a3340';
    c.fillRect(-3.6 + run * 1.8, -7, 2.8, 7);
    c.fillRect(0.8 - run * 1.8, -7, 2.8, 7);
    c.translate(lean, -bob);
    // 披风后摆
    if (L.cape) {
        c.fillStyle = L.cape;
        poly(c, [-f * 2, -22, -f * (10 + run * 1.5) * w, -9, -f * 9.5 * w, -5, -f * 3, -8]);
        c.fill();
    }
    // 身体（钟形衣摆）
    c.fillStyle = L.robe;
    c.beginPath();
    c.moveTo(-4.6 * w, -21);
    c.quadraticCurveTo(-9 * w, -12, -8.2 * w, -5.5);
    c.lineTo(8.2 * w, -5.5);
    c.quadraticCurveTo(9 * w, -12, 4.6 * w, -21);
    c.closePath();
    c.fill();
    c.fillStyle = L.robeD;
    c.beginPath();
    c.moveTo(-8.2 * w, -5.5);
    c.quadraticCurveTo(0, -3.2, 8.2 * w, -5.5);
    c.lineTo(8.4 * w, -8);
    c.quadraticCurveTo(0, -5.6, -8.4 * w, -8);
    c.closePath();
    c.fill();
    c.fillStyle = L.trim;
    c.fillRect(-5 * w, -15.2, 10 * w, 1.6);
    // 手臂
    c.strokeStyle = L.robe;
    c.lineWidth = 3;
    c.lineCap = 'round';
    const arm = s.atk < 0.22 ? -6 : 0;
    c.beginPath();
    c.moveTo(f * 4.5 * w, -19);
    c.lineTo(f * (8 * w + 1), -14 + arm);
    c.stroke();
    c.fillStyle = L.skin;
    ell(c, f * (8 * w + 1.4), -13.6 + arm, 1.4, 1.4);
    c.fill();
    // 头
    if (L.long) {
        c.fillStyle = L.hairD;
        poly(c, [-f * 1, -30, -f * 9, -24, -f * 10.5, -12, -f * 5, -16, -f * 3, -22]);
        c.fill();
    }
    c.fillStyle = L.hairD;
    ell(c, -f * 0.8, -25.6, 7.3, 7.1);
    c.fill();
    c.fillStyle = L.skin;
    ell(c, f * 0.6, -24.8, 5.6, 5.5);
    c.fill();
    c.fillStyle = L.hair;
    c.beginPath();
    c.arc(0, -26.2, 7, Math.PI * 1.02, Math.PI * 1.98);
    c.quadraticCurveTo(f * 3, -27.6, f * 1, -24.6);
    c.quadraticCurveTo(-f * 2.5, -27.8, -f * 6.8, -24.2);
    c.closePath();
    c.fill();
    // 眼
    c.fillStyle = '#3b2a22';
    ell(c, f * 1.2, -24.2, 0.85, 1.25);
    c.fill();
    ell(c, f * 4.3, -24.2, 0.75, 1.15);
    c.fill();
    L.front?.(c, s, bob);
    c.restore();
}
const xingli = (c, s) => chibi(c, s, {
    hair: '#c3acE6', hairD: '#9e86c9', skin: '#ffe9dc', robe: '#f4ecdc', robeD: '#cdb8ea', trim: '#b89adf', cape: '#e9dff3',
    back: (c, s) => { c.fillStyle = 'rgba(190,160,235,.22)'; ell(c, 0, -16, 13, 15); c.fill(); },
    front: (c, s) => {
        const f = s.face;
        // 层叠短斗篷
        c.fillStyle = '#fbf6ea';
        c.beginPath();
        c.moveTo(-6.2, -19.4);
        c.quadraticCurveTo(0, -21, 6.2, -19.4);
        c.lineTo(8, -14.5);
        for (let i = 3; i >= -4; i--)
            c.quadraticCurveTo(i * 2 + 1, -12.2, i * 2, -14.5);
        c.closePath();
        c.fill();
        c.strokeStyle = '#cdb8ea';
        c.lineWidth = 0.6;
        c.stroke();
        // 瞳色与发饰
        c.fillStyle = '#e39a2e';
        ell(c, f * 1.2, -24, 0.5, 0.7);
        c.fill();
        ell(c, f * 4.3, -24, 0.45, 0.65);
        c.fill();
        c.fillStyle = GOLD;
        ell(c, -f * 4.6, -29.5, 1.5, 1.5);
        c.fill();
        // 独立悬浮的青铜星盘
        const ax = f * 14, ay = -29 + Math.sin(s.t * 2.2) * 1.4, a = s.t * (s.atk < 0.3 ? 9 : 1.6);
        c.save();
        c.translate(ax, ay);
        c.fillStyle = 'rgba(255,225,150,.18)';
        ell(c, 0, 0, 7.5, 7.5);
        c.fill();
        c.strokeStyle = GOLD_D;
        c.lineWidth = 1.1;
        ell(c, 0, 0, 5.4, 5.4);
        c.stroke();
        c.strokeStyle = GOLD;
        c.lineWidth = 0.8;
        c.beginPath();
        c.ellipse(0, 0, 5.4, 2 + Math.abs(Math.sin(a)) * 2.4, a * 0.5, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.ellipse(0, 0, 5.4, 1.6, -a * 0.7, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#ffe9a8';
        c.rotate(a);
        poly(c, [0, -3.2, 0.8, -0.8, 3.2, 0, 0.8, 0.8, 0, 3.2, -0.8, 0.8, -3.2, 0, -0.8, -0.8]);
        c.fill();
        c.restore();
    },
});
const guardian = (c, s) => chibi(c, s, {
    hair: '#3a2b26', hairD: '#2a1f1c', skin: '#c98f66', robe: '#d9c8a4', robeD: '#a58f68', trim: TEAM[s.team].main, wide: 1.18,
    front: (c, s) => {
        const f = s.face;
        c.strokeStyle = '#a58f68';
        c.lineWidth = 0.5;
        for (let y = -19; y < -8; y += 2.6) {
            c.beginPath();
            c.moveTo(-6.5, y);
            c.lineTo(6.5, y);
            c.stroke();
        }
        // 圆盾
        c.fillStyle = '#7d6a3e';
        ell(c, f * 9.5, -13, 6.4, 8);
        c.fill();
        c.fillStyle = '#3f6f66';
        ell(c, f * 9.5, -13, 5, 6.5);
        c.fill();
        c.strokeStyle = GOLD;
        c.lineWidth = 0.9;
        ell(c, f * 9.5, -13, 5, 6.5);
        c.stroke();
        ell(c, f * 9.5, -13, 1.6, 2);
        c.stroke();
    },
});
const crane = (c, s) => chibi(c, s, {
    hair: '#b9b6c2', hairD: '#8f8c9a', skin: '#ecd2bd', robe: '#efe6d2', robeD: '#2f5b5c', trim: '#2f5b5c', cape: '#f7f1e2', long: true,
    front: (c, s) => {
        const f = s.face, y = -31 + Math.sin(s.t * 2.6) * 1.5;
        c.fillStyle = '#8f8c9a';
        ell(c, 0, -32.8, 2.2, 2);
        c.fill();
        c.fillStyle = 'rgba(255,225,150,.25)';
        ell(c, f * 13, y, 5.5, 5.5);
        c.fill();
        c.fillStyle = '#ffe2a0';
        poly(c, [f * 13, y - 4, f * 17.5, y + 1, f * 13, y, f * 8.5, y + 1]);
        c.fill();
        c.fillStyle = '#f3c66a';
        poly(c, [f * 13, y, f * 14.5, y + 3.5, f * 11.5, y + 3.5]);
        c.fill();
    },
});
const fox = (c, s) => chibi(c, s, {
    hair: '#26222b', hairD: '#17141b', skin: '#f1d9c7', robe: '#3a2c4a', robeD: '#241b30', trim: TEAM[s.team].main, cape: '#5c3f7a',
    front: (c, s) => {
        const f = s.face;
        c.fillStyle = '#e9e6ee';
        poly(c, [f * 1, -32, f * 3.5, -28.5, f * 0.5, -27.5]);
        c.fill();
        // 狐面
        c.fillStyle = '#f6f1ea';
        poly(c, [-f * 6.5, -31.5, -f * 2.2, -31, -f * 3, -26.5, -f * 6, -27]);
        c.fill();
        c.fillStyle = '#d2463a';
        poly(c, [-f * 6.5, -31.5, -f * 5.6, -34.2, -f * 4.6, -31.2]);
        c.fill();
        // 双刃
        c.strokeStyle = '#a9e6d6';
        c.lineWidth = 1.2;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(f * 10.5, -10, 4.5, f > 0 ? -1.2 : Math.PI - 0.6, f > 0 ? 0.6 : Math.PI + 1.2);
        c.stroke();
        c.beginPath();
        c.arc(-f * 8.5, -9, 4, f > 0 ? Math.PI - 0.6 : -1.2, f > 0 ? Math.PI + 1.2 : 0.6);
        c.stroke();
    },
});
const archer = (c, s) => chibi(c, s, {
    hair: '#d2562f', hairD: '#a63d20', skin: '#f3d3bd', robe: '#8c2f2a', robeD: '#2b2326', trim: '#e9c98a', long: true,
    front: (c, s) => {
        const f = s.face, pull = s.atk < 0.22 ? 2.2 : 0;
        c.strokeStyle = '#6e9c86';
        c.lineWidth = 1.3;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(f * 7.5, -15, 9, f > 0 ? -1.15 : Math.PI - 1.15, f > 0 ? 1.15 : Math.PI + 1.15);
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.75)';
        c.lineWidth = 0.4;
        c.beginPath();
        c.moveTo(f * 11.2, -23.2);
        c.lineTo(f * (11.2 - pull), -15);
        c.lineTo(f * 11.2, -6.8);
        c.stroke();
    },
});
const lancer = (c, s) => chibi(c, s, {
    hair: '#e6e2ea', hairD: '#b9b3c4', skin: '#f1dccb', robe: '#34303a', robeD: '#7c2a26', trim: TEAM[s.team].main, cape: '#8f2f2a', long: true, wide: 1.08,
    front: (c, s) => {
        const f = s.face, th = s.atk < 0.22 ? 5 : 0;
        c.strokeStyle = '#6b4a3a';
        c.lineWidth = 1.1;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-f * 6, -11);
        c.lineTo(f * (15 + th), -17);
        c.stroke();
        c.fillStyle = '#e9edf2';
        poly(c, [f * (15 + th), -18.4, f * (21 + th), -18.4, f * (15 + th), -15.8]);
        c.fill();
        c.fillStyle = '#c8413a';
        ell(c, f * (14 + th), -17, 1.3, 1.3);
        c.fill();
    },
});
// ------------------------------------------------------------------ 小兵
const minionMelee = (c, s) => {
    const T = TEAM[s.team], f = s.face, run = s.moving ? Math.sin(s.t * 16 + s.seed) : 0, hop = Math.abs(run) * 0.8;
    const sw = s.atk < 0.25 ? (1 - s.atk / 0.25) * 1.4 : 0;
    c.fillStyle = '#3a3a40';
    c.fillRect(-3 + run, -3.5, 2.2, 3.5);
    c.fillRect(0.8 - run, -3.5, 2.2, 3.5);
    c.save();
    c.translate(0, -hop);
    // 剑
    c.save();
    c.translate(-f * 4.5, -6.5);
    c.rotate(-f * (0.5 + sw));
    c.fillStyle = '#e8ecef';
    poly(c, [-0.9, 0, 0.9, 0, 0.5, -8, 0, -9.5, -0.5, -8]);
    c.fill();
    c.fillStyle = GOLD;
    c.fillRect(-2, -0.4, 4, 1.2);
    c.restore();
    c.fillStyle = T.main;
    c.beginPath();
    c.roundRect(-4.4, -10.5, 8.8, 8, 2.2);
    c.fill();
    c.fillStyle = '#c9cdd0';
    c.fillRect(-4.4, -10.5, 8.8, 2.6);
    // 头盔
    c.fillStyle = '#b8bcc0';
    ell(c, 0, -13, 4.3, 4);
    c.fill();
    c.fillStyle = '#3a3f46';
    c.fillRect(f > 0 ? 0.2 : -3.8, -13.6, 3.6, 2.2);
    c.fillStyle = T.light;
    c.fillRect(f > 0 ? 1.2 : -3.2, -13.2, 2, 1);
    c.fillStyle = T.main;
    poly(c, [0, -16.6, -f * 5.5, -20.5, -f * 4, -16.4, -f * 1, -15.4]);
    c.fill();
    // 盾
    c.fillStyle = GOLD_D;
    poly(c, [f * 2.2, -11, f * 7.6, -10.4, f * 7.2, -4.6, f * 4.9, -2.2, f * 2.6, -4.6]);
    c.fill();
    c.fillStyle = T.dark;
    poly(c, [f * 3, -10.1, f * 6.8, -9.7, f * 6.5, -5, f * 4.9, -3.3, f * 3.3, -5]);
    c.fill();
    c.restore();
};
const minionRanged = (c, s) => {
    const T = TEAM[s.team], f = s.face, run = s.moving ? Math.sin(s.t * 16 + s.seed) : 0, hop = Math.abs(run) * 0.8;
    c.fillStyle = '#3a3a40';
    c.fillRect(-2.8 + run, -3.2, 2, 3.2);
    c.fillRect(0.8 - run, -3.2, 2, 3.2);
    c.save();
    c.translate(0, -hop);
    c.fillStyle = T.main;
    poly(c, [-3.2, -11, 3.2, -11, 5.2, -2.6, -5.2, -2.6]);
    c.fill();
    c.fillStyle = '#e8e2d2';
    poly(c, [-1.4, -11, 1.4, -11, 2, -2.6, -2, -2.6]);
    c.fill();
    c.fillStyle = '#2f3238';
    ell(c, f * 0.6, -12.4, 2.6, 2.4);
    c.fill();
    c.fillStyle = T.light;
    ell(c, f * 1.6, -12.4, 1, 0.8);
    c.fill();
    // 斗笠
    c.fillStyle = '#e9e3d0';
    poly(c, [-7.2, -13.4, 0, -19.5, 7.2, -13.4]);
    c.fill();
    c.fillStyle = T.main;
    poly(c, [-2.2, -17.6, 0, -19.5, 2.2, -17.6, 3.6, -13.4, -3.6, -13.4]);
    c.fill();
    c.fillStyle = GOLD;
    c.fillRect(-7.2, -13.9, 14.4, 1);
    // 弩
    const k = s.atk < 0.2 ? 1.2 : 0;
    c.strokeStyle = '#8a6a3c';
    c.lineWidth = 1.1;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(f * (1 - k), -7.2);
    c.lineTo(f * (8.4 - k), -7.2);
    c.stroke();
    c.strokeStyle = GOLD;
    c.beginPath();
    c.arc(f * (5 - k), -7.2, 3.6, f > 0 ? -1.2 : Math.PI - 1.2, f > 0 ? 1.2 : Math.PI + 1.2);
    c.stroke();
    c.fillStyle = T.light;
    poly(c, [f * (8.4 - k), -8.2, f * (10.8 - k), -7.2, f * (8.4 - k), -6.2]);
    c.fill();
    c.restore();
};
// ------------------------------------------------------------------ 建筑
function crystal(c, x, y, w, h, team, t, dim = 1) {
    const T = TEAM[team];
    c.fillStyle = T.glow + 0.22 * dim * (0.8 + 0.2 * Math.sin(t * 3)) + ')';
    ell(c, x, y - h / 2, w * 1.9, h * 0.85);
    c.fill();
    c.fillStyle = T.main;
    poly(c, [x, y - h, x + w / 2, y - h * 0.58, x, y, x - w / 2, y - h * 0.58]);
    c.fill();
    c.fillStyle = T.light;
    poly(c, [x, y - h, x, y, x - w / 2, y - h * 0.58]);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.75)';
    poly(c, [x, y - h, x + w * 0.12, y - h * 0.6, x, y - h * 0.3, x - w * 0.14, y - h * 0.6]);
    c.fill();
}
const tower = (c, s) => {
    const T = TEAM[s.team], ky = s.ky;
    if (s.dead) {
        const R = rng(s.seed);
        for (let i = 0; i < 6; i++) {
            const x = (R() - 0.5) * 22, y = (R() - 0.5) * 12, w = 3 + R() * 4;
            c.fillStyle = i % 2 ? STONE_D : '#a6ada4';
            poly(c, [x - w, y, x - w * 0.6, y - w * 0.9, x + w * 0.5, y - w, x + w, y]);
            c.fill();
        }
        c.fillStyle = STONE_D;
        c.fillRect(-4, -7, 8, 7);
        c.fillStyle = '#a6ada4';
        poly(c, [-4, -7, -1, -11, 2, -8, 4, -7]);
        c.fill();
        return;
    }
    // 台阶底座
    for (const [r, y, col] of [[12, 0, STONE_D], [12, -2.6, STONE], [8.6, -2.6, STONE_D], [8.6, -6, STONE_L]]) {
        c.fillStyle = col;
        ell(c, 0, y, r, r * ky);
        c.fill();
    }
    c.strokeStyle = GOLD;
    c.lineWidth = 0.8;
    ell(c, 0, -2.6, 10.6, 10.6 * ky);
    c.stroke();
    // 石柱
    c.fillStyle = STONE_D;
    c.fillRect(-4.6, -36, 9.2, 30);
    c.fillStyle = STONE;
    c.fillRect(-4.6, -36, 5.4, 30);
    c.fillStyle = GOLD;
    c.fillRect(-6, -12, 12, 2);
    c.fillRect(-5.6, -37.5, 11.2, 2.4);
    c.fillStyle = GOLD_D;
    c.fillRect(-6, -10.4, 12, 0.8);
    // 阵营旗
    c.fillStyle = T.main;
    poly(c, [-2.8, -34.5, 2.8, -34.5, 2.8, -16.5, 0, -13.2, -2.8, -16.5]);
    c.fill();
    c.fillStyle = T.light;
    poly(c, [0, -27.5, 1.5, -24.5, 0, -21.5, -1.5, -24.5]);
    c.fill();
    // 托爪与晶体
    c.strokeStyle = GOLD;
    c.lineWidth = 1.5;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-5, -37);
    c.quadraticCurveTo(-9.5, -42, -6, -48);
    c.stroke();
    c.beginPath();
    c.moveTo(5, -37);
    c.quadraticCurveTo(9.5, -42, 6, -48);
    c.stroke();
    crystal(c, 0, -40 + Math.sin(s.t * 1.8 + s.seed) * 0.9, 8.4, 18, s.team, s.t, s.locked ? 0.4 : 1);
    if (s.locked) { // 未解锁：护盾罩
        c.strokeStyle = 'rgba(255,255,255,.55)';
        c.lineWidth = 0.7;
        c.setLineDash([2, 2]);
        ell(c, 0, -27, 14, 31);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = 'rgba(255,255,255,.07)';
        ell(c, 0, -27, 14, 31);
        c.fill();
    }
};
const core = (c, s) => {
    const T = TEAM[s.team], ky = s.ky;
    const roof = (x, y, w) => {
        c.fillStyle = T.main;
        c.beginPath();
        c.moveTo(x - w, y);
        c.quadraticCurveTo(x - w * 0.55, y - 2, x - w * 0.2, y - 9);
        c.lineTo(x + w * 0.2, y - 9);
        c.quadraticCurveTo(x + w * 0.55, y - 2, x + w, y);
        c.quadraticCurveTo(x, y + 3.5, x - w, y);
        c.fill();
        c.strokeStyle = GOLD;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x - w - 1.5, y - 2.2);
        c.quadraticCurveTo(x - w * 0.6, y + 1.6, x, y + 2);
        c.quadraticCurveTo(x + w * 0.6, y + 1.6, x + w + 1.5, y - 2.2);
        c.stroke();
    };
    // 后方楼阁
    for (const dx of [-22, 22]) {
        c.fillStyle = STONE_D;
        c.fillRect(dx - 6, -44, 12, 34);
        c.fillStyle = STONE;
        c.fillRect(dx - 6, -44, 6, 34);
        c.fillStyle = T.dark;
        c.fillRect(dx - 2, -30, 4, 14);
        roof(dx, -26, 12);
        roof(dx, -42, 9.5);
        c.fillStyle = T.main;
        poly(c, [dx - 1.6, -51, dx + 1.6, -51, dx, -60]);
        c.fill();
    }
    // 圆台
    for (const [r, y, col] of [[34, 0, STONE_D], [34, -5, STONE], [26, -5, STONE_D], [26, -8.5, STONE_L]]) {
        c.fillStyle = col;
        ell(c, 0, y, r, r * ky);
        c.fill();
    }
    c.strokeStyle = GOLD;
    c.lineWidth = 1;
    ell(c, 0, -5, 30, 30 * ky);
    c.stroke();
    ell(c, 0, -8.5, 20, 20 * ky);
    c.stroke();
    // 台阶
    c.fillStyle = STONE_L;
    for (let i = 0; i < 4; i++)
        c.fillRect(-7 - i, 12 + i * 2.6, 14 + i * 2, 2.2);
    if (s.dead) {
        c.fillStyle = '#6f7670';
        poly(c, [-8, -8, -5, -16, 0, -11, 4, -18, 8, -8]);
        c.fill();
        return;
    }
    // 星形托座 + 主晶体
    c.fillStyle = GOLD;
    poly(c, [-13, -9, -6, -13, 0, -9.5, 6, -13, 13, -9, 7, -6, -7, -6]);
    c.fill();
    c.strokeStyle = GOLD;
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-9, -10);
    c.quadraticCurveTo(-14, -18, -9.5, -26);
    c.stroke();
    c.beginPath();
    c.moveTo(9, -10);
    c.quadraticCurveTo(14, -18, 9.5, -26);
    c.stroke();
    crystal(c, 0, -11 + Math.sin(s.t * 1.5) * 1.2, 15, 30, s.team, s.t, s.locked ? 0.45 : 1);
    if (s.locked) {
        c.strokeStyle = 'rgba(255,255,255,.5)';
        c.lineWidth = 0.8;
        c.setLineDash([2.5, 2.5]);
        ell(c, 0, -24, 22, 26);
        c.stroke();
        c.setLineDash([]);
    }
};
// ------------------------------------------------------------------ 地形
const rock = (c, s) => {
    const R = rng(s.seed), r = s.r ?? 30, ky = s.ky;
    c.fillStyle = '#5a6350';
    ell(c, 0, 0, r, r * ky);
    c.fill();
    const lumps = [];
    const n = 4 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + R(), d = r * 0.48;
        lumps.push([Math.cos(a) * d, Math.sin(a) * d * ky, r * (0.42 + R() * 0.16), r * (0.5 + R() * 0.5)]);
    }
    lumps.push([0, 0, r * 0.62, r * (0.9 + R() * 0.3)]);
    lumps.sort((a, b) => a[1] - b[1]);
    for (const [x, y, w, h] of lumps) {
        const k = R() * 0.3;
        c.fillStyle = '#7d7c70';
        poly(c, [x - w, y, x - w * 0.86, y - h * 0.62, x - w * 0.3, y - h, x + w * (0.35 + k), y - h * 0.93, x + w * 0.9, y - h * 0.5, x + w, y, x, y + w * ky * 0.5]);
        c.fill();
        c.fillStyle = '#a5a393';
        poly(c, [x - w, y, x - w * 0.86, y - h * 0.62, x - w * 0.3, y - h, x - w * 0.05, y - h * 0.4, x, y + w * ky * 0.5]);
        c.fill();
        c.fillStyle = '#c9c6b4';
        poly(c, [x - w * 0.86, y - h * 0.62, x - w * 0.3, y - h, x + w * (0.35 + k), y - h * 0.93, x - w * 0.05, y - h * 0.62]);
        c.fill();
        c.fillStyle = '#86a565';
        poly(c, [x - w * 0.6, y - h * 0.82, x - w * 0.3, y - h, x + w * (0.25 + k), y - h * 0.95, x - w * 0.1, y - h * 0.78]);
        c.fill();
    }
};
/** 草丛：一半叶片在单位身后、一半在身前。s.r = 半径；s.locked 复用为"前半/后半"。 */
const brush = (c, s) => {
    const R = rng(s.seed + (s.locked ? 7 : 0)), r = s.r ?? 23, ky = s.ky, frontHalf = !!s.locked;
    c.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
        const a = R() * Math.PI, d = Math.sqrt(R()) * r;
        const x = Math.cos(a) * d * (R() < 0.5 ? 1 : -1), y = Math.sin(a) * d * ky * (frontHalf ? 1 : -1);
        const h = 13 + R() * 9, sway = Math.sin(s.t * 1.6 + i + s.seed) * 1.6, bend = (R() - 0.5) * 9;
        c.strokeStyle = i % 3 === 0 ? '#4f8f52' : i % 3 === 1 ? '#74ad5e' : '#3a7646';
        c.lineWidth = 1.5 + R();
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + bend * 0.3, y - h * 0.6, x + bend + sway, y - h);
        c.stroke();
    }
};
const reed = (c, s) => {
    c.strokeStyle = '#6f9a4e';
    c.lineWidth = 0.8;
    c.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
        c.beginPath();
        c.moveTo(i * 1.2, 0);
        c.lineTo(i * 2 + Math.sin(s.t + i) * 0.4, -(s.h ?? 10) * (1 - Math.abs(i) * 0.15));
        c.stroke();
    }
};
const pine = (c, s) => {
    const R = rng(s.seed), h = 30 + R() * 16, w = 9 + R() * 4;
    c.fillStyle = '#5a4634';
    c.fillRect(-1.4, -6, 2.8, 6);
    for (let i = 0; i < 3; i++) {
        const y = -5 - (i * h) / 3.6, ww = w * (1 - i * 0.24);
        c.fillStyle = ['#2f5c40', '#39704a', '#4a8558'][i];
        poly(c, [-ww, y, 0, y - h / 2.2, ww, y]);
        c.fill();
        c.fillStyle = 'rgba(190,215,140,.22)';
        poly(c, [-ww, y, 0, y - h / 2.2, -ww * 0.2, y]);
        c.fill();
    }
};
export const Sprites = {
    xingli, guardian, crane, fox, archer, lancer, minionMelee, minionRanged, tower, core, rock, brush, pine, reed,
};
/** 各对象头顶高度（世界单位），血条和名字据此定位。 */
export const SpriteHeight = { tower: 58, core: 62 };
/** 英雄 ID → 显示名（来自 manifest.json） */
export const HeroNames = {};
// 没有素材时的代码占位：按英雄 ID 取
Object.assign(Sprites, { xuanyuan: guardian, hedeng: crane, yelan: fox, feixian: archer, chiyan: lancer });
function load(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
function blit(c, img, d) {
    const w = (d.h * img.naturalWidth) / img.naturalHeight;
    c.drawImage(img, -w * d.ax, -d.h * d.ay, w, d.h);
}
/** 会动的单位：静态图 + 走路弹跳 + 出手前倾。原图朝右下，朝左时水平翻转。 */
function actor(pick) {
    return (c, s) => {
        const [img, d] = pick(s);
        const hop = s.moving ? Math.abs(Math.sin(s.t * 13 + s.seed)) * (d.h * 0.045) : Math.sin(s.t * 2.2 + s.seed) * (d.h * 0.012);
        const k = s.atk < 0.22 ? 1 - s.atk / 0.22 : 0;
        c.save();
        c.scale(s.face, 1);
        c.translate(k * d.h * 0.06, -hop);
        c.rotate(k * 0.1);
        blit(c, img, d);
        c.restore();
    };
}
export async function loadArt(base = 'assets/') {
    const art = { loaded: [], tiles: {} };
    let m;
    try {
        const r = await fetch(base + 'art/manifest.json');
        if (!r.ok)
            return art;
        m = await r.json();
    }
    catch {
        return art;
    }
    const imgs = {};
    const defs = [...Object.values(m.heroes), ...Object.values(m.minions), ...Object.values(m.structures), ...m.rocks, ...m.brush, ...m.trees];
    await Promise.all([
        ...defs.map(async (d) => { const i = await load(`${base}art/${d.file}.png`); if (i) {
            imgs[d.file] = i;
            art.loaded.push(d.file);
        } }),
        ...Object.entries(m.tiles).map(async ([k, t]) => { const i = await load(`${base}tiles/${t.file}.png`); if (i) {
            art.tiles[k] = { img: i, span: t.span };
            art.loaded.push('tile-' + k);
        } }),
    ]);
    const has = (ds) => ds.length > 0 && ds.every((d) => imgs[d.file]);
    for (const [key, d] of Object.entries(m.heroes)) {
        if (d.name)
            HeroNames[key] = d.name;
        if (imgs[d.file]) {
            Sprites[key] = actor(() => [imgs[d.file], d]);
            SpriteHeight[key] = d.h;
        }
    }
    for (const [key, kind] of [['minionMelee', 'melee'], ['minionRanged', 'ranged']]) {
        const b = m.minions[kind + '-blue'], r = m.minions[kind + '-red'];
        if (b && r && has([b, r]))
            Sprites[key] = actor((s) => (s.team === 'blue' ? [imgs[b.file], b] : [imgs[r.file], r]));
    }
    // 建筑：完好/摧毁两张图用同一缩放和同一锚点（底座占地中心）
    const st = m.structures;
    if (has(Object.values(st).filter((d) => d.file.startsWith('tower')))) {
        SpriteHeight.tower = st['tower-blue-intact'].h * st['tower-blue-intact'].ay;
        Sprites.tower = (c, s) => {
            const d = st[`tower-${s.team}-${s.dead ? 'destroyed' : 'intact'}`];
            c.save();
            if (s.locked)
                c.globalAlpha *= 0.85;
            blit(c, imgs[d.file], d);
            c.restore();
            if (s.locked) {
                c.fillStyle = 'rgba(235,245,255,.10)';
                ell(c, 0, -22, 13, 27);
                c.fill();
            } // 未解锁：一层淡护罩，不画虚线
        };
    }
    if (has(Object.values(st).filter((d) => d.file.startsWith('core')))) {
        SpriteHeight.core = st['core-blue-intact'].h * st['core-blue-intact'].ay;
        Sprites.core = (c, s) => {
            const d = st[`core-${s.team}-${s.dead ? 'destroyed' : 'intact'}`];
            blit(c, imgs[d.file], d);
            if (s.locked) {
                c.fillStyle = 'rgba(235,245,255,.08)';
                ell(c, 0, -20, 19, 23);
                c.fill();
            }
        };
    }
    // 岩体：按碰撞半径缩放，图片底边落在占地圆的前沿；小半径用高岩柱，其余在扁石/苔石间轮换
    if (has(m.rocks))
        Sprites.rock = (c, s) => {
            const r = s.r ?? 30, vi = s.variant ?? (r <= 28 ? 2 : s.seed % 2), d = m.rocks[vi] ?? m.rocks[0], img = imgs[d.file];
            const w = 2 * r * (vi === 2 ? 1.0 : 1.1), h = w / (d.aspect ?? 1);
            c.fillStyle = 'rgba(30,35,25,.3)';
            ell(c, 0, r * 0.2 * s.ky, r * 1.08, r * 1.0 * s.ky);
            c.fill();
            c.drawImage(img, -w * d.ax, r * 0.82 * s.ky - h, w, h);
        };
    // 草丛：s.locked=false 画整丛（在单位身后），true 只画下半截（盖在单位身前）。
    // 三种排法都铺满判定圆（半径 r）：
    //   variant 1 河边长条草：芦穗草拉高变窄，沿河岸方向排成一条，前后错两排
    //   variant 2 野区紧凑草：阔叶花草，一大三小挤成一团
    //   其余：单张贴图（旧样式）
    if (has(m.brush))
        Sprites.brush = (c, s) => {
            const r = s.r ?? 23, ky = s.ky, R = rng(s.seed * 7 + 3), v = s.variant ?? 0;
            const clumps = [];
            if (v === 1) {
                const dx = Math.cos(s.dir ?? 0), dy = Math.sin(s.dir ?? 0), d = m.brush[0];
                for (let row = 0; row < 2; row++)
                    for (let i = 0; i < 4; i++) {
                        const along = (i - 1.5) * 0.46 * r + (row ? 0.2 * r : 0) + (R() - 0.5) * 0.12 * r, off = (row ? 0.32 : -0.3) * r * ky + (R() - 0.5) * 0.1 * r;
                        clumps.push({ x: dx * along - dy * off, y: dy * along + dx * off, w: r * (0.92 + R() * 0.2), tall: 1.32 + R() * 0.2, d, flip: R() < 0.5 });
                    }
            }
            else if (v === 2) {
                const d = m.brush[m.brush.length > 1 ? 1 : 0];
                clumps.push({ x: 0, y: -0.42 * r * ky, w: r * 1.25, tall: 1.0, d, flip: false }, { x: -0.52 * r, y: 0.05 * r * ky, w: r * 1.15, tall: 0.95, d, flip: true }, { x: 0.52 * r, y: 0.1 * r * ky, w: r * 1.15, tall: 0.95, d, flip: false }, { x: 0, y: 0.5 * r * ky, w: r * 1.75, tall: 0.92, d, flip: R() < 0.5 });
            }
            else
                clumps.push({ x: 0, y: r * 0.75 * ky, w: 2 * r * 1.25, tall: 1, d: m.brush[(s.seed / 31) % m.brush.length | 0], flip: false });
            clumps.sort((a, b) => a.y - b.y);
            const cut = v ? 0.62 : 0.52; // 前景层只取每丛下方一截（组合样式取 38%，只盖到小腿，草里的自己人还看得见）
            for (const k of clumps) {
                const img = imgs[k.d.file], h = (k.w / (k.d.aspect ?? 1)) * k.tall;
                c.save();
                c.translate(k.x, k.y + (v ? h * 0.12 : 0));
                if (k.flip)
                    c.scale(-1, 1);
                if (!s.locked)
                    c.drawImage(img, -k.w * k.d.ax, -h, k.w, h);
                else if (v && k.y < 0) { /* 后排的丛不进前景层 */ }
                else
                    c.drawImage(img, 0, img.naturalHeight * cut, img.naturalWidth, img.naturalHeight * (1 - cut), -k.w * k.d.ax, -h + h * cut, k.w, h * (1 - cut));
                c.restore();
            }
        };
    // 岸边矮草：同一套草丛图缩到膝盖以下，明显藏不住人，和真正的草丛区分开
    if (has(m.brush))
        Sprites.reed = (c, s) => {
            const d = m.brush[s.seed % m.brush.length], img = imgs[d.file], h = s.h ?? 12, w = h * (d.aspect ?? 1);
            c.drawImage(img, -w * d.ax + Math.sin(s.t * 1.5 + s.seed) * 0.25, -h, w, h);
        };
    if (has(m.trees))
        Sprites.pine = (c, s) => {
            const d = m.trees[(s.variant ?? s.seed) % m.trees.length], img = imgs[d.file], h = s.h ?? 62 + (s.seed % 5) * 5, w = h * (d.aspect ?? 1);
            c.fillStyle = 'rgba(20,30,20,.28)';
            ell(c, 0, 0, w * 0.3, w * 0.3 * s.ky);
            c.fill();
            c.drawImage(img, -w * d.ax, -h, w, h);
        };
    return art;
}
/** 挂件当前位置（按单位 seed 记；测试读它核对"跟随固定挂点、换状态不跳"） */
export const AttachPos = {};
export const AnimInfo = { loaded: [], states: null, last: {}, smooth: true };
/** 选状态和帧（纯函数）。atk = 距上次出手的秒数；lead = 把攻击动画提前多少秒（小兵的伤害是瞬时的，直接从出手帧播起）。
 *  循环动作额外给出下一帧和淡入比例 mix（每帧最后 blend 的时间里从 0 升到 1），用来补足低帧率。
 *  跑步若带 phase（按位移累计的圈数），帧就跟着脚下走过的距离走，停下不会原地踏步，减速时步子也跟着慢。 */
export function pickFrame(st, s, lead = 0, blend = 0) {
    const a = st.attack, at = s.atk + lead;
    if (s.atk >= 0 && at < a.frames / a.fps) {
        const f = Math.min(a.frames - 1, Math.floor(at * a.fps));
        return { state: 'attack', frame: f, next: f, mix: 0 };
    }
    const name = s.moving ? 'run' : 'idle', d = st[name];
    const pos = name === 'run' && s.phase !== undefined ? (((s.phase % 1) + 1) % 1) * d.frames : (s.t + (s.seed % 7) * 0.13) * d.fps;
    const f = Math.floor(pos) % d.frames, frac = pos - Math.floor(pos);
    const mix = blend > 0 && frac > 1 - blend ? (frac - (1 - blend)) / blend : 0;
    return { state: name, frame: f, next: (f + 1) % d.frames, mix: mix * mix * (3 - 2 * mix) };
}
let animData = null;
export function animQuads(spriteKey, s) {
    if (!animData)
        return null;
    const kind = spriteKey === 'minionMelee' ? 'melee' : spriteKey === 'minionRanged' ? 'ranged' : null;
    const key = kind ? `${kind}-${s.team}` : spriteKey, { def, sets, attachImg } = animData, u = def.units[key], set = sets[key];
    if (!u || !set)
        return null;
    const f = pickFrame(def.states, s, kind ? animData.rel : 0, AnimInfo.smooth ? def.blend ?? 0 : 0), w = (u.h * u.frameW) / u.frameH, n = def.states[f.state].frames;
    AnimInfo.last[s.seed] = f;
    const out = [{ img: set[f.state], u0: f.frame / n, u1: (f.frame + 1) / n, x: -w * u.ax, y: -u.h * u.ay, w, h: u.h, alpha: 1 }];
    if (f.mix > 0.02)
        out.push({ img: set[f.state], u0: f.next / n, u1: (f.next + 1) / n, x: -w * u.ax, y: -u.h * u.ay, w, h: u.h, alpha: f.mix });
    const at = u.attach, ai = at && attachImg[key];
    if (at && ai) {
        const m = f.state === 'attack' ? at.mount.attack[Math.min(f.frame, at.mount.attack.length - 1)] : at.mount[f.state];
        let p = AttachPos[s.seed];
        const dt = p ? s.t - p.t : -1;
        if (!p || dt < 0 || dt > 0.5)
            p = AttachPos[s.seed] = { x: m[0], y: m[1], t: s.t };
        else {
            const k = 1 - Math.exp(-at.follow * dt);
            p.x += (m[0] - p.x) * k;
            p.y += (m[1] - p.y) * k;
            p.t = s.t;
        }
        const bob = Math.sin(s.t * 2.4 + s.seed) * at.bob;
        out.push({ img: ai, u0: 0, u1: 1, x: p.x - at.w * at.cx, y: -(p.y + bob) - at.h * at.cy, w: at.w, h: at.h, alpha: 1 });
    }
    return out;
}
export async function loadAnim(base = 'assets/anim/') {
    let def;
    try {
        const r = await fetch(base + 'anim.json');
        if (!r.ok)
            return [];
        def = await r.json();
    }
    catch {
        return [];
    }
    AnimInfo.states = def.states;
    const sets = {};
    await Promise.all(Object.entries(def.units).map(async ([key, u]) => {
        const got = await Promise.all(['idle', 'run', 'attack'].map((st) => load(`${base}${u.file}-${st}.png`)));
        if (got.every(Boolean)) {
            sets[key] = { idle: got[0], run: got[1], attack: got[2] };
            AnimInfo.loaded.push(key);
        }
    }));
    const attachImg = {};
    await Promise.all(Object.entries(def.units).map(async ([key, u]) => { if (u.attach) {
        const im = await load(base + u.attach.file);
        if (im)
            attachImg[key] = im;
    } }));
    const make = (pick, lead, fallback) => (c, s) => {
        const key = pick(s), u = def.units[key], set = sets[key];
        if (!u || !set) {
            fallback(c, s);
            return;
        }
        const f = pickFrame(def.states, s, lead, AnimInfo.smooth ? def.blend ?? 0 : 0), w = (u.h * u.frameW) / u.frameH;
        AnimInfo.last[s.seed] = f;
        c.save();
        c.scale(s.face, 1);
        c.drawImage(set[f.state], f.frame * u.frameW, 0, u.frameW, u.frameH, -w * u.ax, -u.h * u.ay, w, u.h);
        if (f.mix > 0.02) { // 下一帧淡入：当前帧保持不透明，身体不会在过渡中变透明
            const ga = c.globalAlpha;
            c.globalAlpha = ga * f.mix;
            c.drawImage(set[f.state], f.next * u.frameW, 0, u.frameW, u.frameH, -w * u.ax, -u.h * u.ay, w, u.h);
            c.globalAlpha = ga;
        }
        const at = u.attach, ai = at && attachImg[key];
        if (at && ai) {
            // 挂点：待机/跑步各一个固定点，普攻逐帧（出手那帧抬手）；状态之间用指数跟随过渡，不瞬移
            const m = f.state === 'attack' ? at.mount.attack[Math.min(f.frame, at.mount.attack.length - 1)] : at.mount[f.state];
            let p = AttachPos[s.seed];
            const dt = p ? s.t - p.t : -1;
            if (!p || dt < 0 || dt > 0.5)
                p = AttachPos[s.seed] = { x: m[0], y: m[1], t: s.t };
            else {
                const k = 1 - Math.exp(-at.follow * dt);
                p.x += (m[0] - p.x) * k;
                p.y += (m[1] - p.y) * k;
                p.t = s.t;
            }
            const bob = Math.sin(s.t * 2.4 + s.seed) * at.bob;
            c.drawImage(ai, p.x - at.w * at.cx, -(p.y + bob) - at.h * at.cy, at.w, at.h);
        }
        c.restore();
    };
    const rel = (def.states.attack.release ?? 2) / def.states.attack.fps;
    animData = { def, sets, attachImg, rel };
    for (const key of Object.keys(def.units))
        if (!key.includes('-') && sets[key]) {
            Sprites[key] = make(() => key, 0, Sprites[key]);
            SpriteHeight[key] = def.units[key].h * 0.87;
        }
    for (const [sk, kind] of [['minionMelee', 'melee'], ['minionRanged', 'ranged']])
        if (sets[kind + '-blue'] && sets[kind + '-red'])
            Sprites[sk] = make((s) => `${kind}-${s.team}`, rel, Sprites[sk]);
    return AnimInfo.loaded;
}
