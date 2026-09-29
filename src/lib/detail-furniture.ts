export type DetailFurniture = {
  id: string;
  name: string;
  imageUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  createdAt: number;
  roomId?: string;
  roomAnchor?: { x: number; y: number };
  catalogId?: string;
  price?: number;
};

export type DetailAreaWithFurniture = {
  id: string;
  furniture?: DetailFurniture[];
};

export type CatalogFurniture = {
  id: string;
  name: string;
  aspectRatio: number;
  imageUrl: string;
  lengthMm?: number;
  widthMm?: number;
};

export type ImportedFurniture = CatalogFurniture & {
  importedAt: number;
};

export function normalizeImportedFurniture(value: unknown): ImportedFurniture[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<ImportedFurniture>;
    const aspectRatio = Number(raw.aspectRatio);
    if (typeof raw.imageUrl !== "string" || !raw.imageUrl.startsWith("data:image/") || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return [];
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `CUSTOM${Date.now()}_${index}`,
      name: typeof raw.name === "string" && raw.name ? raw.name : "Furniture impor",
      imageUrl: raw.imageUrl,
      aspectRatio,
      importedAt: Number.isFinite(Number(raw.importedAt)) ? Number(raw.importedAt) : Date.now(),
      lengthMm: Number(raw.lengthMm) > 0 ? Number(raw.lengthMm) : undefined,
      widthMm: Number(raw.widthMm) > 0 ? Number(raw.widthMm) : undefined,
    }];
  });
}

const svgDataUrl = (body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><g fill="white" stroke="#222" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`,
  )}`;

export const FURNITURE_CATALOG: CatalogFurniture[] = [
  {
    id: "dinamic",
    name: "Dinamic furniture",
    aspectRatio: 1,
    lengthMm: 1000,
    widthMm: 1000,
    imageUrl: svgDataUrl('<rect x="2" y="2" width="156" height="116" rx="0"/>'),
  },
  {
    id: "meja",
    name: "Meja",
    aspectRatio: 4 / 3,
    imageUrl: svgDataUrl('<rect x="18" y="24" width="124" height="72" rx="5"/><circle cx="34" cy="40" r="5"/><circle cx="126" cy="40" r="5"/><circle cx="34" cy="80" r="5"/><circle cx="126" cy="80" r="5"/>'),
  },
  {
    id: "kursi",
    name: "Kursi",
    aspectRatio: 1,
    imageUrl: svgDataUrl('<rect x="42" y="26" width="76" height="68" rx="8"/><path d="M42 43h76M54 94v14M106 94v14"/>'),
  },
  {
    id: "sofa",
    name: "Sofa",
    aspectRatio: 2,
    imageUrl: svgDataUrl('<rect x="14" y="30" width="132" height="64" rx="12"/><path d="M38 30v64M122 30v64M14 54h132"/>'),
  },
  {
    id: "tempat-tidur",
    name: "Tempat tidur",
    aspectRatio: 4 / 3,
    imageUrl: svgDataUrl('<rect x="22" y="12" width="116" height="96" rx="5"/><rect x="32" y="22" width="44" height="28" rx="5"/><rect x="84" y="22" width="44" height="28" rx="5"/><path d="M22 60h116"/>'),
  },
  {
    id: "lemari",
    name: "Lemari",
    aspectRatio: 2,
    imageUrl: svgDataUrl('<rect x="12" y="34" width="136" height="52" rx="3"/><path d="M46 34v52M80 34v52M114 34v52"/><circle cx="74" cy="60" r="3"/><circle cx="86" cy="60" r="3"/>'),
  },
  {
    id: "sanitary",
    name: "Sanitary",
    aspectRatio: 0.8,
    imageUrl: svgDataUrl('<ellipse cx="80" cy="70" rx="38" ry="39"/><rect x="48" y="12" width="64" height="35" rx="8"/><ellipse cx="80" cy="68" rx="21" ry="24"/>'),
  },
];

export function normalizeDetailFurniture(value: unknown): DetailFurniture[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Partial<DetailFurniture>;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const width = Number(raw.width);
    const height = Number(raw.height);
    if (
      typeof raw.imageUrl !== "string" ||
      !raw.imageUrl.startsWith("data:image/") ||
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0
    ) return [];
    const rotation = Number(raw.rotation);
    return [{
      id: typeof raw.id === "string" && raw.id ? raw.id : `FURN${Date.now()}_${index}`,
      name: typeof raw.name === "string" && raw.name ? raw.name : "Furniture",
      imageUrl: raw.imageUrl,
      x,
      y,
      width,
      height,
      rotation: Number.isFinite(rotation) ? Math.round(rotation / 5) * 5 : 0,
      createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
      roomId: typeof raw.roomId === "string" ? raw.roomId : undefined,
      roomAnchor: raw.roomAnchor && Number.isFinite(raw.roomAnchor.x) && Number.isFinite(raw.roomAnchor.y) ? raw.roomAnchor : undefined,
      catalogId: typeof raw.catalogId === "string" ? raw.catalogId : undefined,
      price: Number.isFinite(Number(raw.price)) && Number(raw.price) >= 0 ? Number(raw.price) : 0,
    }];
  });
}

