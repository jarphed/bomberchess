(function () {
  'use strict';
  const BC = window.BC = window.BC || {};
  const u = BC.u;
  const R = {};
  let ctx;

  const CH_LIGHT = '#f0dcae';
  const CH_DARK = '#b8865c';
  const FONT = '"Press Start 2P", monospace';
  const JFONT = '"DotGothic16", "Hiragino Kaku Gothic ProN", "Yu Gothic", monospace';

  R.init = function (canvas) {
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    R.ctx = ctx;
    const [sc, sg] = BC.Assets.canvas(BC.W, BC.H);
    sg.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = 0; y < BC.H; y += 3) sg.fillRect(0, y, BC.W, 1);
    const grd = sg.createRadialGradient(BC.W / 2, BC.H / 2, BC.H * 0.45, BC.W / 2, BC.H / 2, BC.H * 0.95);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.45)');
    sg.fillStyle = grd;
    sg.fillRect(0, 0, BC.W, BC.H);
    R.scan = sc;
  };

  // ---------------------------------------------------------------- text
  R.text = function (s, x, y, o) {
    o = o || {};
    const size = o.size || 16;
    ctx.font = `${size}px ${o.jp ? JFONT : FONT}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'top';
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    if (o.outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.outline;
      ctx.strokeStyle = o.outlineColor || '#000';
      ctx.strokeText(s, x, y);
    }
    if (o.shadow !== false && !o.outline) {
      const d = Math.max(2, Math.round(size / 8));
      ctx.fillStyle = o.shadowColor || 'rgba(0,0,0,0.85)';
      ctx.fillText(s, x + d, y + d);
    }
    ctx.fillStyle = o.color || '#fff';
    ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
  };

  R.measure = function (s, size, jp) {
    ctx.font = `${size}px ${jp ? JFONT : FONT}`;
    return ctx.measureText(s).width;
  };

  R.panel = function (x, y, w, h, o) {
    o = o || {};
    ctx.fillStyle = o.border || '#0a0618';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = o.edge || '#5c5cb8';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = o.bg || '#1a1440';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, 2);
  };

  // --------------------------------------------------------------- layout
  // gates: SHEEP GATES are on. The board then shrinks a little where needed, so the sheep waiting outside its
  // gates fit in the box, and the frame is left open where the gates stand.
  R.layout = function (board, gates) {
    const box = BC.BOARD_BOX;
    const b = board.bounds;
    const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
    const place = pad => {
      const unit = Math.min((box.w - 2 * pad) / bw, (box.h - 2 * pad) / bh);
      return { unit, ox: box.x + box.w / 2 - (b.minX + bw / 2) * unit, oy: box.y + box.h / 2 - (b.minY + bh / 2) * unit };
    };
    const P = gates && BC.Pasture;
    let f = place(26);
    for (let pad = 28; P && pad <= 80 && !P.fits(board, f); pad += 2) f = place(pad);
    const unit = f.unit, ox = f.ox, oy = f.oy;
    board.unit = unit; board.ox = ox; board.oy = oy;
    let area = 0;
    board.cells.forEach(c => {
      c.sx = ox + c.cx * unit;
      c.sy = oy + c.cy * unit;
      c.spoly = c.poly.map(p => [ox + p[0] * unit, oy + p[1] * unit]);
      const path = new Path2D();
      c.spoly.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
      path.closePath();
      c.path = path;
      area += c.area;
    });
    board.cellPx = Math.sqrt(area / board.cells.length) * unit;
    board.pieceScale = Math.max(1, Math.round(board.cellPx * 0.8 / 14));
    board.sprScale = Math.max(1, Math.round(board.cellPx * 0.85 / 16));
    board.iconScale = Math.max(1, Math.round(board.cellPx * 0.62 / 20));
    const frame = new Path2D();
    const cut = new Set();
    if (P) BC.Board.gateSpots(board).forEach(g => g.cut.forEach(k => cut.add(k)));
    board.boundary.forEach(([p, q]) => {
      if (cut.has(BC.Board.edgeKey(p, q))) return;
      frame.moveTo(ox + p[0] * unit, oy + p[1] * unit);
      frame.lineTo(ox + q[0] * unit, oy + q[1] * unit);
    });
    board.frame = frame;
    const mx = box.x + box.w / 2, my = box.y + box.h / 2;
    let maxD = 1;
    board.cells.forEach(c => { maxD = Math.max(maxD, Math.hypot(c.sx - mx, c.sy - my)); });
    board.cells.forEach(c => { c.flipDelay = Math.hypot(c.sx - mx, c.sy - my) / maxD * 0.9; });
    board.pat = BC.Assets.patterns(ctx, board.sprScale);
    board.gateView = null;
    board.pasture = null;
    if (P) P.layout(board);
  };

  R.cellAt = function (board, x, y) {
    for (const c of board.cells) if (ctx.isPointInPath(c.path, x, y)) return c.id;
    return -1;
  };

  // ---------------------------------------------------------------- board
  function flipState(G, c) {
    const f = G.flip;
    if (!f) return { mode: G.boardMode, scale: 1 };
    const k = (G.time - f.t0 - c.flipDelay) / 0.35;
    if (k <= 0) return { mode: f.from, scale: 1 };
    if (k >= 1) return { mode: f.to, scale: 1 };
    return { mode: k < 0.5 ? f.from : f.to, scale: Math.max(0.05, Math.abs(Math.cos(Math.PI * k))) };
  }

  function drawCells(G) {
    const board = G.board, occ = G.chess.occ;
    const pat = board.pat;
    for (const c of board.cells) {
      const f = flipState(G, c);
      ctx.save();
      if (f.scale !== 1) {
        ctx.translate(c.sx, c.sy);
        ctx.scale(1, f.scale);
        ctx.translate(-c.sx, -c.sy);
      }
      if (f.mode === 'chess') {
        ctx.fillStyle = c.shade ? CH_DARK : CH_LIGHT;
        ctx.fill(c.path);
        if (c.base >= 0) {
          ctx.fillStyle = u.rgba(BC.PLAYER_COLORS[c.base], c.shade ? 0.26 : 0.2);
          ctx.fill(c.path);
        }
        ctx.strokeStyle = 'rgba(60,30,10,0.45)';
      } else {
        const q = occ[c.id];
        ctx.fillStyle = q ? pat.block : pat.grass;
        ctx.fill(c.path);
        if (!q && c.shade) { ctx.fillStyle = 'rgba(0,30,0,0.16)'; ctx.fill(c.path); }
        if (q) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill(c.path); }
        ctx.strokeStyle = 'rgba(0,25,0,0.45)';
      }
      ctx.lineWidth = 1;
      ctx.stroke(c.path);
      ctx.restore();
    }
  }

  function drawFrame(G) {
    const board = G.board;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0a0618';
    ctx.lineWidth = 22;
    ctx.stroke(board.frame);
    ctx.strokeStyle = board.pat.wall;
    ctx.lineWidth = 16;
    ctx.stroke(board.frame);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke(board.frame);
    ctx.restore();
  }

  function pieceImg(pc) {
    const set = BC.Assets.pieces[pc.o < 0 ? -1 : pc.o];
    return set && set[pc.t];
  }

  // the shadow stays on the ground under a lifted piece and shrinks the higher it goes
  function pieceShadow(G, x, y, scale, lift) {
    const s = 14 * G.board.pieceScale * (scale || 1);
    const k = 1 / (1 + Math.max(0, lift || 0) / (s * 0.9));
    ctx.fillStyle = `rgba(0,0,0,${0.28 * k})`;
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.4, s * 0.36 * k, s * 0.12 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // lift: how far the piece floats above its spot (a hop, a bob)
  function drawPiece(G, pc, x, y, alpha, scale, white, noShadow, lift) {
    const board = G.board;
    const s = 14 * board.pieceScale * (scale || 1);
    const img = white ? BC.Assets.pieceWhite[pc.t] : pieceImg(pc);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    if (!noShadow) pieceShadow(G, x, y, scale, lift);
    y -= lift || 0;
    if (img) {
      ctx.drawImage(img, 0, 0, img.width, img.height, Math.round(x - s / 2), Math.round(y - s / 2 - s * 0.08), s, s);
    } else {
      ctx.fillStyle = pc.o < 0 ? BC.NEUTRAL_COLOR : BC.PLAYER_COLORS[pc.o];
      ctx.beginPath(); ctx.arc(x, y, s * 0.4, 0, Math.PI * 2); ctx.fill();
      R.text(pc.t, x, y - 6, { size: 12, align: 'center' });
    }
    ctx.globalAlpha = 1;
  }
  R.drawPiece = drawPiece;
  R.pieceShadow = pieceShadow;
  R.pieceImg = pieceImg;

  // extra: other things standing on the board ({ y, draw }: gates, sheep, bombers), drawn in with the pieces
  // from the back (top of the screen) to the front
  function drawPieces(G, extra) {
    const board = G.board, occ = G.chess.occ;
    const a = G.moveAnim;
    const SX = BC.SpecialFx;
    // kings put a helmet on while a tower, airstrike, nuke or blowing-up sheep comes down
    const helmet = SX && G.special && (BC.Specials.HELMET.includes(G.special.k) || G.special.boom);
    const list = extra.slice();
    occ.forEach((pc, i) => { if (pc && !(a && a.id === pc.id)) list.push({ y: board.cells[i].sy, pc, i }); });
    list.sort((p, q) => p.y - q.y);
    for (const it of list) {
      if (it.draw) { it.draw(); continue; }
      const pc = it.pc, i = it.i, c = board.cells[i];
      const y = c.sy;
      const lift = G.boardMode === 'chess' && G.selected === i ? 4 + Math.sin(G.time * 10) * 2 : 0;
      const doomed = G.phase === 'pawnLoss' && G.pawnLoss.some(l => l.id === pc.id && !l.boomed);
      if (doomed) {
        // shake harder and swell until it pops (the shadow stays put underneath)
        const k = Math.min(1, G.transT / 1.1);
        const j = 1 + k * 5;
        const flash = k > 0.3 && Math.floor(G.time * (8 + k * 20)) % 2 === 0;
        pieceShadow(G, c.sx, y, 1 + k * 0.45, 0);
        drawPiece(G, pc, c.sx + u.rand(-j, j), y, 1, 1 + k * 0.45, flash, true, k * 6 + u.rand(-j, j));
        continue;
      }
      drawPiece(G, pc, c.sx, y, 1, 1, false, false, lift);
      if (helmet && pc.t === 'K') SX.drawHelmet(G, i, c.sx, y - lift);
    }
    if (G.phase === 'pawnLoss') G.pawnGain.forEach(g => { if (!g.done) drawRevive(G, g); });
    if (a) {
      const p = board.cells[a.from], q = board.cells[a.to];
      const k = Math.min(1, a.t / a.dur);
      const e = 1 - Math.pow(1 - k, 3);
      const pc = occ[a.to];
      if (pc) drawPiece(G, pc, u.lerp(p.sx, q.sx, e), u.lerp(p.sy, q.sy, e), 1, 1, false, false, Math.sin(Math.PI * k) * 16);
    }
  }

  // a pawn earned with a bomber kill (or a comeback king) fades in under a beam of light before it lands
  function drawRevive(G, g) {
    const c = G.board.cells[g.cell];
    const k = Math.min(1, G.transT / 1.3);
    const col = BC.PLAYER_COLORS[g.p] || '#fff';
    const w = G.board.cellPx * 0.42;
    ctx.fillStyle = u.rgba(col, 0.4 * k);
    ctx.fillRect(c.sx - w / 2, c.sy - G.board.cellPx * 2, w, G.board.cellPx * 2 + 4);
    ctx.strokeStyle = u.rgba('#ffffff', 0.4 + 0.4 * Math.sin(G.time * 12));
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(c.sx, c.sy + G.board.cellPx * 0.25, w * (1.2 - 0.4 * k), w * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    const pc = { t: g.t || 'P', o: g.p };
    drawPiece(G, pc, c.sx, c.sy - (1 - k) * 24, k * 0.85, 1, false, true);
    drawPiece(G, pc, c.sx, c.sy - (1 - k) * 24, k * 0.5 * (0.5 + 0.5 * Math.sin(G.time * 20)), 1, true, true);
  }

  function drawPowerups(G) {
    const board = G.board;
    const s = 20 * board.iconScale;
    G.chess.powerups.forEach((id, cell) => {
      const c = board.cells[cell];
      const img = BC.Assets.icons[id];
      const bob = Math.round(Math.sin(G.time * 4 + cell) * 2);
      const sh = 1 + bob * 0.05;
      ctx.fillStyle = `rgba(0,0,0,${0.3 * sh})`;
      ctx.beginPath();
      ctx.ellipse(c.sx, c.sy + s * 0.5, s * 0.4 * sh, s * 0.12 * sh, 0, 0, Math.PI * 2);
      ctx.fill();
      if (img) ctx.drawImage(img, Math.round(c.sx - s / 2), Math.round(c.sy - s / 2 + bob - 2), s, s);
      if (((G.time * 3 + cell * 0.37) % 1) < 0.18) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(c.sx + s * 0.3), Math.round(c.sy - s * 0.55 + bob), 3, 3);
      }
    });
  }

  // sheep left behind by missed turns graze on their squares, now and then glancing about. Sheep from the
  // sheep gates wear a bell, and hop from square to square between the turns. Added to items ({ y, draw }).
  function sheepItems(G, items) {
    const SX = BC.SpecialFx, P = BC.Pasture;
    if (!SX || !G.chess.sheep) return;
    const roam = G.chess.roam;
    G.chess.sheep.forEach((id, cell) => {
      const c = G.board.cells[cell];
      const bell = !!(roam && roam.has(id));
      const hop = P && P.hop(G, id, c);
      if (hop) {
        items.push({ y: hop.ground, draw: () => SX.drawSheep(G, hop.x, hop.y, { ground: hop.ground, lift: hop.lift, eye: 'open', flip: hop.flip, run: hop.run, bell, k: hop.k }) });
        return;
      }
      const t = G.time + id * 1.37;
      const graze = t % 3.4 < 1.5;
      const eye = t % 2.9 < 0.12 ? 'shut' : 'open';
      const flip = Math.floor(t / 4.3) % 2 === 1;
      const hopUp = !graze && t % 3.4 > 3.1 ? Math.sin((t % 3.4 - 3.1) / 0.3 * Math.PI) * 5 : 0;
      items.push({ y: c.sy, draw: () => SX.drawSheep(G, c.sx, c.sy - hopUp, { ground: c.sy, lift: 2, eye, flip, graze, bell }) });
    });
  }

  function drawChessMarks(G) {
    const board = G.board;
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 6);
    const lm = G.chess.lastMove;
    if (lm) {
      ctx.fillStyle = 'rgba(255,240,60,0.32)';
      ctx.fill(board.cells[lm.from].path);
      ctx.fill(board.cells[lm.to].path);
    }
    G.players.forEach(pl => {
      if (!pl.alive || !pl.inCheck) return;
      const k = BC.Chess.kingCell(G.chess, pl.p);
      if (k < 0) return;
      ctx.fillStyle = `rgba(255,30,30,${0.35 + 0.35 * pulse})`;
      ctx.fill(board.cells[k].path);
    });
    if (G.selected >= 0) {
      // your own move to make: cyan; just looking (another player's piece or not your turn): soft lilac
      const live = G.selLive();
      const c = board.cells[G.selected];
      ctx.fillStyle = live ? 'rgba(80,255,255,0.35)' : 'rgba(190,150,255,0.45)';
      ctx.fill(c.path);
      ctx.strokeStyle = live ? `rgba(255,255,255,${0.6 + 0.4 * pulse})` : 'rgba(235,220,255,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke(c.path);
      const r = Math.max(4, board.cellPx * 0.13);
      G.legal.forEach(m => {
        const t = board.cells[m.to];
        if (m.cap) {
          ctx.strokeStyle = live ? 'rgba(255,40,60,0.9)' : 'rgba(255,150,60,0.75)';
          ctx.lineWidth = 3;
          ctx.stroke(t.path);
        } else if (live) {
          ctx.fillStyle = 'rgba(20,10,60,0.45)';
          ctx.beginPath(); ctx.arc(t.sx, t.sy, r, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(70,30,120,0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(t.sx, t.sy, r, 0, Math.PI * 2); ctx.stroke();
        }
      });
    }
    if (G.hover >= 0) {
      ctx.strokeStyle = G.humanTurn() ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke(board.cells[G.hover].path);
      drawSpecialHint(G);
    }
  }

  function aimedStrike(G) {
    const pc = G.chess.occ[G.hover];
    return pc && BC.Specials.KINDS.includes(pc.t) && G.legal.some(m => m.to === G.hover && m.cap) ? pc : null;
  }

  // aiming at a non-pawn capture: show where a rook's tower will fall (its name goes on top, drawHoverLabel)
  function drawSpecialHint(G) {
    const board = G.board, pc = aimedStrike(G);
    if (!pc || pc.t !== 'R') return;
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 10);
    BC.Specials.rookCells(board, G.hover).forEach(id => {
      ctx.fillStyle = `rgba(255,90,30,${0.25 + 0.2 * pulse})`;
      ctx.fill(board.cells[id].path);
    });
  }

  // the hovered square's label (the strike a capture sets off, or what a sheep does): drawn over the pieces
  function drawHoverLabel(G) {
    if (G.hover < 0) return;
    const board = G.board, c = board.cells[G.hover];
    const pc = aimedStrike(G);
    const y = c.sy - board.cellPx * 0.5 - 10;
    if (pc) {
      const info = BC.Specials.INFO[pc.t];
      R.text(info.hint, c.sx, y, { size: 8, align: 'center', color: info.col, outline: 3 });
    } else if (G.chess.sheep && G.chess.sheep.has(G.hover)) {
      R.text('STEP ON IT: STAMPEDE!', c.sx, y, { size: 8, align: 'center', color: '#fff', outline: 3 });
    }
  }

  // --------------------------------------------------------------- bomber
  function sheetTile(pos, dx, dy, dw, dh) {
    const A = BC.Assets;
    if (!A.ok.sheet) return;
    ctx.drawImage(A.img.sheet, pos[0] * 16, pos[1] * 16, 16, 16, dx, dy, dw, dh);
  }
  R.sheetTile = sheetTile;

  // Walker timeline (bm.anim): asleep -> eyes open -> feet pop out & wiggle -> stand up -> run (from WAKE_T)
  const WK = { eyes: 0.25, feet: 0.55, stand: 0.72 };
  const INK = '#140c1c';

  function walkerEyes(bm) {
    const a = bm.anim;
    if (a < WK.eyes) return 'shut';
    if (a < WK.eyes + 0.06) return 'half';
    if (a < 0.4) return 'wide';
    if (a < 0.45) return 'shut';
    if (bm.fuse < 0.7) return 'wide';
    return a % 1.7 < 0.08 ? 'shut' : 'open';
  }

  // drawn on the bomb's own 16px pixel grid so the eyes and legs match the sprite
  function drawWalker(G, bm, S) {
    const A = BC.Assets, Bm = BC.Bomber;
    const k = G.board.sprScale, cells = G.board.cells;
    const p = cells[bm.from], q = cells[bm.to];
    const x = u.lerp(p.sx, q.sx, bm.t), y = u.lerp(p.sy, q.sy, bm.t);
    const vx = q.sx - p.sx, vy = q.sy - p.sy;
    const fx = Math.abs(vx) > Math.abs(vy) * 0.4 ? Math.sign(vx) : 0;
    const fy = Math.abs(vy) > Math.abs(vx) * 0.4 ? Math.sign(vy) : 0;
    const a = bm.anim;
    let lift = 0, jx = 0, upL = 0, upR = 0;
    if (a >= Bm.WAKE_T) {
      const ph = Math.floor(a * 4 / Bm.WALK_STEP) % 4;
      lift = ph % 2 ? 5 : 6;
      upL = ph === 0 ? 1 : 0;
      upR = ph === 2 ? 1 : 0;
    } else if (a >= WK.stand) {
      const s = (a - WK.stand) / (Bm.WAKE_T - WK.stand);
      lift = Math.round(s < 0.6 ? 1 + 6 * s / 0.6 : 7 - 2 * (s - 0.6) / 0.4);
    } else if (a >= WK.feet) {
      lift = 1;
      jx = Math.floor(a * 24) % 2 ? 1 : -1;
    }
    const ox = Math.round(x - S / 2) + jx * k, oy = Math.round(y - S / 2 - S * 0.06);
    const px = (cx, cy, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(ox + cx * k, oy + cy * k, w * k, h * k); };

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + S * 0.36, S * (0.34 - lift * 0.015), S * 0.11, 0, 0, Math.PI * 2); ctx.fill();

    const feet = a >= WK.feet;
    const legs = [[6, upL], [11, upR]].map(([lx, up]) => [lx + (up ? fx : 0), up]);
    if (feet) legs.forEach(([lx, up]) => px(lx, 13 - lift, 1, lift + 1 - up, INK));

    if (bm.diag) drawDynamite(G, bm, ox, oy - lift * k, S, Bm.WALK_FUSE);
    else sheetTile(A.SHEET.bomb[u.clamp(Math.floor((1 - bm.fuse / Bm.WALK_FUSE) * 6), 0, 5)], ox, oy - lift * k, S, S);

    const eye = walkerEyes(bm);
    const ey = 8 - lift + (fy < 0 ? -1 : 0);
    [5, 10].forEach((ex0, i) => {
      const ex = ex0 + fx;
      const pupX = ex + (fx > 0 ? 1 : fx < 0 ? 0 : 1 - i);
      if (eye === 'shut') { px(ex, ey + 2, 2, 1, INK); return; }
      if (eye === 'half') { px(ex, ey + 1, 2, 2, '#fff'); px(ex, ey + 1, 2, 1, INK); px(pupX, ey + 2, 1, 1, INK); return; }
      px(ex, ey, 2, 3, '#fff');
      if (eye === 'wide') px(pupX, ey + 1, 1, 1, INK);
      else px(pupX, fy < 0 ? ey : ey + 1, 1, 2, INK);
    });

    if (feet) legs.forEach(([lx, up]) => {
      const sx = lx - 1 + fx;
      px(sx, 14 - up, 3, 1, '#e8313c');
      px(sx, 15 - up, 3, 1, '#8c1822');
      px(sx, 14 - up, 1, 1, '#ff9a9a');
    });

    if (a >= WK.eyes + 0.06 && a < WK.feet) {
      R.text('!', ox + 14 * k, oy - 3 * k, { size: Math.max(8, Math.round(S / 3)), align: 'center', color: '#ffe14a', outline: 3 });
    }
  }

  // X-bomb: crossed dynamite on the 16px sprite grid at (x, y), drawn s wide; the fuse burns down to the
  // sticks, a spark fizzes at its tip and the sticks flash white just before they blow
  function drawDynamite(G, bm, x, y, s, maxFuse) {
    const frames = BC.Assets.xbombFrames(G.board);
    const k = s / 16;
    const fi = u.clamp(Math.floor((1 - bm.fuse / maxFuse) * frames.length), 0, frames.length - 1);
    const f = frames[fi];
    const ox = x - 2 * k, oy = y - 2 * k;
    const flash = bm.fuse < 0.8 && Math.floor(bm.anim * 16) % 2 === 0;
    ctx.drawImage(flash ? f.white : f.img, Math.round(ox), Math.round(oy), Math.round(20 * k), Math.round(20 * k));
    const px = (cx, cy, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(ox + cx * k), Math.round(oy + cy * k), Math.ceil(k), Math.ceil(k)); };
    const ph = Math.floor(G.time * 18) % 3;
    const [tx, ty] = f.tip;
    const arm = ph === 1 ? '#ff8a1c' : '#ffe14a';
    px(tx - 1, ty, arm); px(tx + 1, ty, arm); px(tx, ty - 1, arm);
    if (ph !== 1) px(tx, ty + 1, arm);
    if (ph === 2) { px(tx - 1, ty - 1, '#ff8a1c'); px(tx + 1, ty - 1, '#ff8a1c'); }
    px(tx, ty, '#fff');
  }

  function drawBombs(G, ps) {
    const board = G.board, S = 16 * board.sprScale;
    const A = BC.Assets;
    ps.bombs.forEach(bm => {
      if (bm.walk) { drawWalker(G, bm, S); return; }
      let { sx: x, sy: y } = board.cells[bm.cell];
      // a kicked bomb sliding between two cells
      if (bm.from !== undefined && bm.from !== bm.to) {
        const p = board.cells[bm.from], q = board.cells[bm.to];
        x = u.lerp(p.sx, q.sx, bm.t); y = u.lerp(p.sy, q.sy, bm.t);
      }
      const pulse = 1 + 0.09 * Math.sin(bm.anim * (bm.fuse < 0.8 ? 30 : 12));
      const s = S * pulse;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(x, y + S * 0.36, S * 0.34, S * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      if (bm.diag) { drawDynamite(G, bm, x - s / 2, y - s / 2 - S * 0.06, s, BC.Bomber.FUSE); return; }
      const fi = u.clamp(Math.floor((1 - bm.fuse / BC.Bomber.FUSE) * 6), 0, 5);
      sheetTile(A.SHEET.bomb[fi], Math.round(x - s / 2), Math.round(y - s / 2 - S * 0.06), s, s);
    });
  }

  // ---- closing walls (from the third bomber round)
  // a raised block: wall bricks with a lit top-left bevel and a dark bottom-right one
  function wallBlock(G, c, dy, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, dy);
    ctx.fillStyle = G.board.pat.wall;
    ctx.fill(c.path);
    ctx.save();
    ctx.clip(c.path);
    ctx.translate(2, 2);
    ctx.strokeStyle = 'rgba(255,240,220,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke(c.path);
    ctx.translate(-4, -4);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 4;
    ctx.stroke(c.path);
    ctx.restore();
    ctx.strokeStyle = 'rgba(10,6,24,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke(c.path);
    ctx.restore();
  }

  // cells already walled in, and blinking warnings with the incoming block's shadow on the ground
  function drawWalls(G, ps) {
    if (!ps.order || !ps.order.length) return;
    const board = G.board, occ = G.chess.occ, Bm = BC.Bomber;
    for (const id of ps.order) {
      const left = ps.closeAt[id] - ps.clock;
      if (left > Bm.WARN_T) break;
      if (occ[id]) continue;
      const c = board.cells[id];
      if (left <= 0) { wallBlock(G, c, 0, 1); continue; }
      // the incoming block's shadow darkens the cell; it pulses red with a warning mark until the block lands
      const k = 1 - left / Bm.WARN_T;
      ctx.fillStyle = `rgba(0,0,0,${0.1 + 0.35 * k})`;
      ctx.fill(c.path);
      if (left > Bm.DROP_T) {
        const on = Math.floor(G.time * (left < 0.8 ? 14 : 7)) % 2 === 0;
        ctx.fillStyle = `rgba(255,30,30,${on ? 0.45 : 0.18})`;
        ctx.fill(c.path);
        ctx.strokeStyle = on ? '#ffe14a' : 'rgba(255,90,60,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke(c.path);
        if (on) R.text('!', c.sx, c.sy - 7, { size: Math.max(10, Math.round(board.cellPx * 0.3)), align: 'center', color: '#ffe14a', outline: 4 });
      }
    }
  }

  // blocks on their way down are drawn over everything standing on the board, and a landed block covers
  // whoever it squashed (only the flattened edges peek out)
  function drawFallingWalls(G, ps) {
    if (!ps.order || !ps.order.length) return;
    const board = G.board, occ = G.chess.occ, Bm = BC.Bomber;
    for (const id of ps.order) {
      const left = ps.closeAt[id] - ps.clock;
      if (left > Bm.DROP_T) break;
      if (left <= 0 || occ[id]) continue;
      const k = 1 - left / Bm.DROP_T;
      wallBlock(G, board.cells[id], -(1 - k * k) * board.cellPx * 1.8, Math.min(1, 0.35 + k));
    }
    ps.bombers.forEach(b => {
      if (!b.alive || !b.dying || !b.crushed) return;
      const id = b.t < 0.5 ? b.from : b.to;
      if (ps.closeAt[id] <= ps.clock) wallBlock(G, board.cells[id], 0, 1);
    });
  }

  function drawFlames(G, ps) {
    const board = G.board, S = 16 * board.sprScale;
    const A = BC.Assets;
    if (!A.ok.sheet) {
      ctx.fillStyle = 'rgba(255,160,40,0.8)';
      ps.flames.forEach((t, c) => ctx.fill(board.cells[c].path));
      return;
    }
    const sh = A.img.sheet;
    ps.explosions.forEach(e => {
      const k = e.t / e.dur;
      const grow = k < 0.15 ? k / 0.15 : k > 0.7 ? Math.max(0, (1 - k) / 0.3) : 1;
      const h = S * (0.45 + 0.55 * grow);
      const flick = Math.floor(e.t * 20) % 2;
      const c0 = board.cells[e.center];
      e.arms.forEach(arm => {
        let px = c0.sx, py = c0.sy;
        arm.forEach((id, i) => {
          const c = board.cells[id];
          const ang = Math.atan2(c.sy - py, c.sx - px);
          const len = Math.hypot(c.sx - px, c.sy - py);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(ang);
          ctx.drawImage(sh, 16 + flick, 18 * 16, 14, 16, 0, -h / 2, len + 1, h);
          ctx.restore();
          if (i === arm.length - 1) {
            ctx.save();
            ctx.translate(c.sx, c.sy);
            ctx.rotate(ang);
            ctx.drawImage(sh, 3 * 16, 18 * 16, 16, 16, -S / 2, -h / 2, S, h);
            ctx.restore();
          }
          px = c.sx; py = c.sy;
        });
      });
      const cs = S * (0.7 + 0.45 * grow);
      sheetTile(A.SHEET.flameC, c0.sx - cs / 2, c0.sy - cs / 2, cs, cs);
    });
  }

  function bomberPos(G, b) {
    if (b.px !== undefined) return [b.px, b.py];
    const cells = G.board.cells;
    const p = cells[b.from], q = cells[b.to];
    return [u.lerp(p.sx, q.sx, b.t), u.lerp(p.sy, q.sy, b.t)];
  }
  R.bomberPos = bomberPos;

  function bomberFrame(b) {
    const f = Math.floor(b.anim * 9) % 4;
    const mv = b.anim > 0;
    switch (b.face) {
      case 'up': return mv ? [0, 8, 0, 9][f] : 0;
      case 'right': return mv ? [4, 5, 6, 7][f] : 4;
      case 'left': return mv ? [10, 11, 12, 13][f] : 10;
      default: return mv ? [1, 2, 1, 3][f] : 1;
    }
  }

  R.drawChar = function (p, frame, x, y, s, white) {
    const A = BC.Assets;
    const img = white ? A.charWhite[p] : A.chars[p];
    if (img && A.ok.sheet) {
      ctx.drawImage(img, frame * 16, 0, 16, 16, Math.round(x), Math.round(y), s, s);
    } else {
      ctx.fillStyle = BC.PLAYER_COLORS[p];
      ctx.fillRect(x + s * 0.2, y + s * 0.1, s * 0.6, s * 0.85);
    }
  };

  const DEATH_T = 1.5;
  // the hit flash before a knocked-out bomber flies off (or, with BLOOD on, bursts: gore.js)
  const DEATH_HIT = R.DEATH_HIT = 0.45;

  // Knocked out: a moment of hit-flash, then the bomber spins up and away in a ring of sparkles, pivoting on
  // its own middle. Its shadow stays flat on the ground and shrinks as it lifts off. Walls squash it flat.
  function drawDeath(G, b, x, y, S) {
    const T = b.deathT;
    const groundY = y + S * 0.38, midY = y - S * 0.12;
    const shadow = (w, a) => {
      ctx.fillStyle = `rgba(0,0,0,${0.32 * a})`;
      ctx.beginPath(); ctx.ellipse(x, groundY, S * 0.3 * w, S * 0.1 * w, 0, 0, Math.PI * 2); ctx.fill();
    };
    if (b.crushed) {
      const k = Math.min(1, T / 0.18);
      const fade = T > 0.9 ? Math.max(0, 1 - (T - 0.9) / (DEATH_T - 0.9)) : 1;
      shadow(1 + 0.4 * k, fade);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(x, groundY - S * 0.04);
      ctx.scale(1 + 0.45 * k, Math.max(0.16, 1 - 0.84 * k));
      R.drawChar(b.p, 1, -S / 2, -S * 0.96, S, T < 0.3 && Math.floor(G.time * 20) % 2 === 0);
      ctx.restore();
      return;
    }
    const HIT = DEATH_HIT;
    if (T < HIT) {
      const j = (1 - T / HIT) * S * 0.06;
      shadow(1, 1);
      R.drawChar(b.p, 1, x - S / 2 + u.rand(-j, j), y - S * 0.62 + u.rand(-j, j), S, Math.floor(G.time * 20) % 2 === 0);
      return;
    }
    // BLOOD: the bomber has burst into bits (gore.js), there's nothing left to fly off
    if (G.cfg && G.cfg.blood && BC.Gore) return;
    const k = Math.min(1, (T - HIT) / (DEATH_T - HIT - 0.05));
    const e = k * k;
    const rise = S * 0.7 * e;
    shadow(1 - 0.75 * k, 1 - k);
    if (k < 0.5) {
      ctx.strokeStyle = u.rgba('#ffffff', 0.9 * (1 - k * 2));
      ctx.lineWidth = Math.max(1, 4 * (1 - k * 2));
      ctx.beginPath(); ctx.arc(x, midY, S * (0.3 + k * 1.6), 0, Math.PI * 2); ctx.stroke();
    }
    const s = S * (1 - 0.85 * k);
    ctx.save();
    ctx.globalAlpha = 1 - 0.6 * k;
    ctx.translate(x, midY - rise);
    ctx.rotate(e * 10 + k * 4);
    R.drawChar(b.p, 1, -s / 2, -s / 2, s, false);
    ctx.restore();
    const sz = Math.max(2, Math.round(S / 12));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + k * 4;
      const r = S * (0.2 + 0.9 * k);
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.fillStyle = i % 2 ? '#ffffff' : BC.PLAYER_COLORS[b.p];
      ctx.fillRect(Math.round(x + Math.cos(a) * r - sz / 2), Math.round(midY - rise * 0.5 + Math.sin(a) * r - sz / 2), sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  // the bombers as { y, draw } items, sorted in with the pieces and gates; their name tags go on top later
  function bomberItems(G, ps, items) {
    const S = 16 * G.board.sprScale;
    ps.bombers.forEach(b => {
      if (!b.alive) return;
      const [x, y] = bomberPos(G, b);
      items.push({ y, draw: () => drawBomber(G, b, x, y, S) });
    });
  }

  function drawBomber(G, b, x, y, S) {
    if (b.dying) { drawDeath(G, b, x, y, S); return; }
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath(); ctx.ellipse(x, y + S * 0.38, S * 0.3, S * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    if (b.flamepass) {
      ctx.strokeStyle = `rgba(255,120,220,${0.4 + 0.3 * Math.sin(G.time * 8)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - S * 0.1, S * 0.55, 0, Math.PI * 2); ctx.stroke();
    }
    const blink = b.invuln > 0 && Math.floor(G.time * 16) % 2 === 0;
    R.drawChar(b.p, bomberFrame(b), x - S / 2, y - S * 0.62, S, blink);
  }

  function drawBomberTags(G, ps) {
    const S = 16 * G.board.sprScale;
    ps.bombers.forEach(b => {
      if (!b.alive || b.dying) return;
      const [x, y] = bomberPos(G, b);
      const mine = G.mode === 'net' && G.isMine(b.p);
      // players already out of the chess game still bomb around; their tag is greyed out
      const out = G.players[b.p] && !G.players[b.p].alive;
      R.text(mine ? 'YOU' : BC.PLAYER_NAMES[b.p], x, y - S * 0.62 - 12, { size: 8, align: 'center', color: mine ? '#fff' : out ? '#9a9aa8' : BC.PLAYER_COLORS[b.p], outline: 3 });
      if (mine) {
        ctx.fillStyle = BC.PLAYER_COLORS[b.p];
        ctx.beginPath();
        ctx.moveTo(x - 5, y - S * 0.62 - 2); ctx.lineTo(x + 5, y - S * 0.62 - 2); ctx.lineTo(x, y - S * 0.62 + 4);
        ctx.fill();
      }
    });
  }

  function drawParticles(G) {
    G.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.5));
      if (p.img) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(p.img, p.sx, p.sy, p.sw, p.sh, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
        return;
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }

  function drawFx(G) {
    const A = BC.Assets;
    G.fx.forEach(f => {
      if (f.t < 0) return;
      const k = f.t / f.dur;
      if (f.type === 'ring') {
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = Math.max(1, 8 * (1 - k));
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.2 + k), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.type === 'boom' && A.ok.sheet) {
        const fr = A.SHEET.burst[Math.min(2, Math.floor(k * 4))];
        const s = f.size * (0.6 + 0.6 * Math.sin(Math.min(1, k * 1.3) * Math.PI * 0.5));
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        sheetTile(fr, Math.round(f.x - s / 2), Math.round(f.y - s / 2), s, s);
        sheetTile(A.SHEET.flameC, Math.round(f.x - s * 0.35), Math.round(f.y - s * 0.35), s * 0.7, s * 0.7);
        ctx.globalAlpha = 1;
      } else if (f.type === 'puff') {
        // soft dust / smoke cloud that swells, drifts up and fades
        ctx.globalAlpha = (1 - k) * (f.alpha || 0.6);
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y - k * (f.rise || 0), f.r * (0.4 + 0.6 * Math.sqrt(k)), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    });
  }

  // ------------------------------------------------------------------ HUD
  // main HUD panel, and the power-up column at the right edge of the screen
  const HX = 724, HW = 480;
  const PU_COL = { x: HX + HW + 10, y: 12, w: BC.W - 12 - (HX + HW + 10), h: 696 };

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function drawHUD(G) {
    R.panel(HX, 12, HW, 696, { bg: '#140f34', edge: '#4a3fa0' });
    R.text('BOMBER', HX + 18, 26, { size: 22, color: '#ff5a3c', outline: 5 });
    R.text('CHESS', HX + 18 + R.measure('BOMBER ', 22), 26, { size: 22, color: '#ffe14a', outline: 5 });
    R.text('ボンバーチェス', HX + HW - 18, 24, { size: 20, jp: true, align: 'right', color: '#9fe8ff' });

    // phase box
    const py = 62;
    const bomberish = G.phase === 'bomber' || G.phase === 'toBomber';
    R.panel(HX + 12, py, HW - 24, 104, { bg: bomberish ? '#3a0f1a' : '#0f2a3a', edge: bomberish ? '#ff5a3c' : '#3fc0ff' });
    if (bomberish) {
      R.text('BOMBER PHASE', HX + 26, py + 12, { size: 18, color: '#ff8a5c' });
      R.text('ボンバータイム', HX + HW - 26, py + 10, { size: 18, jp: true, align: 'right', color: '#ffb0a0' });
      const ps = G.bomber;
      const left = ps ? ps.dur - ps.clock : G.cfg.bomberTime;
      const hurry = left < 10 && Math.floor(G.time * 4) % 2 === 0;
      R.text('TIME ' + fmtTime(left), HX + 26, py + 44, { size: 26, color: hurry ? '#ff3030' : '#fff' });
      if (ps && ps.round) R.text('ROUND ' + ps.round, HX + HW - 26, py + 50, { size: 12, align: 'right', color: '#ffb0a0' });
      if (ps && ps.sk > ps.pre) {
        const closing = ps.first < ps.order.length && ps.clock >= ps.closeAt[ps.order[ps.first]] - BC.Bomber.WARN_T;
        R.text('THE WALLS CLOSE IN ONE MORE ROW!', HX + 26, py + 82, { size: 8, color: closing && Math.floor(G.time * 4) % 2 === 0 ? '#ffe14a' : '#ffb040' });
      } else if (ps && ps.pre > 0) {
        R.text('THE ARENA CAN\'T GET ANY SMALLER', HX + 26, py + 82, { size: 8, color: '#ffb040' });
      } else {
        R.text('ENDS AT 0:00 OR WHEN ONE BOMBER IS LEFT', HX + 26, py + 82, { size: 8, color: '#c9a' });
      }
    } else {
      R.text('CHESS PHASE', HX + 26, py + 12, { size: 18, color: '#7fd8ff' });
      R.text('チェスタイム', HX + HW - 26, py + 10, { size: 18, jp: true, align: 'right', color: '#b0f0ff' });
      const pl = G.players[G.turn];
      if (pl) {
        R.text('TURN', HX + 26, py + 46, { size: 14, color: '#fff' });
        R.text(BC.PLAYER_NAMES[pl.p] + (pl.type === 'CPU' ? ' CPU' : ''), HX + 100, py + 42, { size: 22, color: BC.PLAYER_COLORS[pl.p] });
      }
      R.text('BOMBER IN', HX + 290, py + 40, { size: 10, color: '#fd8' });
      R.text(String(Math.max(0, G.pliesLeft)), HX + 290, py + 56, { size: 22, color: '#ffe14a' });
      R.text('MOVES', HX + 290 + R.measure(String(Math.max(0, G.pliesLeft)) + ' ', 22), py + 64, { size: 10, color: '#fd8' });
      drawTurnClock(G, HX + 26, py + 80, HW - 52);
    }

    // player cards
    const n = G.players.length;
    const ch = n === 5 ? 82 : 92;
    let y = py + 118;
    G.players.forEach(pl => { drawCard(G, pl, HX + 12, y, HW - 24, ch - 8); y += ch; });

    // footer help
    const fy = 616;
    R.panel(HX + 12, fy, HW - 24, 80, { bg: '#100c28', edge: '#3a3480' });
    if (bomberish) {
      R.text('BOMBERS: KEYS ON EACH CARD  PAD: A=BOMB', HX + 24, fy + 12, { size: 8, color: '#ccd' });
      R.text('PIECES ARE UNBREAKABLE WALLS', HX + 24, fy + 30, { size: 8, color: '#fc9' });
      R.text('GET HIT = LOSE A PAWN   KILL = REVIVE ONE', HX + 24, fy + 46, { size: 8, color: '#fc9' });
    } else {
      R.text('CLICK ANY PIECE TO SEE ITS MOVES', HX + 24, fy + 12, { size: 8, color: '#ccd' });
      R.text('RIGHT-CLICK: DESELECT  MATE = OUT+NUKE', HX + 24, fy + 30, { size: 8, color: '#ccd' });
      R.text('CAPTURE A KING = PLAYER OUT', HX + 24, fy + 46, { size: 8, color: '#fc9' });
    }
    R.text('ESC: MENU   M: MUTE' + (BC.Audio.isMuted() ? ' (OFF)' : ''), HX + 24, fy + 62, { size: 8, color: '#889' });
    if (G.cfg && G.cfg.chain) R.text('CHAINED DEATHS ON', HX + 236, fy + 62, { size: 8, color: '#ff9af0' });
    drawMenuButton(G);
    if (G.mode === 'net') {
      const N = BC.Net;
      const ok = N.status === 'online';
      R.text(ok ? 'LAN ' + N.rtt + 'MS' : 'RECONNECTING...', HX + HW - 24, fy + 62, { size: 8, align: 'right', color: ok ? (N.rtt < 60 ? '#6f6' : '#fd4') : '#f55' });
    }
  }

  // the chess turn's clock: a bar that drains, red and blinking for the last seconds
  function turnLow(G) {
    return G.phase === 'chess' && !G.moveAnim && !G.special && G.S && G.S.turnLeft <= 5.5;
  }

  function drawTurnClock(G, x, y, w) {
    const total = (G.cfg && G.cfg.turnTime) || BC.TURN_TIME.def;
    const left = Math.max(0, G.S ? G.S.turnLeft : total);
    const pl = G.players[G.turn];
    const low = turnLow(G);
    const flash = low && Math.floor(G.time * 6) % 2 === 0;
    R.text('CLOCK', x, y + 2, { size: 8, color: low ? '#ff6060' : '#9cc' });
    const bx = x + 50, bw = w - 50 - 44;
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(bx - 2, y - 1, bw + 4, 13);
    ctx.fillStyle = flash ? '#ff3030' : low ? '#ff8a3c' : pl ? BC.PLAYER_COLORS[pl.p] : '#7fd8ff';
    ctx.fillRect(bx, y + 1, Math.round(bw * u.clamp(left / total, 0, 1)), 9);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(bx, y + 1, Math.round(bw * u.clamp(left / total, 0, 1)), 2);
    R.text(fmtTime(left), x + w, y + 1, { size: 10, align: 'right', color: flash ? '#ff3030' : '#fff' });
  }

  // clickable in-game menu button (same as ESC)
  R.MENU_BTN = { x: HX + HW - 24 - 100, y: 624, w: 100, h: 30 };
  function drawMenuButton(G) {
    const b = R.MENU_BTN, m = BC.Input.mouse;
    const over = m.x >= b.x && m.x <= b.x + b.w && m.y >= b.y && m.y <= b.y + b.h;
    R.panel(b.x, b.y, b.w, b.h, { bg: over || G.paused ? '#2c2470' : '#18143c', edge: over || G.paused ? '#ffe14a' : '#5c5cb8' });
    const lx = b.x + 14, ly = b.y + 9;
    ctx.fillStyle = over ? '#ffe14a' : '#fff';
    for (let i = 0; i < 3; i++) ctx.fillRect(lx, ly + i * 5, 14, 3);
    R.text('MENU', b.x + 38, b.y + 10, { size: 10, color: over ? '#ffe14a' : '#fff' });
  }

  function drawCard(G, pl, x, y, w, h) {
    const col = BC.PLAYER_COLORS[pl.p];
    const active = G.phase === 'chess' && G.turn === pl.p && pl.alive;
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 6);
    R.panel(x, y, w, h, { bg: pl.alive ? '#1c1648' : '#151320', edge: active ? `rgba(255,255,255,${0.5 + 0.5 * pulse})` : (pl.alive ? col : '#444') });
    ctx.fillStyle = pl.alive ? col : '#444';
    ctx.fillRect(x, y, 6, h);
    // portrait
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(x + 14, y + 8, 44, 44);
    ctx.fillStyle = u.rgba(col, pl.alive ? 0.45 : 0.15);
    ctx.fillRect(x + 16, y + 10, 40, 40);
    ctx.globalAlpha = pl.alive ? 1 : 0.35;
    R.drawChar(pl.p, active ? [1, 2, 1, 3][Math.floor(G.time * 6) % 4] : 1, x + 20, y + 14, 32);
    ctx.globalAlpha = 1;

    R.text(BC.PLAYER_NAMES[pl.p], x + 70, y + 10, { size: 16, color: pl.alive ? col : '#666' });
    const brain = G.cfg && G.cfg.brain !== undefined ? BC.BRAINS[G.cfg.brain] : '';
    const tag = pl.type === 'CPU' ? 'CPU' + (brain ? ' ' + brain : '') : (pl.name || 'HUMAN');
    R.text(tag, x + 116, y + 14, { size: 8, color: pl.type === 'CPU' ? '#9cf' : '#fff' });
    if (G.mode === 'net' && G.isMine(pl.p)) R.text('YOU', x + 124 + R.measure(tag, 8), y + 14, { size: 8, color: '#ffe14a' });
    const pieces = G.chess.occ.filter(q => q && q.o === pl.p).length;
    R.text('PIECES ' + pieces, x + 70, y + 34, { size: 8, color: '#bbc' });

    let status = '';
    let scol = '#fff';
    if (!pl.alive) { status = pl.outReason || 'OUT'; scol = '#f55'; }
    else if (pl.inCheck && G.phase === 'chess') { status = 'CHECK!'; scol = pulse > 0.5 ? '#ff3030' : '#ffd040'; }
    else if (active) { status = pl.type === 'CPU' ? 'THINKING' : (G.isMine(pl.p) ? 'YOUR MOVE' : 'MOVING'); scol = '#ffe14a'; }
    if (status) R.text(status, x + w - 12, y + 10, { size: 10, align: 'right', color: scol });
    if (!pl.alive && G.cfg && G.cfg.revive && !G.over) {
      R.text('WIN A BOMBER ROUND = BACK IN', x + w - 12, y + 23, { size: 7, align: 'right', color: Math.floor(G.time * 2) % 2 ? '#ffe14a' : '#bba', shadow: false });
    }

    // stats
    const A = BC.Assets;
    const iy = y + h - 26;
    let ix = x + 70;
    const stat = (id, v) => {
      if (A.icons[id]) ctx.drawImage(A.icons[id], ix, iy, 20, 20);
      R.text('x' + v, ix + 22, iy + 6, { size: 10, color: '#fff' });
      ix += 58;
    };
    stat('bomb', pl.stats.bomb);
    stat('fire', pl.stats.fire);
    stat('speed', pl.stats.speed);
    if (pl.stats.kick) stat('kick', pl.stats.kick);
    BC.SPECIALS.forEach(sp => {
      if (!pl.sp[sp]) return;
      if (A.icons[sp]) ctx.drawImage(A.icons[sp], ix, iy, 20, 20);
      ix += 24;
    });
    // knocked-out players still play the bomber rounds, so they keep seeing their keys
    if (pl.type === 'HUMAN' && G.isMine(pl.p)) {
      const s = BC.Input.SCHEMES[G.localIdx(pl.p)];
      if (s) R.text(s.label, x + w - 12, y + 32, { size: 7, align: 'right', color: '#8a8ab0', shadow: false });
    }
  }

  // ------------------------------------------------------- power-up column
  // every power-up down the right edge; click one for a card that explains it
  const PU_STEP = 68, PU_Y0 = PU_COL.y + 46, PU_ICON = 40;
  const puIconRect = i => ({ x: PU_COL.x + (PU_COL.w - PU_ICON) / 2, y: PU_Y0 + i * PU_STEP, w: PU_ICON, h: PU_ICON });
  const inRect = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  R.powerupAt = function (x, y) {
    for (let i = 0; i < BC.POWERUPS.length; i++) {
      const r = puIconRect(i);
      if (inRect({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }, x, y)) return BC.POWERUPS[i].id;
    }
    return null;
  };

  function puInfoRect(id) {
    const i = BC.POWERUPS.findIndex(p => p.id === id);
    const pu = BC.POWERUPS[i];
    const w = 420, h = 136 + pu.info.length * 16;
    const icon = puIconRect(i);
    const y = u.clamp(icon.y + icon.h / 2 - h / 2, 20, BC.H - 20 - h);
    return { x: PU_COL.x - 14 - w, y, w, h, iy: icon.y + icon.h / 2 };
  }
  R.inPowerInfo = (G, x, y) => !!G.puInfo && inRect(puInfoRect(G.puInfo), x, y);

  function drawPowerColumn(G) {
    const m = BC.Input.mouse;
    R.panel(PU_COL.x, PU_COL.y, PU_COL.w, PU_COL.h, { bg: '#140f34', edge: '#4a3fa0' });
    R.text('POWER', PU_COL.x + PU_COL.w / 2, PU_COL.y + 12, { size: 8, align: 'center', color: '#ffe14a' });
    R.text('UPS', PU_COL.x + PU_COL.w / 2, PU_COL.y + 24, { size: 8, align: 'center', color: '#ffe14a' });
    const hover = R.powerupAt(m.x, m.y);
    BC.POWERUPS.forEach((pu, i) => {
      const r = puIconRect(i);
      const on = G.puInfo === pu.id, over = hover === pu.id;
      if (i > 0 && BC.SPECIALS.includes(pu.id) && !BC.SPECIALS.includes(BC.POWERUPS[i - 1].id)) {
        // the first four stay for the whole game (kicks until used), the rest last one bomber round
        ctx.fillStyle = '#4a3fa0';
        ctx.fillRect(PU_COL.x + 6, r.y - PU_STEP / 2 + PU_ICON / 2 - 1, PU_COL.w - 12, 2);
      }
      if (on || over) {
        ctx.fillStyle = on ? '#ffe14a' : '#9fe8ff';
        ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
      }
      const img = BC.Assets.icons[pu.id];
      const bob = over ? -2 : 0;
      if (img) ctx.drawImage(img, r.x, r.y + bob, r.w, r.h);
      R.text('?', r.x + r.w + 1, r.y + r.h - 6, { size: 8, align: 'right', color: on ? '#140c1c' : '#ffe14a', outline: on ? 0 : 3, shadow: false });
    });
    R.text('CLICK', PU_COL.x + PU_COL.w / 2, PU_COL.y + PU_COL.h - 42, { size: 7, align: 'center', color: '#99a', shadow: false });
    R.text('FOR', PU_COL.x + PU_COL.w / 2, PU_COL.y + PU_COL.h - 31, { size: 7, align: 'center', color: '#99a', shadow: false });
    R.text('INFO', PU_COL.x + PU_COL.w / 2, PU_COL.y + PU_COL.h - 20, { size: 7, align: 'center', color: '#99a', shadow: false });
    if (hover && hover !== G.puInfo) {
      const r = puIconRect(BC.POWERUPS.findIndex(p => p.id === hover));
      const name = BC.POWERUP_BY_ID[hover].name;
      const w = R.measure(name, 10) + 20;
      R.panel(PU_COL.x - 10 - w, r.y + r.h / 2 - 14, w, 28, { bg: '#2c2470', edge: '#9fe8ff' });
      R.text(name, PU_COL.x - 10 - w / 2, r.y + r.h / 2 - 5, { size: 10, align: 'center', color: '#fff' });
    }
  }

  function drawPowerInfo(G) {
    if (!G.puInfo) return;
    const pu = BC.POWERUP_BY_ID[G.puInfo];
    const r = puInfoRect(G.puInfo);
    // a little pointer towards the icon it belongs to
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath();
    ctx.moveTo(r.x + r.w + 2, r.iy - 10); ctx.lineTo(r.x + r.w + 13, r.iy); ctx.lineTo(r.x + r.w + 2, r.iy + 10);
    ctx.fill();
    R.panel(r.x, r.y, r.w, r.h, { bg: '#1c1648', edge: '#ffe14a' });
    const img = BC.Assets.icons[pu.id];
    if (img) ctx.drawImage(img, r.x + 16, r.y + 16, 40, 40);
    R.text(pu.name, r.x + 70, r.y + 18, { size: 14, color: '#fff' });
    R.text(pu.jp, r.x + r.w - 16, r.y + 14, { size: 16, jp: true, align: 'right', color: '#9cf' });
    const max = BC.STAT_MAX[pu.id];
    const keep = pu.id === 'kick' ? BC.KICKS + ' KICKS EACH, KEPT UNTIL USED' : max ? 'KEPT FOR THE WHOLE GAME (UP TO ' + max + ')' : 'LASTS FOR THE NEXT BOMBER ROUND';
    R.text(keep, r.x + 70, r.y + 42, { size: 8, color: max || pu.id === 'kick' ? '#7fd8ff' : '#ffb040' });
    pu.info.forEach((line, i) => R.text(line, r.x + 16, r.y + 74 + i * 16, { size: 8, color: '#ddd' }));
    const fy = r.y + r.h - 46;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(r.x + 12, fy - 8, r.w - 24, 1);
    R.text('GRAB IT IN THE CHESS PHASE: MOVE A PIECE', r.x + 16, fy, { size: 7, color: '#9cc' });
    R.text('ONTO IT, OR SLIDE ACROSS IT.', r.x + 16, fy + 12, { size: 7, color: '#9cc' });
    R.text('CLICK TO CLOSE', r.x + r.w - 14, fy + 26, { size: 7, align: 'right', color: '#778', shadow: false });
  }

  // ------------------------------------------------------------ whose turn
  // a nameplate on the top edge of the board for as long as the chess turn lasts, with the turn's clock
  function drawTurnPlate(G) {
    if (G.phase !== 'chess' || G.flip || G.over) return;
    const pl = G.players[G.turn];
    if (!pl || !pl.alive) return;
    const board = G.board, box = BC.BOARD_BOX;
    const mine = pl.type === 'HUMAN' && G.isMine(pl.p);
    const col = BC.PLAYER_COLORS[pl.p];
    const low = turnLow(G);
    const flash = low && Math.floor(G.time * 6) % 2 === 0;
    const text = mine ? (low ? 'HURRY UP!' : 'YOUR TURN') : BC.PLAYER_NAMES[pl.p] + '\'S TURN' + (pl.type === 'CPU' ? ' (CPU)' : pl.name ? ' - ' + pl.name : '');
    const secs = String(Math.max(0, Math.ceil(G.S ? G.S.turnLeft : 0)));
    const tw = R.measure(text, 10), sw = R.measure(secs, 12);
    const w = tw + sw + 70, h = 26;
    const x = Math.round(box.x + box.w / 2 - w / 2);
    const top = board.oy + board.bounds.minY * board.unit;
    let y = Math.round(Math.max(2, top - 25));
    const clear = BC.Pasture && BC.Pasture.topClear(G, x, x + w);
    if (clear !== null && clear < y + h + 2) y = Math.round(Math.max(2, clear - h - 2));
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 6);
    R.panel(x, y, w, h, { bg: flash ? '#8a1020' : mine ? u.rgba(col, 0.35 + 0.25 * pulse) : '#140f34', edge: mine || low ? '#fff' : col });
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 4, h);
    R.drawChar(pl.p, [1, 2, 1, 3][Math.floor(G.time * 6) % 4], x + 8, y + 1, 24);
    R.text(text, x + 38, y + 8, { size: 10, color: mine || low ? '#fff' : col });
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(x + w - sw - 18, y + 3, sw + 12, h - 6);
    R.text(secs, x + w - 12, y + 7, { size: 12, align: 'right', color: low ? '#ff5050' : '#ffe14a', shadow: false });
  }

  // someone else's turn starts: a strip slides across the board (yours gets the full-screen R.yourTurn).
  // Other banners go first.
  R.turnBanner = function (G) {
    const tb = G.turnBanner;
    if (!tb || tb.mine || G.banner || G.phase !== 'chess') return;
    const pl = G.players[tb.p];
    if (!pl) return;
    const box = BC.BOARD_BOX;
    const col = BC.PLAYER_COLORS[tb.p];
    const k = tb.t / tb.dur;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    let off = 0;
    if (k < 0.18) off = (1 - u.easeOutBack(k / 0.18)) * 900;
    else if (k > 0.82) off = -((k - 0.82) / 0.18) * 900;
    const hgt = 64;
    const fade = k < 0.12 ? k / 0.12 : k > 0.88 ? (1 - k) / 0.12 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(box.x, cy - hgt / 2 - 4, box.w, hgt + 8);
    ctx.fillStyle = col;
    ctx.fillRect(box.x, cy - hgt / 2, box.w, 4);
    ctx.fillRect(box.x, cy + hgt / 2 - 4, box.w, 4);
    ctx.restore();
    const brain = G.cfg && G.cfg.brain !== undefined ? BC.BRAINS[G.cfg.brain] : '';
    const who = pl.type === 'CPU' ? 'CPU' + (brain ? ' - ' + brain : '') : (pl.name || 'HUMAN');
    R.text(BC.PLAYER_NAMES[tb.p] + '\'S TURN', cx + off, cy - 22, { size: 24, align: 'center', color: col, outline: 6 });
    R.text(who, cx - off * 0.7, cy + 12, { size: 9, align: 'center', color: '#fff', outline: 4 });
  };

  // It's YOUR turn: an arcade band sweeps across the screen, the letters slam in one by one with a shine
  // running over them and your bomber dances on both sides. A click or key skips it.
  R.YOUR_TURN_T = 1.6;

  function slamWord(word, cx, y, size, t0, t, col) {
    const w = R.measure(word, size);
    const shine = Math.floor((t - t0) * 14) % (word.length + 8);
    let x = cx - w / 2;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i], cw = R.measure(ch, size);
      const k = u.clamp((t - t0 - i * 0.04) / 0.12, 0, 1);
      if (k > 0) {
        const sc = 1 + (1 - u.easeOutBack(k)) * 0.7;
        const bob = Math.sin(t * 6 + i * 0.8) * size * 0.03;
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.translate(x + cw / 2, y + size / 2 + bob);
        ctx.scale(sc, sc);
        R.text(ch, size * 0.08, -size / 2 + size * 0.08, { size, align: 'center', color: '#000', shadow: false });
        R.text(ch, 0, -size / 2, { size, align: 'center', color: i === shine ? '#ffffff' : col, outline: Math.round(size / 7), outlineColor: '#140c1c' });
        ctx.restore();
      }
      x += cw;
    }
  }

  R.yourTurn = function (G) {
    const tb = G.turnBanner;
    if (!tb || !tb.mine || G.banner || G.phase !== 'chess') return;
    const W = BC.W, H = BC.H, t = tb.t, dur = tb.dur;
    const col = BC.PLAYER_COLORS[tb.p], dark = BC.PLAYER_DARK[tb.p];
    const inK = u.clamp(t / 0.2, 0, 1);
    const outK = u.clamp((t - (dur - 0.3)) / 0.3, 0, 1);
    const open = (inK < 1 ? u.easeOutBack(inK) : 1) * (1 - outK * outK);
    const live = 1 - outK;
    const cx = W / 2, cy = H / 2;
    ctx.save();
    ctx.fillStyle = `rgba(4,2,16,${0.35 * live})`;
    ctx.fillRect(0, 0, W, H);
    const bh = 168 * open;
    if (bh > 2) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, cy - bh / 2, W, bh);
      ctx.clip();
      ctx.fillStyle = dark;
      ctx.fillRect(0, cy - bh / 2, W, bh);
      ctx.fillStyle = u.rgba(col, 0.14);
      const off = (G.time * 50) % 90;
      for (let x = -200; x < W + 200; x += 90) {
        ctx.beginPath();
        ctx.moveTo(x + off, cy - 90); ctx.lineTo(x + off + 40, cy - 90);
        ctx.lineTo(x + off - 50, cy + 90); ctx.lineTo(x + off - 90, cy + 90);
        ctx.fill();
      }
      ctx.fillStyle = col;
      ctx.fillRect(0, cy - bh / 2, W, 4);
      ctx.fillRect(0, cy + bh / 2 - 4, W, 4);
      ctx.restore();
    }
    if (open > 0.5) {
      const f = Math.floor(G.time * 8) % 4;
      const hop = Math.abs(Math.sin(G.time * 8)) * 6;
      ctx.globalAlpha = live;
      R.drawChar(tb.p, [4, 5, 6, 7][f], 150, cy - 50 - hop, 88);
      R.drawChar(tb.p, [10, 11, 12, 13][f], W - 238, cy - 50 - hop, 88);
      ctx.globalAlpha = 1;
      slamWord('YOUR TURN!', cx, cy - 50, 56, 0.06, t, '#ffe14a');
      if (t > 0.4) {
        const secs = (G.cfg && G.cfg.turnTime) || BC.TURN_TIME.def;
        R.text(BC.PLAYER_NAMES[tb.p] + ' - ' + secs + ' SECONDS ON THE CLOCK', cx, cy + 26, { size: 12, align: 'center', color: '#fff', outline: 5, alpha: live });
        R.text('CLICK OR PRESS ENTER TO PLAY', cx, cy + 52, { size: 8, align: 'center', color: '#c8c8e0', outline: 3, alpha: live * 0.9 });
      }
    }
    ctx.restore();
  };

  // the last seconds of your own turn: the board's edge pulses red
  function drawHurry(G) {
    const pl = G.players[G.turn];
    if (!pl || !turnLow(G) || G.flip || G.over || !(pl.type === 'HUMAN' && G.isMine(pl.p))) return;
    const a = 0.35 + 0.35 * Math.sin(G.time * 12);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,40,40,${a})`;
    ctx.lineWidth = 10;
    ctx.stroke(G.board.frame);
    ctx.restore();
  }

  // ------------------------------------------------------------ sliders
  // Five-step slider rows for the setup screen and the LAN lobby: the title and current step on the left, then
  // the track between the names of its two ends. BRAIN SIZE OF CPU (STUPID ... GRANDMASTER) has a brain for a
  // knob that grows with the setting; POWER-UPS (CHILLIN' ... INSANITY) a fan of power-ups that gets fuller.
  const BRAIN_COL = ['#ff6a6a', '#ff9a4a', '#ffe14a', '#7fe87f', '#7fd8ff'];
  const POWER_COL = ['#7fd8ff', '#7fe87f', '#ffe14a', '#ff9a4a', '#ff4a6a'];
  const sliderTrack = (x, w) => ({ x0: x + 274, x1: x + w - 104 });

  function levelAt(x, w, mx, n) {
    const t = sliderTrack(x, w);
    if (mx < t.x0 - 14 || mx > t.x1 + 14) return -1;
    return u.clamp(Math.round((mx - t.x0) / (t.x1 - t.x0) * n), 0, n);
  }
  R.brainLevelAt = (x, w, mx) => levelAt(x, w, mx, BC.BRAINS.length - 1);
  R.powerLevelAt = (x, w, mx) => levelAt(x, w, mx, BC.POWER_LEVELS.length - 1);

  function drawBrain(x, y, r, col) {
    ctx.fillStyle = '#140c1c';
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.2 + 2, r + 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff9ad5';
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.2, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.45, y - r * 0.45, r * 0.4, r * 0.22, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b8407e';
    ctx.lineWidth = Math.max(1, r / 6);
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.9); ctx.lineTo(x, y + r * 0.9);
    ctx.moveTo(x - r * 0.85, y + r * 0.1); ctx.quadraticCurveTo(x - r * 0.5, y - r * 0.35, x - r * 0.2, y + r * 0.15);
    ctx.moveTo(x + r * 0.2, y - r * 0.2); ctx.quadraticCurveTo(x + r * 0.55, y + r * 0.35, x + r * 0.9, y - r * 0.05);
    if (r > 8) {
      ctx.moveTo(x - r * 0.75, y - r * 0.45); ctx.quadraticCurveTo(x - r * 0.45, y - r * 0.7, x - r * 0.25, y - r * 0.5);
      ctx.moveTo(x + r * 0.3, y + r * 0.6); ctx.quadraticCurveTo(x + r * 0.6, y + r * 0.45, x + r * 0.75, y + r * 0.6);
    }
    ctx.stroke();
    if (col) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.2 + 4, r + 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // o: { title, names, cols, knob(x, y), sel, enabled }
  function slider(x, y, w, h, level, o) {
    const n = o.names.length - 1;
    const col = o.cols[level] || '#fff';
    R.text(o.title, x + 16, y + 6, { size: 11, color: o.enabled === false ? '#bbc' : '#fff' });
    R.text(o.names[level], x + 16, y + 21, { size: 8, color: col });
    const t = sliderTrack(x, w), cy = y + h / 2;
    R.text(o.names[0], t.x0 - 12, cy - 3, { size: 7, align: 'right', color: level === 0 ? o.cols[0] : '#99a', shadow: false });
    R.text(o.names[n], t.x1 + 12, cy - 3, { size: 7, color: level === n ? o.cols[n] : '#99a', shadow: false });
    ctx.fillStyle = '#0a0618';
    ctx.fillRect(t.x0 - 2, cy - 3, t.x1 - t.x0 + 4, 6);
    const kx = t.x0 + (t.x1 - t.x0) * level / n;
    const grd = ctx.createLinearGradient(t.x0, 0, t.x1, 0);
    o.cols.forEach((c, i) => grd.addColorStop(i / n, c));
    ctx.fillStyle = grd;
    ctx.fillRect(t.x0, cy - 1, kx - t.x0, 3);
    ctx.fillStyle = '#3a3480';
    ctx.fillRect(kx, cy - 1, t.x1 - kx, 3);
    for (let i = 0; i <= n; i++) {
      const tx = Math.round(t.x0 + (t.x1 - t.x0) * i / n);
      ctx.fillStyle = i <= level ? o.cols[i] : '#5c5cb8';
      ctx.fillRect(tx - 1, cy - 6, 3, 12);
    }
    o.knob(kx, cy);
  }

  R.brainSlider = function (x, y, w, h, level, o) {
    slider(x, y, w, h, level, Object.assign({
      title: 'BRAIN SIZE OF CPU', names: BC.BRAINS, cols: BRAIN_COL,
      knob: (kx, cy) => drawBrain(kx, cy, 4.5 + level * 1.3, o && o.sel ? '#ffe14a' : null),
    }, o));
  };

  // one more power-up fanned out in the knob for every step
  const KNOB_ICONS = ['bomb', 'fire', 'speed', 'kick', 'mystery'];
  R.powerSlider = function (x, y, w, h, level, o) {
    slider(x, y, w, h, level, Object.assign({
      title: 'POWER-UPS', names: BC.POWER_LEVELS.map(l => l.name), cols: POWER_COL,
      knob: (kx, cy) => {
        const s = 16, step = 5, x0 = kx - level * step;
        if (o && o.sel) {
          ctx.fillStyle = '#ffe14a';
          ctx.fillRect(Math.round(x0 - s / 2 - 3), Math.round(cy - s / 2 - 3), level * step + s + 6, s + 6);
        }
        for (let i = 0; i <= level; i++) {
          const img = BC.Assets.icons[KNOB_ICONS[i]];
          const dy = (i % 2 ? 2 : -2) * (level > 0 ? 1 : 0);
          if (img) ctx.drawImage(img, Math.round(x0 + i * step - s / 2), Math.round(cy - s / 2 + dy), s, s);
        }
      },
    }, o));
  };

  // --------------------------------------------------------------- banner
  R.banner = function (G) {
    const bn = G.banner;
    if (!bn) return;
    const box = BC.BOARD_BOX;
    const k = bn.t / bn.dur;
    const cx = box.x + box.w / 2, cy = bn.y || box.y + box.h / 2;
    let off = 0;
    if (k < 0.15) off = (1 - u.easeOutBack(k / 0.15)) * 900;
    else if (k > 0.85) off = -((k - 0.85) / 0.15) * 900;
    const hgt = bn.small ? 70 : 130;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(box.x, cy - hgt / 2 - 6, box.w, hgt + 12);
    ctx.fillStyle = bn.color || '#ff5a3c';
    ctx.fillRect(box.x, cy - hgt / 2, box.w, 4);
    ctx.fillRect(box.x, cy + hgt / 2 - 4, box.w, 4);
    ctx.beginPath();
    ctx.rect(box.x, cy - hgt / 2 + 4, box.w, hgt - 8);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = -10; i < 30; i++) {
      const sx = box.x + i * 40 + ((G.time * 120) % 40);
      ctx.beginPath();
      ctx.moveTo(sx, cy - hgt / 2); ctx.lineTo(sx + 20, cy - hgt / 2);
      ctx.lineTo(sx - 30, cy + hgt / 2); ctx.lineTo(sx - 50, cy + hgt / 2);
      ctx.fill();
    }
    ctx.restore();
    const size = bn.small ? 26 : 40;
    R.text(bn.text, cx + off, cy - (bn.jp ? size * 0.9 : size / 2), { size, align: 'center', color: bn.color || '#ffe14a', outline: 8 });
    if (bn.jp) R.text(bn.jp, cx - off * 0.7, cy + size * 0.25, { size: bn.small ? 18 : 28, jp: true, align: 'center', color: '#fff', outline: 6 });
  };

  // ------------------------------------------------------------- game draw
  R.drawGame = function (G) {
    ctx.fillStyle = '#07051a';
    ctx.fillRect(0, 0, BC.W, BC.H);
    R.backdrop(G.time, G.boardMode === 'bomber');
    ctx.save();
    if (G.shake > 0.3) ctx.translate(u.rand(-G.shake, G.shake), u.rand(-G.shake, G.shake));
    const P = BC.Pasture, GR = BC.Gore;
    if (P) P.drawGround(G);
    drawFrame(G);
    drawCells(G);
    if (GR) GR.drawGround(G);
    const chessView = G.boardMode === 'chess' && !G.flip;
    if (chessView) {
      drawChessMarks(G);
      drawPowerups(G);
    }
    const SX = BC.SpecialFx;
    if (G.special && SX) SX.drawUnder(G);
    const ps = G.bomber;
    const bomberView = ps && G.boardMode === 'bomber';
    if (bomberView) { drawWalls(G, ps); drawBombs(G, ps); drawFlames(G, ps); }
    // everything standing on the board, back to front
    const items = P ? P.gateItems(G) : [];
    if (chessView) sheepItems(G, items);
    if (bomberView) bomberItems(G, ps, items);
    drawPieces(G, items);
    if (G.special && SX) SX.drawOver(G);
    if (bomberView) {
      drawBomberTags(G, ps);
      drawFallingWalls(G, ps);
      if (ps.ready > 0) {
        const box = BC.BOARD_BOX;
        const txt = ps.ready > 0.6 ? 'READY?' : 'GO!!';
        R.text(txt, box.x + box.w / 2, box.y + box.h / 2 - 24, { size: 48, align: 'center', color: ps.ready > 0.6 ? '#7fd8ff' : '#ffe14a', outline: 10 });
      }
    }
    if (GR) GR.drawAir(G);
    drawFx(G);
    drawParticles(G);
    if (chessView) drawHoverLabel(G);
    ctx.restore();
    drawHurry(G);
    drawTurnPlate(G);
    if (P) P.drawSign(G);
    drawHUD(G);
    drawPowerColumn(G);
    drawPowerInfo(G);
    R.banner(G);
    R.turnBanner(G);
    R.yourTurn(G);
    if (SX) SX.drawFlash(G);
  };

  // Scrolling checker backdrop used behind every screen
  R.backdrop = function (t, warm) {
    const s = 48;
    const ox = (t * 18) % (s * 2), oy = (t * 12) % (s * 2);
    ctx.fillStyle = warm ? '#12081a' : '#0a0a22';
    ctx.fillRect(0, 0, BC.W, BC.H);
    ctx.fillStyle = warm ? '#1c0c22' : '#121234';
    for (let y = -s * 2; y < BC.H + s; y += s) {
      for (let x = -s * 2; x < BC.W + s; x += s) {
        if (((x + y) / s) % 2 === 0) ctx.fillRect(Math.round(x + ox), Math.round(y + oy), s, s);
      }
    }
  };

  R.overlay = function () {
    ctx.drawImage(R.scan, 0, 0);
  };

  BC.Render = R;
})();
