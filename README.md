# Redaction — Plotter Version

Generative asemic writing tool built with [p5.js](https://p5js.org), designed for pen plotters and SVG export.

**[Live demo →](https://lukaszlysakowski.github.io/redaction-plotter)**

## What it does

Generates pages of abstract glyph-like shapes that evoke redacted documents, asemic scripts, and typographic texture. Every output is unique and export-ready.

## Features

- **7 composition versions** — from tight dense scripts to loose open marks
- **Layout modes** — standard, text-like, Fibonacci spacing/words, phyllotaxis spiral
- **Fill styles** — hatching, cross-hatch, stippling, contour lines, scribble
- **Color palettes** — black, greyscale, curated multi-color sets, white-on-dark
- **SVG export** — plotter-ready, grouped by color layer
- **PNG export** — screen resolution
- **Presets** — save, load, export and import named settings as JSON

## Usage

Open `index.html` in a browser — no build step, no dependencies beyond the p5.js CDN.

Click the canvas or press **Regenerate** for a new variation. Adjust controls and export when you find something you like.

## Controls

| Panel | What it does |
|---|---|
| Composition | Shape generation — changes require Regenerate |
| Display | Fill style, colors, stroke — updates without regenerating |

### Optimized export

**Export SVG (optimized)** produces the same drawing tuned for pen plotters: coincident line
segments are merged into polylines, exact-overlap duplicates are removed, and paths are travel-
sorted per pen-color layer to minimize pen-up motion. It is **lossless** — identical ink on paper,
only the path structure and draw order change. The console logs the element-count and pen-up-travel
reduction. Use the plain **Export SVG** if you want the raw, unmerged paths for editing.

## GitHub Pages

Enable Pages from the `main` branch root in your repo Settings → Pages.
