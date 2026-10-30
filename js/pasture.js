(function () {
  'use strict';
  // SHEEP GATES (a lobby option), client side: the fenced pasture around the board, the wooden gates set
  // into the board's frame, the sheep waiting behind them, the wooden sign counting down the rounds and the
  // hops of the sheep on the board. Where the gates are, when they open and where the sheep go is decided by
  // the shared rules (BC.Board.gateSpots, logic.js); the sheep hops arrive here as 'sheepIn'/'sheepHop' events.
  const BC = window.BC;
  const u = BC.u;
  const R = BC.Render;
  const P = {};
  const WOOD = { ink: '#2a1608', dark: '#6b4220', mid: '#a0682c', light: '#d49a52' };
  const OPEN_T = 0.7;     // the gate swings open
  const IN_DELAY = 0.6;   // the first sheep waits for the gate to open before it jumps
  const IN_T = 0.6;       // the jump through the gate onto the board
  const HOP_T = 0.32;     // a step on the board
  const REFILL_T = 2.4;   // the next sheep turns up at the gate
  const SWING = 135 * Math.PI / 180;

  P.fresh = () => ({ init: false, openAt: null, hops: new Map(), lastIn: [] });

  const pieceScaleFor = cellPx => Math.max(1, Math.round(cellPx * 0.8 / 14));
  // the sheep waiting outside the gates are a touch smaller than the pieces on the boards with big squares
  const waitScale = ps => (ps > 3 ? ps - 1 : ps);
  const penDist = (g, cellPx, k) => (g.inner ? cellPx * 1.3 : 14 * k * 0.55 + 4);

  // does every waiting sheep fit inside the board box with the board placed at { unit, ox, oy }?
  P.fits = function (board, f) {
    const box = BC.BOARD_BOX;
    const area = board.cells.reduce((a, c) => a + c.area, 0) / board.cells.length;
    const cellPx = Math.sqrt(area) * f.unit;
    const k = waitScale(pieceScaleFor(cellPx)), w = 14 * k;
    return BC.Board.gateSpots(board).every(g => {
      const d = penDist(g, cellPx, k);
      const x = f.ox + g.v[0] * f.unit + g.out[0] * d, y = f.oy + g.v[1] * f.unit + g.out[1] * d;
      return x - w * 0.55 >= box.x + 4 && x + w * 0.55 <= box.x + box.w - 4 && y - w * 0.7 >= box.y + 4 && y + w * 0.5 <= box.y + box.h - 4;
    });
  };

  // ------------------------------------------------------------------ pixel sprites
  const SPR = {
    hay: {
      p: 2, pal: { k: WOOD.ink, y: '#e8c050', Y: '#b8902c', b: '#8a2c1c', d: '#a07a28' },
      rows: [
        '..kkkkkkkkkk..',
        '.kyyyYyyyyYyk.',
        'kyyYyyyyyyyYyk',
        'kyyyyyYyyyyyyk',
        'kbbbbbbbbbbbbk',
        'kyyYyyyyyyYyyk',
        'kyyyyyyYyyyyyk',
        'kyYyyyyyyyYyyk',
        '.kddddddddddk.',
        '..kkkkkkkkkk..',
      ],
    },
    trough: {
      p: 2, pal: { k: WOOD.ink, w: WOOD.mid, W: WOOD.light, b: '#3fa0ff', B: '#9fe8ff', d: WOOD.dark },
      rows: [
        'kkkkkkkkkkkkkkkk',
        'kWWWWWWWWWWWWWWk',
        'kwbbbbbbbbbbbbwk',
        'kwbBBbbbbbBbbbwk',
        'kwwwwwwwwwwwwwwk',
        'kddddddddddddddk',
        '.kdk........kdk.',
        '.kkk........kkk.',
      ],
    },
    rock: {
      p: 2, pal: { k: '#2a2430', g: '#8c8c94', G: '#c4c4cc', d: '#5a5560' },
      rows: ['.kkkk.', 'kGggdk', 'kgggdk', '.kkkk.'],
    },
    shroom: {
      p: 2, pal: { k: '#2a1608', r: '#e8313c', w: '#fff' },
      rows: ['.kkk.', 'krwrk', 'kkkkk', '.kwk.', '.kkk.'],
    },
    tuft: { p: 2, pal: { g: '#2d6e22', G: '#7fd04a' }, rows: ['G...G', '.G.G.', 'gGgGg'] },
  };
  const FLOWER_COLS = ['#ffffff', '#ffe14a', '#ff9ab8', '#9fe8ff', '#ff7a3c'];

  function sprite(g, s, x, y, pal) {
    pal = pal || s.pal;
    s.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const col = pal[row[rx]];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(Math.round(x) + rx * s.p, Math.round(y) + ry * s.p, s.p, s.p);
      }
    });
  }

  // small deterministic PRNG: the meadow looks the same every time this board is laid out
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ layout
  P.layout = function (board) {
    const box = BC.BOARD_BOX;
    const S = p => [board.ox + p[0] * board.unit, board.oy + p[1] * board.unit];
    const k = waitScale(board.pieceScale);
    board.waitScale = k;
    board.gateView = BC.Board.gateSpots(board).map(g => {
      const [vx, vy] = S(g.v);
      const d = penDist(g, board.cellPx, k);
      const pen = [vx + g.out[0] * d, vy + g.out[1] * d];
      // the inner pens of the cross board are roomy enough for a second sheep, grazing further back
      const px = -g.out[1], py = g.out[0];
      const buddy = g.inner ? [vx + g.out[0] * board.cellPx * 2.45 + px * board.cellPx * 0.45, vy + g.out[1] * board.cellPx * 2.45 + py * board.cellPx * 0.45] : null;
      return {
        vx, vy, out: g.out, pen, buddy, flip: g.out[0] < -0.1,
        leaves: g.leaves.map(l => { const h = S(l.h); return { hx: h[0], hy: h[1], len: l.len * board.unit, a0: l.a0, turn: l.turn }; }),
      };
    });
    board.pasture = buildMeadow(board, box);
  };

  function buildMeadow(board, box) {
    const A = BC.Assets;
    const [cv, g] = A.canvas(box.w, box.h);
    const W = box.w, H = box.h;
    const rand = rng(board.n * 7919 + 17);
    const sheepW = 14 * board.waitScale;

    // the meadow, with mown stripes and a darker rim
    g.save();
    g.beginPath();
    g.rect(3, 3, W - 6, H - 6);
    g.clip();
    g.fillStyle = '#3c8a34';
    g.fillRect(0, 0, W, H);
    if (A.ok.sheet) {
      g.globalAlpha = 0.45;
      g.fillStyle = A.patterns(g, Math.max(1, board.sprScale - 1)).grass;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(255,255,160,0.05)';
    for (let x = 0; x < W; x += 72) g.fillRect(x, 0, 36, H);
    const vg = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,20,0,0)');
    vg.addColorStop(1, 'rgba(0,20,0,0.35)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    g.restore();
    g.strokeStyle = '#0a0618';
    g.lineWidth = 4;
    g.strokeRect(2, 2, W - 4, H - 4);

    // worn dirt where the sheep wait and run through the gates
    board.gateView.forEach(gv => {
      const mx = (gv.pen[0] + gv.vx) / 2 - box.x, my = (gv.pen[1] + gv.vy) / 2 - box.y;
      const len = Math.hypot(gv.pen[0] - gv.vx, gv.pen[1] - gv.vy) / 2 + sheepW * 0.55;
      g.save();
      g.translate(mx, my);
      g.rotate(Math.atan2(gv.out[1], gv.out[0]));
      g.fillStyle = '#7a5a34';
      g.beginPath(); g.ellipse(0, 0, len + 3, sheepW * 0.55 + 3, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9a7444';
      g.beginPath(); g.ellipse(0, 0, len, sheepW * 0.55, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 14; i++) {
        g.fillStyle = i % 2 ? '#b89464' : '#6e5230';
        g.fillRect(Math.round((rand() - 0.5) * len * 1.5), Math.round((rand() - 0.5) * sheepW * 0.8), 2, 2);
      }
      g.restore();
    });

    // where the decorations can't go: the board and its frame, the gates and the sheep waiting there
    const [mc, mg] = A.canvas(W, H);
    mg.translate(-box.x, -box.y);
    mg.fillStyle = '#000';
    mg.strokeStyle = '#000';
    board.cells.forEach(c => mg.fill(c.path));
    mg.lineWidth = 34;
    mg.lineCap = 'round';
    mg.lineJoin = 'round';
    mg.stroke(board.frame);
    board.gateView.forEach(gv => {
      [[gv.pen, sheepW * 0.85 + 6], [[gv.vx, gv.vy], board.cellPx * 0.9], [gv.buddy, sheepW * 0.85 + 6]].forEach(([p, r]) => {
        if (!p) return;
        mg.beginPath(); mg.arc(p[0], p[1], r, 0, Math.PI * 2); mg.fill();
      });
    });
    const mask = mg.getImageData(0, 0, W, H).data;
    const blocked = (x, y) => x < 0 || y < 0 || x >= W || y >= H || mask[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 0;
    const placed = [];
    const fits = (x, y, hw, hh) => {
      if (x - hw < 18 || x + hw > W - 18 || y - hh < 30 || y + hh > H - 12) return false;
      for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (blocked(x + dx * (hw + 3), y + dy * (hh + 3))) return false;
      }
      return placed.every(q => Math.abs(q.x - x) > q.hw + hw + 3 || Math.abs(q.y - y) > q.hh + hh + 3);
    };
    const scatter = (count, tries, size, draw) => {
      for (let i = 0, n = 0; i < tries && n < count; i++) {
        const x = 10 + rand() * (W - 20), y = 10 + rand() * (H - 20);
        const [hw, hh] = size;
        if (!fits(x, y, hw, hh)) continue;
        placed.push({ x, y, hw, hh, draw });
        n++;
      }
    };
    const spr = s => [s.rows[0].length * s.p / 2, s.rows.length * s.p / 2];
    scatter(3, 400, spr(SPR.hay), (x, y) => drawShadowed(g, SPR.hay, x, y));
    scatter(1, 400, spr(SPR.trough), (x, y) => drawShadowed(g, SPR.trough, x, y));
    scatter(4, 300, spr(SPR.rock), (x, y) => sprite(g, SPR.rock, x - 6, y - 4));
    scatter(3, 300, spr(SPR.shroom), (x, y) => sprite(g, SPR.shroom, x - 5, y - 5));
    scatter(46, 900, spr(SPR.tuft), (x, y) => sprite(g, SPR.tuft, x - 5, y - 3));
    scatter(40, 900, [3, 4], (x, y) => {
      const col = FLOWER_COLS[Math.floor(rand() * FLOWER_COLS.length)];
      g.fillStyle = '#2d6e22';
      g.fillRect(Math.round(x) - 1, Math.round(y), 2, 4);
      g.fillStyle = col;
      g.fillRect(Math.round(x) - 1, Math.round(y) - 4, 2, 2);
      g.fillRect(Math.round(x) - 3, Math.round(y) - 2, 2, 2);
      g.fillRect(Math.round(x) + 1, Math.round(y) - 2, 2, 2);
      g.fillStyle = col === '#ffe14a' ? '#ff7a3c' : '#ffe14a';
      g.fillRect(Math.round(x) - 1, Math.round(y) - 2, 2, 2);
    });
    placed.sort((p, q) => p.y - q.y).forEach(q => q.draw(q.x, q.y));

    drawFence(g, W, H);
    return cv;
  }

  function drawShadowed(g, s, x, y) {
    const w = s.rows[0].length * s.p, h = s.rows.length * s.p;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(x, y + h / 2, w * 0.55, h * 0.18, 0, 0, Math.PI * 2); g.fill();
    sprite(g, s, x - w / 2, y - h / 2);
  }

  // ------------------------------------------------------------------ fence round the pasture
  function fencePost(g, x, y) {
    const w = 8, h = 18;
    x = Math.round(x - w / 2); y = Math.round(y);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x - 1, y - 2, w + 4, 4);
    g.fillStyle = WOOD.ink;
    g.fillRect(x - 1, y - h - 1, w + 2, h + 2);
    g.fillStyle = WOOD.mid;
    g.fillRect(x, y - h, w, h);
    g.fillStyle = WOOD.dark;
    g.fillRect(x + w / 2, y - h + 2, w / 2, h - 2);
    g.fillStyle = WOOD.light;
    g.fillRect(x, y - h, w, 2);
  }

  function fenceRail(g, x0, y0, x1, y1, t) {
    g.fillStyle = WOOD.ink;
    g.fillRect(Math.round(Math.min(x0, x1)) - 1, Math.round(Math.min(y0, y1)) - 1, Math.round(Math.abs(x1 - x0)) + t + 2, Math.round(Math.abs(y1 - y0)) + t + 2);
    g.fillStyle = WOOD.mid;
    g.fillRect(Math.round(Math.min(x0, x1)), Math.round(Math.min(y0, y1)), Math.round(Math.abs(x1 - x0)) + t, Math.round(Math.abs(y1 - y0)) + t);
    g.fillStyle = WOOD.light;
    g.fillRect(Math.round(Math.min(x0, x1)), Math.round(Math.min(y0, y1)), Math.round(Math.abs(x1 - x0)) + t, 1);
  }

  function drawFence(g, W, H) {
    const left = 12, right = W - 12, top = 26, bottom = H - 6;
    const xs = [], ys = [];
    const nx = Math.round((right - left) / 46), ny = Math.round((bottom - top) / 46);
    for (let i = 0; i <= nx; i++) xs.push(left + (right - left) * i / nx);
    for (let i = 0; i <= ny; i++) ys.push(top + (bottom - top) * i / ny);
    // the far side first, then the sides, then the near side
    fenceRail(g, left, top - 14, right, top - 14, 3);
    fenceRail(g, left, top - 7, right, top - 7, 3);
    xs.forEach(x => fencePost(g, x, top));
    [left, right].forEach(x => {
      fenceRail(g, x - 2, top - 14, x - 2, bottom - 10, 4);
      ys.slice(1, -1).forEach(y => fencePost(g, x, y));
    });
    fenceRail(g, left, bottom - 14, right, bottom - 14, 3);
    fenceRail(g, left, bottom - 7, right, bottom - 7, 3);
    xs.forEach(x => fencePost(g, x, bottom));
  }

  // ------------------------------------------------------------------ drawing
  P.drawGround = function (G) {
    const board = G.board;
    if (!board.pasture) return;
    const ctx = R.ctx, box = BC.BOARD_BOX;
    ctx.drawImage(board.pasture, box.x, box.y);
    if (G.boardMode === 'bomber') {
      ctx.fillStyle = 'rgba(0,0,10,0.3)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
  };

  // how far the gates have swung open (0 shut .. 1 open); they open once, when the lobby's gate round starts
  function openK(G) {
    const st = G.pasture;
    const open = G.chessRound >= BC.gateRoundOf(G.cfg.gateRound);
    if (!st.init) { st.init = true; st.openAt = open ? -99 : null; }
    else if (open && st.openAt === null) st.openAt = G.time;
    if (st.openAt === null) return 0;
    const k = u.clamp((G.time - st.openAt) / OPEN_T, 0, 1);
    return u.easeOutBack(k);
  }

  // a wooden farm gate leaf standing on the ground from its hinge: rails, an end stile and a diagonal brace
  function drawLeaf(G, lf, k) {
    const ctx = R.ctx, cp = G.board.cellPx;
    const a = lf.a0 + lf.turn * k * SWING;
    const hx = lf.hx, hy = lf.hy;
    const tx = hx + Math.cos(a) * lf.len, ty = hy + Math.sin(a) * lf.len;
    const lh = cp * 0.42, rw = Math.max(2, Math.round(cp * 0.06));
    const bar = (x0, y0, x1, y1, w, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'square';
    bar(hx, hy, tx, ty, rw + 2, 'rgba(0,0,0,0.28)');
    const parts = [
      [hx, hy - lh * 0.15, tx, ty - lh * 0.15],
      [hx, hy - lh * 0.55, tx, ty - lh * 0.55],
      [hx, hy - lh, tx, ty - lh],
      [tx, ty - lh * 0.1, tx, ty - lh],
      [hx, hy - lh * 0.15, tx, ty - lh],
    ];
    parts.forEach(p => bar(p[0], p[1], p[2], p[3], rw + 2, WOOD.ink));
    parts.forEach((p, i) => bar(p[0], p[1], p[2], p[3], rw, i === 4 ? WOOD.dark : WOOD.mid));
    parts.slice(0, 3).forEach(p => bar(p[0], p[1] - rw / 2 + 0.5, p[2], p[3] - rw / 2 + 0.5, 1, WOOD.light));
    ctx.restore();
  }

  function drawPost(G, x, y) {
    const ctx = R.ctx, cp = G.board.cellPx;
    const w = Math.max(4, Math.round(cp * 0.13)), h = Math.round(cp * 0.42 + w);
    x = Math.round(x - w / 2); y = Math.round(y + w * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x + w / 2, y, w, w * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = WOOD.ink;
    ctx.fillRect(x - 1, y - h - 1, w + 2, h + 2);
    ctx.fillStyle = WOOD.mid;
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = WOOD.dark;
    ctx.fillRect(x + Math.ceil(w / 2), y - h + 2, Math.floor(w / 2), h - 2);
    ctx.fillStyle = WOOD.light;
    ctx.fillRect(x, y - h, w, 2);
  }

  // the sheep waiting at a gate grazes and looks about; after one has gone through, the next turns up
  function drawWaiting(G, gv, i, at, buddy) {
    const st = G.pasture;
    let alpha = 1;
    if (!buddy && st.lastIn[i] !== undefined) alpha = u.clamp((G.time - st.lastIn[i] - REFILL_T) / 0.5, 0, 1);
    if (alpha <= 0) return;
    const w = 14 * G.board.waitScale;
    const back = (1 - alpha) * w * 0.8;
    const x = at[0] + gv.out[0] * back, y = at[1] + gv.out[1] * back;
    const t = G.time + i * 2.31 + (buddy ? 5.7 : 0);
    const graze = t % 3.6 < 1.7;
    const eye = t % 3.1 < 0.12 ? 'shut' : 'open';
    const flip = buddy ? Math.floor(t / 4.7) % 2 === 1 : gv.flip;
    const hop = !graze && t % 3.6 > 3.3 ? Math.sin((t % 3.6 - 3.3) / 0.3 * Math.PI) * 4 : 0;
    BC.SpecialFx.drawSheep(G, x, y - hop, { ground: y, lift: 2, eye, flip, graze, alpha, k: G.board.waitScale, bell: !buddy });
  }

  // the gates, their posts and the sheep waiting behind them as { y, draw } items: the renderer sorts them in
  // with the pieces, sheep and bombers by where they stand on the ground (y), so whatever stands behind a gate
  // is drawn behind it
  P.gateItems = function (G) {
    const gvs = G.board.gateView;
    const items = [];
    if (!gvs || !G.pasture || !BC.SpecialFx) return items;
    const k = openK(G);
    gvs.forEach((gv, i) => {
      gv.leaves.forEach(lf => {
        const a = lf.a0 + lf.turn * k * SWING;
        items.push({ y: lf.hy + Math.sin(a) * lf.len * 0.5, draw: () => drawLeaf(G, lf, k) });
        items.push({ y: lf.hy + 0.01, draw: () => drawPost(G, lf.hx, lf.hy) });
      });
      items.push({ y: gv.pen[1], draw: () => drawWaiting(G, gv, i, gv.pen, false) });
      if (gv.buddy) items.push({ y: gv.buddy[1], draw: () => drawWaiting(G, gv, i, gv.buddy, true) });
      if (k < 0.05) {
        // the latch where the two leaves meet
        const s = Math.max(2, Math.round(G.board.cellPx * 0.06));
        items.push({
          y: gv.vy + 0.02, draw: () => {
            const ctx = R.ctx, z = G.board.cellPx * 0.42 * 0.55;
            ctx.fillStyle = '#140c1c';
            ctx.fillRect(Math.round(gv.vx - s - 1), Math.round(gv.vy - z - s - 1), s * 2 + 2, s * 2 + 2);
            ctx.fillStyle = '#c4c4cc';
            ctx.fillRect(Math.round(gv.vx - s), Math.round(gv.vy - z - s), s * 2, s * 2);
          },
        });
      }
    });
    return items;
  };

  // a wooden sign under the board: how many chess rounds until the gates open
  P.drawSign = function (G) {
    const board = G.board;
    if (!board.gateView || !BC.SpecialFx) return;
    const left = BC.gateRoundOf(G.cfg.gateRound) - (G.chessRound || 0);
    const text = left <= 0 ? 'SHEEP GATES OPEN' : 'SHEEP GATES OPEN ' + (left === 1 ? 'NEXT ROUND' : 'IN ' + left + ' ROUNDS');
    const ctx = R.ctx, box = BC.BOARD_BOX;
    const w = Math.round(R.measure(text, 8)) + 44, h = 20;
    const x = Math.round(box.x + box.w / 2 - w / 2);
    const y = Math.round(Math.min(BC.H - h - 4, board.oy + board.bounds.maxY * board.unit + 2));
    ctx.fillStyle = WOOD.ink;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = WOOD.mid;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = WOOD.light;
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = WOOD.dark;
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.fillStyle = 'rgba(60,30,10,0.4)';
    ctx.fillRect(x + 34, y + 5, Math.round(w * 0.3), 1);
    ctx.fillRect(x + Math.round(w * 0.55), y + 14, Math.round(w * 0.3), 1);
    ctx.fillStyle = '#d8d8e0';
    [[x + 3, y + 4], [x + w - 5, y + 4], [x + 3, y + h - 7], [x + w - 5, y + h - 7]].forEach(([nx, ny]) => ctx.fillRect(nx, ny, 2, 2));
    BC.SpecialFx.drawSheep(G, x + 20, y + 12, { ground: y + 12, lift: 1, eye: 'open', k: 1, bell: true, flip: true });
    const soon = left === 1 && Math.floor(G.time * 3) % 2 === 0;
    R.text(text, x + 32, y + 6, { size: 8, color: soon ? '#ffe14a' : '#fff3d0', shadowColor: 'rgba(42,22,8,0.9)' });
  };

  // the highest point (screen y) of the gates and their waiting sheep between x0 and x1, or null if there are
  // none there: the turn's nameplate moves up so it doesn't hide them
  P.topClear = function (G, x0, x1) {
    const board = G.board;
    if (!board.gateView) return null;
    const cp = board.cellPx, w = 14 * board.waitScale;
    let top = null;
    board.gateView.forEach(gv => {
      const xs = [gv.vx, gv.pen[0] - w / 2, gv.pen[0] + w / 2];
      const ys = [gv.vy - cp * 0.6, gv.pen[1] - w * 0.7];
      gv.leaves.forEach(l => { xs.push(l.hx - l.len, l.hx + l.len); ys.push(l.hy - cp * 0.6); });
      if (Math.max(...xs) < x0 || Math.min(...xs) > x1) return;
      const t = Math.min(...ys);
      top = top === null ? t : Math.min(top, t);
    });
    return top;
  };

  // ------------------------------------------------------------------ sheep hops
  P.event = function (G, ev) {
    const st = G.pasture, board = G.board;
    if (!st) return;
    st.hops.forEach((h, id) => { if (G.time - h.t0 > 6) st.hops.delete(id); });
    const prev = st.hops.get(ev.id);
    const running = prev && G.time < prev.t0 + prev.delay + prev.dur ? prev : null;
    if (ev.e === 'sheepIn') {
      const gv = board.gateView && board.gateView[ev.g];
      if (!gv) return;
      const opening = st.openAt === null || G.time - st.openAt < OPEN_T;
      st.lastIn[ev.g] = G.time;
      st.hops.set(ev.id, {
        fx: gv.pen[0], fy: gv.pen[1], t0: G.time, delay: opening ? IN_DELAY : 0.2, dur: IN_T,
        arc: board.cellPx * 0.75, k0: board.waitScale, face: gv.flip, land: true,
      });
    } else {
      const a = board.cells[ev.from];
      if (!a) return;
      // a step that comes in while the sheep is still jumping waits for that jump to land
      const t0 = running ? Math.max(G.time, running.t0 + running.delay + running.dur) : G.time;
      st.hops.set(ev.id, { fx: a.sx, fy: a.sy, t0, delay: 0, dur: HOP_T, arc: board.cellPx * 0.28, k0: board.pieceScale, prev: running, fromCell: ev.from });
    }
  };

  function evalHop(G, h, c) {
    const kk = (G.time - h.t0 - h.delay) / h.dur;
    if (kk >= 1) return null;
    if (kk < 0) {
      const p = h.prev && evalHop(G, h.prev, G.board.cells[h.fromCell]);
      if (p) return p;
      return { x: h.fx, y: h.fy, ground: h.fy, flip: h.face !== undefined ? h.face : c.sx > h.fx, k: h.k0, lift: 2, run: false };
    }
    const ground = u.lerp(h.fy, c.sy, kk);
    const dx = c.sx - h.fx;
    return {
      x: u.lerp(h.fx, c.sx, kk), y: ground - Math.sin(Math.PI * kk) * h.arc, ground,
      flip: Math.abs(dx) > 2 ? dx > 0 : !!h.face, k: kk < 0.5 ? h.k0 : G.board.pieceScale, lift: 3, run: true,
    };
  }

  // where a sheep on the board is drawn while it hops (null once it stands on its square)
  P.hop = function (G, id, c) {
    const st = G.pasture;
    const h = st && st.hops.get(id);
    if (!h) return null;
    const r = evalHop(G, h, c);
    if (!r) {
      st.hops.delete(id);
      if (h.land) {
        const cp = G.board.cellPx;
        for (let i = 0; i < 4; i++) G.fx.push({ type: 'puff', x: c.sx + u.rand(-0.3, 0.3) * cp, y: c.sy + cp * 0.25, r: cp * 0.22, color: '#d8c8a0', t: 0, dur: 0.5, rise: cp * 0.15, alpha: 0.55 });
        G.popup('BAA!', c.sx, c.sy - 22, '#fff');
      }
    }
    return r;
  };

  BC.Pasture = P;
})();
