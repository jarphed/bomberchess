(function () {
  'use strict';
  // Compact wire format for game state (server -> clients). Chess data is only sent when it changes.
  const BC = window.BC = window.BC || {};

  const PT = ['K', 'Q', 'R', 'B', 'N', 'P'];
  const FACE = ['down', 'up', 'left', 'right'];
  const PU = BC.POWERUPS.map(p => p.id);
  const r3 = v => Math.round(v * 1000) / 1000;

  function encode(L, withChess) {
    const s = { ph: L.phase, tu: L.turn, pl: L.pliesLeft, tr: r3(L.transT), rev: L.rev, tl: r3(L.turnLeft) };
    if (L.over) s.ov = L.over;
    if (L.moveAnim) s.ma = [L.moveAnim.id, L.moveAnim.from, L.moveAnim.to, r3(L.moveAnim.t)];
    if (L.special) s.sp = Object.assign({}, L.special, { t: r3(L.special.t) });
    if (L.pawnLoss.length) s.lo = L.pawnLoss.map(l => [l.p, l.cell, l.id, l.boomed ? 1 : 0]);
    if (L.pawnGain.length) s.lg = L.pawnGain.map(g => [g.p, g.cell, g.done ? 1 : 0, g.t === 'K' ? 1 : 0]);
    if (withChess) {
      const occ = [];
      L.chess.occ.forEach((q, i) => { if (q) occ.push(i, PT.indexOf(q.t), q.o, q.id, q.moved ? 1 : 0); });
      const pu = [];
      L.chess.powerups.forEach((id, c) => { pu.push(c, PU.indexOf(id)); });
      const sh = [];
      L.chess.sheep.forEach((id, c) => { sh.push(c, id); });
      const lm = L.chess.lastMove;
      s.ch = {
        occ, pu, sh, sr: [...L.chess.roam], cr: L.chessRound, lm: lm ? [lm.from, lm.to] : null,
        p: L.players.map(p => [
          p.type === 'HUMAN' ? 1 : 0, p.name, p.alive ? 1 : 0, p.inCheck ? 1 : 0, p.outReason, p.place,
          p.stats.bomb, p.stats.fire, p.stats.speed,
          BC.SPECIALS.reduce((m, k, i) => m | (p.sp[k] ? 1 << i : 0), 0), p.stats.kick,
        ]),
      };
    }
    const ps = L.bomber;
    if (ps) {
      s.bo = {
        ck: r3(ps.clock), du: ps.dur, rd: r3(ps.ready), rn: ps.round,
        b: ps.bombers.map(b => [
          b.p, b.from, b.to, r3(b.t), FACE.indexOf(b.face), r3(b.anim),
          (b.alive ? 1 : 0) | (b.dying ? 2 : 0) | (b.invuln > 0 ? 4 : 0) | (b.flamepass ? 8 : 0) | (b.crushed ? 16 : 0), r3(b.deathT),
        ]),
        // flags: 1 walker, 2 X-bomb (diagonal blast), 4 kicked and sliding
        m: ps.bombs.map(x => {
          const f = (x.walk ? 1 : 0) | (x.diag ? 2 : 0) | (x.path ? 4 : 0);
          return x.walk || x.path ? [x.cell, x.owner, r3(x.fuse), r3(x.anim), f, x.from, x.to, r3(x.t)] : [x.cell, x.owner, r3(x.fuse), r3(x.anim), f];
        }),
        x: ps.explosions.map(e => [e.center, e.arms, r3(e.t), e.dur]),
      };
    }
    return s;
  }

  // Mirror object with the same shape the renderer reads from a local Logic instance
  function mirror(cfg) {
    const board = BC.Board.create(cfg.n);
    const M = {
      settings: {
        n: cfg.n, moves: cfg.moves, bomberTime: cfg.bomberTime, brain: cfg.brain === undefined ? BC.BRAIN_DEFAULT : cfg.brain,
        turnTime: BC.turnTimeOf(cfg.turnTime), chain: !!cfg.chain, gates: !!cfg.gates,
        gateRound: BC.gateRoundOf(cfg.gateRound), powerLevel: BC.powerLevelOf(cfg.powerLevel),
        revive: !!cfg.revive, blood: !!cfg.blood,
      },
      board, chess: { occ: new Array(board.cells.length).fill(null), powerups: new Map(), sheep: new Map(), roam: new Set(), lastMove: null },
      players: [], phase: 'chess', turn: 0, pliesLeft: 0, moveAnim: null, special: null, bomber: null,
      pawnLoss: [], pawnGain: [], transT: 0, over: null, rev: -1, turnLeft: 0, chessRound: 0,
    };
    for (let p = 0; p < cfg.n; p++) {
      M.players.push({
        p, type: cfg.types[p], name: cfg.names[p] || '', alive: true, inCheck: false, outReason: '', place: 0,
        stats: { bomb: 1, fire: 2, speed: 0, kick: 0 }, sp: {},
      });
    }
    M.alive = () => M.players.map(p => p.alive);
    M.aliveCount = () => M.players.filter(p => p.alive).length;
    return M;
  }

  function apply(M, s) {
    M.phase = s.ph; M.turn = s.tu; M.pliesLeft = s.pl; M.transT = s.tr; M.rev = s.rev; M.turnLeft = s.tl || 0;
    M.over = s.ov || null;
    M.moveAnim = s.ma ? { id: s.ma[0], from: s.ma[1], to: s.ma[2], t: s.ma[3], dur: 0.24 } : null;
    M.special = s.sp || null;
    M.pawnLoss = (s.lo || []).map(l => ({ p: l[0], cell: l[1], id: l[2], boomed: !!l[3] }));
    M.pawnGain = (s.lg || []).map(g => ({ p: g[0], cell: g[1], done: !!g[2], t: g[3] ? 'K' : 'P' }));
    if (s.ch) {
      const occ = M.chess.occ.fill(null);
      const o = s.ch.occ;
      for (let i = 0; i < o.length; i += 5) occ[o[i]] = { t: PT[o[i + 1]], o: o[i + 2], id: o[i + 3], moved: !!o[i + 4] };
      M.chess.powerups = new Map();
      for (let i = 0; i < s.ch.pu.length; i += 2) M.chess.powerups.set(s.ch.pu[i], PU[s.ch.pu[i + 1]]);
      M.chess.sheep = new Map();
      for (let i = 0; i < (s.ch.sh || []).length; i += 2) M.chess.sheep.set(s.ch.sh[i], s.ch.sh[i + 1]);
      M.chess.roam = new Set(s.ch.sr || []);
      M.chessRound = s.ch.cr || 0;
      M.chess.lastMove = s.ch.lm ? { from: s.ch.lm[0], to: s.ch.lm[1] } : null;
      s.ch.p.forEach((a, i) => {
        const p = M.players[i];
        if (!p) return;
        p.type = a[0] ? 'HUMAN' : 'CPU'; p.name = a[1]; p.alive = !!a[2]; p.inCheck = !!a[3];
        p.outReason = a[4]; p.place = a[5];
        p.stats.bomb = a[6]; p.stats.fire = a[7]; p.stats.speed = a[8]; p.stats.kick = a[10] || 0;
        BC.SPECIALS.forEach((k, j) => { p.sp[k] = !!(a[9] & (1 << j)); });
      });
    }
    if (s.bo) {
      const ps = M.bomber || (M.bomber = { bombers: [], bombs: [], explosions: [], flames: new Map() });
      ps.clock = s.bo.ck; ps.ready = s.bo.rd; ps.round = s.bo.rn;
      // the closing walls are planned the same way as on the server
      if (ps.planned !== s.bo.rn + ':' + s.bo.du) {
        ps.planned = s.bo.rn + ':' + s.bo.du;
        ps.dur = s.bo.du;
        Object.assign(ps, BC.Bomber.shrinkPlan(M.board, ps.round || 1, ps.dur));
      }
      ps.bombers = s.bo.b.map(a => ({
        p: a[0], from: a[1], to: a[2], t: a[3], face: FACE[a[4]], anim: a[5],
        alive: !!(a[6] & 1), dying: !!(a[6] & 2), invuln: a[6] & 4 ? 1 : 0, flamepass: !!(a[6] & 8), crushed: !!(a[6] & 16), deathT: a[7],
      }));
      ps.bombs = s.bo.m.map(a => (a[4] & 5
        ? { cell: a[0], owner: a[1], fuse: a[2], anim: a[3], walk: !!(a[4] & 1), diag: !!(a[4] & 2), slide: !!(a[4] & 4), from: a[5], to: a[6], t: a[7] }
        : { cell: a[0], owner: a[1], fuse: a[2], anim: a[3], walk: false, diag: !!(a[4] & 2) }));
      ps.explosions = s.bo.x.map(a => ({ center: a[0], arms: a[1], t: a[2], dur: a[3] }));
    } else {
      M.bomber = null;
    }
  }

  BC.Snap = { encode, mirror, apply };
})();
