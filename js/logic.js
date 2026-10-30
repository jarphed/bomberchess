(function () {
  'use strict';
  // Authoritative, DOM-free game rules. Runs in the browser (local play) and on the LAN server.
  // Everything visual/audible is emitted as events in L.events for the client to present.
  const BC = window.BC = window.BC || {};
  const u = BC.u;

  function create(cfg) {
    const Ch = BC.Chess;
    const L = {
      settings: {
        n: cfg.n, moves: cfg.moves, bomberTime: cfg.bomberTime,
        brain: u.clamp(cfg.brain === undefined ? BC.BRAIN_DEFAULT : cfg.brain | 0, 0, BC.BRAINS.length - 1),
        turnTime: BC.turnTimeOf(cfg.turnTime), chain: !!cfg.chain, gates: !!cfg.gates,
        gateRound: BC.gateRoundOf(cfg.gateRound), powerLevel: BC.powerLevelOf(cfg.powerLevel),
        revive: !!cfg.revive, blood: !!cfg.blood,
      },
      board: BC.Board.create(cfg.n),
      chess: null, players: [],
      phase: 'chess', turn: 0, pliesLeft: 0, moveAnim: null, special: null, bomber: null,
      pawnLoss: [], pawnGain: [], transT: 0, over: null, time: 0, cpuTimer: 0, hold: 0, bomberRound: 0, turnLeft: 0,
      chessRound: 0, events: [], rev: 0,
    };
    let spRun = null; // timed hits and cues of the running special capture (server/local side only)
    // strikes waiting to go off one after the other ({ k, cell, o, by, chain }), and what happens after them;
    // spSheep: how many sheep the running chain has set stampeding so far
    let spQueue = [], spAfter = null, spChain = 0, spSheep = 0, sheepId = 1;
    let cpuThink = null; // the CPU's move being worked out a slice per frame (see BC.AI.chessThinker)
    const THINK_SLICE_MS = 8;
    L.chess = Ch.create(L.board);
    // how many pawns each player starts with: kills in the bomber round can bring lost ones back
    const startPawns = [];
    L.board.setup.forEach(s => { if (s.t === 'P') startPawns[s.o] = (startPawns[s.o] || 0) + 1; });
    for (let p = 0; p < cfg.n; p++) {
      L.players.push({
        p, type: cfg.types[p], name: (cfg.names && cfg.names[p]) || '', alive: true, inCheck: false,
        outReason: '', place: 0, stats: { bomb: 1, fire: 2, speed: 0, kick: 0 },
        sp: { xbomb: false, walker: false, bombpass: false, flamepass: false, mystery: false },
      });
    }

    const emit = ev => { L.events.push(ev); };
    const touch = () => { L.rev++; };
    L.emit = emit;
    L.alive = () => L.players.map(p => p.alive);
    L.aliveCount = () => L.players.filter(p => p.alive).length;

    function banner(text, jp, o) {
      o = o || {};
      emit({ e: 'banner', text, jp, o });
      L.hold = Math.max(L.hold, (o.dur || 2.2) * (o.small ? 0.5 : 0.9));
    }
    const burst = (c, col, n, sp, sz) => emit({ e: 'burst', c, col, n, sp, sz });
    const popup = (c, text, col) => emit({ e: 'popup', c, text, col });
    const snd = n => emit({ e: 'snd', n });
    const shake = v => emit({ e: 'shake', v });

    function spawnPowerups() {
      const st = L.chess;
      const k = BC.POWER_LEVELS[L.settings.powerLevel].k;
      const target = Math.round(Math.max(4, L.board.cells.length / 18) * k);
      const free = u.shuffle(L.board.cells.filter(c => !st.occ[c.id] && !st.powerups.has(c.id) && !st.sheep.has(c.id)).map(c => c.id));
      while (st.powerups.size < target && free.length) st.powerups.set(free.pop(), u.weighted(BC.POWERUPS).id);
    }

    function startChessPhase(first) {
      L.phase = 'chess';
      L.chessRound++;
      openGates();
      spawnPowerups();
      L.pliesLeft = L.settings.moves;
      if (first) banner('CHESS START', 'チェス スタート', { color: '#7fd8ff' });
      startTurn();
      touch();
    }

    const sheepFree = c => !L.chess.occ[c] && !L.chess.sheep.has(c) && !L.chess.powerups.has(c);

    // SHEEP GATES: from the chess round set in the lobby on, every chess round starts with each gate letting one
    // sheep jump in next to its corner (up to BC.GATE_SHEEP wandering sheep per gate on the board)
    function openGates() {
      if (!L.settings.gates || L.chessRound < L.settings.gateRound) return;
      const st = L.chess;
      const gates = BC.Board.gateSpots(L.board);
      if (L.chessRound === L.settings.gateRound) {
        banner('SHEEP GATES OPEN!', 'ひつじが くるよ!', { color: '#bff07a', dur: 2.2 });
        snd('gate');
      }
      let came = 0;
      gates.forEach((g, gi) => {
        if (st.roam.size >= gates.length * BC.GATE_SHEEP) return;
        let opts = g.entry.filter(sheepFree);
        if (!opts.length) opts = g.near.filter(sheepFree);
        if (!opts.length) return;
        const c = u.pick(opts), id = sheepId++;
        st.sheep.set(c, id);
        st.roam.add(id);
        emit({ e: 'sheepIn', id, g: gi, c });
        came++;
      });
      if (came) snd('baa');
    }

    // after every turn each sheep from the gates wanders one step (straight or diagonal) to a free square
    function roamSheep() {
      const st = L.chess;
      if (!st.roam.size) return;
      let moved = 0;
      u.shuffle([...st.sheep.entries()]).forEach(([cell, id]) => {
        if (!st.roam.has(id)) return;
        const opts = L.board.cells[cell].nT.filter(sheepFree);
        if (!opts.length) return;
        const to = u.pick(opts);
        st.sheep.delete(cell);
        st.sheep.set(to, id);
        emit({ e: 'sheepHop', id, from: cell, c: to });
        moved++;
      });
      if (moved && Math.random() < 0.2) snd('baa');
    }

    function nextAlive(t) {
      const n = L.players.length;
      for (let i = 1; i <= n; i++) {
        const k = (t + i) % n;
        if (L.players[k].alive) return k;
      }
      return t;
    }

    function updateChecks() {
      const alive = L.alive();
      L.players.forEach(pl => { pl.inCheck = pl.alive && Ch.inCheck(L.board, L.chess, pl.p, alive); });
    }

    function startTurn() {
      cpuThink = null;
      for (let guard = 0; guard < 12; guard++) {
        if (checkGameOver()) return;
        const pl = L.players[L.turn];
        if (!pl.alive) { L.turn = nextAlive(L.turn); continue; }
        updateChecks();
        const moves = Ch.allLegal(L.board, L.chess, pl.p, L.alive());
        if (!moves.length) {
          if (pl.inCheck) {
            const kc = Ch.kingCell(L.chess, pl.p);
            eliminate(pl.p, 'MATED');
            banner('CHECKMATE!', BC.PLAYER_NAMES[pl.p] + ' チェックメイト', { color: '#ff5a5a' });
            L.turn = nextAlive(L.turn);
            // a checkmated king calls in the nuke on its way out; play resumes once it has gone off
            if (kc >= 0) { startSpecial({ t: 'K', o: pl.p }, kc, -1, startTurn); return; }
            continue;
          } else if (L.aliveCount() <= 2) {
            gameOver(-1, 'STALEMATE');
            return;
          } else {
            banner(BC.PLAYER_NAMES[pl.p] + ' STALEMATE', 'パス', { small: true });
          }
          L.turn = nextAlive(L.turn);
          continue;
        }
        if (pl.inCheck) {
          snd('check');
          banner('CHECK!', BC.PLAYER_NAMES[pl.p] + ' チェック', { small: true, color: '#ff5a5a', dur: 1.3 });
        }
        // a little longer than the turn banner, so everyone sees whose turn it is before the CPU moves
        L.cpuTimer = 0.85 + Math.random() * 0.35;
        L.turnLeft = L.settings.turnTime;
        touch();
        return;
      }
    }

    function doMove(m) {
      const pc = L.chess.occ[m.from];
      const res = Ch.applyMove(L.board, L.chess, m);
      L.moveAnim = { id: pc.id, from: m.from, to: m.to, t: 0, dur: 0.24, res };
      snd(res.captured ? 'capture' : 'move');
      touch();
    }

    L.tryMove = function (p, from, to) {
      if (L.over || L.phase !== 'chess' || L.moveAnim || L.special || L.turn !== p) return false;
      const pl = L.players[p];
      const pc = L.chess.occ[from];
      if (!pl || !pl.alive || !pc || pc.o !== p) return false;
      const m = Ch.legalMoves(L.board, L.chess, from, L.alive()).find(x => x.to === to);
      if (!m) return false;
      doMove(m);
      return true;
    };

    function finishMove(a) {
      const res = a.res;
      const owner = res.piece.o;
      if (res.captured) {
        burst(a.to, ['#fff', '#ffd040', res.captured.o >= 0 ? BC.PLAYER_COLORS[res.captured.o] : '#888'], 18);
        shake(4);
        if (res.captured.t === 'K' && res.captured.o >= 0) {
          eliminate(res.captured.o, 'KING TAKEN');
          banner('KING CAPTURED!', BC.PLAYER_NAMES[res.captured.o] + ' アウト', { color: '#ff5a5a' });
        }
      }
      if (res.promoted) {
        snd('promote');
        popup(a.to, 'PROMOTED!', '#ffe14a');
        burst(a.to, ['#ffe14a', '#fff'], 20);
      }
      res.powerups.forEach(pu => grantPowerup(owner, pu.id, pu.cell));
      const strikes = [];
      if (res.captured && BC.Specials.KINDS.includes(res.captured.t)) strikes.push({ k: res.captured.t, cell: a.to, o: res.captured.o, by: res.piece.id });
      // any sheep the piece stepped on or ran past gets spooked and stampedes (sparing the piece that did it)
      res.path.forEach(c => {
        if (!L.chess.sheep.has(c)) return;
        L.chess.roam.delete(L.chess.sheep.get(c));
        L.chess.sheep.delete(c);
        popup(c, 'BAAA!', '#fff');
        strikes.push({ k: 'S', cell: c, o: -1, by: res.piece.id });
      });
      if (strikes.length) runStrikes(strikes, endMove); else endMove();
    }

    // the chess turn ran out: the turn is lost and a sheep wanders onto the board
    function missTurn() {
      const pl = L.players[L.turn];
      cpuThink = null;
      banner(BC.PLAYER_NAMES[pl.p] + ' TOO SLOW!', 'じかんぎれ!', { small: true, color: '#ffb040', dur: 1.6 });
      const st = L.chess;
      const free = L.board.cells.filter(c => !st.occ[c.id] && !st.powerups.has(c.id) && !st.sheep.has(c.id)).map(c => c.id);
      if (free.length) {
        const c = u.pick(free);
        st.sheep.set(c, sheepId++);
        emit({ e: 'spx', f: 'poof', c });
        popup(c, 'BAA!', '#fff');
      }
      snd('baa');
      endMove();
    }

    function endMove() {
      L.pliesLeft--;
      roamSheep();
      touch();
      if (checkGameOver()) return;
      L.turn = nextAlive(L.turn);
      if (L.pliesLeft <= 0) beginBomber(); else startTurn();
    }

    function startSpecial(cap, cell, capturerId, after) {
      runStrikes([{ k: cap.t, cell, o: cap.o, by: capturerId }], after);
    }

    // strikes play out one at a time; play only moves on (via after()) once the last one is over
    function runStrikes(list, after) {
      spQueue = list;
      spAfter = after;
      spChain = 0;
      spSheep = 0;
      nextStrike();
    }

    function nextStrike() {
      const s = spQueue.shift();
      if (!s) {
        const after = spAfter;
        spAfter = null;
        after();
        return;
      }
      // a spooked sheep stays on its square until its own stampede starts
      if (s.sheep !== undefined) {
        L.chess.sheep.delete(s.cell);
        L.chess.roam.delete(s.sheep);
      }
      // the more sheep a stampede takes along, the bigger the bang when one of them finally runs into a piece:
      // it blows up everything up to half the sheep count of squares around it
      if (s.k === 'S') spSheep++;
      const boom = s.k === 'S' ? Math.floor(spSheep / 2) : 0;
      const r = BC.Specials.plan(L.board, L.chess.occ, L.chess.sheep, s.k, s.cell, s.o, s.by, boom);
      L.special = r.view;
      spRun = r;
      const info = BC.Specials.INFO[s.k];
      if (s.chain) {
        L.special.chain = ++spChain;
        emit({ e: 'popup', c: s.cell, text: 'CHAIN x' + (spChain + 1) + '!', col: '#ff7aff', sz: 12, dy: -26 });
        snd('chain');
      }
      emit({ e: 'popup', c: s.cell, text: s.k === 'S' && spSheep > 1 ? 'STAMPEDE x' + spSheep + '!' : info.name, col: info.col, sz: 14 });
      touch();
    }

    function runSpecial(dt) {
      const sp = L.special;
      sp.t = Math.min(sp.dur, sp.t + dt);
      spRun.cues.forEach(cu => { if (!cu.done && sp.t >= cu.at) { cu.done = true; emit(cu.ev); } });
      spRun.hits.forEach(h => { if (!h.done && sp.t >= h.at) { h.done = true; strikePiece(h, sp.k); } });
      if (sp.t >= sp.dur) {
        L.special = null;
        spRun = null;
        nextStrike();
      }
    }

    // Victims of a strike just die. Kings are never struck, so a strike can't knock anyone out of the game.
    // With CHAINED DEATHS on, a victim with a strike of its own (knight, bishop, rook, queen) sets it off next.
    function strikePiece(h, kind) {
      if (h.sheep !== undefined) { strikeSheep(h, kind); return; }
      const pc = L.chess.occ[h.c];
      if (!pc || pc.id !== h.id || pc.t === 'K') return;
      const info = BC.Specials.INFO[kind];
      L.chess.occ[h.c] = null;
      emit({ e: 'shatter', c: h.c, t: pc.t, o: pc.o, txt: h.boom ? 'KABOOM!' : info.kill, st: info.st, k: kind });
      if (L.settings.chain && BC.Specials.KINDS.includes(pc.t)) spQueue.push({ k: pc.t, cell: h.c, o: pc.o, by: -1, chain: true });
      touch();
    }

    // A sheep hit by any strike isn't hurt: it gets spooked and stampedes next (CHAINED DEATHS or not).
    function strikeSheep(h, kind) {
      if (L.chess.sheep.get(h.c) !== h.sheep || spQueue.some(q => q.sheep === h.sheep)) return;
      if (kind !== 'S' || h.boom) emit({ e: 'spx', f: 'wool', c: h.c, st: BC.Specials.INFO[kind].st });
      popup(h.c, 'BAAA!', '#fff');
      spQueue.push({ k: 'S', cell: h.c, o: -1, by: -1, chain: true, sheep: h.sheep });
    }

    function grantPowerup(p, id, cell) {
      const pl = L.players[p];
      if (id === 'kick') pl.stats.kick += BC.KICKS;
      else if (pl.stats[id] !== undefined) pl.stats[id] = Math.min(BC.STAT_MAX[id], pl.stats[id] + 1);
      else pl.sp[id] = true;
      snd('pickup');
      burst(cell, ['#fff', '#7ef2ff', '#ffe14a', BC.PLAYER_COLORS[p]], 26, 200, 3);
      popup(cell, BC.POWERUP_BY_ID[id].name + '!', BC.PLAYER_COLORS[p]);
    }

    function eliminate(p, reason) {
      const pl = L.players[p];
      if (!pl.alive) return;
      pl.alive = false;
      pl.inCheck = false;
      pl.outReason = reason;
      pl.place = L.aliveCount() + 1;
      L.chess.occ.forEach((q, i) => {
        if (!q || q.o !== p) return;
        if (q.t === 'K') {
          L.chess.occ[i] = null;
          burst(i, ['#888', '#ccc', BC.PLAYER_COLORS[p]], 24);
        } else q.o = -1;
      });
      touch();
    }

    function checkGameOver() {
      if (L.over) return true;
      if (L.aliveCount() > 1) return false;
      const w = L.players.find(p => p.alive);
      gameOver(w ? w.p : -1, w ? 'LAST ONE STANDING' : 'DRAW');
      return true;
    }

    function gameOver(winner, reason) {
      L.over = { winner, reason };
      if (winner >= 0) L.players[winner].place = 1;
      snd(winner >= 0 ? 'win' : 'gameOver');
      touch();
    }

    function beginBomber() {
      L.phase = 'toBomber';
      L.transT = 0;
      banner('BOMBER TIME!!', 'ボンバータイム', { color: '#ff7a3c', dur: 2.4, force: true });
      snd('phaseBomber');
      touch();
    }

    function piecesOf(p, test) {
      const out = [];
      L.chess.occ.forEach((q, i) => { if (q && q.o === p && test(q)) out.push(i); });
      return out;
    }
    const pawnsOf = p => piecesOf(p, q => q.t === 'P');

    // how many enemy pieces attack p's king (a count, so a king already in check isn't put in double check)
    function checkers(p) {
      const st = L.chess, k = Ch.kingCell(st, p);
      let n = 0;
      if (k < 0) return 0;
      st.occ.forEach((q, i) => {
        if (!q || q.o < 0 || q.o === p || !L.players[q.o].alive) return;
        if (Ch.pieceMoves(L.board, st, i, true).some(m => m.to === k)) n++;
      });
      return n;
    }

    // the cells (of the given list) whose piece could go without opening a line onto its owner p's king
    function safeToLose(p, cells) {
      const occ = L.chess.occ, before = checkers(p);
      return cells.filter(c => {
        const q = occ[c];
        occ[c] = null;
        const ok = checkers(p) <= before;
        occ[c] = q;
        return ok;
      });
    }

    // a free starting pawn square (or any free square of the player's base) for a revived pawn. A base that's
    // full (of the neutral leftovers of a comeback player, say) gives the free square nearest the king instead.
    function reviveCell(p, taken) {
      const occ = L.chess.occ, pus = L.chess.powerups;
      const free = c => !occ[c] && !taken.has(c) && !L.chess.sheep.has(c);
      const pawnOk = c => !Ch.promotes(L.board, { t: 'P', o: p }, c);
      const home = L.board.setup.filter(s => s.o === p && s.t === 'P' && free(s.cell)).map(s => s.cell);
      const base = L.board.cells.filter(c => c.base === p && free(c.id) && pawnOk(c.id)).map(c => c.id);
      for (const list of [home, base]) {
        const clear = list.filter(c => !pus.has(c));
        if (clear.length) return u.pick(clear);
        if (list.length) return u.pick(list);
      }
      const kg = L.pawnGain.find(g => g.p === p && g.t === 'K');
      const k = kg ? kg.cell : Ch.kingCell(L.chess, p);
      if (k < 0) return -1;
      const kc = L.board.cells[k];
      const near = L.board.cells.filter(c => free(c.id) && pawnOk(c.id))
        .sort((a, b) => Math.hypot(a.cx - kc.cx, a.cy - kc.cy) - Math.hypot(b.cx - kc.cx, b.cy - kc.cy));
      return near.length ? near[0].id : -1;
    }

    // where a revived king lands: the free square nearest its starting square that no one attacks
    // (the nearest free square at all if every one is attacked)
    function kingSpot(p, taken) {
      const st = L.chess, cells = L.board.cells, alive = L.alive();
      const home = L.board.setup.find(s => s.o === p && s.t === 'K');
      const h = cells[home ? home.cell : 0];
      const free = cells.filter(c => !st.occ[c.id] && !taken.has(c.id) && !st.sheep.has(c.id))
        .sort((a, b) => Math.hypot(a.cx - h.cx, a.cy - h.cy) - Math.hypot(b.cx - h.cx, b.cy - h.cy));
      const safe = free.find(c => !Ch.isAttacked(L.board, st, c.id, o => o !== p && alive[o]));
      return safe ? safe.id : free.length ? free[0].id : -1;
    }

    // PLAYERS CAN REVIVE: a player knocked out of the chess game is back in with a king (it lands in the
    // 'pawnLoss' phase); its pawns come back with bomber kills, like everyone's
    function revive(pl, taken) {
      const cell = kingSpot(pl.p, taken);
      if (cell < 0) return;
      taken.add(cell);
      // everyone knocked out after this player moves one place down
      L.players.forEach(q => { if (!q.alive && q !== pl && q.place < pl.place) q.place++; });
      Object.assign(pl, { alive: true, inCheck: false, outReason: '', place: 0 });
      L.pawnGain.push({ p: pl.p, cell, t: 'K', done: false });
    }

    function endBomber(ps) {
      L.phase = 'toChess';
      L.transT = 0;
      L.bomber = null;
      L.pawnLoss = [];
      L.pawnGain = [];
      const taken = new Set();
      // the winner of the bomber round (the last one standing) comes back if it was out of the chess game
      if (L.settings.revive) {
        const standing = ps.bombers.filter(b => b.alive && !b.dying);
        const w = standing.length === 1 ? L.players[standing[0].p] : null;
        if (w && !w.alive) revive(w, taken);
      }
      // every kill brings back one of the killer's lost pawns; players already out of the chess game get none
      ps.kills.forEach(k => {
        if (!L.players[k.by].alive) return;
        const lost = (startPawns[k.by] || 0) - pawnsOf(k.by).length - L.pawnGain.filter(g => g.p === k.by && g.t === 'P').length;
        if (lost <= 0) return;
        const cell = reviveCell(k.by, taken);
        if (cell < 0) return;
        taken.add(cell);
        L.pawnGain.push({ p: k.by, cell, t: 'P', done: false });
      });
      // a hit costs a random pawn, but never one whose loss would put its own king in check. If every pawn is
      // shielding the king, a pawn due to be revived this round pays instead, else a random rook, bishop or
      // knight that can go safely (never the queen). Only if nothing can go without giving check is it a pawn.
      // With no pawns left one of the other pieces goes (the queen too), one that can go safely if there is one.
      // A player down to the bare king is out. Pieces already picked are lifted off the board meanwhile, so the
      // next player is judged on what's left.
      const lifted = [];
      ps.hits.forEach(p => {
        if (!L.players[p].alive) return;
        const pawns = pawnsOf(p);
        const others = piecesOf(p, q => q.t !== 'P' && q.t !== 'K');
        const g = L.pawnGain.findIndex(x => x.p === p && x.t === 'P');
        if (!pawns.length && g < 0 && !others.length) { eliminate(p, 'KING ALONE'); return; }
        let pick = safeToLose(p, pawns);
        if (!pick.length && g >= 0) { L.pawnGain.splice(g, 1); return; }
        if (!pick.length) pick = safeToLose(p, others.filter(c => !pawns.length || L.chess.occ[c].t !== 'Q'));
        if (!pick.length) pick = pawns.length ? pawns : others;
        const cell = u.pick(pick);
        const pc = L.chess.occ[cell];
        L.pawnLoss.push({ p, cell, id: pc.id, boomed: false });
        lifted.push([cell, pc]);
        L.chess.occ[cell] = null;
      });
      lifted.forEach(([cell, pc]) => { L.chess.occ[cell] = pc; });
      L.players.forEach(pl => { BC.SPECIALS.forEach(k => { pl.sp[k] = false; }); });
      banner('CHESS TIME', 'チェスタイム', { color: '#7fd8ff', dur: 2.4, force: true });
      snd('phaseChess');
      touch();
    }

    // by: the player whose blast did it (-1 or p for a self-inflicted hit)
    // the first wall of a shrinking round is about to drop
    L.onHurry = function () {
      banner('HURRY UP!', 'いそげ!', { small: true, color: '#ffb040', dur: 1.6, force: true });
      snd('alarm');
    };

    L.onBomberHit = function (p, by, crushed) {
      const N = BC.PLAYER_NAMES;
      const killer = by >= 0 && by !== p ? L.players[by] : null;
      const text = killer ? N[by] + ' GOT ' + N[p] + '!' : N[p] + (crushed ? ' CRUSHED!' : ' HIT!');
      banner(text, L.players[p].alive ? 'ポーンを失う!' : 'ダウン!', { small: true, color: '#ff5a5a', dur: 1.5, force: true });
      if (!killer || !killer.alive) return;
      const kb = L.bomber.bombers.find(b => b.p === by);
      const kills = L.bomber.kills.filter(k => k.by === by).length;
      const revive = (startPawns[by] || 0) - pawnsOf(by).length >= kills;
      if (kb) popup(BC.Bomber.occCell(kb), revive ? '+1 PAWN!' : 'KILL!', BC.PLAYER_COLORS[by]);
    };

    L.setType = function (p, type) {
      const pl = L.players[p];
      if (!pl || pl.type === type) return;
      pl.type = type;
      if (type === 'CPU' && L.turn === p) L.cpuTimer = 0.8;
      touch();
    };

    // inputs: { [player]: {dx, dy, bomb, moveTo} } for HUMAN players; CPUs are driven here
    L.update = function (dt, inputs) {
      L.time += dt;
      if (L.over) return;
      L.hold = Math.max(0, L.hold - dt);
      inputs = inputs || {};

      if (L.phase === 'chess') {
        if (L.moveAnim) {
          L.moveAnim.t += dt;
          if (L.moveAnim.t >= L.moveAnim.dur) {
            const a = L.moveAnim;
            L.moveAnim = null;
            finishMove(a);
          }
        } else if (L.special) {
          runSpecial(dt);
        } else if ((L.turnLeft -= dt) <= 0) {
          missTurn();
        } else {
          const pl = L.players[L.turn];
          if (pl && pl.alive && pl.type === 'CPU') {
            // it thinks during banners too, but only moves once they're out of the way and its timer ran out
            if (!cpuThink || cpuThink.p !== L.turn) cpuThink = BC.AI.chessThinker(L, L.turn);
            const ready = cpuThink.step(THINK_SLICE_MS);
            if (L.hold <= 0) L.cpuTimer -= dt;
            if (ready && L.hold <= 0 && L.cpuTimer <= 0) {
              const m = cpuThink.move;
              cpuThink = null;
              if (m) doMove(m); else startTurn();
            }
          } else {
            cpuThink = null;
          }
        }
      } else if (L.phase === 'toBomber') {
        L.transT += dt;
        if (L.transT > 2.2) {
          L.bomberRound++;
          L.bomber = BC.Bomber.create(L);
          L.phase = 'bomber';
          touch();
        }
      } else if (L.phase === 'bomber') {
        const ps = L.bomber;
        const inp = {};
        ps.bombers.forEach(b => {
          if (!b.alive || b.dying) return;
          inp[b.p] = L.players[b.p].type === 'HUMAN' ? (inputs[b.p] || {}) : BC.AI.bomberInput(L, ps, b, dt);
        });
        BC.Bomber.update(L, ps, dt, inp);
        // the round runs its full time, unless at most one bomber is left standing: then it's straight back to chess
        const dying = ps.bombers.some(b => b.alive && b.dying);
        const standing = ps.bombers.filter(b => b.alive && !b.dying).length;
        if (!dying && (ps.clock >= ps.dur || standing <= 1)) endBomber(ps);
      } else if (L.phase === 'toChess') {
        L.transT += dt;
        if (L.transT > 2.2) {
          if (L.pawnLoss.length || L.pawnGain.length) {
            L.phase = 'pawnLoss';
            L.transT = 0;
            touch();
          } else if (!checkGameOver()) {
            startChessPhase(false);
          }
        }
      } else if (L.phase === 'pawnLoss') {
        // lost pawns (or, to spare a king from check or with no pawns left, another piece) blow up - a knight,
        // bishop, rook or queen sets off its strike, and the clock waits for it - then the pieces won back in
        // the bomber round (pawns for kills, a king for a comeback) materialise
        if (L.special) { runSpecial(dt); return; }
        L.transT += dt;
        const strikes = [];
        L.pawnLoss.forEach(l => {
          if (l.boomed || L.transT < 1.1) return;
          l.boomed = true;
          const pc = L.chess.occ[l.cell];
          if (pc && pc.id === l.id) {
            L.chess.occ[l.cell] = null;
            emit({ e: 'shatter', c: l.cell, t: pc.t, o: pc.o, txt: BC.PIECE_NAMES[pc.t] + ' LOST!' });
            snd('explode');
            shake(12);
            touch();
            if (BC.Specials.KINDS.includes(pc.t)) strikes.push({ k: pc.t, cell: l.cell, o: pc.o, by: -1 });
          }
        });
        if (strikes.length) { runStrikes(strikes, () => {}); return; }
        L.pawnGain.forEach(g => {
          if (g.done || L.transT < 1.3) return;
          g.done = true;
          const t = g.t || 'P';
          if (L.chess.occ[g.cell]) {
            // a comeback king always finds a square
            if (t !== 'K') return;
            g.cell = kingSpot(g.p, new Set());
            if (g.cell < 0) return;
          }
          L.chess.occ[g.cell] = { t, o: g.p, moved: false, id: L.chess.uid++ };
          const pu = L.chess.powerups.get(g.cell);
          if (pu) { L.chess.powerups.delete(g.cell); grantPowerup(g.p, pu, g.cell); }
          burst(g.cell, ['#fff', '#ffe14a', '#7ef2ff', BC.PLAYER_COLORS[g.p]], t === 'K' ? 50 : 30, 180, 3);
          popup(g.cell, t === 'K' ? 'KING REVIVED!' : 'PAWN REVIVED!', BC.PLAYER_COLORS[g.p]);
          if (t === 'K') banner(BC.PLAYER_NAMES[g.p] + ' IS BACK!', 'ふっかつ!', { color: BC.PLAYER_COLORS[g.p], dur: 2 });
          snd('promote');
          touch();
        });
        if (L.transT > 2.6) {
          L.pawnLoss = [];
          L.pawnGain = [];
          if (!checkGameOver()) startChessPhase(false);
        }
      }
    };

    startChessPhase(true);
    return L;
  }

  BC.Logic = { create };
})();
