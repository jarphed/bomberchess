(function () {
  'use strict';
  const BC = window.BC = window.BC || {};

  const FUSE = 2.6;
  const WALK_FUSE = 3.6;
  const WAKE_T = 0.95; // walker bombs open their eyes, sprout legs and stand up before running
  const WALK_STEP = 0.34;
  const KICK_STEP = 0.075; // a kicked bomb slides a cell this fast
  const FLAME_T = 0.6;
  const READY_T = 1.8;
  const SHIELD_GRACE = 1.2; // blink time after the shield breaks, so the same blast can't finish the job

  const stepTimeFor = speed => Math.max(0.11, 0.26 - speed * 0.035);
  const occCell = b => (b.moving ? (b.t < 0.5 ? b.from : b.to) : b.cell);

  // ------------------------------------------------------------ shrinking arena
  // From the third bomber round the walls close in, for good: each round starts with the walls the earlier
  // rounds left behind, and while it runs one more ring of edge cells turns into wall, swept in from every
  // side of the board at once. Anyone still standing on a cell when its wall drops is crushed. The walls
  // only exist in the bomber rounds; chess is still played on the whole board.
  const SHRINK_FROM = 3;
  const SHRINK_WIN = [0.12, 0.85]; // part of the round the walls move during
  const WARN_T = 1.6;              // a cell blinks this long before its wall drops
  const DROP_T = 0.3;              // the wall block falls for this long
  // one sweeper per side of the board: [sides, angle of the first corner in degrees]
  const SWEEP = { 2: [4, -135], 3: [6, 0], 4: [4, -135], 5: [5, -90] };

  // ring 0: cells touching the board's edge (a corner is enough); ring k: cells touching ring k-1
  function rings(board) {
    if (board.rings) return board.rings;
    const key = p => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
    const edge = new Set();
    board.boundary.forEach(([a, b]) => { edge.add(key(a)); edge.add(key(b)); });
    const ring = new Array(board.cells.length).fill(-1);
    let q = board.cells.filter(c => c.poly.some(p => edge.has(key(p)))).map(c => c.id);
    q.forEach(id => { ring[id] = 0; });
    let max = 0;
    while (q.length) {
      const next = [];
      q.forEach(id => board.cells[id].nT.forEach(n => {
        if (ring[n] >= 0) return;
        ring[n] = ring[id] + 1;
        max = Math.max(max, ring[n]);
        next.push(n);
      }));
      q = next;
    }
    board.rings = { ring, max };
    return board.rings;
  }

  // how many rings are walled in by the end of the given round; the two innermost rings always stay open
  function shrinkRings(board, round) {
    return BC.u.clamp(round - SHRINK_FROM + 1, 0, Math.max(0, rings(board).max - 1));
  }

  // closeAt[cell]: round clock time when the cell turns into wall (-1: walled in before the round starts,
  // Infinity: stays open); order: cells by closing time; pre/sk: rings walled in at the start/end of the
  // round. Deterministic, so LAN clients rebuild exactly the server's plan from (round, dur).
  function shrinkPlan(board, round, dur) {
    const closeAt = new Array(board.cells.length).fill(Infinity);
    const pre = shrinkRings(board, round - 1), k = shrinkRings(board, round);
    if (k > 0) {
      const R = rings(board).ring;
      const sw = SWEEP[board.n] || SWEEP[2];
      const S = sw[0], a0 = sw[1] * Math.PI / 180, sector = 2 * Math.PI / S;
      let mx = 0, my = 0;
      board.cells.forEach(c => { mx += c.cx; my += c.cy; });
      mx /= board.cells.length; my /= board.cells.length;
      const R0 = rings(board).ring;
      board.cells.forEach(c => { if (R0[c.id] < pre) closeAt[c.id] = -1; });
      const t0 = dur * SHRINK_WIN[0], span = dur * (SHRINK_WIN[1] - SHRINK_WIN[0]) / Math.max(1, k - pre);
      for (let r = pre; r < k; r++) {
        const bySector = [];
        board.cells.forEach(c => {
          if (R[c.id] !== r) return;
          const a = (((Math.atan2(c.cy - my, c.cx - mx) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const s = Math.min(S - 1, Math.floor(a / sector + 1e-9));
          (bySector[s] || (bySector[s] = [])).push({ id: c.id, a });
        });
        // all sides sweep in step: the i-th cell of every side drops at the same time
        bySector.forEach(list => {
          if (!list) return;
          list.sort((p, q) => p.a - q.a || p.id - q.id);
          list.forEach((e, i) => { closeAt[e.id] = t0 + span * (r - pre + (i + 0.5) / list.length); });
        });
      }
    }
    const order = [];
    closeAt.forEach((t, id) => { if (t < Infinity) order.push(id); });
    order.sort((p, q) => closeAt[p] - closeAt[q] || p - q);
    // index of the first wall still to drop this round
    let first = 0;
    while (first < order.length && closeAt[order[first]] < 0) first++;
    return { closeAt, order, first, pre, sk: k };
  }

  const isClosed = (ps, c) => !!ps.closeAt && ps.closeAt[c] <= ps.clock;

  // cells a blast reaches: rook lines, or the bishop lines for an X-bomb. Pieces and walls stop it.
  function blastCells(G, ps, cell, range, diag) {
    const board = G.board, occ = G.chess.occ;
    const out = [cell];
    const c = board.cells[cell];
    const type = diag ? 'B' : 'R';
    board.dirs.forEach((d, i) => {
      if (d.type !== type) return;
      const ray = c.rays[i];
      const n = Math.min(range, ray.length);
      for (let k = 0; k < n; k++) {
        const id = ray[k];
        if (occ[id] || isClosed(ps, id)) break;
        out.push(id);
        if (ps.bombAt.has(id)) break;
      }
    });
    return out;
  }

  function regionSize(board, blocked, start, cap) {
    const seen = new Set([start]);
    const q = [start];
    while (q.length && seen.size < cap) {
      const c = q.shift();
      for (const n of board.cells[c].nE) {
        if (!seen.has(n) && !blocked(n)) { seen.add(n); q.push(n); }
      }
    }
    return seen.size;
  }

  // the nearest roomy spot to the player's king, out of the walls (and preferably out of this round's walls)
  function spawnCell(G, ps, p, taken) {
    const board = G.board, occ = G.chess.occ;
    const blocked = c => !!occ[c] || ps.closeAt[c] < 0;
    const doomed = c => ps.closeAt[c] < Infinity;
    // players knocked out of the chess game have no king left: they start from their old base
    let start = BC.Chess.kingCell(G.chess, p);
    if (start < 0) {
      const home = board.cells.filter(c => c.base === p);
      start = (home.find(c => !occ[c.id]) || home[0] || board.cells[0]).id;
    }
    const seen = new Set([start]);
    const q = [start];
    let roomy = -1, safe = -1, any = -1;
    while (q.length) {
      const c = q.shift();
      if (!blocked(c) && !taken.has(c)) {
        if (any < 0) any = c;
        if (!doomed(c)) {
          if (safe < 0) safe = c;
          if (regionSize(board, blocked, c, 10) >= 10) { roomy = c; break; }
        }
      }
      for (const n of board.cells[c].nE) if (!seen.has(n)) { seen.add(n); q.push(n); }
    }
    return roomy >= 0 ? roomy : safe >= 0 ? safe : any >= 0 ? any : start;
  }

  // Everyone takes part, including players already knocked out of the chess game (they can still mess
  // with the others). A bomber that is hit sits out the rest of the round.
  function create(G) {
    const round = G.bomberRound || 1;
    const ps = {
      time: 0, clock: 0, dur: G.settings.bomberTime, ready: READY_T, round,
      bombers: [], bombs: [], bombAt: new Map(), flames: new Map(), flameOwner: new Map(), explosions: [],
      hits: [], kills: [], thudAt: -1, hurried: false,
    };
    Object.assign(ps, shrinkPlan(G.board, round, ps.dur));
    ps.nextClose = ps.first;
    const taken = new Set();
    G.players.forEach(pl => {
      const cell = spawnCell(G, ps, pl.p, taken);
      taken.add(cell);
      G.board.cells[cell].nT.forEach(n => taken.add(n));
      ps.bombers.push({
        p: pl.p, cell, from: cell, to: cell, t: 0, moving: false,
        face: 'down', anim: 0, alive: true, dying: false, deathT: 0, crushed: false,
        bombs: pl.stats.bomb, range: pl.stats.fire, step: stepTimeFor(pl.stats.speed),
        xbomb: pl.sp.xbomb, bombpass: pl.sp.bombpass, flamepass: pl.sp.flamepass,
        walker: pl.sp.walker, invuln: pl.sp.mystery ? 12 : 0, zig: false, ai: null, kicks: pl.stats.kick || 0,
      });
    });
    return ps;
  }

  function canEnter(G, ps, b, n) {
    if (G.chess.occ[n] || isClosed(ps, n)) return false;
    if (ps.bombAt.has(n) && !b.bombpass) return false;
    return true;
  }

  function faceOf(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy) * 1.05) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  function candidates(G, b, dx, dy) {
    const cells = G.board.cells;
    const c = cells[b.cell];
    const list = [];
    c.nE.forEach(n => {
      const vx = cells[n].cx - c.cx, vy = cells[n].cy - c.cy;
      const l = Math.hypot(vx, vy) || 1;
      const s = (vx * dx + vy * dy) / l;
      if (s > 0.3) list.push({ n, s });
    });
    list.sort((p, q) => q.s - p.s);
    // near-ties (triangles): alternate so that holding a key zig-zags in a straight line
    if (list.length > 1 && list[0].s - list[1].s < 0.05) {
      if (b.zig) list.unshift(list.splice(1, 1)[0]);
      b.zig = !b.zig;
    }
    return list.map(e => e.n);
  }

  function startMove(G, b, n) {
    const cells = G.board.cells;
    b.from = b.cell; b.to = n; b.t = 0; b.moving = true;
    b.face = faceOf(cells[n].cx - cells[b.cell].cx, cells[n].cy - cells[b.cell].cy);
  }

  function tryStart(G, ps, b, inp) {
    const cells = G.board.cells, nE = cells[b.cell].nE;
    if (inp.moveTo !== undefined && inp.moveTo >= 0) {
      const n = inp.moveTo;
      if (!nE.includes(n)) return false;
      const aim = inp.dx || inp.dy ? [inp.dx, inp.dy] : [cells[n].cx - cells[b.cell].cx, cells[n].cy - cells[b.cell].cy];
      if (kick(G, ps, b, n, aim[0], aim[1])) return false;
      if (canEnter(G, ps, b, n)) { startMove(G, b, n); return true; }
      return false;
    }
    if (!inp.dx && !inp.dy) return false;
    b.face = faceOf(inp.dx, inp.dy);
    for (const n of candidates(G, b, inp.dx, inp.dy)) {
      if (kick(G, ps, b, n, inp.dx, inp.dy)) return false;
      if (canEnter(G, ps, b, n)) { startMove(G, b, n); return true; }
    }
    return false;
  }

  // KICK: running into a bomb sends it sliding along the rook line, away from the kicker, until a piece, a wall,
  // another bomb or a bomber stops it. Each kick uses one up. Kicking comes before BOMBPASS: only a bomb that
  // can't budge gets walked over. (dx, dy) is where the kicker is heading, to pick the line on the triangle board.
  const slideBlocked = (G, ps, n) => !!G.chess.occ[n] || isClosed(ps, n) || ps.bombAt.has(n) ||
    ps.bombers.some(o => o.alive && occCell(o) === n) || ps.bombs.some(o => o.path && o.to === n);

  function kick(G, ps, b, n, dx, dy) {
    const bm = ps.bombAt.get(n);
    if (!(b.kicks > 0) || !bm || bm.path) return false;
    const cells = G.board.cells, c = cells[b.cell];
    let path = null, best = -Infinity;
    G.board.dirs.forEach((d, i) => {
      const ray = c.rays[i];
      if (d.type !== 'R' || ray[0] !== n || ray.length < 2 || slideBlocked(G, ps, ray[1])) return;
      const e = cells[ray[ray.length - 1]];
      const s = ((e.cx - c.cx) * dx + (e.cy - c.cy) * dy) / (Math.hypot(e.cx - c.cx, e.cy - c.cy) || 1);
      if (s > best) { best = s; path = ray.slice(1); }
    });
    if (!path) return false;
    // a walker is kicked from the cell it holds, even mid-step
    Object.assign(bm, { from: n, to: n, t: 0, path });
    b.kicks--;
    b.face = faceOf(cells[n].cx - c.cx, cells[n].cy - c.cy);
    const pl = G.players[b.p];
    if (pl) { pl.stats.kick = b.kicks; G.rev++; }
    G.emit({ e: 'snd', n: 'kick' });
    return true;
  }

  // a kicked bomb slides a cell at a time; like a walker it moves over in bombAt half-way through each step
  function slideBomb(G, ps, bm, dt) {
    if (bm.from === bm.to) {
      if (!bm.path.length || slideBlocked(G, ps, bm.path[0])) { bm.path = null; return; }
      bm.to = bm.path.shift();
      bm.t = 0;
    }
    bm.t += dt / KICK_STEP;
    if (bm.t >= 0.5 && bm.cell !== bm.to) {
      if (ps.bombAt.has(bm.to) || isClosed(ps, bm.to)) {
        const f = bm.from; bm.from = bm.to; bm.to = f; bm.t = 1 - bm.t; bm.path = [];
      } else {
        ps.bombAt.delete(bm.cell); ps.bombAt.set(bm.to, bm); bm.cell = bm.to;
      }
    }
    if (bm.t >= 1) { bm.from = bm.to; bm.t = 0; }
  }

  // where a kicked bomb comes to rest if nothing else gets in its way
  function slideStop(G, ps, bm) {
    let c = bm.to;
    for (const n of bm.path) { if (slideBlocked(G, ps, n)) break; c = n; }
    return c;
  }

  function moveBomber(G, ps, b, inp, dt) {
    const cells = G.board.cells;
    if (b.moving) {
      const vx = cells[b.from].cx - cells[b.to].cx, vy = cells[b.from].cy - cells[b.to].cy;
      const l = Math.hypot(vx, vy) || 1;
      const back = (inp.dx || inp.dy) ? (vx * inp.dx + vy * inp.dy) / l > 0.6 : inp.moveTo === b.from;
      if (back) {
        const f = b.from; b.from = b.to; b.to = f; b.t = 1 - b.t;
        b.face = faceOf(vx, vy);
      }
      b.t += dt / b.step;
      b.anim += dt;
      if (b.t >= 1) {
        const extra = (b.t - 1) * b.step;
        b.cell = b.to; b.from = b.to; b.t = 0; b.moving = false;
        if (tryStart(G, ps, b, inp)) b.t = Math.min(0.5, extra / b.step);
      }
    } else if (tryStart(G, ps, b, inp)) {
      b.anim += dt;
    } else {
      b.anim = 0;
    }
  }

  function placeBomb(G, ps, b) {
    const c = occCell(b);
    if (ps.bombAt.has(c) || G.chess.occ[c] || isClosed(ps, c)) return false;
    if (ps.bombs.filter(x => x.owner === b.p).length >= b.bombs) return false;
    const bm = { cell: c, owner: b.p, fuse: b.walker ? WALK_FUSE : FUSE, range: b.range, anim: 0, walk: b.walker, diag: !!b.xbomb };
    if (bm.walk) Object.assign(bm, { from: c, to: c, t: 0, prev: -1, woke: false });
    ps.bombs.push(bm);
    ps.bombAt.set(c, bm);
    G.emit({ e: 'snd', n: 'bombPlace' });
    return true;
  }

  // bm.cell is the cell the walker occupies in bombAt; it switches over half-way through a step
  function walkBomb(G, ps, bm, dt) {
    if (bm.anim < WAKE_T) return;
    if (!bm.woke) { bm.woke = true; G.emit({ e: 'snd', n: 'wake' }); }
    if (bm.from !== bm.to) {
      bm.t += dt / WALK_STEP;
      if (bm.t >= 0.5 && bm.cell !== bm.to) {
        if (ps.bombAt.has(bm.to) || isClosed(ps, bm.to)) {
          const f = bm.from; bm.from = bm.to; bm.to = f; bm.t = 1 - bm.t;
        } else {
          ps.bombAt.delete(bm.cell); ps.bombAt.set(bm.to, bm); bm.cell = bm.to;
        }
      }
      if (bm.t < 1) return;
      bm.prev = bm.from; bm.from = bm.to = bm.cell; bm.t = 0;
    }
    const occ = G.chess.occ;
    const opts = G.board.cells[bm.cell].nE.filter(n => !occ[n] && !isClosed(ps, n) && !ps.bombAt.has(n) && !ps.bombs.some(o => (o.walk || o.path) && o.to === n));
    if (!opts.length) return;
    const fwd = opts.filter(n => n !== bm.prev);
    bm.to = BC.u.pick(fwd.length ? fwd : opts);
  }

  function explode(G, ps, bm) {
    const board = G.board, occ = G.chess.occ;
    ps.bombs.splice(ps.bombs.indexOf(bm), 1);
    ps.bombAt.delete(bm.cell);
    const arms = [];
    const lit = [bm.cell];
    const c = board.cells[bm.cell];
    const type = bm.diag ? 'B' : 'R';
    board.dirs.forEach((d, i) => {
      if (d.type !== type) return;
      const ray = c.rays[i];
      const arm = [];
      const n = Math.min(bm.range, ray.length);
      for (let k = 0; k < n; k++) {
        const id = ray[k];
        // pieces and closed-in walls are indestructible
        if (occ[id] || isClosed(ps, id)) break;
        arm.push(id); lit.push(id);
        const other = ps.bombAt.get(id);
        if (other) { other.fuse = 0; break; }
      }
      if (arm.length) arms.push(arm);
    });
    lit.forEach(id => {
      ps.flames.set(id, Math.max(ps.flames.get(id) || 0, FLAME_T));
      ps.flameOwner.set(id, bm.owner);
    });
    ps.explosions.push({ center: bm.cell, arms, t: 0, dur: FLAME_T });
    G.emit({ e: 'snd', n: 'explode' });
    G.emit({ e: 'shake', v: 7 });
  }

  // a wall drops onto the cell: bombs there are crushed (no blast), flames there go out
  function closeCell(G, ps, c) {
    const bm = ps.bombAt.get(c);
    if (bm) { ps.bombs.splice(ps.bombs.indexOf(bm), 1); ps.bombAt.delete(c); }
    ps.flames.delete(c);
    ps.flameOwner.delete(c);
    if (G.chess.occ[c]) return;
    G.emit({ e: 'burst', c, col: ['#d8d0c0', '#a89c88', '#6e6458', '#fff'], n: 10, sp: 110, sz: 3 });
    if (ps.clock - ps.thudAt > 0.12) {
      ps.thudAt = ps.clock;
      G.emit({ e: 'snd', n: 'thud' });
      G.emit({ e: 'shake', v: 3 });
    }
  }

  function knockOut(G, ps, b, by, crushed) {
    b.dying = true; b.deathT = 0; b.crushed = !!crushed;
    if (by >= 0 && by !== b.p) ps.kills.push({ by, victim: b.p });
    G.emit({ e: 'snd', n: 'death' });
    if (crushed) G.emit({ e: 'popup', c: occCell(b), text: 'CRUSHED!', col: '#ffb040' });
    if (G.onBomberHit) G.onBomberHit(b.p, by, crushed);
  }

  function update(G, ps, dt, inputs) {
    ps.time += dt;
    if (ps.ready > 0) { ps.ready -= dt; return; }
    ps.clock += dt;

    // walls closing in
    if (!ps.hurried && ps.first < ps.order.length && ps.clock >= ps.closeAt[ps.order[ps.first]] - WARN_T - 1) {
      ps.hurried = true;
      if (G.onHurry) G.onHurry();
    }
    while (ps.nextClose < ps.order.length && ps.closeAt[ps.order[ps.nextClose]] <= ps.clock) {
      closeCell(G, ps, ps.order[ps.nextClose++]);
    }

    for (const b of ps.bombers) {
      if (!b.alive) continue;
      if (b.dying) {
        b.deathT += dt;
        if (b.deathT >= 1.5) { b.alive = false; ps.hits.push(b.p); }
        continue;
      }
      if (b.invuln > 0) b.invuln -= dt;
      const inp = inputs[b.p] || {};
      moveBomber(G, ps, b, inp, dt);
      if (inp.bomb) placeBomb(G, ps, b);
    }

    ps.bombs.forEach(bm => {
      bm.fuse -= dt; bm.anim += dt;
      if (bm.path) slideBomb(G, ps, bm, dt);
      else if (bm.walk) walkBomb(G, ps, bm, dt);
      if ((bm.walk || bm.path) && ps.flames.has(bm.cell)) bm.fuse = 0;
    });
    for (let guard = 0; guard < 200; guard++) {
      const due = ps.bombs.find(bm => bm.fuse <= 0);
      if (!due) break;
      explode(G, ps, due);
    }

    for (const [c, t] of [...ps.flames]) {
      if (t - dt <= 0) { ps.flames.delete(c); ps.flameOwner.delete(c); } else ps.flames.set(c, t - dt);
    }
    ps.explosions = ps.explosions.filter(e => (e.t += dt) < e.dur);

    for (const b of ps.bombers) {
      if (!b.alive || b.dying) continue;
      const c = occCell(b);
      // a falling wall gets everyone: no shield or invincibility helps
      if (isClosed(ps, c)) { knockOut(G, ps, b, -1, true); continue; }
      if (b.invuln > 0 || !ps.flames.has(c)) continue;
      if (b.flamepass) {
        // the shield soaks up the first blast and breaks
        b.flamepass = false;
        b.invuln = SHIELD_GRACE;
        const pl = G.players[b.p];
        if (pl) { pl.sp.flamepass = false; G.rev++; }
        G.emit({ e: 'snd', n: 'crack' });
        G.emit({ e: 'burst', c, col: ['#fff', '#ffb0f0', '#ff78dc', '#c050ff'], n: 22, sp: 200, sz: 3 });
        G.emit({ e: 'popup', c, text: 'SHIELD BROKE!', col: '#ff9ae6' });
        continue;
      }
      knockOut(G, ps, b, ps.flameOwner.has(c) ? ps.flameOwner.get(c) : -1, false);
    }
  }

  BC.Bomber = {
    create, update, blastCells, canEnter, occCell, isClosed, rings, shrinkRings, shrinkPlan, slideStop,
    FUSE, WALK_FUSE, WAKE_T, WALK_STEP, KICK_STEP, WARN_T, DROP_T, stepTimeFor,
  };
})();
