(function () {
  'use strict';
  const BC = window.BC = window.BC || {};
  const H3 = Math.sqrt(3) / 2;
  const DEG = Math.PI / 180;

  function centroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const f = p[0] * q[1] - q[0] * p[1];
      a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
    }
    a *= 0.5;
    return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
  }

  function inConvex(x, y, poly) {
    let sign = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const cr = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      if (Math.abs(cr) < 1e-9) continue;
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  }

  const vkey = p => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  function makeDirs(list) {
    return list
      .map(d => Object.assign({}, d, { x: Math.cos(d.ang * DEG), y: Math.sin(d.ang * DEG) }))
      .sort((a, b) => a.ang - b.ang);
  }

  // ---------------------------------------------------------------- shapes
  function squareBoard(n, cross) {
    const cells = [];
    const half = n / 2;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (cross && (c < 3 || c > n - 4) && (r < 3 || r > n - 4)) continue;
        const x = c - half, y = r - half;
        cells.push({ poly: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]], gx: c, gy: r, shade: (c + r) % 2 });
      }
    }
    const dirs = [];
    for (let ang = 0; ang < 360; ang += 45) {
      dirs.push({ ang, type: ang % 90 === 0 ? 'R' : 'B', sx: Math.round(Math.cos(ang * DEG)), sy: Math.round(Math.sin(ang * DEG)) });
    }
    return { kind: 'square', lattice: true, cells, dirs: makeDirs(dirs) };
  }

  function triBoard(s) {
    const hex = [];
    for (let k = 0; k < 6; k++) hex.push([s * Math.cos(k * 60 * DEG), s * Math.sin(k * 60 * DEG)]);
    const cells = [];
    for (let j = -s - 1; j <= s; j++) {
      for (let i = -2 * s - 2; i <= 2 * s + 2; i++) {
        const x0 = i + j / 2, y0 = j * H3;
        const A = [[x0, y0], [x0 + 1, y0], [x0 + 0.5, y0 + H3]];
        const B = [[x0 + 1, y0], [x0 + 1.5, y0 + H3], [x0 + 0.5, y0 + H3]];
        [A, B].forEach((poly, t) => {
          const g = centroid(poly);
          if (inConvex(g.x, g.y, hex)) cells.push({ poly, shade: t });
        });
      }
    }
    const dirs = [];
    for (let ang = 0; ang < 360; ang += 30) {
      const rook = (ang / 30) % 2 === 0;
      dirs.push({ ang, type: rook ? 'R' : 'B', fam: rook ? (ang % 180) / 60 : -1 });
    }
    return { kind: 'tri', lattice: false, cells, dirs: makeDirs(dirs), size: s };
  }

  // Cairo pentagonal tiling: one pentagon per edge of a square grid (spacing 2).
  // Logical position = edge midpoint, which forms a 45-degree rotated square lattice.
  function cairoBoard(R) {
    const a = 0.5486;
    const sqType = (i, j) => (((i + j) % 2) + 2) % 2; // 0 = horizontal segment, 1 = vertical
    const pent = [];
    for (let k = 0; k < 5; k++) {
      const an = (-90 + 72 * k) * DEG;
      pent.push([R * Math.cos(an), R * Math.sin(an)]);
    }
    const N = Math.ceil(R / 2) + 2;
    const cells = [];
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        let lx = 2 * i + 1, ly = 2 * j;
        if (inConvex(lx, ly, pent)) {
          const above = sqType(i, j - 1), below = sqType(i, j);
          const ex1 = above === 0 ? [[2 * i + 1 - a, 2 * j - 1], [2 * i + 1 + a, 2 * j - 1]] : [[2 * i + 1, 2 * j - 1 + a]];
          const ex2 = below === 0 ? [[2 * i + 1 + a, 2 * j + 1], [2 * i + 1 - a, 2 * j + 1]] : [[2 * i + 1, 2 * j + 1 - a]];
          cells.push({ poly: [[2 * i, 2 * j], ...ex1, [2 * i + 2, 2 * j], ...ex2], gx: lx, gy: ly, shade: 0 });
        }
        lx = 2 * i; ly = 2 * j + 1;
        if (inConvex(lx, ly, pent)) {
          const right = sqType(i, j), left = sqType(i - 1, j);
          const ex1 = right === 1 ? [[2 * i + 1, 2 * j + 1 - a], [2 * i + 1, 2 * j + 1 + a]] : [[2 * i + 1 - a, 2 * j + 1]];
          const ex2 = left === 1 ? [[2 * i - 1, 2 * j + 1 + a], [2 * i - 1, 2 * j + 1 - a]] : [[2 * i - 1 + a, 2 * j + 1]];
          cells.push({ poly: [[2 * i, 2 * j], ...ex1, [2 * i, 2 * j + 2], ...ex2], gx: lx, gy: ly, shade: 1 });
        }
      }
    }
    // drop cells that dangle off the jagged edge (fewer than 3 shared edges)
    for (let changed = true; changed;) {
      const vcount = new Map();
      const ekey = c => c.poly.map((p, i) => {
        const a = vkey(p), b = vkey(c.poly[(i + 1) % c.poly.length]);
        return a < b ? a + '|' + b : b + '|' + a;
      });
      cells.forEach(c => ekey(c).forEach(k => vcount.set(k, (vcount.get(k) || 0) + 1)));
      const before = cells.length;
      for (let i = cells.length - 1; i >= 0; i--) {
        if (ekey(cells[i]).filter(k => vcount.get(k) > 1).length < 3) cells.splice(i, 1);
      }
      changed = cells.length !== before;
    }
    const dirs = [];
    for (let ang = 0; ang < 360; ang += 45) {
      const diag = ang % 90 !== 0;
      dirs.push({
        ang, type: diag ? 'R' : 'B',
        sx: diag ? Math.sign(Math.round(Math.cos(ang * DEG) * 10)) : Math.round(Math.cos(ang * DEG)) * 2,
        sy: diag ? Math.sign(Math.round(Math.sin(ang * DEG) * 10)) : Math.round(Math.sin(ang * DEG)) * 2,
      });
    }
    return { kind: 'cairo', lattice: true, cells, dirs: makeDirs(dirs) };
  }

  // --------------------------------------------------------------- finalize
  function finalize(board) {
    const cells = board.cells;
    cells.forEach((c, i) => {
      c.id = i;
      const g = centroid(c.poly);
      c.cx = g.x; c.cy = g.y; c.area = g.area;
      if (board.kind === 'cairo') { c.lx = c.gx; c.ly = c.gy; } else { c.lx = c.cx; c.ly = c.cy; }
      c.base = -1;
    });

    // adjacency through shared vertices
    const vmap = new Map();
    cells.forEach(c => c.poly.forEach(p => {
      const k = vkey(p);
      if (!vmap.has(k)) vmap.set(k, []);
      vmap.get(k).push(c.id);
    }));
    cells.forEach(c => {
      const cnt = new Map();
      c.poly.forEach(p => vmap.get(vkey(p)).forEach(o => { if (o !== c.id) cnt.set(o, (cnt.get(o) || 0) + 1); }));
      c.nE = []; c.nT = [];
      cnt.forEach((n, o) => { c.nT.push(o); if (n >= 2) c.nE.push(o); });
    });

    // outer boundary edges (for the frame)
    const emap = new Map();
    cells.forEach(c => c.poly.forEach((p, i) => {
      const q = c.poly[(i + 1) % c.poly.length];
      const ka = vkey(p), kb = vkey(q);
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = emap.get(k);
      if (e) e.n++; else emap.set(k, { n: 1, a: p, b: q });
    }));
    board.boundary = [];
    emap.forEach(e => { if (e.n === 1) board.boundary.push([e.a, e.b]); });

    // rays
    if (board.lattice) {
      const m = new Map();
      cells.forEach(c => m.set(c.gx + ',' + c.gy, c.id));
      cells.forEach(c => {
        c.rays = board.dirs.map(d => {
          const r = [];
          for (let k = 1; ; k++) {
            const id = m.get((c.gx + d.sx * k) + ',' + (c.gy + d.sy * k));
            if (id === undefined) break;
            r.push(id);
          }
          return r;
        });
      });
    } else {
      const normals = [0, 60, 120].map(an => [-Math.sin(an * DEG), Math.cos(an * DEG)]);
      cells.forEach(c => { c.strip = normals.map(n => Math.floor((c.lx * n[0] + c.ly * n[1]) / H3 + 1e-7)); });
      cells.forEach(c => {
        c.rays = board.dirs.map(d => {
          const out = [];
          for (const o of cells) {
            if (o === c) continue;
            const rx = o.lx - c.lx, ry = o.ly - c.ly;
            const along = rx * d.x + ry * d.y;
            if (along <= 1e-6) continue;
            if (d.type === 'R') { if (o.strip[d.fam] !== c.strip[d.fam]) continue; }
            else if (Math.abs(rx * d.y - ry * d.x) > 1e-3) continue;
            out.push([along, o.id]);
          }
          return out.sort((p, q) => p[0] - q[0]).map(e => e[1]);
        });
      });
    }

    // king targets: touching cells + first step of every line
    cells.forEach(c => {
      const k = new Set(c.nT);
      c.rays.forEach(r => { if (r.length) k.add(r[0]); });
      c.king = [...k];
    });
    // knight: the nearest ring of cells that no queen line or king step reaches
    // (gives the classic 8 jumps on squares and 6 jumps on triangles)
    const offLine = c => {
      const ex = new Set([c.id, ...c.king]);
      c.rays.forEach(r => r.forEach(o => ex.add(o)));
      return cells.filter(o => !ex.has(o.id)).map(o => ({ id: o.id, d: Math.hypot(o.lx - c.lx, o.ly - c.ly) }));
    };
    const mid = cells.reduce((a, c) => (Math.hypot(c.lx, c.ly) < Math.hypot(a.lx, a.ly) ? c : a));
    const kd = Math.min(...offLine(mid).map(e => e.d));
    cells.forEach(c => { c.knight = offLine(c).filter(e => Math.abs(e.d - kd) < 0.05).map(e => e.id); });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cells.forEach(c => c.poly.forEach(p => {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }));
    board.bounds = { minX, minY, maxX, maxY };
    return board;
  }

  // ------------------------------------------------------------------ setup
  const BACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];

  function definePlayers(board, n, baseStart) {
    board.players = [];
    board.pawnDir = [];
    board.pawnCaps = [];
    const nd = board.dirs.length;
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n;
      const fwd = rot(0, -1, a);
      let best = 0, bd = -2;
      board.dirs.forEach((d, i) => { const v = d.x * fwd[0] + d.y * fwd[1]; if (v > bd + 1e-9) { bd = v; best = i; } });
      board.players.push({ baseAng: baseStart + k * 360 / n, fwd, rotA: a });
      board.pawnDir.push(best);
      board.pawnCaps.push([(best - 1 + nd) % nd, (best + 1) % nd]);
    }
  }

  function nearestFree(board, x, y, used) {
    let best = -1, bd = Infinity;
    for (const c of board.cells) {
      if (used.has(c.id)) continue;
      const d = (c.lx - x) ** 2 + (c.ly - y) ** 2;
      if (d < bd) { bd = d; best = c.id; }
    }
    return best;
  }

  // Template given for player 0 (bottom); other players get it rotated around the centre.
  function setupByRotation(board, template, n) {
    const used = new Set();
    board.setup = [];
    for (let k = 0; k < n; k++) {
      const a = board.players[k].rotA;
      template.forEach(it => {
        const c = board.cells[it.cell];
        const p = rot(c.lx, c.ly, a);
        const id = nearestFree(board, p[0], p[1], used);
        used.add(id);
        board.setup.push({ cell: id, t: it.t, o: k });
      });
    }
  }

  function setupByWindow(board, n, W, nBack, nPawn) {
    const used = new Set();
    board.setup = [];
    for (let k = 0; k < n; k++) {
      const a = board.players[k].rotA;
      const uo = rot(0, 1, a);
      const v = [uo[1], -uo[0]];
      const cand = board.cells
        .filter(c => !used.has(c.id) && Math.abs(c.lx * v[0] + c.ly * v[1]) <= W)
        .map(c => ({ c, depth: c.lx * uo[0] + c.ly * uo[1], lat: c.lx * v[0] + c.ly * v[1] }))
        .sort((p, q) => q.depth - p.depth || Math.abs(p.lat) - Math.abs(q.lat));
      const back = cand.slice(0, nBack).sort((p, q) => p.lat - q.lat);
      back.forEach((e, i) => { used.add(e.c.id); board.setup.push({ cell: e.c.id, t: BACK[i] || 'P', o: k }); });
      cand.slice(nBack, nBack + nPawn).forEach(e => { used.add(e.c.id); board.setup.push({ cell: e.c.id, t: 'P', o: k }); });
    }
  }

  function central(list, count) {
    return list.slice()
      .sort((p, q) => Math.abs(p.lx) - Math.abs(q.lx) || q.lx - p.lx)
      .slice(0, count)
      .sort((p, q) => p.lx - q.lx);
  }

  function create(n) {
    let board;
    if (n === 2) {
      board = finalize(squareBoard(8, false));
      definePlayers(board, 2, 90);
      const at = (c, r) => board.cells.find(x => x.gx === c && x.gy === r).id;
      board.setup = [];
      for (let c = 0; c < 8; c++) {
        board.setup.push({ cell: at(c, 7), t: BACK[c], o: 0 });
        board.setup.push({ cell: at(c, 6), t: 'P', o: 0 });
        board.setup.push({ cell: at(c, 0), t: BACK[c], o: 1 });
        board.setup.push({ cell: at(c, 1), t: 'P', o: 1 });
      }
    } else if (n === 4) {
      board = finalize(squareBoard(14, true));
      definePlayers(board, 4, 90);
      const tpl = [];
      board.cells.forEach(c => {
        if (c.gy === 13) tpl.push({ cell: c.id, t: BACK[c.gx - 3] });
        if (c.gy === 12 && c.gx >= 3 && c.gx <= 10) tpl.push({ cell: c.id, t: 'P' });
      });
      setupByRotation(board, tpl, 4);
    } else if (n === 3) {
      const s = 6;
      board = finalize(triBoard(s));
      definePlayers(board, 3, 90);
      const strip1 = board.cells.filter(c => c.ly > (s - 1) * H3);
      const strip2 = board.cells.filter(c => c.ly > (s - 2) * H3 && c.ly < (s - 1) * H3);
      const tpl = [];
      central(strip1, 8).forEach((c, i) => tpl.push({ cell: c.id, t: BACK[i] }));
      central(strip2, 9).forEach(c => tpl.push({ cell: c.id, t: 'P' }));
      setupByRotation(board, tpl, 3);
    } else {
      board = finalize(cairoBoard(15.45));
      definePlayers(board, 5, 90);
      setupByWindow(board, 5, 8.1, 8, 9);
    }
    board.n = n;
    board.setup.forEach(s => { board.cells[s.cell].base = s.o; });
    // each side's starting pawn squares (the pawn row): a pawn standing on one may move 1 or 2 steps
    board.pawnHome = [];
    for (let k = 0; k < n; k++) board.pawnHome.push(new Set(board.setup.filter(s => s.o === k && s.t === 'P').map(s => s.cell)));
    return board;
  }

  // ------------------------------------------------------------ sheep gates
  // One wooden gate per corner of the board, set into the frame where two of its edges meet: the cross board
  // uses its four inner corners, the others their outer corners (between the players' sides).
  // Each gate: v = the corner (board units), out = unit vector pointing away from the board, inner = an inner
  // corner, entry = cells touching the corner (where a sheep lands), near = the cells around those (used
  // when every entry cell is taken), leaves = the two frame edges the gate replaces (hinged at their far
  // end h, len long, closed angle a0, turn = which way they swing open, away from the board),
  // cut = keys of those frame edges.
  const GATE_DIRS = { 2: [225, 315, 45, 135], 3: [180, 300, 60], 4: [225, 315, 45, 135], 5: [270, 342, 54, 126, 198] };

  function edgeKey(p, q) {
    const a = vkey(p), b = vkey(q);
    return a < b ? a + '|' + b : b + '|' + a;
  }

  function gateSpots(board) {
    if (board.gateSpots) return board.gateSpots;
    const at = new Map();
    board.cells.forEach(c => c.poly.forEach(p => {
      const k = vkey(p);
      if (!at.has(k)) at.set(k, { p, cells: [] });
      at.get(k).cells.push(c.id);
    }));
    const edgesAt = new Map();
    board.boundary.forEach(e => e.forEach(p => {
      const k = vkey(p);
      if (!edgesAt.has(k)) edgesAt.set(k, []);
      edgesAt.get(k).push(e);
    }));
    const inner = board.n === 4;
    const cand = [...edgesAt.keys()].map(k => at.get(k)).filter(v => !inner || v.cells.length === 3);
    board.gateSpots = (GATE_DIRS[board.n] || []).map(deg => {
      const dx = Math.cos(deg * DEG), dy = Math.sin(deg * DEG);
      let best = null, bs = -Infinity;
      cand.forEach(v => {
        const s = v.p[0] * dx + v.p[1] * dy - Math.abs(v.p[0] * dy - v.p[1] * dx) * 1e-3;
        if (s > bs) { bs = s; best = v; }
      });
      const V = best.p;
      let mx = 0, my = 0;
      best.cells.forEach(id => { mx += board.cells[id].cx; my += board.cells[id].cy; });
      mx /= best.cells.length; my /= best.cells.length;
      const ol = Math.hypot(V[0] - mx, V[1] - my) || 1;
      const ox = (V[0] - mx) / ol, oy = (V[1] - my) / ol;
      const edges = edgesAt.get(vkey(V));
      const leaves = edges.map(([a, b]) => {
        const h = vkey(a) === vkey(V) ? b : a;
        const ex = V[0] - h[0], ey = V[1] - h[1];
        const len = Math.hypot(ex, ey);
        let nx = -ey / len, ny = ex / len;
        if (nx * ox + ny * oy < 0) { nx = -nx; ny = -ny; }
        return { h, len, a0: Math.atan2(ey, ex), turn: (ex * ny - ey * nx) < 0 ? -1 : 1 };
      });
      const entry = best.cells.slice();
      const near = new Set();
      entry.forEach(id => board.cells[id].nT.forEach(o => { if (!entry.includes(o)) near.add(o); }));
      return { v: V, out: [ox, oy], inner, entry, near: [...near], leaves, cut: edges.map(([a, b]) => edgeKey(a, b)) };
    });
    return board.gateSpots;
  }

  BC.Board = { create, centroid, gateSpots, edgeKey };
})();
