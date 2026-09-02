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
| `notebook.pdf` | Your notebook. Replace this file to publish a new version. |
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

## Putting it online for free — GitHub Pages

1. Make a free GitHub account and create a new **public** repository.
2. Upload everything in this folder (drag the files onto the upload page).
3. In the repository go to **Settings → Pages**, set **Source** to the `main`
   branch and the root folder, and press Save.
4. A minute later your notebook is live at
   `https://<your-username>.github.io/<repository-name>/`

That link is what you give judges — put it on a QR code at your pit.

GitHub's file limit is 100 MB, which this notebook is under. If a future
export goes over, compress the PDF first (Adobe's "Compress PDF", Smallpdf,
or Ghostscript).

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
