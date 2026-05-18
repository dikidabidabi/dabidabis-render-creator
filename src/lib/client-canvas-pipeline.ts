// Pipeline pasca-render yang berjalan 100% di browser (HTML5 Canvas API).
// Tidak memanggil AI/API apa pun. Tahap 2 (upscale), Tahap 3 (pecah 4x4 tile
// dengan overlap 1%), Tahap 4 (unsharp mask deterministik per tile), dan
// Tahap 5 (stitch dengan feather blending di area overlap) seluruhnya
// dieksekusi lokal di perangkat user untuk menghemat kuota Gemini.

export type ResolutionKey = "1k" | "2k" | "4k" | "8k";

const TARGET_LONG_EDGE: Record<ResolutionKey, number> = {
  "1k": 1024,
  "2k": 2048,
  "4k": 3840,
  "8k": 7680,
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar dasar"));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob gagal"))),
      type,
      quality,
    );
  });
}

// Unsharp mask sederhana via konvolusi 3x3 pada ImageData.
// Amount ~0.55 menyamai perilaku server sebelumnya.
function sharpenImageData(src: ImageData, amount = 0.55): ImageData {
  const { width: w, height: h, data: s } = src;
  const out = new ImageData(new Uint8ClampedArray(s), w, h);
  const d = out.data;
  const stride = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * stride + x * 4;
      for (let c = 0; c < 3; c++) {
        const center = s[i + c];
        const avg =
          (s[i - 4 + c] + s[i + 4 + c] + s[i - stride + c] + s[i + stride + c]) / 4;
        const v = center + (center - avg) * amount;
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

// Smoothstep weight 0..1.
const smooth = (t: number) => t * t * (3 - 2 * t);

// Tahap 5: tempel ImageData tile ke canvas akhir dengan feather alpha
// hanya di sisi yang punya tetangga (overlap 1%).
function pasteFeathered(
  destData: ImageData,
  tile: ImageData,
  destX: number,
  destY: number,
  fL: number,
  fT: number,
  fR: number,
  fB: number,
) {
  const dw = destData.width;
  const dh = destData.height;
  const tw = tile.width;
  const th = tile.height;
  const dd = destData.data;
  const td = tile.data;
  for (let y = 0; y < th; y++) {
    const cy = destY + y;
    if (cy < 0 || cy >= dh) continue;
    let wy = 1;
    if (fT > 0 && y < fT) wy = (y + 0.5) / fT;
    else if (fB > 0 && y >= th - fB) wy = (th - y - 0.5) / fB;
    wy = wy < 0 ? 0 : wy > 1 ? 1 : wy;
    const wys = smooth(wy);
    for (let x = 0; x < tw; x++) {
      const cx = destX + x;
      if (cx < 0 || cx >= dw) continue;
      let wx = 1;
      if (fL > 0 && x < fL) wx = (x + 0.5) / fL;
      else if (fR > 0 && x >= tw - fR) wx = (tw - x - 0.5) / fR;
      wx = wx < 0 ? 0 : wx > 1 ? 1 : wx;
      const w = smooth(wx) * wys;
      const ti = (y * tw + x) * 4;
      const ci = (cy * dw + cx) * 4;
      if (w >= 0.999) {
        dd[ci] = td[ti];
        dd[ci + 1] = td[ti + 1];
        dd[ci + 2] = td[ti + 2];
        dd[ci + 3] = td[ti + 3];
      } else {
        const inv = 1 - w;
        dd[ci] = dd[ci] * inv + td[ti] * w;
        dd[ci + 1] = dd[ci + 1] * inv + td[ti + 1] * w;
        dd[ci + 2] = dd[ci + 2] * inv + td[ti + 2] * w;
        dd[ci + 3] = dd[ci + 3] * inv + td[ti + 3] * w;
      }
    }
  }
}

export async function processRenderInBrowser(
  baseDataUrl: string,
  resolutionKey: ResolutionKey,
  onProgress?: (msg: string) => void,
): Promise<{ blob: Blob; ext: "png" | "jpg"; mime: string; width: number; height: number }> {
  onProgress?.("Memuat gambar dasar...");
  const img = await loadImage(baseDataUrl);

  // 1K: tanpa post-process apapun, langsung PNG.
  if (resolutionKey === "1k") {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    const blob = await canvasToBlob(c, "image/png");
    return { blob, ext: "png", mime: "image/png", width: c.width, height: c.height };
  }

  // Tahap 2: upscale bicubic-ish via canvas (browser native high-quality resampling).
  onProgress?.("Tahap 2: upscaling...");
  const target = TARGET_LONG_EDGE[resolutionKey];
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(10, Math.max(2, target / longEdge));
  const W = Math.round(img.naturalWidth * scale);
  const H = Math.round(img.naturalHeight * scale);

  const upCanvas = document.createElement("canvas");
  upCanvas.width = W;
  upCanvas.height = H;
  const upCtx = upCanvas.getContext("2d")!;
  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = "high";
  upCtx.drawImage(img, 0, 0, W, H);

  // Canvas final = salinan hasil upscale; tile yang sudah dipertajam
  // akan ditempel di atasnya dengan feather blending.
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = W;
  finalCanvas.height = H;
  const finalCtx = finalCanvas.getContext("2d")!;
  finalCtx.drawImage(upCanvas, 0, 0);
  const finalImageData = finalCtx.getImageData(0, 0, W, H);

  // Tahap 3: pecah jadi 4x4 = 16 tile dengan overlap 1% dari sisi terpanjang.
  const N = 4;
  const overlap = Math.max(2, Math.round(Math.max(W, H) * 0.01));
  const xE: number[] = [];
  const yE: number[] = [];
  for (let i = 0; i <= N; i++) {
    xE.push(Math.round((W * i) / N));
    yE.push(Math.round((H * i) / N));
  }

  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      onProgress?.(`Tahap 3-4: tile ${gy * N + gx + 1}/16`);
      const hasL = gx > 0;
      const hasT = gy > 0;
      const hasR = gx < N - 1;
      const hasB = gy < N - 1;
      const cx0 = Math.max(0, hasL ? xE[gx] - overlap : xE[gx]);
      const cy0 = Math.max(0, hasT ? yE[gy] - overlap : yE[gy]);
      const cx1 = Math.min(W, hasR ? xE[gx + 1] + overlap : xE[gx + 1]);
      const cy1 = Math.min(H, hasB ? yE[gy + 1] + overlap : yE[gy + 1]);
      const tw = cx1 - cx0;
      const th = cy1 - cy0;
      if (tw <= 0 || th <= 0) continue;

      // Tahap 3 (crop) + Tahap 4 (sharpen deterministik per tile).
      const tileData = upCtx.getImageData(cx0, cy0, tw, th);
      const sharpened = sharpenImageData(tileData, 0.55);

      // Tahap 5: stitch dengan feather di sisi yang punya tetangga.
      pasteFeathered(
        finalImageData,
        sharpened,
        cx0,
        cy0,
        hasL ? overlap : 0,
        hasT ? overlap : 0,
        hasR ? overlap : 0,
        hasB ? overlap : 0,
      );

      // Yield ke event loop biar UI tidak nge-freeze.
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.("Tahap 5: menggabungkan hasil...");
  finalCtx.putImageData(finalImageData, 0, 0);

  const quality = resolutionKey === "8k" ? 0.96 : resolutionKey === "4k" ? 0.94 : 0.92;
  const blob = await canvasToBlob(finalCanvas, "image/jpeg", quality);
  return { blob, ext: "jpg", mime: "image/jpeg", width: W, height: H };
}
