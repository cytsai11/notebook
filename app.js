/* ════════════════════════════════════════════════════════════════════════
   Engineering notebook flip book.

   PDF.js rasterises each page, StPageFlip turns them. Two kinds of
   bookmark live side by side:

     • author bookmarks — loaded from bookmarks.json, seen by every visitor.
       The author edits them in author mode and downloads a new file.
     • personal bookmarks — localStorage, private to one browser, same as
       the pen and highlighter marks.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const cfg = window.NOTEBOOK_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    stage: $("stage"), zoomPad: $("zoomPad"), bookWrap: $("bookWrap"),
    book: $("book"), scrubBar: $("scrubBar"), scrubMarks: $("scrubMarks"),
    scrubFill: $("scrubFill"), scrubLast: $("scrubLast"),
    dropCard: $("dropCard"), fileInput: $("fileInput"),
    pageInput: $("pageInput"), pageTotal: $("pageTotal"),
    pageSlider: $("pageSlider"),
    loadChip: $("loadChip"),
    bootCard: $("bootCard"), bootFill: $("bootFill"), bootSub: $("bootSub"),
    contentsPanel: $("contentsPanel"), authorList: $("authorList"),
    authorEmpty: $("authorEmpty"), mineList: $("mineList"), mineEmpty: $("mineEmpty"),
    searchPanel: $("searchPanel"), searchInput: $("searchInput"),
    searchStatus: $("searchStatus"), searchList: $("searchList"),
    gridOverlay: $("gridOverlay"), pageGrid: $("pageGrid"),
    bookmarkPop: $("bookmarkPop"), bmHead: $("bmHead"), bmLabel: $("bmLabel"),
    bmColors: $("bmColors"),
    toolHint: $("toolHint"), swatches: $("swatches"),
    zoomer: $("zoomer"), zoomLevel: $("zoomLevel"),
    scrim: $("scrim"), welcome: $("welcome"), helpModal: $("helpModal"),
    authorBar: $("authorBar"), authorBarText: $("authorBarText"),
  };

  // ── Branding ──────────────────────────────────────────────────────────
  if (cfg.accent) document.documentElement.style.setProperty("--acc", cfg.accent);
  $("nbTitle").textContent = cfg.title || "Engineering Notebook";
  $("nbSeason").textContent = cfg.season || "";
  document.title = cfg.title || "Engineering Notebook";

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FLIP_MS = reducedMotion ? 120 : 480;   // page-turn duration
  const ANNO_W = 1100;                       // annotation canvas width, px
  const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
  const PALETTE = cfg.tabPalette && cfg.tabPalette.length
    ? cfg.tabPalette : ["#FFD84D", "#FF6B5E", "#3EC79C", "#54A8F0"];

  const INKS = {
    h: [{ c: "#ffe24a", n: "Yellow" }, { c: "#ff7bae", n: "Pink" }, { c: "#7be07b", n: "Green" }],
    p: [{ c: "#d63b2f", n: "Red" }, { c: "#2456c4", n: "Blue" }, { c: "#1e242b", n: "Black" }],
  };

  const LS = {
    theme: "nb:theme", seen: "nb:seen", author: "nb:authormode", draft: "nb:authordraft",
    marks: (fp) => `nb:marks:${fp}`, mine: (fp) => `nb:mine:${fp}`,
  };

  const state = {
    pdf: null, fp: "", pageCount: 0, ratio: 0.773,
    pf: null, pages: [], text: {},
    tool: null,
    ink: { p: INKS.p[0].c, h: INKS.h[0].c },
    marks: {}, undo: [], redo: [],
    mine: [],                     // personal bookmarks {page,label,color}
    author: [],                   // author bookmarks  {page,label,color}
    authorFile: [],               // what bookmarks.json actually holds
    authorMode: false,
    zoom: 1, fitW: 0, fitH: 0,
    renderQueue: new Set(), rendering: false, renderedCount: 0, busy: false, busyUntil: 0,
    panning: false, hiTask: null, urgent: new Set(), coverTurn: false, pendingIdx: null,
    bmColor: PALETTE[0],
  };

  /* ══ Author bookmarks: file, draft, save ═══════════════════════════════ */

  async function loadAuthorBookmarks() {
    let list = null;
    try {
      const res = await fetch("bookmarks.json", { cache: "no-cache" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.bookmarks)) list = data.bookmarks;
      }
    } catch { /* file not published yet — fall back to config */ }

    if (!list) list = cfg.starterBookmarks || [];
    state.authorFile = cleanBookmarks(list);

    // An unsaved author draft wins, so a half-finished edit survives a refresh.
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(LS.draft) || "null"); } catch { /* ignore */ }
    state.author = draft ? cleanBookmarks(draft) : state.authorFile.slice();
  }

  function cleanBookmarks(list) {
    return (Array.isArray(list) ? list : [])
      .filter((b) => b && Number.isFinite(+b.page) && +b.page >= 1)
      .map((b) => ({
        page: Math.round(+b.page),
        label: String(b.label || `Page ${Math.round(+b.page)}`).slice(0, 28),
        color: /^#[0-9a-f]{3,8}$/i.test(b.color || "") ? b.color : PALETTE[0],
      }));
  }

  const sameAsFile = () =>
    JSON.stringify(state.author) === JSON.stringify(state.authorFile);

  function authorChanged() {
    try {
      if (sameAsFile()) localStorage.removeItem(LS.draft);
      else localStorage.setItem(LS.draft, JSON.stringify(state.author));
    } catch { /* private browsing */ }
    buildTabs();
    buildContents();
    syncAuthorBar();
  }

  function syncAuthorBar() {
    els.authorBar.hidden = !state.authorMode;
    document.body.classList.toggle("author", state.authorMode);
    if (!state.authorMode) return;
    els.authorBarText.textContent = sameAsFile()
      ? "Author mode is on — the bookmarks you add here are shown to everyone."
      : "Unsaved changes. Click “Save bookmarks file”, then put the downloaded bookmarks.json in this website’s folder.";
  }

  function setAuthorMode(on) {
    state.authorMode = on;
    try { localStorage.setItem(LS.author, on ? "1" : "0"); } catch { /* ignore */ }
    $("btnAuthorMode").textContent = on ? "Author mode is on" : "Turn on author mode";
    syncAuthorBar();
    buildContents();
  }

  $("btnAuthorMode").addEventListener("click", () => {
    setAuthorMode(true);
    closeModal();
    openPanel(els.contentsPanel);
  });
  $("btnExitAuthor").addEventListener("click", () => setAuthorMode(false));

  $("btnSaveAuthor").addEventListener("click", () => {
    const body = JSON.stringify({ version: 1, bookmarks: state.author }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "bookmarks.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    // The download is now the published truth as far as this browser knows.
    state.authorFile = state.author.slice();
    try { localStorage.removeItem(LS.draft); } catch { /* ignore */ }
    syncAuthorBar();
  });

  $("btnResetMine").addEventListener("click", () => {
    if (!confirm("Erase every mark and personal bookmark you have made in this browser?")) return;
    try {
      localStorage.removeItem(LS.marks(state.fp));
      localStorage.removeItem(LS.mine(state.fp));
    } catch { /* ignore */ }
    state.marks = {};
    state.mine = [];
    state.undo = [];
    state.redo = [];
    for (let i = 0; i < state.pageCount; i++) redraw(i);
    buildTabs();
    buildContents();
    closeModal();
  });

  /* ══ PDF loading ═══════════════════════════════════════════════════════ */

  async function boot() {
    await loadAuthorBookmarks();
    buildContents();
    try {
      if (localStorage.getItem(LS.author) === "1") setAuthorMode(true);
    } catch { /* ignore */ }

    // Only a genuine "can't get the file" falls back to the drop zone; a bug
    // inside openPdf must reach the console instead of being hidden by it.
    let data;
    try {
      data = await fetchPdf(cfg.pdf || "notebook.pdf");
    } catch (err) {
      console.warn("notebook.pdf could not be fetched:", err);
      els.bootCard.hidden = true;
      els.dropCard.hidden = false;
      return;
    }
    await openPdf(data);
  }

  const MB = (n) => (n / 1048576).toFixed(1);

  // Read the PDF as a stream rather than one arrayBuffer() call, so the
  // splash can report real progress instead of sitting still for the whole
  // download. Falls back to a plain read where streaming is unavailable.
  async function fetchPdf(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));

    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !res.body.getReader) {
      els.bootFill.classList.add("unknown");
      els.bootSub.textContent = "Downloading…";
      return res.arrayBuffer();
    }

    const reader = res.body.getReader();
    const chunks = [];
    let got = 0, painted = 0;

    // A chunked or compressed response has no length to measure against.
    if (!total) {
      els.bootFill.classList.add("unknown");
      els.bootSub.textContent = "Downloading…";
    }

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;

      // Repainting on every chunk would cost more than it shows.
      if (got - painted > 262144 || got === total) {
        painted = got;
        if (total) {
          els.bootFill.style.width = `${Math.round((got / total) * 100)}%`;
          els.bootSub.textContent = `${MB(got)} of ${MB(total)} MB`;
        } else {
          els.bootSub.textContent = `${MB(got)} MB`;
        }
      }
    }

    const out = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }

    els.bootFill.classList.remove("unknown");
    els.bootFill.style.width = "100%";
    els.bootSub.textContent = "Preparing the pages…";
    return out;
  }

  els.fileInput.addEventListener("change", () => {
    const f = els.fileInput.files[0];
    if (f) f.arrayBuffer().then(openPdf);
  });
  $("dropBtn").addEventListener("click", () => els.fileInput.click());
  window.addEventListener("dragover", (e) => { e.preventDefault(); els.dropCard.classList.add("over"); });
  window.addEventListener("dragleave", () => els.dropCard.classList.remove("over"));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    els.dropCard.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f && f.type === "application/pdf") f.arrayBuffer().then(openPdf);
  });

  async function openPdf(data) {
    els.dropCard.hidden = true;
    const doc = await pdfjsLib.getDocument({
      data,
      cMapUrl: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/",
      cMapPacked: true,
    }).promise;

    state.pdf = doc;
    state.fp = (doc.fingerprints && doc.fingerprints[0]) || doc.fingerprint || "doc";
    state.pageCount = doc.numPages;

    const p1 = await doc.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    state.ratio = vp.width / vp.height;

    loadPersonal();
    buildPages();
    initFlip();
    buildTabs();
    buildContents();
    buildInkSwatches();
    buildBookmarkColors();

    els.zoomPad.hidden = false;
    els.bootCard.hidden = true;
    els.zoomer.hidden = els.scrubBar.hidden = false;
    syncHistoryButtons();
    els.scrubLast.textContent = String(state.pageCount);
    els.pageTotal.textContent = `of ${state.pageCount}`;
    els.pageInput.max = state.pageCount;
    els.pageSlider.max = state.pageCount;
    els.loadChip.hidden = false;

    for (let i = 0; i < state.pageCount; i++) state.renderQueue.add(i);
    pumpRender();

    firstRunWelcome();
  }

  /* ══ Page DOM ══════════════════════════════════════════════════════════ */

  function buildPages() {
    els.book.innerHTML = "";
    state.pages = [];
    for (let i = 0; i < state.pageCount; i++) {
      const el = document.createElement("div");
      el.className = "page";
      if (i === 0 || i === state.pageCount - 1) el.dataset.density = "hard";

      const inner = document.createElement("div");
      inner.className = "page-inner";

      const loading = document.createElement("div");
      loading.className = "page-loading";
      loading.textContent = String(i + 1);

      const img = document.createElement("img");
      img.className = "page-img";
      img.alt = `Page ${i + 1}`;
      img.draggable = false;
      img.decoding = "async";

      const linkLayer = document.createElement("div");
      linkLayer.className = "link-layer";

      const anno = document.createElement("canvas");
      anno.className = "anno";
      anno.width = 0;   // backing store appears on first mark, so clean
      anno.height = 0;  // pages cost nothing during flips
      wireDrawing(anno, i);

      inner.append(loading, img, linkLayer, anno);
      el.appendChild(inner);
      els.book.appendChild(el);
      state.pages.push({ el, img, loading, anno, ctx: anno.getContext("2d"), linkLayer,
        rendered: false, src: null, thumb: null, level: null, counted: false });
      redraw(i);
    }
  }

  /* ══ Flip engine + sizing + zoom ═══════════════════════════════════════ */

  function initFlip() {
    computeFit();
    const h = 560;
    state.pf = new St.PageFlip(els.book, {
      width: Math.round(h * state.ratio),
      height: h,
      size: "stretch",
      minWidth: 200, maxWidth: 1200, minHeight: 260, maxHeight: 1600,
      showCover: true,
      maxShadowOpacity: 0.3,
      flippingTime: FLIP_MS,
      disableFlipByClick: true,
      mobileScrollSupport: false,
      showPageCorners: true,
    });
    state.pf.loadFromHTML(document.querySelectorAll(".page"));
    state.pf.on("flip", (e) => syncUI(e.data));

    // Rasterising a page blocks the main thread for a beat, which is what
    // made some turns stutter. Hold the render queue while a page is folding
    // or animating, and pick it back up the moment the book settles.
    state.pf.on("changeState", (e) => {
      // Only an actual turn blocks rendering. "fold_corner" (just hovering a
      // corner) must not, or the queue would stall for as long as the pointer
      // rests there. The deadline is a belt-and-braces stop against a state
      // that never resolves.
      const turning = e.data === "flipping" || e.data === "user_fold";
      state.busy = turning;
      state.busyUntil = turning ? Date.now() + 1400 : 0;

      // A turn that starts on the cover has only one destination, so the book
      // can begin sliding to its centred-spread position immediately. The
      // slide is driven off the live fold progress rather than a timer, so it
      // stays glued to the page even when the corner is dragged by hand.
      if (turning) {
        armCoverTrack();
      } else {
        // Settling after a tracked turn only swaps the mid-turn description
        // of the book's position for the resting one — the same place on
        // screen — so it must not animate, or the slide plays a second time.
        const tracked = state.coverTurn;
        stopCoverTrack();
        if (state.pendingIdx !== null) { state.pendingIdx = null; buildTabs(); }
        applyZoom(!tracked);
        prioritizeRender();
      }
    });
    syncUI(0);
  }

  // Fit size = the book at zoom 1, sized to the stage.
  //
  // On a wide screen the book is centred in the window, so the gutter that
  // holds the fore-edge tabs has to be subtracted from BOTH sides — half of
  // what's left over lands on each side, and the tabs need a full gutter.
  // Narrow screens can't spare that, so there the tabs live in the stage's
  // right padding and the book centres in what remains.
  function computeFit() {
    const wide = window.innerWidth > 900;
    // Only the edge arrows need clearance now; the rails already sit outside
    // the stage, and bookmarks moved to the scrub bar.
    const availW = els.stage.clientWidth - (wide ? 130 : 20);
    const availH = els.stage.clientHeight - 64;
    // Ask the flip engine whether it is showing one page or two rather than
    // guessing from width — guessing let the two disagree, which left the
    // cover uncentred on narrow screens.
    const portrait = state.pf
      ? state.pf.getOrientation() === "portrait"
      : els.stage.clientWidth < 640;
    const spreadRatio = state.ratio * (portrait ? 1 : 2);

    let h = availH, w = h * spreadRatio;
    if (w > availW) { w = availW; h = w / spreadRatio; }
    state.fitW = Math.floor(w);
    state.fitH = Math.floor(h);
    els.bookWrap.style.width = `${state.fitW}px`;
    els.bookWrap.style.height = `${state.fitH}px`;
    applyZoom();
  }

  // The book is always a full spread wide, but the cover — and the very last
  // page, when it has no partner — is drawn in only one half of it, leaving
  // the other half blank. That reads as the book sitting off to one side.
  // Returns which half the lone page occupies, or null for a normal spread.
  function singleSide() {
    if (state.coverTurn) return null;      // mid-turn: make room for the spread
    return sideForIndex(current());
  }

  /* The cover slide ───────────────────────────────────────────────────────
     At rest the pad is one page wide and the book is pushed left by a whole
     page (see applyZoom). Mid-turn the pad is the full spread, and the book
     travels from a quarter-spread left to zero. Those two descriptions put
     the cover in exactly the same place at progress 0, so switching between
     them is invisible — only the travel is animated. */

  let coverFrame = 0, coverStart = 0, coverProgress = 0;
  let coverFrom = null, coverTo = null, coverFromIdx = 0, tabsPredicted = false;
  let lastShift = null;        // null until the book is first placed
  let lastIdx = null;          // null until the first page sync

  // Which half of the spread a page sits alone in, or null for a normal
  // two-page spread. Used both at rest and to work out how far the book has
  // to travel during a turn that opens or closes a cover.
  function sideForIndex(i) {
    if (!state.pf || state.pf.getOrientation() === "portrait") return null;
    if (i <= 0) return "right";                       // front cover, alone on the right
    const left = i % 2 === 1 ? i : i - 1;
    return left + 1 >= state.pageCount ? "left" : null;   // back cover, alone on the left
  }

  // Mid-turn the pad is the full spread, so a lone page needs the book offset
  // by a quarter spread to stay where it was sitting at rest.
  function travelFor(side) {
    const q = state.fitW * state.zoom / 4;
    return side === "right" ? -q : side === "left" ? q : 0;
  }

  // The pair of positions a turn moves between, or null when the turn does
  // not move the book at all (any ordinary spread-to-spread turn).
  function turnTargets(fromIdx, dirBack) {
    const from = sideForIndex(fromIdx);
    if (from === "right") return dirBack ? null : ["right", null];   // opening the front
    if (from === "left") return dirBack ? ["left", null] : null;     // closing the back
    const spread = visiblePages(fromIdx);
    if (dirBack) {
      // Only a turn out of the first spread lands back on the front cover.
      return spread[0] <= 1 ? [null, "right"] : null;
    }
    const next = spread[spread.length - 1] + 1;
    return next < state.pageCount && sideForIndex(next) === "left" ? [null, "left"] : null;
  }

  // Where a turn out of this page is heading, one spread either way.
  function predictedIndex(fromIdx, back) {
    const spread = visiblePages(fromIdx);
    return back
      ? Math.max(0, spread[0] - 1)
      : Math.min(state.pageCount - 1, spread[spread.length - 1] + 1);
  }

  function foldCalc() {
    try {
      const fc = state.pf.getFlipController && state.pf.getFlipController();
      const calc = fc && fc.getCalculation && fc.getCalculation();
      return calc || null;
    } catch { return null; }   // library internals moved
    }

  function armCoverTrack() {
    if (state.coverTurn) return;                 // already following this turn
    state.coverTurn = true;
    tabsPredicted = false;
    coverFrom = coverTo = null;
    coverProgress = 0;
    coverStart = Date.now();
    coverFromIdx = current();
    coverFrame = requestAnimationFrame(trackCover);
  }

  function trackCover() {
    coverFrame = 0;
    if (!state.coverTurn) return;

    const calc = foldCalc();

    // Direction only becomes readable once the fold exists, so the targets
    // are resolved on whichever frame that happens. If the turn turns out not
    // to move the book, stop following it.
    if (coverFrom === null) {
      const from = sideForIndex(coverFromIdx);
      let dirBack = null;
      if (calc && typeof calc.getDirection === "function") dirBack = calc.getDirection() === 1;
      // A lone page can only turn one way, so it needs no direction reading.
      if (dirBack === null && from === null) {
        if (Date.now() - coverStart > 120) { stopCoverTrack(); return; }
        coverFrame = requestAnimationFrame(trackCover);
        return;
      }
      const back = dirBack === null ? from === "left" : dirBack;

      // Mark the bookmarks for the spread being turned TO as soon as the turn
      // commits. Waiting for the flip event would only widen the tab once the
      // page had already landed.
      if (!tabsPredicted) {
        tabsPredicted = true;
        state.pendingIdx = predictedIndex(coverFromIdx, back);
        buildTabs();
      }

      const t = turnTargets(coverFromIdx, back);
      if (!t) { stopCoverTrack(); return; }
      coverFrom = travelFor(t[0]);
      coverTo = travelFor(t[1]);
      els.bookWrap.classList.remove("shift-anim");   // the transform is set per frame
      applyZoom();                                    // widen the pad for the turn
    }

    // Prefer the real fold progress. It is unavailable between the fold
    // ending and the state settling, so fall back to elapsed time against the
    // same duration the library animates with.
    let p = null;
    if (calc && typeof calc.getFlippingProgress === "function") {
      p = calc.getFlippingProgress() / 100;
    }
    if (p === null) p = (Date.now() - coverStart) / FLIP_MS;
    coverProgress = Math.max(coverProgress, Math.max(0, Math.min(1, p)));

    const t = Math.round(coverFrom + (coverTo - coverFrom) * coverProgress);
    els.bookWrap.style.transform =
      `translateX(${t}px)` + (state.zoom !== 1 ? ` scale(${state.zoom})` : "");

    coverFrame = requestAnimationFrame(trackCover);
  }

  function stopCoverTrack() {
    if (coverFrame) { cancelAnimationFrame(coverFrame); coverFrame = 0; }
    state.coverTurn = false;
    coverFrom = coverTo = null;
  }

  function applyZoom(animateShift) {
    const z = state.zoom;

    // For a lone page, shrink the pad to the half that page occupies and
    // slide the book across, so the page itself ends up centred rather than
    // the empty spread around it. A left-hand page already starts at the
    // pad's origin, so only a right-hand one needs moving.
    const side = singleSide();
    const shift = side === "right" ? -Math.round(state.fitW * z / 2) : 0;
    const parts = [];
    if (shift) parts.push(`translateX(${shift}px)`);
    if (z !== 1) parts.push(`scale(${z})`);
    // Only animate a shift that actually changes, and never the first one —
    // otherwise the book visibly slides into place on page load. Zoom steps
    // never animate, or the scaled book lags the pad that scrolls it.
    // computeFit() also runs before the flip engine exists, when singleSide()
    // cannot know the cover is showing. Don't let that count as a placement,
    // or the first real one reads as a move and animates on page load.
    const moved = state.pf && lastShift !== null && lastShift !== shift;
    lastShift = state.pf ? shift : null;
    els.bookWrap.classList.toggle("shift-anim", !!animateShift && moved);
    els.bookWrap.style.transform = parts.join(" ");

    els.zoomPad.style.width = `${Math.round(state.fitW * z / (side ? 2 : 1))}px`;
    els.zoomPad.style.height = `${Math.round(state.fitH * z)}px`;
    els.stage.classList.toggle("zoomed", z > 1);
    els.zoomLevel.textContent = `${Math.round(z * 100)}%`;
    $("btnZoomIn").disabled = z >= ZOOMS[ZOOMS.length - 1];
    $("btnZoomOut").disabled = z <= ZOOMS[0];
  }

  // Zoom about a screen point so the thing under the cursor stays put.
  function setZoom(z, anchorX, anchorY) {
    z = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], z));
    if (z === state.zoom) return;

    const r = els.zoomPad.getBoundingClientRect();
    const sr = els.stage.getBoundingClientRect();
    const ax = anchorX == null ? sr.left + sr.width / 2 : anchorX;
    const ay = anchorY == null ? sr.top + sr.height / 2 : anchorY;
    const fx = r.width ? (ax - r.left) / r.width : 0.5;
    const fy = r.height ? (ay - r.top) / r.height : 0.5;

    state.zoom = z;
    applyZoom();
    scheduleUpscale();
    hidePeek();

    const r2 = els.zoomPad.getBoundingClientRect();
    els.stage.scrollLeft += (r2.left + fx * r2.width) - ax;
    els.stage.scrollTop += (r2.top + fy * r2.height) - ay;
  }

  const zoomStep = (dir, x, y) => {
    const i = ZOOMS.indexOf(state.zoom);
    const next = i >= 0
      ? ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))]
      : (dir > 0 ? ZOOMS.find((v) => v > state.zoom) : [...ZOOMS].reverse().find((v) => v < state.zoom));
    if (next) setZoom(next, x, y);
  };

  $("btnZoomIn").addEventListener("click", () => zoomStep(1));
  $("btnZoomOut").addEventListener("click", () => zoomStep(-1));
  els.zoomLevel.addEventListener("click", () => setZoom(1));

  // Pan catcher — only present while zoomed and not drawing, so a drag pans
  // instead of trying to flip the page. A click with no drag is forwarded on
  // to whatever sits underneath (links, tabs) so nothing is lost.
  const panCatch = document.createElement("div");
  panCatch.className = "pan-catch";
  els.zoomPad.appendChild(panCatch);

  let pan = null;

  function startPan(el, e, forwards) {
    // Capture can fail for an unknown pointer id; panning still works without.
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pan = {
      x: e.clientX, y: e.clientY,
      sl: els.stage.scrollLeft, st: els.stage.scrollTop,
      moved: 0, forwards,
    };
    state.panning = true;
    hidePeek();
    // A sharpening render in flight would stutter the drag — drop it and
    // start again once the reader settles.
    if (state.hiTask) { try { state.hiTask.cancel(); } catch { /* already done */ } }
    els.stage.classList.add("grabbing");
  }

  // A high-polling-rate mouse fires pointermove far more often than the
  // screen refreshes, and every scroll write forces layout. Keep only the
  // newest position and apply it once per frame — the drag then tracks the
  // pointer instead of queueing up behind stale work.
  let panFrame = 0, panTo = null;

  function flushPan() {
    panFrame = 0;
    if (!panTo) return;
    els.stage.scrollLeft = panTo.l;
    els.stage.scrollTop = panTo.t;
    panTo = null;
  }

  function movePan(e) {
    if (!pan) return;
    const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
    pan.moved = Math.max(pan.moved, Math.hypot(dx, dy));
    panTo = { l: pan.sl - dx, t: pan.st - dy };
    if (!panFrame) panFrame = requestAnimationFrame(flushPan);
  }

  function endPan(e) {
    if (!pan) return;
    if (panFrame) { cancelAnimationFrame(panFrame); panFrame = 0; }
    flushPan();                       // land on the last position, not a stale one
    els.stage.classList.remove("grabbing");
    if (pan.forwards && pan.moved < 4) forwardClick(e.clientX, e.clientY);
    pan = null;
    state.panning = false;
    scheduleUpscale();
  }

  panCatch.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;   // middle button bubbles to the stage handler
    startPan(panCatch, e, true);
  });
  panCatch.addEventListener("pointermove", movePan);
  panCatch.addEventListener("pointerup", endPan);
  panCatch.addEventListener("pointercancel", endPan);

  // Middle-button drag pans too, and unlike the catcher it works while a
  // drawing tool is on — so you can pan without putting the pen down.
  els.stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 || state.zoom <= 1) return;
    e.preventDefault();
    startPan(els.stage, e, false);
  });
  els.stage.addEventListener("pointermove", (e) => { if (pan && pan.forwards === false) movePan(e); });
  els.stage.addEventListener("pointerup", (e) => { if (e.button === 1) endPan(e); });
  // Stops Chrome's middle-click autoscroll cursor taking over the drag.
  els.stage.addEventListener("mousedown", (e) => { if (e.button === 1) e.preventDefault(); });
  els.stage.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });

  function forwardClick(x, y) {
    panCatch.style.display = "none";
    const target = document.elementFromPoint(x, y);
    panCatch.style.display = "";
    if (target && target.closest(".link-layer, .tab")) target.click();
  }

  els.zoomPad.addEventListener("dblclick", (e) => {
    if (state.tool) return;
    if (state.zoom > 1) setZoom(1);
    else setZoom(2, e.clientX, e.clientY);
  });

  let resizing = false;
  window.addEventListener("resize", () => {
    if (resizing || !state.pf) return;
    computeFit();
    // Re-dispatch so PageFlip re-measures the wrapper we just resized. A
    // timer, not requestAnimationFrame — rAF never fires while the tab is
    // hidden, which would leave `resizing` stuck on and the book blank.
    resizing = true;
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      resizing = false;
    }, 0);
  });

  const current = () => (state.pf ? state.pf.getCurrentPageIndex() : 0);

  function goTo(idx) {
    if (!state.pf) return;
    idx = Math.max(0, Math.min(state.pageCount - 1, idx));
    hidePeek();

    if (idx === current()) return;
    state.pf.flip(idx);
    prioritizeRender();
  }

  function syncUI(idx) {
    els.pageInput.value = idx + 1;
    els.pageSlider.value = idx + 1;
    $("btnPrev").disabled = idx <= 0;
    $("btnNext").disabled = idx >= state.pageCount - 1;

    // Re-centre for the cover / a lone last page, easing only when the reader
    // actually turned a page. The first sync happens before the flip engine
    // has settled its orientation, and easing that would show as the book
    // sliding into place the moment the notebook opens.
    const turned = lastIdx !== null && lastIdx !== idx;
    lastIdx = idx;
    // While a cover turn is being tracked the transform belongs to the
    // tracker; touching it here would fight it for the same frames.
    if (!state.coverTurn) applyZoom(turned);
    syncScrub(idx);
    if (turned) { hidePeek(); buildTabs(); }


    ensureNear();
    trimCache();
    prioritizeRender();
    scheduleUpscale();
  }

  /* ══ Render pipeline — nearest page to the reader first ════════════════ */

  function prioritizeRender() { if (!state.rendering) pumpRender(); }

  // Release the reading-quality image of any page the reader has left behind,
  // falling back to its thumbnail so the page still shows something. Without
  // this, a full pass over 242 pages leaves 242 decoded images resident and
  // every flip has to fight the resulting memory pressure.
  function trimCache() {
    const cur = current();
    for (let i = 0; i < state.pageCount; i++) {
      const rec = state.pages[i];
      if (!rec || !rec.src) continue;
      if (Math.abs(i - cur) <= KEEP_FULL) continue;
      const old = rec.src;
      rec.src = null;
      rec.level = null;
      if (rec.thumb) rec.img.src = rec.thumb;
      else rec.img.removeAttribute("src");
      setTimeout(() => URL.revokeObjectURL(old), 1000);
    }
  }

  // Bring the pages around the reader back up to reading quality.
  function ensureNear() {
    const cur = current();
    let queued = false;
    for (let d = 0; d <= KEEP_FULL; d++) {
      for (const i of d ? [cur - d, cur + d] : [cur]) {
        if (i < 0 || i >= state.pageCount) continue;
        const rec = state.pages[i];
        if (rec && !rec.src && !state.renderQueue.has(i)) {
          state.renderQueue.add(i);
          queued = true;
        }
      }
    }
    if (queued) prioritizeRender();
  }

  const idle = (ms) => new Promise((r) => setTimeout(r, ms));

  async function pumpRender() {
    if (state.rendering) return;
    state.rendering = true;
    while (state.renderQueue.size) {
      // Never start a page render mid-turn — that is what causes the stutter.
      while (state.busy && Date.now() < state.busyUntil) await idle(60);

      const cur = current();
      let best = null, bestD = Infinity;

      // Anything someone is actively waiting to see — a link preview they are
      // hovering right now — goes before the background sweep.
      for (const i of state.urgent) {
        if (state.renderQueue.has(i)) { best = i; break; }
        state.urgent.delete(i);        // no longer queued; drop the claim
      }

      if (best === null) {
        for (const i of state.renderQueue) {
          const d = Math.abs(i - cur);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      state.renderQueue.delete(best);
      const rec = state.pages[best];

      // Pages near the reader get reading quality; everything else only needs
      // a thumbnail, which is ~17x fewer pixels and keeps memory flat.
      // A page someone is waiting on for a link preview only ever needs the
      // thumbnail, so give it that immediately rather than a slow full render.
      const near = Math.abs(best - cur) <= KEEP_FULL;
      const urgent = state.urgent.delete(best);
      const want = (urgent && !rec.thumb) ? "thumb" : (near ? "full" : "thumb");
      const have = want === "full" ? !!rec.src : (!!rec.thumb && state.text[best] != null);
      if (!have) {
        try {
          await renderPage(best, want);
        } catch (err) {
          rec.fails = (rec.fails || 0) + 1;
          console.error("render", best, err);
        }
      }
      // An urgent thumbnail doesn't satisfy a nearby page's need for reading
      // quality, so queue it again — the retry cap stops a failing page looping.
      if (near && !rec.src && (rec.fails || 0) < 3) state.renderQueue.add(best);
      if (peekWaitingFor === best) refreshPeek();
      trimCache();

      if (!rec.counted) {
        rec.counted = true;
        state.renderedCount++;
        const pct = Math.round((state.renderedCount / state.pageCount) * 100);
        els.loadChip.textContent = `Loading ${pct}%`;
        if (state.renderedCount === state.pageCount) {
          els.loadChip.hidden = true;
          els.searchStatus.textContent =
            `Type a word above to search all ${state.pageCount} pages.`;
        }
      }
      // Yield a frame's worth of time so the UI can paint. Deliberately a
      // timer, not requestAnimationFrame: rAF is frozen in a background tab,
      // which would stop the notebook loading the moment someone switches tab.
      // Hidden, there is nothing to paint and timers are throttled to roughly
      // one a second, so skip the yield and keep rasterising back to back.
      if (!document.hidden) await idle(16);
    }
    state.rendering = false;
  }

  // Three quality levels, picked by how close a page is to the reader:
  //
  //   thumb — every page, tiny. Feeds the All-pages grid and the link
  //           previews, and stands in for a page you jump to until its full
  //           render lands, so you never see a blank sheet.
  //   full  — reading quality, only for the pages around the current spread.
  //   hi    — sharp, only for a page you actually zoom into.
  //
  // A page that drifts away from the reader is dropped back to its thumbnail
  // (see trimCache). Holding all 242 pages at reading quality is what made
  // flipping get heavier the longer the notebook was left loading.
  const LEVEL_PX = { thumb: 200, full: 820, hi: 2200 };
  const KEEP_FULL = 8;                    // pages either side kept at full

  async function renderPage(i, level) {
    const page = await state.pdf.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const hi = level === "hi";
    const target = LEVEL_PX[level] || LEVEL_PX.full;
    const scale = Math.min(hi ? 4 : 2, Math.max(0.15, target / base.width));
    const vp = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // "print" intent keeps rendering going even in a background tab
    const task = page.render({ canvasContext: ctx, viewport: vp, intent: "print" });
    if (hi) state.hiTask = task;
    try {
      await task.promise;
    } catch (err) {
      if (hi) state.hiTask = null;
      page.cleanup();
      if (err && err.name === "RenderingCancelledException") return;
      throw err;
    }
    if (hi) state.hiTask = null;

    const rec = state.pages[i];
    await new Promise((resolve) =>
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        if (level === "thumb") {
          if (rec.thumb) URL.revokeObjectURL(rec.thumb);
          rec.thumb = url;
          // Don't downgrade a page that already holds something better.
          if (!rec.src) rec.img.src = url;
        } else {
          const old = rec.src;
          rec.src = url;
          rec.img.src = url;
          rec.level = level;
          if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
        }
        if (rec.loading) rec.loading.hidden = true;
        rec.rendered = true;
        resolve();
      }, "image/jpeg", hi ? 0.92 : (level === "thumb" ? 0.72 : 0.86))
    );

    // Always leave a thumbnail behind. The grid and the link previews use it
    // and nothing ever revokes it, so they can't be left pointing at a
    // full-size blob that trimCache later releases.
    if (!rec.thumb) {
      const tw = LEVEL_PX.thumb;
      const tc = document.createElement("canvas");
      tc.width = tw;
      tc.height = Math.max(1, Math.round(tw * canvas.height / canvas.width));
      tc.getContext("2d").drawImage(canvas, 0, 0, tc.width, tc.height);
      await new Promise((res) =>
        tc.toBlob((bl) => {
          if (bl) rec.thumb = URL.createObjectURL(bl);
          res();
        }, "image/jpeg", 0.72)
      );
    }
    noteThumb(i);   // a thumbnail-level render already had one; still tell the grid

    if (state.text[i] == null) {
      try {
        const tc = await page.getTextContent();
        state.text[i] = tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " ");
      } catch { state.text[i] = ""; }
    }

    await placeLinks(page, vp, rec.linkLayer);
    page.cleanup();
  }

  /* ══ Link preview ══════════════════════════════════════════════════════
     Hovering a link in the notebook shows a small card: a thumbnail of the
     page it jumps to, or the address it opens. Replaces the browser's own
     tooltip and status-bar hint, neither of which we can style. */

  const peek = document.createElement("div");
  peek.className = "link-peek";
  peek.hidden = true;
  document.body.appendChild(peek);

  let peekTimer = null;
  let peekLink = null;          // the link the open card belongs to
  let peekWaitingFor = -1;      // page whose thumbnail the card is waiting on

  // Push a page to the head of the render queue so its preview image appears
  // straight away instead of waiting behind 200-odd other pages.
  function rushThumb(pageIdx) {
    const rec = state.pages[pageIdx];
    if (!rec || rec.thumb || rec.src) return;   // already has something to show
    state.urgent.add(pageIdx);
    state.renderQueue.add(pageIdx);
    prioritizeRender();
  }

  // Called once that page finishes, so a card showing "Still loading" swaps
  // in the real thumbnail without the reader having to move the pointer.
  function refreshPeek() {
    peekWaitingFor = -1;
    if (peek.hidden || !peekLink) return;
    buildPeek(peekLink);
    placePeek(peekLink);
  }

  // The author bookmark a page falls under, so the card can name the section.
  function sectionFor(pageIdx) {
    const sorted = state.author.slice().sort((x, y) => x.page - y.page);
    let found = null;
    for (const b of sorted) if (b.page - 1 <= pageIdx) found = b;
    return found;
  }

  function buildPeek(link) {
    peek.innerHTML = "";
    peekLink = link;
    if (link.dataset.peek === "page") {
      const t = +link.dataset.page;
      const rec = state.pages[t];
      const shot = document.createElement("div");
      shot.className = "peek-shot";
      const shotSrc = rec && rec.thumb;
      if (!shotSrc) { peekWaitingFor = t; rushThumb(t); }
      if (shotSrc) {
        const img = document.createElement("img");
        img.src = shotSrc;
        img.alt = "";
        shot.appendChild(img);
      } else {
        shot.classList.add("empty");
        shot.textContent = "Still loading";
      }

      const meta = document.createElement("div");
      meta.className = "peek-meta";
      const head = document.createElement("b");
      head.textContent = `Page ${t + 1}`;
      meta.appendChild(head);

      const sec = sectionFor(t);
      if (sec) {
        const s = document.createElement("span");
        s.className = "peek-sec";
        const dot = document.createElement("i");
        dot.style.background = sec.color;
        s.append(dot, document.createTextNode(sec.label));
        meta.appendChild(s);
      }
      const hint = document.createElement("span");
      hint.className = "peek-hint";
      hint.textContent = "Click to jump there";
      meta.appendChild(hint);

      peek.append(shot, meta);
      peek.classList.remove("is-url");
    } else {
      const url = link.dataset.url || "";
      let host = url, rest = "";
      try {
        const u = new URL(url);
        host = u.host.replace(/^www\./, "");
        rest = (u.pathname + u.search).replace(/\/$/, "");
      } catch { /* not a parseable URL — show it whole */ }

      const meta = document.createElement("div");
      meta.className = "peek-meta";
      const head = document.createElement("b");
      head.textContent = host;
      const path = document.createElement("span");
      path.className = "peek-url";
      path.textContent = rest || url;
      const hint = document.createElement("span");
      hint.className = "peek-hint";
      hint.textContent = "Opens in a new tab";
      meta.append(head, path, hint);

      peek.append(meta);
      peek.classList.add("is-url");
    }
  }

  function placePeek(link) {
    const r = link.getBoundingClientRect();
    peek.hidden = false;                    // must be laid out before measuring
    const w = peek.offsetWidth, h = peek.offsetHeight;
    const pad = 10;
    let left, top;

    // A bookmark tab or a row in the panel sits against the side of the
    // screen, so the card goes beside it — putting it above would cover the
    // very list you are reading. Links inside a page still get it above.
    // A scrub-bar marker sits low inside the bar, so anchoring to the marker
    // itself would leave the card overlapping the bar it points at. Clear the
    // whole bar instead.
    const bar = link.closest(".scrubbar");
    if (bar) {
      const br = bar.getBoundingClientRect();
      left = r.left + r.width / 2 - w / 2;
      top = br.top - h - 8;
      peek.style.left = `${Math.round(Math.max(pad, Math.min(left, window.innerWidth - w - pad)))}px`;
      peek.style.top = `${Math.round(Math.max(pad, top))}px`;
      return;
    }

    const beside = !!link.closest(".panel");
    if (beside) {
      const roomRight = window.innerWidth - r.right;
      left = roomRight >= w + 16 ? r.right + 10 : r.left - w - 10;
      top = r.top + r.height / 2 - h / 2;
    } else {
      left = r.left + r.width / 2 - w / 2;
      top = r.top - h - 10;
      if (top < pad) top = r.bottom + 10;
    }

    peek.style.left = `${Math.round(Math.max(pad, Math.min(left, window.innerWidth - w - pad)))}px`;
    const topLimit = (els.stage.getBoundingClientRect().top || pad) + 4;
    peek.style.top = `${Math.round(Math.max(topLimit, Math.min(top, window.innerHeight - h - pad)))}px`;
  }

  function hidePeek() {
    clearTimeout(peekTimer);
    peek.hidden = true;
    peekLink = null;
    peekWaitingFor = -1;
  }

  document.addEventListener("pointerover", (e) => {
    const link = e.target.closest && e.target.closest("[data-peek]");
    if (!link) return;
    clearTimeout(peekTimer);
    // Ask for the thumbnail the moment the pointer lands, not when the card
    // opens — that head start is usually enough for the image to be ready.
    if (link.dataset.peek === "page") rushThumb(+link.dataset.page);
    peekTimer = setTimeout(() => {
      buildPeek(link);
      placePeek(link);
    }, 180);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.target.closest && e.target.closest("[data-peek]")) hidePeek();
  });

  // Focusing a link by keyboard should preview it too.
  document.addEventListener("focusin", (e) => {
    const link = e.target.closest && e.target.closest("[data-peek]");
    if (!link) return;
    buildPeek(link);
    placePeek(link);
  });
  document.addEventListener("focusout", hidePeek);

  // pointerout never arrives if the window loses focus with the pointer still
  // over a link, which used to strand the card on screen until you hovered
  // something else. Any of these means the reader has moved on.
  window.addEventListener("blur", hidePeek);
  document.addEventListener("visibilitychange", () => { if (document.hidden) hidePeek(); });
  document.addEventListener("pointerdown", hidePeek, true);
  window.addEventListener("wheel", hidePeek, { passive: true });

  // Redraw the page(s) on screen at full detail once the reader zooms in.
  let upscaleTimer = null;
  function scheduleUpscale() {
    clearTimeout(upscaleTimer);
    if (state.zoom <= 1.25) return;
    upscaleTimer = setTimeout(async () => {
      // Never sharpen mid-drag; the reader is moving and would feel the hitch.
      if (state.panning || state.busy) { scheduleUpscale(); return; }
      for (const i of visiblePages(current())) {
        const rec = state.pages[i];
        if (!rec || rec.level === "hi" || !rec.src) continue;
        try { await renderPage(i, "hi"); } catch (err) { console.error("upscale", i, err); }
        if (state.panning) break;
      }
    }, 320);
  }

  /* ══ Links inside the PDF ══════════════════════════════════════════════ */

  async function placeLinks(page, vp, layer) {
    layer.innerHTML = "";   // a re-render must not stack a second set of links
    let annots = [];
    try { annots = await page.getAnnotations({ intent: "display" }); } catch { return; }
    for (const a of annots) {
      if (a.subtype !== "Link" || !a.rect) continue;
      const r = pdfjsLib.Util.normalizeRect(vp.convertToViewportRectangle(a.rect));
      const link = document.createElement("a");
      link.style.left = `${(r[0] / vp.width) * 100}%`;
      link.style.top = `${(r[1] / vp.height) * 100}%`;
      link.style.width = `${((r[2] - r[0]) / vp.width) * 100}%`;
      link.style.height = `${((r[3] - r[1]) / vp.height) * 100}%`;

      // No `title` anywhere: that is what raises the browser's own tooltip
      // box. The hover preview below replaces it.
      if (a.url) {
        link.href = a.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.dataset.peek = "url";
        link.dataset.url = a.url;
      } else if (a.dest) {
        try {
          const dest = typeof a.dest === "string" ? await state.pdf.getDestination(a.dest) : a.dest;
          const target = await state.pdf.getPageIndex(dest[0]);
          // Deliberately NOT an href. An <a href="#"> makes Chrome print the
          // URL in its status bar in the corner of the window, which is both
          // ugly and meaningless for a jump inside the book.
          link.removeAttribute("href");
          link.setAttribute("role", "link");
          link.tabIndex = 0;
          link.dataset.peek = "page";
          link.dataset.page = String(target);
          link.addEventListener("click", (e) => { e.preventDefault(); goTo(target); });
          link.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goTo(target); }
          });
        } catch { continue; }
      } else continue;

      layer.appendChild(link);
    }
  }

  /* ══ Pen / highlighter / eraser ════════════════════════════════════════ */

  function wireDrawing(canvas, pageIdx) {
    let stroke = null, erased = null;

    const toXY = (e) => {
      const b = canvas.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return null;   // hidden or mid-flip
      return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (!state.tool || !toXY(e)) return;
      e.stopPropagation();
      e.preventDefault();
      // Capture can fail for an unrecognised pointer; drawing still works
      // without it, so never let it abort the stroke.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      const pt = toXY(e);
      if (state.tool === "e") {
        erased = [];
        eraseAt(pageIdx, pt, erased);
      } else {
        stroke = { t: state.tool, c: state.ink[state.tool], w: state.tool === "h" ? 0.035 : 0.005, p: [pt] };
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!state.tool) return;
      e.stopPropagation();
      const pt = toXY(e);
      if (!pt) return;
      if (state.tool === "e" && erased) eraseAt(pageIdx, pt, erased);
      else if (stroke) { stroke.p.push(pt); redraw(pageIdx, stroke); }
    });

    const finish = (e) => {
      if (!state.tool) return;
      e.stopPropagation();
      if (stroke && stroke.p.length > 1) {
        (state.marks[pageIdx] = state.marks[pageIdx] || []).push(stroke);
        state.undo.push({ act: "add", page: pageIdx, stroke });
        state.redo.length = 0;   // a new mark abandons the redone branch
        syncHistoryButtons();
        savePersonal();
      }
      if (erased && erased.length) {
        state.undo.push({ act: "erase", page: pageIdx, strokes: erased });
        state.redo.length = 0;
        syncHistoryButtons();
        savePersonal();
      }
      stroke = null;
      erased = null;
      redraw(pageIdx);
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
  }

  function eraseAt(pageIdx, pt, bucket) {
    const list = state.marks[pageIdx];
    if (!list) return;
    const R = 0.022;
    for (let s = list.length - 1; s >= 0; s--) {
      if (list[s].p.some(([x, y]) => Math.hypot(x - pt[0], y - pt[1]) < R + list[s].w)) {
        bucket.push(list.splice(s, 1)[0]);
      }
    }
    redraw(pageIdx);
  }

  function redraw(pageIdx, liveStroke) {
    const rec = state.pages[pageIdx];
    if (!rec) return;
    const { ctx, anno } = rec;
    const list = (state.marks[pageIdx] || []).concat(liveStroke ? [liveStroke] : []);
    if (anno.width === 0) {
      if (!list.length) return;
      anno.width = ANNO_W;
      anno.height = Math.round(ANNO_W / state.ratio);
    }
    ctx.clearRect(0, 0, anno.width, anno.height);
    for (const s of list) drawStroke(ctx, anno, s);
  }

  function drawStroke(ctx, canvas, s) {
    const pts = s.p;
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = s.t === "h" ? "multiply" : "source-over";
    ctx.globalAlpha = s.t === "h" ? 0.45 : 1;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w * canvas.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * canvas.width, pts[0][1] * canvas.height);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * canvas.width;
      const my = ((pts[i][1] + pts[i + 1][1]) / 2) * canvas.height;
      ctx.quadraticCurveTo(pts[i][0] * canvas.width, pts[i][1] * canvas.height, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0] * canvas.width, last[1] * canvas.height);
    ctx.stroke();
    ctx.restore();
  }

  /* ══ Tool buttons ══════════════════════════════════════════════════════ */

  // With a tool in hand, the page must stay put: drawing near an edge or a
  // corner should leave a mark, not start turning the page.
  //
  // StPageFlip drives its folds from mouse and touch events, while our drawing
  // uses pointer events. Catching only the former on the way down — before
  // they reach the book the library listens on — stops every fold, including
  // the corner-lift preview, without touching the strokes themselves.
  for (const type of ["mousedown", "mousemove", "mouseup",
                      "touchstart", "touchmove", "touchend"]) {
    els.bookWrap.addEventListener(type, (e) => {
      if (state.tool) e.stopPropagation();
    }, true);
  }

  const toolBtns = { h: $("toolHighlight"), p: $("toolPen"), e: $("toolEraser") };
  const HINTS = {
    h: "Highlighter on — drag across the words you want to mark. Press Esc when you are done.",
    p: "Pen on — drag on the page to write. Press Esc when you are done.",
    e: "Eraser on — drag over a mark to remove it. Press Esc when you are done.",
  };

  function setTool(t) {
    state.tool = state.tool === t ? null : t;
    for (const [k, btn] of Object.entries(toolBtns)) btn.setAttribute("aria-pressed", String(state.tool === k));
    document.body.classList.toggle("drawing", !!state.tool);
    els.toolHint.hidden = !state.tool;
    if (state.tool) els.toolHint.textContent = HINTS[state.tool];
    // Park the colours directly beneath whichever tool they belong to, so
    // they read as that tool's colours rather than a stray row at the bottom.
    const host = state.tool === "h" ? toolBtns.h : state.tool === "p" ? toolBtns.p : null;
    els.swatches.hidden = !host;
    if (host) {
      host.insertAdjacentElement("afterend", els.swatches);
      buildInkSwatches();
    }
  }

  toolBtns.h.addEventListener("click", () => setTool("h"));
  toolBtns.p.addEventListener("click", () => setTool("p"));
  toolBtns.e.addEventListener("click", () => setTool("e"));

  function buildInkSwatches() {
    const kind = state.tool === "h" ? "h" : "p";
    els.swatches.innerHTML = "";
    for (const ink of INKS[kind]) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = ink.c;
      b.setAttribute("aria-label", `${ink.n} ink`);
      b.setAttribute("aria-pressed", String(state.ink[kind] === ink.c));
      b.addEventListener("click", () => { state.ink[kind] = ink.c; buildInkSwatches(); });
      els.swatches.appendChild(b);
    }
  }

  $("btnUndo").addEventListener("click", undo);
  $("btnRedo").addEventListener("click", redo);

  // Undo and redo are the same move in opposite directions: applying an
  // entry backwards puts it on the other stack, so the two mirror each other.
  function applyStep(u, forward) {
    const list = (state.marks[u.page] = state.marks[u.page] || []);
    const adding = (u.act === "add") === forward;
    if (adding) {
      if (u.act === "add") list.push(u.stroke);
      else list.push(...u.strokes);
    } else if (u.act === "add") {
      const i = list.indexOf(u.stroke);
      if (i >= 0) list.splice(i, 1);
    } else {
      for (const st of u.strokes) {
        const i = list.indexOf(st);
        if (i >= 0) list.splice(i, 1);
      }
    }
    redraw(u.page);
    savePersonal();
    syncHistoryButtons();
  }

  function undo() {
    const u = state.undo.pop();
    if (!u) return;
    state.redo.push(u);
    applyStep(u, false);
  }

  function redo() {
    const u = state.redo.pop();
    if (!u) return;
    state.undo.push(u);
    applyStep(u, true);
  }

  // Nothing to undo or redo reads better as a greyed button than a dead one.
  function syncHistoryButtons() {
    $("btnUndo").disabled = state.undo.length === 0;
    $("btnRedo").disabled = state.redo.length === 0;
  }

  $("btnClearPage").addEventListener("click", () => {
    for (const p of visiblePages(current())) {
      const list = state.marks[p];
      if (list && list.length) {
        state.undo.push({ act: "clear", page: p, strokes: list.slice() });
        state.redo.length = 0;
        state.marks[p] = [];
        redraw(p);
      }
    }
    savePersonal();
  });

  function visiblePages(idx) {
    if (!state.pf || state.pf.getOrientation() === "portrait") return [idx];
    if (idx === 0 || idx === state.pageCount - 1) return [idx];
    const left = idx % 2 === 1 ? idx : idx - 1;
    return left + 1 < state.pageCount ? [left, left + 1] : [left];
  }

  /* ══ Bookmarks: fore-edge tabs ═════════════════════════════════════════ */

  /* ══ Scrub-bar markers ═════════════════════════════════════════════════
     The bar stands for the whole notebook, so a bookmark's position along it
     is literally where that page falls in the book. */

  function buildTabs() {
    els.scrubMarks.innerHTML = "";
    if (!state.pageCount) return;

    const at = state.pendingIdx !== null ? state.pendingIdx : current();
    const spread = visiblePages(at);
    const all = state.author.map((b) => [b, false]).concat(state.mine.map((b) => [b, true]));
    all.sort((x, y) => x[0].page - y[0].page);

    for (const [b, mine] of all) {
      if (b.page < 1 || b.page > state.pageCount) continue;
      addMark(b, mine, spread.indexOf(b.page - 1) !== -1);
    }
  }

  // Where a page sits along the bar, 0-1. Matches the slider's own geometry.
  function pageFraction(pageIdx) {
    return state.pageCount < 2 ? 0 : pageIdx / (state.pageCount - 1);
  }

  function addMark(bm, isMine, here) {
    const m = document.createElement("button");
    m.className = "mark" + (isMine ? " mine" : "") + (here ? " here" : "");
    m.style.left = `${pageFraction(bm.page - 1) * 100}%`;
    m.dataset.peek = "page";
    m.dataset.page = String(bm.page - 1);
    m.setAttribute("aria-label", `${bm.label} — page ${bm.page}`);

    const head = document.createElement("span");
    head.className = "mark-head";
    head.style.background = bm.color;

    const stem = document.createElement("span");
    stem.className = "mark-stem";
    stem.style.background = bm.color;

    m.append(head, stem);
    m.addEventListener("click", () => goTo(bm.page - 1));

    // Author mode (and your own bookmarks) can be removed straight off the bar.
    if (isMine || state.authorMode) {
      m.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        removeBookmark(bm, isMine);
      });
      m.title = "Right-click to remove";
    }

    els.scrubMarks.appendChild(m);
  }

  // The filled part of the line shows how far through the notebook you are.
  function syncScrub(idx) {
    els.scrubFill.style.width = `${pageFraction(idx) * 100}%`;
  }

  function removeBookmark(bm, isMine) {
    if (isMine) {
      state.mine = state.mine.filter((b) => b !== bm);
      savePersonal();
      buildTabs();
      buildContents();
    } else {
      state.author = state.author.filter((b) => b !== bm);
      authorChanged();
    }
  }

  /* ══ Add-bookmark popover ══════════════════════════════════════════════ */

  function buildBookmarkColors() {
    els.bmColors.innerHTML = "";
    for (const c of PALETTE) {
      const b = document.createElement("button");
      b.className = "swatch";
      b.style.background = c;
      b.setAttribute("aria-label", `Tab colour ${c}`);
      b.setAttribute("aria-pressed", String(state.bmColor === c));
      b.addEventListener("click", () => { state.bmColor = c; buildBookmarkColors(); });
      els.bmColors.appendChild(b);
    }
  }

  $("btnBookmark").addEventListener("click", () => {
    const opening = els.bookmarkPop.hidden;
    closeFloaters();
    if (!opening || !state.pageCount) return;
    els.bmHead.textContent = state.authorMode
      ? "Bookmark this page — for everyone"
      : "Bookmark this page";
    els.bmLabel.value = "";
    els.bmLabel.placeholder = `Page ${current() + 1}`;
    els.bookmarkPop.hidden = false;
    els.bmLabel.focus();
  });

  $("bmCancel").addEventListener("click", () => { els.bookmarkPop.hidden = true; });
  $("bmAdd").addEventListener("click", addBookmark);
  els.bmLabel.addEventListener("keydown", (e) => { if (e.key === "Enter") addBookmark(); });

  function addBookmark() {
    const page = current() + 1;
    const bm = {
      page,
      label: els.bmLabel.value.trim().slice(0, 28) || `Page ${page}`,
      color: state.bmColor,
    };
    if (state.authorMode) {
      state.author.push(bm);
      state.author.sort((a, b) => a.page - b.page);
      authorChanged();
    } else {
      state.mine.push(bm);
      savePersonal();
      buildTabs();
      buildContents();
    }
    state.bmColor = PALETTE[(PALETTE.indexOf(state.bmColor) + 1) % PALETTE.length];
    buildBookmarkColors();
    els.bookmarkPop.hidden = true;
  }

  /* ══ Bookmarks panel ═══════════════════════════════════════════════════ */

  function buildContents() {
    els.authorList.innerHTML = "";
    for (const b of state.author) {
      const row = bmRow(b);
      if (state.authorMode) {
        row.appendChild(actBtn("Rename", "✎", (e) => {
          e.stopPropagation();
          const name = prompt("Bookmark name:", b.label);
          if (name && name.trim()) { b.label = name.trim().slice(0, 28); authorChanged(); }
        }));
        row.appendChild(actBtn("Remove", "×", (e) => { e.stopPropagation(); removeBookmark(b, false); }));
      }
      els.authorList.appendChild(row);
    }
    els.authorEmpty.hidden = state.author.length > 0;

    els.mineList.innerHTML = "";
    for (const b of state.mine) {
      const row = bmRow(b);
      row.appendChild(actBtn("Remove", "×", (e) => { e.stopPropagation(); removeBookmark(b, true); }));
      els.mineList.appendChild(row);
    }
    els.mineEmpty.hidden = state.mine.length > 0;
  }

  function bmRow(bm) {
    const row = document.createElement("div");
    row.className = "row";
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.dataset.peek = "page";
    row.dataset.page = String(bm.page - 1);

    const dot = document.createElement("span");
    dot.className = "row-dot";
    dot.style.background = bm.color;

    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = bm.label;

    const pg = document.createElement("span");
    pg.className = "row-page";
    pg.textContent = `p.${bm.page}`;

    row.append(dot, label, pg);
    const jump = () => { goTo(bm.page - 1); };
    row.addEventListener("click", jump);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(); } });
    return row;
  }

  function actBtn(title, glyph, fn) {
    const b = document.createElement("button");
    b.className = "row-act";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.textContent = glyph;
    b.addEventListener("click", fn);
    return b;
  }

  /* ══ Search ════════════════════════════════════════════════════════════ */

  let searchTimer = null;
  els.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  });

  function runSearch() {
    const q = els.searchInput.value.trim().toLowerCase();
    els.searchList.innerHTML = "";
    if (q.length < 2) {
      els.searchStatus.hidden = false;
      els.searchStatus.textContent = state.renderedCount < state.pageCount
        ? `Still reading the pages… ${state.renderedCount} of ${state.pageCount} ready.`
        : "Type at least two letters to search.";
      return;
    }

    let hits = 0;
    for (let i = 0; i < state.pageCount; i++) {
      const text = state.text[i];
      if (!text) continue;
      const at = text.toLowerCase().indexOf(q);
      if (at < 0) continue;
      hits++;

      const row = document.createElement("div");
      row.className = "row";
      row.tabIndex = 0;
      row.setAttribute("role", "button");

      const wrap = document.createElement("span");
      wrap.className = "row-label";
      const head = document.createElement("b");
      head.textContent = `Page ${i + 1}`;
      const snip = document.createElement("span");
      snip.className = "hit-text";
      const from = Math.max(0, at - 34);
      snip.append(
        document.createTextNode((from ? "…" : "") + text.slice(from, at)),
        Object.assign(document.createElement("mark"), { textContent: text.substr(at, q.length) }),
        document.createTextNode(text.slice(at + q.length, at + q.length + 46) + "…")
      );
      wrap.append(head, snip);
      row.appendChild(wrap);

      const go = () => { goTo(i); };
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      els.searchList.appendChild(row);
      if (hits >= 60) break;
    }

    els.searchStatus.hidden = hits > 0;
    if (!hits) {
      els.searchStatus.textContent = state.renderedCount < state.pageCount
        ? `Nothing yet — still reading the pages (${state.renderedCount} of ${state.pageCount}).`
        : `No pages contain “${els.searchInput.value.trim()}”.`;
    }
  }

  /* ══ All-pages grid ════════════════════════════════════════════════════ */

  // A page can finish rendering while the grid is open; fill its tile in.
  function noteThumb(i) {
    const rec = state.pages[i];
    if (!rec || !rec.thumb || els.gridOverlay.hidden) return;
    const tile = els.pageGrid.querySelector(`.thumb-img[data-page="${i}"]`);
    if (!tile || tile.getAttribute("src")) return;
    tile.src = rec.thumb;
  }

  // While the grid is open, the tiles on screen get their pages pushed to the
  // front of the render queue, so the stretch you scrolled to fills in rather
  // than waiting for the background sweep to reach it.
  let gridScrollTimer = null;

  function rushVisibleTiles() {
    if (els.gridOverlay.hidden) return;
    const box = els.pageGrid.getBoundingClientRect();
    const top = box.top - 300, bottom = box.bottom + 300;   // include a margin
    for (const img of els.pageGrid.querySelectorAll(".thumb-img:not([src])")) {
      const r = img.getBoundingClientRect();
      if (r.bottom > top && r.top < bottom) rushThumb(+img.dataset.page);
    }
  }

  els.pageGrid.addEventListener("scroll", () => {
    clearTimeout(gridScrollTimer);
    gridScrollTimer = setTimeout(rushVisibleTiles, 120);
  }, { passive: true });

  function openGrid() {
    els.pageGrid.innerHTML = "";
    const cur = current();
    for (let i = 0; i < state.pageCount; i++) {
      const rec = state.pages[i];
      const b = document.createElement("button");
      b.className = "thumb" + (i === cur ? " current" : "");

      const img = document.createElement("img");
      img.className = "thumb-img";
      img.loading = "lazy";
      // Decorative: the caption underneath already names the page. With alt
      // text the browser draws it, plus a broken-image glyph, in any tile
      // whose picture has not arrived yet.
      img.alt = "";
      img.dataset.page = String(i);
      if (rec && rec.thumb) img.src = rec.thumb;

      const cap = document.createElement("span");
      cap.className = "thumb-cap";
      cap.textContent = `Page ${i + 1}`;

      b.append(img, cap);
      b.addEventListener("click", () => { closeOverlay(); goTo(i); });
      els.pageGrid.appendChild(b);
    }
    els.gridOverlay.hidden = false;
    rushVisibleTiles();          // start with whatever is on screen
  }

  const closeOverlay = () => {
    els.gridOverlay.hidden = true;
    clearTimeout(gridScrollTimer);
  };

  /* ══ Panels, modals, floaters ══════════════════════════════════════════ */

  function closeFloaters() {
    els.contentsPanel.hidden = true;
    els.searchPanel.hidden = true;
    els.bookmarkPop.hidden = true;
    $("btnContents").setAttribute("aria-expanded", "false");
  }

  function openPanel(panel) {
    const wasOpen = !panel.hidden;
    closeFloaters();
    panel.hidden = wasOpen;
    if (panel === els.contentsPanel) $("btnContents").setAttribute("aria-expanded", String(!wasOpen));
    if (panel === els.searchPanel && !panel.hidden) { els.searchInput.focus(); runSearch(); }
  }

  $("btnContents").addEventListener("click", () => openPanel(els.contentsPanel));
  $("btnSearch").addEventListener("click", () => openPanel(els.searchPanel));
  $("btnGrid").addEventListener("click", openGrid);

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      const host = e.target.closest(".panel, .overlay, .modal");
      if (host === els.helpModal || host === els.welcome) closeModal();
      else if (host) host.hidden = true;
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".panel, .pop, .overlay, .modal, .toolbar, .topbar")) return;
    closeFloaters();
  });

  function openModal(el) {
    closeFloaters();
    els.scrim.hidden = false;
    el.hidden = false;
  }

  function closeModal() {
    els.scrim.hidden = true;
    els.welcome.hidden = true;
    els.helpModal.hidden = true;
  }

  els.scrim.addEventListener("click", closeModal);
  $("btnHelp").addEventListener("click", () => openModal(els.helpModal));
  $("welcomeGo").addEventListener("click", () => {
    closeModal();
    try { localStorage.setItem(LS.seen, "1"); } catch { /* ignore */ }
  });

  function firstRunWelcome() {
    let seen = "1";
    try { seen = localStorage.getItem(LS.seen); } catch { /* ignore */ }
    if (!seen) openModal(els.welcome);
  }

  /* ══ Navigation controls ═══════════════════════════════════════════════ */

  $("btnPrev").addEventListener("click", () => state.pf && state.pf.flipPrev());
  $("btnNext").addEventListener("click", () => state.pf && state.pf.flipNext());

  els.pageInput.addEventListener("change", () => goTo((parseInt(els.pageInput.value, 10) || 1) - 1));
  els.pageSlider.addEventListener("input", () => { els.pageInput.value = els.pageSlider.value; });
  els.pageSlider.addEventListener("change", () => goTo(parseInt(els.pageSlider.value, 10) - 1));

  $("btnFullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  // Wheel flips pages at fit size; zoomed in it scrolls, and Ctrl+wheel zooms.
  let wheelLock = false;
  els.stage.addEventListener("wheel", (e) => {
    if (!state.pf) return;
    if (e.ctrlKey) {
      e.preventDefault();
      zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
      return;
    }
    if (state.tool || state.zoom > 1) return;    // let the page scroll instead
    if (e.target.closest(".panel, .overlay, .modal")) return;
    e.preventDefault();
    if (wheelLock || Math.abs(e.deltaY) < 8) return;
    wheelLock = true;
    setTimeout(() => { wheelLock = false; }, 420);
    if (e.deltaY > 0) state.pf.flipNext(); else state.pf.flipPrev();
  }, { passive: false });

  /* ══ Theme ═════════════════════════════════════════════════════════════ */

  $("btnTheme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(LS.theme, next); } catch { /* ignore */ }
  });

  try {
    const saved = localStorage.getItem(LS.theme);
    if (saved) document.documentElement.dataset.theme = saved;
    else if (matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
  } catch { /* ignore */ }

  /* ══ Keyboard ══════════════════════════════════════════════════════════ */

  document.addEventListener("keydown", (e) => {
    // A key event can be raised against a non-element target, which has no
    // matches(); reading it unguarded would throw and swallow the shortcut.
    if (e.target && typeof e.target.matches === "function" &&
        e.target.matches("input, textarea")) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();     // Ctrl+Shift+Z redoes
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case "ArrowRight": case "PageDown": state.pf && state.pf.flipNext(); break;
      case "ArrowLeft": case "PageUp": state.pf && state.pf.flipPrev(); break;
      case "Home": goTo(0); break;
      case "End": goTo(state.pageCount - 1); break;
      case "+": case "=": zoomStep(1); break;
      case "-": case "_": zoomStep(-1); break;
      case "0": setZoom(1); break;
      case "Escape":
        if (state.tool) setTool(state.tool);
        closeFloaters();
        closeOverlay();
        closeModal();
        break;
      case "h": case "H": setTool("h"); break;
      case "p": case "P": setTool("p"); break;
      case "e": case "E": setTool("e"); break;
      case "b": case "B": $("btnBookmark").click(); break;
      case "f": case "F": $("btnFullscreen").click(); break;
      case "l": case "L": $("btnTheme").click(); break;
      default: return;
    }
  });

  /* ══ Personal storage ══════════════════════════════════════════════════ */

  let saveTimer = null;
  function savePersonal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS.marks(state.fp), JSON.stringify(state.marks));
        localStorage.setItem(LS.mine(state.fp), JSON.stringify(state.mine));
      } catch (err) { console.warn("could not save", err); }
    }, 350);
  }

  function loadPersonal() {
    try {
      state.marks = JSON.parse(localStorage.getItem(LS.marks(state.fp))) || {};
      state.mine = JSON.parse(localStorage.getItem(LS.mine(state.fp))) || [];
    } catch {
      state.marks = {};
      state.mine = [];
    }
    const ok = (v) => Number.isFinite(v) && v > -0.5 && v < 1.5;
    for (const k of Object.keys(state.marks)) {
      state.marks[k] = (state.marks[k] || []).filter(
        (s) => s && Array.isArray(s.p) && s.p.length > 1 &&
          s.p.every((pt) => Array.isArray(pt) && ok(pt[0]) && ok(pt[1]))
      );
    }
    state.mine = cleanBookmarks(state.mine).filter((b) => b.page <= state.pageCount);
  }

  /* ══ Go ════════════════════════════════════════════════════════════════ */

  boot();
})();
