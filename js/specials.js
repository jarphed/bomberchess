(function () {
  'use strict';
  // Special captures: taking a knight, bishop, rook, queen or king (never a pawn) unleashes a one-off strike
  // that can hit anyone's pieces, your own included - but never a king: lightning and the horse pass kings by,
  // and during the falling tower, airstrike and nuke every king wears a helmet. plan() decides every victim
  // and timing up front (DOM-free, shared by local play and the LAN server) so all clients animate the same
  // strike from L.special. Pieces killed by a strike only set off a strike of their own when the lobby's
  // CHAINED DEATHS is on (the chain is run by logic.js, one strike after the other).
  // 'S' is the sheep a missed chess turn leaves behind: step on it and it stampedes like the knight.
  // Strikes hit sheep too, and a sheep that's hit stampedes next. A sheep that's part of a chain of stampedes
  // and runs into a piece blows up, taking everything up to `boom` squares around it along.
  const BC = window.BC = window.BC || {};
  const u = BC.u;

  const KINDS = ['N', 'B', 'R', 'Q', 'K'];
  // strikes that land on an area: kings put their helmets on for these
  const HELMET = ['R', 'Q', 'K'];
  // name: shout when triggered, hint: shown when aiming a capture, kill: popup on victims, out: elimination reason
  const INFO = {
    R: { name: 'TIMBER!', hint: 'TOWER FALLS', kill: 'CRUSHED!', out: 'CRUSHED', col: '#ffb040', st: '' },
    N: { name: "IT'S ALIVE!", hint: 'WILD HORSE', kill: 'TRAMPLED!', out: 'TRAMPLED', col: '#ffe14a', st: '' },
    B: { name: 'SMITE!', hint: 'LIGHTNING', kill: 'ZAPPED!', out: 'ZAPPED', col: '#9fe8ff', st: 'zap' },
    Q: { name: 'AIRSTRIKE!', hint: 'AIRSTRIKE', kill: 'BOMBED!', out: 'BOMBED', col: '#ff7a3c', st: '' },
    K: { name: 'NUKE!!', hint: 'NUKE', kill: '', out: 'NUKED', col: '#ff3d3d', st: 'vapor' },
    S: { name: 'STAMPEDE!', hint: 'SHEEP', kill: 'TRAMPLED!', out: 'TRAMPLED', col: '#f0f0f8', st: '' },
  };

  // seconds from the moment of capture
  const ROOK = { reach: 2, rise: 0.55, fall: 0.45, dur: 1.6 };
  const KNIGHT = { wake: 1.0, hop: 0.36, out: 0.5 };
  const BISHOP = { strike: 1.0, dur: 1.9 };
  const QUEEN = { fly0: 0.5, fly: 2.4, fall: 0.5, pad: 0.7 };
  const KING = { size: 4, drop: 2.1, boom: 2.6, dur: 4.8 };
  const BOOM_STEP = 0.09; // a blowing-up sheep's blast spreads a ring of squares this fast

  // the cells 1..r steps (to touching cells) away from cell, ring by ring
  function around(board, cell, r) {
    const seen = new Set([cell]);
    const rings = [];
    let q = [cell];
    for (let d = 0; d < r; d++) {
      const next = [];
      q.forEach(c => board.cells[c].nT.forEach(n => { if (!seen.has(n)) { seen.add(n); next.push(n); } }));
      rings.push(next);
      q = next;
    }
    return rings;
  }

  // side of an average cell in board units (1 on the square boards)
  function cellSize(board) {
    if (!board.cellSize) board.cellSize = Math.sqrt(board.cells.reduce((a, c) => a + c.area, 0) / board.cells.length);
    return board.cellSize;
  }

  // the tower splits along the rook lines: [dirIndex, [cells up to ROOK.reach away]]
  function rookArms(board, cell) {
    const c = board.cells[cell];
    const arms = [];
    board.dirs.forEach((d, i) => { if (d.type === 'R') arms.push([i, c.rays[i].slice(0, ROOK.reach)]); });
    return arms;
  }

  function rookCells(board, cell) {
    const out = [];
    rookArms(board, cell).forEach(a => a[1].forEach(c => out.push(c)));
    return out;
  }

  // The horse gallops around in knight jumps for a bit, then charges the nearest piece or sheep it can reach.
  // It never turns on the piece that took it.
  function knightRun(board, occ, sheep, start, capturerId) {
    const path = [start];
    let cur = start, prev = -1;
    const wander = u.randInt(2, 4);
    for (let i = 0; i < wander; i++) {
      const opts = board.cells[cur].knight.filter(x => !occ[x] && !sheep.has(x) && x !== prev);
      if (!opts.length) break;
      prev = cur;
      cur = u.pick(opts);
      path.push(cur);
    }
    const from = new Map([[cur, -1]]);
    const q = [cur];
    let goal = -1;
    while (q.length && goal < 0) {
      const c = q.shift();
      for (const n of u.shuffle(board.cells[c].knight.slice())) {
        if (from.has(n) || (occ[n] && (occ[n].id === capturerId || occ[n].t === 'K'))) continue;
        from.set(n, c);
        if (occ[n] || sheep.has(n)) { goal = n; break; }
        q.push(n);
      }
    }
    if (goal >= 0) {
      const tail = [];
      for (let c = goal; c !== cur; c = from.get(c)) tail.push(c);
      tail.reverse().forEach(c => path.push(c));
    }
    return { path, hit: goal };
  }

  // A straight bombing run across the board; bombs are spread out along the lane under the plane.
  function airstrike(board) {
    const cs = cellSize(board);
    const b = board.bounds;
    const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
    const rad = Math.max(...board.cells.map(c => Math.hypot(c.cx - mx, c.cy - my)));
    const ang = Math.random() * Math.PI * 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const off = u.rand(-0.35, 0.35) * rad;
    const px = mx - dy * off, py = my + dx * off;
    const reach = rad + cs * 2.5;
    const ax = px - dx * reach, ay = py - dy * reach;
    const lane = board.cells
      .map(c => ({ id: c.id, along: (c.cx - ax) * dx + (c.cy - ay) * dy, side: Math.abs((c.cx - px) * dy - (c.cy - py) * dx) }))
      .filter(e => e.side < cs * 0.7)
      .sort((p, q) => p.along - q.along);
    const n = Math.min(lane.length, u.clamp(Math.round(lane.length / 2.5), 3, 6));
    const drops = [];
    for (let i = 0; i < n; i++) {
      const seg = lane.slice(Math.floor(i * lane.length / n), Math.floor((i + 1) * lane.length / n));
      if (seg.length) drops.push(u.pick(seg));
    }
    return {
      ax, ay, bx: px + dx * reach, by: py + dy * reach,
      drops: drops.map(e => [e.id, QUEEN.fly0 + QUEEN.fly * e.along / (reach * 2) + QUEEN.fall]),
    };
  }

  // Ground zero sits on a cell corner; the blast takes every cell inside a square 4 cells wide
  // (an exact 4x4 block on the square boards). Only spots where it lands fully on the board are used.
  function nukeSpots(board) {
    if (board.nukeSpots) return board.nukeSpots;
    const half = KING.size / 2 * cellSize(board);
    const seen = new Set();
    const spots = [];
    board.cells.forEach(c => c.poly.forEach(p => {
      const key = Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
      if (seen.has(key)) return;
      seen.add(key);
      const cells = board.cells.filter(o => Math.abs(o.cx - p[0]) < half && Math.abs(o.cy - p[1]) < half).map(o => o.id);
      spots.push({ x: p[0], y: p[1], half, cells });
    }));
    const most = Math.max(...spots.map(s => s.cells.length));
    board.nukeSpots = spots.filter(s => s.cells.length >= most * 0.85);
    return board.nukeSpots;
  }

  // Returns { view, hits, cues }: view is the serialisable L.special the clients draw from,
  // hits are timed piece (or sheep: { sheep: id }) hits and cues are timed events (sounds, shakes, particles).
  // sheep: cell -> id of the sheep on the board; boom: blast radius of a stampeding sheep that runs into a piece
  function plan(board, occ, sheep, kind, cell, owner, capturerId, boom) {
    const v = { k: kind, c: cell, o: owner, t: 0, dur: 1 };
    const hits = [], cues = [];
    const at = (time, ev) => cues.push({ at: time, ev });
    const snd = (time, n) => at(time, { e: 'snd', n });
    const spx = (time, f, c, extra) => at(time, Object.assign({ e: 'spx', f, c }, extra));
    const hit = (time, c, blast) => {
      const q = occ[c];
      if (!q) {
        if (sheep.has(c)) hits.push({ at: time, c, sheep: sheep.get(c), boom: blast });
        return;
      }
      if (q.t !== 'K') { hits.push({ at: time, c, id: q.id, boom: blast }); return; }
      // kings can't be hurt by a strike: it just bounces off their helmet
      snd(time, 'clang');
      spx(time, 'clang', c, { o: q.o });
    };

    switch (kind) {
      case 'R': {
        const land = ROOK.rise + ROOK.fall;
        v.arms = rookArms(board, cell);
        v.rise = ROOK.rise; v.land = land; v.dur = ROOK.dur;
        snd(0, 'rumble');
        snd(ROOK.rise, 'crack');
        spx(ROOK.rise, 'dust', cell);
        snd(land, 'crash');
        at(land, { e: 'shake', v: 12 });
        v.arms.forEach(a => a[1].forEach(c => { spx(land, 'boom', c, { o: owner, rubble: 1 }); hit(land, c); }));
        break;
      }
      case 'N':
      case 'S': {
        const run = knightRun(board, occ, sheep, cell, capturerId);
        const hops = run.path.length - 1;
        const end = KNIGHT.wake + hops * KNIGHT.hop;
        const cry = kind === 'S' ? 'baa' : 'neigh';
        v.path = run.path; v.hit = run.hit; v.wake = KNIGHT.wake; v.hop = KNIGHT.hop; v.dur = end + KNIGHT.out;
        snd(0.3, cry);
        for (let i = 1; i <= hops; i++) {
          const c = run.path[i], tm = KNIGHT.wake + i * KNIGHT.hop;
          snd(tm, 'clop');
          spx(tm, 'dust', c);
          if (c === run.hit && !occ[c]) {
            // running into a sheep startles it into a stampede of its own
            snd(tm, 'wake');
            at(tm, { e: 'shake', v: 3 });
            hit(tm, c);
          } else if (c === run.hit) {
            snd(tm, 'explode');
            at(tm, { e: 'shake', v: 7 });
            hit(tm, c);
          }
        }
        const r = kind === 'S' && run.hit >= 0 && occ[run.hit] ? boom | 0 : 0;
        if (!r) {
          snd(end + 0.05, cry);
          spx(v.dur - 0.06, 'poof', run.path[hops]);
        } else {
          // the sheep blows up where it ran into the piece (kings get their helmets on for it)
          v.boom = r;
          spx(end, 'gib', run.hit, { r });
          snd(end, r >= 3 ? 'nuke' : 'crash');
          at(end, { e: 'shake', v: Math.min(14, 8 + r * 2) });
          spx(end, 'flash', -1, { v: Math.min(0.7, 0.25 + r * 0.1), d: 0.4 });
          at(end, { e: 'popup', c: run.hit, text: 'BAA-BOOM!', col: '#ff7a3c', sz: 14, dy: -22 });
          around(board, run.hit, r).forEach((ring, d) => ring.forEach(c => {
            const tm = end + (d + 1) * BOOM_STEP;
            spx(tm, 'boom', c, { o: -2 });
            hit(tm, c, true);
          }));
          v.dur = end + r * BOOM_STEP + 0.8;
        }
        break;
      }
      case 'B': {
        const pieces = [...sheep.keys()];
        occ.forEach((q, i) => { if (q && q.t !== 'K') pieces.push(i); });
        const tc = pieces.length ? u.pick(pieces) : cell;
        v.tc = tc; v.strike = BISHOP.strike; v.dur = BISHOP.dur;
        snd(0, 'ascend');
        snd(0.5, 'rumble');
        snd(BISHOP.strike, 'thunder');
        at(BISHOP.strike, { e: 'shake', v: 9 });
        spx(BISHOP.strike, 'zap', tc);
        spx(BISHOP.strike, 'flash', tc, { v: 0.45, d: 0.3 });
        hit(BISHOP.strike + 0.02, tc);
        break;
      }
      case 'Q': {
        const a = airstrike(board);
        Object.assign(v, { ax: a.ax, ay: a.ay, bx: a.bx, by: a.by, fly0: QUEEN.fly0, fly: QUEEN.fly, fall: QUEEN.fall, drops: a.drops });
        v.dur = Math.max(QUEEN.fly0 + QUEEN.fly, ...a.drops.map(d => d[1])) + QUEEN.pad;
        snd(0, 'siren');
        snd(QUEEN.fly0, 'plane');
        a.drops.forEach(([c, tm]) => {
          snd(tm - QUEEN.fall, 'whistle');
          snd(tm, 'explode');
          at(tm, { e: 'shake', v: 8 });
          spx(tm, 'boom', c, { o: -2 });
          hit(tm, c);
        });
        break;
      }
      case 'K': {
        const z = u.pick(nukeSpots(board));
        Object.assign(v, { x: z.x, y: z.y, half: z.half, cells: z.cells, drop: KING.drop, boom: KING.boom, dur: KING.dur });
        [0, 0.7, 1.4].forEach(tm => snd(tm, 'alarm'));
        snd(KING.drop, 'whistle');
        snd(KING.boom, 'nuke');
        at(KING.boom, { e: 'shake', v: 14 });
        spx(KING.boom, 'nuke', -1, { x: z.x, y: z.y, r: z.half });
        spx(KING.boom, 'flash', -1, { v: 0.8, d: 0.8 });
        z.cells.forEach(c => hit(KING.boom + 0.05, c));
        break;
      }
    }
    return { view: v, hits, cues };
  }

  BC.Specials = { KINDS, HELMET, INFO, plan, rookArms, rookCells, cellSize, nukeSpots, around };
})();
