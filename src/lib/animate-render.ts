// Client-side image-to-video renderer using Canvas + MediaRecorder.
// Supports Ken Burns (pan/zoom) and AI cinematic blend (start ↔ end frame).

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
  endImage?: HTMLImageElement | null; // optional AI keyframe — blended over time
  motion: MotionPreset;
  durationSec: number; // 3 / 5 / 8
  resolution: "1080p" | "2k"; // long-edge target
  fps?: number; // default 30
  onProgress?: (p: number) => void; // 0..1
};

export type AnimateResult = {
  blob: Blob;
  url: string;
  mimeType: string;
  width: number;
  height: number;
};

// Smoothstep for natural ease-in-out
const ease = (t: number) => t * t * (3 - 2 * t);

function getTransform(motion: MotionPreset, t: number) {
  // Returns { scale, tx, ty } where tx/ty are in -1..1 (normalized to canvas)
  // scale: 1 = full fit, >1 = zoomed in
  const e = ease(t);
  switch (motion) {
    case "zoom-in":
      return { scale: 1 + 0.25 * e, tx: 0, ty: 0 };
    case "zoom-out":
      return { scale: 1.25 - 0.25 * e, tx: 0, ty: 0 };
    case "pan-lr":
      return { scale: 1.15, tx: -0.12 + 0.24 * e, ty: 0 };
    case "pan-rl":
      return { scale: 1.15, tx: 0.12 - 0.24 * e, ty: 0 };
    case "pan-tb":
      return { scale: 1.15, tx: 0, ty: -0.1 + 0.2 * e };
    case "pan-bt":
      return { scale: 1.15, tx: 0, ty: 0.1 - 0.2 * e };
    case "diagonal":
      return { scale: 1.15 + 0.1 * e, tx: -0.1 + 0.2 * e, ty: 0.08 - 0.16 * e };
    case "orbit": {
      // Subtle horizontal oscillation + slight zoom
      const angle = e * Math.PI; // 0 → π
      return { scale: 1.18, tx: 0.15 * Math.sin(angle), ty: 0.04 * Math.cos(angle) - 0.04 };
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
    img.onerror = (e) => reject(new Error("Gagal memuat gambar"));
    img.src = src;
  });
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
  // ensure even dimensions (codec requirement)
  outW -= outW % 2;
  outH -= outH % 2;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D context tidak tersedia");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const { mime, ext } = pickMimeType();
  const stream = canvas.captureStream(fps);
  const bitsPerPixel = 0.18; // quality factor
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

  const drawFrame = (frameIdx: number) => {
    const t = totalFrames <= 1 ? 1 : frameIdx / (totalFrames - 1);
    const tr = getTransform(opts.motion, t);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outW, outH);

    // Compute source rectangle (cover-fit on canvas, then transform)
    const baseScale = Math.max(outW / img.naturalWidth, outH / img.naturalHeight);
    const drawW = img.naturalWidth * baseScale * tr.scale;
    const drawH = img.naturalHeight * baseScale * tr.scale;
    const cx = outW / 2 + tr.tx * outW * 0.5;
    const cy = outH / 2 + tr.ty * outH * 0.5;
    const dx = cx - drawW / 2;
    const dy = cy - drawH / 2;

    ctx.globalAlpha = 1;
    ctx.drawImage(img, dx, dy, drawW, drawH);

    if (opts.endImage) {
      // Cross-blend toward AI end keyframe so motion gains parallax-like depth
      const blend = ease(t) * 0.85; // peak blend 85%
      const e = opts.endImage;
      const baseScaleE = Math.max(outW / e.naturalWidth, outH / e.naturalHeight);
      const drawWE = e.naturalWidth * baseScaleE * tr.scale;
      const drawHE = e.naturalHeight * baseScaleE * tr.scale;
      const dxE = cx - drawWE / 2;
      const dyE = cy - drawHE / 2;
      ctx.globalAlpha = blend;
      ctx.drawImage(e, dxE, dyE, drawWE, drawHE);
      ctx.globalAlpha = 1;
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

  // Hold final frame briefly
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
