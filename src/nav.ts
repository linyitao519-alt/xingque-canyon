// 寻路：边界、岩体、塔和水晶进入同一张栅格；A* + 视线拉直。
export interface Circle { x: number; y: number; r: number }
export type Pt = [number, number];

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
  private g: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap: number[] = [];
  private f: Float32Array;

  constructor(readonly width: number, readonly height: number, readonly cell: number,
              readonly bounds: [number, number, number, number]) {
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /** 用碰撞圆重建阻挡；agentR 是单位半径加安全余量。 */
  rebuild(circles: Circle[], agentR: number): void {
    const { cols, rows, cell, bounds, blocked } = this;
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * cell;
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cell;
        blocked[j * cols + i] =
          x < bounds[0] + agentR || x > bounds[2] - agentR || y < bounds[1] + agentR || y > bounds[3] - agentR ? 1 : 0;
      }
    }
    for (const c of circles) {
      const R = c.r + agentR;
      const i0 = Math.max(0, Math.floor((c.x - R) / cell)), i1 = Math.min(cols - 1, Math.floor((c.x + R) / cell));
      const j0 = Math.max(0, Math.floor((c.y - R) / cell)), j1 = Math.min(rows - 1, Math.floor((c.y + R) / cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5) * cell - c.x, dy = (j + 0.5) * cell - c.y;
          if (dx * dx + dy * dy < R * R) blocked[j * cols + i] = 1;
        }
    }
  }

  private idx(x: number, y: number): number {
    const i = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const j = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return j * this.cols + i;
  }

  isBlocked(x: number, y: number): boolean { return this.blocked[this.idx(x, y)] === 1; }

  /** 最近的可走格（按环向外找）。 */
  nearestFreeIdx(x: number, y: number): number {
    const start = this.idx(x, y);
    if (!this.blocked[start]) return start;
    const ci = start % this.cols, cj = (start / this.cols) | 0;
    let best = -1, bestD = Infinity;
    for (let ring = 1; ring < 40; ring++) {
      for (let j = cj - ring; j <= cj + ring; j++) {
        if (j < 0 || j >= this.rows) continue;
        for (let i = ci - ring; i <= ci + ring; i++) {
          if (i < 0 || i >= this.cols) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
          const k = j * this.cols + i;
          if (this.blocked[k]) continue;
          const dx = (i + 0.5) * this.cell - x, dy = (j + 0.5) * this.cell - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = k; }
        }
      }
      if (best >= 0) return best;
    }
    return start;
  }

  center(k: number): Pt { return [((k % this.cols) + 0.5) * this.cell, (((k / this.cols) | 0) + 0.5) * this.cell]; }

  lineClear(ax: number, ay: number, bx: number, by: number): boolean {
    const dx = bx - ax, dy = by - ay;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (this.cell * 0.45)));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      if (this.blocked[this.idx(ax + dx * t, ay + dy * t)]) return false;
    }
    return true;
  }

  private push(k: number): void {
    const h = this.heap, f = this.f;
    let i = h.length; h.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (f[h[p]] <= f[h[i]]) break;
      const t = h[p]; h[p] = h[i]; h[i] = t; i = p;
    }
  }
  private pop(): number {
    const h = this.heap, f = this.f;
    const top = h[0], last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < h.length && f[h[l]] < f[h[m]]) m = l;
        if (r < h.length && f[h[r]] < f[h[m]]) m = r;
        if (m === i) break;
        const t = h[m]; h[m] = h[i]; h[i] = t; i = m;
      }
    }
    return top;
  }

  /** 返回从起点到终点的拐点列表（不含起点）。起终点落在阻挡里时吸附到最近可走格。 */
  findPath(ax: number, ay: number, bx: number, by: number): Pt[] {
    const { cols, rows, blocked, g, f, parent, stamp, closed } = this;
    const s = this.nearestFreeIdx(ax, ay), e = this.nearestFreeIdx(bx, by);
    const goalFree = !this.isBlocked(bx, by);
    if (s === e) return [goalFree ? [bx, by] : this.center(e)];
    const gen = ++this.gen;
    this.heap.length = 0;
    const ei = e % cols, ej = (e / cols) | 0;
    const hfn = (k: number) => {
      const dx = Math.abs((k % cols) - ei), dy = Math.abs(((k / cols) | 0) - ej);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    g[s] = 0; f[s] = hfn(s); parent[s] = -1; stamp[s] = gen; this.push(s);
    let found = false;
    while (this.heap.length) {
      const k = this.pop();
      if (closed[k] === gen) continue;
      closed[k] = gen;
      if (k === e) { found = true; break; }
      const i = k % cols, j = (k / cols) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        const nj = j + dj; if (nj < 0 || nj >= rows) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di; if (ni < 0 || ni >= cols) continue;
          const nk = nj * cols + ni;
          if (blocked[nk] || closed[nk] === gen) continue;
          if (di && dj && (blocked[j * cols + ni] || blocked[nj * cols + i])) continue; // 不切角
          const ng = g[k] + (di && dj ? 1.4142 : 1);
          if (stamp[nk] !== gen || ng < g[nk]) {
            stamp[nk] = gen; g[nk] = ng; f[nk] = ng + hfn(nk); parent[nk] = k; this.push(nk);
          }
        }
      }
    }
    if (!found) return [this.center(e)];
    const raw: Pt[] = [];
    for (let k = e; k !== -1; k = parent[k]) raw.push(this.center(k));
    raw.reverse();
    if (goalFree) raw[raw.length - 1] = [bx, by];
    // 视线拉直
    const out: Pt[] = [];
    let cx = raw[0][0], cy = raw[0][1], i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.lineClear(cx, cy, raw[j][0], raw[j][1])) j--;
      out.push(raw[j]); cx = raw[j][0]; cy = raw[j][1]; i = j;
    }
    return out;
  }
}

/** 带累计长度的折线，用于兵线推进度。 */
export class Polyline {
  readonly cum: number[] = [0];
  constructor(readonly pts: Pt[]) {
    for (let i = 1; i < pts.length; i++)
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  get length(): number { return this.cum[this.cum.length - 1]; }
  at(d: number): Pt {
    const { pts, cum } = this;
    if (d <= 0) return pts[0];
    if (d >= this.length) return pts[pts.length - 1];
    let i = 1;
    while (cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }
  /** 点投影到折线上的推进度。 */
  project(x: number, y: number): number {
    const { pts, cum } = this;
    let best = 0, bestD = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0], ay = pts[i - 1][1], dx = pts[i][0] - ax, dy = pts[i][1] - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
      const px = ax + dx * t - x, py = ay + dy * t - y, d = px * px + py * py;
      if (d < bestD) { bestD = d; best = cum[i - 1] + (cum[i] - cum[i - 1]) * t; }
    }
    return best;
  }
}

export function triArea(a: Pt, b: Pt, c: Pt): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}
export function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const s = (u: Pt, v: Pt) => (p[0] - v[0]) * (u[1] - v[1]) - (u[0] - v[0]) * (p[1] - v[1]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
