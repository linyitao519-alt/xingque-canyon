const FILES = ['attack-cast', 'attack-hit', 'beacon-placed', 'constellation-close', 'tower-hit', 'tower-destroyed', 'victory', 'defeat'];
export class Sfx {
    game;
    base;
    muted = false;
    /** 每个音效触发了多少次（验收用；静音或尚未解锁时也计数） */
    stats = {};
    /** 触发记录：对局时间、音效名、音量、播放速率（给录像混音用） */
    log = [];
    ctx = null;
    buf = {};
    lastT = -1;
    lastHit = -9;
    lastStruct = -9;
    lastShot = -9;
    constructor(game, base = 'assets/audio/') {
        this.game = game;
        this.base = base;
        const unlock = () => this.unlock();
        for (const ev of ['pointerdown', 'keydown', 'touchend'])
            addEventListener(ev, unlock, { passive: true });
    }
    get ready() { return !!this.ctx && this.ctx.state === 'running' && Object.keys(this.buf).length === FILES.length; }
    unlock() {
        try {
            if (!this.ctx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC)
                    return;
                const ctx = (this.ctx = new AC());
                for (const f of FILES)
                    fetch(this.base + f + '.wav').then((r) => r.arrayBuffer()).then((a) => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no))).then((b) => { this.buf[f] = b; }).catch(() => { });
            }
            const cx = this.ctx;
            if (cx && cx.state !== 'running')
                void cx.resume();
        }
        catch { /* 没有音频也不影响游玩 */ }
    }
    play(name, vol = 1, rate = 1) {
        if (vol <= 0.02)
            return;
        this.stats[name] = (this.stats[name] ?? 0) + 1;
        this.log.push({ t: this.game.time, name, vol: Math.round(vol * 100) / 100, rate });
        if (this.log.length > 4000)
            this.log.splice(0, 2000);
        const b = this.buf[name], ctx = this.ctx;
        if (this.muted || !b || !ctx || ctx.state !== 'running')
            return;
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = b;
        src.playbackRate.value = rate;
        g.gain.value = Math.min(1, vol) * 0.8;
        src.connect(g).connect(ctx.destination);
        src.start();
    }
    /** 每帧调用：处理上次之后新产生的事件。离星璃越远音量越小，300 单位外不响。 */
    update() {
        const g = this.game, p = g.player;
        if (g.time < this.lastT) {
            this.lastT = -1;
            this.lastHit = this.lastStruct = this.lastShot = -9;
        } // 重开
        let maxT = this.lastT;
        for (const e of g.events) {
            if (e.t <= this.lastT)
                continue;
            maxT = Math.max(maxT, e.t);
            const near = e.type === 'end' ? 1 : Math.max(0, 1 - Math.hypot(e.x - p.x, e.y - p.y) / 300);
            switch (e.type) {
                case 'shot':
                    if (e.player)
                        this.play('attack-cast', 0.75);
                    else if (e.t - this.lastShot > 0.12) {
                        this.lastShot = e.t;
                        this.play('attack-cast', 0.3 * near, 0.85);
                    }
                    break;
                case 'cast':
                    if (e.skill === 0)
                        this.play('attack-cast', 0.9, 0.72);
                    break; // 弦月出手：同一音效降调
                case 'hit':
                    if (e.t - this.lastHit > 0.07) {
                        this.lastHit = e.t;
                        this.play('attack-hit', 0.55 * near);
                    }
                    break;
                case 'beacon':
                    this.play('beacon-placed', 0.9);
                    break;
                case 'triangle':
                    this.play('constellation-close', 1);
                    break;
                case 'structHit':
                    if (e.t - this.lastStruct > 0.16) {
                        this.lastStruct = e.t;
                        this.play('tower-hit', 0.6 * near);
                    }
                    break;
                case 'towerDown':
                    this.play('tower-destroyed', 0.4 + 0.6 * near);
                    break;
                case 'coreDown':
                    this.play('tower-destroyed', 1, 0.8);
                    break;
                case 'end':
                    if (e.winner === 'blue')
                        this.play('victory', 1);
                    else if (e.winner === 'red')
                        this.play('defeat', 1);
                    break;
            }
        }
        this.lastT = maxT;
    }
}
