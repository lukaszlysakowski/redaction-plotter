/* Web Serial plotter driver — no local server required.
   Chrome/Edge only (Web Serial API). Supports:
     - iDraw A3 writing robot (DrawCore/GRBL 1.1h)  USB 1A86:8040
     - AxiDraw (EiBotBoard / EBB)                   USB 04D8:FD92

   Usage:
     <script src="plotter-serial.js"></script>
     <script>SerialPlot.open(svgString);</script>

   The panel UI mirrors plot-button.js but communicates directly over USB serial
   instead of HTTP to plot_server.py. No server needed. */

(function () {
  'use strict';

  // ── constants ────────────────────────────────────────────────────────────────

  const PAPERS = {
    'letter': { label: 'Letter (8.5×11")', w: 215.9,  h: 279.4  },
    '11x17':  { label: '11×17"',           w: 279.4,  h: 431.8  },
    '12x18':  { label: '12×18"',           w: 304.8,  h: 457.2  },
    'a4':     { label: 'A4',               w: 210,    h: 297    },
    'a3':     { label: 'A3',               w: 297,    h: 420    },
  };

  const MACHINES = {
    // iDraw axis mapping: page_x = machine −Y (420 mm), page_y = machine −X (297 mm)
    // So G-code X = −page_y, G-code Y = −page_x (swapped + negated)
    idraw:   { label: 'iDraw A3',  baud: 115200, protocol: 'grbl', axisSwap: true  },
    axidraw: { label: 'AxiDraw',   baud: 115200, protocol: 'ebb',  axisSwap: false },
  };

  // iDraw geometry (from drawcore.py + driver):
  //   home = top-left of landscape sheet; page X = machine −Y (420 mm), page Y = machine −X (297 mm)
  //   feeds: rapid 9000 mm/min, draw 2400 mm/min; pen Z: up 0.5 mm, down 5 mm
  const IDRAW = {
    penUp:   0.5,   // mm Z
    penDown: 5.0,   // mm Z
    feedDraw: 2400, // mm/min
    feedRapid: 9000,
    stepsPerMm: 1,  // GRBL already works in mm
  };

  // AxiDraw/EBB geometry:
  //   2032 steps/inch = 80 steps/mm per axis; CoreXY: motor1 = X+Y, motor2 = X-Y
  const EBB = {
    stepsPerMm: 80,       // steps per mm on each axis
    penUpPos:   65,       // servo value for pen up (0–100 scale)
    penDownPos: 25,       // servo value for pen down
    speed:      20,       // % of max speed
    accel:      50,
  };

  const MARGIN_MM = 15;
  const DEFAULT_PAPER = '11x17';

  // ── state ────────────────────────────────────────────────────────────────────

  let panel = null;
  let port = null;
  let reader = null;
  let writer = null;
  let machine = 'idraw';
  let paper = DEFAULT_PAPER;
  let svgText = null;
  let paths = [];        // [{pts:[{x,y},...], color}]  — canvas units
  let transform = null;  // {ox, oy, scale, turned} — canvas→mm
  let state = 'disconnected'; // disconnected | idle | ready | plotting | paused | done | error
  let message = '';
  let stopRequested = false;
  let pauseRequested = false;
  let currentPathIdx = 0;
  let currentPtIdx = 0;
  let timer = null;
  let readBuffer = '';
  let plotPosX = 0; // tracked position in page-mm from home (G91 mode)
  let plotPosY = 0;
  let plotPosZ = 0; // tracked Z in mm (pen up/down accumulate in G91 mode)

  // ── CSS ─────────────────────────────────────────────────────────────────────

  const CSS = `
    #serialplot { position: fixed; top: 16px; right: 16px; width: 300px; max-height: calc(100vh - 32px);
      overflow-y: auto; z-index: 1000; box-sizing: border-box; padding: 14px;
      background: rgba(12,12,12,0.94); border: 1px solid #444; border-radius: 6px;
      font: 12px/1.5 monospace; color: #bbb; }
    #serialplot * { box-sizing: border-box; font: inherit; }
    #serialplot h3 { margin: 0; font-size: 13px; color: #eee; font-weight: normal; }
    #serialplot .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
    #serialplot .head { justify-content: space-between; margin-top: 0; }
    #serialplot label { color: #888; }
    #serialplot select { background: #1c1c1c; color: #ddd; border: 1px solid #555;
      border-radius: 4px; padding: 3px 6px; }
    #serialplot button { background: none; color: #bbb; border: 1px solid #555; border-radius: 4px;
      padding: 5px 10px; cursor: pointer; }
    #serialplot button:hover:not(:disabled) { border-color: #aaa; color: #eee; }
    #serialplot button:disabled { opacity: 0.35; cursor: default; }
    #serialplot button.go   { border-color: #4a4; color: #6c6; }
    #serialplot button.stop { border-color: #a44; color: #d66; }
    #serialplot .x  { border: none; padding: 0 4px; font-size: 16px; }
    #serialplot .msg { margin-top: 10px; color: #ddd; min-height: 18px; }
    #serialplot .msg.bad { color: #e77; }
    #serialplot .dot { width: 8px; height: 8px; border-radius: 50%; background: #a44; display: inline-block; }
    #serialplot .dot.on { background: #4a4; }
    #serialplot .sep { border-top: 1px solid #333; margin-top: 12px; padding-top: 2px; }
    #serialplot .prog { margin-top: 8px; height: 3px; background: #333; border-radius: 2px; }
    #serialplot .prog-bar { height: 100%; background: #4a4; border-radius: 2px; transition: width 0.3s; }`;

  // ── helpers ──────────────────────────────────────────────────────────────────

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props || {});
    (children || []).forEach(c => node.append(c));
    return node;
  }

  function button(label, cls, fn, disabled) {
    const b = el('button', { textContent: label, className: cls || '', disabled: !!disabled });
    b.onclick = fn;
    return b;
  }

  function setState(s, msg) {
    state = s;
    message = msg || '';
    render();
  }

  // ── SVG parsing ──────────────────────────────────────────────────────────────

  // Parse SVG (the optimized export from buildOptimizedSVG) into {color, pts[]} path lists.
  // Handles <polyline>, <polygon>, <path d="M…L…">.
  function parseSVG(svgStr) {
    const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
    const result = [];

    // Walk groups (each is one color layer)
    for (const g of doc.querySelectorAll('g[stroke]')) {
      const color = g.getAttribute('stroke');
      const groupPaths = [];

      for (const el of g.children) {
        const tag = el.tagName.toLowerCase();
        let pts = null;

        if (tag === 'polyline' || tag === 'polygon') {
          pts = el.getAttribute('points').trim().split(/[\s,]+/).reduce((acc, v, i, a) => {
            if (i % 2 === 0) acc.push({ x: parseFloat(v), y: parseFloat(a[i+1]) });
            return acc;
          }, []);
          if (tag === 'polygon' && pts.length) pts.push({ ...pts[0] }); // close
        } else if (tag === 'path') {
          pts = pathDToPts(el.getAttribute('d') || '');
        }

        if (pts && pts.length > 1) groupPaths.push({ color, pts });
      }
      result.push(...groupPaths);
    }
    return result;
  }

  function pathDToPts(d) {
    const pts = [];
    let cur = [0, 0];
    const re = /([MLC])([^MLC]*)/gi;
    let m;
    while ((m = re.exec(d)) !== null) {
      const cmd = m[1].toUpperCase();
      const nums = (m[2].match(/-?[\d.]+(?:e-?\d+)?/gi) || []).map(Number);
      if (cmd === 'M' || cmd === 'L') {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cur = [nums[i], nums[i+1]];
          if (cmd === 'M' && i === 0 && pts.length) { /* pen-up move: start new polyline */ }
          pts.push({ x: cur[0], y: cur[1] });
        }
      }
    }
    return pts;
  }

  // ── coordinate transform ─────────────────────────────────────────────────────

  // Compute the canvas→paper-mm transform that fits the canvas bounding box to
  // the paper with MARGIN_MM margin. Mirrors axiplot.fit_transform logic.
  function computeTransform(canvasW, canvasH, paperKey) {
    const p = PAPERS[paperKey] || PAPERS[DEFAULT_PAPER];
    const pw = p.w - 2 * MARGIN_MM;
    const ph = p.h - 2 * MARGIN_MM;

    // Try upright
    const su = Math.min(pw / canvasW, ph / canvasH);
    // Try turned 90°
    const st = Math.min(ph / canvasW, pw / canvasH);

    const turned = st > su;
    const scale = turned ? st : su;

    // Centre on paper (including margin)
    const fitW = canvasW * scale;
    const fitH = canvasH * scale;

    if (turned) {
      // Piece is rotated −90° on the sheet: canvas (x,y) → paper (mm):
      //   px = margin + (p.h - 2*margin - fitH)/2 + (canvasH - y)*scale
      //   py = margin + (p.w - 2*margin - fitW)/2 + x*scale
      return {
        turned, scale,
        ox: MARGIN_MM + (ph - fitH) / 2,
        oy: MARGIN_MM + (pw - fitW) / 2,
        canvasH,
      };
    } else {
      return {
        turned, scale,
        ox: MARGIN_MM + (pw - fitW) / 2,
        oy: MARGIN_MM + (ph - fitH) / 2,
      };
    }
  }

  function canvasToMm(pt, tf) {
    if (tf.turned) {
      return {
        x: tf.ox + (tf.canvasH - pt.y) * tf.scale,
        y: tf.oy + pt.x * tf.scale,
      };
    }
    return {
      x: tf.ox + pt.x * tf.scale,
      y: tf.oy + pt.y * tf.scale,
    };
  }

  // ── serial I/O ───────────────────────────────────────────────────────────────

  async function connect() {
    try {
      port = await navigator.serial.requestPort();
      const cfg = MACHINES[machine];
      await port.open({ baudRate: cfg.baud });
      writer = port.writable.getWriter();
      reader = port.readable.getReader();
      startReading();
      // Wake GRBL / check EBB — do NOT send $SLP here; it zeros position,
      // so it must only be sent once the carriage is physically at home.
      if (cfg.protocol === 'grbl') {
        await send('\r\n\r\n');      // soft-reset (clears alarm, no motion)
        await sleep(500);
      } else {
        await send('v\r');           // EBB version query
      }
      plotPosX = 0; plotPosY = 0; plotPosZ = 0;
      setState('idle', 'Move carriage to home corner (top-left), then click Start plot.');
    } catch (e) {
      setState('error', e.message === 'No port selected.' ? 'No port selected.' : `Connect failed: ${e.message}`);
    }
  }

  async function disconnect() {
    stopRequested = true;
    try {
      if (reader) { await reader.cancel(); reader.releaseLock(); reader = null; }
      if (writer) { writer.releaseLock(); writer = null; }
      if (port)   { await port.close(); port = null; }
    } catch (_) {}
    setState('disconnected', 'Disconnected.');
  }

  async function send(text) {
    if (!writer) return;
    await writer.write(new TextEncoder().encode(text));
  }

  function startReading() {
    (async () => {
      const dec = new TextDecoder();
      try {
        while (reader) {
          const { value, done } = await reader.read();
          if (done) break;
          readBuffer += dec.decode(value);
          processBuffer();
        }
      } catch (_) {}
    })();
  }

  function processBuffer() {
    // Responses are line-terminated; we just log them for now.
    // The plotting loop uses a command-per-ack model (see plotGRBL).
    let nl;
    while ((nl = readBuffer.indexOf('\n')) !== -1) {
      const line = readBuffer.slice(0, nl).trim();
      readBuffer = readBuffer.slice(nl + 1);
      if (line) onResponse(line);
    }
  }

  let _responseResolve = null;
  function onResponse(line) {
    // GRBL can emit [MSG:...] info lines before the actual ok/error response.
    // Skip them so they don't consume a pending waitForResponse slot.
    if (line.startsWith('[') || line.startsWith('<') || line === '') return;
    if (_responseResolve) {
      const r = _responseResolve;
      _responseResolve = null;
      r(line);
    }
  }

  function waitForResponse(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { _responseResolve = null; reject(new Error('Serial timeout')); }, timeout);
      _responseResolve = line => { clearTimeout(t); resolve(line); };
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── GRBL plotting (iDraw) ────────────────────────────────────────────────────

  async function plotGRBL() {
    const tf = computeTransform(svgW(), svgH(), paper);
    setState('plotting', 'Plotting…');
    stopRequested = false;
    pauseRequested = false;

    // Wake motors. Carriage must be physically at the home corner (top-left).
    // $SLP zeroes GRBL position counters to wherever the carriage is right now.
    await sendGRBL('$SLP\n');

    // Relative positioning mode + mm units.
    // Using G91 means every move is a delta from current position — no dependency
    // on GRBL's absolute coordinate origin, which varies by firmware/reset.
    await sendGRBL('G91\nG21\n');
    await sendGRBL(gPenUp());

    plotPosX = 0;
    plotPosY = 0;
    plotPosZ = 0;

    // Move to page-mm position (tx, ty) using a relative delta from current tracked pos.
    async function relMoveTo(tx, ty, type, feed) {
      const dx = tx - plotPosX;
      const dy = ty - plotPosY;
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
      plotPosX = tx;
      plotPosY = ty;
      await sendGRBL(gRelMotion(dx, dy, type, feed));
    }

    let total = paths.length, done = 0;

    for (let pi = 0; pi < paths.length; pi++) {
      if (stopRequested) break;
      while (pauseRequested && !stopRequested) await sleep(200);

      const path = paths[pi];
      if (!path.pts.length) continue;

      const first = canvasToMm(path.pts[0], tf);
      await sendGRBL(gPenUp());
      await relMoveTo(first.x, first.y, 'G0', IDRAW.feedRapid);
      await sendGRBL(gPenDown());

      for (let i = 1; i < path.pts.length; i++) {
        if (stopRequested) break;
        while (pauseRequested && !stopRequested) await sleep(200);
        const pt = canvasToMm(path.pts[i], tf);
        await relMoveTo(pt.x, pt.y, 'G1', IDRAW.feedDraw);
      }

      done++;
      currentPathIdx = pi;
      message = `Path ${done}/${total}`;
      render();
    }

    await sendGRBL(gPenUp());
    // Return to home by reversing accumulated position.
    if (Math.abs(plotPosX) > 0.001 || Math.abs(plotPosY) > 0.001) {
      await sendGRBL(gRelMotion(-plotPosX, -plotPosY, 'G0', IDRAW.feedRapid));
      plotPosX = 0;
      plotPosY = 0;
    }
    await sendGRBL('G90\n'); // back to absolute mode
    await sendGRBL('M5\n');

    setState(stopRequested ? 'ready' : 'done', stopRequested ? 'Cancelled.' : 'Plot finished.');
  }

  async function sendGRBL(cmd) {
    for (const line of cmd.split('\n').filter(l => l.trim())) {
      await send(line + '\n');
      const resp = await waitForResponse(15000);
      if (resp.toLowerCase().startsWith('error')) throw new Error(`GRBL: ${resp}`);
    }
  }

  // G91 mode: Z moves are relative, so track current Z and send only the delta.
  function gPenUp() {
    const dz = IDRAW.penUp - plotPosZ;
    plotPosZ = IDRAW.penUp;
    return Math.abs(dz) > 0.001 ? `G0 Z${dz.toFixed(3)} F${IDRAW.feedRapid}\n` : '';
  }
  function gPenDown() {
    const dz = IDRAW.penDown - plotPosZ;
    plotPosZ = IDRAW.penDown;
    return Math.abs(dz) > 0.001 ? `G0 Z${dz.toFixed(3)} F${IDRAW.feedRapid}\n` : '';
  }

  // Build a G0/G1 move command from a page-mm delta (dx, dy).
  // iDraw axis mapping: machine_X = −page_Y, machine_Y = −page_X
  function gRelMotion(dx, dy, type, feed) {
    const mx = MACHINES[machine].axisSwap ? -dy : dx;
    const my = MACHINES[machine].axisSwap ? -dx : dy;
    return `${type} X${mx.toFixed(3)} Y${my.toFixed(3)} F${feed}\n`;
  }

  // ── EBB plotting (AxiDraw) ───────────────────────────────────────────────────

  async function plotEBB() {
    // EBB (AxiDraw) plotting: convert mm positions to CoreXY stepper steps
    // Motor1 = X+Y, Motor2 = X-Y (in steps)
    const tf = computeTransform(svgW(), svgH(), paper);
    setState('plotting', 'Plotting…');
    stopRequested = false;

    const spm = EBB.stepsPerMm;
    let m1 = 0, m2 = 0; // current stepper positions

    // Enable motors
    await sendEBB('EM,1,1\r');
    // Pen up
    await sendEBB(`SP,1,100\r`);
    await sleep(300);

    async function moveTo(mmX, mmY) {
      const tgt1 = Math.round((mmX + mmY) * spm);
      const tgt2 = Math.round((mmX - mmY) * spm);
      const d1 = tgt1 - m1, d2 = tgt2 - m2;
      if (d1 === 0 && d2 === 0) return;
      const dist = Math.max(Math.abs(d1), Math.abs(d2));
      const speedPct = EBB.speed;
      const maxStepsPerSec = speedPct / 100 * 25000;
      const durationMs = Math.max(1, Math.round(dist / maxStepsPerSec * 1000));
      await sendEBB(`SM,${durationMs},${d1},${d2}\r`);
      m1 = tgt1; m2 = tgt2;
    }

    let total = paths.length, done = 0;

    for (let pi = 0; pi < paths.length; pi++) {
      if (stopRequested) break;
      const path = paths[pi];
      if (!path.pts.length) continue;
      const first = canvasToMm(path.pts[0], tf);
      await sendEBB('SP,1,100\r'); // pen up
      await sleep(200);
      await moveTo(first.x, first.y);
      await sendEBB('SP,0,100\r'); // pen down
      await sleep(200);
      for (let i = 1; i < path.pts.length; i++) {
        if (stopRequested) break;
        const pt = canvasToMm(path.pts[i], tf);
        await moveTo(pt.x, pt.y);
      }
      done++;
      message = `Path ${done}/${total}`;
      render();
    }

    await sendEBB('SP,1,100\r');
    await sleep(300);
    await moveTo(0, 0);
    await sendEBB('EM,0,0\r'); // motors off

    setState(stopRequested ? 'ready' : 'done', stopRequested ? 'Cancelled.' : 'Plot finished.');
  }

  async function sendEBB(cmd) {
    await send(cmd);
    await waitForResponse(10000);
  }

  // ── canvas dimensions from SVG ───────────────────────────────────────────────

  function svgW() {
    if (!svgText) return 1340;
    const m = svgText.match(/viewBox="0 0 ([\d.]+)/);
    return m ? parseFloat(m[1]) : 1340;
  }

  function svgH() {
    if (!svgText) return 2071;
    const m = svgText.match(/viewBox="0 0 [\d.]+ ([\d.]+)/);
    return m ? parseFloat(m[1]) : 2071;
  }

  // ── UI ───────────────────────────────────────────────────────────────────────

  function render() {
    if (!panel) return;
    const body = panel.querySelector('.body');
    body.replaceChildren();

    const connected = !!port;
    const active = state === 'plotting';
    panel.querySelector('.dot').className = 'dot' + (connected ? ' on' : '');

    // Machine selector
    const machSel = el('select', { disabled: active || connected });
    Object.entries(MACHINES).forEach(([id, m]) => {
      machSel.append(el('option', { value: id, textContent: m.label, selected: id === machine }));
    });
    machSel.onchange = () => { machine = machSel.value; };
    body.append(el('div', { className: 'row' }, [el('label', { textContent: 'Plotter' }), machSel]));

    // Paper selector
    const papSel = el('select', { disabled: active });
    Object.entries(PAPERS).forEach(([id, p]) => {
      papSel.append(el('option', { value: id, textContent: p.label, selected: id === paper }));
    });
    papSel.onchange = () => { paper = papSel.value; };
    body.append(el('div', { className: 'row' }, [el('label', { textContent: 'Paper' }), papSel]));

    // Connection
    if (!connected) {
      body.append(el('div', { className: 'row' }, [
        button('Connect USB', 'go', connect),
      ]));
    } else {
      body.append(el('div', { className: 'row' }, [
        button('Disconnect', '', disconnect, active),
      ]));
    }

    // Progress bar
    if (active && paths.length) {
      const done = paths.slice(0, currentPathIdx).length;
      const pct = Math.round(done / paths.length * 100);
      const bar = el('div', { className: 'prog' }, [el('div', { className: 'prog-bar', style: `width:${pct}%` })]);
      body.append(bar);
    }

    // Status message
    body.append(el('div', { className: 'msg' + (state === 'error' ? ' bad' : ''), textContent: message }));

    // Actions
    const acts = el('div', { className: 'row' });
    if (connected && svgText && ['idle', 'ready', 'done', 'error'].includes(state)) {
      acts.append(button(state === 'done' ? 'Plot again' : 'Start plot', 'go', startPlot));
    }
    if (state === 'plotting') {
      acts.append(button('Pause', 'stop', () => { pauseRequested = true; setState('paused', 'Paused.'); }));
      acts.append(button('Cancel', 'stop', () => { stopRequested = true; }));
    }
    if (state === 'paused') {
      acts.append(button('Resume', 'go', () => { pauseRequested = false; setState('plotting', 'Plotting…'); }));
      acts.append(button('Cancel', 'stop', () => { stopRequested = true; pauseRequested = false; }));
    }
    body.append(acts);

    // Pen setup
    if (connected && !active) {
      body.append(el('div', { className: 'row sep' }, [el('label', { textContent: 'Setup' })]));
      body.append(el('div', { className: 'row', style: 'margin-top:4px' }, [
        button('Pen up',      '', penUp),
        button('Pen down',    '', penDown),
        button('Return home', '', goHome),
      ]));
    }
  }

  async function startPlot() {
    if (!svgText || !port) return;
    paths = parseSVG(svgText);
    currentPathIdx = 0;
    state = 'plotting';
    try {
      if (MACHINES[machine].protocol === 'grbl') await plotGRBL();
      else await plotEBB();
    } catch (e) {
      setState('error', e.message);
    }
  }

  async function penUp() {
    try {
      if (MACHINES[machine].protocol === 'grbl') await sendGRBL(gPenUp());
      else { await sendEBB('SP,1,100\r'); }
    } catch (e) { setState('error', e.message); }
  }

  async function penDown() {
    try {
      if (MACHINES[machine].protocol === 'grbl') await sendGRBL(gPenDown());
      else { await sendEBB('SP,0,100\r'); }
    } catch (e) { setState('error', e.message); }
  }

  async function setHome() {
    // $SLP wakes the DrawCore motors and zeroes all position counters to the
    // current carriage position. Must be called with carriage at the home corner.
    try {
      await sendGRBL('$SLP\n');
      setState(state, 'Home set. Ready to plot.');
    } catch (e) { setState('error', e.message); }
  }

  async function goHome() {
    try {
      if (MACHINES[machine].protocol === 'grbl') {
        await sendGRBL(gPenUp());
        if (Math.abs(plotPosX) > 0.001 || Math.abs(plotPosY) > 0.001) {
          await sendGRBL(gRelMotion(-plotPosX, -plotPosY, 'G0', IDRAW.feedRapid));
          plotPosX = 0;
          plotPosY = 0;
        }
      } else {
        await sendEBB('SP,1,100\r');
        await sleep(300);
        await sendEBB('SM,2000,0,0\r');
      }
    } catch (e) { setState('error', e.message); }
  }

  function build() {
    document.head.append(el('style', { textContent: CSS }));
    const close = el('button', { className: 'x', textContent: '×', title: 'Close' });
    close.onclick = hide;
    panel = el('div', { id: 'serialplot' }, [
      el('div', { className: 'row head' }, [
        el('h3', {}, [el('span', { className: 'dot' }), el('span', { textContent: ' Serial Plotter' })]),
        close,
      ]),
      el('div', { className: 'body' }),
    ]);
    ['mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'keydown', 'keypress', 'keyup', 'wheel']
      .forEach(t => panel.addEventListener(t, e => e.stopPropagation()));
    document.body.append(panel);
  }

  function hide() {
    if (panel) panel.style.display = 'none';
  }

  function open(svg) {
    if (!('serial' in navigator)) {
      alert('Web Serial is not supported in this browser.\nUse Chrome or Edge.');
      return;
    }
    if (!panel) build();
    panel.style.display = '';
    svgText = svg;
    if (state === 'disconnected') message = 'Click Connect USB to begin.';
    else if (state === 'idle') message = 'Ready — click Start plot.';
    render();
  }

  function attach(config) {
    const btn = typeof config.button === 'string' ? document.querySelector(config.button) : config.button;
    btn.addEventListener('click', () => open(config.getSVG()));
  }

  window.SerialPlot = { open, attach, hide };
})();
