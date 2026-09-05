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
    book: $("book"), scrubBar: $("scrubBar"), scrubTrack: $("scrubTrack"),
    scrubMarks: $("scrubMarks"),
    scrubFill: $("scrubFill"), scrubLast: $("scrubLast"),
    dropCard: $("dropCard"),
    pageInput: $("pageInput"), pageTotal: $("pageTotal"),
    pageSlider: $("pageSlider"),
    bootCard: $("bootCard"), bootFill: $("bootFill"), bootSub: $("bootSub"),
    contentsPanel: $("contentsPanel"), authorList: $("authorList"),
    authorEmpty: $("authorEmpty"), mineList: $("mineList"), mineEmpty: $("mineEmpty"),
    searchPanel: $("searchPanel"), searchInput: $("searchInput"),
    searchStatus: $("searchStatus"), searchList: $("searchList"),
    gridOverlay: $("gridOverlay"), pageGrid: $("pageGrid"),
    bookmarkPop: $("bookmarkPop"), bmHead: $("bmHead"), bmLabel: $("bmLabel"),
    bmColors: $("bmColors"),
    toolHint: $("toolHint"), swatches: $("swatches"), nibs: $("nibs"),
    inkRow: $("inkRow"),
    zoomer: $("zoomer"), zoomLevel: $("zoomLevel"),
    scrim: $("scrim"), welcome: $("welcome"), helpModal: $("helpModal"),
    authorBar: $("authorBar"), authorBarText: $("authorBarText"),
  };

  // ── Branding ──────────────────────────────────────────────────────────
  if (cfg.accent) document.documentElement.style.setProperty("--acc", cfg.accent);
  $("nbTitle").textContent = cfg.title || "Engineering Notebook";
  $("nbSeason").textContent = cfg.season || "";
  document.title = cfg.title || "Engineering Notebook";

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

  // How thick a stroke is, as a fraction of the page's width, so a mark keeps
  // its weight whatever size the page is drawn at. Each stroke stores the one
  // it was drawn with, so changing this never disturbs a mark already made.
  // `d` is how thick to draw the little sample, in pixels.
  const NIBS = {
    h: [{ n: "Thin", w: 0.022, d: 3 }, { n: "Medium", w: 0.035, d: 5 }, { n: "Wide", w: 0.055, d: 8 }],
    p: [{ n: "Fine", w: 0.0028, d: 2 }, { n: "Medium", w: 0.005, d: 3 }, { n: "Thick", w: 0.010, d: 5 }],
  };

  const LS = {
    theme: "nb:theme", seen: "nb:seen", author: "nb:authormode", draft: "nb:authordraft",
    // Keyed by page count so a reader's marks survive a rebuild of the same
    // notebook, but do not land on the wrong pages after a re-paginated one.
    marks: (n) => `nb:marks:${n}`, mine: (n) => `nb:mine:${n}`, last: (n) => `nb:last:${n}`,
  };

  const state = {
    pageCount: 0, ratio: 0.773,
    pf: null, pages: [],
    tool: null,
    ink: { p: INKS.p[0].c, h: INKS.h[0].c },
    nib: { p: NIBS.p[1].w, h: NIBS.h[1].w },
    marks: {}, undo: [], redo: [], text: [],
    mine: [],                     // personal bookmarks {page,label,color}
    author: [],                   // author bookmarks  {page,label,color}
    authorFile: [],               // what bookmarks.json actually holds
    authorMode: false,
    zoom: 1, fitW: 0, fitH: 0,
    busy: false, busyUntil: 0, folded: false,
    panning: false, coverTurn: false, pendingIdx: null, links: [],
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
      localStorage.removeItem(LS.marks(state.pageCount));
      localStorage.removeItem(LS.mine(state.pageCount));
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

  /* ══ Loading ═══════════════════════════════════════════════════════════
     The notebook ships as per-page WebP images built by tools/build-pages.mjs,
     not as a PDF the browser has to rasterise. Startup is therefore just a
     small manifest, and each page image is fetched only when it is needed. */

  // Three sizes of the same page. Which one a page carries depends on what
  // it is being asked to do, not on how far along the loading is.
  const pageUrl = (i) => `pages/p/${String(i + 1).padStart(4, "0")}.webp`;   // zoomed in
  const readUrl = (i) => `pages/m/${String(i + 1).padStart(4, "0")}.webp`;   // reading
  const thumbUrl = (i) => `pages/t/${String(i + 1).padStart(4, "0")}.webp`;  // grid, previews

  async function boot() {
    await loadAuthorBookmarks();
    buildContents();
    try {
      if (localStorage.getItem(LS.author) === "1") setAuthorMode(true);
    } catch { /* ignore */ }

    let manifest;
    try {
      const res = await fetch("pages/index.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(String(res.status));
      manifest = await res.json();
      if (!manifest || !manifest.count) throw new Error("empty manifest");
    } catch (err) {
      console.warn("pages/index.json could not be read:", err);
      els.bootCard.hidden = true;
      els.dropCard.hidden = false;
      return;
    }
    open(manifest);
  }

  function open(manifest) {
    els.dropCard.hidden = true;
    state.pageCount = manifest.count;
    state.ratio = manifest.ratio || 0.773;
    state.links = manifest.links || [];

    loadPersonal();
    buildPages();

    // Where to open: an explicit link wins, otherwise carry on where this
    // reader stopped. Decided before the flip engine is built so it can start
    // there outright rather than turning once it is running.
    const start = pageFromHash();
    initFlip(start !== null ? start : lastPageRead());
    buildTabs();
    buildContents();
    buildInkSwatches();
    buildBookmarkColors();

    els.zoomPad.hidden = false;
    els.bootCard.hidden = true;
    els.zoomer.hidden = els.scrubBar.hidden = false;

    // Revealing the scrub bar takes ~70px of height back off the stage, and
    // the book was sized against the taller stage a moment ago. Rather than
    // patch that one case, watch the stage: any change to its box re-fits the
    // book, which covers this, window resizes, and the rails wrapping.
    computeFit();
    window.dispatchEvent(new Event("resize"));   // let PageFlip re-measure
    watchStageSize();
    syncHistoryButtons();
    els.scrubLast.textContent = String(state.pageCount);
    els.pageTotal.textContent = `of ${state.pageCount}`;
    els.pageInput.max = state.pageCount;
    els.pageSlider.max = state.pageCount;

    syncUI(current());
    showNear();
    loadSearchText();
    firstRunWelcome();
  }

  /* ══ Which page images are attached ════════════════════════════════════
     Only pages near the reader carry their image. Attaching all 242 would
     pull tens of megabytes for pages nobody opens; the browser keeps the
     ones it has fetched, so turning back is instant. */

  const FADE_MS = 220;   // must match .page-img's transition in styles.css
  const ATTACH = 4;   // pages carrying an image at all
  const DECODE = 5;   // pages whose picture is turned into a bitmap in advance
  const WARM = 8;     // pages pulled into the browser cache ahead of the reader

  // Fetched but not attached. Holding the Image keeps the request alive; the
  // bytes then sit in the browser cache, so attaching later costs no network.
  const warmed = new Map();

  function warm(i, prepare) {
    if (i < 0 || i >= state.pageCount) return null;
    let im = warmed.get(i);
    if (!im) {
      im = new Image();
      im.decoding = "async";
      warmed.set(i, im);
      im.src = readUrl(i);
      // Bound the set, or a long read would hold every page open at once.
      if (warmed.size > WARM * 2 + 6) warmed.delete(warmed.keys().next().value);
    }
    // Decoding here, while nothing is moving, is the point of the whole
    // exercise: the page a turn lands on is already a finished bitmap, so it
    // can go up sharp on the first frame instead of arriving soft and
    // resolving a moment later.
    if (prepare && !im.prepared && im.decode) {
      im.prepared = true;
      im.decode().catch(() => { /* replaced or failed — nothing to prepare */ });
    }
    return im;
  }

  const bitmapReady = (i) => {
    const im = warmed.get(i);
    return !!(im && im.complete && im.naturalWidth);
  };

  function attach(rec, i) {
    if (rec.level) return;
    warm(i, true);

    // The thumbnail sits behind the real image as a backdrop, never as a
    // stand-in that has to be swapped out. When the reading image is already
    // prepared — which is the normal case — it covers the thumbnail on its
    // first paint and the reader never sees anything soft.
    const backdrop = new Image();
    backdrop.onload = () => {
      if (!rec.level) return;
      rec.inner.style.backgroundImage = `url("${thumbUrl(i)}")`;
      if (rec.loading) rec.loading.hidden = true;
    };
    backdrop.src = thumbUrl(i);

    setLevel(rec, i, "read");
    if (!rec.linked) { rec.linked = true; placeLinks(i, rec.linkLayer); }
  }

  // Put a size on screen. Anything already showing is dissolved out rather
  // than replaced under the reader, which is what stops a change of size from
  // reading as a flash.
  function setLevel(rec, i, level) {
    if (rec.level === level) return;
    rec.level = level;

    const front = rec.imgs[rec.front];
    const back = rec.imgs[1 - rec.front];
    const seq = ++rec.seq;
    if (rec.fade) { clearTimeout(rec.fade); rec.fade = 0; }

    // Park the incoming layer at invisible without animating it there. It is
    // behind the outgoing one and nobody can see it, and a fade-out here
    // would be the state the fade-in has to start from.
    back.style.transition = "none";
    back.classList.remove("ready");
    back.src = level === "zoom" ? pageUrl(i) : readUrl(i);
    front.after(back);                  // incoming layer paints over outgoing
    void back.offsetWidth;              // settle it before the transition
    back.style.transition = "";

    const arrived = back.complete && back.naturalWidth;
    // Nothing is on screen to dissolve from on the first image a page gets —
    // and the only thing under it is the soft backdrop, which is better cut
    // away instantly than faded through.
    if (arrived && !front.getAttribute("src")) {
      back.style.transition = "none";
      back.classList.add("ready");
      void back.offsetWidth;
      back.style.transition = "";
      rec.front = 1 - rec.front;
      return;
    }

    const reveal = () => {
      if (rec.seq !== seq) return;      // superseded while this one loaded
      back.classList.add("ready");
      rec.front = 1 - rec.front;
      // Release the outgoing picture once it has finished dissolving away.
      rec.fade = setTimeout(() => {
        rec.fade = 0;
        front.classList.remove("ready");
        front.removeAttribute("src");
      }, FADE_MS + 80);
    };

    if (arrived) reveal();
    else {
      back.addEventListener("load", reveal, { once: true });
      back.addEventListener("error", reveal, { once: true });
    }
  }

  function showNear() {
    const cur = current();
    for (let i = 0; i < state.pageCount; i++) {
      const rec = state.pages[i];
      if (!rec) continue;
      if (Math.abs(i - cur) <= ATTACH) {
        attach(rec, i);
      } else if (rec.level) {
        rec.level = null;
        rec.seq++;
        if (rec.fade) { clearTimeout(rec.fade); rec.fade = 0; }
        for (const im of rec.imgs) { im.classList.remove("ready"); im.removeAttribute("src"); }
        rec.front = 0;
        rec.inner.style.backgroundImage = "";
        if (rec.loading) rec.loading.hidden = false;
      }
    }
    sharpen();
  }

  // Reading size is what every nearby page carries; it is sharp at the size a
  // page is actually drawn and costs a quarter of what the zoom image costs to
  // decode and hold. The zoom image is fetched only for the spread being
  // magnified, which is what stops a long read from getting heavier.
  let sharpenTimer = null;
  function sharpenSoon() {
    clearTimeout(sharpenTimer);
    sharpenTimer = setTimeout(sharpen, 180);
  }

  function sharpen() {
    if (state.busy) return;             // never during a turn: that is the jank
    const cur = current();
    const on = visiblePages(cur);
    const magnified = state.zoom > 1.2;
    for (let i = 0; i < state.pageCount; i++) {
      const rec = state.pages[i];
      if (!rec || !rec.level) continue;
      if (on.indexOf(i) !== -1) {
        if (magnified) setLevel(rec, i, "zoom");
      } else {
        setLevel(rec, i, "read");
      }
    }
    for (let d = 0; d <= WARM; d++) {
      warm(cur - d, d <= DECODE);
      warm(cur + d, d <= DECODE);
    }
  }

  // Search needs every page's words, but nothing needs them in the first
  // moments, so it arrives quietly in the background.
  async function loadSearchText() {
    try {
      const res = await fetch("pages/text.json", { cache: "no-cache" });
      state.text = await res.json();
    } catch (err) {
      state.text = [];
      console.warn("search text unavailable:", err);
    }
    els.searchStatus.textContent = state.text.length
      ? `Type a word above to search all ${state.pageCount} pages.`
      : "Search is unavailable — pages/text.json could not be read.";
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

      // Two image layers per page. A page never swaps the picture inside one
      // element — the replacement loads into the spare layer and fades up over
      // the one already on screen, so changing size is a dissolve and not a
      // snap. Which layer is in front alternates; stacking is by document
      // order, so the links and annotations above them stay above them.
      const imgs = [0, 1].map(() => {
        const im = document.createElement("img");
        im.className = "page-img";
        im.alt = `Page ${i + 1}`;
        im.draggable = false;
        im.decoding = "async";
        // The placeholder sits behind the images and goes as soon as one of
        // them lands, so a page being fetched shows its number, not a gap.
        im.addEventListener("load", () => { if (loading) loading.hidden = true; });
        return im;
      });

      const linkLayer = document.createElement("div");
      linkLayer.className = "link-layer";

      const anno = document.createElement("canvas");
      anno.className = "anno";
      anno.width = 0;   // backing store appears on first mark, so clean
      anno.height = 0;  // pages cost nothing during flips
      wireDrawing(anno, i);

      inner.append(loading, imgs[0], imgs[1], linkLayer, anno);
      el.appendChild(inner);
      els.book.appendChild(el);
      state.pages.push({ el, inner, imgs, front: 0, seq: 0, fade: 0,
        loading, anno, ctx: anno.getContext("2d"), linkLayer,
        level: null, linked: false });
      redraw(i);
    }
  }

  /* ══ Flip engine + sizing + zoom ═══════════════════════════════════════ */

  function initFlip(startPage) {
    computeFit();
    const h = 560;
    state.pf = new St.PageFlip(els.book, {
      width: Math.round(h * state.ratio),
      height: h,
      size: "stretch",
      minWidth: 200, maxWidth: 1200, minHeight: 260, maxHeight: 1600,
      startPage,          // set here, not by turning afterwards
      showCover: true,
      maxShadowOpacity: 0.3,
      flippingTime: FLIP_MS,
      disableFlipByClick: true,
      mobileScrollSupport: false,
      showPageCorners: true,
    });
    state.pf.loadFromHTML(document.querySelectorAll(".page"));

    // Turning back was dead on a phone. flipPrev() and flipNext() both work by
    // inventing a point on the page and handing it to the same code a click
    // goes through, which — with disableFlipByClick on — first checks that the
    // point is at a corner. flipNext() offsets its point by the book's own
    // origin; flipPrev() writes a bare x: 10 and forgets to.
    //
    // On a two-page spread that oversight is invisible, because the book's
    // origin happens to be 0 there: the library derives it as
    // blockWidth / 2 - pageWidth, and a page is half the block. On one page a
    // page IS the block, so the origin is -blockWidth / 2, and x: 10 lands
    // near the middle of the page instead of its edge. No corner, no turn, no
    // complaint — which is why the Prev button, the left arrow, the wheel and
    // the swipe back all did nothing, and only ever on a narrow screen.
    //
    // Add the offset it forgot. On a spread the origin is 0, so this is
    // exactly what the library already computed.
    state.pf.flipPrev = (corner) => {
      const r = state.pf.getRender().getRect();
      state.pf.getFlipController().flip({
        x: r.left + 10,
        y: corner === "bottom" ? r.height - 2 : 1,
      });
    };

    // A phone shows one page, and turning it forward was fiddly for two
    // reasons that have nothing to do with each other.
    //
    // First, deciding which way a drag is headed. On a spread the library
    // splits at the gutter, which is what anyone would expect. On a single
    // page it splits at seven tenths of the way across, so only the right
    // third of the page starts a forward turn and a drag begun anywhere else
    // tried to go backward. Split a lone page down its middle instead.
    const flipper = state.pf.getFlipController();
    flipper.getDirectionByPoint = (p) => {
      const r = flipper.getBoundsRect();

      const back = state.pf.getOrientation() === "portrait"
        ? p.x < r.pageWidth       // one page: its own centre line
        : p.x < r.width / 2;      // a spread: the gutter, unchanged
      return back ? 1 : 0;        // 1 back, 0 forward
    };

    // How long a press waits before it becomes a page that can be dragged.
    // Touch only — the mouse never reads this.
    state.pf.getUI().swipeTimeout = 120;

    // How far a page has to be dragged before letting go turns it. The corner
    // rests at the page's outer edge and the library only counted the turn
    // once it had been dragged the whole width of the page, so anything short
    // of that sprang back. A third of the way is enough; past that the page
    // carries on by itself, which is how paper behaves.
    const CARRY = 0.34;

    flipper.stopMove = () => {
      const calc = flipper.getCalculation();
      if (!calc) return;
      const at = calc.getPosition();
      const r = flipper.getBoundsRect();
      const y = calc.getCorner() === "bottom" ? r.height : 0;
      const carried = at.x <= r.pageWidth * (1 - CARRY);
      flipper.animateFlippingTo(
        at,
        { x: carried ? -r.pageWidth : r.pageWidth, y },
        carried,
      );
    };

    /* ── On a phone a page is a card, not a sheet of paper ────────────────

       Curling a corner is a mouse gesture. It needs somewhere to take hold
       and room to carry the page across, and a thumb on a page that fills the
       screen has neither — which is what every attempt to make it work here
       kept running into.

       So on one page, drop the fold. The page slides with the thumb and is
       thrown off the side, and the next one comes in behind it. There is
       nothing to aim at: anywhere on the page will do, and the direction is
       simply the way the thumb went. The spread on a wider screen keeps its
       fold, where there is a corner to reach for and a mouse to reach with. */
    const CARD_OUT = 190;    // ms to throw the page off
    const CARD_IN = 230;     // ms to bring the next one on
    const CARD_FAR = 0.22;   // of the page, past which letting go turns it

    let card = null;

    // The pages on either side, waiting just off the edges of the screen. They
    // sit inside the book, so whatever carries the book carries them too, and
    // a swipe shows the edge of what is coming rather than a bare background.
    // The pages sit on the rim of one large wheel, a fixed angle apart, and a
    // swipe turns the wheel. The circle is worked out from that angle and the
    // distance between pages: a big radius for a small angle, so the arc is
    // gentle and the pages lean into each other rather than fanning out.
    //
    // The gap is wide enough that a neighbour stays off the screen until the
    // wheel is actually turned — tapping the page should show nothing.
    const PEEK_GAP = 56;
    const ARC_STEP = 15;          // degrees from one page to the next
    let peeks = null;

    function arc() {
      const w = els.book.offsetWidth, h = els.book.offsetHeight;
      const chord = w + PEEK_GAP;
      // Chord of a circle: chord = 2R sin(step / 2).
      const radius = chord / (2 * Math.sin((ARC_STEP * Math.PI) / 360));
      els.book.style.setProperty("--arc-step", `${ARC_STEP}deg`);
      els.book.style.setProperty("--arc-pivot", `${Math.round(h / 2 + radius)}px`);
      return ARC_STEP;
    }

    function neighbours() {
      if (peeks) return peeks;
      const make = (side) => {
        const d = document.createElement("div");
        d.className = `card-peek ${side}`;
        d.hidden = true;
        const im = document.createElement("img");
        im.alt = "";
        im.decoding = "async";
        d.appendChild(im);
        els.book.appendChild(d);
        return d;
      };
      peeks = { prev: make("prev"), next: make("next") };
      return peeks;
    }

    function showNeighbours() {
      const p = neighbours();
      arc();                    // the wheel depends on the page's size
      const here = current();
      const put = (el, i) => {
        if (i < 0 || i >= state.pageCount) { el.hidden = true; return; }
        const im = el.firstElementChild;
        const src = readUrl(i);
        if (im.getAttribute("src") !== src) im.src = src;
        el.hidden = false;
      };
      put(p.prev, here - 1);
      put(p.next, here + 1);
    }

    function hideNeighbours() {
      if (!peeks) return;
      peeks.prev.hidden = true;
      peeks.next.hidden = true;
    }

    // Turning the wheel, in degrees. A drag of one page's worth turns it by one
    // step, so the neighbour it was showing arrives where the page was. The
    // neighbours are children of the book and pivot about the same point, so
    // the whole rim turns together.
    function cardAt(dx, ms, deg) {
      const el = els.book;
      el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.22,.61,.36,1)` : "none";
      const stride = el.offsetWidth + PEEK_GAP;
      const turn = deg === undefined ? (dx / stride) * ARC_STEP : deg;
      if (!turn && !ms) { el.style.transform = ""; return; }
      el.style.transform = `rotate(${turn.toFixed(3)}deg)`;
    }

    // Settle back where it was, then put the neighbours away again.
    function cardHome() {
      cardAt(0, CARD_IN);
      setTimeout(() => { hideNeighbours(); els.book.style.transition = ""; }, CARD_IN + 40);
    }

    function cardTurn(forward) {
      const to = current() + (forward ? 1 : -1);
      if (to < 0 || to >= state.pageCount) { cardHome(); return; }

      // Carry it exactly one page along, so the neighbour that was showing at
      // the edge arrives square in the middle. Then the page underneath
      // becomes the page itself and everything drops back to nothing, with no
      // animation to give the swap away.
      // Exactly one step of the wheel, so the neighbour that was leaning in at
      // the edge comes round to where the page was.
      cardAt(0, CARD_OUT, forward ? -ARC_STEP : ARC_STEP);
      setTimeout(() => {
        goTo(to, true);
        hideNeighbours();
        cardAt(0, 0);
        setTimeout(() => { els.book.style.transition = ""; }, 30);
      }, CARD_OUT);
    }

    const cardable = (e) =>
      e.touches.length === 1 && !state.tool && state.zoom <= 1 &&
      state.pf.getOrientation() === "portrait" &&
      !(e.target.closest && e.target.closest(".link-layer a"));

    els.bookWrap.addEventListener("touchstart", (e) => {
      // A second finger is the beginning of a pinch, not the rest of a swipe.
      if (card) { card = null; cardHome(); }
      if (!cardable(e)) return;
      const t = e.touches[0];
      card = { x: t.clientX, y: t.clientY, at: t.clientX, w: els.book.offsetWidth,
               time: Date.now(), moving: false };
      showNeighbours();
      e.stopPropagation();      // no fold, ever: the engine never sees this
    }, true);

    els.bookWrap.addEventListener("touchmove", (e) => {
      if (!card) return;
      if (e.touches.length !== 1) { card = null; cardHome(); return; }
      const t = e.touches[0];
      const dx = t.clientX - card.x;
      if (!card.moving) {
        if (Math.abs(dx) < 4) return;
        // Going up or down the page is not an attempt to turn it.
        if (Math.abs(t.clientY - card.y) > Math.abs(dx)) { card = null; return; }
        card.moving = true;
      }
      card.at = t.clientX;
      e.stopPropagation();
      cardAt(dx, 0);
    }, true);

    const cardDrop = (e) => {
      if (!card) return;
      const { moving, at, x, time, w } = card;
      card = null;
      if (!moving) { hideNeighbours(); return; }
      e.stopPropagation();
      const dx = at - x;
      // Far enough to be meant, or quick enough to be a flick.
      const far = Math.abs(dx) > (w || 300) * CARD_FAR;
      const flick = Date.now() - time < 600 && Math.abs(dx) > 24;
      if (far || flick) cardTurn(dx < 0); else cardHome();
    };
    els.bookWrap.addEventListener("touchend", cardDrop, true);
    els.bookWrap.addEventListener("touchcancel", cardDrop, true);
    if (startPage) state.pf.turnToPage(startPage);   // some builds ignore startPage
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
      state.folded = e.data === "fold_corner";
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
        sharpen();          // upgrade the spread now that nothing is moving
        if (state.pendingIdx !== null) { state.pendingIdx = null; buildTabs(); }
        applyZoom(!tracked);
      }
    });
    syncUI(current());
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

    // One page or two, decided by the shape of the space rather than its
    // width. A phone held upright and a tablet held upright both want one
    // page though one is twice the width of the other, and both want two the
    // moment they are turned on their side. The engine decides by width
    // alone, which is why the two devices disagreed, so decide it here and
    // tell the engine outright: usePortrait off and it never splits to a
    // single page, a minWidth nothing can reach and it always does. minWidth
    // is read for nothing else.
    const single = els.stage.clientHeight > els.stage.clientWidth;
    if (state.pf) {
      const cfg = state.pf.getSettings();
      cfg.usePortrait = single;
      cfg.minWidth = single ? 1e6 : 200;
      if ((state.pf.getOrientation() === "portrait") !== single) state.pf.update();
    }
    const spreadRatio = state.ratio * (single ? 1 : 2);

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
  // The buttons step through ZOOMS; a pinch lands anywhere between them, so
  // any value in range is allowed and only the rounding is snapped.
  function setZoom(z, anchorX, anchorY) {
    z = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(ZOOMS[0], Math.round(z * 100) / 100));
    if (z === state.zoom) return;

    const st = els.stage;
    const pad = els.zoomPad;
    const sr = st.getBoundingClientRect();
    const ax = (anchorX == null ? sr.left + sr.width / 2 : anchorX) - sr.left;
    const ay = (anchorY == null ? sr.top + sr.height / 2 : anchorY) - sr.top;

    // Which point of the page is under the anchor, as a fraction of the pad —
    // then put that same point back under it afterwards.
    //
    // Set outright, never nudged. A pinch is hundreds of small steps now, and
    // a nudge that is a fraction of a pixel out on each of them, or clipped
    // once against the ends of the scroll, walks the page across the screen a
    // step at a time. Taken from layout rather than from screen rectangles,
    // which already have the scroll folded into them.
    const w0 = pad.offsetWidth, h0 = pad.offsetHeight;
    const fx = w0 ? (st.scrollLeft + ax - pad.offsetLeft) / w0 : 0.5;
    const fy = h0 ? (st.scrollTop + ay - pad.offsetTop) / h0 : 0.5;

    state.zoom = z;
    applyZoom();
    hidePeek();

    st.scrollLeft = fx * pad.offsetWidth + pad.offsetLeft - ax;
    st.scrollTop = fy * pad.offsetHeight + pad.offsetTop - ay;
    // Not on every frame of a pinch. Magnifying past the reading size swaps in
    // the big image, and doing that while the page is still being scaled makes
    // it blink — so wait until the fingers have settled.
    sharpenSoon();
  }

  const zoomStep = (dir, x, y) => {
    const i = ZOOMS.indexOf(state.zoom);   // -1 after a pinch
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

  // A pinch arrives as pointer events too, so the first finger down starts a
  // drag and every finger that moves afterwards is read as one — from a scroll
  // position taken before the zoom began. Two fingers opening look like an
  // enormous drag, which threw the page to one end and let the next frame of
  // the zoom snap it back. A second finger means this was never a drag.
  function cancelPan() {
    if (!pan) return;
    if (panFrame) { cancelAnimationFrame(panFrame); panFrame = 0; }
    panTo = null;
    pan = null;
    state.panning = false;
    els.stage.classList.remove("grabbing");
  }

  function movePan(e) {
    if (!pan || pinch) return;
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
  }

  panCatch.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || pinch) return;   // middle button bubbles to the stage
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

  // Sizing the book changes the book, never the stage, so this cannot loop.
  let stageWatch = null;
  function watchStageSize() {
    if (stageWatch || !("ResizeObserver" in window)) return;
    let lastW = 0, lastH = 0;
    stageWatch = new ResizeObserver(() => {
      const w = els.stage.clientWidth, h = els.stage.clientHeight;
      if (!w || !h || (w === lastW && h === lastH)) return;
      lastW = w; lastH = h;
      computeFit();
      window.dispatchEvent(new Event("resize"));
    });
    stageWatch.observe(els.stage);
  }

  let resizing = false;
  // Turning a phone over is the one moment the page count changes, and some
  // browsers report the new size a beat after saying they have rotated.
  window.addEventListener("orientationchange", () => {
    setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
  });
  window.addEventListener("resize", () => {
    if (resizing || !state.pf) return;
    computeFit();
    // Re-dispatch so PageFlip re-measures the wrapper we just resized. A
    // timer, not requestAnimationFrame — rAF never fires while the tab is
    // hidden, which would leave `resizing` stuck on and the book blank.
    buildTabs();          // marker spacing is measured in pixels
    placeInkControls();   // the rail may have changed which way it runs
    resizing = true;
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      resizing = false;
    }, 0);
  });

  const current = () => (state.pf ? state.pf.getCurrentPageIndex() : 0);

  /* ══ Going back ════════════════════════════════════════════════════════
     A bookmark, a search hit, a link inside the notebook — each of these can
     drop the reader two hundred pages from where they were, with no obvious
     way home. Every one of those routes lands here, so this is where the
     trail gets kept. */

  const TRAIL = 30;         // how far back the trail remembers
  const trail = [];         // pages jumped away from, most recent last
  let returning = false;    // walking the trail must not extend it

  function noteJump(from, to) {
    // Turning a page, or a spread, is not somewhere a reader needs help
    // getting back from — only a jump that skips content counts.
    if (returning || Math.abs(to - from) <= 2) return;
    if (trail[trail.length - 1] === from) return;   // already the way back
    trail.push(from);
    if (trail.length > TRAIL) trail.shift();
    syncTrail();
  }

  function goBack() {
    if (!trail.length) return;
    const to = trail.pop();
    returning = true;
    goTo(to);
    returning = false;
    syncTrail();
  }

  function syncTrail() {
    const b = $("btnBack");
    if (!b) return;
    b.disabled = !trail.length;
    b.dataset.tip = trail.length
      ? `Back to page ${trail[trail.length - 1] + 1}, where you jumped from`
      : "Nothing to go back to yet";
  }

  function goTo(idx, instant) {
    if (!state.pf) return;
    idx = Math.max(0, Math.min(state.pageCount - 1, idx));
    hidePeek();

    if (idx === current()) return;
    noteJump(current(), idx);
    // Opening straight onto a deep link should not animate 200 pages past.
    if (instant && state.pf.turnToPage) {
      state.pf.turnToPage(idx);
      // Sync against the page we asked for, not getCurrentPageIndex(): the
      // library does not update that synchronously, so reading it back here
      // would report the old page and undo the jump.
      syncUI(idx);
    } else {
      state.pf.flip(idx);
    }
  }

  /* ══ Deep links and picking up where you left off ═══════════════════════
     The page lives in the URL, so a link can point at one and the browser's
     own back button walks the pages you jumped to. */

  function pageFromHash() {
    const m = /(?:^|[#&])(?:p|page)=(\d+)/i.exec(location.hash || "");
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n >= 1 && n <= state.pageCount ? n - 1 : null;
  }

  function lastPageRead() {
    try {
      const n = Number(localStorage.getItem(LS.last(state.pageCount)));
      return Number.isFinite(n) && n > 0 && n < state.pageCount ? n : 0;
    } catch { return 0; }
  }

  let hashOurs = false;

  function rememberPage(idx) {
    try { localStorage.setItem(LS.last(state.pageCount), String(idx)); } catch { /* ignore */ }
    const want = `#p=${idx + 1}`;
    if (location.hash === want) return;
    hashOurs = true;                     // do not treat our own write as a jump
    history.replaceState(null, "", want);
  }

  window.addEventListener("hashchange", () => {
    if (hashOurs) { hashOurs = false; return; }
    const want = pageFromHash();
    if (want !== null) goTo(want, true);
  });

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
    rememberPage(idx);
    if (turned) { hidePeek(); buildTabs(); }


    showNear();
  }

  /* ══ Pinch to zoom ═════════════════════════════════════════════════════
     Judges read on tablets, where the +/- buttons are not the instinct — two
     fingers are. The gesture zooms continuously about the point between the
     fingers, so the page stays under them as it grows. */

  let pinch = null;

  const spread = (t) => Math.hypot(
    t[0].clientX - t[1].clientX,
    t[0].clientY - t[1].clientY
  );

  els.stage.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2) return;
    cancelPan();          // whatever the first finger began, it was not a drag
    const t = [e.touches[0], e.touches[1]];
    pinch = {
      last: spread(t),
      target: state.zoom,
      // Where the pair sits now, so the very first movement carries the page
      // rather than being spent working out where they started.
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    };
    hidePeek();
  }, { capture: true, passive: true });

  /* The zoom follows the fingers frame by frame rather than being worked out
     against how far apart they were when they landed.

     Measuring from that first reading meant one bad reading ruined the whole
     gesture: two fingers are reported as one point for an instant as they
     arrive, and a first spread of a few pixels turns any ordinary pinch into a
     multiple of ten. Worse, the running total was never bounded, so once it
     passed 400% the fingers could move without anything happening — the zoom
     sat pinned at the ceiling until the total fell back under it, and then
     dropped away all at once.

     Stepping instead means there is no first reading to get wrong, and the
     total is kept inside the range, so coming back down answers immediately. */
  // Fingers report faster than the screen redraws, and every reading costs a
  // measure of the page and a write to the scroll. Keep the newest one and
  // act on it once a frame, so the work matches what can actually be shown.
  let pinchFrame = 0, pinchAt = null;

  function stepPinch() {
    pinchFrame = 0;
    const to = pinchAt;
    pinchAt = null;
    if (!to || !pinch || !pinch.last) return;

    // Sliding two fingers across carries the page with them, so a reader can
    // move about without letting go and taking hold again.
    if (state.zoom > 1 && pinch.x != null) {
      els.stage.scrollLeft -= to.x - pinch.x;
      els.stage.scrollTop -= to.y - pinch.y;
    }
    pinch.x = to.x;
    pinch.y = to.y;

    const step = to.d / pinch.last;
    pinch.last = to.d;
    // One frame of a pinch does not multiply the zoom. Anything wilder than
    // this is the touch stream settling, not a hand moving.
    if (!(step > 0.7 && step < 1.4)) return;

    const most = ZOOMS[ZOOMS.length - 1], least = ZOOMS[0];
    pinch.target = Math.min(most, Math.max(least, pinch.target * step));
    setZoom(pinch.target, to.x, to.y);
  }

  els.stage.addEventListener("touchmove", (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();                       // no browser page zoom as well
    const t = [e.touches[0], e.touches[1]];
    const d = spread(t);
    if (!d) return;
    pinchAt = {
      d,
      x: (t[0].clientX + t[1].clientX) / 2,
      y: (t[0].clientY + t[1].clientY) / 2,
    };
    if (!pinchFrame) pinchFrame = requestAnimationFrame(stepPinch);
  }, { capture: true, passive: false });

  const endPinch = (e) => {
    if (e.touches && e.touches.length >= 2) return;
    if (pinchFrame) { cancelAnimationFrame(pinchFrame); pinchFrame = 0; }
    pinchAt = null;
    pinch = null;
  };
  els.stage.addEventListener("touchend", endPinch, true);
  els.stage.addEventListener("touchcancel", endPinch, true);

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
    peek.classList.remove("is-url", "is-tip");

    // A control saying what it does. The browser will do this itself from a
    // title attribute, but that tooltip cannot be styled, arrives on its own
    // schedule and looks nothing like the rest of the notebook — so nothing
    // here uses one.
    if (link.dataset.peek === "tip") {
      const meta = document.createElement("div");
      meta.className = "peek-meta";
      const head = document.createElement("b");
      head.textContent = link.dataset.tip || "";
      meta.appendChild(head);
      if (link.dataset.tipHint) {
        const hint = document.createElement("span");
        hint.className = "peek-hint";
        hint.textContent = link.dataset.tipHint;
        meta.appendChild(hint);
      }
      peek.appendChild(meta);
      peek.classList.add("is-tip");
      return;
    }

    if (link.dataset.peek === "page") {
      const t = +link.dataset.page;
      const rec = state.pages[t];
      const shot = document.createElement("div");
      shot.className = "peek-shot";
      const shotSrc = thumbUrl(t);
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

      if (link.dataset.removable) {
        const rm = document.createElement("span");
        rm.className = "peek-hint";
        rm.textContent = "Right-click to remove";
        meta.appendChild(rm);
      }

      peek.append(shot, meta);
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

    const beside = !!link.closest(".panel, .rail");
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

  /* ══ Links inside the notebook ═════════════════════════════════════════
     Rectangles come from the build as fractions of the page, so they sit
     correctly over the image whatever size it is drawn at. */

  function placeLinks(i, layer) {
    layer.innerHTML = "";
    for (const l of state.links[i] || []) {
      const a = document.createElement("a");
      a.style.left = `${l.b[0] * 100}%`;
      a.style.top = `${l.b[1] * 100}%`;
      a.style.width = `${l.b[2] * 100}%`;
      a.style.height = `${l.b[3] * 100}%`;

      if (l.u) {
        a.href = l.u;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.dataset.peek = "url";
        a.dataset.url = l.u;
      } else if (typeof l.p === "number") {
        // Deliberately not an href: an <a href="#"> makes the browser print
        // its URL in the corner of the window, which is meaningless here.
        a.setAttribute("role", "link");
        a.tabIndex = 0;
        a.dataset.peek = "page";
        a.dataset.page = String(l.p);
        a.addEventListener("click", (e) => { e.preventDefault(); goTo(l.p); });
        a.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goTo(l.p); }
        });
      } else continue;

      layer.appendChild(a);
    }
  }

  /* ══ Pen / highlighter / eraser ════════════════════════════════════════ */

  // A pinch reaches the drawing canvas as two pointers, and the pen happily
  // joined them up — a line straight across the page between the two fingers.
  // Counting them is the only way to tell one apart from the other, since the
  // second finger's pointerdown arrives before the touchstart that says a
  // pinch has begun.
  let fingers = 0;
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") fingers++;
  }, true);
  const liftFinger = (e) => {
    if (e.pointerType === "touch") fingers = Math.max(0, fingers - 1);
  };
  document.addEventListener("pointerup", liftFinger, true);
  document.addEventListener("pointercancel", liftFinger, true);

  function wireDrawing(canvas, pageIdx) {
    let stroke = null, erased = null;

    // Whatever was being drawn was not meant: throw it away unrecorded and put
    // the page back as it was.
    const abandon = () => {
      if (!stroke && !erased) return;
      stroke = null;
      erased = null;
      redraw(pageIdx);
    };

    const toXY = (e) => {
      const b = canvas.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) return null;   // hidden or mid-flip
      return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (fingers > 1 || pinch) { abandon(); return; }
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
        stroke = { t: state.tool, c: state.ink[state.tool], w: state.nib[state.tool], p: [pt] };
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      if (fingers > 1 || pinch) { abandon(); return; }
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
  /* Reaching for a link should not lift the page.

     StPageFlip peels a corner as soon as the pointer wanders into one, and its
     idea of a corner is a fifth of the page diagonal in from BOTH edges — on a
     page this size, a square about 130px on a side. Anything in there folds,
     links included, so a reader aiming at a link near the edge of the page got
     a curling corner instead of a hyperlink.

     Withhold the moves that would cause it: over a link, always, and elsewhere
     unless the pointer really is at a corner. A press that began on the page
     still passes everything through, so dragging a page across still works. */
  const FOLD_CORNER = 0.16;      // of the page, in from an outer corner

  let pressingBook = false;

  const overLink = (e) =>
    !!(e.target && e.target.closest && e.target.closest(".link-layer a"));

  function atFoldCorner(e) {
    const r = els.book.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    // Only the book's outer edges fold; the gutter down the middle never does.
    const single = !state.pf || state.pf.getOrientation() === "portrait";
    const cx = (single ? r.width : r.width / 2) * FOLD_CORNER;
    const cy = r.height * FOLD_CORNER;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return (x < cx || x > r.width - cx) && (y < cy || y > r.height - cy);
  }

  // Letting go of a corner is itself a mousemove, so a fold already showing has
  // to be told to lie back down — otherwise withholding the move that left the
  // corner would strand the page half-lifted.
  function unfold() {
    if (!state.folded || !state.pf || !state.pf.getFlipController) return;
    try { state.pf.getFlipController().showCorner({ x: -1, y: -1 }); } catch { /* nothing folded */ }
  }

  els.bookWrap.addEventListener("mousedown", (e) => {
    // A press that starts on a link is the library's to ignore, not ours to
    // treat as the beginning of a page turn.
    pressingBook = !overLink(e);
  }, true);
  window.addEventListener("mouseup", () => { pressingBook = false; });

  for (const type of ["mousedown", "mousemove", "mouseup",
                      "touchstart", "touchmove", "touchend"]) {
    els.bookWrap.addEventListener(type, (e) => {
      // A tool in hand, or a second finger down for a pinch, both mean this
      // gesture is not a page turn.
      if (state.tool || (e.touches && e.touches.length >= 2)) { e.stopPropagation(); return; }
      if (type !== "mousemove" || pressingBook) return;
      if (overLink(e) || !atFoldCorner(e)) { unfold(); e.stopPropagation(); }
    }, true);
  }

  const toolBtns = { h: $("toolHighlight"), p: $("toolPen"), e: $("toolEraser") };
  // Short enough to stay on a line or two on a phone, and no mention of a key
  // a phone does not have. Esc still works; so does tapping the tool again,
  // which is the obvious move when the button is lit.
  const HINTS = {
    h: "Highlighter on — drag across the words to mark them.",
    p: "Pen on — drag on the page to write.",
    e: "Eraser on — drag over a mark to remove it.",
  };

  function setTool(t) {
    state.tool = state.tool === t ? null : t;
    for (const [k, btn] of Object.entries(toolBtns)) btn.setAttribute("aria-pressed", String(state.tool === k));
    document.body.classList.toggle("drawing", !!state.tool);
    els.toolHint.hidden = !state.tool;
    if (state.tool) els.toolHint.textContent = HINTS[state.tool];
    placeInkControls();
  }

  // Beneath the tool while the rail stands on its side; at the end of the row
  // when it lies along the bottom, where slotting them in beside the tool
  // would split the run of buttons in two. Which of those applies changes when
  // a phone is turned over, so this is re-run on a resize as well — otherwise
  // rotating mid-annotation leaves the colours stranded where they were.
  function placeInkControls() {
    const host = state.tool === "h" ? toolBtns.h : state.tool === "p" ? toolBtns.p : null;
    els.swatches.hidden = !host;
    els.nibs.hidden = !host;
    if (!host) return;

    const acrossTheBottom = matchMedia("(max-width: 620px)").matches;
    els.inkRow.hidden = !acrossTheBottom;
    if (acrossTheBottom) {
      // Both into one box, which takes a whole line — otherwise the buttons
      // give up width to make room for the colours beside them.
      els.inkRow.append(els.swatches, els.nibs);
      host.closest(".rail").append(els.inkRow);
    } else {
      host.insertAdjacentElement("afterend", els.swatches);
      els.swatches.insertAdjacentElement("afterend", els.nibs);
    }
    buildInkSwatches();
    buildNibs();
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
      b.addEventListener("click", () => { state.ink[kind] = ink.c; buildInkSwatches(); buildNibs(); });
      els.swatches.appendChild(b);
    }
  }

  // Each size is a short stroke at that weight, in the ink it will draw with —
  // the thing itself rather than a word for it. Strokes, not dots: a second
  // row of circles under the colours would read as more colours.
  function buildNibs() {
    const kind = state.tool === "h" ? "h" : "p";
    els.nibs.innerHTML = "";
    for (const nib of NIBS[kind]) {
      const b = document.createElement("button");
      b.className = "nib";
      b.setAttribute("aria-label", `${nib.n} ${kind === "h" ? "highlighter" : "pen"}`);
      b.setAttribute("aria-pressed", String(state.nib[kind] === nib.w));
      b.dataset.peek = "tip";
      b.dataset.tip = nib.n;
      const bar = document.createElement("i");
      bar.style.height = `${nib.d}px`;
      bar.style.background = state.ink[kind];
      if (kind === "h") bar.style.opacity = ".55";
      b.appendChild(bar);
      b.addEventListener("click", () => { state.nib[kind] = nib.w; buildNibs(); });
      els.nibs.appendChild(b);
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

    // Bookmarks a few pages apart land a few pixels apart on a phone, where
    // they pile into a heap nobody can hit. Hold each one a marker's width
    // clear of the last, which moves it by a page or two at most — the bar is
    // a map of the notebook, not a ruler.
    const w = els.scrubTrack ? els.scrubTrack.clientWidth : 0;
    const APART = 15;
    let last = -Infinity;

    for (const [b, mine] of all) {
      if (b.page < 1 || b.page > state.pageCount) continue;
      let pct = pageFraction(b.page - 1) * 100;
      if (w > APART * 2) {
        const x = Math.min(w, Math.max(pageFraction(b.page - 1) * w, last + APART));
        last = x;
        pct = (x / w) * 100;
      }
      addMark(b, mine, spread.indexOf(b.page - 1) !== -1, pct);
    }
  }

  // Where a page sits along the bar, 0-1. Matches the slider's own geometry.
  function pageFraction(pageIdx) {
    return state.pageCount < 2 ? 0 : pageIdx / (state.pageCount - 1);
  }

  function addMark(bm, isMine, here, pct) {
    const m = document.createElement("button");
    m.className = "mark" + (isMine ? " mine" : "") + (here ? " here" : "");
    m.style.left = `${pct === undefined ? pageFraction(bm.page - 1) * 100 : pct}%`;
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
      m.dataset.removable = "1";
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
    b.dataset.peek = "tip";
    b.dataset.tip = title;
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
      els.searchStatus.textContent = state.text.length
        ? "Type at least two letters to search."
        : "Still loading the words…";
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
      els.searchStatus.textContent = state.text.length
        ? `No pages contain “${els.searchInput.value.trim()}”.`
        : "Still loading the words…";
    }
  }

  /* ══ All-pages grid ════════════════════════════════════════════════════ */

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
      if (r.bottom > top && r.top < bottom) img.src = thumbUrl(+img.dataset.page);
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
      // Left unset so the browser fetches it only when it scrolls into view.

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

  // Pressing away from a panel closes it — but not on the rail that opened it,
  // or the button's own press would shut the panel a moment before its click
  // could toggle it, and pressing Bookmarks twice would open it twice over.
  // (.toolbar was the bottom bar these buttons sat on before the rails.)
  document.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".panel, .pop, .overlay, .modal, .rail, .topbar")) return;
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

  $("btnBack").addEventListener("click", goBack);
  $("btnPrev").addEventListener("click", () => state.pf && state.pf.flipPrev());
  $("btnNext").addEventListener("click", () => state.pf && state.pf.flipNext());

  els.pageInput.addEventListener("change", () => goTo((parseInt(els.pageInput.value, 10) || 1) - 1));
  /* ══ Previewing along the bar ══════════════════════════════════════════
     The bar stands for the whole notebook, so pointing at a place on it is
     asking what is there. The bookmarks answer that already; this answers it
     everywhere in between, and keeps answering while the bar is dragged.

     It reuses the card the bookmarks and links use, driven from a hairline
     anchor that rides under the pointer — placePeek reads only where the
     anchor sits, so nothing about the card needs to know it is moving. */

  const scrubAnchor = document.createElement("div");
  scrubAnchor.className = "scrub-anchor";
  scrubAnchor.dataset.peek = "page";
  els.scrubTrack.appendChild(scrubAnchor);

  let scrubbing = false;
  let scrubIdx = -1;

  function scrubPeek(clientX) {
    if (!state.pageCount) return;
    const r = els.scrubTrack.getBoundingClientRect();
    if (!r.width) return;

    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    // The inverse of pageFraction, so the preview names the page whose
    // bookmark would sit under the pointer.
    const idx = Math.round((x / r.width) * (state.pageCount - 1));

    scrubAnchor.style.left = `${x}px`;
    clearTimeout(peekTimer);          // no waiting: this is a scrubbing gesture

    if (idx !== scrubIdx || peekLink !== scrubAnchor) {
      scrubIdx = idx;
      scrubAnchor.dataset.page = String(idx);
      buildPeek(scrubAnchor);
    }
    placePeek(scrubAnchor);           // follows the pointer even when idle
  }

  function endScrub() { scrubbing = false; scrubIdx = -1; }

  els.scrubTrack.addEventListener("pointermove", (e) => {
    // A bookmark has a fuller card of its own — let it answer for itself.
    if (e.target.closest && e.target.closest(".mark")) { scrubIdx = -1; return; }
    scrubPeek(e.clientX);
  });

  // The document-wide pointerdown hides the card before a drag begins; put it
  // straight back, since a drag is exactly when the preview earns its keep.
  els.scrubTrack.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest(".mark")) return;
    scrubbing = true;
    scrubPeek(e.clientX);
  });

  // The slider itself is a thin strip along the very bottom of the screen,
  // which on a phone is where the system watches for its own gestures — so a
  // drag there often never reaches the page at all. Let the whole bar do the
  // job instead: it is the height of a comfortable thumb, and well clear of
  // the edge.

  els.scrubTrack.addEventListener("pointerleave", () => {
    if (scrubbing) return;            // the pointer may stray off the bar mid-drag
    scrubIdx = -1;
    hidePeek();
  });

  window.addEventListener("pointerup", () => {
    if (!scrubbing) return;
    const to = scrubIdx;
    endScrub();
    hidePeek();                       // the page it named is the page now open
    if (to >= 0) goTo(to, Math.abs(to - current()) > 8);
  });
  window.addEventListener("pointercancel", () => { endScrub(); hidePeek(); });

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
    // Light is the default. A notebook is a paper document, and judges may
    // be reading in a bright room; only an explicit choice switches to dark.
    const saved = localStorage.getItem(LS.theme);
    document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";
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
        localStorage.setItem(LS.marks(state.pageCount), JSON.stringify(state.marks));
        localStorage.setItem(LS.mine(state.pageCount), JSON.stringify(state.mine));
      } catch (err) { console.warn("could not save", err); }
    }, 350);
  }

  function loadPersonal() {
    try {
      state.marks = JSON.parse(localStorage.getItem(LS.marks(state.pageCount))) || {};
      state.mine = JSON.parse(localStorage.getItem(LS.mine(state.pageCount))) || [];
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
