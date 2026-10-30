'use strict';
// BOMBER CHESS LAN server: serves the game and runs the authoritative simulation.
// Usage: node server.js [port]   (no npm dependencies)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT) || 8765;
const TICK = 1 / 60;
const MAX_MSG = 8 * 1024;
const MAX_CLIENTS = 24;
const SLOW_CLIENT_BYTES = 512 * 1024;

global.window = { addEventListener() {} };
for (const f of ['core', 'board', 'chess', 'specials', 'bomber', 'ai', 'logic', 'snap']) require(path.join(ROOT, 'js', f + '.js'));
const BC = global.window.BC;

// ------------------------------------------------------------------ static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json',
};
const PUBLIC = ['index.html', 'js', 'css', 'assets'];

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const inside = path.relative(ROOT, file);
  const top = inside.split(path.sep)[0];
  if (inside.startsWith('..') || path.isAbsolute(inside) || !PUBLIC.includes(top)) { res.writeHead(404); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

// ------------------------------------------------------------------ websocket (RFC 6455, text frames)
function wsAccept(req, socket, onOpen) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = { socket, buf: Buffer.alloc(0), frags: [], fragLen: 0, open: true, onmessage: null, onclose: null };
  ws.send = str => { if (ws.open) writeFrame(ws, 0x1, Buffer.from(str, 'utf8')); };
  ws.close = () => {
    if (!ws.open) return;
    ws.open = false;
    try { writeFrame(ws, 0x8, Buffer.alloc(0), true); socket.end(); } catch (e) { /* already gone */ }
    if (ws.onclose) ws.onclose();
  };
  socket.on('data', d => { ws.buf = Buffer.concat([ws.buf, d]); parseFrames(ws); });
  const gone = () => { if (ws.open) { ws.open = false; if (ws.onclose) ws.onclose(); } };
  socket.on('close', gone);
  socket.on('end', gone);
  socket.on('error', gone);
  onOpen(ws);
}

function writeFrame(ws, op, payload, force) {
  if (!force && !ws.open) return;
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  ws.socket.write(Buffer.concat([head, payload]));
}

function parseFrames(ws) {
  while (ws.open && ws.buf.length >= 2) {
    const b0 = ws.buf[0], b1 = ws.buf[1];
    const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f;
    let len = b1 & 0x7f, off = 2;
    if (!(b1 & 0x80)) { ws.close(); return; }
    if (len === 126) { if (ws.buf.length < 4) return; len = ws.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (ws.buf.length < 10) return;
      if (ws.buf.readUInt32BE(2) !== 0) { ws.close(); return; }
      len = ws.buf.readUInt32BE(6); off = 10;
    }
    if (len > MAX_MSG) { ws.close(); return; }
    if (ws.buf.length < off + 4 + len) return;
    const mask = ws.buf.subarray(off, off + 4);
    const data = Buffer.from(ws.buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    ws.buf = ws.buf.subarray(off + 4 + len);
    if (op === 0x8) { ws.close(); return; }
    if (op === 0x9) { writeFrame(ws, 0xA, data); continue; }
    if (op === 0xA) continue;
    ws.frags.push(data);
    ws.fragLen += len;
    if (ws.fragLen > MAX_MSG) { ws.close(); return; }
    if (fin) {
      const msg = Buffer.concat(ws.frags).toString('utf8');
      ws.frags = []; ws.fragLen = 0;
      if (ws.onmessage) ws.onmessage(msg);
    }
  }
}

// ------------------------------------------------------------------ lobby + game
const clients = new Map(); // token -> client
let nextId = 1;
const lobby = {
  n: 2, moves: 10, bomberTime: 45, brain: BC.BRAIN_DEFAULT, turnTime: BC.TURN_TIME.def, chain: false, gates: false,
  gateRound: BC.GATE_ROUND.def, powerLevel: BC.POWER_DEFAULT, revive: false, blood: false,
  seats: [0, 1, 2, 3, 4].map(i => ({ type: i < 2 ? 'OPEN' : 'CPU', owner: null })),
};
let hostToken = null;
let game = null; // { L, inputs, cfg, sentRev, overAt }

const cleanName = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 _\-!?.]/g, '').trim().slice(0, 8) || 'PLAYER';
const online = token => { const c = clients.get(token); return !!(c && c.ws && c.ws.open); };

