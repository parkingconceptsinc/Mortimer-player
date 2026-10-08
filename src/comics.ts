import type { Comic, ComicFormat, Shelf } from "./types";
import type { StoredComic } from "./library";
import { folderOf, stripExt } from "./util";

export const TEXT_BOOK_EXT = /\.(txt|md|markdown|log|nfo|csv|tsv|json|xml|yaml|yml|toml|ini|cfg|conf|srt|vtt|ass|ssa|sub|html|htm|rtf|docx|odt)$/i;
export const isTextBookFile = (name: string) => TEXT_BOOK_EXT.test(name);
export const isComicFile = (name: string) => /\.(cbz|cbr|pdf|epub)$/i.test(name) || isTextBookFile(name);
export const comicFormatOf = (name: string): ComicFormat => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "cbr") return "cbr";
  if (ext === "pdf") return "pdf";
  if (ext === "epub") return "epub";
  if (ext === "cbz") return "cbz";
  return ext as ComicFormat;
};
export const isTextFormat = (format: ComicFormat) => !["cbz", "cbr", "pdf", "epub"].includes(format);
export const defaultShelf = (format: ComicFormat): Shelf => (format === "cbz" || format === "cbr" ? "comics" : "books");
export const comicTitle = (name: string) => stripExt(name).replace(/_+/g, " ").replace(/\s+/g, " ").trim();

export function toComic(x: StoredComic): Comic {
  return {
    id: x.id,
    name: x.name,
    title: x.title || comicTitle(x.name),
    author: x.author,
    // Items saved before shelves existed were all on the comics shelf; keep them there.
    shelf: x.shelf ?? defaultShelf(x.format),
    path: x.path,
    folder: folderOf(x.path),
    size: x.size,
    lastModified: x.lastModified,
    addedAt: x.addedAt,
    format: x.format,
    pages: x.pages,
    file: x.file,
    cover: x.cover ? URL.createObjectURL(x.cover) : undefined,
  };
}

export type ComicSource = {
  pages: number;
  getPage(index: number): Promise<Blob>;
  close(): void;
};

const IMAGE = /\.(jpe?g|png|gif|webp|avif|bmp|jxl)$/i;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp", jxl: "image/jxl" };
const mimeOf = (name: string) => MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const isPage = (name: string) => IMAGE.test(name) && !name.includes("__MACOSX") && !name.split("/").pop()!.startsWith(".");
let rarWasmBinary: Promise<ArrayBuffer> | null = null;

export async function openComic(file: Blob, onProgress?: (fraction: number) => void, options?: { firstPageOnly?: boolean }): Promise<ComicSource> {
  // Accept PDF headers found within the first 1024 bytes. This tolerates
  // harmless leading bytes produced by some real-world PDF generators.
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 1024)).arrayBuffer());
  const magic = String.fromCharCode(...head.subarray(0, 6));
  const headText = String.fromCharCode(...head);
  if (magic.startsWith("PK")) return openZip(file);
  if (magic.startsWith("Rar!")) return openRar(file, onProgress, options?.firstPageOnly);
  if (/%PDF-\d\.\d/.test(headText) || /%PDF-2\.\d/.test(headText)) return openPdf(file);
  if (head[0] === 0x37 && head[1] === 0x7a && head[2] === 0xbc) throw new Error("7-Zip comics (CB7) aren't supported yet — convert them to CBZ.");
  throw new Error("This file isn't a comic archive this app can read, or it's damaged.");
}

// ---------- CBZ: reads the ZIP directory and inflates one page at a time ----------

type ZipEntry = { name: string; method: number; compSize: number; offset: number; flags: number };

async function readZipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailLength = Math.min(file.size, 22 + 0xffff + 20);
  const tail = new DataView(await file.slice(file.size - tailLength).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This archive looks damaged (no ZIP directory found).");
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = Number(tail.getBigUint64(eocd - 12, true));
    const z = new DataView(await file.slice(z64, z64 + 56).arrayBuffer());
    if (z.getUint32(0, true) === 0x06064b50) {
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOffset = Number(z.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const bytes = new Uint8Array(cd.buffer);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50; i++) {
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLength = cd.getUint16(p + 28, true);
    const extraLength = cd.getUint16(p + 30, true);
    const commentLength = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const length = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(cd.getBigUint64(q, true)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(cd.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) offset = Number(cd.getBigUint64(q, true));
      }
      e += 4 + length;
    }
    entries.push({ name, method, compSize, offset, flags });
    p = extraEnd + commentLength;
  }
  return entries;
}

async function openZip(file: Blob): Promise<ComicSource> {
  const entries = (await readZipEntries(file)).filter((e) => isPage(e.name)).sort((a, b) => collator.compare(a.name, b.name));
  if (!entries.length) throw new Error("No images were found inside this comic.");
  return {
    pages: entries.length,
    async getPage(index) {
      const entry = entries[index];
      if (entry.flags & 1) throw new Error("Password-protected comics aren't supported.");
      const local = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
      if (local.getUint32(0, true) !== 0x04034b50) throw new Error(`Page ${index + 1} is damaged.`);
      const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      const raw = file.slice(start, start + entry.compSize);
      const type = mimeOf(entry.name);
      if (entry.method === 0) return new Blob([raw], { type });
      if (entry.method !== 8) throw new Error(`Page ${index + 1} uses a compression method that isn't supported.`);
      try {
        if (typeof DecompressionStream !== "undefined") {
          const inflated = await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
          return new Blob([inflated], { type });
        }
      } catch {}
      const { inflateSync } = await import("fflate");
      return new Blob([inflateSync(new Uint8Array(await raw.arrayBuffer()))], { type });
    },
    close() {},
  };
}

