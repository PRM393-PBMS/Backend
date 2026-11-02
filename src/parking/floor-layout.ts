/**
 * Sơ đồ một tầng: lưới w×h, mỗi ô lưới là một loại (lối đi, ô đỗ, cổng, dốc...). Lưu dạng thưa (chỉ ô có nội dung).
 * App và trình vẽ web cùng đọc định dạng này; tìm đường đi trên các ô xe chạy được.
 */
export const CELL_TYPES = ['road', 'slot', 'moto', 'gate', 'ramp', 'stairs', 'wall', 'pillar', 'kiosk', 'walk'] as const;
export type CellType = (typeof CELL_TYPES)[number];
export type Dir = 'N' | 'E' | 'S' | 'W';

export interface LayoutCell {
  x: number;
  y: number;
  t: CellType;
  /** Lối đi một chiều: xe chỉ được rời ô theo hướng này. */
  dir?: Dir;
  /** Ô đỗ: mã ô, loại xe, id ô thật (ghi lại khi xuất bản). */
  code?: string;
  vehicleTypeId?: string;
  slotId?: string;
  /** Cổng: tên, Entry/Exit, id cổng thật. */
  name?: string;
  gateType?: 'Entry' | 'Exit';
  gateId?: string;
  /** Dốc/thang: tầng nối tới. */
  to?: string;
  /** Khu xe máy: số xe ô lưới này chứa được. */
  cap?: number;
}

export interface FloorLayoutData {
  w: number;
  h: number;
  cells: LayoutCell[];
  /** Ảnh mặt bằng làm nền khi vẽ. */
  bg?: { url: string; opacity: number } | null;
}

export const MIN_SIZE = 4;
export const MAX_SIZE = 60;
const DIRS: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPPOSITE: Record<Dir, Dir> = { N: 'S', E: 'W', S: 'N', W: 'E' };
const SLOT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,14}$/;

/** Ô xe chạy qua được. */
export const DRIVABLE = new Set<CellType>(['road', 'gate', 'ramp']);

/** Đọc và chuẩn hoá JSON từ client; trả lỗi dạng chuỗi nếu sai định dạng. */
export function parseLayout(raw: unknown): FloorLayoutData | string {
  if (!raw || typeof raw !== 'object') return 'Sơ đồ không hợp lệ';
  const o = raw as Record<string, unknown>;
  const w = Number(o.w);
  const h = Number(o.h);
  if (![w, h].every((n) => Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE)) {
    return `Kích thước lưới phải từ ${MIN_SIZE} đến ${MAX_SIZE} ô mỗi chiều`;
  }
  if (!Array.isArray(o.cells)) return 'Sơ đồ thiếu danh sách ô';
  const seen = new Set<string>();
  const cells: LayoutCell[] = [];
  for (const item of o.cells as unknown[]) {
    if (!item || typeof item !== 'object') return 'Ô lưới không hợp lệ';
    const c = item as Record<string, unknown>;
    const x = Number(c.x);
    const y = Number(c.y);
    const t = c.t as CellType;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h) {
      return `Ô (${String(c.x)}, ${String(c.y)}) nằm ngoài lưới`;
    }
    if (!CELL_TYPES.includes(t)) return `Loại ô "${String(c.t)}" không hợp lệ`;
    const key = `${x},${y}`;
    if (seen.has(key)) return `Ô (${x}, ${y}) bị vẽ hai lần`;
    seen.add(key);
    const cell: LayoutCell = { x, y, t };
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    if (t === 'road' && c.dir !== undefined && c.dir !== null) {
      if (!['N', 'E', 'S', 'W'].includes(String(c.dir))) return `Hướng lối đi tại (${x}, ${y}) không hợp lệ`;
      cell.dir = c.dir as Dir;
    }
    if (t === 'slot') {
      const code = str(c.code, 15)?.toUpperCase();
      if (!code || !SLOT_CODE_RE.test(code)) return `Ô đỗ tại (${x}, ${y}) cần mã gồm chữ, số hoặc gạch ngang (tối đa 15)`;
      const vt = str(c.vehicleTypeId, 36);
      if (!vt) return `Ô đỗ ${code} chưa chọn loại xe`;
      cell.code = code;
      cell.vehicleTypeId = vt;
      cell.slotId = str(c.slotId, 36);
    }
    if (t === 'gate') {
      const name = str(c.name, 50);
      if (!name) return `Cổng tại (${x}, ${y}) chưa có tên`;
      cell.name = name;
      cell.gateType = c.gateType === 'Exit' ? 'Exit' : 'Entry';
      cell.gateId = str(c.gateId, 36);
    }
    if (t === 'ramp' || t === 'stairs') {
      const to = str(c.to, 36);
      if (!to) return `Dốc/thang tại (${x}, ${y}) chưa chọn tầng nối tới`;
      cell.to = to;
    }
    if (t === 'moto') {
      const cap = c.cap === undefined ? 6 : Number(c.cap);
      if (!Number.isInteger(cap) || cap < 1 || cap > 50) return `Khu xe máy tại (${x}, ${y}): sức chứa từ 1 đến 50`;
      cell.cap = cap;
    }
    cells.push(cell);
  }
  const bg = o.bg as Record<string, unknown> | null | undefined;
  const layout: FloorLayoutData = { w, h, cells };
  if (bg && typeof bg.url === 'string' && bg.url.trim()) {
    const opacity = Number(bg.opacity);
    layout.bg = { url: bg.url.trim().slice(0, 500), opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.4 };
  }
  return layout;
}