function lanUrls() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => {
    if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }));
  return out;
}

function lobbyMsg() {
  return JSON.stringify({
    k: 'lobby', n: lobby.n, moves: lobby.moves, bomberTime: lobby.bomberTime, brain: lobby.brain,
    turnTime: lobby.turnTime, chain: lobby.chain, gates: lobby.gates, gateRound: lobby.gateRound, powerLevel: lobby.powerLevel,
    revive: lobby.revive, blood: lobby.blood,
    host: hostToken,
    inGame: !!game, urls: lanUrls(),
    seats: lobby.seats.map(s => ({
      type: s.type, owner: s.owner, name: s.owner && clients.get(s.owner) ? clients.get(s.owner).name : '',
      online: s.owner ? online(s.owner) : false,
    })),
    people: [...clients.values()].filter(c => c.ws && c.ws.open).map(c => ({ name: c.name, ping: c.ping, id: c.id })),
  });
}

function broadcast(str) { clients.forEach(c => { if (c.ws && c.ws.open) c.ws.send(str); }); }
const pushLobby = () => broadcast(lobbyMsg());

function pickHost() {
  if (hostToken && online(hostToken)) return;
  const c = [...clients.values()].find(x => x.ws && x.ws.open);
  hostToken = c ? c.token : null;
}

function startMsg() {
  return JSON.stringify({ k: 'start', cfg: game.cfg });
}

// put a client into the running game (as a player or a spectator)
function joinGame(c) {
  if (!game || !c.ws || !c.ws.open) return;
  c.inGame = true;
  c.ws.send(startMsg());
  sendState(true, c.ws);
}

function startGame() {
  const n = lobby.n;
  const seats = lobby.seats.slice(0, n);
  const types = seats.map(s => (s.type === 'HUMAN' && s.owner && online(s.owner) ? 'HUMAN' : 'CPU'));
  const names = seats.map(s => (s.type === 'HUMAN' && s.owner && clients.get(s.owner) ? clients.get(s.owner).name : 'CPU'));
  const cfg = {
    n, moves: lobby.moves, bomberTime: lobby.bomberTime, brain: lobby.brain, turnTime: lobby.turnTime, chain: lobby.chain,
    gates: lobby.gates, gateRound: lobby.gateRound, powerLevel: lobby.powerLevel, revive: lobby.revive, blood: lobby.blood, types, names,
  };
  const L = BC.Logic.create(cfg);
  game = { L, cfg, inputs: {}, sentRev: -1, overAt: 0, tick: 0 };
  clients.forEach(c => { c.inGame = !!(c.ws && c.ws.open); });
  broadcast(startMsg());
  sendState(true);
  pushLobby();
  console.log(`Game started: ${n} players [${names.join(', ')}]`);
}

function endGame() {
  game = null;
  clients.forEach(c => { c.inGame = false; });
  lobby.seats.forEach(s => { if (s.type === 'HUMAN' && !online(s.owner)) { s.type = 'OPEN'; s.owner = null; } });
  broadcast(JSON.stringify({ k: 'end' }));
  pushLobby();
}

// a player walks out of the running game: a CPU takes over their seats for good, so coming back to the
// lobby later doesn't drop them straight back into the match. Once the game is over they keep their seats
// for the next one.
function leaveGame(c) {
  c.inGame = false;
  if (!game || game.L.over) return;
  lobby.seats.forEach((s, i) => {
    if (s.owner !== c.token) return;
    s.owner = null;
    s.type = 'OPEN';
    if (i < game.cfg.n) {
      game.L.setType(i, 'CPU');
      game.L.players[i].name = 'CPU';
      game.L.rev++;
      delete game.inputs[i];
    }
  });
}

function sendState(full, onlyTo) {
  const L = game.L;
  const withChess = full || L.rev !== game.sentRev;
  const s = BC.Snap.encode(L, withChess);
  s.k = 's';
  // one-off events belong to the shared broadcast, not to a catch-up snapshot for a single client
  if (!onlyTo && L.events.length) { s.ev = L.events; L.events = []; }
  const str = JSON.stringify(s);
  if (onlyTo) { onlyTo.send(str); return; }
  game.sentRev = L.rev;
  clients.forEach(c => {
    // drop snapshots for clients whose socket is backed up instead of buffering stale state
    if (c.inGame && c.ws && c.ws.open && (s.ch || s.ev || c.ws.socket.writableLength < SLOW_CLIENT_BYTES)) c.ws.send(str);
  });
}

