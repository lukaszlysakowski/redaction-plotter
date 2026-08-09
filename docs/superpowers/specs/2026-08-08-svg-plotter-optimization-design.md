# SVG Plotter Optimization — Design Spec (2026-08-08)

## Goal

Add a second, **optimized** SVG export to Redaction Plotter that produces the same drawing with
far less pen-up travel, so plots in Inkscape / AxiDraw finish faster and lift the pen less. The
existing `exportSVG()` is left untouched; a new `exportOptimizedSVG()` sits beside it.

The transformation is **lossless to the drawn image**: only the *structure and order* of paths
change, never their geometry. Same ink on paper.

## Context (current export)

Everything lives in the single-file `index.html`. `renderShapes()` populates `svgContent[]`, whose
elements are one of three shapes, each tagged with a pen `color` and `strokeWidth`:

- `{ type:'polygon', points:[{x,y}...], color, strokeWidth }` — shape outlines (closed loops)
- `{ type:'line', x1,y1,x2,y2, color, strokeWidth }` — hatch / crosshatch / **contour** / scribble fill
- `{ type:'circle', cx,cy,r, color, strokeWidth }` — stipple dots

`exportSVG()` groups `svgContent` by `color` (each color = one pen layer) and emits `<polygon>` /
`<line>` / `<circle>`. The fills dominate the element count: contour rings and connected fills are
emitted as **many individual `<line>` segments that share endpoints**, and hatch/stipple produce
large numbers of disconnected primitives — the pen lifts between every one.

## What we add

A new export function `exportOptimizedSVG()` and a button **"Export SVG (optimized)"** next to the
existing "Export SVG". It reads the same `svgContent`, runs three passes **per color layer**, and
writes an SVG with the same overall structure but plot-efficient paths.

### Pass 1 — Merge (line segments → polylines)

Within a color layer, chain `line` segments whose endpoints coincide into continuous **polylines**:

- Quantize endpoints to a grid of `EPS = 0.1` px (coords are already emitted at 2 decimals) and key
  segments by their two endpoints.
- Build an adjacency map from quantized endpoint → segment. Greedily walk: pick an unused segment,
  extend from each end to any unused segment sharing that endpoint, until no extension exists. The
  walked chain becomes one polyline. Repeat until all segments are consumed.
- A chain whose first and last point are equal (within `EPS`) is emitted as a closed `<polygon>`;
  otherwise an open `<polyline>`.
- `polygon` elements (shape outlines) are already closed loops — passed through as polylines with
  their existing vertex order (they still participate in Pass 3 ordering).

Result: contour rings collapse from N segments to 1 stroke; any connected fill becomes one stroke.
Disconnected hatch lines stay as 2-point polylines (still benefit from Pass 3).

### Pass 2 — Dedupe

While building adjacency in Pass 1, drop a segment whose quantized endpoint pair (unordered) is
already present — removes crosshatch double-draws and coincident borders. Exact-overlap only (same
quantized endpoints); no partial-overlap trimming (that is vpype territory, out of scope).

### Pass 3 — Travel-sort (greedy nearest-neighbor)

Order the merged polylines and the stipple dots to minimize pen-up distance:

- Start pen at the origin (0,0).
- Repeatedly choose the not-yet-emitted item whose nearest endpoint (polyline: either end; dot: its
  center) is closest to the current pen position. Emit it; if it is a polyline, flip its point order
  so it *starts* at the nearer end; advance the pen to its far end (or the dot).
- Closed polygons: choose the nearer vertex as the start (rotate the loop) but keep it closed.
- Complexity is O(n²) over items per layer; fine for the element counts here (log timing; if a
  layer exceeds ~20k items, fall back to un-sorted emit rather than hang — see Error handling).

### Output

Identical wrapper to `exportSVG()`: XML header, `width`/`height`/`viewBox` from `width`,`height`;
background `<rect>` from `bgColor`; `<g id="artwork" fill="none" stroke-linecap="round"
stroke-linejoin="round">`; then one `<g stroke="COLOR" stroke-width="SW">` per color layer. Inside
each layer: `<polyline points="...">` / `<polygon points="...">` for strokes, `<circle>` for dots
(now in travel order). Filename `Redaction_plotter_optimized_${Date.now()}.svg`.

## The lossless invariant (must hold)

Every point that appears in the raw export appears in the optimized export at the **same
coordinates**. Passes may only: (a) join segments that already share an endpoint, (b) drop a
segment that exactly duplicates another, (c) reorder items and reverse a polyline's direction.
Nothing may move, add, or delete a point that changes the rendered image. Merge and dedupe use the
same `EPS` so a "duplicate" and a "join" are decided consistently.

## Out of scope (YAGNI)

- Occlusion / hidden-line removal — it *would* change the image; leave to vpype if ever wanted.
- Partial-overlap trimming, line simplification, path smoothing.
- New UI knobs — `EPS` and dedupe are fixed constants; no sliders.
- Any change to `generateShapes` / `renderShapes` / the existing `exportSVG()` / presets.
- G-code or HPGL output — SVG only (Inkscape consumes it).

## Error handling

- Empty `svgContent` (nothing rendered yet): no-op with a console warning, no file written — mirror
  whatever the raw export does today.
- Degenerate zero-length segments (x1==x2 && y1==y2 within `EPS`): dropped in Pass 1.
- Per-layer item count over a safety cap (~20k): skip Pass 3 sorting for that layer (still merge +
  dedupe), log a note — never hang the tab.

## Verification (browser)

No unit-test harness in this repo; verify in the browser and console:

1. **Lossless:** export raw and optimized for the same seed; open both — the drawing is visually
   identical (overlay / eyeball; same viewBox and coordinates).
2. **Fewer primitives:** console logs raw element count vs optimized path count + estimated pen-up
   travel before/after; optimized is substantially lower (esp. contour/hatch fills).
3. **Layers preserved:** optimized SVG has one `<g stroke=...>` per color, same colors as raw.
4. **Valid + plottable:** opens cleanly in a browser and in Inkscape; `<polyline>`/`<polygon>` are
   native. No console errors.
5. **Edge cases:** export with nothing generated (warns, no download); a stipple-only composition
   (all circles, travel-ordered); a contour composition (rings merged to closed polygons).

## Files touched

- `index.html` — add `exportOptimizedSVG()` and its helpers (`mergeSegments`, `dedupe`,
  `travelSort`), and the new button. Self-contained; no other sections change.
- `README.md` / `CLAUDE.md` — document the optimized export and the lossless invariant.
