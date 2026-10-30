(function () {
  'use strict';
  const BC = window.BC;
  const u = BC.u;
  const R = BC.Render, I = BC.Input, A = BC.Audio, N = BC.Net;
  const W = BC.W;
  const Lb = {};

  const ROW_X = 50, ROW_W = 640, ROW_Y0 = 112, ROW_H = 38, PANEL_H = 28;
  // rows move closer together when there are too many to fit
  const rowStep = n => Math.min(ROW_H, Math.floor((690 - ROW_Y0) / n));
  const blink = (t, r) => Math.floor(t * (r || 2)) % 2 === 0;

  function rows() {
    const lb = N.lobby;
    const out = [{ id: 'name' }];
    if (!lb) return out.concat([{ id: 'leave' }]);
    out.push({ id: 'n' });
    for (let i = 0; i < lb.n; i++) out.push({ id: 'seat', i });
    out.push({ id: 'moves' }, { id: 'time' }, { id: 'turn' }, { id: 'brain' }, { id: 'power' }, { id: 'chain' }, { id: 'gates' });
    if (lb.gates) out.push({ id: 'gateRound' });
    out.push({ id: 'revive' }, { id: 'blood' });
    out.push({ id: 'start' }, { id: 'leave' });
    return out;
  }

  const isHost = () => !!(N.lobby && N.lobby.host === N.token);
  Lb.typing = G => G.screen === 'lobby' && G.menuIdx === 0;

  function seatAction(i, dir) {
    const lb = N.lobby, s = lb.seats[i];
    if (s.owner === N.token) N.send({ k: 'seat', i, act: 'leave' });
    else if ((s.type === 'OPEN' || (lb.inGame && !s.owner)) && !dir) N.send({ k: 'seat', i, act: 'take' });
    else if (!s.owner && isHost() && !lb.inGame) N.send({ k: 'seat', i, act: 'toggle' });
    else return;
    A.play('menuMove');
  }

  function adjust(row, d) {
    const lb = N.lobby;
    if (!lb) return;
    if (row.id === 'seat') { seatAction(row.i, d); return; }
    if (!isHost()) return;
    if (row.id === 'n') N.send({ k: 'cfg', n: u.clamp(lb.n + d, 2, 5) });
    else if (row.id === 'moves') N.send({ k: 'cfg', moves: u.clamp(lb.moves + d, 2, 30) });
    else if (row.id === 'time') N.send({ k: 'cfg', bomberTime: u.clamp(lb.bomberTime + d * 5, 15, 120) });
    else if (row.id === 'brain') { setLevel('brain', brainOf(lb) + d); return; }
    else if (row.id === 'power') { setLevel('power', powerOf(lb) + d); return; }
    else if (row.id === 'turn') N.send({ k: 'cfg', turnTime: BC.turnTimeOf(turnOf(lb) + d * BC.TURN_TIME.step) });
    else if (row.id === 'chain') N.send({ k: 'cfg', chain: !lb.chain });
    else if (row.id === 'gates') N.send({ k: 'cfg', gates: !lb.gates });
    else if (row.id === 'gateRound') N.send({ k: 'cfg', gateRound: BC.gateRoundOf(gateOf(lb) + d) });
    else if (row.id === 'revive') N.send({ k: 'cfg', revive: !lb.revive });
    else if (row.id === 'blood') N.send({ k: 'cfg', blood: !lb.blood });
    else return;
    A.play('menuMove');
  }

  const brainOf = lb => (lb.brain === undefined ? BC.BRAIN_DEFAULT : lb.brain);
  const powerOf = lb => BC.powerLevelOf(lb.powerLevel);
  const gateOf = lb => BC.gateRoundOf(lb.gateRound);
  const turnOf = lb => BC.turnTimeOf(lb.turnTime);

  const VAL_X = ROW_X + ROW_W - 18, VAL_SIZE = 13;
  function valText(r) {
    const lb = N.lobby;
    switch (r.id) {
      case 'n': return String(lb.n);
      case 'moves': return String(lb.moves);
      case 'time': return lb.bomberTime + 's';
      case 'turn': return turnOf(lb) + 's';
      case 'chain': return lb.chain ? 'ON' : 'OFF';
      case 'gates': return lb.gates ? 'ON' : 'OFF';
      case 'gateRound': return String(gateOf(lb));
      case 'revive': return lb.revive ? 'ON' : 'OFF';
      case 'blood': return lb.blood ? 'ON' : 'OFF';
    }
    return null;
  }
  // a click left of the middle of "< value >" means "<", right of it means ">"
  function clickDir(r, mx) {
    const txt = valText(r);
    const mid = txt === null ? ROW_X + ROW_W / 2 : VAL_X - R.measure('< ' + txt + ' >', VAL_SIZE) / 2;
    return mx < mid ? -1 : 1;
  }

  // the slider rows: the lobby field and the cfg message each one sets, and its step under the mouse
  const SLIDERS = {
    brain: { of: brainOf, n: BC.BRAINS.length - 1, msg: lvl => ({ k: 'cfg', brain: lvl }), field: 'brain' },
    power: { of: powerOf, n: BC.POWER_LEVELS.length - 1, msg: lvl => ({ k: 'cfg', powerLevel: lvl }), field: 'powerLevel' },
  };
  const sliderAt = (id, mx) => (id === 'brain' ? R.brainLevelAt(ROW_X, ROW_W, mx) : id === 'power' ? R.powerLevelAt(ROW_X, ROW_W, mx) : -1);

  // host only; the lobby echoes the new value back to everyone
  function setLevel(id, lvl) {
    const lb = N.lobby, sl = SLIDERS[id];
    if (!lb || !isHost() || lb.inGame) return;
    lvl = u.clamp(lvl, 0, sl.n);
    if (lvl === sl.of(lb)) return;
    lb[sl.field] = lvl;
    N.send(sl.msg(lvl));
    A.play('menuMove');
  }

  function activate(G, row) {
    if (row.id === 'leave') { A.play('menuSelect'); G.leaveLan(); return; }
    if (row.id === 'start') {
      if (N.lobby && N.lobby.inGame) { A.play('menuSelect'); N.send({ k: 'watch' }); }
      else if (isHost()) { A.play('menuSelect'); N.send({ k: 'start' }); }
      return;
    }
    if (row.id === 'seat') { seatAction(row.i, 0); return; }
    if (row.id === 'name') { G.menuIdx = 1; A.play('menuMove'); return; }
    adjust(row, 1);
  }

  function typeName() {
    let name = N.name;
    I.pressed.forEach(code => {
      if (/^Key[A-Z]$/.test(code)) name += code.slice(3);
      else if (/^Digit[0-9]$/.test(code)) name += code.slice(5);
      else if (code === 'Space') name += ' ';
      else if (code === 'Minus') name += '-';
      else if (code === 'Backspace') name = name.slice(0, -1);
    });
    name = name.slice(0, 8);
    if (name !== N.name) { N.setName(name); A.play('menuMove'); }
  }

  Lb.update = function (G) {
    A.music('title');
    const list = rows();
    G.menuIdx = u.clamp(G.menuIdx, 0, list.length - 1);
    if (Lb.typing(G)) {
      typeName();
      if (I.hit('ArrowDown', 'Enter', 'Tab', 'NumpadEnter')) { G.menuIdx = 1; A.play('menuMove'); }
      if (I.hit('ArrowUp')) { G.menuIdx = list.length - 1; A.play('menuMove'); }
      if (I.hit('Escape')) G.leaveLan();
    } else {
      const m = I.menu();
      if (m.up) { G.menuIdx = (G.menuIdx - 1 + list.length) % list.length; A.play('menuMove'); }
      if (m.down) { G.menuIdx = (G.menuIdx + 1) % list.length; A.play('menuMove'); }
      if (m.left) adjust(list[G.menuIdx], -1);
      if (m.right) adjust(list[G.menuIdx], 1);
      if (I.hit('Escape')) { G.leaveLan(); return; }
      if (m.ok) activate(G, list[G.menuIdx]);
    }
    const mx = I.mouse.x, my = I.mouse.y, step = rowStep(list.length);
    const hit = list.findIndex((r, i) => mx >= ROW_X && mx <= ROW_X + ROW_W && my >= ROW_Y0 + i * step && my < ROW_Y0 + i * step + Math.min(step, PANEL_H + 4));
    if (hit >= 0 && I.mouse.moved && !G.dragSlider) G.menuIdx = hit;
    // the sliders: click or drag along them
    if (!I.mouse.down) G.dragSlider = null;
    if (G.dragSlider) setLevel(G.dragSlider, sliderAt(G.dragSlider, u.clamp(mx, ROW_X, ROW_X + ROW_W)));
    if (hit >= 0 && I.mouse.clicked) {
      G.menuIdx = hit;
      const r = list[hit];
      const lvl = sliderAt(r.id, mx);
      if (lvl >= 0) { G.dragSlider = isHost() ? r.id : null; setLevel(r.id, lvl); }
      else if (['n', 'moves', 'time', 'turn', 'brain', 'power', 'chain', 'gates', 'gateRound', 'revive', 'blood'].includes(r.id)) adjust(r, clickDir(r, mx));
      else if (r.id !== 'name') activate(G, r);
    }
  };

  Lb.draw = function (G) {
    const t = G.time;
    const ctx = R.ctx;
    R.backdrop(t, false);
    R.text('LAN LOBBY', 50, 34, { size: 28, color: '#ffe14a', outline: 6 });
    R.text('ロビー', 50 + R.measure('LAN LOBBY ', 28), 28, { size: 30, jp: true, color: '#7ef2ff', outline: 6 });
    const stat = N.status === 'online' ? (isHost() ? 'YOU ARE THE HOST' : 'CONNECTED') : N.status === 'connecting' ? 'CONNECTING...' : 'CONNECTION LOST - RETRYING...';
    R.text(stat, 50, 82, { size: 10, color: N.status === 'online' ? '#6f6' : '#fd4' });

    const lb = N.lobby;
    const list = rows();
    const step = rowStep(list.length);
    list.forEach((r, i) => {
      const y = ROW_Y0 + i * step;
      const sel = i === G.menuIdx;
      R.panel(ROW_X, y, ROW_W, PANEL_H, { bg: sel ? '#2c2470' : '#18143c', edge: sel ? '#ffe14a' : '#3a3480' });
      const host = isHost();
      const val = (txt, col, adj) => R.text(adj ? '< ' + txt + ' >' : txt, VAL_X, y + 9, { size: VAL_SIZE, align: 'right', color: col || '#fff' });
      switch (r.id) {
        case 'name': {
          R.text('NAME', ROW_X + 16, y + 10, { size: 13 });
          const cursor = sel && blink(t, 3) ? '_' : ' ';
          val(N.name + (sel ? cursor : ''), sel ? '#ffe14a' : '#fff');
          if (sel) R.text('TYPE YOUR NAME', ROW_X + 110, y + 13, { size: 8, color: '#99a' });
          break;
        }
        case 'n':
          R.text('PLAYERS', ROW_X + 16, y + 10, { size: 13 });
          R.text(BC.BOARD_LABEL[lb.n].name, ROW_X + 150, y + 13, { size: 9, color: '#9cf' });
          val(valText(r), '#ffe14a', host);
          break;
        case 'seat': {
          const s = lb.seats[r.i];
          const mine = s.owner === N.token;
          R.text(BC.PLAYER_NAMES[r.i], ROW_X + 16, y + 10, { size: 13, color: BC.PLAYER_COLORS[r.i] });
          R.drawChar(r.i, 1, ROW_X + 58, y + 1, 28);
          let txt, col = '#fff', hint = '';
          if (mine) { txt = s.name + ' (YOU)'; col = '#ffe14a'; hint = 'ENTER: LEAVE SEAT'; }
          else if (s.type === 'HUMAN' && s.owner) { txt = s.name + (s.online ? '' : ' (AWAY)'); col = s.online ? '#fff' : '#888'; }
          else if (lb.inGame) { txt = 'CPU'; col = '#7fd8ff'; hint = 'ENTER: TAKE OVER FROM THE CPU'; }
          else if (s.type === 'OPEN') { txt = 'OPEN'; col = '#6f6'; hint = 'ENTER: JOIN' + (host ? '  </>: CPU' : ''); }
          else { txt = 'CPU'; col = '#7fd8ff'; hint = host ? 'ENTER: OPEN SEAT' : ''; }
          if (sel && hint) R.text(hint, ROW_X + 100, y + 13, { size: 8, color: '#99a' });
          val(txt, col);
          break;
        }
        case 'moves':
          R.text('CHESS MOVES / ROUND', ROW_X + 16, y + 10, { size: 13 });
          val(valText(r), '#fff', host);
          break;
        case 'time':
          R.text('BOMBER TIME', ROW_X + 16, y + 10, { size: 13 });
          val(valText(r), '#fff', host);
          break;
        case 'turn':
          R.text('TURN TIME', ROW_X + 16, y + 10, { size: 13 });
          if (sel) R.text('MISS YOUR TURN = A SHEEP!', ROW_X + 160, y + 13, { size: 8, color: '#99a' });
          val(valText(r), '#fff', host);
          break;
        case 'brain':
          R.brainSlider(ROW_X, y, ROW_W, PANEL_H, brainOf(lb), { sel: sel && host && !lb.inGame, enabled: host && !lb.inGame });
          break;
        case 'power':
          R.powerSlider(ROW_X, y, ROW_W, PANEL_H, powerOf(lb), { sel: sel && host && !lb.inGame, enabled: host && !lb.inGame });
          break;
        case 'chain':
          R.text('CHAINED DEATHS', ROW_X + 16, y + 10, { size: 13 });
          if (sel) R.text('STRUCK PIECES STRIKE BACK', ROW_X + 222, y + 13, { size: 7, color: '#99a' });
          val(valText(r), lb.chain ? '#ff9af0' : '#889', host);
          break;
        case 'gates':
          R.text('SHEEP GATES', ROW_X + 16, y + 10, { size: 13 });
          if (sel) R.text('SHEEP JUMP IN FROM CHESS ROUND ' + gateOf(lb), ROW_X + 180, y + 13, { size: 7, color: '#99a' });
          val(valText(r), lb.gates ? '#bff07a' : '#889', host);
          break;
        case 'gateRound':
          R.text('GATES OPEN IN ROUND', ROW_X + 16, y + 10, { size: 13 });
          if (sel) R.text(BC.Screens.gateHint(gateOf(lb)), ROW_X + 290, y + 13, { size: 7, color: '#99a' });
          val(valText(r), '#bff07a', host);
          break;
        case 'revive':
          R.text('PLAYERS CAN REVIVE', ROW_X + 16, y + 10, { size: 13 });
          if (sel) R.text('OUT? WIN A BOMBER ROUND', ROW_X + 270, y + 13, { size: 7, color: '#99a' });
          val(valText(r), lb.revive ? '#ffe14a' : '#889', host);
          break;
        case 'blood':
          R.text('BLOOD', ROW_X + 16, y + 10, { size: 13, color: lb.blood ? '#ff5a5a' : '#fff' });
          if (sel) R.text('GORE FOR SHEEP AND BOMBERS', ROW_X + 110, y + 13, { size: 7, color: '#99a' });
          val(valText(r), lb.blood ? '#ff3d3d' : '#889', host);
          break;
        case 'start': {
          const humans = lb.seats.slice(0, lb.n).filter(s => s.type === 'HUMAN').length;
          if (lb.inGame) R.text('GAME IN PROGRESS - ENTER: WATCH', ROW_X + ROW_W / 2, y + 10, { size: 12, align: 'center', color: sel && blink(t, 4) ? '#ffe14a' : '#fd8' });
          else if (host) R.text('START GAME! (' + humans + ' HUMAN' + (humans === 1 ? '' : 'S') + ')', ROW_X + ROW_W / 2, y + 8, { size: 16, align: 'center', color: sel && blink(t, 4) ? '#ffe14a' : '#ff7a3c' });
          else R.text('WAITING FOR HOST TO START', ROW_X + ROW_W / 2, y + 9, { size: 12, align: 'center', color: blink(t, 1) ? '#ccd' : '#889' });
          break;
        }
        case 'leave':
          R.text('LEAVE', ROW_X + ROW_W / 2, y + 10, { size: 13, align: 'center', color: '#99a' });
          break;
      }
    });

    // invite + people
    const px = 730, py = 34, pw = 510;
    R.panel(px, py, pw, 250, { bg: '#100c28', edge: '#4a3fa0' });
    R.text('INVITE FRIENDS', px + 18, py + 16, { size: 14, color: '#ffe14a' });
    // hosted online the server's own interface IPs are internal, so share the address we came in on
    const lan = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(location.hostname);
    R.text(lan ? 'SAME WI-FI / NETWORK, OPEN IN A BROWSER:' : 'SEND YOUR FRIENDS THIS LINK:', px + 18, py + 44, { size: 8, color: '#aab' });
    const urls = lan && lb && lb.urls && lb.urls.length ? lb.urls : [location.origin];
    urls.slice(0, 3).forEach((url, i) => R.text(url.replace(/^https?:\/\//, ''), px + 18, py + 66 + i * 30, { size: 14, color: '#7ef2ff' }));
    R.text('THEN CHOOSE  LAN GAME', px + 18, py + 168, { size: 9, color: '#aab' });
    R.text('TIP: TAKE 2 SEATS TO SHARE ONE KEYBOARD', px + 18, py + 196, { size: 8, color: '#889' });
    R.text('LEAVING MID-GAME? A CPU KEEPS YOUR SEAT WARM.', px + 18, py + 216, { size: 8, color: '#889' });

    R.panel(px, py + 270, pw, 360, { bg: '#100c28', edge: '#4a3fa0' });
    R.text('CONNECTED', px + 18, py + 286, { size: 14, color: '#ffe14a' });
    R.text('せつぞく', px + pw - 18, py + 282, { size: 18, jp: true, align: 'right', color: '#7ef2ff' });
    if (lb) {
      lb.people.slice(0, 12).forEach((p, i) => {
        const y = py + 320 + i * 24;
        R.text(p.name, px + 18, y, { size: 11, color: '#fff' });
        const ping = p.ping ? p.ping + 'MS' : '--';
        R.text(ping, px + pw - 18, y, { size: 10, align: 'right', color: p.ping && p.ping > 80 ? '#fd4' : '#6f6' });
      });
    }
    if (N.status !== 'online') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px, py + 270, pw, 360);
    }
    R.text('ARROWS / WASD + ENTER, OR MOUSE.  ESC: LEAVE', W / 2 - 280, 696, { size: 9, align: 'center', color: '#889' });
  };

  BC.Lobby = Lb;
})();
