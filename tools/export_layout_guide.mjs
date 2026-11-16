// 用工程里实际的世界→屏幕投影（dist/render.js 的 Camera.toScreen）导出中路河口的制作基准。
// 用法：npm run build && node tools/export_layout_guide.mjs > /tmp/mid-layout-raw.json   （再交给 tools/draw_layout_guide.py 出图）
import { readFileSync } from 'node:fs';
import { Camera } from '../dist/render.js';
const load = (f) => JSON.parse(readFileSync(new URL('../assets/data/' + f, import.meta.url), 'utf8'));
const map = load('map.json'), rules = load('match-rules.json'), sc = load('scenery.json'), bd = sc.backdrop;
Camera.VIEW_H = 120;
// 把游戏镜头摆成"1 世界单位 = pxPerUnit 像素、罗盘中心落在 anchorPx"，之后所有坐标都走 cam.toScreen
const cam = new Camera();
cam.W = bd.size[0]; cam.H = bd.pxPerUnit * Camera.VIEW_H; cam.z = bd.pxPerUnit;
cam.x = bd.anchorWorld[0] - (bd.anchorPx[0] - cam.W * Camera.AX) / cam.z;
cam.y = bd.anchorWorld[1] - (bd.anchorPx[1] - cam.H * Camera.AY) / (cam.z * Camera.KY);
const P = (w) => cam.toScreen(w[0], w[1]).map((v) => Math.round(v * 10) / 10);
// 与 scenery.json 里登记的公式互相校验
let maxDiff = 0;
for (const w of [[443, 496], [600, 600], [751, 711], [454, 558]]) {
  const a = P(w), b = [bd.anchorPx[0] + (w[0] - bd.anchorWorld[0]) * bd.pxPerUnit, bd.anchorPx[1] + (w[1] - bd.anchorWorld[1]) * bd.pxPerUnit * bd.ky];
  maxDiff = Math.max(maxDiff, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}
const offset = (pts, d) => pts.map((p, i) => {            // 折线整体向左法线方向平移 d（按相邻段平均法线）
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [p[0] - ((b[1] - a[1]) / L) * d, p[1] + ((b[0] - a[0]) / L) * d];
});
const lane = map.lanes.mid, hw = lane.nominalWidth / 2, rw = map.river.nominalWidth / 2;
const world = {
  laneCenter: lane.blueToRed, laneEdgeSE: offset(lane.blueToRed, hw), laneEdgeNW: offset(lane.blueToRed, -hw),
  riverCenter: map.river.centerline, riverBankSW: offset(map.river.centerline, rw), riverBankNE: offset(map.river.centerline, -rw),
};
const out = {
  check: { maxDiffVsSceneryFormulaPx: maxDiff },
  camera: { KY: Camera.KY, VIEW_H: Camera.VIEW_H, AX: Camera.AX, AY: Camera.AY },
  backdrop: bd, laneHalfWidth: hw, riverHalfWidth: rw,
  world, px: Object.fromEntries(Object.entries(world).map(([k, v]) => [k, v.map(P)])),
  entrances: map.jungleEntrances.map((e) => ({ world: e, px: P(e) })),
  towers: Object.values(lane.towers).flat().map((t) => ({ id: t.id, world: t.position, px: P(t.position), collisionRadius: rules.tower.collisionRadius, attackRange: rules.tower.attackRange })),
  mapRocks: map.staticObstacles.map((o) => ({ world: o.center, radius: o.radius, px: P(o.center) })),
  mapBrush: map.brush.map((o) => ({ world: o.center, radius: o.radius, px: P(o.center) })),
  heroRadius: rules.heroDefaults.collisionRadius,
  current: sc.props.map((p) => ({ ...p, px: P(p.pos) })),
};
console.log(JSON.stringify(out));
