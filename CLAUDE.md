# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

No build step. Open `index.html` directly in a browser. p5.js is loaded from CDN (`cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js`).

To test changes: refresh the browser. Use the browser console — the app logs shape counts, export events, and errors there.

Presets are stored in `localStorage` under the key `redactionPresets`.

## Architecture

Everything lives in `index.html` as a single-file p5.js sketch. The code is organized into clearly commented sections:

### Two-phase pipeline

The core design separates **shape generation** from **rendering**. This is the most important invariant to preserve:

- `generateShapes()` → populates `allShapes[]` and the parallel color/angle/seed arrays. Seeded with `currentSeed` via p5's `randomSeed()`, so the same seed always produces the same shapes.
- `renderShapes()` → reads `allShapes[]` and the parallel arrays to draw everything. Can be called repeatedly without re-generating shapes.

UI controls are split accordingly:
- **Composition panel** controls call `regenerate()` — new seed, new shapes, new render.
- **Display panel** controls call `renderOnly()` — re-render existing shapes with new visual style. This lets you change fill style, colors, stroke weight, background without losing a composition you like.

### Shape data model

`allShapes` is an array of `{ vertices: [{x,y},...] }` objects. Each shape is a polygon defined by 3–12 vertices. Parallel arrays indexed by shape position hold per-shape properties assigned at generation time:

- `shapeAngles[]` — hatch angle for fill styles that use it
- `shapeScribbleSeeds[]` — sub-seed for stipple/scribble fill (makes fill deterministic per shape)
- `shapeColors[]`, `shapeGreys[]`, `shapeColorz[]`, `shapeColorsArr[]`, `shapeColorsz[]` — one pre-sampled color per palette per shape, so switching color modes doesn't require re-sampling

### Generative modes

`generateOriginalLayout(version)` dispatches to `generateShapes1()` through `generateShapes7()`. Each version uses different combinations of the random variables (`cnt2`, `cnt7`, `size`, `sizea`, `sizeb`, etc.) initialized at the top of `generateShapes()`. Version 6 is the only one that centers rows horizontally.

`generateTextLayout()` builds a text-like grid of irregular quads aligned to baselines, with optional Fibonacci spacing/word-lengths.

`applySpiralTransform()` repositions existing shapes along a phyllotaxis (golden-angle) spiral after `generateOriginalLayout()` runs — it translates and rotates each shape's vertices in place.

Image mode (`processUploadedImage()`) bypasses all generative code and builds `allShapes[]` directly from pixel brightness samples on a grid.

### Fill styles

Each fill style in `renderShapes()` calls a generator function that returns an array of `{type:'line',...}` or `{type:'point',...}` elements clipped to the shape polygon:

- `generateHatching` / `generateCrossHatch` — parallel lines clipped via `clipLineToPolygon()`
- `generateStippling` — random points filtered by `pointInPolygon()`
- `generateContourFill` — concentric shrunk copies of the polygon via `shrinkPolygon()`
- `generateScribbleFill` — short random walk segments clipped by `pointInPolygon()`

### SVG export

`exportSVG()` replays `svgContent[]` (populated during `renderShapes()`) and groups elements by stroke color. This color-layering is intentional for pen plotter workflows — each color group maps to a separate pen.
