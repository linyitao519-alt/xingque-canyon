// 触控与 HUD：左摇杆、右侧普攻 + 三技能（按住拖动瞄准，松手施放，拖到取消区放弃）、
// 小地图、计时比分、复活倒计时、结算与重开。所有控件都用 Pointer Events 按 pointerId 独立跟踪，
// 所以移动和瞄准可以同时进行。
import { LANES, TEAMS } from './sim.js';
import { TEAM } from './sprites.js';
const FONT = 'system-ui,"PingFang SC","Microsoft YaHei",sans-serif';
const REASON = { busy: '', none: '', cooldown: '技能冷却中', marks: '需要两枚星标', area: '结界面积不足', range: '超出施法距离', dead: '', over: '' };
export class Hud {
    canvas;
    game;
    cam;
    icons;
    onRestart;
    W = 1;
    H = 1;
    safe = { l: 0, r: 0, t: 0, b: 0 };
    joy = { id: -1, bx: 0, by: 0, kx: 0, ky: 0 };
    atkId = -1;
    aim = null;
    aimId = -1;
    keys = new Set();
    toast = { text: '', until: 0 };
    /** 调试/验收用：最近一次施法结果 */
    lastCast = null;
    constructor(canvas, game, cam, icons, onRestart) {
        this.canvas = canvas;
        this.game = game;
        this.cam = cam;
        this.icons = icons;
        this.onRestart = onRestart;
        const o = { passive: false };
        canvas.addEventListener('pointerdown', (e) => this.down(e), o);
        canvas.addEventListener('pointermove', (e) => this.move(e), o);
        canvas.addEventListener('pointerup', (e) => this.up(e), o);
        canvas.addEventListener('pointercancel', (e) => this.up(e, true), o);
        for (const t of ['touchstart', 'touchmove', 'touchend', 'gesturestart', 'contextmenu', 'dblclick'])
            canvas.addEventListener(t, (e) => e.preventDefault(), o);
        addEventListener('keydown', (e) => {
            const k = e.key.toLowerCase();
            if (e.repeat)
                return;
            this.keys.add(k);
            if (k === '1' || k === '2' || k === '3')
                this.release({ i: +k - 1, ax: 0, ay: 0, cancel: false });
            if (k === 'r' && this.game.over)
                this.onRestart();
        });
        addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
        addEventListener('blur', () => { this.keys.clear(); this.resetTouches(); });
    }
    /** env = 系统上报的安全区内边距。再加一圈保底边距，保证没有刘海的机型上按钮也不贴边。 */
    resize(W, H, env) {
        this.W = W;
        this.H = H;
        this.safe = { l: Math.max(env.l, 0) + H * 0.035, r: Math.max(env.r, 0) + H * 0.035, t: Math.max(env.t, 0) + H * 0.02, b: Math.max(env.b, 0) + H * 0.03 };
        this.env = env;
    }
    env = { l: 0, r: 0, t: 0, b: 0 };
    rig = null;
    /** 游戏画面的安全取景框（CSS 像素）：安全区内再让开顶部计时条。屏边提示和镜头偏移都以它为界。 */
    safeRect() { const u = this.H; return [this.safe.l + 0.02 * u, this.safe.t + 0.12 * u, this.W - this.safe.r - 0.02 * u, this.H - this.safe.b - 0.03 * u]; }
    /** 试验开关：屏高 / 提示 / 塔偏移 / 瞄准取景 四个小按钮，排在计时条下面 */
    labBtns() {
        const r = this.rig;
        if (!r || !this.showLab)
            return [];
        const u = this.H, w = 0.2 * u, h = 0.062 * u, gap = 0.012 * u, y = this.safe.t + 0.118 * u;
        const defs = [['zoom', `屏高 ${r.viewH}`, r.viewH !== 120], ['hint', '塔提示', r.opts.hint], ['towerOffset', '塔偏移', r.opts.towerOffset && r.viewH < 120], ['aimCam', '瞄准取景', !!r.opts.aimCam]]; // 塔偏移只在 102 档生效
        const x0 = this.W / 2 - (defs.length * w + (defs.length - 1) * gap) / 2;
        return defs.map(([key, label, on], i) => ({ key, label, on, x: x0 + i * (w + gap), y, w, h }));
    }
    /** 试验按钮：正式界面隐藏，?lab=1 显示 */
    showLab = false;
    /** 所有常驻控件的外接矩形（验收用：检查是否完整落在安全区内）。 */
    controlRects() {
        const circ = (b) => [b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r];
        const m = this.mini, sb = this.skillBtns, pip = sb[2];
        return { minimap: [m.x, m.y, m.x + m.s, m.y + m.s], joystick: circ(this.joyHome), attack: circ(this.atkBtn), skill1: circ(sb[0]), skill2: circ(sb[1]),
            skill3: [pip.x - pip.r, pip.y - pip.r * 1.42, pip.x + pip.r, pip.y + pip.r], cancel: circ(this.cancelBtn), fullscreen: circ(this.fsBtn), mute: circ(this.muteBtn) };
    }
    resetTouches() { this.joy.id = -1; this.atkId = -1; this.aimId = -1; this.aim = null; }
    // ------------------------------------------------------------------ 布局（比例取自镜头参考稿）
    get R() { return this.W - this.safe.r; }
    get B() { return this.H - this.safe.b; }
    get atkBtn() { const u = this.H; return { x: this.R - 0.125 * u, y: this.B - 0.13 * u, r: 0.105 * u }; }
    get skillBtns() {
        const u = this.H, r = 0.076 * u;
        return [{ x: this.R - 0.4 * u, y: this.B - 0.085 * u, r }, { x: this.R - 0.335 * u, y: this.B - 0.3 * u, r }, { x: this.R - 0.125 * u, y: this.B - 0.4 * u, r }];
    }
    get cancelBtn() { const u = this.H; return { x: this.R - 0.125 * u, y: this.safe.t + 0.25 * u, r: 0.08 * u }; }
    get fsBtn() { const u = this.H; return { x: this.R - 0.05 * u, y: this.safe.t + 0.05 * u, r: 0.045 * u }; }
    get muteBtn() { const f = this.fsBtn; return { x: f.x - f.r * 2.5, y: f.y, r: f.r }; }
    muted = false;
    onMute = null;
    get joyHome() { const u = this.H; return { x: this.safe.l + 0.24 * u, y: this.B - 0.2 * u, r: 0.125 * u }; }
    get mini() { const u = this.H; return { x: this.safe.l, y: this.safe.t, s: 0.3 * u }; }
    get restartBtn() { const u = this.H; return { x: this.W / 2 - 0.3 * u, y: this.H * 0.66, w: 0.6 * u, h: 0.15 * u }; }
    // ------------------------------------------------------------------ 输入
    pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    hit(b, x, y, k = 1.2) { return Math.hypot(x - b.x, y - b.y) <= b.r * k; }
    down(e) {
        e.preventDefault();
        try {
            this.canvas.setPointerCapture(e.pointerId);
        }
        catch { /* 合成事件没有活动指针 */ }
        const [x, y] = this.pos(e);
        if (this.game.over) {
            const b = this.restartBtn;
            if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)
                this.onRestart();
            return;
        }
        if (this.hit(this.fsBtn, x, y, 1.2)) {
            this.toggleFullscreen();
            return;
        }
        if (this.hit(this.muteBtn, x, y, 1.2)) {
            this.muted = !this.muted;
            this.onMute?.(this.muted);
            return;
        }
        for (const b of this.labBtns())
            if (x >= b.x && x <= b.x + b.w && y >= b.y - 4 && y <= b.y + b.h + 4) {
                const r = this.rig;
                if (b.key === 'zoom')
                    r.toggleZoom();
                else
                    r.opts[b.key] = !r.opts[b.key];
                return;
            }
        const sb = this.skillBtns;
        for (let i = 0; i < 3; i++)
            if (this.aimId < 0 && this.hit(sb[i], x, y)) {
                this.aimId = e.pointerId;
                this.aim = { i, ax: 0, ay: 0, cancel: false };
                return;
            }
        if (this.atkId < 0 && this.hit(this.atkBtn, x, y)) {
            this.atkId = e.pointerId;
            return;
        }
        const m = this.mini;
        if (this.joy.id < 0 && x < this.W * 0.46 && !(x < m.x + m.s && y < m.y + m.s)) {
            const h = this.joyHome, j = this.joy;
            j.id = e.pointerId;
            j.bx = Math.max(this.safe.l + h.r, x);
            j.by = Math.min(this.B - h.r, Math.max(this.safe.t + h.r, y));
            j.kx = x;
            j.ky = y;
            this.clampKnob();
        }
    }
    clampKnob() {
        const j = this.joy, r = this.joyHome.r, dx = j.kx - j.bx, dy = j.ky - j.by, d = Math.hypot(dx, dy);
        if (d > r) {
            j.kx = j.bx + (dx / d) * r;
            j.ky = j.by + (dy / d) * r;
        }
    }
    move(e) {
        e.preventDefault();
        const [x, y] = this.pos(e);
        if (e.pointerId === this.joy.id) {
            this.joy.kx = x;
            this.joy.ky = y;
            this.clampKnob();
        }
        else if (e.pointerId === this.aimId && this.aim) {
            const b = this.skillBtns[this.aim.i], max = this.H * 0.2;
            let ax = (x - b.x) / max, ay = (y - b.y) / max;
            const L = Math.hypot(ax, ay);
            if (L > 1) {
                ax /= L;
                ay /= L;
            }
            this.aim.ax = ax;
            this.aim.ay = ay;
            this.aim.cancel = this.hit(this.cancelBtn, x, y, 1.25);
        }
    }
    up(e, cancelled = false) {
        e.preventDefault();
        if (e.pointerId === this.joy.id)
            this.joy.id = -1;
        else if (e.pointerId === this.atkId)
            this.atkId = -1;
        else if (e.pointerId === this.aimId) {
            const a = this.aim;
            this.aimId = -1;
            this.aim = null;
            if (a && !cancelled && !a.cancel)
                this.release(a);
        }
    }
    /** 把瞄准拖动换算到世界坐标：拖满 = 最大施法距离；几乎没拖动 = 自动朝最近的敌人。 */
    aimWorld(a) {
        const g = this.game, p = g.player, S = g.skillsOf(p), mag = Math.hypot(a.ax, a.ay), kind = S[a.i]?.kind ?? 'line';
        if (kind === 'buff')
            return { x: p.x, y: p.y, dx: p.faceX, dy: p.faceY, ok: true };
        const auto = mag < 0.18 ? g.pickPlayerTarget(p, 70) : null;
        const tgt = auto && auto.kind !== 'tower' && auto.kind !== 'core' ? auto : null;
        if (kind === 'line' || kind === 'cone' || kind === 'dash') {
            let dx = a.ax, dy = a.ay;
            if (mag < 0.18) {
                if (tgt) {
                    dx = tgt.x - p.x;
                    dy = tgt.y - p.y;
                }
                else {
                    dx = p.faceX;
                    dy = p.faceY;
                }
            }
            const L = Math.hypot(dx, dy) || 1;
            return { x: p.x + (dx / L) * S[a.i].range, y: p.y + (dy / L) * S[a.i].range, dx: dx / L, dy: dy / L, ok: true };
        }
        const range = S[a.i].castRange;
        let x, y;
        if (mag >= 0.18) {
            x = p.x + a.ax * range;
            y = p.y + a.ay * range;
        }
        else if (tgt) {
            const d = Math.hypot(tgt.x - p.x, tgt.y - p.y), k = Math.min(1, range / (d || 1));
            x = p.x + (tgt.x - p.x) * k;
            y = p.y + (tgt.y - p.y) * k;
        }
        else {
            x = p.x + p.faceX * range * 0.6;
            y = p.y + p.faceY * range * 0.6;
        }
        const chk = kind === 'triangle' ? g.constellationCheck(x, y) : { ok: true, reason: undefined };
        return { x, y, dx: 0, dy: 0, ok: chk.ok, reason: chk.reason };
    }
    release(a) {
        const g = this.game, w = this.aimWorld(a);
        const res = g.player.sprite !== 'xingli' ? g.castSkill(a.i, w) : a.i === 0 ? g.castCrescent(w.dx, w.dy) : a.i === 1 ? g.castBeacon(w.x, w.y) : g.castConstellation(w.x, w.y);
        this.lastCast = { skill: a.i, ok: res.ok, reason: res.reason };
        if (!res.ok && res.reason && REASON[res.reason])
            this.toast = { text: REASON[res.reason], until: performance.now() + 1100 };
    }
    /** 没有专属图标的技能：按技能类型画一个矢量图形（直线 / 落点 / 扇形 / 突进 / 增益），用英雄的代表色 */
    glyph(c, kind, b, col) {
        const r = b.r;
        c.save();
        c.translate(b.x, b.y);
        const g = c.createRadialGradient(0, -r * 0.2, r * 0.1, 0, 0, r);
        g.addColorStop(0, 'rgba(255,255,255,.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, r, 0, 7);
        c.fill();
        c.strokeStyle = col;
        c.fillStyle = col;
        c.lineWidth = r * 0.13;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        if (kind === 'line') {
            c.rotate(-Math.PI / 4);
            c.beginPath();
            c.moveTo(-r * 0.55, 0);
            c.lineTo(r * 0.3, 0);
            c.stroke();
            c.beginPath();
            c.moveTo(r * 0.62, 0);
            c.lineTo(r * 0.22, -r * 0.24);
            c.lineTo(r * 0.22, r * 0.24);
            c.closePath();
            c.fill();
        }
        else if (kind === 'ground-circle') {
            c.beginPath();
            c.ellipse(0, r * 0.12, r * 0.52, r * 0.34, 0, 0, 7);
            c.stroke();
            c.beginPath();
            c.arc(0, r * 0.12, r * 0.12, 0, 7);
            c.fill();
            c.beginPath();
            c.moveTo(0, -r * 0.62);
            c.lineTo(0, -r * 0.2);
            c.stroke();
        }
        else if (kind === 'cone') {
            c.beginPath();
            c.moveTo(-r * 0.05, r * 0.45);
            c.arc(-r * 0.05, r * 0.45, r * 0.95, -Math.PI * 0.82, -Math.PI * 0.18);
            c.closePath();
            c.globalAlpha *= 0.35;
            c.fill();
            c.globalAlpha /= 0.35;
            c.stroke();
        }
        else if (kind === 'dash') {
            for (const k of [-0.34, 0.02, 0.38]) {
                c.beginPath();
                c.moveTo(r * (k - 0.2), -r * 0.36);
                c.lineTo(r * (k + 0.16), 0);
                c.lineTo(r * (k - 0.2), r * 0.36);
                c.stroke();
            }
        }
        else {
            c.beginPath();
            c.moveTo(0, -r * 0.58);
            c.lineTo(r * 0.46, -r * 0.36);
            c.lineTo(r * 0.4, r * 0.18);
            c.lineTo(0, r * 0.6);
            c.lineTo(-r * 0.4, r * 0.18);
            c.lineTo(-r * 0.46, -r * 0.36);
            c.closePath();
            c.stroke();
            c.beginPath();
            c.moveTo(0, -r * 0.22);
            c.lineTo(0, r * 0.22);
            c.moveTo(-r * 0.22, 0);
            c.lineTo(r * 0.22, 0);
            c.stroke();
        }
        c.restore();
    }
    /** 每帧把摇杆/键盘状态写进模拟层。 */
    sync() {
        const g = this.game, j = this.joy, k = this.keys;
        let mx = 0, my = 0;
        if (j.id >= 0) {
            const r = this.joyHome.r;
            mx = (j.kx - j.bx) / r;
            my = (j.ky - j.by) / r;
        }
        else {
            mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
            my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
        }
        g.input.mx = mx;
        g.input.my = my;
        g.input.attack = this.atkId >= 0 || k.has('j') || k.has(' ');
    }
    toggleFullscreen() {
        const d = document, el = document.documentElement;
        try {
            if (d.fullscreenElement || d.webkitFullscreenElement)
                (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
            else {
                (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => { });
                screen.orientation?.lock?.('landscape')?.catch?.(() => { });
            }
        }
        catch { /* iPhone Safari 不支持全屏 API */ }
    }
    // ------------------------------------------------------------------ 绘制
    draw(c, nowMs) {
        const g = this.game, u = this.H, p = g.player;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineJoin = 'round';
        this.drawMini(c);
        // 比分与计时
        const tw = 0.56 * u, tx = this.W / 2, ty = this.safe.t + 0.012 * u;
        c.fillStyle = 'rgba(10,26,30,.72)';
        c.beginPath();
        c.roundRect(tx - tw / 2, ty, tw, 0.095 * u, 0.03 * u);
        c.fill();
        const left = Math.max(0, g.rules.mode.maxSeconds - g.time), mm = Math.floor(g.time / 60), ss = Math.floor(g.time % 60);
        c.font = `700 ${Math.round(0.055 * u)}px ${FONT}`;
        c.fillStyle = TEAM.blue.light;
        c.fillText(String(g.kills.blue), tx - tw * 0.33, ty + 0.05 * u);
        c.fillStyle = TEAM.red.light;
        c.fillText(String(g.kills.red), tx + tw * 0.33, ty + 0.05 * u);
        c.fillStyle = left < 60 ? '#ffd27a' : '#fff';
        c.font = `600 ${Math.round(0.045 * u)}px ${FONT}`;
        c.fillText(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, tx, ty + 0.05 * u);
        // 全屏
        const f = this.fsBtn;
        c.fillStyle = 'rgba(10,26,30,.6)';
        c.beginPath();
        c.arc(f.x, f.y, f.r, 0, 7);
        c.fill();
        c.strokeStyle = '#d7e9e4';
        c.lineWidth = 2;
        const q = f.r * 0.42;
        c.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            c.moveTo(f.x + sx * q, f.y + sy * q * 0.35);
            c.lineTo(f.x + sx * q, f.y + sy * q);
            c.lineTo(f.x + sx * q * 0.35, f.y + sy * q);
        }
        c.stroke();
        // 静音键
        const mb = this.muteBtn;
        c.fillStyle = 'rgba(10,26,30,.6)';
        c.beginPath();
        c.arc(mb.x, mb.y, mb.r, 0, 7);
        c.fill();
        c.fillStyle = c.strokeStyle = this.muted ? '#8fa7a2' : '#d7e9e4';
        c.lineWidth = 2;
        const ms = mb.r * 0.5;
        c.beginPath();
        c.moveTo(mb.x - ms, mb.y - ms * 0.4);
        c.lineTo(mb.x - ms * 0.45, mb.y - ms * 0.4);
        c.lineTo(mb.x + ms * 0.15, mb.y - ms * 0.95);
        c.lineTo(mb.x + ms * 0.15, mb.y + ms * 0.95);
        c.lineTo(mb.x - ms * 0.45, mb.y + ms * 0.4);
        c.lineTo(mb.x - ms, mb.y + ms * 0.4);
        c.closePath();
        c.fill();
        c.beginPath();
        if (this.muted) {
            c.moveTo(mb.x + ms * 0.45, mb.y - ms * 0.5);
            c.lineTo(mb.x + ms * 1.1, mb.y + ms * 0.5);
            c.moveTo(mb.x + ms * 1.1, mb.y - ms * 0.5);
            c.lineTo(mb.x + ms * 0.45, mb.y + ms * 0.5);
        }
        else {
            c.arc(mb.x + ms * 0.2, mb.y, ms * 0.6, -0.9, 0.9);
            c.moveTo(mb.x + ms * 0.2 + Math.cos(-0.9) * ms * 1.05, mb.y + Math.sin(-0.9) * ms * 1.05);
            c.arc(mb.x + ms * 0.2, mb.y, ms * 1.05, -0.9, 0.9);
        }
        c.stroke();
        // 摇杆
        const h = this.joyHome, j = this.joy, on = j.id >= 0, bx = on ? j.bx : h.x, by = on ? j.by : h.y;
        c.fillStyle = on ? 'rgba(20,50,54,.5)' : 'rgba(20,50,54,.32)';
        c.strokeStyle = 'rgba(200,240,230,.6)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(bx, by, h.r, 0, 7);
        c.fill();
        c.stroke();
        c.fillStyle = on ? 'rgba(210,250,240,.85)' : 'rgba(210,250,240,.5)';
        c.beginPath();
        c.arc(on ? j.kx : bx, on ? j.ky : by, h.r * 0.42, 0, 7);
        c.fill();
        // 普攻键
        const a = this.atkBtn, held = g.input.attack;
        c.fillStyle = held ? 'rgba(60,110,112,.85)' : 'rgba(22,52,58,.72)';
        c.strokeStyle = held ? '#fff' : 'rgba(200,240,230,.75)';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(a.x, a.y, a.r, 0, 7);
        c.fill();
        c.stroke();
        c.save();
        c.translate(a.x, a.y);
        c.rotate(Math.PI / 4);
        c.fillStyle = '#e6f3ef';
        const s = a.r;
        c.beginPath();
        c.moveTo(0, -s * 0.62);
        c.lineTo(s * 0.13, -s * 0.38);
        c.lineTo(s * 0.1, s * 0.2);
        c.lineTo(-s * 0.1, s * 0.2);
        c.lineTo(-s * 0.13, -s * 0.38);
        c.closePath();
        c.fill();
        c.fillRect(-s * 0.28, s * 0.2, s * 0.56, s * 0.09);
        c.fillRect(-s * 0.06, s * 0.29, s * 0.12, s * 0.26);
        c.restore();
        // 技能键
        const S = g.skillsOf(p), sb = this.skillBtns, isX = p.sprite === 'xingli', hcol = g.heroDef(p.sprite)?.color ?? '#ffe9a8';
        for (let i = 0; i < 3; i++) {
            const b = sb[i], cd = p.cds[i], active = this.aim?.i === i, lack = isX && i === 2 && g.marks.length < 2;
            c.save();
            c.beginPath();
            c.arc(b.x, b.y, b.r, 0, 7);
            c.clip();
            c.fillStyle = '#0f2a30';
            c.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
            const img = isX ? this.icons[i] : null;
            if (!isX && S[i]) {
                c.globalAlpha = cd > 0 || !p.alive ? 0.45 : 1;
                this.glyph(c, S[i].kind, b, hcol);
                c.globalAlpha = 1;
            }
            if (img && img.complete && img.naturalWidth) {
                c.globalAlpha = lack || cd > 0 || !p.alive ? 0.45 : 1;
                c.drawImage(img, b.x - b.r * 1.04, b.y - b.r * 1.04, b.r * 2.08, b.r * 2.08);
                c.globalAlpha = 1;
            }
            if (cd > 0) {
                c.fillStyle = 'rgba(6,16,20,.66)';
                c.beginPath();
                c.moveTo(b.x, b.y);
                c.arc(b.x, b.y, b.r * 1.2, -Math.PI / 2, -Math.PI / 2 + (cd / S[i].cooldownSeconds) * Math.PI * 2);
                c.closePath();
                c.fill();
            }
            c.restore();
            c.strokeStyle = active ? '#fff' : cd > 0 ? 'rgba(160,190,185,.6)' : 'rgba(255,233,168,.95)';
            c.lineWidth = active ? 4 : 2.5;
            c.beginPath();
            c.arc(b.x, b.y, b.r, 0, 7);
            c.stroke();
            if (cd > 0) {
                c.fillStyle = '#fff';
                c.font = `700 ${Math.round(b.r * 0.8)}px ${FONT}`;
                c.fillText(cd < 1 ? cd.toFixed(1) : String(Math.ceil(cd)), b.x, b.y + 1);
            }
            if (isX && i === 2)
                for (let k = 0; k < 2; k++) {
                    c.fillStyle = k < g.marks.length ? '#ffe9a8' : 'rgba(10,26,30,.85)';
                    c.strokeStyle = '#ffe9a8';
                    c.lineWidth = 1.5;
                    c.beginPath();
                    c.arc(b.x + (k - 0.5) * b.r * 0.6, b.y - b.r * 1.22, b.r * 0.17, 0, 7);
                    c.fill();
                    c.stroke();
                }
        }
        // 取消区
        if (this.aim) {
            const k = this.cancelBtn, hot = this.aim.cancel;
            c.fillStyle = hot ? 'rgba(230,70,55,.9)' : 'rgba(40,20,20,.6)';
            c.strokeStyle = hot ? '#fff' : 'rgba(255,150,130,.9)';
            c.lineWidth = 2.5;
            c.beginPath();
            c.arc(k.x, k.y, k.r, 0, 7);
            c.fill();
            c.stroke();
            c.fillStyle = '#fff';
            c.font = `600 ${Math.round(k.r * 0.5)}px ${FONT}`;
            c.fillText('取消', k.x, k.y + 1);
        }
        if (this.toast.until > nowMs && this.toast.text) {
            c.font = `600 ${Math.round(0.05 * u)}px ${FONT}`;
            const w = c.measureText(this.toast.text).width + 0.08 * u;
            c.fillStyle = 'rgba(10,26,30,.8)';
            c.beginPath();
            c.roundRect(this.W / 2 - w / 2, this.H * 0.25, w, 0.09 * u, 0.02 * u);
            c.fill();
            c.fillStyle = '#ffd9cf';
            c.fillText(this.toast.text, this.W / 2, this.H * 0.25 + 0.047 * u);
        }
        // 试验开关
        for (const b of this.labBtns()) {
            c.fillStyle = b.on ? 'rgba(233,198,106,.92)' : 'rgba(10,26,30,.62)';
            c.beginPath();
            c.roundRect(b.x, b.y, b.w, b.h, b.h / 2);
            c.fill();
            c.fillStyle = b.on ? '#1a2a2c' : '#cfe6e0';
            c.font = `600 ${Math.round(b.h * 0.56)}px ${FONT}`;
            c.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
        }
        // 敌塔屏边提示：橙色 = 在射程内；红色放大并闪动 = 已被锁定
        for (const hnt of this.rig?.hints ?? []) {
            const s = u * (hnt.locked ? 0.058 : 0.04), pulse = hnt.locked ? 1 + 0.16 * Math.sin(nowMs / 90) : 1;
            c.save();
            c.translate(hnt.x, hnt.y);
            if (hnt.locked) {
                c.fillStyle = `rgba(255,60,40,${0.2 + 0.14 * Math.sin(nowMs / 90)})`;
                c.beginPath();
                c.arc(0, 0, s * 1.75 * pulse, 0, 7);
                c.fill();
            }
            c.fillStyle = 'rgba(10,20,22,.8)';
            c.beginPath();
            c.arc(0, 0, s * 1.25, 0, 7);
            c.fill();
            c.strokeStyle = hnt.locked ? '#ff4a36' : '#ffb04a';
            c.lineWidth = hnt.locked ? 3.5 : 2.2;
            c.beginPath();
            c.arc(0, 0, s * 1.25, 0, 7);
            c.stroke();
            // 塔形小图标
            c.fillStyle = hnt.locked ? '#ff6a55' : '#ffc36e';
            c.beginPath();
            c.moveTo(0, -s * 0.85);
            c.lineTo(s * 0.32, -s * 0.2);
            c.lineTo(s * 0.26, s * 0.5);
            c.lineTo(s * 0.55, s * 0.75);
            c.lineTo(-s * 0.55, s * 0.75);
            c.lineTo(-s * 0.26, s * 0.5);
            c.lineTo(-s * 0.32, -s * 0.2);
            c.closePath();
            c.fill();
            // 指向塔的箭头
            c.rotate(hnt.angle);
            c.scale(pulse, pulse);
            c.beginPath();
            c.moveTo(s * 2.35, 0);
            c.lineTo(s * 1.5, -s * 0.62);
            c.lineTo(s * 1.5, s * 0.62);
            c.closePath();
            c.fill();
            c.restore();
            if (hnt.locked) { // 感叹号放在箭头的反方向一侧，不会顶到屏幕边或计时条
                const bx = hnt.x - Math.cos(hnt.angle) * s * 2.1, by = hnt.y - Math.sin(hnt.angle) * s * 2.1;
                c.fillStyle = '#ff4a36';
                c.beginPath();
                c.arc(bx, by, s * 0.62, 0, 7);
                c.fill();
                c.fillStyle = '#fff';
                c.font = `800 ${Math.round(s * 0.95)}px ${FONT}`;
                c.fillText('!', bx, by + 1);
            }
        }
        // 复活倒计时
        if (!p.alive && !g.over) {
            c.fillStyle = 'rgba(8,16,20,.45)';
            c.fillRect(0, 0, this.W, this.H);
            c.fillStyle = '#fff';
            c.font = `700 ${Math.round(0.085 * u)}px ${FONT}`;
            c.fillText(`复活倒计时 ${Math.ceil(p.respawn)}`, this.W / 2, this.H * 0.42);
            c.font = `500 ${Math.round(0.042 * u)}px ${FONT}`;
            c.fillStyle = '#cfe6e0';
            c.fillText('将在己方基地复活', this.W / 2, this.H * 0.52);
        }
        if (g.over)
            this.drawResult(c);
    }
    /** 小地图读取同一份地图数据。 */
    drawMini(c) {
        const g = this.game, m = g.map, { x, y, s } = this.mini, k = s / m.world.width;
        const P = (wx, wy) => [x + wx * k, y + wy * k];
        c.save();
        c.beginPath();
        c.roundRect(x, y, s, s, s * 0.06);
        c.fillStyle = 'rgba(14,40,44,.84)';
        c.fill();
        c.clip();
        const line = (pts) => { c.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p[0], p[1]); i ? c.lineTo(a, b) : c.moveTo(a, b); }); };
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = '#2aa3a6';
        c.lineWidth = m.river.nominalWidth * k;
        line(m.river.centerline);
        c.stroke();
        c.strokeStyle = '#aab3aa';
        for (const l of LANES) {
            c.lineWidth = m.lanes[l].nominalWidth * k * 0.8;
            line(m.lanes[l].blueToRed);
            c.stroke();
        }
        c.fillStyle = '#5d6b66';
        for (const o of m.staticObstacles) {
            const [a, b] = P(o.center[0], o.center[1]);
            c.beginPath();
            c.arc(a, b, o.radius * k, 0, 7);
            c.fill();
        }
        for (const t of g.towers) {
            const [a, b] = P(t.x, t.y), r = s * 0.022;
            c.fillStyle = t.alive ? TEAM[t.team].main : 'rgba(90,100,98,.8)';
            c.fillRect(a - r, b - r, r * 2, r * 2);
        }
        for (const t of TEAMS) {
            const k2 = g.cores[t], [a, b] = P(k2.x, k2.y);
            c.fillStyle = TEAM[t].light;
            c.strokeStyle = TEAM[t].dark;
            c.lineWidth = 1.5;
            c.beginPath();
            c.arc(a, b, s * 0.045, 0, 7);
            c.fill();
            c.stroke();
        }
        for (const mn of g.minions)
            if (mn.alive && g.visible(mn, 'blue')) {
                const [a, b] = P(mn.x, mn.y);
                c.fillStyle = TEAM[mn.team].main;
                c.fillRect(a - 1, b - 1, 2.2, 2.2);
            }
        for (const h of g.heroes)
            if (h.alive && g.visible(h, 'blue')) {
                const [a, b] = P(h.x, h.y);
                c.fillStyle = h.isPlayer ? '#8dffb0' : TEAM[h.team].light;
                c.strokeStyle = '#0a1a1e';
                c.lineWidth = 1.2;
                c.beginPath();
                c.arc(a, b, s * (h.isPlayer ? 0.034 : 0.028), 0, 7);
                c.fill();
                c.stroke();
            }
        const v = this.cam.view(), [vx, vy] = P(v[0], v[1]);
        c.strokeStyle = 'rgba(255,255,255,.8)';
        c.lineWidth = 1;
        c.strokeRect(vx, vy, (v[2] - v[0]) * k, (v[3] - v[1]) * k);
        c.restore();
        c.strokeStyle = 'rgba(217,182,92,.8)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.roundRect(x, y, s, s, s * 0.06);
        c.stroke();
    }
    drawResult(c) {
        const g = this.game, u = this.H, w = g.winner;
        c.fillStyle = 'rgba(6,16,20,.72)';
        c.fillRect(0, 0, this.W, this.H);
        const title = w === 'blue' ? '胜利' : w === 'red' ? '失败' : '平局';
        c.fillStyle = w === 'blue' ? '#9fe6ff' : w === 'red' ? '#ffb3a3' : '#ffe9a8';
        c.font = `800 ${Math.round(0.17 * u)}px ${FONT}`;
        c.fillText(title, this.W / 2, this.H * 0.26);
        c.fillStyle = '#e6f3ef';
        c.font = `500 ${Math.round(0.048 * u)}px ${FONT}`;
        const mm = Math.floor(g.time / 60), ss = Math.floor(g.time % 60);
        const why = w === 'draw' ? '到达时间上限' : w === 'blue' ? '敌方水晶已被摧毁' : '己方水晶已被摧毁';
        c.fillText(`${why} · 用时 ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')} · 击杀 ${g.kills.blue} : ${g.kills.red}`, this.W / 2, this.H * 0.42);
        c.fillText(`星璃 ${g.player.kills} 杀 / ${g.player.deaths} 死`, this.W / 2, this.H * 0.52);
        const b = this.restartBtn;
        c.fillStyle = '#e9c66a';
        c.beginPath();
        c.roundRect(b.x, b.y, b.w, b.h, b.h / 2);
        c.fill();
        c.fillStyle = '#1a2a2c';
        c.font = `700 ${Math.round(0.065 * u)}px ${FONT}`;
        c.fillText('再来一局', this.W / 2, b.y + b.h / 2 + 1);
    }
}
