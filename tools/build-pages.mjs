/* ════════════════════════════════════════════════════════════════════════
   Pre-render notebook.pdf into web-ready page images.

   The site used to download the whole PDF (~50 MB) and rasterise it in the
   reader's browser, so nothing appeared until the last byte arrived. This
   turns the PDF into per-page WebP files instead: a reader fetches only the
   pages they actually look at, and the first one shows up immediately.

   Run it whenever notebook.pdf changes:

       cd tools && npm run build

   Writes, next to index.html:
       pages/p/0001.webp   reading quality
       pages/t/0001.webp   thumbnail, for the grid and link previews
       pages/index.json    page count, shape, and every hyperlink
       pages/text.json     page text, fetched lazily to power search
   ════════════════════════════════════════════════════════════════════════ */

import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

// pdfjs makes its own scratch canvases for fonts and image masks, and in Node
// it reaches for the node-canvas package to do it. Hand it this instead, so
// the build needs no native compilation.
class CanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, width | 0), Math.max(1, height | 0));
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc, width, height) {
    cc.canvas.width = Math.max(1, width | 0);
    cc.canvas.height = Math.max(1, height | 0);
  }
  destroy(cc) {
    if (cc.canvas) { cc.canvas.width = 0; cc.canvas.height = 0; }
    cc.canvas = null;
    cc.context = null;
  }
}

const canvasFactory = new CanvasFactory();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const OUT = path.join(SITE, "pages");

// One master render per page, then downscaled. Downscaling a big render
// gives noticeably cleaner text than rendering small in the first place.
const MASTER = 2000;
const SIZES = {
  p: { width: 1800, quality: 80 },   // reading + zoom
  t: { width: 220, quality: 70 },    // grid tiles and hover previews
};

const pad = (n) => String(n).padStart(4, "0");
const limit = Number(process.argv[2]) || 0;   // optional: build only N pages

async function main() {
  const data = new Uint8Array(await readFile(path.join(SITE, "notebook.pdf")));

  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: path.join(
      path.dirname(require.resolve("pdfjs-dist/package.json")),
      "standard_fonts/"
    ),
    cMapUrl: path.join(
      path.dirname(require.resolve("pdfjs-dist/package.json")),
      "cmaps/"
    ),
    cMapPacked: true,
    isEvalSupported: false,
    canvasFactory,
  }).promise;

  const count = limit ? Math.min(limit, doc.numPages) : doc.numPages;
  console.log(`notebook.pdf: ${doc.numPages} pages, building ${count}`);

  if (!limit) await rm(OUT, { recursive: true, force: true });
  for (const key of Object.keys(SIZES)) {
    await mkdir(path.join(OUT, key), { recursive: true });
  }

  const links = [];
  const text = [];
  let ratio = 0.773;
  let bytes = 0;

  for (let i = 1; i <= count; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    if (i === 1) ratio = base.width / base.height;

    const scale = MASTER / base.width;
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvasFactory }).promise;

    const master = canvas.toBuffer("image/png");
    for (const [key, cfg] of Object.entries(SIZES)) {
      const buf = await sharp(master)
        .resize({ width: cfg.width, fit: "inside", kernel: "lanczos3" })
        .webp({ quality: cfg.quality, effort: 4 })
        .toBuffer();
      await writeFile(path.join(OUT, key, `${pad(i)}.webp`), buf);
      bytes += buf.length;
    }

    text.push(await pageText(page));
    links.push(await pageLinks(doc, page, vp));
    page.cleanup();

    if (i % 10 === 0 || i === count) {
      process.stdout.write(`\r  ${i}/${count} pages  ${(bytes / 1048576).toFixed(1)} MB`);
    }
  }
  process.stdout.write("\n");

  await writeFile(
    path.join(OUT, "index.json"),
    JSON.stringify({ version: 1, count, ratio: Number(ratio.toFixed(4)), links })
  );
  await writeFile(path.join(OUT, "text.json"), JSON.stringify(text));

  console.log(`done — ${(bytes / 1048576).toFixed(1)} MB of images in pages/`);
}

async function pageText(page) {
  try {
    const tc = await page.getTextContent();
    return tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

// Link rectangles are stored as fractions of the page, so the site can place
// them over an image of any size without knowing the render scale.
async function pageLinks(doc, page, vp) {
  const out = [];
  let annots = [];
  try { annots = await page.getAnnotations({ intent: "display" }); } catch { return out; }

  for (const a of annots) {
    if (a.subtype !== "Link" || !a.rect) continue;
    const r = pdfjs.Util.normalizeRect(vp.convertToViewportRectangle(a.rect));
    const box = [
      +(r[0] / vp.width).toFixed(5),
      +(r[1] / vp.height).toFixed(5),
      +((r[2] - r[0]) / vp.width).toFixed(5),
      +((r[3] - r[1]) / vp.height).toFixed(5),
    ];

    if (a.url) {
      out.push({ b: box, u: a.url });
    } else if (a.dest) {
      try {
        const dest = typeof a.dest === "string" ? await doc.getDestination(a.dest) : a.dest;
        out.push({ b: box, p: await doc.getPageIndex(dest[0]) });
      } catch { /* destination we cannot resolve — drop the link */ }
    }
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
