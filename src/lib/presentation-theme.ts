// Tema presentasi — layout kop/footer + tipografi untuk slide A3.
// Tema "charcoal" = tampilan default aplikasi (tidak berubah).

export type PresentationThemeId =
  | "charcoal"
  | "editorial"
  | "swiss"
  | "mono"
  | "bauhaus"
  | "nordic";

export type PresentationTheme = {
  id: PresentationThemeId;
  name: string;
  note: string;
  /** font judul */
  display: string;
  /** font isi */
  body: string;
  accent: string;
  ink: string;
  muted: string;
  /** layout kop slide */
  header: "underline" | "editorial" | "swiss" | "band" | "bar" | "centered";
  titleSize: number;
  titleWeight: number;
  titleSpacing: string;
  titleTransform: "none" | "uppercase";
  kickerSpacing: string;
  rule: string;
  heroSize: number;
};

const SORA = '"Sora", ui-sans-serif, system-ui, sans-serif';
const MANROPE = '"Manrope", ui-sans-serif, system-ui, sans-serif';

export const PRESENTATION_THEMES: PresentationTheme[] = [
  {
    id: "charcoal",
    name: "Charcoal (Default)",
    note: "Sora · Manrope · garis kop tegas",
    display: SORA,
    body: MANROPE,
    accent: "#e85d3a",
    ink: "#0a0a0a",
    muted: "#888888",
    header: "underline",
    titleSize: 58,
    titleWeight: 600,
    titleSpacing: "-0.03em",
    titleTransform: "none",
    kickerSpacing: "0.28em",
    rule: "1px solid #111",
    heroSize: 92,
  },
  {
    id: "editorial",
    name: "Editorial Serif",
    note: "Playfair Display · Source Sans · kop dua garis",
    display: '"Playfair Display", Georgia, serif',
    body: '"Source Sans 3", ui-sans-serif, sans-serif',
    accent: "#8c6b3f",
    ink: "#141210",
    muted: "#8a8078",
    header: "editorial",
    titleSize: 62,
    titleWeight: 500,
    titleSpacing: "-0.01em",
    titleTransform: "none",
    kickerSpacing: "0.34em",
    rule: "1px solid #141210",
    heroSize: 96,
  },
  {
    id: "swiss",
    name: "Swiss Grid",
    note: "Archivo · Barlow · judul kapital rata kiri",
    display: '"Archivo", ui-sans-serif, sans-serif',
    body: '"Barlow", ui-sans-serif, sans-serif',
    accent: "#d92b2b",
    ink: "#101010",
    muted: "#7a7a7a",
    header: "swiss",
    titleSize: 52,
    titleWeight: 700,
    titleSpacing: "-0.02em",
    titleTransform: "uppercase",
    kickerSpacing: "0.22em",
    rule: "3px solid #101010",
    heroSize: 84,
  },
  {
    id: "mono",
    name: "Studio Mono",
    note: "JetBrains Mono · Inter · kop blok gelap",
    display: '"JetBrains Mono", ui-monospace, monospace',
    body: '"Inter", ui-sans-serif, sans-serif',
    accent: "#2f7d72",
    ink: "#0d0d0d",
    muted: "#9a9a9a",
    header: "band",
    titleSize: 42,
    titleWeight: 600,
    titleSpacing: "-0.01em",
    titleTransform: "uppercase",
    kickerSpacing: "0.3em",
    rule: "1px solid #0d0d0d",
    heroSize: 66,
  },
  {
    id: "bauhaus",
    name: "Bauhaus Bold",
    note: "Bebas Neue · Manrope · pita aksen kiri",
    display: '"Bebas Neue", ui-sans-serif, sans-serif',
    body: MANROPE,
    accent: "#1f4fd8",
    ink: "#0a0a0a",
    muted: "#7d7d7d",
    header: "bar",
    titleSize: 72,
    titleWeight: 400,
    titleSpacing: "0.01em",
    titleTransform: "uppercase",
    kickerSpacing: "0.26em",
    rule: "2px solid #0a0a0a",
    heroSize: 128,
  },
  {
    id: "nordic",
    name: "Nordic Minimal",
    note: "Cormorant Garamond · Manrope · kop tengah tipis",
    display: '"Cormorant Garamond", Georgia, serif',
    body: MANROPE,
    accent: "#5b7a86",
    ink: "#15191b",
    muted: "#9aa4a8",
    header: "centered",
    titleSize: 64,
    titleWeight: 600,
    titleSpacing: "0.01em",
    titleTransform: "none",
    kickerSpacing: "0.4em",
    rule: "1px solid #d6dcde",
    heroSize: 104,
  },
];

export const DEFAULT_THEME_ID: PresentationThemeId = "charcoal";

export function getTheme(id?: string | null): PresentationTheme {
  return PRESENTATION_THEMES.find((t) => t.id === id) ?? PRESENTATION_THEMES[0];
}

const KEY = "dabidabis_pres_theme_v1";
const EVENT = "dabidabis-pres-theme";

type ThemeMap = Record<string, PresentationThemeId>;

export function loadThemeMap(): ThemeMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ThemeMap) : {};
  } catch {
    return {};
  }
}

function persist(map: ThemeMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function getSlideThemeId(slideId: string, map?: ThemeMap): PresentationThemeId {
  const m = map ?? loadThemeMap();
  return m[slideId] ?? m["__all"] ?? DEFAULT_THEME_ID;
}

export function setSlideThemeId(slideId: string, id: PresentationThemeId) {
  const m = loadThemeMap();
  m[slideId] = id;
  persist(m);
}

export function setAllSlidesThemeId(id: PresentationThemeId) {
  persist({ __all: id });
}

export function subscribeThemeMap(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
