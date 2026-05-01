// Client-side image-to-video renderer using Canvas + MediaRecorder.
// Modes:
//   - Ken Burns: single-image pan/zoom
//   - Pseudo-3D Parallax: 2 layers (foreground + background) animated with
//     different speeds & perspective skew → bangunan terasa berputar mengikuti kamera.

export type MotionPreset =
  | "zoom-in"
  | "zoom-out"
  | "pan-lr"
  | "pan-rl"
  | "pan-tb"
  | "pan-bt"
  | "diagonal"
  | "orbit";

export type AnimateOptions = {
  startImage: HTMLImageElement;
  foregroundImage?: HTMLImageElement | null; // AI-isolated subject (transparent bg)
  backgroundImage?: HTMLImageElement | null; // AI-inpainted background
  motion: MotionPreset;
  durationSec: number; // 3 / 5 / 8
  resolution: "1080p" | "2k";
  fps?: number; // default 30
  onProgress?: (p: number) => void;
};

export type AnimateResult = {
  blob: Blob;
  url: string;
  mimeType: string;
  width: number;
  height: number;
};

const ease = (t: number) => t * t * (3 - 2 * t);

// Per-layer transform: foreground moves more / has stronger perspective skew
// than background → parallax depth + apparent angle change of buildings.
type LayerTransform = {
  scale: number;
  tx: number; // -1..1 normalized
  ty: number;
  skewX: number; // radians, for pseudo-perspective
  skewY: number;
};

function getLayerTransform(motion: MotionPreset, t: number, depth: "fg" | "bg" | "flat"): LayerTransform {
  const e = ease(t);
  // Depth multipliers — fg moves more & skews more for parallax illusion.
  const m = depth === "fg" ? 1.0 : depth === "bg" ? 0.45 : 0.75;
  const skewMul = depth === "fg" ? 1.0 : depth === "bg" ? 0.2 : 0.5;

  switch (motion) {
    case "zoom-in":
      return {
        scale: 1 + 0.28 * e * m,
        tx: 0,
        ty: 0,
        skewX: 0,
        skewY: 0,
      };
    case "zoom-out":
      return {
        scale: 1.28 - 0.28 * e * m,
        tx: 0,
        ty: 0,
        skewX: 0,
        skewY: 0,
      };
    case "pan-lr": {
      const p = (-0.12 + 0.24 * e) * m;
      return { scale: 1.15, tx: p, ty: 0, skewX: 0, skewY: -p * 0.18 * skewMul };
    }
    case "pan-rl": {
      const p = (0.12 - 0.24 * e) * m;
      return { scale: 1.15, tx: p, ty: 0, skewX: 0, skewY: -p * 0.18 * skewMul };
    }
    case "pan-tb": {
      const p = (-0.1 + 0.2 * e) * m;
      return { scale: 1.15, tx: 0, ty: p, skewX: -p * 0.18 * skewMul, skewY: 0 };
    }
    case "pan-bt": {
      const p = (0.1 - 0.2 * e) * m;
      return { scale: 1.15, tx: 0, ty: p, skewX: -p * 0.18 * skewMul, skewY: 0 };
    }
    case "diagonal": {
      const px = (-0.1 + 0.2 * e) * m;
      const py = (0.08 - 0.16 * e) * m;
      return {
        scale: 1.15 + 0.1 * e * m,
        tx: px,
        ty: py,
        skewX: -py * 0.15 * skewMul,
        skewY: -px * 0.15 * skewMul,
      };
    }
    case "orbit": {
      const angle = e * Math.PI;
      const px = 0.18 * Math.sin(angle) * m;
      const py = (0.05 * Math.cos(angle) - 0.05) * m;
      return {
        scale: 1.18,
        tx: px,
        ty: py,
        skewX: 0,
        skewY: -px * 0.22 * skewMul, // strong skew → orbit illusion
      };
    }
  }
}

