// Jembatan "Eksekusi tender" → halaman Sketsa / Master Plan.
// Postingan tender menitipkan judul + koordinat lewat localStorage, lalu
// halaman tujuan membuat sketsa baru dengan geo terisi otomatis.

export type TenderExecPayload = {
  target: "sketch" | "masterplan";
  title: string;
  lat: number;
  lon: number;
  label?: string;
};

const KEY = "dabidabis_tender_exec_v1";

export function setPendingTenderExec(payload: TenderExecPayload) {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage penuh — abaikan */
  }
}

export function takePendingTenderExec(
  target: "sketch" | "masterplan",
): TenderExecPayload | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as TenderExecPayload;
    if (!p || p.target !== target) return null;
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) return null;
    localStorage.removeItem(KEY);
    return { ...p, lat: Number(p.lat), lon: Number(p.lon) };
  } catch {
    return null;
  }
}
