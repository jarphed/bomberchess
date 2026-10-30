(function () {
  'use strict';
  const BC = window.BC = window.BC || {};

  const store = {
    get(k, d, s) { try { return (s || window.localStorage).getItem(k) || d; } catch (e) { return d; } },
    set(k, v, s) { try { (s || window.localStorage).setItem(k, v); } catch (e) { /* storage blocked */ } },
  };
  // per-tab identity: survives reloads (reconnect to your seat) but two tabs are two players
  const tabStore = (() => { try { return window.sessionStorage; } catch (e) { return null; } })();

  function makeToken() {
    const a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const N = {
    ws: null, status: 'off', // off | connecting | online | lost
    token: store.get('bomberchess.token', '', tabStore),
    name: store.get('bomberchess.name', 'PLAYER' + Math.floor(Math.random() * 90 + 10)),
    lobby: null, rtt: 0, handlers: {}, retry: 0, wanted: false,
    watching: false, // true while this tab shows the running LAN game, so a dropped connection rejoins it
    leaving: false, // left the game while offline: tell the server on the next hello so we aren't re-seated
    snaps: [], // bomber position history for interpolation
    available: location.protocol === 'http:' || location.protocol === 'https:',
  };
  if (!N.token) { N.token = makeToken(); store.set('bomberchess.token', N.token, tabStore); }

  N.on = (k, fn) => { N.handlers[k] = fn; };
  N.send = obj => {
    if (!N.ws || N.ws.readyState !== 1) return false;
    N.ws.send(JSON.stringify(obj));
    return true;
  };

  // walk out of the running game; if we're offline right now the next hello carries it instead
  N.quitGame = function () {
    N.watching = false;
    N.leaving = !N.send({ k: 'quit' });
  };

  N.setName = function (name) {
    N.name = name;
    store.set('bomberchess.name', name);
    N.send({ k: 'name', name });
  };

  N.connect = function () {
    N.wanted = true;
    if (N.ws && N.ws.readyState <= 1) return;
    N.status = 'connecting';
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    N.ws = ws;
    ws.onopen = () => {
      N.status = 'online';
      N.retry = 0;
      ws.send(JSON.stringify({ k: 'hello', token: N.token, name: N.name, watch: N.watching, quit: N.leaving }));
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.k === 'pong') { N.rtt = Math.round(performance.now() - m.t); return; }
      if (m.k === 'welcome') { N.token = m.token; N.leaving = false; store.set('bomberchess.token', m.token, tabStore); }
      if (m.k === 'lobby') N.lobby = m;
      const h = N.handlers[m.k];
      if (h) h(m);
    };
    ws.onclose = () => {
      if (N.ws !== ws) return;
      N.ws = null;
      N.status = N.wanted ? 'lost' : 'off';
      if (N.wanted) setTimeout(N.connect, Math.min(3000, 300 * ++N.retry));
    };
    ws.onerror = () => { /* onclose follows */ };
  };

  N.disconnect = function () {
    N.wanted = false;
    N.watching = false;
    if (N.ws) { const ws = N.ws; N.ws = null; ws.close(); }
    N.status = 'off';
    N.lobby = null;
  };

  setInterval(() => { if (N.status === 'online') N.send({ k: 'ping', t: performance.now(), rtt: N.rtt }); }, 1000);

  // Interpolated bomber positions: render slightly in the past between two snapshots
  N.pushBomberSnap = function (bombers, cells) {
    const now = performance.now();
    const pos = {};
    bombers.forEach(b => {
      const p = cells[b.from], q = cells[b.to];
      pos[b.p] = [p.sx + (q.sx - p.sx) * b.t, p.sy + (q.sy - p.sy) * b.t];
    });
    N.snaps.push({ at: now, pos });
    if (N.snaps.length > 30) N.snaps.shift();
    if (N.snaps.length > 1) {
      const gap = now - N.snaps[N.snaps.length - 2].at;
      N.gap = N.gap ? N.gap * 0.9 + gap * 0.1 : gap;
    }
  };

  N.interpolate = function (bombers) {
    const s = N.snaps;
    if (!s.length) return;
    const delay = Math.min(120, Math.max(25, (N.gap || 16) * 2.2));
    const t = performance.now() - delay;
    let a = s[0], b = s[s.length - 1];
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].at <= t) { a = s[i - 1]; b = s[i]; break; }
    }
    const k = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 1;
    bombers.forEach(bm => {
      const pa = a.pos[bm.p], pb = b.pos[bm.p];
      if (!pa || !pb) return;
      bm.px = pa[0] + (pb[0] - pa[0]) * k;
      bm.py = pa[1] + (pb[1] - pa[1]) * k;
    });
  };

  BC.Net = N;
})();
