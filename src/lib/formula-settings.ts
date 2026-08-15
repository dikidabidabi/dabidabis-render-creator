// Pengaturan rumus tabulasi per akun pengguna.
// Nilai disimpan di localStorage (cepat, sinkron) dan disinkronkan ke tabel
// `formula_settings` di backend agar mengikuti akun pengguna lintas perangkat.

import { supabase } from "@/integrations/supabase/client";

export type FormulaSettings = {
  // ===== Regulasi (nilai default bila sketsa belum mengisi) =====
  kdbPct: number;
  klbCoef: number;
  kdhPct: number;
  ktbPct: number;

  // ===== Asumsi ketinggian =====
  floorHeightM: number;      // tinggi lantai default bila level tak punya nilai
  existingFloorHeightM: number; // asumsi tinggi per lapis bangunan eksisting (peta)

  // ===== Koefisien luas =====
  coefEfektif: number;
  coefSemi: number;
  coefSarana: number;

  // ===== Parkir mobil =====
  carStallW: number;
  carStallL: number;
  carAisleW: number;
  carPathBufferM: number;

  // ===== Parkir motor =====
  motorStallW: number;
  motorStallL: number;
  motorAisleW: number;
  motorPathBufferM: number;

  // ===== Lot difabel =====
  diffableStallW: number;
  diffableStallL: number;
  diffableRatioPct: number;   // rasio untuk 501..1000 lot
  diffableBaseAbove1000: number; // jumlah dasar saat >1000 lot
  diffableStepAbove1000: number; // penambahan tiap kelipatan lot ini

  // ===== Struktur =====
  colSizeCm: number;          // dimensi kolom default (persegi)

  // ===== Sirkulasi / evakuasi =====
  stairRadiusM: number;       // radius jangkauan tangga evakuasi (Tangga EVK)

  // ===== Biaya =====
  defaultCostPerM2: number;   // Rp / m² default
  concreteCostPerM3: number;  // Rp / m³ beton
};

export const DEFAULT_FORMULA_SETTINGS: FormulaSettings = {
  kdbPct: 60,
  klbCoef: 3,
  kdhPct: 20,
  ktbPct: 65,

  floorHeightM: 3,
  existingFloorHeightM: 4,

  coefEfektif: 1,
  coefSemi: 0.5,
  coefSarana: 0,

  carStallW: 2.4,
  carStallL: 5.0,
  carAisleW: 5.5,
  carPathBufferM: 1.75,

  motorStallW: 0.75,
  motorStallL: 2.0,
  motorAisleW: 1.5,
  motorPathBufferM: 0.5,

  diffableStallW: 3.7,
  diffableStallL: 5.0,
  diffableRatioPct: 2,
  diffableBaseAbove1000: 20,
  diffableStepAbove1000: 100,

  colSizeCm: 40,

  stairRadiusM: 38,

  defaultCostPerM2: 6_500_000,
  concreteCostPerM3: 1_400_000,
};

export type FormulaField = {
  key: keyof FormulaSettings;
  label: string;
  unit: string;
  formula: string;
  step?: number;
};

export type FormulaGroup = {
  id: string;
  title: string;
  note: string;
  fields: FormulaField[];
};