function seatOf(c, i) {
  return Number.isInteger(i) && i >= 0 && i < 5 && lobby.seats[i].owner === c.token;
}

function handle(c, msg) {
  let m;
  try { m = JSON.parse(msg); } catch (e) { return; }
  if (!m || typeof m !== 'object') return;
  const isHost = c.token === hostToken;
  switch (m.k) {
    case 'ping': c.ws.send(JSON.stringify({ k: 'pong', t: Number(m.t) || 0 })); c.ping = Math.max(0, Math.min(9999, Number(m.rtt) || 0)); break;
    case 'name': c.name = cleanName(m.name); pushLobby(); break;
    case 'seat': {
      const i = m.i;
      if (!Number.isInteger(i) || i < 0 || i >= lobby.n) return;
      const s = lobby.seats[i];
      if (m.act === 'take' && (s.type === 'OPEN' || (game && !s.owner && s.type === 'CPU'))) {
        s.type = 'HUMAN'; s.owner = c.token;
        if (game) {
          game.L.setType(i, 'HUMAN');
          game.L.players[i].name = c.name;
          game.L.rev++;
          if (!c.inGame) joinGame(c);
        }
      } else if (m.act === 'leave' && s.owner === c.token) {
        s.owner = null;
        s.type = game ? 'CPU' : 'OPEN';
        if (game) { game.L.setType(i, 'CPU'); game.L.players[i].name = 'CPU'; }
      } else if (m.act === 'toggle' && isHost && !game && s.owner === null) {
        s.type = s.type === 'OPEN' ? 'CPU' : 'OPEN';
      }
      pushLobby();
      break;
    }
    case 'cfg':
      if (!isHost || game) return;
      if (Number.isInteger(m.n)) {
        lobby.n = Math.max(2, Math.min(5, m.n));
        lobby.seats.forEach((s, i) => { if (i >= lobby.n && s.owner) { s.owner = null; s.type = 'CPU'; } });
      }
      if (Number.isInteger(m.moves)) lobby.moves = Math.max(2, Math.min(30, m.moves));
      if (Number.isInteger(m.bomberTime)) lobby.bomberTime = Math.max(15, Math.min(120, m.bomberTime));
      if (Number.isInteger(m.brain)) lobby.brain = Math.max(0, Math.min(BC.BRAINS.length - 1, m.brain));
      if (Number.isInteger(m.turnTime)) lobby.turnTime = BC.turnTimeOf(m.turnTime);
      if (typeof m.chain === 'boolean') lobby.chain = m.chain;
      if (typeof m.gates === 'boolean') lobby.gates = m.gates;
      if (typeof m.revive === 'boolean') lobby.revive = m.revive;
      if (typeof m.blood === 'boolean') lobby.blood = m.blood;
      if (Number.isInteger(m.gateRound)) lobby.gateRound = BC.gateRoundOf(m.gateRound);
      if (Number.isInteger(m.powerLevel)) lobby.powerLevel = BC.powerLevelOf(m.powerLevel);
      pushLobby();
      break;
    case 'start': if (isHost && !game) startGame(); break;
    case 'lobby': if (isHost && game && game.L.over) endGame(); break;
    case 'abort': if (isHost && game) { console.log(`${c.name} ended the game`); endGame(); } break;
    case 'quit': leaveGame(c); pushLobby(); break;
    case 'watch': if (game && !c.inGame) joinGame(c); break;
    case 'in': {
      if (!game || !seatOf(c, m.s)) return;
      const cur = game.inputs[m.s] || (game.inputs[m.s] = { dx: 0, dy: 0, bs: 0, lbs: null });
      cur.dx = Math.sign(Number(m.dx) || 0);
      cur.dy = Math.sign(Number(m.dy) || 0);
      if (Number.isInteger(m.bs)) cur.bs = m.bs;
      if (cur.lbs === null) cur.lbs = cur.bs;
      break;
    }
    case 'mv':
      if (!game || !seatOf(c, m.s) || !Number.isInteger(m.from) || !Number.isInteger(m.to)) return;
      if (game.L.tryMove(m.s, m.from, m.to)) sendState(false);
      break;
  }
}

