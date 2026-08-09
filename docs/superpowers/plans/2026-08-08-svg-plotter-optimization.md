# SVG Plotter Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lossless "Export SVG (optimized)" button that merges shared-endpoint line segments into polylines, dedupes exact overlaps, and travel-sorts paths per pen-color layer to cut pen-up motion when plotting in Inkscape / AxiDraw.

**Architecture:** Everything is added to the single-file `index.html` inline script, beside the existing `exportSVG()`. Three pure helpers (`mergeSegments`, `travelSort`, `estimateTravel`) plus a `buildOptimizedSVG()` string builder and an `exportOptimizedSVG()` downloader. The existing export, shape generation, and rendering are untouched. Verification is browser-console based (no test framework in this repo).

**Tech Stack:** Vanilla JS in a single HTML file; p5.js 1.9.0 from CDN (unchanged). No build step, no new dependencies.

## Global Constraints

- **Single-file:** all new code goes in `index.html`'s inline `<script>`. No build step, no new dependencies, p5 CDN tag unchanged.
- **Lossless invariant:** passes may only (a) join segments that already share an endpoint, (b) drop a segment whose quantized endpoints exactly duplicate another, (c) reorder items and reverse a polyline's direction. Never move, add, or delete a point that changes the rendered image. The optimized SVG's set of quantized points must equal the raw export's.
- **Do not modify** `generateShapes` / `renderShapes` / `exportSVG()` / preset code.
- **`OPT_EPS = 0.1`** px — the single quantization tolerance shared by merge and dedupe.
- **Per-color pen layers preserved:** optimize within each `color` group; emit one `<g stroke=...>` per color, same colors as the raw export.
- **Safety cap:** if a color layer has more than `OPT_MAX_SORT = 20000` items, skip travel-sort for that layer (still merge + dedupe); log a note. Never hang the tab.
- **Filename:** `Redaction_plotter_optimized_${Date.now()}.svg`.
- **svgContent element shapes** (produced by `renderShapes`, do not change): `{type:'polygon', points:[{x,y}], color, strokeWidth}`, `{type:'line', x1,y1,x2,y2, color, strokeWidth}`, `{type:'circle', cx,cy,r, color, strokeWidth}`.

### Test setup (all tasks)

Serve the repo and open it in a browser you can run console snippets in:

```bash
cd /Users/lukasz/claude/redaction-plotter && npx serve . --listen 4600
```

