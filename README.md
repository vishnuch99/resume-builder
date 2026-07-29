# Resume Builder

A local replica of your resume (the Enhancv-style two-column layout).
Edit everything in the browser, reorder anything, then export as PDF or DOCX.
No install, no account.

## Run it (the right way)

**Double-click `start.command`.** It starts a tiny local server (`server.py`) and opens
the app at http://127.0.0.1:8765/. In this mode **every edit is saved to
`resume-data.json` in this folder as you type** — your content lives in a real file,
not just in the browser, so nothing is lost between sessions or browsers.

(Opening `index.html` directly still works, but then edits only live in that browser's
localStorage, which browsers can silently wipe — the app shows a warning banner in
that mode.)

## Editing

- **Click any text** to edit it in place — name, summary, bullets, dates, even section headings.
- **Cmd+B / Ctrl+B** toggles bold on selected text (Cmd+I for italics).
- **Hover** over any entry, bullet, or row: a control cluster appears **inside** its
  top-right corner with **↑ ↓** (reorder) and **×** (delete).
- **Arrange** (toolbar): shows all controls on everything at once — jobs, bullets,
  skills, projects, languages, interests, and whole sections (↑↓ next to each heading).
  Skill/interest chips get **‹ ›** to move left/right and **×** to delete.
- **Photo**: click it to upload a different one.
- **Links**: hover next to a company/project name and click the faint ↗ icon to set a
  URL; alt-click an existing icon to change or remove it.
- **Cmd+S** force-saves any time (it also autosaves ~0.4s after you stop typing, and
  right before printing or closing).

## Layouts

The **Layout** toolbar button switches between:

- **Original (2 col)** — pixel-faithful to your Enhancv resume: photo, two columns,
  navy skill pills. Fits one page.
- **ATS (1 col)** — same fonts/headings/design language, but single column, no photo,
  no layout tables, comma-separated skills, plain text bullets — the structure resume
  parsers handle best. Flows to a second page (single-column simply needs the room).

The choice is saved with your data and applies to PDF and DOCX exports alike.

## Exporting

| Button | What it does |
|---|---|
| **Export PDF** | Saves first, then opens the print dialog — choose *Save as PDF*. Keep *Background graphics* ON so the skill pills stay navy. Chrome gives the most faithful output. |
| **Export DOCX** | Downloads a Word file matching the current layout. In ATS layout it's table-free and image-free. |
| **Export JSON** | Backs up all content to a file — handy for versioned variants (`resume-android.json`, `resume-founder.json`). |
| **Import JSON** | Restores a backup. |
| **Reset** | Discards edits and restores the original content from `data.js`. |

## Files

| File | Purpose |
|---|---|
| `start.command` | Double-click to launch (starts `server.py`, opens the browser). |
| `server.py` | Serves the app and writes `resume-data.json` on every save. |
| `resume-data.json` | **Your live resume content.** Created on first save; back this up. |
| `index.html` | The app shell. |
| `data.js` | The original/default content (what *Reset* restores). |
| `photo.js` | Your profile photo (extracted from the original PDF, base64). |
| `styles.css` | Layout/typography mirroring the original template + ATS variant. |
| `app.js` | Rendering, editing, reordering, persistence, and export logic. |
| `vendor/docx.umd.js` | The [docx](https://github.com/dolanmiu/docx) library (v8.5.0), vendored so DOCX export works offline. |

## Notes

- The template uses the **Lato** font, loaded from Google Fonts when online. Offline it
  falls back to Helvetica; install Lato locally (free) for a perfect match everywhere,
  including Word.
- To stop the server, press Ctrl+C in its terminal window (or just close the window).
  Restart any time with `start.command` — your content loads from `resume-data.json`.
