(function () {
  'use strict';
  const BC = window.BC;
  const u = BC.u;
  const R = BC.Render, I = BC.Input, Ch = BC.Chess, A = BC.Audio, N = BC.Net;

  // Presentation/controller. Game rules live in BC.Logic (local) or on the LAN server (net).
  const G = {
    screen: 'loading', time: 0, mode: 'local', S: null,
    settings: {
      n: 4, types: ['HUMAN', 'CPU', 'CPU', 'CPU', 'CPU'], moves: 10, bomberTime: 45, wormsTime: BC.WORMS_TIME.def, brain: BC.BRAIN_DEFAULT, ...BC.modeSettings(),
      turnTime: BC.TURN_TIME.def, chain: true, gates: true, gateRound: BC.GATE_ROUND.def, powerLevel: BC.POWER_DEFAULT,
      revive: true,
    },
    board: null, chess: null, players: [], cfg: null,
    phase: 'chess', boardMode: 'chess', flip: null,
    turn: 0, pliesLeft: 0, selected: -1, selId: 0, selRev: -1, legal: [], hover: -1,
    moveAnim: null, special: null, bomber: null, pawnLoss: [], pawnGain: [], transT: 0,
    banner: null, bannerQueue: [], particles: [], popups: [], fx: [], shake: 0, flash: null,
    paused: false, pauseIdx: 0, over: null, menuIdx: 0, titleIdx: 0, titleT: 0, previews: {},
    turnBanner: null, turnKey: '', puInfo: null, dragSlider: null,
    mySeats: [], netIn: {}, moveLock: 0, lastTick: 0,
  };
  BC.Game = G;

  G.alive = () => G.players.map(p => p.alive);
  G.aliveCount = () => G.players.filter(p => p.alive).length;
  G.isMine = p => (G.mode === 'local' ? !!(G.players[p] && G.players[p].type === 'HUMAN') : G.mySeats.includes(p));
  G.localIdx = function (p) {
    if (G.mode === 'net') return G.mySeats.indexOf(p);
    if (!G.players[p] || G.players[p].type !== 'HUMAN') return -1;
    let k = 0;
    for (let i = 0; i < p; i++) if (G.players[i].type === 'HUMAN') k++;
    return k;
  };
  G.humanTurn = () => G.screen === 'play' && G.phase === 'chess' && !G.paused && !G.moveAnim && !G.special && G.moveLock <= 0 &&
    G.players[G.turn] && G.players[G.turn].alive && G.players[G.turn].type === 'HUMAN' && G.isMine(G.turn);
  // any piece can be clicked to see its moves; they can only be played by its owner, on their turn
  G.selLive = () => {
    const pc = G.selected >= 0 && G.chess.occ[G.selected];
    return !!pc && pc.o === G.turn && G.humanTurn();
  };

  // --------------------------------------------------------------- effects
  function banner(text, jp, opts) {
    const b = Object.assign({ text, jp, t: 0, dur: 2.2 }, opts || {});
    if (G.banner && !b.force) G.bannerQueue.push(b); else G.banner = b;
  }

  function burst(x, y, colors, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = u.rand(0.3, 1) * (speed || 160);
      G.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, grav: 420,
        life: u.rand(0.4, 0.9), max: 0.9, color: u.pick(colors), size: size || u.randInt(2, 5),
      });
    }
  }

  function popup(text, x, y, color, size) {
    G.popups.push({ text, x, y, t: 0, color: color || '#fff', size });
  }
  G.burst = burst;
  G.popup = popup;

  // A lost pawn (or a strike victim) cracks apart into flying sprite shards.
  // style 'zap' leaves charred shards, 'vapor' turns the piece to ash; txt overrides the popup ('' for none).
  function shatterPiece(cell, pc, txt, style) {
    const c = G.board.cells[cell];
    const set = BC.Assets.pieces && BC.Assets.pieces[pc.o < 0 ? -1 : pc.o];
    const size = 14 * G.board.pieceScale;
    const col = BC.PLAYER_COLORS[pc.o] || '#999';
    if (style === 'vapor') {
      const ghost = BC.Assets.pieceWhite && BC.Assets.pieceWhite[pc.t];
      if (ghost) {
        G.particles.push({
          img: ghost, sx: 0, sy: 0, sw: ghost.width, sh: ghost.height, x: c.sx, y: c.sy - size * 0.08,
          vx: 0, vy: -40, grav: -60, rot: 0, vr: 0, size, life: 0.45, max: 0.45,
        });
      }
      burst(c.sx, c.sy, ['#3a3438', '#5a5560', '#8a8490', col], 22, 120, 4);
      return;
    }
    const img = style === 'zap' ? BC.Assets.pieceChar && BC.Assets.pieceChar[pc.t] : set && set[pc.t];
    const n = 4;
    if (img) {
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const a = Math.atan2(gy - (n - 1) / 2, gx - (n - 1) / 2) + u.rand(-0.4, 0.4);
          const v = u.rand(140, 320);
          G.particles.push({
            img, sx: gx * img.width / n, sy: gy * img.height / n, sw: img.width / n, sh: img.height / n,
            x: c.sx + (gx - (n - 1) / 2) * size / n, y: c.sy + (gy - (n - 1) / 2) * size / n,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v - 180, grav: 700,
            rot: 0, vr: u.rand(-14, 14), size: size / n, life: u.rand(0.9, 1.4), max: 1.4,
          });
        }
      }
    }
    burst(c.sx, c.sy, style === 'zap' ? ['#fff', '#9fe8ff', '#3fa0ff', '#ffe14a', col] : ['#fff', '#ffe14a', '#ff8a1c', '#ff3d3d', col], 40, 280, 4);
    G.fx.push({ type: 'boom', x: c.sx, y: c.sy, t: 0, dur: 0.6, size: size * 2.2 });
    G.fx.push({ type: 'ring', x: c.sx, y: c.sy, t: 0, dur: 0.5, r: size * 1.8, color: '#fff' });
    G.fx.push({ type: 'ring', x: c.sx, y: c.sy, t: -0.08, dur: 0.6, r: size * 2.6, color: col });
    const label = txt === undefined ? 'PAWN LOST!' : txt;
    if (label) popup(label, c.sx, c.sy - size * 0.6, col);
  }

  function handleEvents(list) {
    const cells = G.board.cells;
    list.forEach(ev => {
      const c = ev.c !== undefined ? cells[ev.c] : null;
      switch (ev.e) {
        case 'banner': banner(ev.text, ev.jp, ev.o); break;
        case 'burst': if (c) burst(c.sx, c.sy, ev.col, ev.n, ev.sp, ev.sz); break;
        case 'popup': if (c) popup(ev.text, c.sx, c.sy - 22 + (ev.dy || 0), ev.col, ev.sz); break;
        case 'snd':
          if (ev.n === 'win' && G.over && G.over.lost) A.play('gameOver');
          else A.play(ev.n);
          break;
        case 'shake': G.shake = Math.min(14, Math.max(G.shake, ev.v)); break;
        case 'shatter': if (c) shatterPiece(ev.c, { t: ev.t, o: ev.o }, ev.txt, ev.st); break;
        case 'spx': if (BC.SpecialFx) BC.SpecialFx.event(G, ev, c); break;
        case 'wb': if (BC.WormsView) BC.WormsView.blood(G, ev); break;
        case 'sheepIn':
        case 'sheepHop': if (c && BC.Pasture) BC.Pasture.event(G, ev); break;
      }
    });
  }

  // --------------------------------------------------------------- sessions
  function sync() {
    const S = G.S;
    G.board = S.board; G.chess = S.chess; G.players = S.players; G.cfg = S.settings;
    G.phase = S.phase; G.turn = S.turn; G.pliesLeft = S.pliesLeft; G.moveAnim = S.moveAnim; G.special = S.special;
    G.bomber = S.bomber; G.worms = S.worms; G.pawnLoss = S.pawnLoss; G.pawnGain = S.pawnGain || []; G.transT = S.transT;
    G.chessRound = S.chessRound || 0;
  }

  function attach(S, mode) {
    G.modePicker = null;
    G.S = S;
    G.mode = mode;
    N.watching = mode === 'net';
    R.layout(S.board, !!(S.settings.gates && S.settings.playChess));
    Object.assign(G, {
      boardMode: (S.phase === 'bomber' || BC.isBomberOnly(S.settings)) ? 'bomber' : 'chess', flip: null,
      wormInputKey: '', wormUiClick: !!(I.mouse.down || I.mouse.clicked),
      selected: -1, selId: 0, legal: [], banner: null, bannerQueue: [], particles: [], popups: [], fx: [],
      shake: 0, flash: null, paused: false, over: null, screen: 'play', lastPhase: S.phase, netIn: {}, moveLock: 0,
      turnBanner: null, turnKey: '', puInfo: null, pasture: BC.Pasture ? BC.Pasture.fresh() : null,
      gore: BC.Gore ? BC.Gore.fresh() : null,
    });
    N.snaps = [];
    sync();
    A.music(S.phase === 'worms' ? 'worms' : G.boardMode === 'bomber' ? 'bomber' : 'chess');
  }

  function onPhase(prev, next) {
    // blood and body parts stay for the round, and are gone once the board flips
    if ((next === 'toBomber' || next === 'toWorms' || next === 'toChess') && BC.Gore) BC.Gore.fadeOut(G);
    if (next === 'toBomber') {
      G.flip = { t0: G.time + 0.5, from: 'chess', to: 'bomber' };
      G.selected = -1; G.legal = [];
      A.music(null);
    } else if (next === 'toWorms') {
      clearSelection(); G.turnBanner = null; G.puInfo = null;
      A.music(null);
    } else if (next === 'worms') {
      G.wormInputKey = ''; G.wormUiClick = !!(I.mouse.down || I.mouse.clicked); G.puInfo = null; G.turnBanner = null;
      A.music('worms');
    } else if (next === 'bomber') {
      G.flip = null; G.boardMode = 'bomber'; N.snaps = [];
      A.music('bomber');
    } else if (next === 'toChess') {
      G.flip = prev === 'bomber' ? { t0: G.time + 0.5, from: 'bomber', to: 'chess' } : null;
      A.music(null);
    } else if (next === 'pawnLoss') {
      G.flip = null; G.boardMode = 'chess';
    } else if (next === 'chess') {
      G.flip = null; G.boardMode = 'chess';
      if (prev !== 'chess') A.music('chess');
    }
  }

  function afterStateChange() {
    if (G.S.phase !== G.lastPhase) { onPhase(G.lastPhase, G.S.phase); G.lastPhase = G.S.phase; }
    sync();
    if (G.S.over && G.screen === 'play') {
      const winner = G.S.over.winner;
      const mine = G.mode === 'net' ? G.mySeats.slice() : G.players.filter(pl => pl.type === 'HUMAN').map(pl => pl.p);
      const lost = winner >= 0 && mine.length > 0 && !mine.includes(winner);
      const won = winner >= 0 && !lost;
      const loser = lost ? mine.slice().sort((a, b) => (G.players[a].place || 9) - (G.players[b].place || 9))[0] : -1;
      const over = { winner, reason: G.S.over.reason, t: 0, won, lost, loser };
      G.over = over;
      if (BC.Screens && BC.Screens.initOver) BC.Screens.initOver(G);
      G.turnBanner = null;
      G.puInfo = null;
      G.screen = 'over';
      G.paused = false;
      A.music(null);
      setTimeout(() => { if (G.screen === 'over' && G.over === over) A.music(over.won ? 'victory' : 'gameover'); }, 1400);
    }
  }

  G.startLocal = function () {
    const s = G.settings;
    let h = 0;
    const types = s.types.slice(0, s.n);
    const names = types.map(t => (t === 'HUMAN' ? 'P' + (++h) : 'CPU'));
    const L = BC.Logic.create({
      n: s.n, moves: s.moves, bomberTime: s.bomberTime, wormsTime: s.wormsTime, brain: s.brain, turnTime: s.turnTime, chain: s.chain, gates: s.gates, ...BC.modeSettings(s),
      gateRound: s.gateRound, powerLevel: s.powerLevel, revive: s.revive, types, names,
    });
    attach(L, 'local');
    handleEvents(L.events);
    L.events = [];
  };

  G.startLan = function () {
    G.screen = 'lobby';
    G.menuIdx = 0;
    N.connect();
  };

  G.leaveLan = function () {
    N.disconnect();
    G.S = null;
    G.mode = 'local';
    G.paused = false;
    G.screen = 'title';
    A.music('title');
  };

  function toLobby() {
    N.watching = false;
    G.S = null;
    G.paused = false;
    G.screen = 'lobby';
    G.menuIdx = 1;
    A.music('title');
  }

  // walk out of the running LAN game: a CPU takes over for good, and the lobby won't pull you back in
  G.leaveGame = function () {
    N.quitGame();
    toLobby();
  };

  // in-game menu (ESC or the MENU button)
  G.menuItems = function () {
    const musicRow = {
      id: 'music',
      label: 'MUSIC: ' + (A.isMusicMuted() ? 'OFF' : 'ON'),
      sub: 'SOUND EFFECTS STAY ON',
    };
    if (G.mode !== 'net') {
      return [
        { id: 'resume', label: 'RESUME' },
        musicRow,
        { id: 'title', label: 'QUIT GAME', sub: 'BACK TO THE TITLE SCREEN' },
      ];
    }
    const seated = G.mySeats.length > 0;
    const items = [
      { id: 'resume', label: 'BACK TO GAME' },
      musicRow,
      { id: 'leave', label: seated ? 'LEAVE GAME' : 'STOP WATCHING', sub: seated ? 'A CPU TAKES OVER YOUR SEAT' : 'BACK TO THE LOBBY' },
    ];
    if (N.lobby && N.lobby.host === N.token) items.push({ id: 'end', label: 'END GAME FOR ALL', sub: 'EVERYONE GOES BACK TO THE LOBBY' });
    items.push({ id: 'quit', label: 'QUIT TO TITLE', sub: 'LEAVE THE GAME AND DISCONNECT' });
    return items;
  };

  function menuAction(id) {
    A.init();
    if (id === 'music') {
      A.toggleMusic();
      A.play('menuMove');
      return;
    }
    A.play('menuSelect');
    switch (id) {
      case 'resume': G.paused = false; break;
      case 'title': G.S = null; G.paused = false; G.screen = 'title'; A.music('title'); break;
      case 'leave': G.leaveGame(); break;
      case 'end': N.send({ k: 'abort' }); G.paused = false; break;
      case 'quit': N.quitGame(); G.leaveLan(); break;
    }
  }

  function toggleMenu() {
    G.paused = !G.paused;
    G.pauseIdx = 0;
    G.puInfo = null;
    A.play('menuSelect');
    if (G.paused) releaseNetInputs();
  }

  function updateMenu() {
    const items = G.menuItems();
    G.pauseIdx = u.clamp(G.pauseIdx, 0, items.length - 1);
    const m = I.menu();
    if (m.up) { G.pauseIdx = (G.pauseIdx - 1 + items.length) % items.length; A.play('menuMove'); }
    if (m.down) { G.pauseIdx = (G.pauseIdx + 1) % items.length; A.play('menuMove'); }
    const hit = items.findIndex((it, i) => {
      const r = BC.Screens.pauseItemRect(i, items.length);
      return I.mouse.x >= r.x && I.mouse.x <= r.x + r.w && I.mouse.y >= r.y && I.mouse.y <= r.y + r.h;
    });
    if (hit >= 0 && I.mouse.moved) G.pauseIdx = hit;
    if (I.hit('KeyQ')) { menuAction(G.mode === 'net' ? 'leave' : 'title'); return; }
    if ((m.left || m.right) && items[G.pauseIdx] && items[G.pauseIdx].id === 'music') menuAction('music');
    else if (m.ok) menuAction(items[G.pauseIdx].id);
    else if (I.mouse.clicked && hit >= 0) menuAction(items[hit].id);
  }

  function refreshSeats() {
    const lb = N.lobby;
    if (!lb) return;
    const n = G.mode === 'net' && G.S ? G.S.settings.n : lb.n;
    G.mySeats = lb.seats.map((s, i) => (s.owner === N.token && i < n ? i : -1)).filter(i => i >= 0);
  }

  N.on('lobby', m => {
    refreshSeats();
    if (!m.inGame && G.mode === 'net' && (G.screen === 'play' || G.screen === 'over')) toLobby();
  });
  N.on('start', m => {
    if (G.screen !== 'lobby' && G.screen !== 'play' && G.screen !== 'over') return;
    attach(BC.Snap.mirror(m.cfg), 'net');
    refreshSeats();
  });
  N.on('s', m => {
    if (G.mode !== 'net' || !G.S) return;
    BC.Snap.apply(G.S, m);
    if (G.S.bomber) N.pushBomberSnap(G.S.bomber.bombers, G.S.board.cells);
    if (G.moveLock > 0 && (G.S.moveAnim || G.S.turn !== G.turn)) G.moveLock = 0;
    afterStateChange();
    if (m.ev) handleEvents(m.ev);
  });
  N.on('end', () => {
    if (G.mode !== 'net') return;
    toLobby();
  });

  // ----------------------------------------------------------------- update
  function selectCell(cell) {
    G.selected = cell;
    G.selId = G.chess.occ[cell].id;
    G.selRev = G.S.rev;
    G.legal = Ch.legalMoves(G.board, G.chess, cell, G.alive());
  }

  function clearSelection() { G.selected = -1; G.selId = 0; G.legal = []; }

  // keep a selection in step with the board: drop it once its piece is gone, refresh its moves on every change
  function refreshSelection() {
    if (G.selected < 0) return;
    const pc = G.chess.occ[G.selected];
    if (G.phase !== 'chess' || !pc || pc.id !== G.selId || pc.o < 0) clearSelection();
    else if (G.S.rev !== G.selRev) selectCell(G.selected);
  }

  function chessInput() {
    G.hover = R.cellAt(G.board, I.mouse.x, I.mouse.y);
    if (I.mouse.rclicked) clearSelection();
    if (!I.mouse.clicked || G.hover < 0) return;
    const q = G.chess.occ[G.hover];
    const m = G.selLive() && G.legal.find(x => x.to === G.hover);
    if (m) {
      clearSelection();
      if (G.mode === 'local') G.S.tryMove(G.turn, m.from, m.to);
      else { N.send({ k: 'mv', s: G.turn, from: m.from, to: m.to }); G.moveLock = 0.6; }
    } else if (q && q.o >= 0) {
      selectCell(G.hover);
      A.play('select');
    } else clearSelection();
  }

  function bomberInputs() {
    const out = {};
    G.players.forEach(pl => {
      if (pl.type !== 'HUMAN' || !G.isMine(pl.p)) return;
      const inp = I.bomber(G.localIdx(pl.p));
      if (G.mode === 'local') { out[pl.p] = inp; return; }
      // bomb presses travel as a counter so none get lost or doubled
      const st = G.netIn[pl.p] || (G.netIn[pl.p] = { dx: 0, dy: 0, bs: 0, sent: '' });
      if (inp.bomb) st.bs++;
      st.dx = inp.dx; st.dy = inp.dy;
      const key = st.dx + ',' + st.dy + ',' + st.bs;
      if (key !== st.sent) { st.sent = key; N.send({ k: 'in', s: pl.p, dx: st.dx, dy: st.dy, bs: st.bs }); }
    });
    return out;
  }

  function wormsInputs(release) {
    const w = G.worms, p = w.active;
    if (!G.isMine(p) || G.players[p].type !== 'HUMAN') return {};
    if (release) {
      if (G.mode === 'net') {
        G.wormInputKey = '';
        N.send({ k: 'wi', s: p, round: G.chessRound, turn: w.turnNo, dx: 0, dy: 0, charge: false });
      }
      return {};
    }
    const raw = I.worms(G.localIdx(p));
    const unit = w.units.find(u => u.p === p);
    let select = '';
    if (I.mouse.clicked && BC.WormsView) {
      const wAt = BC.WormsView.weaponAt(I.mouse.x, I.mouse.y);
      if (wAt) {
        G.wormUiClick = true;
        if (unit && w.phase === 'aim') select = wAt;
      }
    }
    if (!select && unit && w.phase === 'aim') {
      const avail = BC.Worms.available(unit);
      if (raw.slot >= 1 && raw.slot <= avail.length) select = avail[raw.slot - 1];
    }
    const charge = G.wormUiClick ? raw.padCharge : raw.charge;
    let aimAngle, aimFace;
    if (unit && w.phase === 'aim' && !w.charging && !raw.dy && BC.WormsView && BC.WormsView.FIELD) {
      const F = BC.WormsView.FIELD, mx = I.mouse.x, my = I.mouse.y;
      if ((I.mouse.moved || (I.mouse.clicked && !G.wormUiClick)) &&
          mx >= F.x && mx <= F.x + F.w && my >= F.y && my <= F.y + F.h) {
        let ox = unit.x, oy = unit.y - 14;
        if (unit.weapon === 'mortar') {
          const mb = BC.Worms.mortarBase(w, unit);
          ox = mb.x; oy = mb.y - 4;
        }
        const vx = (mx - F.x) - ox, vy = (my - F.y) - oy;
        if (Math.hypot(vx, vy) > 4) {
          aimFace = Math.abs(vx) < 2 ? unit.face : (vx < 0 ? -1 : 1);
          aimAngle = Math.round(Math.atan2(-vy, Math.abs(vx)) * 1000) / 1000;
        }
      }
    }
    const inp = { dx: raw.dx, dy: raw.dy, jump: raw.jump, cycle: raw.cycle, wheel: raw.wheel, select, charge };
    if (aimAngle !== undefined) { inp.aimAngle = aimAngle; inp.aimFace = aimFace; }
    if (G.mode === 'local') return { [p]: inp };
    const key = [w.turnNo, p, inp.dx, inp.dy, inp.charge, aimAngle === undefined ? '' : aimAngle, aimFace || ''].join(',');
    if (key !== G.wormInputKey || inp.jump || inp.cycle || inp.wheel || inp.select) {
      G.wormInputKey = key;
      N.send({ k: 'wi', s: p, round: G.chessRound, turn: w.turnNo, ...inp });
    }
    return {};
  }

  // between server snapshots keep timers running so animation stays smooth
  function advanceMirror(dt) {
    const S = G.S;
    // the lost pieces' strikes hold the clock of the phase they go off in
    if (!(S.phase === 'pawnLoss' && S.special)) S.transT += dt;
    if (S.phase === 'chess' && !S.moveAnim && !S.special) S.turnLeft = Math.max(0, S.turnLeft - dt);
    if (S.worms) {
      if (S.worms.phase === 'aim') S.worms.timeLeft = Math.max(0, S.worms.timeLeft - dt);
      if (S.worms.retreat > 0) S.worms.retreat = Math.max(0, S.worms.retreat - dt);
      if (S.worms.weaponCue > 0) S.worms.weaponCue = Math.max(0, S.worms.weaponCue - dt);
    }
    if (S.moveAnim) S.moveAnim.t = Math.min(S.moveAnim.dur, S.moveAnim.t + dt);
    if (S.special) S.special.t = Math.min(S.special.dur, S.special.t + dt);
    const ps = S.bomber;
    if (ps) {
      if (ps.ready > 0) ps.ready -= dt; else ps.clock += dt;
      ps.bombs.forEach(b => {
        b.anim += dt; b.fuse -= dt;
        if ((b.walk || b.slide) && b.from !== b.to) b.t = Math.min(1, b.t + dt / (b.slide ? BC.Bomber.KICK_STEP : BC.Bomber.WALK_STEP));
      });
      ps.explosions.forEach(e => { e.t = Math.min(e.dur - 0.001, e.t + dt); });
      N.interpolate(ps.bombers);
    }
  }

  function tickBanner(dt) {
    if (!G.banner) {
      // the turn banner waits for the other banners to finish
      if (G.turnBanner && (G.turnBanner.t += dt) >= G.turnBanner.dur) G.turnBanner = null;
      return;
    }
    G.banner.t += dt;
    if (G.banner.t >= G.banner.dur) G.banner = G.bannerQueue.shift() || null;
  }

  // announce every new chess turn; a big banner and a chime when it's yours
  function checkTurn() {
    if (G.phase !== 'chess' || G.moveAnim || G.special || G.S.over) return;
    const key = G.turn + ':' + G.pliesLeft;
    if (key === G.turnKey) return;
    G.turnKey = key;
    const pl = G.players[G.turn];
    if (!pl || !pl.alive) return;
    const mine = pl.type === 'HUMAN' && G.isMine(pl.p);
    G.turnBanner = { p: pl.p, mine, t: 0, dur: mine ? R.YOUR_TURN_T : 0.95 };
    if (mine) A.play('yourTurn');
  }

  // the full-screen YOUR TURN banner: a click or ENTER cuts it short (and doesn't reach the board)
  function skipYourTurn() {
    const tb = G.turnBanner;
    if (!tb || !tb.mine || G.banner || tb.t >= tb.dur - 0.3) return false;
    if (!I.mouse.clicked && !I.menu().ok) return false;
    tb.t = tb.dur - 0.3;
    return true;
  }

  // tick-tock through the last seconds of your own turn
  function turnTicks() {
    const pl = G.players[G.turn];
    if (G.phase !== 'chess' || G.moveAnim || G.special || !pl || !(pl.type === 'HUMAN' && G.isMine(pl.p))) { G.lastTurnTick = -1; return; }
    const left = Math.ceil(G.S.turnLeft);
    if (left !== G.lastTurnTick && left <= 5 && left > 0) A.play(left <= 2 ? 'tickHi' : 'tick');
    G.lastTurnTick = left;
  }

  // the power-up column: click an icon for its info card, click anywhere else to close it again
  function powerColumnInput() {
    if (G.cfg && G.cfg.playBomber === false) { G.puInfo = null; return; }
    if (!I.mouse.clicked) return;
    const id = R.powerupAt(I.mouse.x, I.mouse.y);
    if (id) { G.puInfo = G.puInfo === id ? null : id; A.play('menuMove'); } else G.puInfo = null;
  }

  // let go of any held direction on the server (menu opened, tab hidden)
  function releaseNetInputs() {
    if (G.mode !== 'net') return;
    if (G.phase === 'worms' && G.worms) wormsInputs(true);
    Object.keys(G.netIn).forEach(s => {
      const st = G.netIn[s];
      st.dx = 0; st.dy = 0; st.sent = '';
      N.send({ k: 'in', s: Number(s), dx: 0, dy: 0, bs: st.bs });
    });
  }

  function updatePlay(dt) {
    const btn = R.MENU_BTN;
    const onBtn = I.mouse.clicked && I.mouse.x >= btn.x && I.mouse.x <= btn.x + btn.w && I.mouse.y >= btn.y && I.mouse.y <= btn.y + btn.h;
    const menuWasOpen = G.paused;
    if (I.hit('Escape') || onBtn) toggleMenu();
    else if (G.paused) updateMenu();
    if (G.screen !== 'play') return;
    if (G.paused && G.mode === 'local') return;
    // the click or key that worked the menu (or skipped the YOUR TURN banner) must not also reach the board
    const busy = G.paused || menuWasOpen || onBtn || (!G.paused && skipYourTurn());
    if (!I.mouse.down && !I.mouse.clicked) G.wormUiClick = false;
    else if (busy) G.wormUiClick = true;

    tickBanner(dt);
    G.moveLock -= dt;

    if (!busy && G.phase !== 'worms') powerColumnInput();
    if (G.phase === 'chess' && !busy) { refreshSelection(); chessInput(); } else G.hover = -1;
    const inputs = busy ? {} : G.phase === 'bomber' ? bomberInputs() : G.phase === 'worms' ? wormsInputs(false) : {};

    if (G.mode === 'local') {
      G.S.update(dt, inputs);
      const ev = G.S.events;
      G.S.events = [];
      afterStateChange();
      handleEvents(ev);
    } else {
      advanceMirror(dt);
      sync();
    }
    refreshSelection();
    checkTurn();
    turnTicks();

    const ps = G.bomber;
    if (ps && G.phase === 'bomber') {
      const left = Math.ceil(ps.dur - ps.clock);
      if (left !== G.lastTick && left <= 5 && left > 0) A.play('tick');
      G.lastTick = left;
    }
  }

  function updateOver(dt) {
    G.over.t += dt;
    if (BC.Screens && BC.Screens.updateOver) BC.Screens.updateOver(G, dt);
    tickBanner(dt);
    if (G.mode === 'net' && G.S) { advanceMirror(dt); sync(); }
    if (G.over.t > 1.2 && (I.menu().ok || I.mouse.clicked)) {
      A.play('menuSelect');
      if (G.mode === 'net') {
        // the host takes everyone back; anyone else can head to the lobby on their own
        if (N.lobby && N.lobby.host === N.token) N.send({ k: 'lobby' });
        else G.leaveGame();
      } else { G.screen = 'title'; A.music('title'); }
    }
  }

  function updateFx(dt) {
    G.shake = Math.max(0, G.shake - dt * 30);
    if (G.flash && (G.flash.t += dt) >= G.flash.dur) G.flash = null;
    G.particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; p.life -= dt; if (p.vr) p.rot += p.vr * dt; });
    G.particles = G.particles.filter(p => p.life > 0);
    G.fx.forEach(f => { f.t += dt; });
    G.fx = G.fx.filter(f => f.t < f.dur);
    G.popups.forEach(p => { p.t += dt; });
    G.popups = G.popups.filter(p => p.t < 1.3);
    if (BC.Gore && G.gore && (G.screen === 'play' || G.screen === 'over')) BC.Gore.update(G, dt);
  }

  function update(dt) {
    G.time += dt;
    if (I.hit('KeyM') && !(G.screen === 'lobby' && BC.Lobby.typing(G))) { A.init(); A.toggleMute(); }
    switch (G.screen) {
      case 'title': BC.Screens.updateTitle(G, dt); break;
      case 'setup': BC.Screens.updateSetup(G, dt); break;
      case 'help': BC.Screens.updateHelp(G, dt); break;
      case 'lobby': BC.Lobby.update(G, dt); break;
      case 'play': updatePlay(dt); break;
      case 'over': updateOver(dt); break;
    }
    updateFx(dt);
  }

  function render() {
    const S = BC.Screens;
    switch (G.screen) {
      case 'loading': S.drawLoading(G); break;
      case 'title': S.drawTitle(G); break;
      case 'setup': S.drawSetup(G); break;
      case 'help': S.drawHelp(G); break;
      case 'lobby': BC.Lobby.draw(G); break;
      case 'play':
        R.drawGame(G);
        S.drawPopups(G);
        if (G.paused) S.drawPause(G);
        break;
      case 'over':
        R.drawGame(G);
        S.drawPopups(G);
        S.drawOver(G);
        break;
    }
    R.overlay();
  }

  G.newGame = G.startLocal;
  G.update = update;

  // -------------------------------------------------------------------- boot
  function boot() {
    const canvas = document.getElementById('game');
    const fit = () => {
      const s = Math.min(window.innerWidth / BC.W, window.innerHeight / BC.H);
      canvas.style.width = Math.floor(BC.W * s) + 'px';
      canvas.style.height = Math.floor(BC.H * s) + 'px';
    };
    window.addEventListener('resize', fit);
    fit();
    I.init(canvas);
    R.init(canvas);
    const unlock = () => A.init();
    window.addEventListener('keydown', unlock);
    window.addEventListener('mousedown', unlock);
    window.addEventListener('touchstart', unlock);
    // a hidden tab stops rendering, so let go of any held direction on the server
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') releaseNetInputs();
    });

    let last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      I.pollPads();
      update(dt);
      render();
      I.endFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const fonts = document.fonts
      ? Promise.race([
        Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('16px "DotGothic16"', 'ボ')]),
        new Promise(r => setTimeout(r, 2500)),
      ])
      : Promise.resolve();
    Promise.all([fonts, BC.Assets.load()]).then(() => {
      G.screen = 'title';
      G.titleT = 0;
      if (/[?&]lan\b/.test(location.search) && N.available) G.startLan();
    });
  }

  window.addEventListener('load', boot);
})();