export const FORMULA_GROUPS: FormulaGroup[] = [
  {
    id: "regulasi",
    title: "Regulasi Tapak (KDB / KLB / KDH / KTB)",
    note: "Dipakai sebagai nilai bawaan bila sketsa belum menetapkan regulasinya sendiri.",
    fields: [
      { key: "kdbPct", label: "KDB", unit: "%", formula: "Batas KDB = KDB% × Luas Lahan", step: 1 },
      { key: "klbCoef", label: "KLB", unit: "×", formula: "Batas KLB = KLB × Luas Lahan", step: 0.1 },
      { key: "kdhPct", label: "KDH", unit: "%", formula: "Batas KDH (min) = KDH% × Luas Lahan", step: 1 },
      { key: "ktbPct", label: "KTB", unit: "%", formula: "Batas KTB (maks) = KTB% × Luas Lahan", step: 1 },
    ],
  },
  {
    id: "tinggi",
    title: "Ketinggian & Lapis",
    note: "Asumsi tinggi dipakai untuk volume beton, ketinggian bangunan, dan extrude bangunan eksisting.",
    fields: [
      { key: "floorHeightM", label: "Tinggi lantai default", unit: "m", formula: "Ketinggian = Σ(mdpl tertinggi − terendah) + Σ((tipikal−1) × tinggi lantai)", step: 0.1 },
      { key: "existingFloorHeightM", label: "Tinggi per lapis eksisting", unit: "m", formula: "Tinggi bangunan peta = jumlah lapis × tinggi per lapis", step: 0.5 },
    ],
  },
  {
    id: "koefisien",
    title: "Koefisien Luas Ruang",
    note: "Luas KLB Rencana = Σ(luas ruang × koefisien × jumlah tipikal).",
    fields: [
      { key: "coefEfektif", label: "Koefisien Efektif", unit: "×", formula: "Luas dihitung penuh", step: 0.05 },
      { key: "coefSemi", label: "Koefisien Semi", unit: "×", formula: "Luas dihitung sebagian", step: 0.05 },
      { key: "coefSarana", label: "Koefisien Sarana", unit: "×", formula: "Luas tidak dihitung", step: 0.05 },
    ],
  },
  {
    id: "parkir-mobil",
    title: "Parkir Mobil",
    note: "Modul ganda = 2 × panjang lot + lebar sirkulasi. Modul tunggal = panjang lot + lebar sirkulasi.",
    fields: [
      { key: "carStallW", label: "Lebar lot", unit: "m", formula: "Luas lot = lebar × panjang", step: 0.05 },
      { key: "carStallL", label: "Panjang lot", unit: "m", formula: "Modul tunggal = panjang + aisle", step: 0.05 },
      { key: "carAisleW", label: "Lebar sirkulasi (aisle)", unit: "m", formula: "Modul ganda = panjang + aisle + panjang", step: 0.05 },
      { key: "carPathBufferM", label: "Buffer jalur", unit: "m", formula: "Jarak bebas lot terhadap jalur", step: 0.05 },
    ],
  },
  {
    id: "parkir-motor",
    title: "Parkir Motor",
    note: "Rumus sama dengan mobil, memakai dimensi motor.",
    fields: [
      { key: "motorStallW", label: "Lebar lot", unit: "m", formula: "Luas lot = lebar × panjang", step: 0.05 },
      { key: "motorStallL", label: "Panjang lot", unit: "m", formula: "Modul tunggal = panjang + aisle", step: 0.05 },
      { key: "motorAisleW", label: "Lebar sirkulasi (aisle)", unit: "m", formula: "Modul ganda = panjang + aisle + panjang", step: 0.05 },
      { key: "motorPathBufferM", label: "Buffer jalur", unit: "m", formula: "Jarak bebas lot terhadap jalur", step: 0.05 },
    ],
  },
  {
    id: "difabel",
    title: "Lot Difabel",
    note: "Bertingkat: ≤25→1, ≤50→2, ≤75→3, ≤100→4, ≤150→5, ≤200→6, ≤300→7, ≤400→8, ≤500→9, 501–1000→rasio%, >1000→dasar + kelipatan.",
    fields: [
      { key: "diffableStallW", label: "Lebar lot difabel", unit: "m", formula: "Luas lot = lebar × panjang", step: 0.05 },
      { key: "diffableStallL", label: "Panjang lot difabel", unit: "m", formula: "Luas lot = lebar × panjang", step: 0.05 },
      { key: "diffableRatioPct", label: "Rasio 501–1000 lot", unit: "%", formula: "Jumlah = ceil(total mobil × rasio%)", step: 0.5 },
      { key: "diffableBaseAbove1000", label: "Dasar di atas 1000 lot", unit: "lot", formula: "Jumlah = dasar + ceil((total−1000) / kelipatan)", step: 1 },
      { key: "diffableStepAbove1000", label: "Kelipatan di atas 1000 lot", unit: "lot", formula: "Jumlah = dasar + ceil((total−1000) / kelipatan)", step: 10 },
    ],
  },
  {
    id: "struktur",
    title: "Struktur",
    note: "Volume beton kolom = jumlah kolom × (dimensi/100)² × tinggi lantai.",
    fields: [
      { key: "colSizeCm", label: "Dimensi kolom default", unit: "cm", formula: "Luas kolom = (dimensi / 100)²", step: 5 },
    ],
  },
  {
    id: "evakuasi",
    title: "Sirkulasi & Evakuasi",
    note: "Radius jangkauan tangga evakuasi digambar sebagai lingkaran putus-putus di sekitar layer \"Tangga EVK\".",
    fields: [
      { key: "stairRadiusM", label: "Radius tangga evakuasi", unit: "m", formula: "Area terlayani = π × radius²", step: 1 },
    ],
  },
  {
    id: "biaya",
    title: "Estimasi Biaya",
    note: "Biaya ruang = luas × harga satuan; biaya struktur = volume beton × harga beton.",
    fields: [
      { key: "defaultCostPerM2", label: "Harga satuan default", unit: "Rp/m²", formula: "Biaya = luas (m²) × harga satuan", step: 100_000 },
      { key: "concreteCostPerM3", label: "Harga beton", unit: "Rp/m³", formula: "Biaya = volume beton (m³) × harga beton", step: 50_000 },
    ],
  },
];

