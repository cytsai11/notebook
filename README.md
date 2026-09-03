# Engineering Notebook — flip book website

A Heyzine-style flip book for your engineering notebook. Judges can turn pages,
zoom in, highlight, draw, search and bookmark. You (the author) can add the
bookmarks that everybody sees. No accounts, no watermarks, no monthly fee —
it is five plain files you can host anywhere for free.

## What's in this folder

| File | What it is |
| --- | --- |
| `index.html` | The page itself. |
| `styles.css` | How it looks. |
| `app.js` | How it works. |
| `config.js` | **The only file you edit by hand** — team name, title, colours. |
| `bookmarks.json` | Your bookmarks. The site writes this for you (see below). |
| `notebook.pdf` | Your notebook — the source the page images are built from. |
| `pages/` | The built page images. Created by the build step; do not edit by hand. |
| `tools/` | The build script that turns the PDF into those images. |
| `Open notebook.bat` | Double-click this to read the notebook on this computer. |

## Looking at it on your own computer

**Double-click `Open notebook.bat`.** It starts a small web server and opens
your browser at <http://localhost:8765>. Leave the black window open while you
read; closing it stops the server.

Why a server at all? Browsers refuse to load a PDF from a page opened directly
off the disk, so double-clicking `index.html` shows an empty notebook. The
batch file exists purely to get around that.

If port 8765 is already busy, pass another one:

```
"Open notebook.bat" 8080
```

The batch file needs Python, which it looks for automatically and tells you how
to install if it is missing. If you would rather run it yourself:

```bash
python -m http.server 8765
```

## Publishing a new version

1. Replace `notebook.pdf` with your new export.
2. Rebuild the page images:

   ```
   cd tools
   npm install      # first time only
   npm run build
   ```

3. Publish:

   ```
   git add -A && git commit -m "Update notebook" && git push
   ```

GitHub Pages rebuilds in about a minute.

## Why page images instead of the PDF

The site used to download the whole 50 MB PDF and draw it in the reader's
browser, so nothing appeared until the last byte arrived — painful on
competition Wi-Fi. `tools/build-pages.mjs` now turns the PDF into one WebP per
page, so a reader fetches only the pages they actually open. Search text and
every hyperlink are extracted at build time too, so both still work.


## Updating the notebook

Replace `notebook.pdf` with your new export, upload it again, done. The page
asks the server for a fresh copy each visit, so readers see the new version
straight away.

## Adding bookmark tabs that everyone sees

The coloured tabs down the edge of the book are yours to control, and you set
them up inside the site — no code.

1. Open your site and click **Help**.
2. Open *"I'm the author — how do I add bookmarks everyone sees?"* and click
   **Turn on author mode**. A yellow bar appears at the top.
3. Go to a page and click **Add bookmark**. Type a name, pick a colour, add it.
   Rename with the pencil, delete with the ×, in the **Bookmarks** panel.
4. When you're happy, click **Save bookmarks file** in the yellow bar. Your
   browser downloads `bookmarks.json`.
5. Put that downloaded file in this folder, replacing the old `bookmarks.json`,
   and upload it to GitHub. Everyone now sees your tabs.

Author mode stays on in your browser until you click **Turn off**. It only
affects your own browser, so nobody can change your published bookmarks — the
only thing readers ever see is the `bookmarks.json` you uploaded.

## What readers can do

- Turn pages by dragging a corner, the **Back**/**Next** buttons, arrow keys,
  the mouse wheel, or the slider under the book.
- Zoom with **+** / **−**, a double-click, or `Ctrl` + scroll, then drag — or
  hold the middle mouse button — to move around the page.
- Jump with your bookmark tabs, the **All pages** thumbnail grid, or by typing
  a page number.
- **Search** every word in the notebook.
- Highlight, draw with the pen, and erase. Marks save automatically **in that
  reader's browser only** — they never touch your notebook or other readers.
- Add their own private bookmarks.
- Switch light/dark mode, and go fullscreen.
- Click links inside the PDF: contents entries jump to the page, web links
  open in a new tab.

## Notes

- The page loads PDF.js and StPageFlip from a CDN, so readers need internet
  access — the same is true of any hosted flip book.
- Pages are rendered starting from the one being read and working outward, so
  a big notebook is readable immediately while the rest fills in behind.
- A reader can wipe their own marks under **Help → author section → Erase my
  own marks & bookmarks**.
