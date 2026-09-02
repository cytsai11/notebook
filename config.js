// ─────────────────────────────────────────────────────────────────────────
//  Notebook site settings
//
//  This is the ONLY file you edit by hand. Change a value, save the file,
//  refresh the page in your browser. Keep the quote marks and the commas.
//
//  Bookmarks are NOT edited here — you add those inside the site itself
//  (Help → author mode). They live in bookmarks.json.
// ─────────────────────────────────────────────────────────────────────────

window.NOTEBOOK_CONFIG = {

  // Small badge in the top-left corner. Keep it short.
  team: "66994V",

  // Big title and the smaller grey line under it.
  title: "66994V daVid Engineering Notebook",
  season: "2026~2027 VRC Override",

  // The file the site opens. Export your notebook as one PDF, name it
  // notebook.pdf, and put it in this folder next to index.html.
  // Links inside the PDF keep working in the flip book.
  pdf: "notebook.pdf",

  // Main accent colour used across the buttons and highlights.
  accent: "#FFD84D",

  // Colours offered when adding a bookmark tab.
  tabPalette: ["#FFD84D", "#FF6B5E", "#3EC79C", "#54A8F0", "#B588F5"],

  // Starting bookmarks, used only the very first time — as soon as
  // bookmarks.json exists it takes over completely.
  // `page` is the page number shown in the page box at the top.
  starterBookmarks: [
    { label: "Contents",        page: 4,   color: "#FFD84D" },
    { label: "Judge's guide",   page: 7,   color: "#FF6B5E" },
    { label: "Introduction",    page: 12,  color: "#3EC79C" },
    { label: "Rules & strategy", page: 30, color: "#54A8F0" },
    { label: "Meeting logs",    page: 40,  color: "#FFD84D" },
    { label: "Gen 1 robot",     page: 55,  color: "#FF6B5E" },
    { label: "Gen 2 robot",     page: 164, color: "#3EC79C" },
    { label: "Appendix",        page: 238, color: "#54A8F0" },
  ],
};