export function newDetailFurniture(
  catalog: CatalogFurniture,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  pxPerMeter: number,
): DetailFurniture {
  const lengthMm = catalog.lengthMm && catalog.lengthMm > 0 ? catalog.lengthMm : 1000;
  const widthMm = catalog.widthMm && catalog.widthMm > 0 ? catalog.widthMm : lengthMm / Math.max(0.2, catalog.aspectRatio);
  return {
    id: `FURN${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: catalog.name,
    imageUrl: catalog.imageUrl,
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    width: lengthMm / 1000 * pxPerMeter,
    height: widthMm / 1000 * pxPerMeter,
    rotation: 0,
    createdAt: Date.now(),
    catalogId: catalog.id,
    price: 0,
  };
}

export function pointInRoom(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function roomForFurniture(point: { x: number; y: number }, layers: { id: string; points: { x: number; y: number }[] }[]): string | undefined {
  return layers.find((layer) => layer.points.length >= 3 && pointInRoom(point, layer.points))?.id;
}

export function anchorFurniture(item: DetailFurniture, layers: { id: string; points: { x: number; y: number }[] }[]): DetailFurniture {
  const roomId = roomForFurniture(item, layers);
  const room = layers.find((layer) => layer.id === roomId);
  if (!room) return { ...item, roomId: undefined, roomAnchor: undefined };
  const xs = room.points.map((point) => point.x), ys = room.points.map((point) => point.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { ...item, roomId, roomAnchor: { x: (item.x - minX) / Math.max(1, Math.max(...xs) - minX), y: (item.y - minY) / Math.max(1, Math.max(...ys) - minY) } };
}

export function positionFurniture(item: DetailFurniture, layers: { id: string; points: { x: number; y: number }[] }[]): DetailFurniture {
  const room = layers.find((layer) => layer.id === item.roomId);
  if (!room || !item.roomAnchor || room.points.length < 3) return item;
  const xs = room.points.map((point) => point.x), ys = room.points.map((point) => point.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { ...item, x: minX + item.roomAnchor.x * (Math.max(...xs) - minX), y: minY + item.roomAnchor.y * (Math.max(...ys) - minY) };
}

export function furnitureForVisibleRooms(
  areas: { levelId: string; showFurniture?: boolean; furniture?: DetailFurniture[] }[],
  levelId: string,
  rooms: { id: string; points: { x: number; y: number }[] }[],
  visibleRooms: { id: string; points: { x: number; y: number }[] }[],
): DetailFurniture[] {
  const ids = new Set(visibleRooms.map((room) => room.id));
  const seen = new Set<string>();
  return areas.filter((area) => area.levelId === levelId && area.showFurniture !== false)
    .flatMap((area) => normalizeDetailFurniture(area.furniture))
    .map((item) => positionFurniture(item, rooms))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      const roomId = item.roomId ?? roomForFurniture(item, rooms);
      return roomId ? ids.has(roomId) : visibleRooms.some((room) => pointInRoom(item, room.points));
    });
}