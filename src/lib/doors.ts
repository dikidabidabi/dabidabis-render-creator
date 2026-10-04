// Door annotations untuk denah 2D.
// Disimpan di Sketch.doors. Murni notasi 2D — TIDAK memengaruhi geometri 3D.

export type DoorPoint = { x: number; y: number };

export type DoorType = "swing" | "sliding" | "folding";
export type FoldingSideMode = "one" | "two";
export type FoldingSide = "left" | "right";

export type Door = {
  id: string;
  levelId?: string;
  /** Titik A — engsel (hinge), koordinat dunia kanvas (px). */
  a: DoorPoint;
  /** Titik B — ujung daun pintu yang menempel sisi dinding (sejauh widthCm). */
  b: DoorPoint;
  /** Vektor C — unit normal yang menentukan arah ayun (sisi mana lengkungan jatuh). */
  nx: number;
  ny: number;
  /** 1 = single leaf, 2 = double leaf untuk swing/geser. */
  leaves: 1 | 2;
  /** Jenis gerak daun pintu. Data lama tanpa nilai ini dibaca sebagai swing. */
  type?: DoorType;
  /** Arah pergeseran daun jika type = sliding, relatif dari A menuju B. */
  slideDirection?: "left" | "right";
  /** Susunan pintu lipat dari satu sisi atau terbagi dari dua sisi. */
  foldingSideMode?: FoldingSideMode;
  /** Sisi tujuan lipatan jika foldingSideMode = one. */
  foldingSide?: FoldingSide;
  /** Jumlah panel/lipatan pintu lipat. */
  foldingLeafCount?: number;
  /** Lebar bukaan (cm), 70–200; pintu lipat hingga 800. */
  widthCm: number;
};

export type FoldingDoorGeometry = Pick<Door, "a" | "b" | "nx" | "ny" | "foldingSideMode" | "foldingSide" | "foldingLeafCount">;

/** Segmen daun pintu lipat dalam denah. Setiap daun berselang-seling 45°. */
export function foldingDoorSegments(door: FoldingDoorGeometry): Array<[DoorPoint, DoorPoint]> {
  const dxRaw = door.b.x - door.a.x;
  const dyRaw = door.b.y - door.a.y;
  const length = Math.hypot(dxRaw, dyRaw) || 1;
  const dx = dxRaw / length;
  const dy = dyRaw / length;
  const wallNx = -dy;
  const wallNy = dx;
  const normalSign = door.nx * wallNx + door.ny * wallNy < 0 ? -1 : 1;
  const nx = wallNx * normalSign;
  const ny = wallNy * normalSign;
  const total = Math.max(2, Math.min(24, Math.round(door.foldingLeafCount ?? 4)));
  const groups = door.foldingSideMode === "two"
    ? [Math.ceil(total / 2), Math.floor(total / 2)].filter((count) => count > 0)
    : [total];
  const spans = groups.map((count) => length * count / total);
  const segments: Array<[DoorPoint, DoorPoint]> = [];
  let cursor = door.foldingSideMode === "one" && door.foldingSide === "left" ? length : 0;
  const mainDirection = door.foldingSideMode === "one" && door.foldingSide === "left" ? -1 : 1;

  const appendGroup = (start: number, span: number, count: number, direction: number, phase: number) => {
    const step = span / count;
    let previous = {
      x: door.a.x + dx * start,
      y: door.a.y + dy * start,
    };
    for (let index = 0; index < count; index += 1) {
      const along = start + direction * step * (index + 1);
      const raised = (index + phase) % 2 === 0;
      const next = {
        x: door.a.x + dx * along + nx * (raised ? step : 0),
        y: door.a.y + dy * along + ny * (raised ? step : 0),
      };
      segments.push([previous, next]);
      previous = next;
    }
  };

  if (door.foldingSideMode === "two") {
    appendGroup(0, spans[0], groups[0], 1, 0);
    appendGroup(length, spans[1] ?? 0, groups[1] ?? 0, -1, 0);
  } else {
    appendGroup(cursor, length, total, mainDirection, 0);
  }
  return segments;
}

export function genDoorId(): string {
  return `D${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeDoor(raw: any): Door | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw.a, b = raw.b;
  if (!a || !b) return null;
  const ax = Number(a.x), ay = Number(a.y), bx = Number(b.x), by = Number(b.y);
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const nx = Number(raw.nx), ny = Number(raw.ny);
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  const leaves: 1 | 2 = raw.leaves === 2 ? 2 : 1;
  const type: DoorType = raw.type === "sliding" || raw.type === "folding" ? raw.type : "swing";
  const slideDirection: "left" | "right" = raw.slideDirection === "right" ? "right" : "left";
  const foldingSideMode: FoldingSideMode = raw.foldingSideMode === "two" ? "two" : "one";
  const foldingSide: FoldingSide = raw.foldingSide === "right" ? "right" : "left";
  const foldingLeafRaw = Number(raw.foldingLeafCount);
  const foldingLeafCount = Number.isFinite(foldingLeafRaw) ? Math.max(2, Math.min(24, Math.round(foldingLeafRaw))) : 4;
  const wRaw = Number(raw.widthCm);
  const maxWidth = type === "folding" ? 800 : 200;
  const widthCm = Number.isFinite(wRaw) ? Math.max(70, Math.min(maxWidth, wRaw)) : 100;
  // Pastikan (nx,ny) ternormalisasi.
  const nlen = Math.hypot(nx, ny) || 1;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : genDoorId(),
    levelId: typeof raw.levelId === "string" ? raw.levelId : undefined,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    nx: nx / nlen,
    ny: ny / nlen,
    leaves,
    type,
    slideDirection,
    foldingSideMode,
    foldingSide,
    foldingLeafCount,
    widthCm,
  };
}

export function normalizeDoors(arr: any): Door[] {
  if (!Array.isArray(arr)) return [];
  const out: Door[] = [];
  for (const r of arr) {
    const d = normalizeDoor(r);
    if (d) out.push(d);
  }
  return out;
}
