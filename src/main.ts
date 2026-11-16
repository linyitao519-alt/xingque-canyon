// 入口：加载数据与图标 → 建立对局 → 主循环。
// 调试参数：?auto=1 让 AI 代打星璃；?speed=4 加速模拟（仅用于验证）。
import { Game, MapData, Rules } from './sim.js';
import { Camera, Renderer } from './render.js';
import { Hud } from './hud.js';
import { CamRig } from './camrig.js';
import { AnimInfo, AttachPos, loadArt, loadAnim } from './sprites.js';
import { ThreeLayer } from './three_layer.js';
import { Sfx } from './audio.js';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const scenery = await fetch('assets/data/scenery.json').then((r) => (r.ok ? r.json() : { props: [] })).catch(() => ({ props: [] }));
  const [map, rules] = await Promise.all([
    fetch('assets/data/map.json').then((r) => r.json() as Promise<MapData>),
    fetch('assets/data/match-rules.json').then((r) => r.json() as Promise<Rules>),
  ]);
  // ?towers=v8：切回 v8 的中路塔位（只用于前后对比）
  if (new URLSearchParams(location.search).get('towers') === 'v8') {
    const lay = await fetch('assets/data/tower-layout-v8.json').then((r) => r.json());
    for (const team of ['blue', 'red'] as const) for (const t of map.lanes.mid.towers[team]) if (lay.mid[t.id]) t.position = lay.mid[t.id];
  }
  // 图标顺序：弦月、定星、三星结界
  const icons = ['crescent', 'beacon', 'constellation'].map((n) => { const i = new Image(); i.src = `assets/icons/${n}.png`; return i; });

  // 运行时素材（英雄、小兵、建筑、地形、地表贴图）；?art=0 可切回代码占位
  const q = new URLSearchParams(location.search);
  const art = q.get('art') === '0' ? { loaded: [], tiles: {} } : await loadArt();
  // 布景里会挡路的岩石和树进入同一套碰撞与寻路
  const game = new Game(map, rules, scenery.props.filter((p: any) => p.blockRadius > 0).map((p: any) => ({ x: p.pos[0], y: p.pos[1], r: p.blockRadius })));
  game.autopilot = q.get('auto') === '1';
  // 玩家英雄：?hero=<id> 直接指定；否则开局弹出选择面板（暂停和自动对战模式下默认星璃，不弹）
  const heroIds: string[] = ['xingli', 'xuanyuan', 'hedeng', 'yelan', 'feixian', 'chiyan'].filter((id) => (rules as any).heroes?.[id]);
  const heroQ = q.get('hero') ?? '';
  if (heroIds.includes(heroQ) && heroQ !== 'xingli') { game.playerHero = heroQ; game.reset(); }
  let selecting = false;
  let speed = Math.max(0.1, Math.min(16, Number(q.get('speed')) || 1));
  // 验收截图用：?paused=1 停住实时推进，再用 __xq.step(秒) 以固定步长推进到同一时刻，保证修改前后是同一帧局面
  let paused = q.get('paused') === '1';

  // 序列帧动画在后台加载，加载完自动替换静态图；?anim=0 关闭
  const animReady = q.get('anim') === '0' || q.get('art') === '0' ? Promise.resolve([]) : loadAnim(/^[a-z0-9]+$/.test(q.get('animdir') ?? '') ? `assets/anim-${q.get('animdir')}/` : undefined);   // ?animdir=raw 仅用于前后对比（需要先用 --raw 导入）
  // 音效：首次触控后解锁；?mute=1 默认静音
  AnimInfo.smooth = q.get('animsmooth') !== '0';      // ?animsmooth=0：关掉动作平滑，用于对比
  const sfx = new Sfx(game); sfx.muted = q.get('mute') === '1';
  const cam = new Camera();
  const restart = () => { renderer.actors.clear(); game.reset(); game.autopilot = q.get('auto') === '1'; hud.resetTouches(); cam.ox = cam.oy = 0; cam.snap(game.player.x, game.player.y); };
  const hud = new Hud(canvas, game, cam, icons, restart);
  const renderer = new Renderer(canvas, game, cam, hud);
  // 正式默认：屏高 102、塔屏边提示开、瞄准取景开、塔偏移关、不显示试验按钮。
  // 调试选项：?viewh=120 屏高 120；?toweroffset=1 开塔偏移；?hint=0 关提示；?aimcam=1 / full 开瞄准取景（减幅 / 完整）；?towerring=0 关塔圈；?lab=1 显示试验按钮
  // 渲染后端：默认 three.js（WebGL）；?r=canvas 或 three.js 不可用 / 出错时用 Canvas 2D
  const glCanvas = document.getElementById('gl') as HTMLCanvasElement | null;
  let threeError = '';
  const dropThree = (why: string) => { threeError = why; renderer.three = null; if (glCanvas) glCanvas.style.display = 'none'; console.warn('[xq] three.js 渲染已停用：' + why); const el = document.getElementById('note'); if (el) { el.textContent = 'three.js 渲染已停用，改用 Canvas：' + why; el.style.display = 'block'; } };
  if (q.get('r') !== 'canvas' && glCanvas) {
    if (!ThreeLayer.available()) dropThree('three.js 未加载');
    else try { renderer.three = new ThreeLayer(glCanvas); } catch (e: any) { dropThree(String(e?.message || e)); }
  } else if (glCanvas) glCanvas.style.display = 'none';
  renderer.liveGround = q.get('ground') === 'live';
  // 帧率显示（默认开，?fps=0 关）：最近半秒的帧率、平均与最长帧间隔、本帧渲染耗时、后端
  const fpsEl = document.getElementById('fps'); const showFps = q.get('fps') !== '0';
  if (fpsEl && !showFps) fpsEl.style.display = 'none';
  const perf = { fps: 0, ms: 0, worst: 0, draw: 0, n: 0, acc: 0, mx: 0, dr: 0, t0: performance.now(), frames: 0, slow: 0 };
  const rig = new CamRig(game, cam, hud); hud.rig = rig;
  hud.muted = sfx.muted; hud.onMute = (m) => { sfx.muted = m; };
  rig.opts.hint = q.get('hint') !== '0'; rig.opts.towerOffset = q.get('toweroffset') === '1'; rig.opts.aimCam = q.get('aimcam') === 'full' ? true : q.get('aimcam') === '1' ? 'soft' : false;
  // ?cam=v11：还原 v11 的镜头（跟随速率 7、完整瞄准取景、不对齐像素、阵亡横扫回基地），只用于前后对比录像
  if (q.get('cam') === 'v11') { cam.rate = 7; cam.pixelSnap = false; rig.opts.legacy = true; rig.opts.aimCam = true; }
  renderer.towerRings = q.get('towerring') !== '0' && q.get('cam') !== 'v11'; hud.showLab = q.get('lab') === '1';
  renderer.useTiles(art.tiles);
  renderer.setScenery(scenery);
  renderer.debug = q.get('debug') === '1';
  // ?safe=左,右,上,下（CSS 像素）：在没有刘海的设备上模拟安全区，用于验收
  const safeQ = (q.get('safe') || '').split(',').map(Number);
  const ctx = canvas.getContext('2d')!;
  const probe = document.getElementById('safe')!;
  const rotate = document.getElementById('rotate')!;

  const resize = () => {
    const W = window.innerWidth, H = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    renderer.dpr = dpr;
    cam.dpr = dpr;
    if (renderer.three) try { renderer.three.resize(W, H, dpr); } catch (e: any) { dropThree(String(e?.message || e)); }
    const cs = getComputedStyle(probe);
    cam.resize(W, H);
    const env = safeQ.length === 4 && safeQ.every((n) => n >= 0) ? safeQ : [cs.paddingLeft, cs.paddingRight, cs.paddingTop, cs.paddingBottom].map((v) => parseFloat(v as string) || 0);
    hud.resize(W, H, { l: env[0], r: env[1], t: env[2], b: env[3] });
    cam.snap(cam.fx, cam.fy);
    rotate.style.display = H > W ? 'flex' : 'none';
  };
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 200));
  resize();
  if (Number(q.get('viewh')) === 120) rig.setViewH(120);
  cam.snap(game.player.x, game.player.y);

  // —— 英雄选择面板（DOM）：六名英雄，点一下就以该英雄重开一局 ——
  const pickEl = document.getElementById('pick'), swapEl = document.getElementById('swap');
  const swapFace = () => { if (!swapEl) return; swapEl.innerHTML = ''; const im = document.createElement('img'); im.alt = ''; im.src = `assets/art/portrait-${game.playerHero}.png`; im.onerror = () => im.remove(); swapEl.appendChild(im); swapEl.appendChild(document.createTextNode('换英雄')); };
  const pickHero = (id: string) => { if (!heroIds.includes(id)) return false; game.playerHero = id; restart(); selecting = false; if (pickEl) pickEl.style.display = 'none'; if (swapEl) swapEl.style.display = 'flex'; swapFace(); return true; };
  const openPick = () => {
    if (!pickEl) return;
    selecting = true; hud.resetTouches(); pickEl.innerHTML = ''; pickEl.style.display = 'flex'; if (swapEl) swapEl.style.display = 'none';
    const title = document.createElement('div'); title.className = 'pick-title'; title.textContent = '选择英雄'; pickEl.appendChild(title);
    const row = document.createElement('div'); row.className = 'pick-row'; pickEl.appendChild(row);
    for (const id of heroIds) {
      const d = (rules as any).heroes[id], card = document.createElement('button'); card.className = 'pick-card' + (id === game.playerHero ? ' on' : ''); card.dataset.hero = id; card.style.setProperty('--hc', d.color);
      const img = document.createElement('img'); img.alt = d.name; img.src = `assets/art/hero-${id}.png`; card.appendChild(img);
      const nm = document.createElement('b'); nm.textContent = d.name; card.appendChild(nm);
      const role = document.createElement('i'); role.textContent = d.role; card.appendChild(role);
      const sk = document.createElement('span'); sk.textContent = (id === 'xingli' ? (rules as any).xingli.skills : d.skills).map((s: any) => s.name).join(' · '); card.appendChild(sk);
      const bl = document.createElement('em'); bl.textContent = d.blurb; card.appendChild(bl);
      card.addEventListener('click', () => pickHero(id)); row.appendChild(card);
    }
  };
  if (swapEl) { swapEl.addEventListener('click', openPick); swapEl.style.display = heroIds.length > 1 ? 'flex' : 'none'; swapFace(); }
  if (heroIds.length > 1 && !heroIds.includes(heroQ) && !paused && !game.autopilot) openPick();

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const portrait = window.innerHeight > window.innerWidth;
    if (!portrait && !document.hidden && !paused && !selecting) {
      hud.sync();
      game.update(dt * speed);
      sfx.update();
    }
    if (!paused) rig.update(dt);          // 暂停时镜头只由 __xq.advance / step 推进，保证逐帧录制是确定的
    const d0 = performance.now();
    if (renderer.three) { try { renderer.draw(now / 1000); } catch (e: any) { dropThree(String(e?.message || e)); renderer.draw(now / 1000); } }
    else renderer.draw(now / 1000);
    // 帧率统计：按真实帧间隔算（不是被夹住的 dt）
    const iv = d0 - perf.t0; perf.t0 = d0; perf.n++; perf.acc += iv; perf.mx = Math.max(perf.mx, iv); perf.dr += performance.now() - d0; perf.frames++; if (iv > 25) perf.slow++;
    if (perf.acc >= 500) {
      perf.fps = (perf.n * 1000) / perf.acc; perf.ms = perf.acc / perf.n; perf.worst = perf.mx; perf.draw = perf.dr / perf.n; perf.n = perf.acc = perf.mx = perf.dr = 0;
      if (fpsEl && showFps) fpsEl.textContent = `${perf.fps.toFixed(0)} fps · ${perf.ms.toFixed(1)} ms（最长 ${perf.worst.toFixed(0)}）· 渲染 ${perf.draw.toFixed(1)} ms · ${renderer.three ? 'three.js' : 'canvas'}`;
    }
    ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
    hud.draw(ctx, now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // 验收/调试钩子
  (window as any).__xq = { game, hud, cam, renderer, restart, backend: () => (renderer.three ? 'three' : 'canvas'), pickHero, openPick, selecting: () => selecting, heroIds, perf, threeError: () => threeError, attach: AttachPos, tuning: { VIEW_H: Camera.VIEW_H, KY: Camera.KY, UNIT_SCALE: Camera.UNIT_SCALE, STRUCT_SCALE: Camera.STRUCT_SCALE, AX: Camera.AX, AY: Camera.AY }, art: art.loaded, setSpeed: (s: number) => { speed = s; },
    setPaused: (v: boolean) => { paused = v; }, rig,
    /** 暂停状态下按固定步长推进一帧：输入同步 → 模拟 → 镜头，与实时循环同一条路径（录制对比用） */
    advance: (dt = 1 / 30) => { hud.sync(); game.update(dt); sfx.update(); rig.update(dt); return game.time; },
    sfx, anim: AnimInfo, animReady,
    step: (secs: number) => { for (let i = 0; i < Math.round(secs * 30) && !game.over; i++) game.update(1 / 30); cam.ox = cam.oy = 0; cam.snap(game.player.x, game.player.y); rig.update(0); return game.time; } };
}

boot().catch((e) => {
  const el = document.getElementById('err')!;
  el.style.display = 'block';
  el.textContent = '加载失败：' + (e?.message || e) + '\n请通过 npm start 启动的地址访问（不能直接双击 index.html）。';
});
