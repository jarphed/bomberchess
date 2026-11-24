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
    { id: 'music', label: () => 'MUSIC: ' + (A.isMusicMuted() ? 'OFF' : 'ON'), jp: () => (A.isMusicMuted() ? 'おんがく OFF' : 'おんがく ON') },
  ];
  const TITLE_Y = 492, TITLE_H = 31;

  function titleSelect(G, id) {
    A.init();
    if (id === 'music') { A.toggleMusic(); A.play('menuMove'); return; }
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
    if ((m.left || m.right) && TITLE_ITEMS[G.titleIdx].id === 'music') { titleSelect(G, 'music'); return; }
    const hit = TITLE_ITEMS.findIndex((it, i) => Math.abs(I.mouse.y - (TITLE_Y + i * TITLE_H + 9)) < 15 && Math.abs(I.mouse.x - W / 2) < 200);
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
    R.text('CHESS  >  BOMBER  >  CHESS  >  SPINES', W / 2, 348, { size: 12, align: 'center', color: '#bff07a' });

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
      const lbl = typeof it.label === 'function' ? it.label() : it.label;
      const jp = typeof it.jp === 'function' ? it.jp() : it.jp;
      R.text(lbl, W / 2, y, { size: 18, align: 'center', color: sel ? (blink(t, 4) ? '#ffe14a' : '#fff') : '#8888aa', outline: sel ? 6 : 0 });
      if (sel) {
        R.text('>', W / 2 - 190, y, { size: 18, color: '#ffe14a' });
        R.text(jp, W / 2 + 190, y - 4, { size: 17, jp: true, color: '#7ef2ff' });
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
    const s = G.settings, m = BC.modeSettings(s);
    const rows = [{ id: 'n' }, { id: 'modes' }];
    for (let p = 0; p < s.n; p++) rows.push({ id: 'type', p });
    if (m.playChess && (m.playBomber || m.playWorms)) rows.push({ id: 'moves' });
    if (m.playBomber) rows.push({ id: 'time' });
    if (m.playWorms) rows.push({ id: 'wormsTime' });
    if (m.playChess) rows.push({ id: 'turn' });
    rows.push({ id: 'brain' });
    if (m.playBomber) rows.push({ id: 'power' });
    if (m.playChess) {
      rows.push({ id: 'chain' }, { id: 'gates' });
      if (s.gates) rows.push({ id: 'gateRound' });
      if (m.playBomber || m.playWorms) rows.push({ id: 'revive' });
    }
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
      case 'wormsTime': s.wormsTime = BC.wormsTimeOf(s.wormsTime + d * BC.WORMS_TIME.step); break;
      case 'brain': s.brain = u.clamp(s.brain + d, 0, BC.BRAINS.length - 1); break;
      case 'power': s.powerLevel = u.clamp(s.powerLevel + d, 0, BC.POWER_LEVELS.length - 1); break;
      case 'turn': s.turnTime = BC.turnTimeOf(s.turnTime + d * BC.TURN_TIME.step); break;
      case 'chain': s.chain = !s.chain; break;
      case 'gates': s.gates = !s.gates; break;
      case 'gateRound': s.gateRound = BC.gateRoundOf(s.gateRound + d); break;
      case 'revive': s.revive = !s.revive; break;
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
    if (row.id === 'modes') { S.openModes(G); return; }
    if (row.id === 'start') { A.play('menuSelect'); G.newGame(); return; }
    if (row.id === 'help') { A.play('menuSelect'); G.helpBack = 'setup'; G.helpPage = 0; G.screen = 'help'; return; }
    if (row.id === 'back') { A.play('menuSelect'); G.screen = 'title'; return; }
    adjust(G, row, 1);
  }

  const ROW_X = 60, ROW_W = 600, ROW_Y0 = 112, ROW_H = 38, PANEL_H = 28;
  const VAL_X = ROW_X + ROW_W - 20, VAL_SIZE = 14;
  // rows move closer together when there are too many to fit
  const rowStep = n => Math.min(ROW_H, Math.floor((712 - ROW_Y0) / n));

  const modeKeys = ['playChess', 'playBomber', 'playWorms'];
  const modeLabels = ['CHESS', 'BOMBERMAN', 'SPINES', 'DONE'];
  S.openModes = G => { G.modePicker = { idx: 0 }; G.dragSlider = null; A.play('menuSelect'); };
  S.drawModeRow = (cfg, x, y, w, enabled) => {
    const m = BC.modeSettings(cfg);
    R.text('GAME MODES', x + 16, y + 10, { size: 13 });
    const label = [m.playChess && 'CHESS', m.playBomber && 'BOMBERMAN', m.playWorms && 'SPINES'].filter(Boolean).join(' + ');
    R.text(label + (enabled ? '  v' : ''), x + w - 18, y + 11, { size: 11, align: 'right', color: enabled ? '#7fd8ff' : '#aab' });
  };
  const optionHeight = 32;
  S.drawModes = (G, cfg, x, y, w) => {
    if (!G.modePicker) return;
    const m = BC.modeSettings(cfg);
    R.panel(x, y, w, 5 * optionHeight + 4, { bg: '#100c28', edge: '#7fd8ff' });
    R.text('SELECT AT LEAST ONE MODE', x + 14, y + 12, { size: 10, color: '#99a' });
    modeLabels.forEach((label, i) => {
      const sel = G.modePicker.idx === i, yy = y + (i + 1) * optionHeight;
      if (sel) R.panel(x + 4, yy, w - 8, optionHeight - 2, { bg: '#2c2470', edge: '#ffe14a' });
      const check = i < 3 ? (m[modeKeys[i]] ? '[X] ' : '[ ] ') : '';
      R.text(check + label, x + 15, yy + 10, { size: 12, color: sel ? '#ffe14a' : '#fff' });
    });
  };
  S.updateModes = (G, x, y, w, toggle) => {
    const p = G.modePicker, m = I.menu(), mouse = I.mouse;
    const n = modeLabels.length;
    const hit = mouse.x >= x && mouse.x < x + w ? Math.floor((mouse.y - y) / optionHeight) - 1 : -2;
    if (mouse.moved && hit >= 0 && hit < n) p.idx = hit;
    if (m.up || m.down) p.idx = (p.idx + (m.up ? n - 1 : 1)) % n;
    if (m.back || (mouse.clicked && (hit < 0 || hit >= n))) { G.modePicker = null; return; }
    if (m.ok || mouse.clicked) {
      const i = mouse.clicked ? hit : p.idx;
      if (i === n - 1) { G.modePicker = null; A.play('menuSelect'); }
      else {
        p.idx = i;
        if (toggle(modeKeys[i]) !== false) A.play('menuSelect');
      }
    }
  };

  function valText(G, r) {
    const s = G.settings;
    switch (r.id) {
      case 'n': return String(s.n);
      case 'type': return s.types[r.p];
      case 'moves': return String(s.moves);
      case 'time': return s.bomberTime + 's';
      case 'wormsTime': return BC.wormsTimeOf(s.wormsTime) + 's';
      case 'turn': return s.turnTime + 's';
      case 'chain': return s.chain ? 'ON' : 'OFF';
      case 'gates': return s.gates ? 'ON' : 'OFF';
      case 'gateRound': return String(s.gateRound);
      case 'revive': return s.revive ? 'ON' : 'OFF';
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
    if (G.modePicker) {
      S.updateModes(G, ROW_X, ROW_Y0 + rowStep(rows.length) + PANEL_H, ROW_W, key => {
        const s = G.settings, cur = BC.modeSettings(s);
        if (cur[key] && (cur.playChess + cur.playBomber + cur.playWorms <= 1)) return false;
        s[key] = !cur[key];
      });
      return;
    }
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
      else if (['n', 'moves', 'time', 'wormsTime', 'turn', 'brain', 'power', 'chain', 'gates', 'gateRound', 'revive'].includes(r.id)) adjust(G, r, clickDir(G, r, mx));
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
    const s = G.settings, n = s.n;
    if (BC.isWormsOnly(s)) {
      if (!G.wormPreview) G.wormPreview = BC.Worms.makeTerrain(7719);
      const sx = w / 960, sy = h / 520;
      c.save();
      c.beginPath(); c.rect(x, y, w, h); c.clip();
      const skyCols = ['#2a5d9e', '#4d8ec8', '#88bfe0', '#cde7eb'];
      skyCols.forEach((col, i) => { c.fillStyle = col; c.fillRect(x, y + i * h / 4, w, h / 4 + 2); });
      G.wormPreview.forEach(t => {
        if (t.kind === 'land' && t.poly) {
          c.beginPath();
          t.poly.forEach((p, i) => (i ? c.lineTo(x + p[0] * sx, y + p[1] * sy) : c.moveTo(x + p[0] * sx, y + p[1] * sy)));
          c.closePath();
          c.fillStyle = '#6b4226'; c.fill();
          c.strokeStyle = '#261710'; c.lineWidth = 2; c.stroke();
          if (t.cap) {
            c.beginPath();
            t.cap.forEach((p, i) => (i ? c.lineTo(x + p[0] * sx, y + p[1] * sy) : c.moveTo(x + p[0] * sx, y + p[1] * sy)));
            c.strokeStyle = '#55c943'; c.lineWidth = 5; c.stroke();
          }
        } else {
          c.fillStyle = '#58687a';
          c.fillRect(x + t.x * sx, y + t.y * sy, t.w * sx, Math.max(4, t.h * sy));
        }
      });
      c.fillStyle = '#1c5a8a';
      c.fillRect(x, y + 504 * sy, w, h - 504 * sy);
      c.restore();
      return;
    }
    const b = preview(G, n);
    const bb = b.bounds;
    const sc = Math.min(w / (bb.maxX - bb.minX), h / (bb.maxY - bb.minY)) * 0.92;
    const ox = x + w / 2 - (bb.minX + bb.maxX) / 2 * sc;
    const oy = y + h / 2 - (bb.minY + bb.maxY) / 2 * sc;
    if (BC.isBomberOnly(s)) {
      if (!b.bomberOcc) {
        b.bomberOcc = new Array(b.cells.length).fill(null);
        BC.Bomber.setupArena(b, b.bomberOcc);
      }
      b.cells.forEach(cell => {
        c.beginPath();
        cell.poly.forEach((p, i) => (i ? c.lineTo(ox + p[0] * sc, oy + p[1] * sc) : c.moveTo(ox + p[0] * sc, oy + p[1] * sc)));
        c.closePath();
        c.fillStyle = b.bomberOcc[cell.id] ? '#7d8290' : (cell.shade ? '#38873c' : '#469e4a');
        c.fill();
        c.strokeStyle = 'rgba(15,30,15,0.6)';
        c.lineWidth = 1;
        c.stroke();
      });
      return;
    }
    const pieceAt = new Map(b.setup.map(st => [st.cell, st]));
    b.cells.forEach(cell => {
      c.beginPath();
      cell.poly.forEach((p, i) => (i ? c.lineTo(ox + p[0] * sc, oy + p[1] * sc) : c.moveTo(ox + p[0] * sc, oy + p[1] * sc)));
      c.closePath();
      c.fillStyle = cell.shade ? '#b8865c' : '#f0dcae';
      c.fill();
      const st = pieceAt.get(cell.id);
      if (st) { c.fillStyle = u.rgba(BC.PLAYER_COLORS[st.o], st.t === 'P' ? 0.55 : 0.95); c.fill(); }
      c.strokeStyle = 'rgba(40,20,10,0.6)';
      c.lineWidth = 1;
      c.stroke();
    });
    // the sheep gates, if they're on
    if (s.gates && s.playChess !== false) {
      BC.Board.gateSpots(b).forEach(g => {
        const gx = ox + g.v[0] * sc, gy = oy + g.v[1] * sc;
        g.leaves.forEach(l => {
          c.strokeStyle = '#2a1608';
          c.lineWidth = 6;
          c.beginPath(); c.moveTo(ox + l.h[0] * sc, oy + l.h[1] * sc); c.lineTo(gx, gy); c.stroke();
          c.strokeStyle = '#d49a52';
          c.lineWidth = 3;
          c.stroke();
        });
        if (BC.SpecialFx) BC.SpecialFx.drawSheep(G, gx + g.out[0] * 22, gy + g.out[1] * 22 + 4, { ground: gy + g.out[1] * 22 + 4, lift: 2, eye: 'open', k: 2, bell: true, flip: g.out[0] < -0.1 });
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
        case 'modes': S.drawModeRow(s, ROW_X, y, ROW_W, true); break;
        case 'n':
          R.text('PLAYERS', ROW_X + 16, y + 11, { size: 14 });
          if (!BC.isWormsOnly(s)) R.text(BC.BOARD_LABEL[s.n].name, ROW_X + 170, y + 13, { size: 10, color: '#9cf' });
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
          R.text(BC.isBomberOnly(s) ? 'WALLS CLOSE AFTER' : 'BOMBER TIME', ROW_X + 16, y + 11, { size: 14 });
          val(valText(G, r));
          break;
        case 'wormsTime':
          R.text('SPINES TURN TIME', ROW_X + 16, y + 11, { size: 14 });
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
          if (sel) R.text('OUT? BE THE SOLE SURVIVOR', ROW_X + 290, y + 14, { size: 7, color: '#aab' });
          val(valText(G, r), s.revive ? '#ffe14a' : '#889');
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

    S.drawModes(G, s, ROW_X, ROW_Y0 + step + PANEL_H, ROW_W);
    // board preview
    const px = 720, py = 120, pw = 500, ph = 500;
    const wormsOnly = BC.isWormsOnly(s), bomberOnly = BC.isBomberOnly(s);
    R.panel(px, py, pw, ph + 70, { bg: '#100c28', edge: '#4a3fa0' });
    R.text(s.n + ' PLAYERS', px + 20, py + 18, { size: 14, color: '#ffe14a' });
    R.text(wormsOnly ? 'RANDOM SPINES MAP' : bomberOnly ? BC.BOARD_LABEL[s.n].name + ' ARENA' : BC.BOARD_LABEL[s.n].name + ' BOARD',
      px + pw - 20, py + 18, { size: 12, align: 'right', color: '#9cf' });
    drawPreview(G, px + 20, py + 50, pw - 40, ph - 40);
    R.text(wormsOnly ? 'スパインズ ・ ランダムマップ' : bomberOnly ? 'ボンバーマン ・ バトルロイヤル' : BC.BOARD_LABEL[s.n].jp + ' ・ ' + s.n + 'つのベース',
      px + pw / 2, py + ph + 20, { size: 22, jp: true, align: 'center', color: '#fff' });
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
    ['N', 'KNIGHT', ['IT WAKES UP, GETS EYES AND LEGS, AND GALLOPS AROUND IN', 'KNIGHT JUMPS UNTIL IT TRAMPLES A PIECE OR SHEEP.']],
    ['B', 'BISHOP', ['ONE BOLT OF LIGHTNING COMES DOWN FROM THE HEAVENS', 'AND STRIKES A RANDOM PIECE OR SHEEP ON THE BOARD.']],
    ['Q', 'QUEEN', ['A PLANE FLIES OVER AND DROPS A FEW BOMBS AT RANDOM.', 'WHATEVER STANDS WHERE A BOMB LANDS IS HIT.']],
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
    R.text('STRIKES HIT ANYONE\'S PIECES, SHEEP AND KINGS! KINGS PUT ON A HELMET THAT TAKES 10 HITS BEFORE BREAKING.', 64, 552, { size: 9, color: '#ff8a8a' });
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
      ['CHESS > BOMBER > CHESS > SPINES > REPEAT', '#ffe14a'],
      ['1. CHESS: TAKE TURNS MOVING YOUR PIECES.', '#fff'],
      ['   CLICK ANY PIECE TO SEE HOW IT CAN MOVE.', '#aab'],
      ['   STEP ON OR SLIDE OVER POWER-UPS TO GRAB THEM.', '#aab'],
      ['   TOO SLOW? YOU LOSE THE TURN AND A SHEEP APPEARS', '#fc9'],
      ['2. BOMBER TIME: THE PIECES BECOME WALLS.', '#fff'],
      ['   BLASTS CAN\'T BREAK CHESS PIECES.', '#aab'],
      ['   GET HIT = OUT FOR THE ROUND + LOSE A PAWN', '#fc9'],
      ['   (NO PAWNS LEFT? ANOTHER PIECE GOES - WITH A BANG)', '#fc9'],
      ['   BLAST SOMEONE = ONE OF YOUR PAWNS REVIVES', '#fc9'],
      ['   FROM ROUND 3 THE WALLS CLOSE IN - FOR GOOD!', '#fc9'],
      ['3. AFTER THE NEXT CHESS ROUND: SPINES!', '#bff07a'],
      ['   EACH CHESS PIECE TYPE UNLOCKS ITS OWN WEAPON!', '#aab'],
      ['   WALK: A/D   AIM: W/S   SPACE: JUMP   Q/WHEEL: WPN', '#aab'],
      ['   HOLD LEFT CLICK TO FIRE - THEN FLEE!', '#fc9'],
      ['YOU ARE OUT WHEN YOU ARE CHECKMATED, YOUR', '#ff8a8a'],
      ['KING IS CAPTURED, OR YOU GET HIT WITH ONLY', '#ff8a8a'],
      ['YOUR KING LEFT. LAST PLAYER STANDING WINS.', '#ff8a8a'],
      ['OUT OF CHESS? YOU STILL PLAY BOTH BATTLES.', '#ccd'],
      ['(REVIVE ON? BE THE SOLE SURVIVOR TO COME BACK)', '#ccd'],
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
  S.pauseItemRect = (i, count) => {
    const step = count >= 5 ? 54 : 60;
    const y0 = count >= 5 ? 248 : 268;
    return { x: W / 2 - 230, y: y0 + i * step, w: 460, h: 46 };
  };

  S.drawPause = function (G) {
    const c = ctx();
    const net = G.mode === 'net';
    c.fillStyle = 'rgba(0,0,10,0.75)';
    c.fillRect(0, 0, W, H);
    R.text(net ? 'MENU' : 'PAUSE', W / 2, 132, { size: 48, align: 'center', color: '#ffe14a', outline: 8 });
    R.text(net ? 'メニュー' : 'ポーズ', W / 2, 194, { size: 30, jp: true, align: 'center', color: '#7ef2ff', outline: 6 });
    const items = G.menuItems();
    items.forEach((it, i) => {
      const r = S.pauseItemRect(i, items.length);
      const sel = i === G.pauseIdx;
      R.panel(r.x, r.y, r.w, r.h, { bg: sel ? '#2c2470' : '#18143c', edge: sel ? '#ffe14a' : '#3a3480' });
      if (sel && blink(G.time, 3)) R.text('>', r.x - 30, r.y + 16, { size: 16, color: '#ffe14a' });
      R.text(it.label, W / 2, r.y + (it.sub ? 8 : 16), { size: 16, align: 'center', color: sel ? '#ffe14a' : '#fff' });
      if (it.sub) R.text(it.sub, W / 2, r.y + 31, { size: 8, align: 'center', color: '#aab' });
    });
    if (net) R.text('THE GAME KEEPS RUNNING WHILE THIS MENU IS OPEN', W / 2, 560, { size: 10, align: 'center', color: '#fd8' });
    R.text('ARROWS + ENTER  OR  CLICK      ESC: BACK TO GAME', W / 2, 590, { size: 10, align: 'center', color: '#99a' });
  };

  // ------------------------------------------------------------ over effects
  const CONFETTI_COLORS = ['#ffe14a', '#ff4a6e', '#3fd8ff', '#62f060', '#ff9f1c', '#d07aff', '#ffffff'];

  function spawnConfetti(list, x, y, vx, vy, front, winColor) {
    const colors = winColor ? CONFETTI_COLORS.concat([winColor, winColor]) : CONFETTI_COLORS;
    list.push({
      x, y, vx, vy,
      rot: u.rand(0, Math.PI * 2),
      vr: u.rand(-8, 8),
      tilt: u.rand(0, Math.PI * 2),
      vtilt: u.rand(6, 13),
      w: u.randInt(7, 13),
      h: u.randInt(4, 8),
      color: u.pick(colors),
      sway: u.rand(0, Math.PI * 2),
      swaySpd: u.rand(2.2, 4.5),
      front,
    });
  }

  S.initOver = function (G) {
    const o = G.over;
    if (!o) return;
    if (o.won) {
      const winCol = BC.PLAYER_COLORS[o.winner];
      o.confetti = [];
      // two big side cannons bursting inward + initial canopy of festive confetti
      for (let i = 0; i < 65; i++) {
        const left = i % 2 === 0;
        const x = left ? u.rand(20, 140) : u.rand(W - 140, W - 20);
        const y = u.rand(H * 0.35, H * 0.78);
        const vx = (left ? 1 : -1) * u.rand(180, 480);
        const vy = u.rand(-560, -240);
        spawnConfetti(o.confetti, x, y, vx, vy, i % 3 === 0, winCol);
      }
      for (let i = 0; i < 60; i++) {
        spawnConfetti(o.confetti, u.rand(0, W), u.rand(-H * 0.6, H * 0.35), u.rand(-45, 45), u.rand(40, 130), i % 3 === 0, winCol);
      }
      o.confettiTimer = 0;
    } else if (o.lost) {
      o.rain = [];
      for (let i = 0; i < 70; i++) {
        o.rain.push({
          x: u.rand(0, W), y: u.rand(0, H),
          len: u.rand(12, 24), spd: u.rand(260, 420),
          alpha: u.rand(0.12, 0.32),
        });
      }
      o.tears = [];
      o.ripples = [];
      o.tearTimer = 0;
    }
  };

  S.updateOver = function (G, dt) {
    const o = G.over;
    if (!o) return;
    if (o.won && o.confetti) {
      const winCol = BC.PLAYER_COLORS[o.winner];
      o.confettiTimer = (o.confettiTimer || 0) + dt;
      while (o.confettiTimer >= 0.045) {
        o.confettiTimer -= 0.045;
        if (o.confetti.length < 180) {
          spawnConfetti(o.confetti, u.rand(0, W), -16, u.rand(-40, 40), u.rand(65, 145), Math.random() < 0.35, winCol);
        }
      }
      for (let i = o.confetti.length - 1; i >= 0; i--) {
        const p = o.confetti[i];
        p.vy = Math.min(220, p.vy + 290 * dt);
        p.vx *= Math.pow(0.45, dt);
        p.sway += p.swaySpd * dt;
        p.x += (p.vx + Math.sin(p.sway) * 42) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.tilt += p.vtilt * dt;
        if (p.y > H + 24) {
          if (o.confetti.length > 130) o.confetti.splice(i, 1);
          else {
            p.y = -16;
            p.x = u.rand(0, W);
            p.vx = u.rand(-40, 40);
            p.vy = u.rand(65, 145);
          }
        }
      }
    } else if (o.lost) {
      if (o.rain) {
        o.rain.forEach(r => {
          r.y += r.spd * dt;
          r.x -= r.spd * 0.12 * dt;
          if (r.y > H + 24) { r.y = -24; r.x = u.rand(0, W + 80); }
        });
      }
      o.tearTimer = (o.tearTimer || 0) + dt;
      const sobCycle = o.t % 1.9;
      const interval = sobCycle < 0.35 ? 0.08 : 0.22;
      if (o.tearTimer >= interval) {
        o.tearTimer = 0;
        const side = Math.random() < 0.5 ? -1 : 1;
        o.tears.push({
          x: side * u.rand(10, 15),
          y: -48,
          vx: side * u.rand(24, 52),
          vy: u.rand(-40, -10),
          sz: u.randInt(4, 6),
        });
      }
      for (let i = o.tears.length - 1; i >= 0; i--) {
        const tr = o.tears[i];
        tr.vy += 320 * dt;
        tr.x += tr.vx * dt;
        tr.y += tr.vy * dt;
        if (tr.y >= 4) {
          o.ripples.push({ x: tr.x, y: 4, t: 0, dur: 0.55 });
          o.tears.splice(i, 1);
        }
      }
      for (let i = o.ripples.length - 1; i >= 0; i--) {
        o.ripples[i].t += dt;
        if (o.ripples[i].t >= o.ripples[i].dur) o.ripples.splice(i, 1);
      }
    }
  };

  function drawConfetti(c, list, front) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!!p.front !== front) continue;
      const sy = Math.cos(p.tilt);
      if (Math.abs(sy) < 0.08) continue;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(1, sy);
      c.fillStyle = p.color;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      c.restore();
    }
  }

  function drawWinnerDance(G, c, win, cx, baseY) {
    const t = G.time;
    // soft golden celebration glow behind the winner
    c.save();
    c.translate(cx, baseY - 46);
    c.rotate(t * 0.7);
    for (let i = 0; i < 8; i++) {
      c.rotate(Math.PI / 4);
      c.fillStyle = i % 2 === 0 ? 'rgba(255, 225, 74, 0.13)' : 'rgba(255, 255, 255, 0.07)';
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-14, -74);
      c.lineTo(14, -74);
      c.closePath();
      c.fill();
    }
    c.restore();

    // 3.2s dance choreography: boogie hops -> 360° victory spin -> double-hop cheer
    const phase = t % 3.2;
    let dx = 0, jump = 0, rot = 0, sx = 1, sy = 1, frame = 1;
    if (phase < 1.6) {
      const hop = Math.abs(Math.sin(phase * Math.PI * 2.5));
      jump = hop * 18;
      dx = Math.sin(phase * Math.PI * 1.25) * 20;
      rot = Math.sin(phase * Math.PI * 2.5) * 0.14;
      sx = 1 + (0.45 - hop) * 0.16;
      sy = 1 - (0.45 - hop) * 0.16;
      const step = Math.floor(phase * 6) % 4;
      frame = [2, 1, 3, 1][step];
    } else if (phase < 2.3) {
      const p = (phase - 1.6) / 0.7;
      jump = Math.sin(p * Math.PI) * 24;
      sx = 0.94;
      sy = 1.08;
      const spin = [1, 4, 0, 10, 1];
      frame = spin[Math.min(spin.length - 1, Math.floor(p * spin.length))];
    } else {
      const p = (phase - 2.3) / 0.9;
      const hop = Math.abs(Math.sin(p * Math.PI * 2));
      jump = hop * 22;
      rot = Math.sin(p * Math.PI * 4) * 0.12;
      sx = 1 + (0.45 - hop) * 0.18;
      sy = 1 - (0.45 - hop) * 0.18;
      frame = Math.floor(p * 8) % 2 === 0 ? 2 : 3;
    }

    // stage shadow shrinks as the character jumps
    const shScale = Math.max(0.45, 1 - jump / 70);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath();
    c.ellipse(cx + dx, baseY + 2, 34 * shScale, 9 * shScale, 0, 0, Math.PI * 2);
    c.fill();

    // dancing character
    c.save();
    c.translate(cx + dx, baseY - jump);
    c.rotate(rot);
    c.scale(sx, sy);
    R.drawChar(win, frame, -48, -96, 96);
    c.restore();

    // bouncing crown floating playfully above the head
    if (BC.Assets.glyphs.crown) {
      const crownLag = Math.max(0, Math.sin(t * 9 - 0.6)) * 5;
      c.save();
      c.translate(cx + dx, baseY - jump - 102 - crownLag);
      c.rotate(rot * 1.4);
      c.drawImage(BC.Assets.glyphs.crown, -22, -22, 44, 44);
      c.restore();
    }

    // twinkling celebration sparkles & floating musical notes
    for (let i = 0; i < 4; i++) {
      const a = t * 2.4 + i * (Math.PI / 2);
      const rx = cx + Math.cos(a) * 66;
      const ry = baseY - 52 + Math.sin(a * 1.3) * 26;
      const pulse = 0.5 + 0.5 * Math.sin(t * 9 + i * 1.7);
      const sz = Math.round(4 + pulse * 5);
      c.fillStyle = i % 2 === 0 ? '#ffe14a' : '#7ef2ff';
      c.fillRect(Math.round(rx - sz / 2), Math.round(ry - 1), sz, 2);
      c.fillRect(Math.round(rx - 1), Math.round(ry - sz / 2), 2, sz);
    }
    for (let i = 0; i < 2; i++) {
      const nt = (t * 0.75 + i * 0.5) % 1;
      const nx = cx + (i === 0 ? -64 : 64) + Math.sin(nt * 6 + i) * 8;
      const ny = baseY - 58 - nt * 42;
      R.text(i === 0 ? '♪' : '♫', nx, ny, { size: 16, align: 'center', color: i === 0 ? '#ffe14a' : '#ff8ad8', alpha: Math.sin(nt * Math.PI), shadow: false });
    }
  }

  function drawLoserCrying(G, c, loser, cx, baseY) {
    const t = G.time;
    const o = G.over;
    const img = BC.Assets.chars[loser];

    // shimmering tear puddle on the floor
    const puddleR = 46 + Math.min(18, o.t * 3.5);
    c.fillStyle = 'rgba(95, 195, 255, 0.28)';
    c.beginPath();
    c.ellipse(cx, baseY + 4, puddleR, 12, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(190, 240, 255, 0.25)';
    c.beginPath();
    c.ellipse(cx - 10, baseY + 2, puddleR * 0.45, 4, 0, 0, Math.PI * 2);
    c.fill();

    // ripples where teardrops splash
    if (o.ripples) {
      o.ripples.forEach(rp => {
        const k = rp.t / rp.dur;
        c.strokeStyle = `rgba(180, 240, 255, ${(1 - k) * 0.75})`;
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(cx + rp.x, baseY + rp.y, 4 + k * 20, 2 + k * 5, 0, 0, Math.PI * 2);
        c.stroke();
      });
    }

    // sobbing animation (periodic shudder + slow breathing heave)
    const sobCycle = o.t % 1.9;
    const sniff = sobCycle < 0.35 ? Math.sin((sobCycle / 0.35) * Math.PI) : 0;
    const heave = Math.sin(t * 2.6) * 1.5;
    const shiverX = sniff * Math.sin(t * 48) * 1.8;

    // sitting character composed from frame 1 (front-facing)
    if (img) {
      const px = 6; // 16px sprite -> 96px
      c.save();
      c.imageSmoothingEnabled = false;
      // splayed sitting feet resting forward on the floor
      c.drawImage(img, 16 + 2, 13, 6, 3, Math.round(cx - 38), Math.round(baseY - 14), 6 * px, 3 * px);
      c.drawImage(img, 16 + 8, 13, 6, 3, Math.round(cx + 2), Math.round(baseY - 14), 6 * px, 3 * px);

      // slumped upper body sitting down
      c.translate(cx + shiverX, baseY - 2);
      c.scale(1.04 - sniff * 0.03, 0.94 + sniff * 0.04);
      const bodyY = Math.round(-13 * px + heave + sniff * 2);
      c.drawImage(img, 16, 0, 16, 13, -48, bodyY, 96, 13 * px);

      // glistening crying eyes & streaming pixel tears (eye row is y=5, cols 5-6 & 9-10)
      const eyeY = bodyY + 5 * px;
      const streamH = 26 + Math.round(Math.sin(t * 14) * 3);
      [-15, 9].forEach((ex, sideIdx) => {
        // watery tear wells under eyes
        c.fillStyle = '#7ef2ff';
        c.fillRect(ex, eyeY + 2, 8, 5);
        c.fillStyle = '#e0fbff';
        c.fillRect(ex + 2, eyeY + 2, 4, 3);
        // animated streaming tear ribbon down cheeks
        c.fillStyle = 'rgba(126, 242, 255, 0.85)';
        c.fillRect(ex + (sideIdx === 0 ? 1 : 3), eyeY + 6, 4, streamH);
        const beadY = eyeY + 8 + ((Math.floor(t * 28) + sideIdx * 11) % Math.max(8, streamH - 4));
        c.fillStyle = '#ffffff';
        c.fillRect(ex + (sideIdx === 0 ? 1 : 3), beadY, 4, 4);
      });
      c.restore();
    }

    // arcing teardrops falling into the puddle
    if (o.tears) {
      o.tears.forEach(tr => {
        c.fillStyle = '#7ef2ff';
        c.fillRect(Math.round(cx + tr.x - tr.sz / 2), Math.round(baseY + tr.y - tr.sz / 2), tr.sz, tr.sz + 2);
        c.fillStyle = '#ffffff';
        c.fillRect(Math.round(cx + tr.x - tr.sz / 2 + 1), Math.round(baseY + tr.y - tr.sz / 2 + 1), 2, 2);
      });
    }

    // tiny gloomy pixel raincloud hovering above the character
    const cloudY = baseY - 108 + Math.sin(t * 2.2) * 3;
    c.fillStyle = '#2d3958';
    c.fillRect(cx - 26, cloudY + 4, 52, 14);
    c.fillRect(cx - 18, cloudY - 4, 36, 12);
    c.fillRect(cx - 8, cloudY - 10, 18, 10);
    c.fillStyle = '#4c5f8a';
    c.fillRect(cx - 22, cloudY + 4, 44, 8);
    c.fillRect(cx - 14, cloudY - 2, 28, 8);
    c.fillRect(cx - 6, cloudY - 7, 14, 6);
    // little rain ticks from the cloud
    c.fillStyle = 'rgba(130, 200, 255, 0.7)';
    for (let i = 0; i < 4; i++) {
      const ry = ((t * 58 + i * 11) % 24);
      c.fillRect(cx - 18 + i * 12, Math.round(cloudY + 18 + ry), 2, 6);
    }
  }

  S.drawOver = function (G) {
    const c = ctx();
    const o = G.over;
    const k = Math.min(1, o.t / 0.6);
    c.fillStyle = o.lost ? `rgba(4,8,24,${0.74 * k})` : `rgba(0,0,10,${0.65 * k})`;
    c.fillRect(0, 0, W, H);
    if (o.lost && o.rain) {
      c.strokeStyle = 'rgba(140, 185, 240, 0.28)';
      c.lineWidth = 2;
      c.beginPath();
      o.rain.forEach(r => {
        c.moveTo(r.x, r.y);
        c.lineTo(r.x - r.len * 0.12, r.y + r.len);
      });
      c.stroke();
    }
    if (o.won) drawConfetti(c, o.confetti, false);
    if (o.t < 0.4) return;
    const cx = W / 2;
    const win = o.winner;
    const edge = o.lost ? '#4a5c8a' : (win >= 0 ? BC.PLAYER_COLORS[win] : '#888');
    const bg = o.lost ? '#0e1228' : '#140f34';
    R.panel(cx - 330, 100, 660, 510, { bg, edge });
    if (o.won && win >= 0) {
      R.text('WINNER!', cx, 114, { size: 44, align: 'center', color: '#ffe14a', outline: 8 });
      R.text('しょうり!', cx, 162, { size: 26, jp: true, align: 'center', color: '#fff', outline: 6 });
      drawWinnerDance(G, c, win, cx, 336);
      R.text(BC.PLAYER_NAMES[win], cx, 348, { size: 26, align: 'center', color: BC.PLAYER_COLORS[win], outline: 6 });
      R.text(o.reason, cx, 384, { size: 11, align: 'center', color: '#9cf' });
    } else if (o.lost) {
      R.text('YOU LOST', cx, 114, { size: 44, align: 'center', color: '#8aa8e6', outline: 8 });
      R.text('ざんねん...', cx, 162, { size: 26, jp: true, align: 'center', color: '#9cb0d8', outline: 6 });
      drawLoserCrying(G, c, o.loser, cx, 334);
      const wpl = G.players[win];
      const wLabel = 'WINNER: ' + BC.PLAYER_NAMES[win] + (wpl && wpl.type === 'CPU' ? ' (CPU)' : '');
      R.text(wLabel, cx, 350, { size: 18, align: 'center', color: BC.PLAYER_COLORS[win], outline: 5 });
      R.text(o.reason, cx, 382, { size: 11, align: 'center', color: '#8ea4cc' });
    } else {
      R.text('DRAW', cx, 150, { size: 48, align: 'center', color: '#ccc', outline: 8 });
      R.text('ひきわけ', cx, 220, { size: 30, jp: true, align: 'center', color: '#fff', outline: 6 });
      R.text(o.reason, cx, 382, { size: 11, align: 'center', color: '#9cf' });
    }
    const order = G.players.slice().sort((a, b) => (a.place || 9) - (b.place || 9));
    order.forEach((pl, i) => {
      const y = 412 + i * 26;
      const isMe = o.lost && pl.p === o.loser;
      R.text((pl.place || '-') + '.', cx - 210, y, { size: 12, color: '#fff' });
      R.text(BC.PLAYER_NAMES[pl.p], cx - 160, y, { size: 12, color: BC.PLAYER_COLORS[pl.p] });
      R.text(isMe ? 'YOU' : pl.type, cx - 100, y, { size: 10, color: isMe ? '#8aa8e6' : '#99a' });
      R.text(pl.alive ? 'SURVIVOR' : pl.outReason, cx + 210, y, { size: 10, align: 'right', color: pl.alive ? '#ffe14a' : '#f88' });
    });
    if (o.t > 1.2) {
      const host = G.mode !== 'net' || (BC.Net.lobby && BC.Net.lobby.host === BC.Net.token);
      const txt = G.mode !== 'net' ? 'PUSH ENTER' : host ? 'PUSH ENTER: EVERYONE BACK TO LOBBY' : 'PUSH ENTER: BACK TO LOBBY';
      if (blink(G.time, 2)) R.text(txt, cx, 568, { size: 14, align: 'center', color: '#fff' });
    }
    if (o.won) drawConfetti(c, o.confetti, true);
  };

  BC.Screens = S;
})();