const LS_PREFIX = "dabidabis_formula_v1";

let cache: FormulaSettings = { ...DEFAULT_FORMULA_SETTINGS };
let cacheUserKey = "guest";

function keyFor(userId?: string | null) {
  return `${LS_PREFIX}:${userId || "guest"}`;
}

export function sanitizeFormulaSettings(raw: any): FormulaSettings {
  const out: FormulaSettings = { ...DEFAULT_FORMULA_SETTINGS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_FORMULA_SETTINGS) as (keyof FormulaSettings)[]) {
      const v = Number(raw[k]);
      if (Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

/** Baca pengaturan aktif (sinkron, aman di server). */
export function getFormulaSettings(): FormulaSettings {
  if (typeof window === "undefined") return DEFAULT_FORMULA_SETTINGS;
  return cache;
}

/** Muat dari localStorage untuk user tertentu (sinkron). */
export function loadFormulaSettings(userId?: string | null): FormulaSettings {
  if (typeof window === "undefined") return DEFAULT_FORMULA_SETTINGS;
  cacheUserKey = keyFor(userId);
  try {
    const raw = window.localStorage.getItem(cacheUserKey);
    cache = sanitizeFormulaSettings(raw ? JSON.parse(raw) : null);
  } catch {
    cache = { ...DEFAULT_FORMULA_SETTINGS };
  }
  return cache;
}

/** Simpan lokal + backend (bila login). */
export async function saveFormulaSettings(
  next: FormulaSettings,
  userId?: string | null,
): Promise<{ synced: boolean }> {
  cache = sanitizeFormulaSettings(next);
  if (typeof window !== "undefined") {
    cacheUserKey = keyFor(userId);
    try {
      window.localStorage.setItem(cacheUserKey, JSON.stringify(cache));
      window.dispatchEvent(new CustomEvent("formula-settings:update"));
    } catch {
      // ignore
    }
  }
  if (!userId) return { synced: false };
  try {
    const { error } = await supabase
      .from("formula_settings")
      .upsert({ user_id: userId, data: cache as any, updated_at: new Date().toISOString() });
    return { synced: !error };
  } catch {
    return { synced: false };
  }
}

/** Ambil dari backend (mengikuti akun) lalu simpan ke cache lokal. */
export async function fetchFormulaSettings(userId: string): Promise<FormulaSettings | null> {
  try {
    const { data, error } = await supabase
      .from("formula_settings")
      .select("data")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const s = sanitizeFormulaSettings((data as any).data);
    cache = s;
    if (typeof window !== "undefined") {
      cacheUserKey = keyFor(userId);
      try {
        window.localStorage.setItem(cacheUserKey, JSON.stringify(s));
        window.dispatchEvent(new CustomEvent("formula-settings:update"));
      } catch {
        // ignore
      }
    }
    return s;
  } catch {
    return null;
  }
}