Open `http://localhost:4600`. Each test is a snippet pasted into the browser console (or run via the preview browser's JS tool). A snippet returns the string `PASS` or `FAIL ...`. "Run to verify it fails" means: before the function exists, the snippet throws `ReferenceError` (that is the failing state); after implementing and reloading, it returns `PASS`.

---

### Task 1: Merge + dedupe core

**Files:**
- Modify: `index.html` — add a new commented section `// --- Plotter optimization ---` in the inline script, immediately above `function exportSVG()`.

**Interfaces:**
- Produces:
  - `const OPT_EPS = 0.1;`
  - `function optKey(x, y)` → string — quantized endpoint key.
  - `function mergeSegments(segs)` where `segs: [{x1,y1,x2,y2}]` → `[[{x,y}, ...], ...]` — array of polylines (each an ordered point list). A polyline whose first and last points are equal within `OPT_EPS` is a closed ring. Degenerate (zero-length) and exact-duplicate segments are dropped.

- [ ] **Step 1: Write the failing test**

Paste in the console:

```js
(function(){
  const segs = [
    {x1:0,y1:0,x2:10,y2:0},      // square edges, shuffled
    {x1:10,y1:10,x2:0,y2:10},
    {x1:10,y1:0,x2:10,y2:10},
    {x1:0,y1:10,x2:0,y2:0},
    {x1:0,y1:0,x2:10,y2:0},      // duplicate edge -> deduped
    {x1:5,y1:5,x2:5,y2:5},       // degenerate -> dropped
    {x1:20,y1:20,x2:30,y2:20}    // disjoint -> own polyline
  ];
  const pl = mergeSegments(segs);
  const closed = pl.filter(p => Math.abs(p[0].x-p[p.length-1].x)<0.05 && Math.abs(p[0].y-p[p.length-1].y)<0.05);
  const ok = pl.length===2 && closed.length===1 && closed[0].length===5;
  return ok ? 'PASS' : 'FAIL '+JSON.stringify(pl.map(p=>p.length));
})();
```

- [ ] **Step 2: Run test to verify it fails**

Expected: `Uncaught ReferenceError: mergeSegments is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add above `function exportSVG()` in `index.html`:

```js
// --- Plotter optimization (lossless: only path structure + order change) ---
const OPT_EPS = 0.1;
function optKey(x, y) { return Math.round(x / OPT_EPS) + ',' + Math.round(y / OPT_EPS); }

// Merge line segments that share endpoints into polylines; drop degenerate + exact-duplicate segments.
// segs: [{x1,y1,x2,y2}] -> [[{x,y},...], ...]. A polyline with coincident ends is a closed ring.
function mergeSegments(segs) {
  const seen = new Set();            // dedupe by unordered endpoint-key pair
  const nodes = new Map();           // key -> {x,y, edges:[edgeIndex]}
  const edges = [];                  // {a:key, b:key, used:false}
  function node(x, y) {
    const k = optKey(x, y);
    if (!nodes.has(k)) nodes.set(k, { x, y, edges: [] });
    return k;
  }
  for (const s of segs) {
    const ka = optKey(s.x1, s.y1), kb = optKey(s.x2, s.y2);
    if (ka === kb) continue;                                   // degenerate
    const pair = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (seen.has(pair)) continue;                              // exact duplicate
    seen.add(pair);
    const a = node(s.x1, s.y1), b = node(s.x2, s.y2);
    const ei = edges.length;
    edges.push({ a, b, used: false });
    nodes.get(a).edges.push(ei);
    nodes.get(b).edges.push(ei);
  }
  function extend(chain, endKey, forward) {
    while (true) {
      const nd = nodes.get(endKey);
      const next = nd.edges.find(ei => !edges[ei].used);
      if (next === undefined) break;
      edges[next].used = true;
      const e = edges[next];
      const otherKey = e.a === endKey ? e.b : e.a;
      const otherNode = nodes.get(otherKey);
      if (forward) chain.push(otherNode); else chain.unshift(otherNode);
      endKey = otherKey;
    }
  }
  const polylines = [];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    edges[i].used = true;
    const e = edges[i];
    const chain = [nodes.get(e.a), nodes.get(e.b)];
    extend(chain, e.b, true);        // walk forward
    extend(chain, e.a, false);       // walk backward
    polylines.push(chain.map(n => ({ x: n.x, y: n.y })));
  }
  return polylines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Reload `http://localhost:4600`, paste the Step-1 snippet. Expected: `PASS`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: mergeSegments — merge shared-endpoint segments + dedupe (plotter opt)"
```

---

### Task 2: Travel-sort + travel estimate

**Files:**
- Modify: `index.html` — add below `mergeSegments`.

**Interfaces:**
- Consumes: `OPT_EPS` (Task 1).
- Produces:
  - `function dist2(ax, ay, bx, by)` → number (squared distance).
  - `function travelSort(items)` where `items: [{pts:[{x,y}], closed:bool} | {dot:{x,y}, r}]` → same array reordered greedily nearest-neighbor from (0,0); open polylines are reversed in place to start at the nearer end; closed polylines are rotated to start at the vertex nearest the pen.
  - `function estimateTravel(items)` → number — total pen-up distance for `items` in their current order (pen from (0,0), moving to each item's start, jumping from each item's end to the next item's start).

- [ ] **Step 1: Write the failing test**

```js
(function(){
  const items = [
    {pts:[{x:100,y:0},{x:110,y:0}], closed:false},   // far
    {pts:[{x:10,y:0},{x:0,y:0}], closed:false},       // near origin, but reversed
    {dot:{x:5,y:0}}
  ];
  const before = estimateTravel(items);
  const sorted = travelSort(items.slice());
  const after = estimateTravel(sorted);
  const first = sorted[0];
  // nearest to (0,0) is the second polyline; it should be flipped to start at x:0
  const flippedStart = !first.dot && first.pts[0].x === 0;
  const order = sorted.map(it => it.dot ? 'dot' : it.pts[0].x + '>' + it.pts[it.pts.length-1].x);
  const ok = flippedStart && after <= before && sorted.length === 3;
  return ok ? ('PASS before='+before.toFixed(1)+' after='+after.toFixed(1)+' order='+JSON.stringify(order))
            : ('FAIL order='+JSON.stringify(order)+' before='+before+' after='+after);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Expected: `Uncaught ReferenceError: estimateTravel is not defined` (or `travelSort`).

- [ ] **Step 3: Write minimal implementation**

```js
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// Greedy nearest-neighbor ordering from (0,0). Flips open polylines to start at the nearer end;
// rotates closed polylines to start at the vertex nearest the pen. Reorders in place-ish, returns array.
function travelSort(items) {
  const remaining = items.slice();
  const out = [];
  let px = 0, py = 0;
  while (remaining.length) {
    let best = -1, bestD = Infinity, bestFlip = false;
    for (let i = 0; i < remaining.length; i++) {
      const it = remaining[i];
      if (it.dot) {
        const d = dist2(px, py, it.dot.x, it.dot.y);
        if (d < bestD) { bestD = d; best = i; bestFlip = false; }
      } else if (it.closed) {
        for (const p of it.pts) { const d = dist2(px, py, p.x, p.y); if (d < bestD) { bestD = d; best = i; bestFlip = false; } }
      } else {
        const a = it.pts[0], b = it.pts[it.pts.length - 1];
        const da = dist2(px, py, a.x, a.y), db = dist2(px, py, b.x, b.y);
        const d = Math.min(da, db);
        if (d < bestD) { bestD = d; best = i; bestFlip = db < da; }
      }
    }
    const it = remaining.splice(best, 1)[0];
    if (it.dot) {
      out.push(it); px = it.dot.x; py = it.dot.y;
    } else if (it.closed) {
      // rotate loop to start at the vertex nearest the pen
      let bi = 0, bd = Infinity;
      for (let j = 0; j < it.pts.length; j++) { const d = dist2(px, py, it.pts[j].x, it.pts[j].y); if (d < bd) { bd = d; bi = j; } }
      // pts is a closed ring stored WITHOUT a duplicate trailing point here
      it.pts = it.pts.slice(bi).concat(it.pts.slice(0, bi));
      out.push(it);
      px = it.pts[0].x; py = it.pts[0].y;   // pen returns to loop start
    } else {
      if (bestFlip) it.pts.reverse();
      out.push(it);
      const last = it.pts[it.pts.length - 1]; px = last.x; py = last.y;
    }
  }
  return out;
}

function estimateTravel(items) {
  let px = 0, py = 0, total = 0;
  for (const it of items) {
    if (it.dot) { total += Math.hypot(px - it.dot.x, py - it.dot.y); px = it.dot.x; py = it.dot.y; }
    else {
      const a = it.pts[0], b = it.pts[it.pts.length - 1];
      total += Math.hypot(px - a.x, py - a.y);
      if (it.closed) { px = a.x; py = a.y; } else { px = b.x; py = b.y; }
    }
  }
  return total;
}
```

Note: closed rings are passed to `travelSort` **without** a duplicated trailing point (Task 3 strips it); rotation therefore never desyncs a duplicate.

- [ ] **Step 4: Run test to verify it passes**

Reload, paste Step-1 snippet. Expected: `PASS` with `after <= before` and the first item flipped to start at `x:0`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: travelSort + estimateTravel — greedy pen-up minimization"
```

---

### Task 3: buildOptimizedSVG + exportOptimizedSVG + button

**Files:**
- Modify: `index.html` — add `buildOptimizedSVG()` and `exportOptimizedSVG()` below `travelSort`; add the button next to the existing Export SVG button (near line 204, `<button onclick="exportSVG()">Export SVG</button>`).

**Interfaces:**
- Consumes: `mergeSegments`, `travelSort`, `estimateTravel`, `optKey`, `OPT_EPS`, `OPT_MAX_SORT`; globals `svgContent`, `width`, `height`, `document.getElementById('bgColor')`, `document.getElementById('strokeW')`.
- Produces:
  - `function buildOptimizedSVG()` → string (the full optimized SVG document) or `null` if `svgContent` is empty. Logs raw-element vs optimized-path counts and travel before/after.
  - `function exportOptimizedSVG()` → void — builds and downloads `Redaction_plotter_optimized_${Date.now()}.svg`; if build returns `null`, warns and downloads nothing.

- [ ] **Step 1: Write the failing test**

```js
(function(){
  regenerate();                                   // populate shapes + svgContent
  document.getElementById('fillStyle').value = 'contour';  // ensure line-heavy fill
  renderOnly();
  const svg = buildOptimizedSVG();
  const layers   = (svg.match(/<g stroke=/g) || []).length;
  const polys    = (svg.match(/<polyline|<polygon/g) || []).length;
  const rawLines = (svg.match(/<line /g) || []).length;
  // lossless point-set check: every quantized point in raw svgContent appears in the optimized SVG
  const raw = new Set();
  for (const it of svgContent) {
    if (it.type === 'line') { raw.add(optKey(it.x1,it.y1)); raw.add(optKey(it.x2,it.y2)); }
    else if (it.type === 'polygon') { for (const p of it.points) raw.add(optKey(p.x,p.y)); }
    else if (it.type === 'circle') { raw.add(optKey(it.cx,it.cy)); }
  }
  const nums = svg.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const opt = new Set();
  // walk coordinate pairs inside points="" and cx/cy — approximate by scanning all pairs
  const coordRe = /(?:points="([^"]+)")|(?:cx="(-?[\d.]+)"\s+cy="(-?[\d.]+)")/g;
  let m; while ((m = coordRe.exec(svg))) {
    if (m[1]) { const ps = m[1].trim().split(/\s+/); for (const p of ps) { const [x,y]=p.split(',').map(Number); opt.add(optKey(x,y)); } }
    else { opt.add(optKey(Number(m[2]), Number(m[3]))); }
  }
  let missing = 0; raw.forEach(k => { if (!opt.has(k)) missing++; });
  const ok = svg.includes('<svg') && layers >= 1 && polys > 0 && rawLines === 0 && missing === 0;
  return ok ? ('PASS layers='+layers+' paths='+polys+' rawPts='+raw.size)
            : ('FAIL layers='+layers+' paths='+polys+' <line>='+rawLines+' missingPts='+missing);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Expected: `Uncaught ReferenceError: buildOptimizedSVG is not defined`.

- [ ] **Step 3: Write minimal implementation**

Add the constant near `OPT_EPS`:

```js
const OPT_MAX_SORT = 20000;   // per-layer item cap above which travel-sort is skipped
```

Add below `estimateTravel`:

```js
// Build the optimized SVG string (merge + dedupe + travel-sort, per color layer). Returns null if nothing to export.
function buildOptimizedSVG() {
  if (!svgContent.length) { console.warn('Optimized SVG: nothing rendered yet'); return null; }
  const sw = parseFloat(document.getElementById('strokeW').value);
  const bg = document.getElementById('bgColor').value;

  // group by pen color
  const byColor = {};
  for (const item of svgContent) { (byColor[item.color] || (byColor[item.color] = [])).push(item); }

  let body = '';
  let rawCount = 0, pathCount = 0, travBefore = 0, travAfter = 0;

  for (const color in byColor) {
    const group = byColor[color];
    rawCount += group.length;

    // 1) merge line segments into polylines
    const segs = group.filter(g => g.type === 'line').map(g => ({ x1:g.x1, y1:g.y1, x2:g.x2, y2:g.y2 }));
    const merged = mergeSegments(segs);

    // build the item list: merged polylines (+ closed rings), passthrough polygons, dots
    const items = [];
    for (const pl of merged) {
      const closed = pl.length > 2 && Math.abs(pl[0].x - pl[pl.length-1].x) < OPT_EPS && Math.abs(pl[0].y - pl[pl.length-1].y) < OPT_EPS;
      items.push({ pts: closed ? pl.slice(0, -1) : pl, closed });   // strip duplicate trailing point on closed rings
    }
    for (const g of group) {
      if (g.type === 'polygon') items.push({ pts: g.points.map(p => ({ x:p.x, y:p.y })), closed: true });
      else if (g.type === 'circle') items.push({ dot: { x:g.cx, y:g.cy }, r:g.r });
    }

    // 2) travel-sort (skip for oversized layers)
    travBefore += estimateTravel(items);
    const ordered = items.length <= OPT_MAX_SORT ? travelSort(items) : (console.warn('Optimized SVG: layer '+color+' has '+items.length+' items > cap; skipping sort'), items);
    travAfter += estimateTravel(ordered);

    // 3) emit
    body += `    <g stroke="${color}" stroke-width="${sw}">\n`;
    for (const it of ordered) {
      if (it.dot) { body += `      <circle cx="${it.dot.x.toFixed(2)}" cy="${it.dot.y.toFixed(2)}" r="${it.r.toFixed(2)}" fill="${color}"/>\n`; pathCount++; }
      else {
        const pts = it.pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
        body += it.closed ? `      <polygon points="${pts}"/>\n` : `      <polyline points="${pts}"/>\n`;
        pathCount++;
      }
    }
    body += `    </g>\n`;
  }

  console.log('Optimized SVG: ' + rawCount + ' raw elements -> ' + pathCount + ' paths; pen-up travel ' +
              Math.round(travBefore) + ' -> ' + Math.round(travAfter) + ' (' +
              (travBefore > 0 ? Math.round(100 * (1 - travAfter / travBefore)) : 0) + '% less)');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>Redaction - Plotter Export (optimized)</title>
  <desc>Generated with p5.js for pen plotter; merged + travel-sorted</desc>
  <rect width="100%" height="100%" fill="${bg}"/>
  <g id="artwork" fill="none" stroke-linecap="round" stroke-linejoin="round">
${body}  </g>
</svg>`;
}

function exportOptimizedSVG() {
  const svg = buildOptimizedSVG();
  if (!svg) return;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Redaction_plotter_optimized_${Date.now()}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}
```

Add the button next to the existing one (after `<button onclick="exportSVG()">Export SVG</button>`):

```html
    <button onclick="exportOptimizedSVG()">Export SVG (optimized)</button>
```

- [ ] **Step 4: Run test to verify it passes**

Reload, paste the Step-1 snippet. Expected: `PASS layers=… paths=… rawPts=…`, with `<line>=0` and `missingPts=0` (lossless).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: exportOptimizedSVG + button — optimized plotter export"
```

---

### Task 4: Docs + multi-fill verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`.

**Interfaces:** none (docs + verification only).

- [ ] **Step 1: Multi-fill soak (browser)**

For each fill style, confirm the optimized build succeeds, drops `<line>`s, and stays lossless. Paste:

```js
(function(){
  const styles = ['hatch','cross','contour','scribble','stipple'];
  const rows = [];
  for (const st of styles) {
    document.getElementById('fillStyle').value = st; renderOnly();
    const svg = buildOptimizedSVG();
    const raw = new Set();
    for (const it of svgContent) {
      if (it.type==='line'){raw.add(optKey(it.x1,it.y1));raw.add(optKey(it.x2,it.y2));}
      else if (it.type==='polygon'){for(const p of it.points)raw.add(optKey(p.x,p.y));}
      else if (it.type==='circle'){raw.add(optKey(it.cx,it.cy));}
    }
    const opt = new Set(); const re=/(?:points="([^"]+)")|(?:cx="(-?[\d.]+)"\s+cy="(-?[\d.]+)")/g; let m;
    while((m=re.exec(svg))){ if(m[1]){for(const p of m[1].trim().split(/\s+/)){const[x,y]=p.split(',').map(Number);opt.add(optKey(x,y));}} else opt.add(optKey(+m[2],+m[3])); }
    let missing=0; raw.forEach(k=>{if(!opt.has(k))missing++;});
    rows.push(st+': lines='+((svg.match(/<line /g)||[]).length)+' paths='+((svg.match(/<polyline|<polygon|<circle/g)||[]).length)+' missing='+missing);
  }
  const ok = rows.every(r => r.includes('lines=0') && r.includes('missing=0'));
  return (ok?'PASS\n':'FAIL\n')+rows.join('\n');
})();
```

Expected: `PASS` with every style `lines=0 missing=0`.

- [ ] **Step 2: Visual lossless spot-check**

Export raw (`Export SVG`) and optimized (`Export SVG (optimized)`) for the same seed; open both files in a browser and in Inkscape. Confirm the drawing is visually identical and the optimized file opens with no errors. (Manual — record "confirmed" in the commit.)

- [ ] **Step 3: Update docs**

In `README.md`, under the export description, add:

```markdown
### Optimized export

**Export SVG (optimized)** produces the same drawing tuned for pen plotters: coincident line
segments are merged into polylines, exact-overlap duplicates are removed, and paths are travel-
sorted per pen-color layer to minimize pen-up motion. It is **lossless** — identical ink on paper,
only the path structure and draw order change. The console logs the element-count and pen-up-travel
reduction. Use the plain **Export SVG** if you want the raw, unmerged paths for editing.
```

In `CLAUDE.md`, under `### SVG export`, add:

```markdown
`exportOptimizedSVG()` (via `buildOptimizedSVG()`) is a second, lossless export for plotting:
`mergeSegments()` chains shared-endpoint fill segments into polylines and dedupes exact overlaps,
`travelSort()` greedily orders paths/points to cut pen-up travel, all per pen-color layer. Invariant:
only path structure and order change — the optimized SVG's quantized point set equals the raw
export's. `OPT_EPS` (0.1px) is the shared merge/dedupe tolerance; layers over `OPT_MAX_SORT` (20000)
skip the sort to stay responsive.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document optimized SVG plotter export"
```

---

## Self-Review

**Spec coverage:**
- Merge (Pass 1) → Task 1. Dedupe (Pass 2, folded into merge) → Task 1. Travel-sort (Pass 3) → Task 2. Output format + per-color layers + button → Task 3. Lossless invariant → asserted in Task 3 & Task 4 point-set checks. Empty-export guard, safety cap → Task 3. Verification (browser, multi-fill, Inkscape) → Task 4. Docs → Task 4. All spec sections covered.

**Placeholder scan:** No TBD/TODO; every code and test step has concrete content.

**Type consistency:** `mergeSegments(segs:[{x1,y1,x2,y2}]) -> [[{x,y}]]` used consistently; `travelSort`/`estimateTravel` operate on the `{pts,closed}` / `{dot,r}` item shape built in Task 3; `optKey`, `OPT_EPS`, `OPT_MAX_SORT` names consistent across tasks. Closed rings are stored without a trailing duplicate point in Task 3 before `travelSort`, matching the rotation logic's assumption noted in Task 2.