function pickMimeType(): { mime: string; ext: string } {
  const candidates = [
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return { mime: "video/webm", ext: "webm" };
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar"));
    img.src = src;
  });
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  outW: number,
  outH: number,
  tr: LayerTransform,
) {
  const baseScale = Math.max(outW / img.naturalWidth, outH / img.naturalHeight);
  const drawW = img.naturalWidth * baseScale * tr.scale;
  const drawH = img.naturalHeight * baseScale * tr.scale;
  const cx = outW / 2 + tr.tx * outW * 0.5;
  const cy = outH / 2 + tr.ty * outH * 0.5;

  ctx.save();
  ctx.translate(cx, cy);
  // Apply pseudo-perspective via skew (cheap parallax / angle illusion)
  ctx.transform(1, tr.skewY, tr.skewX, 1, 0, 0);
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

export async function renderAnimation(opts: AnimateOptions): Promise<AnimateResult> {
  const fps = opts.fps ?? 30;
  const longEdge = opts.resolution === "2k" ? 2048 : 1920;

  const img = opts.startImage;
  const aspect = img.naturalWidth / img.naturalHeight;
  let outW: number;
  let outH: number;
  if (aspect >= 1) {
    outW = longEdge;
    outH = Math.round(longEdge / aspect);
  } else {
    outH = longEdge;
    outW = Math.round(longEdge * aspect);
  }
  outW -= outW % 2;
  outH -= outH % 2;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context tidak tersedia");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const { mime } = pickMimeType();
  const stream = canvas.captureStream(fps);
  const bitsPerPixel = 0.18;
  const bitrate = Math.min(24_000_000, Math.max(4_000_000, Math.round(outW * outH * fps * bitsPerPixel)));

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  } catch {
    recorder = new MediaRecorder(stream, { videoBitsPerSecond: bitrate });
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(100);

  const totalFrames = Math.round(opts.durationSec * fps);
  const frameInterval = 1000 / fps;
  const startTime = performance.now();

  const hasParallax = !!(opts.foregroundImage && opts.backgroundImage);

  const drawFrame = (frameIdx: number) => {
    const t = totalFrames <= 1 ? 1 : frameIdx / (totalFrames - 1);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outW, outH);

    if (hasParallax) {
      // Background layer — slow, minimal skew
      const bgT = getLayerTransform(opts.motion, t, "bg");
      ctx.globalAlpha = 1;
      drawLayer(ctx, opts.backgroundImage!, outW, outH, bgT);

      // Original image as midground, blended at low opacity to fill any gaps
      // (helps where AI inpaint is imperfect)
      const midT = getLayerTransform(opts.motion, t, "flat");
      ctx.globalAlpha = 0.35;
      drawLayer(ctx, img, outW, outH, midT);

      // Foreground layer — fast, strong skew → angle change illusion
      const fgT = getLayerTransform(opts.motion, t, "fg");
      ctx.globalAlpha = 1;
      drawLayer(ctx, opts.foregroundImage!, outW, outH, fgT);
    } else {
      const tr = getLayerTransform(opts.motion, t, "flat");
      ctx.globalAlpha = 1;
      drawLayer(ctx, img, outW, outH, tr);
    }
  };

  for (let f = 0; f < totalFrames; f++) {
    drawFrame(f);
    opts.onProgress?.(f / totalFrames);
    const target = startTime + (f + 1) * frameInterval;
    const wait = target - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    else await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  drawFrame(totalFrames - 1);
  await new Promise((r) => setTimeout(r, 120));

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: mime });
  const url = URL.createObjectURL(blob);
  opts.onProgress?.(1);
  return { blob, url, mimeType: mime, width: outW, height: outH };
}

export const motionLabels: Record<MotionPreset, string> = {
  "zoom-in": "Zoom In",
  "zoom-out": "Zoom Out",
  "pan-lr": "Pan Kiri → Kanan",
  "pan-rl": "Pan Kanan → Kiri",
  "pan-tb": "Pan Atas → Bawah",
  "pan-bt": "Pan Bawah → Atas",
  diagonal: "Diagonal",
  orbit: "Orbit Halus",
};

export function fileExtFromMime(mime: string): string {
  return mime.includes("mp4") ? "mp4" : "webm";
}
