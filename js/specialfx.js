(function () {
  'use strict';
  // Client-side drawing of special captures (rules and timings live in specials.js). Everything here is
  // drawn from G.special and its clock, so local play and LAN mirrors look the same; one-shot particles
  // and flashes arrive as 'spx' events at the moment the logic fires them.
  const BC = window.BC;
  const u = BC.u;
  const R = BC.Render;
  const X = {};
  const INK = '#140c1c';
  const TAU = Math.PI * 2;

  const clamp01 = k => (k < 0 ? 0 : k > 1 ? 1 : k);
  const span = (t, a, b) => clamp01((t - a) / (b - a));
  const easeIn = k => k * k;
  const easeOut = k => 1 - (1 - k) * (1 - k);
  const toScreen = (board, x, y) => [board.ox + x * board.unit, board.oy + y * board.unit];
  const ownerCol = o => BC.PLAYER_COLORS[o] || BC.NEUTRAL_COLOR;
  const ownerDark = o => BC.PLAYER_DARK[o] || '#4a4a52';

  function mix(a, b, k) {
    const p = u.hexToRgb(a), q = u.hexToRgb(b);
    return `rgb(${Math.round(u.lerp(p[0], q[0], k))},${Math.round(u.lerp(p[1], q[1], k))},${Math.round(u.lerp(p[2], q[2], k))})`;
  }

  // small deterministic PRNG so a lightning bolt keeps its shape for a few frames
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function circle(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill();
  }

  function scorch(G, cell, alpha) {
    if (alpha <= 0) return;
    const ctx = R.ctx;
    ctx.fillStyle = `rgba(30,16,10,${alpha})`;
    ctx.fill(G.board.cells[cell].path);
  }

  // the captured piece floats up to the heavens and fades while its strike is called in
  function drawGhost(G, sp, dur) {
    const k = sp.t / dur;
    if (k >= 1) return;
    const c = G.board.cells[sp.c];
    const y = c.sy - easeOut(k) * G.board.cellPx * 1.4;
    const sc = 1 + k * 0.35;
    R.drawPiece(G, { t: sp.k, o: sp.o }, c.sx, y, 1 - k, sc, false, true);
    R.drawPiece(G, { t: sp.k, o: sp.o }, c.sx, y, (1 - k) * 0.6 * (0.5 + 0.5 * Math.sin(G.time * 30)), sc, true, true);
  }

  // ------------------------------------------------------------------ rook: the tower falls apart
  function rookParts(G, sp) {
    const board = G.board, c = board.cells[sp.c], cp = board.cellPx;
    const th = easeIn(span(sp.t, sp.rise, sp.land)) * Math.PI / 2;
    return sp.arms.map(([di, cells]) => {
      const d = board.dirs[di];
      let dx = d.x, dy = d.y, step = cp, len = cp * 2.5;
      if (cells.length) {
        const f = board.cells[cells[0]], l = board.cells[cells[cells.length - 1]];
        const dl = Math.hypot(l.sx - c.sx, l.sy - c.sy);
        dx = (l.sx - c.sx) / dl; dy = (l.sy - c.sy) / dl;
        step = Math.hypot(f.sx - c.sx, f.sy - c.sy);
        len = dl + step * 0.5;
      }
      const bx = c.sx + dx * step * 0.3, by = c.sy + dy * step * 0.3;
      const L = len - step * 0.3;
      const fl = L * Math.sin(th), up = L * 0.55 * Math.cos(th);
      // oblique view: standing parts point up the screen, fallen parts lie flat along their line
      return { dx, dy, bx, by, tx: bx + dx * fl, ty: by + dy * fl - up, gx: bx + dx * fl + up * 0.5, gy: by + dy * fl + up * 0.25, w: cp * 0.34 };
    }).sort((p, q) => p.dy - q.dy);
  }

  function drawColumn(ctx, p, col, dark, alpha) {
    const len = Math.hypot(p.tx - p.bx, p.ty - p.by);
    const w = p.w;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.bx, p.by);
    ctx.rotate(Math.atan2(p.ty - p.by, p.tx - p.bx));
    ctx.fillStyle = INK;
    ctx.fillRect(-2, -w / 2 - 2, len + 4, w + 4);
    ctx.fillStyle = col;
    ctx.fillRect(0, -w / 2, len, w);
    ctx.fillStyle = dark;
    ctx.fillRect(0, w / 6, len, w / 3);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(0, -w / 2, len, Math.max(2, w / 8));
    ctx.fillStyle = 'rgba(20,12,28,0.5)';
    const bs = w * 0.7;
    for (let x = bs, row = 0; x < len - w * 0.4; x += bs, row++) ctx.fillRect(x, row % 2 ? -w / 2 : 0, 2, w / 2);
    ctx.fillRect(0, -1, len, 2);
    // crenellated top of the tower
    const cap = Math.min(len, w * 0.6);
    ctx.fillStyle = INK;
    ctx.fillRect(len - cap - 2, -w / 2 - 6, cap + 4, w + 12);
    ctx.fillStyle = col;
    ctx.fillRect(len - cap, -w / 2 - 4, cap, w + 8);
    ctx.fillStyle = INK;
    ctx.fillRect(len - cap * 0.45, -w / 2 + w * 0.12, cap * 0.45, w * 0.22);
    ctx.fillRect(len - cap * 0.45, w / 2 - w * 0.34, cap * 0.45, w * 0.22);
    ctx.restore();
  }

  function rookUnder(G, sp) {
    const ctx = R.ctx;
    if (sp.t >= sp.rise && sp.t < sp.land + 0.3) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      rookParts(G, sp).forEach(p => {
        ctx.lineWidth = p.w;
        ctx.beginPath(); ctx.moveTo(p.bx, p.by); ctx.lineTo(p.gx, p.gy); ctx.stroke();
      });
      ctx.restore();
    }
    if (sp.t >= sp.land) {
      const a = 0.5 * (1 - span(sp.t, sp.land + 0.2, sp.dur));
      sp.arms.forEach(arm => arm[1].forEach(c => scorch(G, c, a)));
    }
  }

  function rookOver(G, sp) {
    const board = G.board, c = board.cells[sp.c], t = sp.t;
    if (t < sp.rise) {
      // the tower teeters over the piece that took it, then cracks into parts
      const k = t / sp.rise;
      const j = 1 + k * 4;
      const flash = k > 0.6 && Math.floor(t * 30) % 2 === 0;
      // the tower shakes and lifts, its shadow stays put on the ground
      const lift = board.cellPx * 0.25 * easeOut(Math.min(1, k * 3));
      R.pieceShadow(G, c.sx, c.sy, 1.3 + k * 0.2, lift);
      R.drawPiece(G, { t: 'R', o: sp.o }, c.sx + u.rand(-j, j), c.sy + u.rand(-j, j) * 0.5, 1, 1.3 + k * 0.2, flash, true, lift);
      return;
    }
    const alpha = 1 - span(t, sp.land + 0.04, sp.land + 0.3);
    if (alpha <= 0) return;
    const col = ownerCol(sp.o), dark = ownerDark(sp.o);
    rookParts(G, sp).forEach(p => drawColumn(R.ctx, p, col, dark, alpha));
  }

  // --------------------------------------------------------------- knight: a wild horse with eyes
  // drawn on the sprite's own 14px grid (sprite faces left; flip mirrors it to face right)
  function drawKnight(G, o, x, y, f) {
    const ctx = R.ctx, k = G.board.pieceScale, s = 14 * k;
    const img = R.pieceImg({ t: 'N', o });
    const lift = f.lift || 0;
    const ox = Math.round(x - s / 2), oy = Math.round(y - s / 2 - s * 0.08) - lift * k;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x, f.ground + s * 0.4, s * 0.32, s * 0.1, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalAlpha = f.alpha;
    if (f.flip) { ctx.translate(ox * 2 + s, 0); ctx.scale(-1, 1); }
    const px = (cx, cy, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(ox + cx * k, oy + cy * k, w * k, h * k); };
    if (lift > 0) {
      [[3, 0], [5, 1], [8, 1], [10, 0]].forEach(([lx, pair], i) => {
        let dx = 0, len = lift;
        if (f.run) {
          const ph = (Math.floor(G.time * 14) + pair) % 2;
          dx = ph ? (i < 2 ? -1 : 1) : 0;
          len = ph ? lift : lift - 1;
        }
        px(lx + dx, 14, 1, len, INK);
        px(lx + dx, 13 + len, 1, 1, '#6e2c16');
      });
    }
    if (img) ctx.drawImage(img, ox, oy, s, s);
    // big cartoon eye over the sprite's own eye (forward = left in sprite space)
    if (f.eye === 'shut') {
      px(4, 2, 3, 1, INK);
    } else {
      px(3, 1, 1, 3, INK);
      px(7, 1, 1, 3, INK);
      px(4, 4, 3, 1, INK);
      px(4, 1, 3, 3, '#fff');
      if (f.eye === 'half') { px(4, 1, 3, 1, INK); px(4, 3, 2, 1, INK); }
      else if (f.eye === 'wide') px(5, 2, 1, 1, INK);
      else px(4, 2, 1, 2, INK);
    }
    ctx.restore();
    if (f.bang) R.text('!', x + (f.flip ? -1 : 1) * s * 0.45, oy - 2 * k, { size: Math.max(10, Math.round(s / 3)), align: 'center', color: '#ffe14a', outline: 3 });
  }

  // ---------------------------------------------------------------- sheep: left behind by a missed turn
  // facing left on the pieces' 14px grid; legs are drawn below row 10 (lift = leg length)
  const SHEEP = [
    '......kkkk....',
    '....kkwwwwkkk.',
    '...kwwlwwwwwwk',
    '.kpkwlwwwwwwwk',
    'kfffkwwwwwwwgk',
    'kfffkkwwwwwwgk',
    'kfffFkwwwwwggk',
    'kpffFkwwwwgggk',
    '.kffk.kwwgggk.',
    '..kk...kkkkk..',
  ];
  const SHEEP_PAL = { k: INK, w: '#f4f0e8', l: '#ffffff', g: '#c4bccf', f: '#3a3440', F: '#5a5464', p: '#ff9ab8' };

  // the sheep standing on its legs, one canvas pixel per sprite pixel (gore.js cuts it up)
  X.sheepCanvas = function () {
    if (X.sheepCv) return X.sheepCv;
    const [cv, g] = BC.Assets.canvas(14, 13);
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    [5, 7, 10, 12].forEach(lx => { for (let y = 9; y < 12; y++) px(lx, y, INK); px(lx, 12, '#5a5464'); });
    SHEEP.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (SHEEP_PAL[row[rx]]) px(rx, ry, SHEEP_PAL[row[rx]]); });
    px(1, 5, '#fff');
    px(2, 5, INK);
    X.sheepCv = cv;
    return cv;
  };

  // f: { ground, lift, eye: 'open'|'shut'|'half'|'wide', flip, alpha, run, graze, bang, bell, k }
  // bell: a red collar with a bell (the wandering sheep from the sheep gates); k: pixel scale (the pieces' by default)
  X.drawSheep = function (G, x, y, f) {
    const ctx = R.ctx, k = f.k || G.board.pieceScale, s = 14 * k;
    const lift = f.lift || 0;
    const ox = Math.round(x - s / 2), oy = Math.round(y + s * 0.36 - (10 + lift) * k);
    const sh = 1 / (1 + Math.max(0, f.ground - y) / s);
    ctx.fillStyle = `rgba(0,0,0,${0.28 * sh})`;
    ctx.beginPath(); ctx.ellipse(x, f.ground + s * 0.4, s * 0.36 * sh, s * 0.1 * sh, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.globalAlpha = f.alpha === undefined ? 1 : f.alpha;
    if (f.flip) { ctx.translate(ox * 2 + s, 0); ctx.scale(-1, 1); }
    const px = (cx, cy, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(ox + cx * k, oy + cy * k, w * k, h * k); };
    if (lift > 0) {
      [[5, 0], [7, 1], [10, 1], [12, 0]].forEach(([lx, pair], i) => {
        let dx = 0, len = lift;
        if (f.run) {
          const ph = (Math.floor(G.time * 14) + pair) % 2;
          dx = ph ? (i < 2 ? -1 : 1) : 0;
          len = ph ? lift : lift - 1;
        }
        px(lx + dx, 9, 1, len + 1, INK);
        px(lx + dx, 9 + len, 1, 1, '#5a5464');
      });
    }
    // grazing: the head dips to the grass
    const dip = f.graze ? 1 : 0;
    SHEEP.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const col = SHEEP_PAL[row[rx]];
        if (col) px(rx, ry + (rx < 5 ? dip : 0), 1, 1, col);
      }
    });
    const ey = 5 + dip;
    if (f.eye === 'shut') px(1, ey, 2, 1, INK);
    else {
      px(1, ey, 2, 1, '#fff');
      if (f.eye === 'half') px(1, ey, 2, 1, '#c4bccf');
      px(f.eye === 'wide' ? 2 : 1, ey, 1, 1, INK);
    }
    if (f.bell) {
      px(5, 5, 1, 3, '#e8313c');
      px(5, 8, 1, 1, '#ffe14a');
      px(5, 9, 1, 1, '#b8862c');
    }
    ctx.restore();
    if (f.bang) R.text('!', x + (f.flip ? 1 : -1) * s * 0.45, oy - 3 * k, { size: Math.max(10, Math.round(s / 3)), align: 'center', color: '#ffe14a', outline: 3 });
  };

  // the knight's gallop, shared by the stampeding sheep
  function knightOver(G, sp) {
    runnerOver(G, sp, (x, y, f) => drawKnight(G, sp.o, x, y, f));
  }

  function sheepOver(G, sp) {
    runnerOver(G, sp, (x, y, f) => X.drawSheep(G, x, y, Object.assign({}, f, { lift: Math.max(2, f.lift) })));
  }

  function runnerOver(G, sp, draw) {
    const board = G.board, cells = board.cells, t = sp.t, cp = board.cellPx;
    const path = sp.path, hops = path.length - 1;
    const end = sp.wake + hops * sp.hop;
    // a sheep that blew up at the end of its run is gone
    if (sp.boom && t >= end) return;
    const home = cells[path[0]];
    const hover = cp * 0.35;
    const faceTo = (a, b) => (b.sx !== a.sx ? b.sx > a.sx : null);
    let x, y, ground, lift = 0, eye = 'open', bang = false, run = false, alpha = 1, flip = false;
    if (t < sp.wake) {
      // wakes up: eyes open, a startled '!', legs pop out and it stands up
      x = home.sx; ground = home.sy;
      y = home.sy - hover * easeOut(span(t, 0, 0.25));
      if (t < 0.3) eye = 'shut';
      else if (t < 0.36) eye = 'half';
      else if (t < 0.55) { eye = 'wide'; bang = true; }
      else if (t < 0.6) eye = 'shut';
      if (t >= 0.6 && t < 0.8) { lift = 1; x += Math.floor(t * 24) % 2 ? 1 : -1; }
      else if (t >= 0.8) lift = Math.round(1 + 2 * span(t, 0.8, 0.95));
      if (hops) flip = !!faceTo(home, cells[path[1]]);
    } else if (t < end) {
      const i = Math.min(hops, Math.floor((t - sp.wake) / sp.hop) + 1);
      const k = (t - sp.wake - (i - 1) * sp.hop) / sp.hop;
      const a = cells[path[i - 1]], b = cells[path[i]];
      const y0 = i === 1 ? a.sy - hover : a.sy;
      x = u.lerp(a.sx, b.sx, k);
      ground = u.lerp(a.sy, b.sy, k);
      y = u.lerp(y0, b.sy, k) - Math.sin(Math.PI * k) * cp * 0.55;
      lift = 3; run = true;
      eye = path[i] === sp.hit ? 'wide' : 'open';
      flip = faceTo(a, b);
      if (flip === null) flip = i > 1 ? !!faceTo(cells[path[i - 2]], a) : false;
    } else {
      // done: a proud little rear-up, then it fades away
      const last = cells[path[hops]];
      x = last.sx; ground = last.sy;
      y = last.sy - Math.abs(Math.sin((t - end) * 14)) * cp * 0.12;
      lift = 3; eye = 'wide';
      alpha = 1 - span(t, end + (sp.dur - end) * 0.4, sp.dur);
      flip = hops ? !!faceTo(cells[path[hops - 1]], last) : false;
    }
    if (alpha > 0) draw(x, y, { ground, lift, eye, bang, run, alpha, flip });
  }

  // ------------------------------------------------------------- bishop: lightning from the heavens
  function boltPoints(x0, y0, x1, y1, jit, rnd, n) {
    const pts = [[x0, y0]];
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const amp = jit * Math.sin(Math.PI * k);
      pts.push([u.lerp(x0, x1, k) + (rnd() - 0.5) * 2 * amp, u.lerp(y0, y1, k) + (rnd() - 0.5) * jit * 0.3]);
    }
    pts.push([x1, y1]);
    return pts;
  }

  function strokeBolt(ctx, pts, w) {
    ctx.lineJoin = 'miter';
    [[w * 3, 'rgba(120,180,255,0.35)'], [w * 1.8, 'rgba(170,220,255,0.8)'], [w * 0.7, '#fff']].forEach(([lw, col]) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
    });
  }

  function bishopUnder(G, sp) {
    if (sp.t >= sp.strike) scorch(G, sp.tc, 0.55 * (1 - span(sp.t, sp.strike + 0.3, sp.dur)));
  }

  function bishopOver(G, sp) {
    const ctx = R.ctx, board = G.board, box = BC.BOARD_BOX, t = sp.t, cp = board.cellPx;
    const tgt = board.cells[sp.tc];
    const sky = Math.min(span(t, 0.1, 0.6), 1 - span(t, sp.strike + 0.35, sp.dur));
    ctx.fillStyle = `rgba(8,6,30,${0.45 * sky})`;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    drawGhost(G, sp, 0.9);

    // storm cloud gathering above the victim
    const cx = tgt.sx, cy = box.y + 34;
    const puffs = [[0, 0, 1], [-0.9, 0.2, 0.75], [0.9, 0.25, 0.8], [-0.45, -0.35, 0.7], [0.5, -0.3, 0.7], [-1.6, 0.4, 0.5], [1.6, 0.45, 0.55]];
    ctx.globalAlpha = sky;
    const r = cp * 0.55;
    puffs.forEach(([dx, dy, s]) => circle(ctx, cx + dx * r, cy + dy * r + 4, s * r, '#1c1a2c'));
    puffs.forEach(([dx, dy, s]) => circle(ctx, cx + dx * r, cy + dy * r, s * r * 0.92, '#3a3850'));
    puffs.forEach(([dx, dy, s]) => circle(ctx, cx + dx * r - s * r * 0.2, cy + dy * r - s * r * 0.25, s * r * 0.45, '#55536e'));
    if (t > 0.5 && t < sp.strike && Math.random() < 0.25) {
      circle(ctx, cx + u.rand(-1.2, 1.2) * r, cy + u.rand(-0.2, 0.4) * r, r * 0.4, 'rgba(200,230,255,0.6)');
    }
    ctx.globalAlpha = 1;

    // the chosen one gets a target lock
    if (t > 0.5 && t < sp.strike) {
      const k = span(t, 0.5, sp.strike);
      ctx.save();
      ctx.translate(tgt.sx, tgt.sy);
      ctx.rotate(t * 4);
      ctx.strokeStyle = Math.floor(t * 12) % 2 ? '#ffe14a' : '#fff';
      ctx.lineWidth = 3;
      const rr = cp * (0.9 - 0.4 * k);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(0, 0, rr, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + 1.3); ctx.stroke();
      }
      ctx.restore();
    }

    if (t >= sp.strike && t < sp.strike + 0.32 && Math.floor((t - sp.strike) * 30) % 3 !== 2) {
      const rnd = rng(Math.floor(t * 24) + sp.tc * 31);
      const y1 = tgt.sy - cp * 0.1;
      const main = boltPoints(cx + (rnd() - 0.5) * r, cy + r * 0.4, tgt.sx, y1, cp * 0.6, rnd, 10);
      ctx.save();
      const glow = ctx.createRadialGradient(tgt.sx, tgt.sy, 0, tgt.sx, tgt.sy, cp * 1.3);
      glow.addColorStop(0, 'rgba(255,255,255,0.8)');
      glow.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(tgt.sx - cp * 1.3, tgt.sy - cp * 1.3, cp * 2.6, cp * 2.6);
      strokeBolt(ctx, main, Math.max(3, cp * 0.07));
      for (let b = 0; b < 2; b++) {
        const from = main[2 + Math.floor(rnd() * 5)];
        const len = cp * u.lerp(0.8, 1.6, rnd());
        const ang = Math.PI / 2 + (rnd() < 0.5 ? -1 : 1) * u.lerp(0.4, 0.9, rnd());
        strokeBolt(ctx, boltPoints(from[0], from[1], from[0] + Math.cos(ang) * len, from[1] + Math.sin(ang) * len, cp * 0.25, rnd, 4), Math.max(2, cp * 0.035));
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ queen: airstrike
  function planeAt(G, sp, time) {
    const k = (time - sp.fly0) / sp.fly;
    const [x, y] = toScreen(G.board, u.lerp(sp.ax, sp.bx, k), u.lerp(sp.ay, sp.by, k));
    return { k, x, y, alt: G.board.cellPx * 1.1 };
  }

  function planeImg(shadow) {
    const g = BC.Assets.glyphs.plane;
    if (!g) return null;
    if (!shadow) return g;
    if (!X.planeShadow) X.planeShadow = BC.Assets.silhouette(g, '#000');
    return X.planeShadow;
  }

  function drawPlaneSprite(ctx, img, x, y, ang, size, alpha) {
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function queenUnder(G, sp) {
    const ctx = R.ctx, board = G.board, t = sp.t, cp = board.cellPx;
    const ang = Math.atan2(sp.by - sp.ay, sp.bx - sp.ax);
    const pl = planeAt(G, sp, t);
    if (pl.k >= 0 && pl.k <= 1) drawPlaneSprite(ctx, planeImg(true), pl.x + cp * 0.25, pl.y + cp * 0.15, ang, Math.max(36, cp * 1.05), 0.3);
    sp.drops.forEach(([cell, at]) => {
      const c = board.cells[cell];
      if (t >= at) { scorch(G, cell, 0.5 * (1 - span(t, at + 0.3, sp.dur))); return; }
      if (t < at - sp.fall) return;
      // a red crosshair marks where each bomb will land
      const k = span(t, at - sp.fall, at);
      ctx.strokeStyle = Math.floor(t * 16) % 2 ? '#ff3d3d' : '#fff';
      ctx.lineWidth = 2;
      const rr = cp * (0.45 - 0.15 * k);
      ctx.beginPath(); ctx.arc(c.sx, c.sy, rr, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c.sx - rr * 1.3, c.sy); ctx.lineTo(c.sx + rr * 1.3, c.sy);
      ctx.moveTo(c.sx, c.sy - rr * 1.3); ctx.lineTo(c.sx, c.sy + rr * 1.3);
      ctx.stroke();
      ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.25 * k})`;
      ctx.beginPath(); ctx.ellipse(c.sx, c.sy + cp * 0.1, cp * 0.2 * k, cp * 0.07 * k, 0, 0, TAU); ctx.fill();
    });
  }

  function queenOver(G, sp) {
    const ctx = R.ctx, board = G.board, t = sp.t, cp = board.cellPx;
    drawGhost(G, sp, 0.9);
    const bs = Math.max(14, cp * 0.42);
    sp.drops.forEach(([cell, at]) => {
      const rel = at - sp.fall;
      if (t < rel || t >= at) return;
      const k = span(t, rel, at);
      const from = planeAt(G, sp, rel), c = board.cells[cell];
      const x = u.lerp(from.x, c.sx, k), y = u.lerp(from.y - from.alt, c.sy, easeIn(k));
      R.sheetTile(BC.Assets.SHEET.bomb[0], Math.round(x - bs / 2), Math.round(y - bs * 0.6), bs, bs);
    });
    const pl = planeAt(G, sp, t);
    if (pl.k < 0 || pl.k > 1) return;
    const ang = Math.atan2(sp.by - sp.ay, sp.bx - sp.ax);
    const size = Math.max(36, cp * 1.05);
    const x = pl.x, y = pl.y - pl.alt + Math.sin(t * 9) * 2;
    drawPlaneSprite(ctx, planeImg(false), x, y, ang, size, 1);
    // spinning propeller in front of the nose
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = Math.floor(t * 40) % 2 ? 'rgba(255,255,255,0.75)' : 'rgba(40,40,40,0.75)';
    ctx.fillRect(size / 2 - 1, -size * 0.2, Math.max(2, size / 16), size * 0.4);
    ctx.restore();
  }

  // --------------------------------------------------------------------- king: the nuke
  function nukeGeom(G, sp) {
    const [x, y] = toScreen(G.board, sp.x, sp.y);
    return { x, y, h: sp.half * G.board.unit };
  }

  function drawTrefoil(ctx, x, y, r, rot, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);
    circle(ctx, 0, 0, r * 1.08, INK);
    circle(ctx, 0, 0, r, '#ffd93d');
    ctx.fillStyle = INK;
    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - 0.52) * r * 0.24, Math.sin(a - 0.52) * r * 0.24);
      ctx.arc(0, 0, r * 0.86, a - 0.52, a + 0.52);
      ctx.arc(0, 0, r * 0.24, a + 0.52, a - 0.52, true);
      ctx.fill();
    }
    circle(ctx, 0, 0, r * 0.16, INK);
    ctx.restore();
  }

  function drawNukeBomb(ctx, x, y, s) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.fillStyle = INK;
    ctx.fillRect(-s * 0.3, -s * 0.95, s * 0.6, s * 0.35);
    ctx.fillStyle = '#5a6278';
    ctx.fillRect(-s * 0.25, -s * 0.9, s * 0.5, s * 0.25);
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(0, -s * 0.15, s * 0.36, s * 0.56, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4e5a32';
    ctx.beginPath(); ctx.ellipse(0, -s * 0.15, s * 0.31, s * 0.51, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.fillRect(-s * 0.31, -s * 0.38, s * 0.62, s * 0.1);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(-s * 0.18, -s * 0.5, s * 0.08, s * 0.5);
    ctx.restore();
  }

  function kingUnder(G, sp) {
    const ctx = R.ctx, board = G.board, t = sp.t;
    if (t < sp.boom) {
      const pulse = 0.5 + 0.5 * Math.sin(t * (6 + t * 7));
      sp.cells.forEach(id => {
        const c = board.cells[id];
        ctx.fillStyle = `rgba(255,40,30,${0.15 + 0.3 * pulse})`;
        ctx.fill(c.path);
      });
      const z = nukeGeom(G, sp);
      ctx.save();
      ctx.lineWidth = 4;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 40;
      ctx.strokeStyle = INK;
      ctx.strokeRect(z.x - z.h, z.y - z.h, z.h * 2, z.h * 2);
      ctx.strokeStyle = '#ffd93d';
      ctx.lineDashOffset = -t * 40 + 9;
      ctx.strokeRect(z.x - z.h, z.y - z.h, z.h * 2, z.h * 2);
      ctx.restore();
    } else {
      const a = 0.75 * (1 - span(t, sp.boom + 1.0, sp.dur));
      sp.cells.forEach(id => scorch(G, id, a));
    }
  }

  // draw onto a scratch layer and composite it with one alpha, so overlapping puffs fade without seams
  function layer(alpha, draw) {
    const ctx = R.ctx;
    if (alpha <= 0) return;
    if (alpha >= 0.999) { draw(ctx); return; }
    if (!X.buf) X.buf = BC.Assets.canvas(BC.W, BC.H);
    const [cv, g] = X.buf;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, BC.W, BC.H);
    g.setTransform(ctx.getTransform());
    draw(g);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(cv, 0, 0);
    ctx.restore();
  }

  function drawMushroom(g, z, t, m) {
    // a stem of smoke rises and blooms into a cap that cools from fire to ash
    const rise = easeOut(clamp01(m * 1.5));
    const capR = z.h * (0.35 + 0.45 * easeOut(m));
    const capY = Math.max(capR * 0.75 + 6, z.y - z.h * 1.7 * rise);
    const hot = 1 - clamp01(m * 2.2);
    const dark = mix('#3a3238', '#c8401c', hot), mid = mix('#6a5e66', '#ff8a1c', hot), lite = mix('#9a8e96', '#ffe14a', hot);
    const sw = z.h * 0.36 * (1 + 0.3 * m);
    for (let i = 0; i <= 6; i++) {
      const k = i / 6;
      circle(g, z.x + Math.sin(t * 5 + i) * sw * 0.08, u.lerp(z.y, capY, k), sw * (0.75 - 0.25 * k), i % 2 ? mid : dark);
    }
    if (m > 0.05) {
      g.strokeStyle = `rgba(230,225,235,${0.6 * (1 - m)})`;
      g.lineWidth = Math.max(2, z.h * 0.05);
      g.beginPath(); g.ellipse(z.x, u.lerp(z.y, capY, 0.55), capR * 0.85, capR * 0.2, 0, 0, TAU); g.stroke();
    }
    const cap = [[0, 0.1, 1], [-0.65, 0.25, 0.7], [0.65, 0.25, 0.7], [-0.35, -0.3, 0.7], [0.35, -0.3, 0.7], [0, -0.45, 0.6], [-0.95, 0.35, 0.45], [0.95, 0.35, 0.45]];
    g.fillStyle = dark;
    g.beginPath(); g.ellipse(z.x, capY + capR * 0.45, capR * 1.15, capR * 0.4, 0, 0, TAU); g.fill();
    cap.forEach(([dx, dy, s]) => circle(g, z.x + dx * capR, capY + dy * capR, s * capR, mid));
    cap.forEach(([dx, dy, s]) => circle(g, z.x + dx * capR - s * capR * 0.2, capY + dy * capR - s * capR * 0.25, s * capR * 0.5, lite));
  }

  function kingOver(G, sp) {
    const ctx = R.ctx, t = sp.t, cp = G.board.cellPx;
    const z = nukeGeom(G, sp);
    drawGhost(G, sp, 1.0);
    if (t < sp.boom) {
      drawTrefoil(ctx, z.x, z.y, z.h * 0.42, t * 0.8, 0.55 + 0.45 * Math.abs(Math.sin(t * (4 + t * 4))));
      if (t >= sp.drop) {
        const k = Math.pow(span(t, sp.drop, sp.boom), 1.5);
        drawNukeBomb(ctx, z.x, u.lerp(cp * 0.6, z.y, k), cp * 1.1);
      }
      return;
    }
    const m = span(t, sp.boom + 0.1, sp.dur);
    ctx.fillStyle = `rgba(130,110,95,${0.5 * (1 - m)})`;
    ctx.beginPath(); ctx.ellipse(z.x, z.y, z.h * (1.2 + 1.8 * easeOut(m)), z.h * (0.45 + 0.6 * easeOut(m)), 0, 0, TAU); ctx.fill();
    layer(1 - span(t, sp.dur - 1.3, sp.dur), g => drawMushroom(g, z, t, m));
    const f0 = span(t, sp.boom, sp.boom + 0.4);
    layer(1 - span(t, sp.boom + 0.35, sp.boom + 0.9), g => {
      const r = z.h * (0.4 + 1.0 * easeOut(f0));
      circle(g, z.x, z.y, r, '#ff5a1c');
      circle(g, z.x, z.y, r * 0.8, '#ffa53c');
      circle(g, z.x, z.y, r * 0.55, '#fff0a0');
      circle(g, z.x, z.y, r * 0.3, '#fff');
    });
  }

  // ------------------------------------------------------------------- kings' helmets
  // Kings can't be hurt by a strike. While a tower, airstrike or nuke comes down they pop a helmet on,
  // and anything that lands on them just clangs off it.
  const clangs = new Map(); // cell -> G.time of the last clang, for the wobble

  function drawStar(ctx, x, y, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      if (i) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  X.drawHelmet = function (G, cell, x, y) {
    const sp = G.special;
    if (!sp) return;
    const ctx = R.ctx, s = 14 * G.board.pieceScale;
    const on = span(sp.t, 0.05, 0.4), off = span(sp.t, sp.dur - 0.35, sp.dur);
    if (on <= 0 || off >= 1) return;
    const drop = (1 - u.easeOutBack(on)) * s * 1.3 + easeIn(off) * s * 0.9;
    const since = G.time - (clangs.get(cell) || -9);
    const wob = since < 0.5 ? Math.sin(since * 45) * 0.35 * (1 - since / 0.5) : 0;
    ctx.save();
    ctx.globalAlpha = Math.min(1, on * 3) * (1 - off);
    ctx.translate(x, y - s * 0.22 - drop);
    ctx.rotate(wob);
    const rx = s * 0.42, ry = s * 0.4;
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(0, 0, rx + 2, ry + 2, 0, Math.PI, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, s * 0.02, s * 0.52 + 2, s * 0.09 + 2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#5f7032';
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = '#8ea24c';
    ctx.beginPath(); ctx.ellipse(-rx * 0.35, -ry * 0.55, rx * 0.28, ry * 0.18, -0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#47561f';
    ctx.beginPath(); ctx.ellipse(0, s * 0.02, s * 0.52, s * 0.09, 0, 0, TAU); ctx.fill();
    drawStar(ctx, 0, -ry * 0.45, s * 0.1, '#ffe14a');
    ctx.restore();
  };

  // -------------------------------------------------------------------- dispatch
  const UNDER = { R: rookUnder, B: bishopUnder, Q: queenUnder, K: kingUnder };
  const OVER = { R: rookOver, N: knightOver, B: bishopOver, Q: queenOver, K: kingOver, S: sheepOver };

  X.drawUnder = function (G) {
    const f = UNDER[G.special.k];
    if (f) f(G, G.special);
  };

  X.drawOver = function (G) {
    const f = OVER[G.special.k];
    if (f) f(G, G.special);
  };

  X.drawFlash = function (G) {
    const f = G.flash;
    if (!f) return;
    const k = 1 - f.t / f.dur;
    R.ctx.fillStyle = `rgba(255,255,255,${f.v * k * k})`;
    R.ctx.fillRect(0, 0, BC.W, BC.H);
  };

  // one-shot particles from the logic's timed cues
  X.event = function (G, ev, c) {
    const cp = G.board.cellPx;
    const puff = (x, y, r, color, dur, rise, alpha) => G.fx.push({ type: 'puff', x, y, r, color, t: 0, dur, rise, alpha });
    switch (ev.f) {
      case 'boom': {
        if (!c) return;
        G.fx.push({ type: 'boom', x: c.sx, y: c.sy, t: 0, dur: 0.55, size: cp * 1.3 });
        G.fx.push({ type: 'ring', x: c.sx, y: c.sy, t: 0, dur: 0.45, r: cp * 0.9, color: '#fff' });
        puff(c.sx, c.sy, cp * 0.55, '#5a5560', 0.9, cp * 0.5, 0.5);
        if (ev.rubble) {
          G.burst(c.sx, c.sy, ['#8a8490', '#5a5560', ownerCol(ev.o), ownerDark(ev.o)], 16, 220, Math.max(4, Math.round(cp * 0.08)));
        } else {
          G.burst(c.sx, c.sy, ['#fff', '#ffe14a', '#ff8a1c', '#ff3d3d', '#5a5560'], 22, 240, 4);
        }
        break;
      }
      case 'dust': {
        if (!c) return;
        for (let i = 0; i < 3; i++) puff(c.sx + u.rand(-0.3, 0.3) * cp, c.sy + cp * 0.25, cp * 0.22, '#d8c8a0', 0.5, cp * 0.15, 0.55);
        G.burst(c.sx, c.sy + cp * 0.25, ['#d8c8a0', '#b8a070'], 6, 90, 3);
        break;
      }
      case 'poof': {
        if (!c) return;
        for (let i = 0; i < 5; i++) puff(c.sx + u.rand(-0.35, 0.35) * cp, c.sy + u.rand(-0.4, 0.1) * cp, cp * 0.3, '#f0f0f8', 0.6, cp * 0.3, 0.8);
        G.burst(c.sx, c.sy, ['#fff', '#ffe14a', '#9fe8ff'], 12, 140, 3);
        break;
      }
      case 'wool': {
        // a sheep caught by a strike loses a cloud of wool (charred by lightning, ash in the nuke)
        if (!c) return;
        const cols = ev.st === 'zap' ? ['#3a3440', '#5a5464', '#9fe8ff', '#fff'] : ev.st === 'vapor' ? ['#3a3438', '#5a5560', '#8a8490'] : ['#fff', '#f4f0e8', '#c4bccf'];
        for (let i = 0; i < 6; i++) puff(c.sx + u.rand(-0.35, 0.35) * cp, c.sy + u.rand(-0.4, 0.1) * cp, cp * 0.3, cols[i % 2], 0.9, cp * 0.35, 0.85);
        G.burst(c.sx, c.sy, cols, 26, 240, 4);
        if (G.cfg && G.cfg.blood && BC.Gore) BC.Gore.wound(G, c);
        break;
      }
      case 'gib': {
        // a sheep blows up at the end of a chained stampede: a cloud of wool (and with BLOOD on, the rest of it)
        if (!c) return;
        const r = cp * (0.6 + (ev.r || 1) * 0.5);
        for (let i = 0; i < 10; i++) {
          const a = Math.random() * TAU, d = Math.random() * r * 0.5;
          puff(c.sx + Math.cos(a) * d, c.sy + Math.sin(a) * d * 0.7 - cp * 0.2, cp * 0.4, i % 3 ? '#f4f0e8' : '#c4bccf', 1.1, cp * 0.5, 0.9);
        }
        G.burst(c.sx, c.sy - cp * 0.2, ['#fff', '#f4f0e8', '#c4bccf', '#ffe14a'], 44, 320, 4);
        G.fx.push({ type: 'boom', x: c.sx, y: c.sy, t: 0, dur: 0.7, size: cp * 2.2 });
        G.fx.push({ type: 'ring', x: c.sx, y: c.sy, t: 0, dur: 0.55, r, color: '#fff' });
        G.fx.push({ type: 'ring', x: c.sx, y: c.sy, t: -0.08, dur: 0.7, r: r * 1.5, color: '#ff8a1c' });
        if (G.cfg && G.cfg.blood && BC.Gore) BC.Gore.sheep(G, c);
        break;
      }
      case 'zap': {
        if (!c) return;
        G.burst(c.sx, c.sy, ['#fff', '#9fe8ff', '#3fa0ff', '#ffe14a'], 36, 320, 3);
        G.fx.push({ type: 'ring', x: c.sx, y: c.sy, t: 0, dur: 0.4, r: cp * 1.4, color: '#9fe8ff' });
        puff(c.sx, c.sy, cp * 0.5, '#2a2a3a', 1.0, cp * 0.6, 0.6);
        break;
      }
      case 'flash':
        if (!G.flash || G.flash.v * (1 - G.flash.t / G.flash.dur) < ev.v) G.flash = { t: 0, dur: ev.d, v: ev.v };
        break;
      case 'clang': {
        if (!c) return;
        const hy = c.sy - 14 * G.board.pieceScale * 0.4;
        clangs.set(ev.c, G.time);
        G.burst(c.sx, hy, ['#fff', '#ffe14a', '#d8d8e0'], 14, 260, 3);
        G.fx.push({ type: 'ring', x: c.sx, y: hy, t: 0, dur: 0.35, r: cp * 0.8, color: '#ffe14a' });
        G.popup('CLANG!', c.sx, hy - cp * 0.3, '#ffe14a');
        break;
      }
      case 'nuke': {
        const [x, y] = toScreen(G.board, ev.x, ev.y);
        const h = ev.r * G.board.unit;
        G.burst(x, y, ['#fff', '#ffe14a', '#ff8a1c', '#ff3d3d', '#5a5560', '#3a3238'], 90, 520, 5);
        G.fx.push({ type: 'ring', x, y, t: 0, dur: 0.7, r: h * 3.2, color: '#fff' });
        G.fx.push({ type: 'ring', x, y, t: -0.1, dur: 0.9, r: h * 4.2, color: '#ffb43c' });
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8;
          puff(x + Math.cos(a) * h, y + Math.sin(a) * h * 0.6, h * 0.5, '#6a5e66', 1.6, h * 0.4, 0.55);
        }
        break;
      }
    }
  };

  BC.SpecialFx = X;
})();