function connect(ws) {
  let c = null;
  ws.onmessage = msg => {
    if (c) { c.lastSeen = Date.now(); handle(c, msg); return; }
    let m;
    try { m = JSON.parse(msg); } catch (e) { ws.close(); return; }
    if (!m || m.k !== 'hello') { ws.close(); return; }
    let token = typeof m.token === 'string' && /^[a-f0-9]{16,64}$/.test(m.token) ? m.token : '';
    c = token ? clients.get(token) : null;
    // same token still alive elsewhere (e.g. a duplicated tab): treat the newcomer as a new player
    if (c && c.ws && c.ws.open && Date.now() - c.lastSeen < 2500) c = null, token = '';
    if (!token) token = crypto.randomBytes(16).toString('hex');
    if (!c) {
      if (clients.size >= MAX_CLIENTS) { ws.close(); return; }
      c = { token, id: nextId++, ping: 0 };
      clients.set(token, c);
    }
    const old = c.ws;
    c.ws = ws;
    if (old && old.open) old.close();
    c.lastSeen = Date.now();
    c.name = cleanName(m.name);
    pickHost();
    ws.send(JSON.stringify({ k: 'welcome', token, id: c.id }));
    c.inGame = false;
    // a player who left the game while their connection was down
    if (m.quit === true) leaveGame(c);
    if (game) {
      // a returning player (reload / dropped connection) takes their seats back from the CPU;
      // anyone else stays in the lobby unless they were already watching
      let seated = false;
      lobby.seats.forEach((s, i) => {
        if (s.owner === token && i < game.cfg.n) { seated = true; game.L.setType(i, 'HUMAN'); game.L.players[i].name = c.name; }
      });
      if (seated || m.watch === true) joinGame(c);
    }
    pushLobby();
    console.log(`+ ${c.name} connected (${clients.size} known)`);
  };
  ws.onclose = () => {
    if (!c || c.ws !== ws) return;
    console.log(`- ${c.name} disconnected`);
    lobby.seats.forEach((s, i) => {
      if (s.owner !== c.token) return;
      if (game && i < game.cfg.n) { game.L.setType(i, 'CPU'); delete game.inputs[i]; }
      else if (!game) { s.owner = null; s.type = 'OPEN'; }
    });
    pickHost();
    pushLobby();
  };
}

// ------------------------------------------------------------------ main loop
function step(dt) {
  if (!game) return;
  const L = game.L;
  const inputs = {};
  Object.keys(game.inputs).forEach(k => {
    const s = game.inputs[k];
    inputs[k] = { dx: s.dx, dy: s.dy, bomb: s.bs !== s.lbs };
    s.lbs = s.bs;
  });
  L.update(dt, inputs);
  game.tick++;
  const live = L.phase === 'bomber';
  if (live || L.events.length || L.rev !== game.sentRev || game.tick % 6 === 0) sendState(false);
  if (L.over && !game.overAt) game.overAt = Date.now() + 15000;
  if (game.overAt && Date.now() > game.overAt) endGame();
}

let last = process.hrtime.bigint();
let acc = 0;
function loop() {
  const now = process.hrtime.bigint();
  acc = Math.min(0.25, acc + Number(now - last) / 1e9);
  last = now;
  while (acc >= TICK) {
    try { step(TICK); } catch (e) { console.error('Game error, returning to lobby:', e); endGame(); }
    acc -= TICK;
  }
  setTimeout(loop, 2);
}

const server = http.createServer(serveStatic);
server.on('upgrade', (req, socket) => {
  let p = '';
  try { p = new URL(req.url, 'http://x').pathname; } catch (e) { /* bad url */ }
  if (p !== '/ws') { socket.destroy(); return; }
  wsAccept(req, socket, connect);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  BOMBER CHESS  ボンバーチェス  LAN server\n');
  console.log(`  This computer:   http://localhost:${PORT}`);
  lanUrls().forEach(u => console.log(`  Friends (Wi-Fi): ${u}`));
  console.log('\n  Everyone opens the URL, picks LAN GAME and joins a seat.\n');
  loop();
});
