/**
 * Tabel Volumetrik: satu baris per lantai fisik (lantai tipikal diurai per
 * salinan). Fungsi = luas ruang berkoefisien 1, MEP/servis = koefisien 0,
 * GFA = seluruh ruang terhitung (tanpa Lahan, Void, Taman), Volume = GFA ×
 * ketinggian lantai, Efektif = Fungsi / GFA. CFA = GFA + luas Taman/ruang
 * terbuka.
 */
export type VolumetricLevel = {
  id: string;
  name: string;
  mdpl: number;
  typicalCount?: number;
  typicalHeight?: number;
};
export type VolumetricLayer = { name: string; levelId?: string; areaM2: number; coefficient?: number };

export type VolumetricRow = {
  no: number;
  levelId: string;
  name: string;
  elevationM: number;
  heightM: number;
  gfaM2: number;
  fungsiM2: number;
  mepM2: number;
  volumeM3: number;
  efektifPct: number;
};
export type VolumetricTable = {
  rows: VolumetricRow[];
  totalHeightM: number;
  gfaM2: number;
  fungsiM2: number;
  mepM2: number;
  volumeM3: number;
  efektifPct: number;
  cfaM2: number;
};

const DEFAULT_TYPICAL_H = 3;
const isLahan = (n: string) => n.trim().toLowerCase().startsWith("lahan");
const isVoid = (n: string) => n.trim().toLowerCase() === "void";
const isTaman = (n: string) => n.trim().toLowerCase().startsWith("taman");
const isAutoName = (n: string) => /^Level\s+\d+(?:\s*[-–]\s*\d+)?$/i.test(n.trim()) || /^B\d+(?:\s*[-–]\s*B?\d+)?$/i.test(n.trim());
const typH = (lv: VolumetricLevel) => {
  const h = Number(lv.typicalHeight);
  return Number.isFinite(h) && h > 0 ? h : DEFAULT_TYPICAL_H;
};
const count = (lv: VolumetricLevel) => Math.max(1, Math.round(lv.typicalCount ?? 1));

function zeroIndex(sorted: VolumetricLevel[]): number {
  if (!sorted.length) return 0;
  let best = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].mdpl) < Math.abs(sorted[best].mdpl)) best = i;
  }
  return best;
}

export function buildVolumetricTable(levels: VolumetricLevel[], layers: VolumetricLayer[]): VolumetricTable {
  const sorted = [...levels].sort((a, b) => a.mdpl - b.mdpl);
  const zi = zeroIndex(sorted);
  // Elevasi tiap salinan: lantai di atas tipikal bergeser sebanyak salinan tambahan.
  type Floor = { lv: VolumetricLevel; name: string; elevation: number };
  const floors: Floor[] = [];
  let shift = 0;
  let upperNo = 1;
  sorted.forEach((lv, i) => {
    const k = count(lv);
    const h = typH(lv);
    const base = lv.mdpl + shift;
    for (let j = 0; j < k; j++) {
      let name: string;
      if (i < zi) name = isAutoName(lv.name) ? `B${zi - i}` : lv.name;
      else if (isAutoName(lv.name)) name = `Level ${upperNo + j}`;
      else if (k > 1) {
        // "Lantai 3" tipikal 3× → Lantai 3, Lantai 4, Lantai 5.
        const m = lv.name.trim().match(/^(.*?)(\d+)$/);
        name = m ? `${m[1]}${Number(m[2]) + j}` : `${lv.name} (${j + 1}/${k})`;
      } else name = lv.name;
      floors.push({ lv, name, elevation: base + j * h });
    }
    if (i >= zi) upperNo += k;
    shift += (k - 1) * h;
  });

  const sums = new Map<string, { gfa: number; fungsi: number; mep: number; taman: number }>();
  for (const l of layers) {
    if (!l.levelId || isLahan(l.name) || isVoid(l.name)) continue;
    const s = sums.get(l.levelId) ?? { gfa: 0, fungsi: 0, mep: 0, taman: 0 };
    const a = Number(l.areaM2) || 0;
    if (isTaman(l.name)) s.taman += a;
    else {
      s.gfa += a;
      const c = l.coefficient ?? 1;
      if (c === 1) s.fungsi += a;
      else if (c === 0) s.mep += a;
    }
    sums.set(l.levelId, s);
  }

  let tamanTotal = 0;
  const rows: VolumetricRow[] = floors.map((f, i) => {
    const next = floors[i + 1];
    const prev = floors[i - 1];
    const heightM = next
      ? Math.max(0, next.elevation - f.elevation)
      : count(f.lv) > 1 ? typH(f.lv) : prev ? Math.max(0, f.elevation - prev.elevation) : typH(f.lv);
    const s = sums.get(f.lv.id) ?? { gfa: 0, fungsi: 0, mep: 0, taman: 0 };
    tamanTotal += s.taman;
    return {
      no: i + 1,
      levelId: f.lv.id,
      name: f.name,
      elevationM: f.elevation,
      heightM,
      gfaM2: s.gfa,
      fungsiM2: s.fungsi,
      mepM2: s.mep,
      volumeM3: s.gfa * heightM,
      efektifPct: s.gfa > 0 ? (s.fungsi / s.gfa) * 100 : 0,
    };
  });
  const add = (pick: (r: VolumetricRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const gfaM2 = add((r) => r.gfaM2);
  const fungsiM2 = add((r) => r.fungsiM2);
  return {
    rows,
    totalHeightM: add((r) => r.heightM),
    gfaM2,
    fungsiM2,
    mepM2: add((r) => r.mepM2),
    volumeM3: add((r) => r.volumeM3),
    efektifPct: gfaM2 > 0 ? (fungsiM2 / gfaM2) * 100 : 0,
    cfaM2: gfaM2 + tamanTotal,
  };
}

/** Bagi baris ke beberapa halaman; baris total hanya di halaman terakhir. */
export function paginateVolumetricRows<T>(rows: T[], perPage: number, lastPageReserve: number): T[][] {
  const per = Math.max(1, perPage);
  const lastPer = Math.max(1, per - lastPageReserve);
  if (rows.length <= lastPer) return [rows];
  const pages: T[][] = [];
  let i = 0;
  while (rows.length - i > lastPer) {
    const take = Math.min(per, rows.length - i - 1);
    pages.push(rows.slice(i, i + take));
    i += take;
  }
  pages.push(rows.slice(i));
  return pages;
}
