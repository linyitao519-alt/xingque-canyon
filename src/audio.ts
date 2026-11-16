// 音效：把模拟层已有的事件（出手、命中、星标、结界、塔受击、塔毁、结算）映射到 8 个 WAV。
// 浏览器要求先有一次用户手势才能出声：首次触控/按键时创建并恢复 AudioContext，再解码音频。
import type { Game } from './sim.js';

const BASE = ['attack-cast', 'attack-hit', 'tower-hit', 'tower-destroyed', 'victory', 'defeat'];
/** 18 个技能的出手音：sfx-<英雄>-<技能>.wav，一次成功施法（一个 castId）只响一次 */
export const SKILL_SFX: Record<string, string[]> = { xingli: ['crescent', 'beacon', 'starfield'], xuanyuan: ['guard', 'ram', 'ward'], hedeng: ['perch', 'thread', 'recall'], yelan: ['veil', 'backstep', 'reap'], feixian: ['draw', 'snare', 'stance'], chiyan: ['hook', 'sweep', 'ring'] };
const FILES = [...BASE, ...Object.entries(SKILL_SFX).flatMap(([h, ids]) => ids.map((id) => `sfx-${h}-${id}`))];

export class Sfx {
  muted = false;
  /** 每个音效触发了多少次（验收用；静音或尚未解锁时也计数） */
  stats: Record<string, number> = {};
  /** 触发记录：对局时间、音效名、音量、播放速率（给录像混音用） */
  log: { t: number; name: string; vol: number; rate: number }[] = [];
  ctx: AudioContext | null = null;
  private buf: Record<string, AudioBuffer> = {};
  private played = new Set<number>();
  private lastT = -1; private lastHit = -9; private lastStruct = -9; private lastShot = -9;

  constructor(private game: Game, private base = 'assets/audio/') {
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { passive: true });
  }

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running' && Object.keys(this.buf).length === FILES.length; }

  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
        const ctx: AudioContext = (this.ctx = new AC());
        for (const f of FILES)
          fetch(this.base + f + '.wav').then((r) => r.arrayBuffer()).then((a) => new Promise<AudioBuffer>((ok, no) => ctx.decodeAudioData(a, ok, no))).then((b) => { this.buf[f] = b; }).catch(() => { /* 缺文件就静音 */ });
      }
      const cx = this.ctx; if (cx && cx.state !== 'running') void cx.resume();
    } catch { /* 没有音频也不影响游玩 */ }
  }

  play(name: string, vol = 1, rate = 1): void {
    if (vol <= 0.02) return;
    this.stats[name] = (this.stats[name] ?? 0) + 1;
    this.log.push({ t: this.game.time, name, vol: Math.round(vol * 100) / 100, rate });
    if (this.log.length > 4000) this.log.splice(0, 2000);
    const b = this.buf[name], ctx = this.ctx;
    if (this.muted || !b || !ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate; g.gain.value = Math.min(1, vol) * 0.8;
    src.connect(g).connect(ctx.destination); src.start();
  }

  /** 每帧调用：处理上次之后新产生的事件。离星璃越远音量越小，300 单位外不响。 */
  update(): void {
    const g = this.game, p = g.player;
    if (g.time < this.lastT) { this.lastT = -1; this.played.clear(); this.lastHit = this.lastStruct = this.lastShot = -9; }      // 重开
    let maxT = this.lastT;
    for (const e of g.events) {
      if (e.t <= this.lastT) continue;
      maxT = Math.max(maxT, e.t);
      const near = e.type === 'end' ? 1 : Math.max(0, 1 - Math.hypot(e.x - p.x, e.y - p.y) / 300);
      switch (e.type) {
        case 'shot': if (e.player) this.play('attack-cast', 0.75); else if (e.t - this.lastShot > 0.12) { this.lastShot = e.t; this.play('attack-cast', 0.3 * near, 0.85); } break;
        case 'cast': if (e.castId != null && !this.played.has(e.castId)) { this.played.add(e.castId); this.play(`sfx-${e.heroId}-${e.skillId}`, e.casterId === p.id ? 1 : 0.75 * near); } break;
        case 'hit': if (e.t - this.lastHit > 0.07) { this.lastHit = e.t; this.play('attack-hit', 0.55 * near); } break;
        case 'detonate': case 'trapHit': case 'wallHit': case 'ringHit': if (e.t - this.lastHit > 0.07) { this.lastHit = e.t; this.play('attack-hit', 0.8 * near, 1.25); } break;
        case 'structHit': if (e.t - this.lastStruct > 0.16) { this.lastStruct = e.t; this.play('tower-hit', 0.6 * near); } break;
        case 'towerDown': this.play('tower-destroyed', 0.4 + 0.6 * near); break;
        case 'coreDown': this.play('tower-destroyed', 1, 0.8); break;
        case 'end': if (e.winner === 'blue') this.play('victory', 1); else if (e.winner === 'red') this.play('defeat', 1); break;
      }
    }
    this.lastT = maxT;
  }
}
