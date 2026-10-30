(function () {
  'use strict';
  const BC = window.BC = window.BC || {};
  const VAL = BC.PIECE_VAL;

  // How sharp the CPUs are: one entry per "brain size of CPU" (BC.BRAINS, picked in the lobby).
  // AVERAGE is the classic beatable CPU: it often forgets to check whether a square is safe, now and then just
  // plays a random move, and reacts slowly and clumsily in the bomber round. SHARP and GRANDMASTER look ahead
  // (an alpha-beta search over the next plies plus the captures that follow) before they move.
  //   noise     random score spread (a pawn is worth 10)
  //   careful   chance it checks whether its pieces are safe this move (quick 1-ply CPUs)
  //   blunder   chance to play any random move
  //   kingEye   chance it spots a king it can take
  //   depth     look-ahead in plies (0: quick 1-ply scoring); ms: time budget for the look-ahead
  //   think     seconds between bomber decisions
  //   notice    a fresh bomb goes unnoticed for this long
  //   panic     chance to run a random way instead of to safety
  //   bombKeen  chance to drop a bomb when an enemy is in reach
  //   reckless  chance to drop it without checking for a way out
  //   hunt      chance to go after an enemy instead of wandering
  //   chain     sees chain reactions and where walking and kicked bombs are heading
  //   wallEye   seconds of warning it needs before a closing wall drops on it
  //   inward    chance to head for the middle while the walls close in
  //   daydream  times per second it zones out for a moment (for up to daze seconds)
  //   fumble    times per second it takes a random step instead of the one it meant to
  //   doodle    times per second it drops a bomb on a whim (three times as often with an enemy close by)
  const IQ = [
    { noise: 40, careful: 0, blunder: 0.45, kingEye: 0.5, depth: 0, think: [0.45, 0.9], notice: 1.2, panic: 0.5, bombKeen: 0.15, reckless: 0.5, hunt: 0.25, chain: false, wallEye: 0.7, inward: 0, daydream: 0.25, daze: 1.1, fumble: 0.5, doodle: 0.12 },
    { noise: 24, careful: 0.2, blunder: 0.28, kingEye: 0.85, depth: 0, think: [0.32, 0.7], notice: 0.75, panic: 0.38, bombKeen: 0.25, reckless: 0.3, hunt: 0.4, chain: false, wallEye: 1.1, inward: 0.25, daydream: 0.2, daze: 0.9, fumble: 0.35, doodle: 0.12 },
    { noise: 14, careful: 0.4, blunder: 0.15, kingEye: 1, depth: 0, think: [0.22, 0.5], notice: 0.45, panic: 0.25, bombKeen: 0.35, reckless: 0.15, hunt: 0.55, chain: false, wallEye: 1.6, inward: 0.5, daydream: 0.15, daze: 0.7, fumble: 0.25, doodle: 0.1 },
    { noise: 4, careful: 1, blunder: 0.03, kingEye: 1, depth: 2, ms: 150, think: [0.12, 0.28], notice: 0.15, panic: 0.08, bombKeen: 0.6, reckless: 0.04, hunt: 0.7, chain: true, wallEye: 2.4, inward: 0.9, daydream: 0.1, daze: 0.5, fumble: 0.15, doodle: 0.1 },
    { noise: 0.6, careful: 1, blunder: 0, kingEye: 1, depth: 5, ms: 450, think: [0.06, 0.14], notice: 0, panic: 0, bombKeen: 0.9, reckless: 0, hunt: 0.85, chain: true, wallEye: 3.2, inward: 1, daydream: 0.06, daze: 0.35, fumble: 0.08, doodle: 0.08 },
  ];
  const iqOf = G => IQ[G.settings && G.settings.brain !== undefined ? G.settings.brain : BC.BRAIN_DEFAULT] || IQ[BC.BRAIN_DEFAULT];

  // ------------------------------------------------------------------ chess
  // A thinker works out the CPU's move a slice at a time (step(ms) returns true once thinker.move is set),
  // so a deep look-ahead never freezes the game: Logic steps it every frame while the CPU "thinks".
  function chessThinker(G, p) {
    const iq = iqOf(G);
    const board = G.board, st = G.chess;
    const moves = BC.Chess.allLegal(board, st, p, G.alive());
    const decided = move => ({ p, done: true, move, step: () => true });
    if (!moves.length) return decided(null);
    const kill = moves.find(m => st.occ[m.to] && st.occ[m.to].t === 'K');
    if (kill && Math.random() < iq.kingEye) return decided(kill);
    if (Math.random() < iq.blunder) return decided(BC.u.pick(moves));
    if (iq.depth > 0) return searcher(G, p, moves, iq);
    return decided(quickMove(G, p, moves, iq));
  }

  // all in one go (tools and tests)
  function chooseChessMove(G, p) {
    const th = chessThinker(G, p);
    while (!th.step(1e9));
    return th.move;
  }

  // the quick 1-ply scoring of the duller CPUs
  function quickMove(G, p, moves, iq) {
    const board = G.board, st = G.chess, alive = G.alive();
    const Ch = BC.Chess;
    const careful = Math.random() < iq.careful;
    const enemy = o => o !== p && alive[o];
    const mine = o => o === p;
    const maxR = Math.max(...board.cells.map(c => Math.hypot(c.lx, c.ly))) || 1;
    let best = null, bestS = -Infinity;
    for (const m of moves) {
      const pc = st.occ[m.from], cap = st.occ[m.to];
      let s = Math.random() * iq.noise;
      if (cap) s += VAL[cap.t] * 10 * (cap.o < 0 ? 0.35 : 1);
      const wasAttacked = careful && Ch.isAttacked(board, st, m.from, enemy);
      st.occ[m.to] = pc; st.occ[m.from] = null;
      if (Ch.promotes(board, pc, m.to)) s += 80;
      Ch.movePath(board, pc, m).concat(m.to).forEach(c => { if (st.powerups.has(c)) s += 7; });
      // a captured rook's falling tower crushes everything two steps along its lines (kings wear helmets)
      if (careful && cap && cap.t === 'R') {
        for (const c of BC.Specials.rookCells(board, m.to)) {
          const q = st.occ[c];
          if (!q || q.t === 'K') continue;
          if (q.o === p) s -= VAL[q.t] * 10;
          else if (q.o < 0 || alive[q.o]) s += VAL[q.t] * 10 * (q.o < 0 ? 0.35 : 1);
        }
      }
      if (careful) {
        if (Ch.isAttacked(board, st, m.to, enemy)) {
          const defended = Ch.isAttacked(board, st, m.to, mine);
          if (pc.t !== 'K') s -= VAL[pc.t] * (defended ? 5 : 9.5);
        } else if (wasAttacked && pc.t !== 'P') {
          s += VAL[pc.t] * 6;
        }
      }
      const c = board.cells[m.to], f = board.cells[m.from];
      s += 0.6 * (Math.hypot(f.lx, f.ly) - Math.hypot(c.lx, c.ly)) / maxR;
      if (pc.t === 'P') s += 0.35;
      if (pc.t === 'K') s -= 1.2;
      st.occ[m.from] = pc; st.occ[m.to] = cap;
      if (s > bestS) { bestS = s; best = m; }
    }
    return best;
  }

  // ------------------------------------------------------------- look-ahead
  // Paranoid alpha-beta: the CPU maximises its score and every other player, in turn order, is assumed to
  // play against it. Below the root moves are pseudo-legal: a king left hanging simply gets taken. Leaves are
  // settled by a capture-only search. A captured rook's falling tower is played out (it isn't random);
  // the other strikes are random, so they're left out.
  const MAT = { P: 10, N: 30, B: 32, R: 50, Q: 90, K: 0 };
  const WIN = 100000;
  const ABORT = { abort: true };

  // per-board tables: centre bonus, pawn progress per owner, rook-tower cells
  function aiTables(board) {
    if (board.aiT) return board.aiT;
    const cells = board.cells;
    const maxR = Math.max(...cells.map(c => Math.hypot(c.lx, c.ly))) || 1;
    const centre = cells.map(c => 3 * (1 - Math.hypot(c.lx, c.ly) / maxR));
    const adv = board.pawnDir.map((d, o) => {
      const home = [...(board.pawnHome ? board.pawnHome[o] : [])];
      const start = Math.max(1, ...home.map(c => cells[c].rays[d].length));
      return cells.map(c => 8 * BC.u.clamp((start - c.rays[d].length) / start, 0, 1));
    });
    const rook = cells.map(c => BC.Specials.rookCells(board, c.id));
    board.aiT = { centre, adv, rook };
    return board.aiT;
  }

  function searcher(G, me, rootMoves, iq) {
    const board = G.board, Ch = BC.Chess;
    // the search plays on its own copy of the board, so it can pause mid-way while the game keeps drawing
    const occ = G.chess.occ.map(q => q && { t: q.t, o: q.o, id: q.id, moved: q.moved });
    const st = { occ };
    const T = aiTables(board);
    const alive = G.alive();
    const order = [];
    for (let i = 0; i < G.players.length; i++) {
      const k = (me + i) % G.players.length;
      if (alive[k]) order.push(k);
    }
    const nEnemy = Math.max(1, order.length - 1);
    // every enemy counts, but in a crowd losing your own piece hurts more than one rival losing theirs
    const wEnemy = 1 / Math.sqrt(nEnemy);
    const kingTake = order.length <= 2 ? WIN : 5000;
    const qMax = Math.min(4, order.length + 1);
    const stack = [];
    let nodes = 0, d = 1, passBest = null, spent = 0, sliceStart = 0, sliceMs = 0;

    function evaluate() {
      let mine = 0, theirs = 0;
      for (let i = 0; i < occ.length; i++) {
        const q = occ[i];
        if (!q || q.o < 0 || q.t === 'K') continue;
        let v = MAT[q.t];
        if (q.t === 'P') v += T.adv[q.o][i];
        else if (q.t !== 'R') v += T.centre[i];
        if (q.o === me) mine += v; else if (alive[q.o]) theirs += v;
      }
      return mine - theirs * wEnemy;
    }

    function make(m) {
      const pc = occ[m.from], cap = occ[m.to];
      const u = { m, pc, cap, t: pc.t, crushed: null };
      occ[m.to] = pc; occ[m.from] = null;
      if (pc.t === 'P' && Ch.promotes(board, pc, m.to)) pc.t = 'Q';
      if (cap && cap.t === 'R') {
        u.crushed = [];
        for (const c of T.rook[m.to]) {
          const q = occ[c];
          if (q && q.t !== 'K') { u.crushed.push(c, q); occ[c] = null; }
        }
      }
      stack.push(u);
    }

    function unmake() {
      const u = stack.pop();
      if (u.crushed) for (let i = 0; i < u.crushed.length; i += 2) occ[u.crushed[i]] = u.crushed[i + 1];
      u.pc.t = u.t;
      occ[u.m.from] = u.pc; occ[u.m.to] = u.cap;
    }

    // pseudo-legal moves, most promising first (king hits, big captures by small pieces, promotions)
    function gen(p, capsOnly) {
      const list = [];
      for (let i = 0; i < occ.length; i++) {
        const q = occ[i];
        if (!q || q.o !== p) continue;
        const ms = Ch.pieceMoves(board, st, i, false);
        for (let k = 0; k < ms.length; k++) {
          const m = ms[k], cap = occ[m.to];
          if (capsOnly && (!cap || cap.o < 0)) continue;
          let key = 0;
          if (cap) key = cap.t === 'K' ? 1e6 : 1000 + MAT[cap.t] * (cap.o < 0 ? 3 : 10) - MAT[q.t];
          if (q.t === 'P' && Ch.promotes(board, q, m.to)) key += 800;
          m.k = key;
          list.push(m);
        }
      }
      list.sort((a, b) => b.k - a.k);
      return list;
    }

    // every few hundred nodes: out of think time (deeper passes only) -> abort; slice used up -> pause
    const due = () => {
      if ((++nodes & 127) !== 0) return 0;
      const used = Date.now() - sliceStart;
      if (d > 1 && spent + used >= iq.ms) throw ABORT;
      return used >= sliceMs ? 1 : 0;
    };

    function* quiesce(idx, alpha, beta, qd) {
      if (due()) yield;
      const mover = order[idx % order.length];
      const maxing = mover === me;
      // standing pat: with more than two players a rival may simply leave the capture to the next one
      const stand = (qd > 1 && !maxing && order.length > 2) ? (yield* quiesce(idx + 1, alpha, beta, qd - 1)) : evaluate();
      if (qd <= 0) return stand;
      if (maxing) { if (stand >= beta) return stand; if (stand > alpha) alpha = stand; } else { if (stand <= alpha) return stand; if (stand < beta) beta = stand; }
      let best = stand;
      for (const m of gen(mover, true)) {
        const cap = occ[m.to];
        if (cap.t === 'K') {
          if (maxing) return stand + kingTake;
          if (cap.o === me) return -WIN;
          continue;
        }
        make(m);
        const v = yield* quiesce(idx + 1, alpha, beta, qd - 1);
        unmake();
        if (maxing) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
        if (alpha >= beta) break;
      }
      return best;
    }

    function* ab(depth, idx, alpha, beta) {
      if (due()) yield;
      if (depth <= 0) return yield* quiesce(idx, alpha, beta, qMax);
      const mover = order[idx % order.length];
      const maxing = mover === me;
      const moves = gen(mover, false);
      if (!moves.length) return yield* ab(depth - 1, idx + 1, alpha, beta);
      let best = maxing ? -Infinity : Infinity;
      for (const m of moves) {
        const cap = occ[m.to];
        if (cap && cap.t === 'K') {
          if (maxing) return evaluate() + kingTake + depth;
          if (cap.o === me) return -WIN - depth;
        }
        make(m);
        const v = yield* ab(depth - 1, idx + 1, alpha, beta);
        unmake();
        if (maxing) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
        if (alpha >= beta) break;
      }
      return best;
    }

    // things the search doesn't see: power-ups picked up on the way, tidying away an eliminated player's pieces
    const real = G.chess;
    const bonus = m => {
      const pc = real.occ[m.from], cap = real.occ[m.to];
      let b = Math.random() * iq.noise;
      Ch.movePath(board, pc, m).concat(m.to).forEach(c => { if (real.powerups.has(c)) b += 7; });
      if (cap && cap.o < 0) b += MAT[cap.t] * 0.35;
      if (pc.t === 'K') b -= 1.2;
      return b;
    };
    const root = rootMoves.map(m => ({ m, b: bonus(m), v: 0 }));
    const th = { p: me, done: false, move: root[0].m, step };

    // iterative deepening: the first pass always completes, deeper ones run while the think budget lasts.
    // Cut short mid-pass, the best move found so far in that pass is still sound, since the previous
    // pass's best move is always searched first.
    function* run() {
      for (d = 1; ; d++) {
        let alpha = -Infinity;
        passBest = null;
        for (const e of root) {
          make(e.m);
          e.v = (yield* ab(d - 1, 1, alpha - e.b, Infinity)) + e.b;
          unmake();
          if (e.v > alpha) { alpha = e.v; passBest = e; }
        }
        root.sort((a, b) => b.v - a.v);
        th.move = root[0].m;
        if (d >= iq.depth || root[0].v >= kingTake / 2) return;
      }
    }
    const job = run();

    function step(ms) {
      if (th.done) return true;
      sliceStart = Date.now();
      sliceMs = ms;
      try {
        if (job.next().done) th.done = true;
      } catch (x) {
        if (x !== ABORT) throw x;
        th.done = true;
        if (passBest) th.move = passBest.m;
      }
      spent += Date.now() - sliceStart;
      return th.done;
    }
    return th;
  }

  // ----------------------------------------------------------------- bomber
  // what the CPU thinks will burn (or be walled in) and when. Duller CPUs miss others' fresh bombs, chain
  // reactions and where walking bombs are heading, and notice a closing wall late.
  function dangerMap(G, ps, self, iq) {
    iq = iq || iqOf(G);
    const Bm = BC.Bomber;
    const n = G.board.cells.length;
    const danger = new Float32Array(n).fill(Infinity);
    ps.flames.forEach((t, c) => { danger[c] = 0; });
    if (ps.closeAt) {
      for (let c = 0; c < n; c++) {
        const left = ps.closeAt[c] - ps.clock;
        if (left < iq.wallEye) danger[c] = Math.min(danger[c], Math.max(0, left));
      }
    }
    const seen = ps.bombs.filter(bm => !(bm.anim < iq.notice && bm.owner !== self));
    const fuse = new Map(seen.map(bm => [bm, bm.fuse]));
    const reach = new Map(seen.map(bm => [bm, Bm.blastCells(G, ps, bm.cell, bm.range, bm.diag)]));
    if (iq.chain) {
      // a bomb caught in another's blast goes off no later than that one
      for (let pass = 0; pass < 8; pass++) {
        let changed = false;
        seen.forEach(a => reach.get(a).forEach(c => {
          const b = ps.bombAt.get(c);
          if (b && b !== a && fuse.has(b) && fuse.get(a) < fuse.get(b)) { fuse.set(b, fuse.get(a)); changed = true; }
        }));
        if (!changed) break;
      }
      seen.forEach(bm => {
        if (bm.path) Bm.blastCells(G, ps, Bm.slideStop(G, ps, bm), bm.range, bm.diag).forEach(c => reach.get(bm).push(c));
        else if (bm.walk && bm.to !== bm.cell) Bm.blastCells(G, ps, bm.to, bm.range, bm.diag).forEach(c => reach.get(bm).push(c));
      });
    }
    seen.forEach(bm => {
      const f = fuse.get(bm);
      reach.get(bm).forEach(c => { if (f < danger[c]) danger[c] = f; });
    });
    return danger;
  }

  // BFS returning {dist, prev} over cells allowed by pass(cell, depth). Neighbours are tried in random order,
  // so of several equally short ways a CPU doesn't always take the same one.
  function bfs(G, start, pass, maxDepth) {
    const cells = G.board.cells;
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const q = [start];
    while (q.length) {
      const c = q.shift();
      const d = dist.get(c);
      if (d >= maxDepth) continue;
      for (const n of BC.u.shuffle(cells[c].nE.slice())) {
        if (dist.has(n) || !pass(n, d + 1)) continue;
        dist.set(n, d + 1); prev.set(n, c); q.push(n);
      }
    }
    return { dist, prev };
  }

  // the cells from start (not included) to goal along the BFS tree
  function routeTo(prev, start, goal) {
    const r = [];
    for (let c = goal; c !== start && prev.has(c); c = prev.get(c)) r.push(c);
    return r.reverse();
  }

  // A CPU bomber picks a plan every so often (iq.think) and keeps walking it in between, like a player holding
  // a key down. It's no machine, though: it zones out, slips a step, drops a bomb just because, likes to keep
  // its own distance and doesn't always go for the nearest enemy.
  function bomberInput(G, ps, b, dt) {
    const iq = iqOf(G), u = BC.u;
    // each CPU gets its own quirks for the round: how quick, how jumpy and how trigger-happy it is
    const ai = b.ai || (b.ai = {
      think: u.rand(0.1, 0.5), span: 0.3, moodT: 0, hunting: false, target: -1, keep: 1, route: [], goal: -1,
      tempo: u.rand(0.8, 1.3), nerve: u.rand(0.6, 1.6), trigger: u.rand(0.6, 1.5),
    });
    ai.think -= dt;
    ai.moodT -= dt;
    if (b.moving) return { moveTo: b.to };

    const Bm = BC.Bomber, occ = G.chess.occ, cells = G.board.cells;
    const me = b.cell;
    const enter = n => Bm.canEnter(G, ps, b, n);
    const go = route => { ai.route = route.slice(1); return route.length ? { moveTo: route[0] } : {}; };
    if (ai.think > 0) {
      const next = ai.route[0];
      if (next !== undefined && cells[me].nE.includes(next) && enter(next) && !ps.flames.has(next)) return go(ai.route);
      ai.route = [];
      return {};
    }
    ai.span = u.rand(iq.think[0], iq.think[1]) * ai.tempo;
    ai.think = ai.span;
    // chance that something happening `rate` times a second happens before the next decision
    const per = rate => 1 - Math.exp(-rate * ai.span);
    // every few seconds it makes up its mind whether to chase someone or just potter about
    if (ai.moodT <= 0) {
      ai.moodT = u.rand(2, 5);
      ai.hunting = Math.random() < iq.hunt;
      ai.target = -1;
      ai.keep = u.randInt(1, 3);
    }

    const danger = dangerMap(G, ps, b.p, iq);
    const safe = n => danger[n] === Infinity;
    // the way it's already going is still open and safe: no need to think up a new one
    const onCourse = () => ai.route.length > 0 && cells[me].nE.includes(ai.route[0]) && ai.route.every(c => enter(c) && safe(c));
    const enemies = ps.bombers.filter(e => e.alive && !e.dying && e.p !== b.p);
    const enemyCells = new Set(enemies.map(e => Bm.occCell(e)));

    // 1. flee danger (sometimes in a blind panic), or kick the bomb at an enemy
    if (danger[me] < Infinity) {
      if (b.kicks > 0 && Math.random() < iq.bombKeen) {
        const c = cells[me];
        for (let i = 0; i < c.rays.length; i++) {
          const ray = c.rays[i];
          if (G.board.dirs[i].type !== 'R' || ray.length < 2 || !ps.bombAt.has(ray[0]) || !c.nE.includes(ray[0])) continue;
          const stop = ray.slice(1).find(x => occ[x] || Bm.isClosed(ps, x) || ps.bombAt.has(x) || enemyCells.has(x));
          if (enemyCells.has(stop)) {
            const e = cells[ray[ray.length - 1]];
            ai.route = [];
            return { moveTo: ray[0], dx: e.cx - c.cx, dy: e.cy - c.cy };
          }
        }
      }
      if (Math.random() < iq.panic) {
        const any = cells[me].nE.filter(enter);
        ai.route = [];
        return any.length ? { moveTo: u.pick(any) } : {};
      }
      const r = bfs(G, me, (n, d) => enter(n) && danger[n] > d * b.step + 0.12, 12);
      let goal = -1, gd = Infinity;
      r.dist.forEach((d, c) => { if (danger[c] === Infinity && d < gd) { gd = d; goal = c; } });
      if (goal < 0) r.dist.forEach((d, c) => { if (c !== me && danger[c] > danger[me] && (goal < 0 || danger[c] > danger[goal])) goal = c; });
      if (goal >= 0 && goal !== me) return go(routeTo(r.prev, me, goal));
      ai.route = [];
      return {};
    }

    // 2. zone out for a moment
    if (Math.random() < per(iq.daydream * ai.nerve)) {
      ai.route = [];
      ai.think = u.rand(0.4, 1) * iq.daze;
      return {};
    }

    // 3. bomb when an enemy is in reach (if it can be bothered), or now and then just because
    const ownBombs = ps.bombs.filter(x => x.owner === b.p).length;
    const canEscape = blast => {
      const set = new Set(blast);
      const r = bfs(G, me, (n, d) => enter(n) && !ps.bombAt.has(n) && safe(n) && d * b.step < Bm.FUSE - 0.4, 10);
      for (const c of r.dist.keys()) if (!set.has(c)) return true;
      return false;
    };
    if (ownBombs < b.bombs && !ps.bombAt.has(me) && !occ[me]) {
      const blast = Bm.blastCells(G, ps, me, b.range, b.xbomb);
      const hitsEnemy = blast.some(c => enemyCells.has(c));
      const close = bfs(G, me, n => !occ[n] && !Bm.isClosed(ps, n), 3);
      const near = enemies.some(e => close.dist.has(Bm.occCell(e)));
      const want = (hitsEnemy && Math.random() < iq.bombKeen * ai.trigger) || Math.random() < per(iq.doodle * ai.trigger * (near ? 3 : 1));
      if (want && (Math.random() < iq.reckless || canEscape(blast))) { ai.route = []; return { bomb: true }; }
    }

    // 4. a slip of the thumb: a random step (into harm's way, if it's careless)
    if (Math.random() < per(iq.fumble * ai.nerve)) {
      const opts = cells[me].nE.filter(n => enter(n) && !ps.flames.has(n) && (safe(n) || Math.random() < iq.reckless));
      if (opts.length) { ai.route = []; return { moveTo: u.pick(opts) }; }
    }

    // 5. hunt: usually whoever is nearest, sometimes whoever it has it in for, keeping its own distance
    if (ai.hunting && enemies.length) {
      const plan = bfs(G, me, n => !occ[n] && !Bm.isClosed(ps, n) && (!ps.bombAt.has(n) || b.bombpass) && safe(n), 60);
      const reach = enemies.filter(e => plan.dist.has(Bm.occCell(e)));
      let tgt = reach.find(e => e.p === ai.target);
      if (!tgt && reach.length) {
        reach.sort((p, q) => plan.dist.get(Bm.occCell(p)) - plan.dist.get(Bm.occCell(q)));
        tgt = Math.random() < 0.65 ? reach[0] : u.pick(reach);
        ai.target = tgt.p;
      }
      if (tgt) {
        const at = Bm.occCell(tgt);
        if (ai.huntAt === at && onCourse()) return go(ai.route);
        ai.huntAt = at;
        const route = routeTo(plan.prev, me, at);
        if (route.length > ai.keep) return go(route.slice(0, route.length - ai.keep));
      }
    }

    // 6. while the walls close in, head for a cell that stays open this round
    if (ps.closeAt && ps.closeAt[me] < Infinity && Math.random() < iq.inward) {
      const r = bfs(G, me, n => enter(n) && safe(n), 40);
      let goal = -1, gd = Infinity;
      r.dist.forEach((d, c) => { if (ps.closeAt[c] === Infinity && d < gd) { gd = d; goal = c; } });
      if (goal >= 0 && goal !== me) return go(routeTo(r.prev, me, goal));
    }

    // 7. potter about: stroll to a random spot nearby, and look around a bit once there
    if (ai.goal >= 0 && ai.route[ai.route.length - 1] === ai.goal && onCourse()) return go(ai.route);
    const r = bfs(G, me, n => enter(n) && safe(n), 7);
    if (ai.goal === me || !r.dist.has(ai.goal)) {
      ai.goal = -1;
      if (Math.random() < 0.35) { ai.route = []; return {}; }
      const spots = [...r.dist.keys()].filter(c => r.dist.get(c) >= 2);
      if (spots.length) ai.goal = u.pick(spots);
    }
    return ai.goal >= 0 ? go(routeTo(r.prev, me, ai.goal)) : {};
  }

  BC.AI = { chessThinker, chooseChessMove, bomberInput, dangerMap, IQ };
})();