// ---------- CBR: unrar compiled to WebAssembly, pages extracted in the background ----------

async function openRar(file: Blob, onProgress?: (fraction: number) => void, firstPageOnly = false): Promise<ComicSource> {
  const [{ createExtractorFromData }, wasm] = await Promise.all([import("node-unrar-js"), import("node-unrar-js/esm/js/unrar.wasm?url")]);
  rarWasmBinary ??= fetch(wasm.default).then((response) => {
    if (!response.ok) throw new Error("Couldn't load the CBR decoder.");
    return response.arrayBuffer();
  }).catch((error) => {
    rarWasmBinary = null;
    throw error;
  });
  const [wasmBinary, data] = await Promise.all([rarWasmBinary, file.arrayBuffer()]);
  const extractor = await createExtractorFromData({ wasmBinary, data });
  const names = [...extractor.getFileList().fileHeaders]
    .filter((h) => !h.flags.directory && isPage(h.name))
    .map((h) => h.name)
    .sort(collator.compare);
  if (!names.length) throw new Error("No images were found inside this comic.");

  const cache = new Map<number, Blob>();
  const pending = new Map<number, Promise<Blob>>();
  let closed = false;

  const extractPage = async (index: number): Promise<Blob> => {
    const cached = cache.get(index);
    if (cached) return cached;
    const name = names[index];
    if (!name) throw new Error("Page not found in archive.");
    const active = pending.get(index);
    if (active) return active;

    const task = (async () => {
      const { files } = extractor.extract({ files: [name] });
      const extracted = [...files];
      const fileEntry = extracted[0];
      if (!fileEntry?.extraction) throw new Error(`Page ${index + 1} could not be extracted.`);
      const blob = new Blob([new Uint8Array(fileEntry.extraction)], { type: mimeOf(name) });
      if (!closed) cache.set(index, blob);
      onProgress?.((Math.min(cache.size, names.length)) / names.length);
      return blob;
    })();

    pending.set(index, task);
    try {
      return await task;
    } finally {
      pending.delete(index);
    }
  };

  const initial = firstPageOnly ? [0] : [];
  for (const index of initial) {
    try { await extractPage(index); } catch {}
  }

  return {
    pages: names.length,
    async getPage(index) {
      if (closed) throw new Error("This comic has been closed.");
      return extractPage(index);
    },
    close() {
      closed = true;
      pending.clear();
      cache.clear();
    },
  };
}

// ---------- PDF: pages rendered with pdf.js at screen resolution ----------

async function openPdf(file: Blob): Promise<ComicSource> {
  // The legacy build bundles compatibility helpers that are safer on mobile browsers.
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Large embedded scans are common in PDFs. Let PDF.js downsample those
    // images in the worker instead of forcing huge intermediate bitmaps.
    canvasMaxAreaInBytes: 32 * 1024 * 1024,
  });
  const doc = await task.promise;

  const renderPage = async (index: number): Promise<Blob> => {
    const page = await doc.getPage(index + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(1.75, Math.max(1, window.devicePixelRatio || 1));
      const targetWidth = Math.min(2200, Math.max(1100, window.innerWidth * dpr));
      const requestedScale = targetWidth / Math.max(1, base.width);
      const maxPixels = 4_000_000;
      const maxDimension = 4096;
      let scale = requestedScale;
      const pixels = base.width * scale * base.height * scale;
      if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels);
      const first = page.getViewport({ scale });
      const largest = Math.max(first.width, first.height);
      if (largest > maxDimension) scale *= maxDimension / largest;

      for (let attempt = 0; attempt < 3; attempt++) {
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        try {
          await page.render({ canvas, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
          if (!blob) throw new Error("Couldn't encode the PDF page.");
          return blob;
        } catch (error) {
          canvas.width = 1;
          canvas.height = 1;
          if (attempt === 2) throw error instanceof Error ? error : new Error("Couldn't render the PDF page.");
          scale *= 0.65;
        }
      }
      throw new Error("Couldn't render the PDF page.");
    } finally {
      page.cleanup();
    }
  };

  return {
    pages: doc.numPages,
    getPage: renderPage,
    close() {
      void doc.destroy().catch(() => {});
      void task.destroy().catch(() => {});
    },
  };
}

export async function makeThumbnail(blob: Blob, width = 320): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, width / Math.max(1, img.naturalWidth));
    const requestedWidth = img.naturalWidth * scale;
    const requestedHeight = img.naturalHeight * scale;
    const maxPixels = 1_500_000;
    const pixelScale = requestedWidth * requestedHeight > maxPixels
      ? Math.sqrt(maxPixels / (requestedWidth * requestedHeight))
      : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(requestedWidth * pixelScale));
    canvas.height = Math.max(1, Math.round(requestedHeight * pixelScale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
