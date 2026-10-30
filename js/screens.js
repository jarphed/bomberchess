(function () {
  'use strict';
  const BC = window.BC;
  const u = BC.u;
  const R = BC.Render, I = BC.Input, A = BC.Audio;
  const S = {};
  const W = BC.W, H = BC.H;

  const ctx = () => R.ctx;
  const blink = (t, rate) => Math.floor(t * (rate || 2)) % 2 === 0;

  // ----------------------------------------------------------------- shared
  S.drawLoading = function (G) {
    const c = ctx();
    c.fillStyle = '#000';
    c.fillRect(0, 0, W, H);
    R.text('NOW LOADING...', W / 2, H / 2 - 8, { size: 16, align: 'center', color: blink(G.time, 3) ? '#fff' : '#666' });
  };

  S.drawPopups = function (G) {
    G.popups.forEach(p => {
      R.text(p.text, p.x, p.y - p.t * 34, { size: p.size || 10, align: 'center', color: p.color, outline: p.size ? 5 : 4, alpha: Math.max(0, 1 - p.t / 1.3) });
    });
  };

  function logo(G, cx, y, scale) {
    const t = G.time;
    const word = (w, yy, size, fill, edge) => {
      let x = cx - R.measure(w, size) / 2;
      for (let i = 0; i < w.length; i++) {
        const ch = w[i];
        const dy = Math.sin(t * 4 + i * 0.6) * 4 * scale;
        R.text(ch, x + 6, yy + dy + 6, { size, color: '#000', shadow: false });
        R.text(ch, x, yy + dy, { size, color: edge, outline: Math.round(size / 5), outlineColor: '#140c1c' });
        R.text(ch, x, yy + dy - 2, { size, color: fill, shadow: false });
        x += R.measure(ch, size);
      }
    };
    word('BOMBER', y, Math.round(72 * scale), '#ffd23c', '#ff4a2c');
    word('CHESS', y + 92 * scale, Math.round(72 * scale), '#ffffff', '#3f8cff');
    R.text('ボンバーチェス', cx, y + 186 * scale, { size: Math.round(40 * scale), jp: true, align: 'center', color: '#7ef2ff', outline: 7, outlineColor: '#140c1c' });
  }

  // ------------------------------------------------------------------ title
  const TITLE_ITEMS = [
    { id: 'local', label: 'LOCAL GAME', jp: 'ひとつの画面' },
    { id: 'lan', label: 'LAN GAME', jp: 'ネットワーク' },
    { id: 'help', label: 'HOW TO PLAY', jp: 'あそびかた' },
  ];
  const TITLE_Y = 508, TITLE_H = 36;

  function titleSelect(G, id) {
    A.init();
    A.play('menuSelect');
    if (id === 'local') { G.screen = 'setup'; G.menuIdx = setupRows(G).findIndex(r => r.id === 'start'); }
    else if (id === 'lan') { if (BC.Net.available) G.startLan(); else G.lanHint = G.time; }
    else { G.helpBack = 'title'; G.helpPage = 0; G.screen = 'help'; }
  }

  S.updateTitle = function (G, dt) {
    G.titleT += dt;
    const m = I.menu();
    A.music('title');
    if (I.hit('KeyH')) { titleSelect(G, 'help'); return; }
    if (m.up) { G.titleIdx = (G.titleIdx + TITLE_ITEMS.length - 1) % TITLE_ITEMS.length; A.play('menuMove'); }
    if (m.down) { G.titleIdx = (G.titleIdx + 1) % TITLE_ITEMS.length; A.play('menuMove'); }
    const hit = TITLE_ITEMS.findIndex((it, i) => Math.abs(I.mouse.y - (TITLE_Y + i * TITLE_H + 10)) < 16 && Math.abs(I.mouse.x - W / 2) < 200);
    if (hit >= 0 && I.mouse.moved) G.titleIdx = hit;
    if (m.ok || (I.mouse.clicked && hit >= 0)) titleSelect(G, TITLE_ITEMS[G.titleIdx].id);
  };

  S.drawTitle = function (G) {
    const c = ctx();
    const t = G.time;
    R.backdrop(t, false);
    R.text('1UP  000000', 40, 20, { size: 12, color: '#ff5a5a' });
    R.text('HI-SCORE  050000', W / 2, 20, { size: 12, align: 'center', color: '#ffe14a' });
    R.text('2UP  000000', W - 40, 20, { size: 12, align: 'right', color: '#5ab0ff' });

    logo(G, W / 2, 70, 1);

    // decorative pieces either side
    const P = BC.Assets.pieces;
    if (P[0] && P[0].K) {
      c.drawImage(P[0].K, 150, 120, 126, 126);
      c.drawImage(P[1].Q, W - 276, 120, 126, 126);
    }

    // running parade
    const gy = 430;
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, gy + 48, W, 6);
    for (let i = 0; i < 5; i++) {
      const x = ((t * 150 + i * 90) % (W + 400)) - 200;
      const f = [4, 5, 6, 7][Math.floor(t * 10 + i) % 4];
      R.drawChar(i, f, x, gy, 48);
    }
    const bx = ((t * 150 - 140) % (W + 400)) - 200;
    if (BC.Assets.ok.sheet) {
      const fi = Math.floor(t * 6) % 6;
      c.drawImage(BC.Assets.img.sheet, (4 + fi) * 16, 18 * 16, 16, 16, bx, gy + 8, 40, 40);
    }

    TITLE_ITEMS.forEach((it, i) => {
      const y = TITLE_Y + i * TITLE_H;
      const sel = i === G.titleIdx;
      R.text(it.label, W / 2, y, { size: 20, align: 'center', color: sel ? (blink(t, 4) ? '#ffe14a' : '#fff') : '#8888aa', outline: sel ? 6 : 0 });
      if (sel) {
        R.text('>', W / 2 - 190, y, { size: 20, color: '#ffe14a' });
        R.text(it.jp, W / 2 + 190, y - 4, { size: 18, jp: true, color: '#7ef2ff' });
      }
    });
    if (G.lanHint !== undefined && G.time - G.lanHint < 5) {
      R.text('LAN NEEDS THE SERVER: RUN  node server.js  AND OPEN THE URL IT PRINTS', W / 2, 616, { size: 10, align: 'center', color: '#ff8a8a' });
    } else {
      R.text('ARROWS + ENTER / CLICK      H : HOW TO PLAY      M : SOUND', W / 2, 616, { size: 10, align: 'center', color: '#aab' });
    }
    R.text('© 2026 BOMBER CHESS     CREDIT 99', W / 2, 640, { size: 10, align: 'center', color: '#889' });
    R.text('SPRITES: "BOMB PARTY" BY MATT HACKETT, CEM KALYONCU & /USR/SHARE (CC-BY 3.0)', W / 2, 668, { size: 8, align: 'center', color: '#667', shadow: false });
    R.text('CHESS PIECES BY LUCAS312 (CC-BY 3.0)   FONTS: PRESS START 2P, DOTGOTHIC16 (OFL)', W / 2, 684, { size: 8, align: 'center', color: '#667', shadow: false });
  };

  // ------------------------------------------------------------------ setup
  function setupRows(G) {
    const s = G.settings;
    const rows = [{ id: 'n' }];
    for (let p = 0; p < s.n; p++) rows.push({ id: 'type', p });
    rows.push({ id: 'moves' }, { id: 'time' }, { id: 'turn' }, { id: 'brain' }, { id: 'power' }, { id: 'chain' }, { id: 'gates' });
    if (s.gates) rows.push({ id: 'gateRound' });
    rows.push({ id: 'revive' }, { id: 'blood' });
    rows.push({ id: 'start' }, { id: 'help' }, { id: 'back' });
    return rows;
  }

  function adjust(G, row, d) {
    const s = G.settings;
    switch (row.id) {
      case 'n': s.n = u.clamp(s.n + d, 2, 5); break;
      case 'type': s.types[row.p] = s.types[row.p] === 'HUMAN' ? 'CPU' : 'HUMAN'; break;
      case 'moves': s.moves = u.clamp(s.moves + d, 2, 30); break;
      case 'time': s.bomberTime = u.clamp(s.bomberTime + d * 5, 15, 120); break;
      case 'brain': s.brain = u.clamp(s.brain + d, 0, BC.BRAINS.length - 1); break;
      case 'power': s.powerLevel = u.clamp(s.powerLevel + d, 0, BC.POWER_LEVELS.length - 1); break;
      case 'turn': s.turnTime = BC.turnTimeOf(s.turnTime + d * BC.TURN_TIME.step); break;
      case 'chain': s.chain = !s.chain; break;
      case 'gates': s.gates = !s.gates; break;
      case 'gateRound': s.gateRound = BC.gateRoundOf(s.gateRound + d); break;
      case 'revive': s.revive = !s.revive; break;
      case 'blood': s.blood = !s.blood; break;
      default: return false;
    }
    A.play('menuMove');
    return true;
  }

  // the slider rows: the setting each one sets, and its step under the mouse (-1: off the track)
  const SLIDERS = { brain: 'brain', power: 'powerLevel' };
  const sliderAt = (id, mx) => (id === 'brain' ? R.brainLevelAt(ROW_X, ROW_W, mx) : id === 'power' ? R.powerLevelAt(ROW_X, ROW_W, mx) : -1);

  // what the gate round means, shown next to it (also in the LAN lobby)
  const gateHint = r => (r <= 1 ? 'OPEN FROM THE START' : 'AFTER ' + (r - 1) + ' CHESS ROUND' + (r > 2 ? 'S' : ''));
  S.gateHint = gateHint;

  function setLevel(G, id, lvl) {
    const key = SLIDERS[id];
    if (lvl < 0 || lvl === G.settings[key]) return;
    G.settings[key] = lvl;
    A.play('menuMove');
  }

  function activate(G, row) {
    if (row.id === 'start') { A.play('menuSelect'); G.newGame(); return; }
    if (row.id === 'help') { A.play('menuSelect'); G.helpBack = 'setup'; G.helpPage = 0; G.screen = 'help'; return; }
    if (row.id === 'back') { A.play('menuSelect'); G.screen = 'title'; return; }
    adjust(G, row, 1);
  }

  const ROW_X = 60, ROW_W = 600, ROW_Y0 = 112, ROW_H = 38, PANEL_H = 28;
  const VAL_X = ROW_X + ROW_W - 20, VAL_SIZE = 14;
  // rows move closer together when there are too many to fit
  const rowStep = n => Math.min(ROW_H, Math.floor((712 - ROW_Y0) / n));

  function valText(G, r) {
    const s = G.settings;
    switch (r.id) {
      case 'n': return String(s.n);
      case 'type': return s.types[r.p];
      case 'moves': return String(s.moves);
      case 'time': return s.bomberTime + 's';
      case 'turn': return s.turnTime + 's';
      case 'chain': return s.chain ? 'ON' : 'OFF';
      case 'gates': return s.gates ? 'ON' : 'OFF';
      case 'gateRound': return String(s.gateRound);
      case 'revive': return s.revive ? 'ON' : 'OFF';
      case 'blood': return s.blood ? 'ON' : 'OFF';
    }
    return null;
  }
  // a click left of the middle of "< value >" means "<", right of it means ">"
  function clickDir(G, r, mx) {
    const txt = valText(G, r);
    const mid = txt === null ? ROW_X + ROW_W / 2 : VAL_X - R.measure('< ' + txt + ' >', VAL_SIZE) / 2;
    return mx < mid ? -1 : 1;
  }

  S.updateSetup = function (G) {
    const rows = setupRows(G);
    G.menuIdx = u.clamp(G.menuIdx, 0, rows.length - 1);
    const m = I.menu();
    if (m.up) { G.menuIdx = (G.menuIdx - 1 + rows.length) % rows.length; A.play('menuMove'); }
    if (m.down) { G.menuIdx = (G.menuIdx + 1) % rows.length; A.play('menuMove'); }
    if (m.left) adjust(G, rows[G.menuIdx], -1);
    if (m.right) adjust(G, rows[G.menuIdx], 1);
    if (m.back) { A.play('menuSelect'); G.screen = 'title'; return; }
    if (m.ok) { activate(G, rows[G.menuIdx]); return; }
    const mx = I.mouse.x, my = I.mouse.y, step = rowStep(rows.length);
    const hit = rows.findIndex((r, i) => mx >= ROW_X && mx <= ROW_X + ROW_W && my >= ROW_Y0 + i * step && my < ROW_Y0 + i * step + Math.min(step, PANEL_H + 4));
    if (hit >= 0 && I.mouse.moved && hit !== G.menuIdx && !G.dragSlider) G.menuIdx = hit;
    // the sliders: click or drag along them
    if (!I.mouse.down) G.dragSlider = null;
    if (G.dragSlider) setLevel(G, G.dragSlider, sliderAt(G.dragSlider, u.clamp(mx, ROW_X, ROW_X + ROW_W)));
    if (hit >= 0 && I.mouse.clicked) {
      G.menuIdx = hit;
      const r = rows[hit];
      const lvl = sliderAt(r.id, mx);
      if (lvl >= 0) { G.dragSlider = r.id; setLevel(G, r.id, lvl); }
      else if (['n', 'moves', 'time', 'turn', 'brain', 'power', 'chain', 'gates', 'gateRound', 'revive', 'blood'].includes(r.id)) adjust(G, r, clickDir(G, r, mx));
      else activate(G, r);
    }
    const rows2 = setupRows(G);
    G.menuIdx = u.clamp(G.menuIdx, 0, rows2.length - 1);
  };

  function preview(G, n) {
    if (!G.previews[n]) G.previews[n] = BC.Board.create(n);
    return G.previews[n];
  }

  function drawPreview(G, x, y, w, h) {
    const c = ctx();
    const n = G.settings.n;
    const b = preview(G, n);
    const bb = b.bounds;
    const sc = Math.min(w / (bb.maxX - bb.minX), h / (bb.maxY - bb.minY)) * 0.92;
    const ox = x + w / 2 - (bb.minX + bb.maxX) / 2 * sc;
    const oy = y + h / 2 - (bb.minY + bb.maxY) / 2 * sc;
    const pieceAt = new Map(b.setup.map(s => [s.cell, s]));
    b.cells.forEach(cell => {
      c.beginPath();
      cell.poly.forEach((p, i) => (i ? c.lineTo(ox + p[0] * sc, oy + p[1] * sc) : c.moveTo(ox + p[0] * sc, oy + p[1] * sc)));
      c.closePath();
      c.fillStyle = cell.shade ? '#b8865c' : '#f0dcae';
      c.fill();
      const s = pieceAt.get(cell.id);
      if (s) { c.fillStyle = u.rgba(BC.PLAYER_COLORS[s.o], s.t === 'P' ? 0.55 : 0.95); c.fill(); }
      c.strokeStyle = 'rgba(40,20,10,0.6)';
      c.lineWidth = 1;
      c.stroke();
    });
    // the sheep gates, if they're on
    if (G.settings.gates) {
      BC.Board.gateSpots(b).forEach(g => {
        const x = ox + g.v[0] * sc, y = oy + g.v[1] * sc;
        g.leaves.forEach(l => {
          c.strokeStyle = '#2a1608';
          c.lineWidth = 6;
          c.beginPath(); c.moveTo(ox + l.h[0] * sc, oy + l.h[1] * sc); c.lineTo(x, y); c.stroke();
          c.strokeStyle = '#d49a52';
          c.lineWidth = 3;
          c.stroke();
        });
        if (BC.SpecialFx) BC.SpecialFx.drawSheep(G, x + g.out[0] * 22, y + g.out[1] * 22 + 4, { ground: y + g.out[1] * 22 + 4, lift: 2, eye: 'open', k: 2, bell: true, flip: g.out[0] < -0.1 });
      });
    }
  }

  S.drawSetup = function (G) {
    const t = G.time;
    R.backdrop(t, false);
    R.text('GAME SETUP', 60, 40, { size: 28, color: '#ffe14a', outline: 6 });
    R.text('ゲーム設定', 60 + R.measure('GAME SETUP ', 28), 34, { size: 30, jp: true, color: '#7ef2ff', outline: 6 });
    R.text('ARROWS/WASD + ENTER  OR  MOUSE', 60, 92, { size: 10, color: '#99a' });
    const rows = setupRows(G);
    const s = G.settings, step = rowStep(rows.length);
    rows.forEach((r, i) => {
      const y = ROW_Y0 + i * step;
      const sel = i === G.menuIdx;
      R.panel(ROW_X, y, ROW_W, PANEL_H, { bg: sel ? '#2c2470' : '#18143c', edge: sel ? '#ffe14a' : '#3a3480' });
      if (sel && blink(t, 3)) R.text('>', ROW_X - 30, y + 10, { size: 16, color: '#ffe14a' });
      const val = (txt, col) => {
        R.text('< ' + txt + ' >', VAL_X, y + 10, { size: VAL_SIZE, align: 'right', color: col || '#fff' });
      };
      switch (r.id) {
        case 'n':
          R.text('PLAYERS', ROW_X + 16, y + 11, { size: 14 });
          R.text(BC.BOARD_LABEL[s.n].name, ROW_X + 170, y + 13, { size: 10, color: '#9cf' });
          val(valText(G, r), '#ffe14a');
          break;
        case 'type': {
          R.text(BC.PLAYER_NAMES[r.p], ROW_X + 16, y + 11, { size: 14, color: BC.PLAYER_COLORS[r.p] });
          R.drawChar(r.p, 1, ROW_X + 64, y + 1, 28);
          const humans = s.types.slice(0, r.p).filter(x => x === 'HUMAN').length;
          if (s.types[r.p] === 'HUMAN') {
            const sc = I.SCHEMES[humans];
            R.text(sc ? sc.label : 'GAMEPAD ' + (humans + 1), ROW_X + 106, y + 14, { size: 8, color: '#aab' });
          }
          val(valText(G, r), s.types[r.p] === 'HUMAN' ? '#fff' : '#7fd8ff');
          break;
        }
        case 'moves':
          R.text('CHESS MOVES / ROUND', ROW_X + 16, y + 11, { size: 14 });
          val(valText(G, r));
          break;
        case 'time':
          R.text('BOMBER TIME', ROW_X + 16, y + 11, { size: 14 });
          val(valText(G, r));
          break;
        case 'turn':
          R.text('TURN TIME', ROW_X + 16, y + 11, { size: 14 });
          if (sel) R.text('MISS YOUR TURN = A SHEEP!', ROW_X + 170, y + 14, { size: 8, color: '#aab' });
          val(valText(G, r));
          break;
        case 'brain':
          R.brainSlider(ROW_X, y, ROW_W, PANEL_H, s.brain, { sel });
          break;
        case 'power':
          R.powerSlider(ROW_X, y, ROW_W, PANEL_H, s.powerLevel, { sel });
          break;
        case 'chain':
          R.text('CHAINED DEATHS', ROW_X + 16, y + 11, { size: 14 });
          if (sel) R.text('STRUCK PIECES STRIKE BACK', ROW_X + 230, y + 14, { size: 7, color: '#aab' });
          val(valText(G, r), s.chain ? '#ff9af0' : '#889');
          break;
        case 'gates':
          R.text('SHEEP GATES', ROW_X + 16, y + 11, { size: 14 });
          if (sel) R.text('SHEEP JUMP IN FROM CHESS ROUND ' + s.gateRound, ROW_X + 190, y + 14, { size: 7, color: '#aab' });
          val(valText(G, r), s.gates ? '#bff07a' : '#889');
          break;
        case 'gateRound':
          R.text('GATES OPEN IN ROUND', ROW_X + 16, y + 11, { size: 14 });
          if (sel) R.text(gateHint(s.gateRound), ROW_X + 300, y + 14, { size: 7, color: '#aab' });
          val(valText(G, r), '#bff07a');
          break;
        case 'revive':
          R.text('PLAYERS CAN REVIVE', ROW_X + 16, y + 11, { size: 14 });
          if (sel) R.text('OUT? WIN A BOMBER ROUND', ROW_X + 290, y + 14, { size: 7, color: '#aab' });
          val(valText(G, r), s.revive ? '#ffe14a' : '#889');
          break;
        case 'blood':
          R.text('BLOOD', ROW_X + 16, y + 11, { size: 14, color: s.blood ? '#ff5a5a' : '#fff' });
          if (sel) R.text('GORE FOR SHEEP AND BOMBERS', ROW_X + 120, y + 14, { size: 7, color: '#aab' });
          val(valText(G, r), s.blood ? '#ff3d3d' : '#889');
          break;
        case 'start':
          R.text('START GAME!', ROW_X + ROW_W / 2, y + 9, { size: 18, align: 'center', color: sel && blink(t, 4) ? '#ffe14a' : '#ff7a3c' });
          break;
        case 'help':
          R.text('HOW TO PLAY', ROW_X + ROW_W / 2, y + 11, { size: 14, align: 'center', color: '#ccd' });
          break;
        case 'back':
          R.text('BACK', ROW_X + ROW_W / 2, y + 11, { size: 14, align: 'center', color: '#99a' });
          break;
      }
    });

    // board preview
    const px = 720, py = 120, pw = 500, ph = 500;
    R.panel(px, py, pw, ph + 70, { bg: '#100c28', edge: '#4a3fa0' });
    R.text(s.n + ' PLAYERS', px + 20, py + 18, { size: 14, color: '#ffe14a' });
    R.text(BC.BOARD_LABEL[s.n].name + ' BOARD', px + pw - 20, py + 18, { size: 12, align: 'right', color: '#9cf' });
    drawPreview(G, px + 20, py + 50, pw - 40, ph - 40);
    R.text(BC.BOARD_LABEL[s.n].jp + ' ・ ' + s.n + 'つのベース', px + pw / 2, py + ph + 20, { size: 22, jp: true, align: 'center', color: '#fff' });
  };

  // ------------------------------------------------------------------- help
  // page 0: rules and power-ups, page 1: special captures
  S.updateHelp = function (G) {
    const m = I.menu();
    const page = G.helpPage || 0;
    const close = () => { A.play('menuSelect'); G.screen = G.helpBack || 'title'; };
    if (m.back || I.hit('KeyH')) { close(); return; }
    if (m.left && page > 0) { G.helpPage = 0; A.play('menuMove'); return; }
    if (m.right && page < 1) { G.helpPage = 1; A.play('menuMove'); return; }
    if (page === 0 && (m.ok || I.mouse.clicked)) { G.helpPage = 1; A.play('menuSelect'); return; }
    if (m.ok || I.mouse.clicked) close();
  };

  const SPECIAL_HELP = [
    ['R', 'ROOK', ['THE TOWER SPLITS AND FALLS ALONG ITS LINES, CRUSHING', 'EVERYTHING UP TO 2 STEPS AWAY. THE PIECE THAT TOOK IT IS SAFE.']],
    ['N', 'KNIGHT', ['IT WAKES UP, GETS EYES AND LEGS, AND GALLOPS AROUND IN', 'KNIGHT JUMPS UNTIL IT TRAMPLES A PIECE. IT LEAVES KINGS ALONE.']],
    ['B', 'BISHOP', ['ONE BOLT OF LIGHTNING COMES DOWN FROM THE HEAVENS', 'AND STRIKES A RANDOM PIECE - NEVER A KING.']],
    ['Q', 'QUEEN', ['A PLANE FLIES OVER AND DROPS A FEW BOMBS AT RANDOM.', 'WHATEVER STANDS WHERE A BOMB LANDS IS DESTROYED.']],
    ['K', 'KING', ['AN ATOMIC BOMB HITS A RANDOM SPOT AND WIPES OUT', 'EVERYTHING IN A 4x4 AREA. A CHECKMATE CALLS ONE IN TOO!']],
  ];

  function drawSpecialHelp(G) {
    R.text('SPECIAL CAPTURES', 40, 28, { size: 26, color: '#ffe14a', outline: 6 });
    R.text('とくしゅこうげき', 40 + R.measure('SPECIAL CAPTURES ', 26), 22, { size: 30, jp: true, color: '#7ef2ff', outline: 6 });
    R.panel(40, 80, 1200, 560, { bg: '#100c28', edge: '#4a3fa0' });
    R.text('TAKE ANY PIECE EXCEPT A PAWN AND IT GOES OUT WITH A BANG:', 64, 98, { size: 12, color: '#fff' });
    const P = BC.Assets.pieces;
    SPECIAL_HELP.forEach(([t, name, desc], i) => {
      const y = 128 + i * 86;
      const info = BC.Specials.INFO[t];
      const img = P[i] && P[i][t];
      if (img) R.ctx.drawImage(img, 64, y + 4, 64, 64);
      R.text(name, 150, y + 16, { size: 16, color: '#fff' });
      R.text(info.hint, 150, y + 42, { size: 12, color: info.col });
      desc.forEach((line, j) => R.text(line, 400, y + 18 + j * 22, { size: 10, color: '#ccd' }));
    });
    R.text('STRIKES HIT ANYONE\'S PIECES AND SHEEP, YOUR OWN TOO - BUT NEVER A KING. KINGS PUT A HELMET ON!', 64, 552, { size: 10, color: '#ff8a8a' });
    R.text('STRUCK PIECES ONLY SET OFF THEIR OWN STRIKE WITH CHAINED DEATHS ON. AIM AT A PIECE TO SEE ITS STRIKE.', 64, 570, { size: 10, color: '#fc9' });
    R.text('MISS A TURN AND A SHEEP APPEARS. STEP ON IT OR HIT IT WITH ANY STRIKE AND IT STAMPEDES LIKE THE KNIGHT!', 64, 588, { size: 10, color: '#fff' });
    R.text('A CHAIN OF SHEEP ENDS WITH A BANG: HALF AS MANY SQUARES AS THERE WERE SHEEP BLOW UP AROUND THE LAST ONE.', 64, 606, { size: 10, color: '#ffb040' });
    R.text('SHEEP GATES ON? FROM THE CHESS ROUND YOU PICK, SHEEP JUMP IN AT THE CORNERS AND WANDER EVERY TURN.', 64, 624, { size: 10, color: '#bff07a' });
    R.text('< PAGE 1     ENTER / ESC / CLICK : BACK', W / 2, 668, { size: 12, align: 'center', color: blink(G.time, 2) ? '#fff' : '#99a' });
  }

  S.drawHelp = function (G) {
    R.backdrop(G.time, false);
    if (G.helpPage === 1) { drawSpecialHelp(G); return; }
    R.text('HOW TO PLAY', 40, 28, { size: 26, color: '#ffe14a', outline: 6 });
    R.text('あそびかた', 40 + R.measure('HOW TO PLAY ', 26), 22, { size: 30, jp: true, color: '#7ef2ff', outline: 6 });

    R.panel(40, 80, 640, 560, { bg: '#100c28', edge: '#4a3fa0' });
    const lines = [
      ['CHESS AND BOMBERMAN ON THE SAME BOARD!', '#ffe14a'],
      ['1. CHESS: 10 MOVES IN TOTAL (TAKING TURNS).', '#fff'],
      ['   CLICK ANY PIECE TO SEE HOW IT CAN MOVE.', '#aab'],
      ['   STEP ON OR SLIDE OVER POWER-UPS TO GRAB THEM.', '#aab'],
      ['   TOO SLOW? YOU LOSE THE TURN AND A SHEEP APPEARS', '#fc9'],
      ['2. BOMBER TIME: THE PIECES BECOME WALLS.', '#fff'],
      ['   BLASTS CAN\'T BREAK CHESS PIECES.', '#aab'],
      ['   GET HIT = OUT FOR THE ROUND + LOSE A PAWN', '#fc9'],
      ['   (NO PAWNS LEFT? ANOTHER PIECE GOES - WITH A BANG)', '#fc9'],
      ['   BLAST SOMEONE = ONE OF YOUR PAWNS REVIVES', '#fc9'],
      ['   BLASTS TRAVEL ALONG ROOK LINES.', '#aab'],
      ['   FROM ROUND 3 THE WALLS CLOSE IN - FOR GOOD!', '#fc9'],
      ['3. BACK TO CHESS ... AND AGAIN ... AND AGAIN', '#fff'],
      ['YOU ARE OUT WHEN YOU ARE CHECKMATED, YOUR', '#ff8a8a'],
      ['KING IS CAPTURED, OR YOU GET HIT WITH ONLY', '#ff8a8a'],
      ['YOUR KING LEFT. LAST PLAYER STANDING WINS.', '#ff8a8a'],
      ['KNOCKED OUT? YOU STILL BOMB IN BOMBER TIME!', '#ccd'],
      ['(PLAYERS CAN REVIVE ON? WIN IT TO COME BACK)', '#ccd'],
      ['BOARDS: 2P SQUARES  3P TRIANGLES', '#9cf'],
      ['        4P SQUARE CROSS  5P PENTAGONS', '#9cf'],
      ['', ''],
      ['BOMBER KEYS (HUMANS IN ORDER):', '#fff'],
    ];
    lines.forEach((l, i) => R.text(l[0], 60, 100 + i * 20, { size: 10, color: l[1] }));
    I.SCHEMES.forEach((s, i) => R.text((i + 1) + ': ' + s.label, 76, 100 + (lines.length + i) * 20, { size: 9, color: '#ccd' }));

    R.panel(700, 80, 540, 560, { bg: '#100c28', edge: '#4a3fa0' });
    R.text('POWER-UPS', 720, 98, { size: 16, color: '#ffe14a' });
    R.text('パワーアップ', 1220, 94, { size: 20, jp: true, align: 'right', color: '#7ef2ff' });
    BC.POWERUPS.forEach((pu, i) => {
      const y = 132 + i * 50;
      const img = BC.Assets.icons[pu.id];
      if (img) R.ctx.drawImage(img, 720, y, 40, 40);
      R.text(pu.name, 776, y + 2, { size: 12, color: '#fff' });
      R.text(pu.jp, 1220, y - 2, { size: 16, jp: true, align: 'right', color: '#9cf' });
      R.text(pu.desc.toUpperCase(), 776, y + 22, { size: 8, color: '#aab' });
    });
    R.text('BOMB/FIRE/SPEED ARE KEPT FOR THE WHOLE GAME,', 720, 584, { size: 8, color: '#fc9' });
    R.text('KICKS UNTIL THEY\'RE USED. SPECIALS LAST FOR', 720, 598, { size: 8, color: '#fc9' });
    R.text('THE NEXT BOMBER ROUND ONLY.', 720, 612, { size: 8, color: '#fc9' });

    R.text('ENTER / CLICK : SPECIAL CAPTURES >     ESC : BACK', W / 2, 668, { size: 12, align: 'center', color: blink(G.time, 2) ? '#fff' : '#99a' });
  };

  // ------------------------------------------------------------ pause / over
  S.pauseItemRect = i => ({ x: W / 2 - 230, y: 280 + i * 60, w: 460, h: 48 });

  S.drawPause = function (G) {
    const c = ctx();
    const net = G.mode === 'net';
    c.fillStyle = 'rgba(0,0,10,0.75)';
    c.fillRect(0, 0, W, H);
    R.text(net ? 'MENU' : 'PAUSE', W / 2, 140, { size: 48, align: 'center', color: '#ffe14a', outline: 8 });
    R.text(net ? 'メニュー' : 'ポーズ', W / 2, 202, { size: 30, jp: true, align: 'center', color: '#7ef2ff', outline: 6 });
    G.menuItems().forEach((it, i) => {
      const r = S.pauseItemRect(i);
      const sel = i === G.pauseIdx;
      R.panel(r.x, r.y, r.w, r.h, { bg: sel ? '#2c2470' : '#18143c', edge: sel ? '#ffe14a' : '#3a3480' });
      if (sel && blink(G.time, 3)) R.text('>', r.x - 30, r.y + 16, { size: 16, color: '#ffe14a' });
      R.text(it.label, W / 2, r.y + (it.sub ? 8 : 16), { size: 16, align: 'center', color: sel ? '#ffe14a' : '#fff' });
      if (it.sub) R.text(it.sub, W / 2, r.y + 31, { size: 8, align: 'center', color: '#aab' });
    });
    if (net) R.text('THE GAME KEEPS RUNNING WHILE THIS MENU IS OPEN', W / 2, 560, { size: 10, align: 'center', color: '#fd8' });
    R.text('ARROWS + ENTER  OR  CLICK      ESC: BACK TO GAME', W / 2, 590, { size: 10, align: 'center', color: '#99a' });
  };

  S.drawOver = function (G) {
    const c = ctx();
    const o = G.over;
    const k = Math.min(1, o.t / 0.6);
    c.fillStyle = `rgba(0,0,10,${0.65 * k})`;
    c.fillRect(0, 0, W, H);
    if (o.t < 0.4) return;
    const cx = W / 2;
    const win = o.winner;
    R.panel(cx - 330, 110, 660, 480, { bg: '#140f34', edge: win >= 0 ? BC.PLAYER_COLORS[win] : '#888' });
    if (win >= 0) {
      R.text('WINNER!', cx, 136, { size: 44, align: 'center', color: '#ffe14a', outline: 8 });
      R.text('しょうり!', cx, 192, { size: 30, jp: true, align: 'center', color: '#fff', outline: 6 });
      const f = [1, 2, 1, 3][Math.floor(G.time * 6) % 4];
      R.drawChar(win, f, cx - 48, 238, 96);
      if (BC.Assets.glyphs.crown) c.drawImage(BC.Assets.glyphs.crown, cx - 24, 206, 48, 48);
      R.text(BC.PLAYER_NAMES[win], cx, 346, { size: 28, align: 'center', color: BC.PLAYER_COLORS[win], outline: 6 });
    } else {
      R.text('DRAW', cx, 150, { size: 48, align: 'center', color: '#ccc', outline: 8 });
      R.text('ひきわけ', cx, 220, { size: 30, jp: true, align: 'center', color: '#fff', outline: 6 });
    }
    R.text(o.reason, cx, 388, { size: 12, align: 'center', color: '#9cf' });
    const order = G.players.slice().sort((a, b) => (a.place || 9) - (b.place || 9));
    order.forEach((pl, i) => {
      const y = 418 + i * 26;
      R.text((pl.place || '-') + '.', cx - 200, y, { size: 12, color: '#fff' });
      R.text(BC.PLAYER_NAMES[pl.p], cx - 150, y, { size: 12, color: BC.PLAYER_COLORS[pl.p] });
      R.text(pl.type, cx - 90, y, { size: 10, color: '#99a' });
      R.text(pl.alive ? 'SURVIVOR' : pl.outReason, cx + 200, y, { size: 10, align: 'right', color: pl.alive ? '#ffe14a' : '#f88' });
    });
    if (o.t > 1.2) {
      const host = G.mode !== 'net' || (BC.Net.lobby && BC.Net.lobby.host === BC.Net.token);
      const txt = G.mode !== 'net' ? 'PUSH ENTER' : host ? 'PUSH ENTER: EVERYONE BACK TO LOBBY' : 'PUSH ENTER: BACK TO LOBBY';
      if (blink(G.time, 2)) R.text(txt, cx, 556, { size: 14, align: 'center', color: '#fff' });
    }
  };

  BC.Screens = S;
})();