function at(layout: FloorLayoutData): Map<string, LayoutCell> {
  return new Map(layout.cells.map((c) => [`${c.x},${c.y}`, c]));
}

/** Đi từ ô [from] sang ô kề theo hướng [d] có được không (lối một chiều). */
export function canMove(from: LayoutCell | undefined, to: LayoutCell | undefined, d: Dir): boolean {
  if (!from || !to || !DRIVABLE.has(from.t) || !DRIVABLE.has(to.t)) return false;
  if (from.dir && from.dir !== d) return false;
  return to.dir !== OPPOSITE[d];
}

/** Các ô xe chạy tới được từ cổng vào và dốc (xe từ tầng khác xuống/lên). */
export function reachableDrivable(layout: FloorLayoutData): Set<string> {
  const grid = at(layout);
  const queue = layout.cells.filter((c) => (c.t === 'gate' && c.gateType !== 'Exit') || c.t === 'ramp');
  const seen = new Set(queue.map((c) => `${c.x},${c.y}`));
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [d, [dx, dy]] of Object.entries(DIRS) as [Dir, [number, number]][]) {
      const key = `${cur.x + dx},${cur.y + dy}`;
      if (seen.has(key)) continue;
      if (canMove(cur, grid.get(key), d)) {
        seen.add(key);
        queue.push(grid.get(key)!);
      }
    }
  }
  return seen;
}

/** Lỗi nghiệp vụ của một sơ đồ (ô đỗ không tới được, trùng mã, thiếu cổng...). Rỗng là hợp lệ. */
export function layoutProblems(layout: FloorLayoutData, floorIdsOfLot: Set<string>, selfFloorId: string): string[] {
  const problems: string[] = [];
  const codes = new Map<string, number>();
  for (const c of layout.cells) {
    if (c.t === 'slot') codes.set(c.code!, (codes.get(c.code!) ?? 0) + 1);
    if ((c.t === 'ramp' || c.t === 'stairs') && (c.to === selfFloorId || !floorIdsOfLot.has(c.to!))) {
      problems.push(`Dốc/thang tại (${c.x}, ${c.y}) phải nối tới một tầng khác của cùng bãi`);
    }
  }
  for (const [code, n] of codes) if (n > 1) problems.push(`Mã ô ${code} bị dùng ${n} lần`);
  const parkable = layout.cells.filter((c) => c.t === 'slot' || c.t === 'moto');
  if (parkable.length === 0) return problems;
  if (!layout.cells.some((c) => (c.t === 'gate' && c.gateType !== 'Exit') || c.t === 'ramp')) {
    problems.push('Tầng có chỗ đỗ nhưng chưa có cổng vào hoặc dốc từ tầng khác');
    return problems;
  }
  const reach = reachableDrivable(layout);
  const stuck = parkable.filter(
    (c) => !Object.values(DIRS).some(([dx, dy]) => reach.has(`${c.x + dx},${c.y + dy}`)),
  );
  if (stuck.length) {
    const names = stuck.slice(0, 8).map((c) => c.code ?? `xe máy (${c.x}, ${c.y})`);
    problems.push(
      `Chưa có lối đi tới: ${names.join(', ')}${stuck.length > 8 ? ` và ${stuck.length - 8} ô khác` : ''}. ` +
        'Mỗi chỗ đỗ phải nằm cạnh một lối đi nối được từ cổng vào.',
    );
  }
  return problems;
}
