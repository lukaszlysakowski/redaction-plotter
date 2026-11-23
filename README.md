# Redaction — Plotter Version

Generative asemic writing tool built with [p5.js](https://p5js.org), designed for pen plotters and SVG export.

**[Live demo →](https://lukaszlysakowski.github.io/redaction-plotter)** — standard version (plot via local server)  
**[Web Serial →](https://lukaszlysakowski.github.io/redaction-plotter/index-web.html)** — drive the plotter directly over USB, no server needed (Chrome/Edge only)

## What it does

Generates pages of abstract glyph-like shapes that evoke redacted documents, asemic scripts, and typographic texture. Every output is unique and export-ready.

## Features

- **8 composition versions** — from tight dense scripts to sparse large-format marks
- **Layout modes** — standard, text-like, Fibonacci spacing/words, phyllotaxis spiral
- **Fill styles** — hatching, cross-hatch, stippling, contour lines, scribble
- **Color palettes** — black, greyscale, curated multi-color sets, white-on-dark
- **SVG export** — plotter-ready, grouped by color layer
- **PNG export** — screen resolution
- **Presets** — save, load, export and import named settings as JSON
- **Plot panel** — send directly to an AxiDraw or iDraw writing robot via a local plot service

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

## Plotting

There are two ways to plot:

### Via local server (`index.html`)

The **Plot** button activates automatically when [`plot_server.py`](https://github.com/lukaszlysakowski/self-redaction) is running locally on port 8765. Works from the GitHub Pages version and from a locally-served copy.

The plot panel lets you:

- Pick between connected plotters (AxiDraw or iDraw writing robot)
- Set paper size and margin
- Select which color layers to plot
- Merge all colors into a single pass

The title (`Redaction · @lukaszgraphz · date`) is always included in the SVG as a second color layer, so it plots as a separate pass automatically.

### Via Web Serial — no server needed (`index-web.html`)

The **Serial Plot** button (Chrome/Edge only) drives the plotter directly over USB using the [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) — no Python server, no install step. Click the button, pick the USB port from the browser's port picker, and plot.

Supports:
- **iDraw A3** (DrawCore/GRBL firmware) — streams G-code with `ok` acknowledgment
- **AxiDraw** (EiBotBoard/EBB firmware) — CoreXY `SM` step commands

## GitHub Pages

Enable Pages from the `main` branch root in your repo Settings → Pages.
