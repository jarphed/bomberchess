(function () {
  'use strict';
  const BC = window.BC = window.BC || {};

  function create(board) {
    const occ = new Array(board.cells.length).fill(null);
    let uid = 1;
    board.setup.forEach(s => { occ[s.cell] = { t: s.t, o: s.o, moved: false, id: uid++ }; });
    // sheep: cell -> id of a sheep left behind by a missed turn or let in by a sheep gate (it doesn't block
    // moves); roam: ids of the sheep that wander a step after every turn (the ones from the gates)
    return { occ, powerups: new Map(), sheep: new Map(), roam: new Set(), lastMove: null, uid };
  }

  // attacksOnly: every square the piece threatens (used for check detection)
  function pieceMoves(board, st, from, attacksOnly) {
    const pc = st.occ[from];
    const out = [];
    if (!pc || pc.o < 0) return out;
    const cell = board.cells[from];
    const step = to => {
      const q = st.occ[to];
      if (!q) out.push({ from, to, cap: false });
      else if (q.o !== pc.o) out.push({ from, to, cap: true });
      else if (attacksOnly) out.push({ from, to, cap: false });
    };
    const slide = type => {
      board.dirs.forEach((d, i) => {
        if (d.type !== type) return;
        for (const to of cell.rays[i]) {
          const q = st.occ[to];
          if (!q) { out.push({ from, to, cap: false }); continue; }
          if (q.o !== pc.o || attacksOnly) out.push({ from, to, cap: q.o !== pc.o });
          break;
        }
      });
    };
    switch (pc.t) {
      case 'R': slide('R'); break;
      case 'B': slide('B'); break;
      case 'Q': slide('R'); slide('B'); break;
      case 'N': cell.knight.forEach(step); break;
      case 'K': cell.king.forEach(step); break;
      case 'P': {
        const fd = board.pawnDir[pc.o];
        if (!attacksOnly) {
          const ray = cell.rays[fd];
          if (ray.length && !st.occ[ray[0]]) {
            out.push({ from, to: ray[0], cap: false });
            // the double step goes by square, not by history, so a revived pawn on the pawn row gets it too
            const home = board.pawnHome && board.pawnHome[pc.o];
            const dbl = home ? home.has(from) : !pc.moved;
            if (dbl && ray.length > 1 && !st.occ[ray[1]]) out.push({ from, to: ray[1], cap: false, dbl: true });
          }
        }
        board.pawnCaps[pc.o].forEach(ci => {
          const r = cell.rays[ci];
          if (!r.length) return;
          const q = st.occ[r[0]];
          if (attacksOnly) out.push({ from, to: r[0], cap: !!(q && q.o !== pc.o) });
          else if (q && q.o !== pc.o) out.push({ from, to: r[0], cap: true });
        });
        break;
      }
    }
    return out;
  }

  function kingCell(st, p) {
    for (let i = 0; i < st.occ.length; i++) {
      const q = st.occ[i];
      if (q && q.t === 'K' && q.o === p) return i;
    }
    return -1;
  }

  function isAttacked(board, st, cellId, byFn) {
    for (let i = 0; i < st.occ.length; i++) {
      const q = st.occ[i];
      if (!q || q.o < 0 || !byFn(q.o)) continue;
      const ms = pieceMoves(board, st, i, true);
      for (let k = 0; k < ms.length; k++) if (ms[k].to === cellId) return true;
    }
    return false;
  }

  function inCheck(board, st, p, alive) {
    const k = kingCell(st, p);
    if (k < 0) return false;
    return isAttacked(board, st, k, o => o !== p && alive[o]);
  }

  function legalMoves(board, st, from, alive) {
    const pc = st.occ[from];
    if (!pc) return [];
    const res = [];
    for (const m of pieceMoves(board, st, from, false)) {
      const cap = st.occ[m.to];
      st.occ[m.to] = pc; st.occ[from] = null;
      const ok = (cap && cap.t === 'K') || !inCheck(board, st, pc.o, alive);
      st.occ[from] = pc; st.occ[m.to] = cap;
      if (ok) res.push(m);
    }
    return res;
  }

  function allLegal(board, st, p, alive) {
    let res = [];
    st.occ.forEach((q, i) => { if (q && q.o === p) res = res.concat(legalMoves(board, st, i, alive)); });
    return res;
  }

  function promotes(board, pc, to) {
    return pc.t === 'P' && board.cells[to].rays[board.pawnDir[pc.o]].length === 0;
  }

  // cells a piece passes over on its way from m.from to m.to (sliders and a pawn's double step; knights jump)
  function movePath(board, pc, m) {
    if (pc.t === 'N' || pc.t === 'K') return [];
    const rays = board.cells[m.from].rays;
    const ok = i => (pc.t === 'P' ? i === board.pawnDir[pc.o] : pc.t === 'Q' || board.dirs[i].type === pc.t);
    for (let i = 0; i < rays.length; i++) {
      if (!ok(i)) continue;
      const k = rays[i].indexOf(m.to);
      if (k >= 0) return rays[i].slice(0, k);
    }
    return [];
  }

  function applyMove(board, st, m) {
    const pc = st.occ[m.from];
    const cap = st.occ[m.to];
    const path = movePath(board, pc, m);
    st.occ[m.to] = pc;
    st.occ[m.from] = null;
    pc.moved = true;
    let promoted = false;
    if (promotes(board, pc, m.to)) { pc.t = 'Q'; promoted = true; }
    // every power-up the piece runs over is collected, in the order it passes them
    const powerups = [];
    path.concat(m.to).forEach(c => {
      const id = st.powerups.get(c);
      if (id) { st.powerups.delete(c); powerups.push({ cell: c, id }); }
    });
    st.lastMove = { from: m.from, to: m.to };
    return { piece: pc, captured: cap, promoted, powerups, path: path.concat(m.to) };
  }

  BC.Chess = { create, pieceMoves, kingCell, isAttacked, inCheck, legalMoves, allLegal, applyMove, promotes, movePath };
})();
