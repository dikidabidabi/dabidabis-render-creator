// Door annotations untuk denah 2D.
// Disimpan di Sketch.doors. Murni notasi 2D — TIDAK memengaruhi geometri 3D.

export type DoorPoint = { x: number; y: number };

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
  /** 1 = single leaf, 2 = double leaf. */
  leaves: 1 | 2;
  /** Lebar bukaan (cm), 90–200. */
  widthCm: number;
};

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
  const wRaw = Number(raw.widthCm);
  const widthCm = Number.isFinite(wRaw) ? Math.max(60, Math.min(240, wRaw)) : 100;
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
