(function () {
  'use strict';
  const BC = window.BC;
  const A = BC.Assets, R = BC.Render;
  const FIELD = { x: 24, y: 82, w: 960, h: 520 };
  const ink = '#101726', panel = '#1b2939', line = '#43566a', ice = '#d5e6e9';
  const muted = '#a2b8c5', gold = '#ffcb68';
  const RED = ['#4e0610', '#7a0a14', '#a8101c', '#d01c28'];
  const names = {
    rocket: 'ROCKET', grenade: 'GRENADE', mortar: 'MORTAR', shotgun: 'SHOTGUN',
    drill: 'DRILL', dynamite: 'DYNAMITE', sheep: 'SHEEP', meteor: 'METEOR',
    cluster: 'CLUSTER', holy: 'HOLY GRENADE',
  };
  const shortPiece = { K: 'KING', P: 'PAWN', N: 'HORSE', B: 'BISHOP', R: 'ROOK', Q: 'QUEEN' };
  const phaseNames = { aim: 'AIM & FIRE', shot: 'SHOT IN PLAY', settle: 'AFTERMATH', drop: 'SUPPLY DROP', done: 'ROUND OVER' };
  let sky, map, fx, lastDrawT = 0, weaponHits = [];

  function rect(g, x, y, w, h, color) {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function text(s, x, y, size, color, align) {
    R.text(String(s), x, y, { size, color, align, shadow: false });
  }
  function plate(g, x, y, w, h) {
    rect(g, x, y, w, h, line);
    rect(g, x + 2, y + 2, w - 4, h - 4, panel);
  }

  function ensureFx(w) {
    if (!fx || fx.terrain !== w.terrain) {
      fx = { terrain: w.terrain, drops: [], gibs: [], mists: [], nums: [], splashes: [], tracks: new Map() };
    }
    return fx;
  }

  // Paint pixel blood onto solid terrain only (clipped to existing terrain alpha via source-atop).
  function stainTerrain(x, y, r) {
    if (!map) return;
    const fg = map.fg, p = 2;
    fg.save();
    fg.globalCompositeOperation = 'source-atop';
    fg.globalAlpha = 0.9;
    const blob = (cx, cy, rad, col) => {
      fg.fillStyle = col;
      const rx = Math.max(2, rad), ry = Math.max(2, rad * 0.75);
      for (let yy = -ry; yy <= ry; yy += p) {
        const hw = rx * Math.sqrt(Math.max(0, 1 - (yy / ry) * (yy / ry)));
        const x0 = Math.round((cx - hw) / p) * p, x1 = Math.max(x0 + p, Math.round((cx + hw) / p) * p);
        fg.fillRect(x0, Math.round((cy + yy) / p) * p, x1 - x0, p);
      }
    };
    blob(x, y, r * 0.72, RED[1]);
    const n = Math.min(6, Math.max(2, Math.round(r / 3.5)));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.35 + Math.random() * 0.65);
      blob(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.18 + Math.random() * 0.28), RED[1 + (i % 3)]);
    }
    if (r >= 5) blob(x - r * 0.15, y - r * 0.15, r * 0.28, RED[3]);
    fg.restore();
  }

  const gibCache = new Map();
  const headCache = new Map();
  // Per-player bomberman head extraction from A.chars[p] frame 4 (side-facing right, 16x16).
  // Each head is cropped to an 8x8 sprite with the neck centered at x=4, y=7.
  const HEAD_SPEC = [
    { ox: 4, y6: [2, 6], y7: [2, 5] }, // 0: orange
    { ox: 3, y6: [1, 7], y7: [2, 5] }, // 1: purple
    { ox: 3, y6: [2, 6], y7: [3, 5] }, // 2: green
    { ox: 3, y6: [2, 6], y7: [3, 5] }, // 3: blue
    { ox: 3, y6: [2, 6], y7: [3, 5] }, // 4: red (hue-shifted green)
  ];

  function headSprite(p) {
    const idx = p % HEAD_SPEC.length;
    if (headCache.has(idx)) return headCache.get(idx);
    const [cv, g] = A.canvas(8, 8);
    const src = A.chars && A.chars[idx];
    if (src && A.ready && A.ok.sheet) {
      const sp = HEAD_SPEC[idx];
      // Copy rows 0..7 of frame 4 (facing right) aligned so the neck sits at x=4.
      g.drawImage(src, 4 * A.T + sp.ox, 0, 8, 8, 0, 0, 8, 8);
      // Trim shoulder pixels on rows 6 and 7 so only the head & chin remain.
      if (sp.y6[0] > 0) g.clearRect(0, 6, sp.y6[0], 1);
      if (sp.y6[1] < 7) g.clearRect(sp.y6[1] + 1, 6, 7 - sp.y6[1], 1);
      if (sp.y7[0] > 0) g.clearRect(0, 7, sp.y7[0], 1);
      if (sp.y7[1] < 7) g.clearRect(sp.y7[1] + 1, 7, 7 - sp.y7[1], 1);
      headCache.set(idx, cv);
      return cv;
    }
    // Fallback head if spritesheet hasn't loaded yet (not cached).
    const pal = { k: '#1e1624', c: BC.PLAYER_COLORS[idx] || gold, d: BC.PLAYER_DARK[idx] || ink, e: '#fff7de' };
    ['..kkkk..', '.kcccck.', 'kcccccck', 'kccckek.', 'kcccccck', '.kddddk.', '..kkkk..']
      .forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (pal[row[x]]) rect(g, x, y + 1, 1, 1, pal[row[x]]);
      });
    return cv;
  }

  function makeSprite(rows, palette) {
    const [cv, g] = A.canvas(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (palette[row[x]]) rect(g, x, y, 1, 1, palette[row[x]]);
      }
    });
    return cv;
  }
  function wormGibs(p) {
    if (gibCache.has(p)) return gibCache.get(p);
    const pal = {
      k: '#180d16', w: '#fff9ec', o: '#e5d5b5', s: '#b29b7d', d: '#735d4c',
      R: '#ff3b47', r: '#c81422', m: '#8a0c18', b: '#4a050c', p: '#d95f6a',
    };
    const parts = [
      // Detached bomberman head (keeps player color)
      { img: headSprite(p), s: 2.2, keep: true },
      // Shattered bloody ribcage chunk
      { img: makeSprite(['.kwojkbrwk', 'kdkwsmRmrk', '.kwojkbrpk', '..krmbrmk.'], pal), s: 2.1, keep: true },
      // Jagged bloody spine segment
      { img: makeSprite(['.kdkojk.', 'kdkwosk.', '.kdkrmk.', '..kRrb..'], pal), s: 2.1, keep: true },
      // Raw viscera / meat chunks
      { img: makeSprite(['.krmrk.', 'kRpmrmk', '.kbmrk.'], pal), s: 2, keep: false },
      { img: makeSprite(['.kbrb.', 'kRmpmk', '.kmmk.'], pal), s: 2, keep: false },
      // Bloody broken ribs & bones
      { img: makeSprite(['r....o', 'roooow', 'r....o'], pal), s: 2.2, keep: true },
      { img: makeSprite(['o....R', 'woooRr', 'o....r'], pal), s: 2.2, keep: false },
    ];
    if (A.ready && A.ok.sheet) gibCache.set(p, parts);
    return parts;
  }
  function sheepGibs() {
    if (gibCache.has('sheep')) return gibCache.get('sheep');
    const pal = { k: '#29212e', w: '#f5f2e8', g: '#cfc8b8', r: RED[3], b: RED[1], o: '#f4ecdc' };
    const parts = [
      { img: makeSprite(['.kkkk.', 'kwwwwk', 'kwwrrk', '.brrb.'], pal), s: 2.2, keep: true },
      { img: makeSprite(['.wwww.', 'wwggww', '.brrb.'], pal), s: 2, keep: false },
      { img: makeSprite(['.wwww.', 'wggggw', '.rbb..'], pal), s: 2, keep: false },
      { img: makeSprite(['r....o', 'rooooo', 'r....o'], pal), s: 2.2, keep: true },
    ];
    gibCache.set('sheep', parts);
    return parts;
  }

  function spawnBlood(G, ev) {
    const w = G.worms;
    if (!w) return;
    const st = ensureFx(w);
    const x = ev.x, y = ev.y, dmg = ev.dmg || 25;
    const dx = x - (ev.bx === undefined ? x : ev.bx), dy = y - (ev.by === undefined ? y + 8 : ev.by);
    const baseAng = Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) : -Math.PI / 2;

    if (ev.dmg && !ev.sheep && !ev.fall) {
      st.nums.push({ x, y: y - 16, text: '-' + Math.ceil(ev.dmg), age: 0, dur: 1.05, col: ev.dead ? '#ff4a55' : '#ffcb68' });
    }
    if (ev.fall) {
      for (let i = 0; i < 34; i++) {
        const a = -Math.PI * (0.15 + Math.random() * 0.7), sp = 90 + Math.random() * 240;
        st.drops.push({ x: x + (Math.random() - 0.5) * 16, y: FIELD.h - 8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sz: 2 + (i % 2), col: RED[2 + (i % 2)], age: 0 });
      }
      st.splashes.push({ x, age: 0 });
      return;
    }

    stainTerrain(x, y + 10, Math.min(24, 7 + dmg * 0.22));
    const dropCount = Math.min(80, (ev.dead || ev.sheep ? 46 : 10) + Math.round(dmg * 0.55));
    for (let i = 0; i < dropCount && st.drops.length < 450; i++) {
      const spread = (Math.random() - 0.5) * (ev.dead || ev.sheep ? Math.PI * 2 : 1.9);
      const a = baseAng + spread, sp = (45 + Math.random() * (ev.dead || ev.sheep ? 260 : 175));
      st.drops.push({
        x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (40 + Math.random() * 95),
        sz: Math.random() < 0.35 ? 3 : 2, col: RED[1 + (i % 3)], age: 0,
      });
    }
    const mistCount = ev.dead || ev.sheep ? 5 : dmg >= 25 ? 2 : 1;
    for (let i = 0; i < mistCount; i++) {
      st.mists.push({
        x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 10,
        r: (ev.dead || ev.sheep ? 18 : 10) + Math.random() * 8, age: 0, dur: 0.55 + Math.random() * 0.2,
        col: i % 2 ? RED[2] : RED[3],
      });
    }
    if (ev.dead || ev.sheep) {
      const list = ev.sheep ? sheepGibs() : wormGibs(ev.p);
      list.forEach(pt => {
        if (st.gibs.length >= 80) return;
        const a = baseAng + (Math.random() - 0.5) * 2.4, sp = 95 + Math.random() * 210;
        st.gibs.push({
          img: pt.img, s: pt.s, keep: pt.keep,
          x: x + (Math.random() - 0.5) * 8, y: y + (Math.random() - 0.5) * 8,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (90 + Math.random() * 140),
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 18,
          bleed: 0.55 + Math.random() * 0.5, rest: false, age: 0, life: pt.keep ? 14 : 3.2,
        });
      });
    }
  }

  function stepFx(w, dt) {
    const st = ensureFx(w);
    const G = 690;
    for (const d of st.drops) {
      const ox = d.x, oy = d.y;
      d.age += dt;
      d.vy += G * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.x < -8 || d.x > FIELD.w + 8 || d.y > FIELD.h + 12 || d.age > 3) { d.gone = true; continue; }
      const n = Math.max(1, Math.ceil(Math.hypot(d.x - ox, d.y - oy) / 3));
      for (let i = 1; i <= n; i++) {
        const px = ox + (d.x - ox) * i / n, py = oy + (d.y - oy) * i / n;
        if (BC.Worms.solid(w, px, py)) {
          stainTerrain(px, py, d.sz * (1.5 + Math.random() * 1.4));
          d.gone = true;
          break;
        }
      }
    }
    st.drops = st.drops.filter(d => !d.gone);

    for (const o of st.gibs) {
      o.age += dt;
      if (o.age >= o.life) { o.gone = true; continue; }
      if (o.rest) {
        if (BC.Worms.landing(w, o.x, o.y, o.y + 3) === Infinity) o.rest = false;
        else continue;
      }
      const ox = o.x, oy = o.y;
      o.vy += G * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rot += o.vr * dt;
      if (o.bleed > 0) {
        o.bleed -= dt;
        if (Math.random() < dt * 26 && st.drops.length < 450) {
          st.drops.push({ x: o.x, y: o.y, vx: (Math.random() - 0.5) * 45, vy: -20, sz: 2, col: RED[2], age: 0 });
        }
      }
      if (o.x < 4 || o.x > FIELD.w - 4) { o.x = BC.u.clamp(o.x, 4, FIELD.w - 4); o.vx *= -0.45; }
      if (o.y > FIELD.h + 16) { o.gone = true; continue; }
      if (BC.Worms.solid(w, o.x, o.y - 3) && !BC.Worms.solid(w, ox, oy - 3)) {
        o.x = ox; o.vx *= -0.45;
      }
      if (o.vy >= 0) {
        const ly = BC.Worms.landing(w, o.x, oy, o.y + 2);
        if (ly < Infinity) {
          o.y = ly;
          stainTerrain(o.x, ly, 4 + Math.random() * 4);
          if (o.vy > 135) {
            o.vy *= -0.34; o.vx *= 0.55; o.vr *= 0.5;
          } else {
            o.vy = 0; o.vx = 0; o.vr = 0;
            o.rot = Math.round(o.rot / (Math.PI / 2)) * (Math.PI / 2);
            o.rest = true;
            if (o.keep && map) {
              // Stamp keeper gibs onto solid terrain only if they rest on ground, plus keep live so craters drop them.
              stainTerrain(o.x, ly, 6);
            }
          }
        }
      }
    }
    st.gibs = st.gibs.filter(o => !o.gone);

    st.mists.forEach(m => { m.age += dt; m.y -= 18 * dt; });
    st.mists = st.mists.filter(m => m.age < m.dur);
    st.nums.forEach(n => { n.age += dt; n.y -= 24 * dt; });
    st.nums = st.nums.filter(n => n.age < n.dur);
    st.splashes.forEach(s => { s.age += dt; });
    st.splashes = st.splashes.filter(s => s.age < 0.55);

    // Blood trail left behind by moving heads/spines + periodic dripping from exposed ribcage.
    if (w.units) {
      for (const u of w.units) {
        if (u.hp <= 0) { st.tracks.delete(u.p); continue; }
        const prev = st.tracks.get(u.p);
        if (!prev) {
          st.tracks.set(u.p, { x: u.x, y: u.y, dist: 0, drip: 0.4 + Math.random() * 0.9 });
          continue;
        }
        prev.drip -= dt;
        if (prev.drip <= 0) {
          prev.drip = 0.55 + Math.random() * 1.1;
          if (st.drops.length < 450) {
            st.drops.push({
              x: u.x + u.face * (1 + Math.random() * 4), y: u.y - 12 - Math.random() * 5,
              vx: (Math.random() - 0.5) * 14, vy: 10 + Math.random() * 20,
              sz: 2, col: RED[1 + Math.floor(Math.random() * 3)], age: 0,
            });
          }
        }
        const moved = Math.hypot(u.x - prev.x, u.y - prev.y);
        if (moved > 0.2 && moved < 48) {
          prev.dist += moved;
          if (u.grounded) {
            if (prev.dist >= 4.5) {
              prev.dist %= 4.5;
              const tx = u.x - u.face * 5, ty = u.y + 1;
              stainTerrain(tx, ty, 3.8 + Math.random() * 2.2);
              for (let k = 0; k < 2 && st.drops.length < 450; k++) {
                st.drops.push({
                  x: tx + (Math.random() - 0.5) * 6, y: u.y - 2 - k * 4,
                  vx: -u.face * (16 + Math.random() * 34) + (Math.random() - 0.5) * 18,
                  vy: -(18 + Math.random() * 42),
                  sz: Math.random() < 0.38 ? 3 : 2, col: RED[1 + Math.floor(Math.random() * 3)], age: 0,
                });
              }
            }
          } else if (prev.dist >= 10) {
            prev.dist %= 10;
            if (st.drops.length < 450) {
              st.drops.push({
                x: u.x - u.face * 4 + (Math.random() - 0.5) * 4, y: u.y - 8,
                vx: -u.face * 14 + (Math.random() - 0.5) * 24, vy: 12,
                sz: Math.random() < 0.35 ? 3 : 2, col: RED[2 + Math.floor(Math.random() * 2)], age: 0,
              });
            }
          }
        }
        prev.x = u.x; prev.y = u.y;
      }
    }
  }

  function drawFxLayer(g, w) {
    const st = ensureFx(w);
    for (const m of st.mists) {
      const k = m.age / m.dur;
      g.save();
      g.globalAlpha = (1 - k) * 0.42;
      g.fillStyle = m.col;
      g.beginPath();
      g.arc(m.x, m.y, m.r * (0.45 + 0.65 * k), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    for (const o of st.gibs) {
      const gw = o.img.width * o.s, gh = o.img.height * o.s;
      const fade = o.life - o.age < 0.6 ? Math.max(0, (o.life - o.age) / 0.6) : 1;
      g.save();
      g.globalAlpha = fade;
      g.translate(Math.round(o.x), Math.round(o.y - gh * 0.35));
      g.rotate(o.rot);
      g.drawImage(o.img, Math.round(-gw / 2), Math.round(-gh / 2), Math.round(gw), Math.round(gh));
      g.restore();
    }
    for (const d of st.drops) {
      rect(g, d.x - d.sz / 2, d.y - d.sz / 2, d.sz, d.sz, d.col);
    }
    for (const s of st.splashes) {
      const k = s.age / 0.55;
      g.save();
      g.globalAlpha = 1 - k;
      for (let i = -3; i <= 3; i++) {
        rect(g, s.x + i * 7 * (0.4 + k) - 2, FIELD.h - 8 - Math.sin((1 - Math.abs(i) / 4) * Math.PI) * 28 * Math.sin(k * Math.PI), 4, 5, i % 2 ? RED[3] : '#9bd4e8');
      }
      g.restore();
    }
    for (const n of st.nums) {
      const a = Math.max(0, 1 - n.age / n.dur);
      R.text(n.text, Math.round(n.x), Math.round(n.y), { size: 9, align: 'center', color: n.col, outline: 3, outlineColor: ink, alpha: a });
    }
  }

  const BIOMES = [
    {
      name: 'GRASSLANDS',
      sky: ['#2a5d9e', '#3874b8', '#4d8ec8', '#68a7d6', '#88bfe0', '#abd5e8', '#cde7eb', '#e8f1df'],
      orb: ['#fff8c8', '#ffe38e'], hills: ['#4b7a78', '#355f5d'], cloud: 'rgba(255,255,255,0.28)',
      soil: ['#784c2e', '#633d24', '#51301c', '#3d2314'], rock: ['#8f6a48', '#362115'],
      sub: '#4a2c18', turf: '#3fa834', turfHi: '#7be054', border: '#261710',
      water: ['#1c5a8a', '#123e68', '#6ec4ea', '#3884b5'],
    },
    {
      name: 'HIGHLAND',
      sky: ['#414463', '#544e72', '#69577b', '#816485', '#a77385', '#c58887', '#e4a68f', '#f4c299'],
      orb: ['#ffe4ad', '#ffc995'], hills: ['#7d6377', '#564b63'], cloud: 'rgba(255,215,183,0.16)',
      soil: ['#5b5368', '#4b4458', '#3d3749', '#2f2a3a'], rock: ['#7a7086', '#25202e'],
      sub: '#47362b', turf: '#8e9c3a', turfHi: '#c5cf5c', border: '#1d1926',
      water: ['#182b44', '#102036', '#5e96b8', '#335d82'],
    },
    {
      name: 'CORAL ATOLL',
      sky: ['#1f6d8c', '#2b85a1', '#3d9db3', '#5cb4bf', '#85c9c5', '#b4dcc7', '#dfecc6', '#f7f0c6'],
      orb: ['#fff6bf', '#ffd97d'], hills: ['#568c87', '#3a6c6d'], cloud: 'rgba(255,252,235,0.26)',
      soil: ['#b86d43', '#9e5834', '#854628', '#6b361e'], rock: ['#d49162', '#572a16'],
      sub: '#8c5330', turf: '#d9b85b', turfHi: '#f5dc84', border: '#3d1f12',
      water: ['#14748c', '#0d5369', '#7ef0e6', '#2da8bd'],
    },
    {
      name: 'FROST FJORD',
      sky: ['#141c36', '#1c284a', '#263861', '#334b78', '#45628f', '#5c7ca6', '#7b9bbd', '#a3bed4'],
      orb: ['#f0f6ff', '#cadcf2'], hills: ['#455978', '#2d3e59'], cloud: 'rgba(220,238,255,0.18)',
      soil: ['#4b5c73', '#3d4c61', '#313e50', '#253040'], rock: ['#6c8099', '#1c2533'],
      sub: '#5e748c', turf: '#bfd8eb', turfHi: '#f2fbff', border: '#161f2c',
      water: ['#13263d', '#0b1829', '#8cc8e8', '#396487'],
    },
  ];

  // Rasterize a biome sky & distant horizon per map seed at half resolution.
  function backdrop(themeIdx, mapSeed) {
    const bm = BIOMES[themeIdx % BIOMES.length];
    const [cv, g] = A.canvas(480, 260);
    bm.sky.forEach((c, i) => rect(g, 0, i * 28, 480, 30, c));
    let seed = ((mapSeed || 8093) ^ 0x5bd1e995) >>> 0;
    const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * n); };
    const sunX = 95 + random(290), sunY = 54 + random(34);
    for (let y = -25; y <= 25; y++) {
      if (y > 5 && (y + 26) % 7 < 2) continue;
      const r = Math.floor(Math.sqrt(25 * 25 - y * y));
      rect(g, sunX - r, sunY + y, r * 2 + 1, 1, y < -5 ? bm.orb[0] : bm.orb[1]);
    }
    for (let i = 0; i < 42; i++) {
      const x = random(480), y = 12 + random(118), w = 10 + random(48);
      rect(g, x, y, w, 2 + random(3), bm.cloud);
      if (w > 24) rect(g, x + 5, y - 2, w - 10, 2, bm.cloud);
    }
    // Distant parallax mountain / island silhouettes
    const p1 = random(100) * 0.06, p2 = random(100) * 0.06;
    for (let x = 0; x < 480; x += 2) {
      const h1 = 152 + Math.round(Math.sin(x * 0.022 + p1) * 22 + Math.sin(x * 0.061 + p2) * 10);
      rect(g, x, h1, 2, 260 - h1, bm.hills[0]);
      const h2 = 178 + Math.round(Math.cos(x * 0.031 + p2) * 16 + Math.sin(x * 0.085 + p1) * 8);
      rect(g, x, h2, 2, 260 - h2, bm.hills[1]);
    }
    rect(g, 0, 214, 480, 46, bm.water[0]);
    for (let i = 0; i < 85; i++) rect(g, random(480), 216 + random(42), 4 + random(20), 1, bm.hills[0]);
    return cv;
  }

  function tile(g, col, row, x, y, w, h) {
    g.drawImage(A.img.industrial, col * 18, row * 18, 18, 18,
      Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function polygon(g, points) {
    g.beginPath();
    points.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
  }
  function terrain(g, t, bm, mapSeed) {
    const { x, y, w, h } = t;
    if (t.kind === 'land' && t.poly) {
      g.save();
      polygon(g, t.poly);
      g.clip();
      rect(g, x, y, w, h, bm.soil[0]);
      // Wavy geological soil/stone strata
      for (let sy = Math.floor(y / 18) * 18; sy < y + h; sy += 18) {
        const col = bm.soil[(Math.abs(Math.floor(sy / 18)) + 1) % bm.soil.length];
        for (let sx = Math.floor(x / 12) * 12; sx < x + w; sx += 12) {
          const wave = Math.round(Math.sin(sx * 0.045 + sy * 0.08) * 5);
          rect(g, sx, sy + wave, 12, 9, col);
        }
      }
      // Subsurface stones, pebbles, and dark crevices
      let s = ((mapSeed || 1) ^ Math.imul(Math.round(x + 17), 2246822519) ^ Math.imul(Math.round(y + 31), 3266489917)) >>> 0;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      const count = Math.min(180, Math.round((w * h) / 420));
      for (let i = 0; i < count; i++) {
        const rx = x + rnd() * w, ry = y + 8 + rnd() * Math.max(4, h - 8);
        const rw = 4 + Math.floor(rnd() * 8), rh = 2 + Math.floor(rnd() * 5);
        rect(g, rx, ry, rw, rh, rnd() < 0.55 ? bm.rock[0] : bm.rock[1]);
      }
      // Crisp dark cliff border inside the landmass
      polygon(g, t.poly);
      g.lineWidth = 5;
      g.strokeStyle = bm.border;
      g.stroke();

      // Classic Worms lush grass / moss / sand / snow top crust along `t.cap`
      if (t.cap && t.cap.length > 1) {
        for (let i = 0; i < t.cap.length - 1; i++) {
          const [ax, ay] = t.cap[i], [bx, by] = t.cap[i + 1];
          const seg = Math.max(1, Math.ceil(Math.abs(bx - ax) / 2));
          for (let k = 0; k < seg; k++) {
            const cx = ax + (bx - ax) * k / seg;
            const cy = ay + (by - ay) * k / seg;
            if (cy >= BC.Worms.WATER_Y + 2) continue;
            const fringe = ((Math.round(cx) * 7 + i * 3) % 5);
            rect(g, cx, cy + 5, 3, 5 + (fringe % 3), bm.sub);
            rect(g, cx, cy, 3, 6 + (fringe === 0 ? 2 : 0), bm.turf);
            rect(g, cx, cy, 3, 2 + (fringe % 2), bm.turfHi);
          }
        }
      }
      g.restore();
      // Subtle pixel grass tufts / snow crests right along the walkable ridge
      if (t.cap && t.cap.length > 1) {
        for (let i = 1; i < t.cap.length - 1; i++) {
          const [cx, cy] = t.cap[i];
          if (cy < BC.Worms.WATER_Y - 12 && (i % 2 === 0)) {
            rect(g, cx - 1, cy - 2, 2, 2, bm.turfHi);
          }
        }
      }
      return;
    }
    rect(g, x, y, w, h, '#394457');
    if (!A.ok.industrial) { rect(g, x, y, w, 3, gold); return; }
    const n = Math.max(1, Math.round(w / 27)), th = Math.min(h, 30);
    for (let i = 0; i < n; i++) {
      const l = Math.round(i * w / n), r = Math.round((i + 1) * w / n);
      const end = i === 0 ? 0 : i === n - 1 ? 2 : 1;
      if (h > th) tile(g, 4 + end, 6, x + l, y + th, r - l, h - th);
      tile(g, (w >= FIELD.w ? 7 : 4) + end, w >= FIELD.w ? 5 : 1, x + l, y, r - l, th);
    }
  }

  function battlefield(g, w) {
    const themeIdx = (w.theme || 0) % BIOMES.length;
    const bm = BIOMES[themeIdx];
    if (!map || map.terrain !== w.terrain || map.cuts > w.craters.length) {
      const [ground, fg] = A.canvas(FIELD.w, FIELD.h);
      w.terrain.forEach(t => terrain(fg, t, bm, w.mapSeed || 1));
      map = { terrain: w.terrain, ground, fg, cuts: 0 };
    }
    const px = BC.Worms.pixelSize;
    while (map.cuts < w.craters.length) {
      BC.Worms.cutColumns(w.craters[map.cuts++], (i, top, end) => map.fg.clearRect(i * px, top * px, px, (end - top) * px));
    }
    g.drawImage(map.ground, 0, 0);
  }

  function drawWindSky(g, w, time) {
    const wind = w.wind || 0;
    if (Math.abs(wind) < 0.05) return;
    g.save();
    g.globalAlpha = 0.28 + Math.abs(wind) * 0.32;
    const len = Math.max(4, Math.round(Math.abs(wind) * 14));
    for (let i = 0; i < 18; i++) {
      const speed = (60 + (i % 5) * 28) * wind;
      const x = (((i * 97 + time * speed) % FIELD.w) + FIELD.w) % FIELD.w;
      const y = 20 + ((i * 53 + Math.sin(time * 1.4 + i) * 6) % 240);
      rect(g, x, y, len, 2, i % 2 ? '#ffe4ad' : ice);
    }
    g.restore();
  }

  function drawWater(g, w, time, front) {
    const bm = BIOMES[(w.theme || 0) % BIOMES.length];
    const y0 = BC.Worms.WATER_Y;
    g.save();
    if (front) g.globalAlpha = 0.76;
    rect(g, 0, y0 + (front ? 2 : 0), FIELD.w, FIELD.h - y0, bm.water[0]);
    rect(g, 0, y0 + 7, FIELD.w, FIELD.h - y0 - 7, bm.water[1]);
    for (let x = 0; x < FIELD.w; x += 14) {
      const crest = Math.round(Math.sin(time * (front ? 4.2 : 2.8) + x * 0.075 + (front ? 1.4 : 0)) * 2);
      rect(g, x, y0 + crest, 10, 2, bm.water[2]);
      rect(g, x + 3, y0 + 5 - crest, 7, 1, bm.water[3]);
    }
    g.restore();
  }

  function weaponIcon(g, kind, x, y, size, facing) {
    g.save();
    g.translate(Math.round(x), Math.round(y));
    if (facing < 0) g.scale(-1, 1);
    if (kind === 'sheep') {
      // The board's own 14px sheep, including its face and hooves.
      g.scale(-1, 1);
      g.drawImage(BC.SpecialFx.sheepCanvas(), -size / 2, -size / 2, size, size);
    } else {
      g.scale(size / 16, size / 16);
      if (kind === 'drill') {
        rect(g, -8, -3, 10, 6, '#536375'); rect(g, -7, -3, 3, 6, '#e89647');
        for (let i = 0; i < 4; i++) rect(g, i * 2, i - 4, 2, 8 - i * 2, i % 2 ? ice : '#82b5c3');
      } else if (kind === 'holy') {
        // Yellow and white Holy Hand Grenade with a golden cross mounted on top
        rect(g, -2, -8, 4, 6, ink); rect(g, -4, -7, 8, 3, ink);
        rect(g, -1, -7, 2, 5, '#ffe66d'); rect(g, -3, -6, 6, 1, '#fff8bf');
        rect(g, -5, -2, 10, 9, ink); rect(g, -6, 0, 12, 5, ink);
        rect(g, -4, -1, 8, 7, '#fffdf0'); rect(g, -5, 1, 10, 3, '#fffdf0');
        rect(g, -5, 1, 10, 2, '#f5bd2e'); rect(g, -1, -1, 2, 7, '#ffe055');
        rect(g, -3, 0, 2, 2, '#ffffff');
      } else if (kind === 'shotgun') {
        rect(g, -8, -2, 16, 4, ink); rect(g, -8, 0, 6, 4, ink);
        rect(g, -7, 0, 5, 3, '#b56a38'); rect(g, -2, -1, 9, 2, '#9cb0c2');
        rect(g, -2, 1, 9, 1, '#58697a'); rect(g, 6, -1, 2, 2, gold);
      } else if (kind === 'mortar') {
        // Upright standing mortar on ground plate + bipod legs
        rect(g, -6, 5, 12, 3, ink); rect(g, -5, 6, 10, 1, '#6b7b8c');
        g.strokeStyle = ink; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(-4, 6); g.lineTo(-1, -1); g.moveTo(4, 6); g.lineTo(1, -1); g.stroke();
        g.save(); g.rotate(-0.22);
        rect(g, -3, -7, 6, 11, ink);
        rect(g, -2, -6, 4, 9, '#5c7a49'); rect(g, -1, -6, 1, 9, '#97bf6b');
        rect(g, -3, -8, 6, 2, gold);
        g.restore();
      } else if (kind === 'dynamite') {
        rect(g, -3, -4, 6, 11, ink);
        rect(g, -2, -3, 4, 9, '#e0343c'); rect(g, -2, -3, 1, 9, '#ff8e88');
        rect(g, -2, 0, 4, 2, ink);
        rect(g, 0, -7, 1, 3, '#c8c2b8');
        rect(g, -1, -8, 3, 2, gold); rect(g, 0, -8, 1, 1, '#ffffff');
      } else if (kind === 'cluster' || kind === 'pellet') {
        const pods = kind === 'pellet' ? [[0, 0]] : [[0, -4], [-4, 2], [4, 2]];
        for (const [px, py] of pods) {
          rect(g, px - 3, py - 3, 6, 6, '#733454'); rect(g, px - 2, py - 3, 4, 4, '#f791b8'); rect(g, px - 2, py - 3, 2, 1, ice);
        }
      } else if (kind === 'meteor') {
        rect(g, -6, -6, 4, 7, '#ec6846'); rect(g, -2, -8, 4, 9, '#ffa248');
        rect(g, -6, -3, 10, 9, '#bc4e39'); rect(g, -4, -4, 9, 8, '#fca649');
        rect(g, -2, -2, 6, 6, '#51415a'); rect(g, -2, -2, 4, 2, '#c58672');
        rect(g, 4, 0, 2, 4, '#a95850'); rect(g, 0, 4, 4, 2, '#ad6658');
      } else if (kind === 'grenade') {
        rect(g, -4, -5, 8, 11, ink); rect(g, -6, -2, 12, 6, ink);
        rect(g, -3, -4, 6, 9, '#50814c'); rect(g, -4, -2, 3, 4, '#9cc768');
        rect(g, -2, -7, 5, 3, '#c2ccd1'); rect(g, 2, -6, 3, 2, gold);
      } else {
        rect(g, -7, -3, 10, 6, ink); rect(g, 3, -2, 3, 4, ink); rect(g, 6, -1, 2, 2, ink);
        rect(g, -6, -5, 3, 10, ink); rect(g, -5, -4, 2, 8, '#d6664d');
        rect(g, -3, -2, 6, 4, '#98adc0'); rect(g, -3, -2, 6, 1, '#f2f1d8');
        rect(g, 3, -1, 3, 2, '#f39060');
      }
    }
    g.restore();
  }
  function crate(g, q) {
    const x = Math.round(q.x), y = Math.round(q.y);
    if (q.flying) {
      rect(g, x - 12, y - 27, 24, 4, ice); rect(g, x - 17, y - 23, 34, 4, '#e78f67');
      for (let i = 0; i < 7; i++) {
        rect(g, x - 16 + i, y - 19 + 2 * i, 1, 3, ice);
        rect(g, x + 15 - i, y - 19 + 2 * i, 1, 3, ice);
      }
    }
    rect(g, x - 11, y - 10, 22, 20, ink);
    if (A.ok.industrial) tile(g, 13, 3, x - 11, y - 10, 22, 20);
    else rect(g, x - 9, y - 8, 18, 16, '#648d9e');
    if (q.kind === 'health') {
      rect(g, x - 5, y - 1, 10, 4, '#ffebdd'); rect(g, x - 2, y - 4, 4, 10, '#ffebdd');
    } else {
      // Mystery weapon crate star badge
      rect(g, x - 6, y - 2, 12, 4, ink); rect(g, x - 2, y - 6, 4, 12, ink);
      rect(g, x - 5, y - 1, 10, 2, gold); rect(g, x - 1, y - 5, 2, 10, gold);
      rect(g, x - 2, y - 2, 4, 4, '#fff8cf');
    }
  }

  const wormFrames = new Map();
  const SPINE_PAL = {
    k: '#140c14', w: '#ffffff', o: '#ece2cf', s: '#bdb09c',
    R: '#ff2b3a', r: '#c41220', m: '#7a0a14',
  };
  // 28x32 pixel poses: Bomberman head + vertical segmented spine + 6 compact barrel ribs
  // (3 clearly separated ribs on each side, curving inward around the torso).
  // Grounded bends the lower spine along the ground; mid-air hangs the spine straight down.
  const SPINE_POSES = {
    idle: {
      hx: 11, hy: 1, hs: 10, sy: 10,
      rows: [
        '..............kkrwk.........',
        '...........kkkkwwokkkk......',
        '..........kwoR.krok.Rwwk....',
        '...........kkkkkwwokkkk.....',
        '..............krok..........',
        '..........kkkkkwwokkkkk.....',
        '.........kwoR..krok..Rwwk...',
        '..........kkkkkkwwokkkkk....',
        '..............krok..........',
        '...........kkkkwwokkkk......',
        '..........kwoR.krok.Rwwk....',
        '...........kkkkkwwokkkk.....',
        '..............krok..........',
        '..............kwwok.........',
        '.............krwook.........',
        '..........kkkwwok...........',
        '.....kkkkkwoorok............',
        '.kkkkwookkwookk.............',
        'krwookwookwook..............',
        'kRmmkkrmkkrmk...............',
      ],
    },
    step: {
      hx: 12, hy: 2, hs: 10, sy: 11,
      rows: [
        '...............kkrwk........',
        '............kkkkwwokkkk.....',
        '...........kwoR.krok.Rwwk...',
        '............kkkkkwwokkkk....',
        '...............krok.........',
        '...........kkkkkwwokkkkk....',
        '..........kwoR..krok..Rwwk..',
        '...........kkkkkkwwokkkkk...',
        '...............krok.........',
        '............kkkkwwokkkk.....',
        '...........kwoR.krok.Rwwk...',
        '............kkkkkwwokkkk....',
        '...............krok.........',
        '...............kwwok........',
        '.........kkkk.krook.........',
        '......kkkwookkwwok..........',
        '...kkkwook..krwook..........',
        '..krwook....kwwok...........',
        '..kRmmk......krmk...........',
        '...kkk........kkk...........',
      ],
    },
    jump: {
      hx: 11, hy: 0, hs: 10, sy: 9,
      rows: [
        '..............kkrwk.........',
        '...........kkkkwwokkkk......',
        '..........kwoR.krok.Rwwk....',
        '...........kkkkkwwokkkk.....',
        '..............krok..........',
        '..........kkkkkwwokkkkk.....',
        '.........kwoR..krok..Rwwk...',
        '..........kkkkkkwwokkkkk....',
        '..............krok..........',
        '...........kkkkwwokkkk......',
        '..........kwoR.krok.Rwwk....',
        '...........kkkkkwwokkkk.....',
        '..............krok..........',
        '..............kwwk..........',
        '..............krok..........',
        '...............kkk..........',
        '..............krwk..........',
        '..............kwok..........',
        '...............kk...........',
        '...............kwk..........',
        '...............krk..........',
        '...............kk...........',
        '................k...........',
      ],
    },
  };

  function wormFrame(p, pose) {
    const key = p + ':' + pose;
    if (wormFrames.has(key)) return wormFrames.get(key);
    const [cv, g] = A.canvas(28, 32);
    const spec = SPINE_POSES[pose] || SPINE_POSES.idle;
    spec.rows.forEach((row, i) => {
      for (let j = 0; j < row.length; j++) {
        if (SPINE_PAL[row[j]]) rect(g, j, spec.sy + i, 1, 1, SPINE_PAL[row[j]]);
      }
    });
    g.drawImage(headSprite(p), spec.hx, spec.hy, spec.hs, spec.hs);
    if (A.ready && A.ok.sheet) wormFrames.set(key, cv);
    return cv;
  }
  function drawWorm(g, u, x, y, w, h, time, staticPose) {
    let pose = 'idle';
    if (!staticPose) {
      if (!u.grounded) pose = 'jump';
      else if (Math.floor(u.x / 5 + time * 1.4 + u.p) % 4 === 1) pose = 'step';
    }
    g.save();
    g.translate(Math.round(x), Math.round(y));
    if (u.face < 0) g.scale(-1, 1);
    g.drawImage(wormFrame(u.p, pose), -w / 2, -h, w, h);
    g.restore();
  }

  function powerColor(t) {
    return t < 0.38 ? '#86e868' : t < 0.72 ? gold : t < 0.9 ? '#ff844b' : '#ff3d4d';
  }

  function drawStandingMortar(g, mx, my, dx, dy, showArc) {
    const px = Math.round(mx), py = Math.round(my);
    if (showArc) {
      // Subtle upright left/right firing sector guide around vertical
      g.save();
      g.globalAlpha = 0.34;
      for (const lim of [-0.47, 0.47]) {
        const lx = lim, ly = -Math.sqrt(1 - lim * lim);
        for (let r = 20; r <= 34; r += 7) rect(g, px + lx * r - 1, py - 4 + ly * r - 1, 2, 2, ice);
      }
      g.restore();
    }
    // Ground baseplate
    rect(g, px - 8, py - 3, 16, 4, ink);
    rect(g, px - 6, py - 2, 12, 2, '#697b8c');
    // Pivoting upright mortar barrel
    g.save();
    g.translate(px, py - 4);
    g.rotate(Math.atan2(dy, dx));
    rect(g, -2, -5, 21, 10, ink);
    rect(g, 0, -4, 17, 8, '#5c7a49');
    rect(g, 0, -3, 16, 2, '#97bf6b');
    rect(g, 16, -5, 4, 10, gold);
    rect(g, 18, -3, 2, 6, ink);
    g.restore();
    // Front bipod legs bracing the tube onto the ground plate
    g.save();
    g.strokeStyle = ink; g.lineWidth = 3;
    g.beginPath();
    g.moveTo(px - 6, py - 1); g.lineTo(px + dx * 7 - 2, py - 4 + dy * 7);
    g.moveTo(px + 6, py - 1); g.lineTo(px + dx * 7 + 2, py - 4 + dy * 7);
    g.stroke();
    g.strokeStyle = '#8fa3b5'; g.lineWidth = 1.2;
    g.stroke();
    g.restore();
  }

  function drawMuzzleFlash(g, m) {
    const k = Math.min(1, m.age / 0.22);
    g.save();
    g.translate(m.x, m.y);
    g.rotate(Math.atan2(m.ay, m.ax));
    if (k < 0.65) {
      const s = 1 - k / 0.65;
      g.globalAlpha = 0.95;
      // Jagged pixel star-cone flash
      rect(g, -2, -7 * s, 12 * s + 4, 14 * s, '#ff8438');
      rect(g, 0, -5 * s, 16 * s + 4, 10 * s, '#ffe46b');
      rect(g, 0, -2.5 * s, 11 * s + 3, 5 * s, '#ffffff');
      rect(g, 4, -10 * s, 3, 20 * s, '#ffe46b');
    }
    // Gunsmoke puffs drifting forward from the barrel
    g.globalAlpha = (1 - k) * 0.55;
    for (let i = 0; i < 3; i++) {
      const dist = 6 + i * 7 + k * 16;
      const spread = (i - 1) * (3 + k * 6);
      const sz = 4 + i * 2;
      rect(g, dist, spread - sz / 2, sz, sz, i === 0 ? '#fff6d6' : '#c7d3dc');
    }
    g.restore();
  }

  function drawHeldWeapon(g, w, u, x, y) {
    const dx = Math.cos(u.angle) * u.face, dy = -Math.sin(u.angle);
    let cx = x, cy = y - 14;
    if (u.weapon === 'mortar') {
      const mb = BC.Worms.mortarBase(w, u);
      drawStandingMortar(g, mb.x, mb.y, dx, dy, true);
      cx = mb.x;
      cy = mb.y - 4;
    } else {
      g.save();
      g.translate(cx, cy);
      if (u.weapon === 'rocket' || u.weapon === 'drill' || u.weapon === 'shotgun') {
        g.rotate(Math.atan2(dy, dx));
        if (u.weapon === 'shotgun') {
          rect(g, -3, -3, 22, 6, ink);
          rect(g, -2, -1, 6, 3, '#b56a38');
          rect(g, 4, -2, 14, 3, '#9cb0c2');
          rect(g, 16, -2, 2, 3, gold);
        } else {
          rect(g, -2, -4, 21, 8, ink);
          rect(g, 0, -3, 16, 6, u.weapon === 'drill' ? '#5e7387' : '#8294a0');
          rect(g, 16, -4, 4, 8, u.weapon === 'drill' ? '#e89647' : gold);
        }
      } else {
        weaponIcon(g, u.weapon, dx * 10, dy * 10, 17, u.face);
      }
      g.restore();
    }

    // Meteor target beacon on the skyline so orbital range is visible right in the arena.
    if (u.weapon === 'meteor') {
      const pwr = w.charging ? w.charge : (u.lastPower || 0.45);
      const tx = BC.u.clamp(u.x + u.face * (54 + 786 * pwr), 16, FIELD.w - 16);
      const ty = Math.min(FIELD.h - 14, BC.Worms.landing(w, tx, 0, FIELD.h));
      g.save();
      g.globalAlpha = w.charging ? 0.85 : 0.45;
      for (let yy = 8; yy < ty - 6; yy += 12) rect(g, tx - 1, yy, 2, 6, w.charging ? '#ff6b4a' : gold);
      rect(g, tx - 8, ty - 2, 16, 3, '#ff6b4a');
      rect(g, tx - 2, ty - 8, 4, 12, '#ff6b4a');
      g.restore();
    }

    // Classic Worms growing power cone along the aim line + crisp crosshair reticle.
    const power = BC.u.clamp(w.charge || 0, 0, 1);
    if (power > 0) {
      const blobs = 10, active = Math.max(1, Math.ceil(power * blobs));
      for (let i = 0; i < active; i++) {
        const t = (i + 1) / blobs;
        const dist = 20 + t * 38;
        const sz = Math.round(3 + t * 6);
        const px = cx + dx * dist, py = cy + dy * dist;
        rect(g, px - sz / 2 - 1, py - sz / 2 - 1, sz + 2, sz + 2, ink);
        rect(g, px - sz / 2, py - sz / 2, sz, sz, powerColor(t));
      }
    } else {
      for (let k = 24; k <= 38; k += 7) rect(g, cx + dx * k - 1, cy + dy * k - 1, 3, 3, gold);
    }
    const rx = Math.round(cx + dx * 52), ry = Math.round(cy + dy * 52);
    rect(g, rx - 6, ry - 1, 4, 3, ink); rect(g, rx + 3, ry - 1, 4, 3, ink);
    rect(g, rx - 1, ry - 6, 3, 4, ink); rect(g, rx - 1, ry + 3, 3, 4, ink);
    rect(g, rx - 5, ry, 3, 1, gold); rect(g, rx + 3, ry, 3, 1, gold);
    rect(g, rx, ry - 5, 1, 3, gold); rect(g, rx, ry + 3, 1, 3, gold);
  }

  // Drawn on top of all worms so the active worm's local HUD is never occluded.
  function drawLocalHud(g, G, w, u) {
    if (!u || u.hp <= 0) return;
    const x = Math.round(u.x), y = Math.round(u.y);
    const retreating = (w.phase === 'shot' || w.phase === 'settle') && w.retreat > 0 && !u.hurt;
    const aiming = w.phase === 'aim';
    if (!aiming && !retreating) return;

    if (retreating) {
      const bw = 78, bh = 16;
      const bx = BC.u.clamp(x - bw / 2, 6, FIELD.w - bw - 6);
      const by = y > 74 ? y - 66 : y + 8;
      rect(g, bx - 1, by - 1, bw + 2, bh + 2, ink);
      rect(g, bx, by, bw, bh, '#1d2d3d');
      const fill = Math.round((bw - 4) * BC.u.clamp(w.retreat / 3, 0, 1));
      rect(g, bx + 2, by + 11, bw - 4, 3, '#101822');
      rect(g, bx + 2, by + 11, fill, 3, '#86e868');
      text('FLEE ' + w.retreat.toFixed(1) + 's', bx + bw / 2, by + 2, 7, '#b8ff8a', 'center');
      return;
    }

    // 1. Compact Strength / Charge bar anchored right beneath the worm's feet (or INSTANT tag for Shotgun).
    const pw = 88, ph = 13;
    const px = BC.u.clamp(x - pw / 2, 6, FIELD.w - pw - 6);
    const py = y < FIELD.h - 24 ? y + 6 : y - 66;
    rect(g, px - 1, py - 1, pw + 2, ph + 2, ink);
    rect(g, px, py, pw, ph, '#172331');
    if (u.weapon === 'shotgun') {
      text('CLICK: SNAP SHOT', px + pw / 2, py + 3, 6, gold, 'center');
    } else {
      const power = BC.u.clamp(w.charge || 0, 0, 1);
      const barW = pw - 32;
      rect(g, px + 3, py + 3, barW, ph - 6, '#0d1520');
      const segs = 12, lit = Math.ceil(power * segs);
      for (let i = 0; i < segs; i++) {
        const sx = px + 4 + i * Math.floor(barW / segs);
        if (i < lit) rect(g, sx, py + 4, 3, ph - 8, powerColor((i + 1) / segs));
      }
      if (u.lastPower > 0) {
        const lx = px + 3 + Math.round(u.lastPower * (barW - 2));
        rect(g, lx, py + 1, 2, ph - 2, '#ffffff');
      }
      text(power > 0 ? Math.round(power * 100) + '%' : (u.lastPower > 0 ? Math.round(u.lastPower * 100) + '%' : 'PWR'),
        px + pw - 3, py + 3, 7, power > 0 ? gold : muted, 'right');
    }

    // 2. Single-weapon Floating Pill: only appears when toggling weapons with Q or Mouse Wheel (or unboxing a crate).
    if ((w.weaponCue || 0) > 0 && !w.charging) {
      const avail = BC.Worms.available(u);
      const idx = Math.max(0, avail.indexOf(u.weapon));
      const pt = BC.Worms.WEAPON_PIECE[u.weapon];
      const crateOnly = !u.weapons.includes(u.weapon) && (u.ammo[u.weapon] || 0) > 0;
      const wName = names[u.weapon] || 'WEAPON';
      const subTxt = w.standalone
        ? (crateOnly ? 'x' + u.ammo[u.weapon] + ' LEFT  ' : 'INF  ') + (idx + 1) + '/' + avail.length
        : crateOnly || !pt ? 'CRATE x' + (u.ammo[u.weapon] || 1) : shortPiece[pt] + ' ' + (idx + 1) + '/' + avail.length;
      const sw = Math.max(108, 38 + Math.max(R.measure(wName, 8), R.measure(subTxt, 6)) + 10);
      const sh = 32;
      const wx = BC.u.clamp(x - sw / 2, 6, FIELD.w - sw - 6);
      const wy = y >= 88 ? y - 84 : Math.min(FIELD.h - sh - 6, py + ph + 6);
      const alpha = BC.u.clamp(w.weaponCue / 0.3, 0, 1);

      g.save();
      g.globalAlpha = alpha;
      rect(g, wx - 2, wy - 2, sw + 4, sh + 4, ink);
      rect(g, wx - 1, wy - 1, sw + 2, sh + 2, BC.PLAYER_COLORS[u.p] || gold);
      rect(g, wx, wy, sw, sh, '#162231');

      const sx = wx + 4, sy = wy + 4, slot = 24;
      rect(g, sx - 1, sy - 1, slot + 2, slot + 2, gold);
      rect(g, sx, sy, slot, slot, '#2b435c');
      weaponIcon(g, u.weapon, sx + slot / 2 + 1, sy + slot / 2 + 1, 16, 1);
      if (!w.standalone && pt) {
        const pImg = R.pieceImg({ t: pt, o: u.p });
        if (pImg) g.drawImage(pImg, sx + 1, sy + 1, 9, 9);
      }

      R.text(wName, wx + 34, wy + 6, { size: 8, color: gold, shadow: false, alpha });
      R.text(subTxt, wx + 34, wy + 19, { size: 6, color: crateOnly ? gold : muted, shadow: false, alpha });

      const tipX = BC.u.clamp(x, wx + 10, wx + sw - 10);
      if (wy < y) {
        for (let i = 0; i < 4; i++) rect(g, tipX - 3 + i, wy + sh + i, 7 - i * 2, 1, BC.PLAYER_COLORS[u.p] || gold);
      } else {
        for (let i = 0; i < 4; i++) rect(g, tipX - 3 + i, wy - 2 - i, 7 - i * 2, 1, BC.PLAYER_COLORS[u.p] || gold);
      }
      g.restore();
    }
  }

  function fighter(g, G, w, u) {
    if (u.hp <= 0) return;
    const active = u.p === w.active && w.phase === 'aim', c = BC.PLAYER_COLORS[u.p];
    const x = Math.round(u.x), y = Math.round(u.y);
    drawWorm(g, u, x, y, 42, 48, G.time, false);
    if (active) drawHeldWeapon(g, w, u, x, y);
    const bx = Math.min(FIELD.w - 37, Math.max(1, x - 18));
    rect(g, bx, y - 63, 36, 14, ink);
    rect(g, bx + 2, y - 52, 32, 2, '#243242');
    rect(g, bx + 2, y - 52, 32 * Math.max(0, u.hp / 100), 2, c);
    text(BC.PLAYER_NAMES[u.p] + ' ' + Math.ceil(u.hp), bx + 18, y - 61, 6, active ? gold : ice, 'center');
  }

  function drawHeavenlyLight(g, q) {
    const t = Math.max(0, q.age - (BC.Worms.HOLY_CHOIR_AT || 2.25));
    const open = Math.min(1, t / 0.25);
    const x = Math.round(q.x), y = Math.round(q.y);
    g.save();
    // Celestial beam descending from heaven
    g.globalAlpha = 0.24 * open;
    rect(g, x - 26 * open, 0, 52 * open, y + 14, '#fff3a1');
    g.globalAlpha = 0.38 * open;
    rect(g, x - 14 * open, 0, 28 * open, y + 12, '#fffbe0');
    g.globalAlpha = 0.55 * open;
    rect(g, x - 5 * open, 0, 10 * open, y + 8, '#ffffff');
    // Pulsing golden halo & radiant rays behind the levitating Holy Hand Grenade
    const pulse = 1 + 0.14 * Math.sin(t * 16);
    g.globalAlpha = 0.72 * open;
    g.strokeStyle = '#ffe97d';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 18 * pulse, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.45 * open;
    g.beginPath(); g.arc(x, y, 27 * pulse, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + t * 1.1;
      const r1 = 13, r2 = 24 + (i % 2) * 7;
      rect(g, x + Math.cos(a) * r1 - 1, y + Math.sin(a) * r1 - 1, 3, 3, '#fffdf0');
      rect(g, x + Math.cos(a) * r2 - 1, y + Math.sin(a) * r2 - 1, 2, 2, '#ffe066');
    }
    // Rising golden motes in the shaft of light
    for (let i = 0; i < 9; i++) {
      const mx = x + Math.sin(i * 2.1 + t * 3) * 16;
      const my = y + 6 - (((t * 58 + i * 23) % 96));
      rect(g, mx - 1, my, 2, 3, i % 2 ? '#ffffff' : '#ffe36e');
    }
    g.restore();
    R.text('HALLELUJAH!', x, Math.max(12, y - 34), {
      size: 8, align: 'center', color: '#fff7b2', outline: 3, outlineColor: ink, alpha: open,
    });
  }

  function drawMortarShell(g) {
    rect(g, -7, -3, 3, 6, ink); rect(g, -6, -2, 2, 4, '#d97848');
    rect(g, -4, -4, 9, 8, ink); rect(g, 4, -3, 4, 6, ink);
    rect(g, -3, -3, 7, 6, '#5c7a49'); rect(g, -2, -2, 5, 2, '#97bf6b');
    rect(g, 4, -2, 3, 4, gold);
  }

  function drawShot(g, q) {
    if (q.y < 2) {
      const mx = BC.u.clamp(Math.round(q.x), 12, FIELD.w - 12);
      for (let i = 0; i < 5; i++) rect(g, mx - i, 3 + i, i * 2 + 1, 1, gold);
      R.text(Math.round(-q.y) + 'm', mx, 10, { size: 6, align: 'center', color: gold, outline: 2, outlineColor: ink });
      return;
    }
    if (q.kind === 'holy' && q.holyChoir) drawHeavenlyLight(g, q);
    const ang = Math.atan2(q.vy, q.vx);
    if (q.kind === 'rocket' || q.kind === 'meteor' || q.kind === 'mortar') {
      for (let j = 1; j <= 4; j++) rect(g, q.x - Math.cos(ang) * (8 + j * 4), q.y - Math.sin(ang) * (8 + j * 4), 6 - j, 6 - j, j < 3 ? gold : '#bd8d86');
    }
    g.save(); g.translate(Math.round(q.x), Math.round(q.y));
    if (q.kind === 'mortar') {
      g.rotate(ang);
      drawMortarShell(g);
    } else {
      if (q.kind === 'rocket' || q.kind === 'drill') g.rotate(ang);
      else if (q.kind === 'holy' && !q.holyChoir) g.rotate(q.age * 5.5);
      const sz = q.kind === 'sheep' || q.kind === 'meteor' ? 28 : q.kind === 'holy' ? 22 : 18;
      weaponIcon(g, q.kind, 0, 0, sz, q.kind === 'sheep' ? Math.sign(q.vx) : 1);
    }
    g.restore();
    if ((q.kind === 'grenade' || q.kind === 'sheep' || q.kind === 'cluster' || q.kind === 'dynamite' || q.kind === 'holy') && !q.holyChoir) {
      const rem = Math.max(1, Math.ceil((BC.Worms.fuses[q.kind] || 3) - q.age));
      R.text(String(rem), Math.round(q.x), Math.round(q.y - 18), {
        size: 8, align: 'center', color: rem <= 1 ? '#ff645a' : '#ffffff', outline: 3, outlineColor: ink,
      });
    }
  }
  function drawBlast(g, b) {
    const dur = b.kind === 'holy' ? 0.65 : 0.5;
    const k = Math.min(1, Math.max(0, b.age / dur)), r = b.r * Math.min(1, 0.18 + k * 2.8);
    const cols = b.kind === 'holy' ? ['#ffffff', '#fff3a8', '#ffd24a'] : ['#fff0c1', '#ffbc57', '#e66b51'];
    g.save(); g.globalAlpha = 1 - k;
    for (let j = 0; j < 18; j++) {
      const a = j * Math.PI / 9, d = r * (0.87 + (j % 3) * .06);
      rect(g, b.x + d * Math.cos(a) - 3, b.y + d * Math.sin(a) - 3, 6, 6, b.kind === 'holy' ? '#fffbe0' : gold);
    }
    for (let i = 3; i > 0; i--) {
      const rad = Math.max(2, r * (1 - k) * i / 3);
      for (let y = -Math.floor(rad / 4) * 4; y <= rad; y += 4) {
        const h = Math.round(Math.sqrt(Math.max(0, rad * rad - y * y)) / 3) * 3;
        rect(g, b.x - h, b.y + y, h * 2, 4, cols[i - 1]);
      }
    }
    g.restore();
  }

  function drawWindGauge(g, x, y, width, wind) {
    text('WIND', x, y + 1, 8, muted);
    const bx = x + 48, bw = width - 48, mid = bx + Math.round(bw / 2);
    rect(g, bx, y, bw, 11, ink);
    rect(g, bx + 1, y + 1, bw - 2, 9, '#14202e');
    const mag = Math.round(Math.abs(wind || 0) * (bw / 2 - 3));
    if (mag > 0) {
      const col = Math.abs(wind) > 0.65 ? '#ff8b65' : '#7fd8ff';
      if (wind < 0) rect(g, mid - mag, y + 2, mag, 7, col);
      else rect(g, mid, y + 2, mag, 7, col);
    }
    rect(g, mid, y, 2, 11, ice);
  }

  function sidebar(g, G, w, unit) {
    const x = 1004, l = x + 16, width = 252, inner = width - 32;
    plate(g, x, FIELD.y, width, FIELD.h);
    text('01 / WIND & AIM', l, 94, 9, muted);
    drawWindGauge(g, l, 110, inner, w.wind || 0);
    if (unit) {
      const deg = Math.round(unit.angle * 180 / Math.PI);
      const power = BC.u.clamp(w.charge || 0, 0, 1);
      text('AIM ' + (deg >= 0 ? '+' : '') + deg + '\u00b0', l, 131, 8, ice);
      text('PWR ' + Math.round(power * 100) + '%', x + width - 16, 131, 8, power ? gold : ice, 'right');
      for (let i = 0; i < 18; i++) {
        rect(g, l + i * 12, 145, 10, 8, i < Math.ceil(power * 18) ? powerColor((i + 1) / 18) : '#2a3b4c');
      }
    }
    rect(g, l, 161, inner, 2, line);
    text(w.standalone ? '02 / ARSENAL & BOXES' : '02 / PIECE ARSENAL & BOXES', l, 168, 8, muted);
    if (unit) {
      const avail = BC.Worms.available(unit);
      const cw = 106, ch = 25;
      BC.Worms.PIECE_ORDER.forEach((pt, idx) => {
        const kind = BC.Worms.PIECE_WEAPON[pt];
        const col = idx % 2, row = Math.floor(idx / 2);
        const cx = l + col * (cw + 8), cy = 181 + row * (ch + 3);
        const hasPiece = unit.weapons && unit.weapons.includes(kind);
        const hasCrate = !hasPiece && (unit.ammo[kind] || 0) > 0;
        const unlocked = avail.includes(kind);
        const sel = unlocked && unit.weapon === kind;
        rect(g, cx, cy, cw, ch, sel ? gold : unlocked ? '#395068' : '#223040');
        rect(g, cx + 1, cy + 1, cw - 2, ch - 2, sel ? '#293e54' : unlocked ? '#162332' : '#121a26');
        g.save();
        if (!unlocked) g.globalAlpha = 0.28;
        if (w.standalone) {
          weaponIcon(g, kind, cx + 15, cy + 12, 16, 1);
        } else {
          const pImg = R.pieceImg({ t: pt, o: unit.p });
          if (pImg) g.drawImage(pImg, cx + 3, cy + 3, 18, 18);
          else text(pt, cx + 8, cy + 7, 8, ice);
          weaponIcon(g, kind, cx + 30, cy + 12, 13, 1);
        }
        g.restore();
        const tx = w.standalone ? cx + 29 : cx + 40;
        text(names[kind], tx, cy + 4, 6, sel ? gold : unlocked ? ice : '#536577');
        const sub = w.standalone
          ? (hasPiece ? 'INF' : hasCrate ? 'x' + unit.ammo[kind] : 'OUT')
          : (hasPiece ? shortPiece[pt] : 'NO ' + shortPiece[pt]);
        text(sub, tx, cy + 14, 5, hasPiece ? muted : hasCrate ? gold : '#495a6b');
        if (unlocked && w.phase === 'aim') {
          weaponHits.push({ kind, x: cx, y: cy, w: cw, h: ch });
        }
      });
      // Crate-only superweapons row (Cluster, Sheep, Meteor, Holy Hand Grenade)
      const crateList = BC.Worms.CRATE_WEAPONS || ['cluster', 'sheep', 'meteor', 'holy'];
      const bw = 51, bh = 31, gap = 5, by = 268;
      crateList.forEach((kind, idx) => {
        const bx = l + idx * (bw + gap);
        const cnt = unit.ammo[kind] || 0;
        const unlocked = cnt > 0;
        const sel = unlocked && unit.weapon === kind;
        rect(g, bx, by, bw, bh, sel ? gold : unlocked ? '#5e5034' : '#1d2938');
        rect(g, bx + 1, by + 1, bw - 2, bh - 2, sel ? '#2f4359' : unlocked ? '#1c2838' : '#111924');
        g.save();
        if (!unlocked) g.globalAlpha = 0.25;
        weaponIcon(g, kind, bx + 15, by + 15, 16, 1);
        g.restore();
        text(cnt > 0 ? 'x' + cnt : 'BOX', bx + bw - 4, by + 11, 6, sel || cnt > 0 ? gold : '#435466', 'right');
        if (unlocked && w.phase === 'aim') {
          weaponHits.push({ kind, x: bx, y: by, w: bw, h: bh });
        }
      });
    }
    rect(g, l, 304, inner, 2, line);
    text('03 / CREW STATUS', l, 313, 9, muted);
    w.units.forEach((u, i) => {
      const y = 330 + 44 * i, c = BC.PLAYER_COLORS[u.p], active = w.active === u.p;
      rect(g, l, y, inner, 38, active ? '#314253' : '#182331');
      rect(g, l, y, 3, 38, active ? gold : '#394a59');
      drawWorm(g, u, l + 22, y + 34, 26, 30, G.time, true);
      text(BC.PLAYER_NAMES[u.p], l + 40, y + 6, 10, c);
      const count = BC.Worms.available(u).length;
      text(count + ' WPN', l + 82, y + 8, 7, muted);
      text(u.hp > 0 ? Math.ceil(u.hp) + ' HP' : 'OUT', l + inner - 7, y + 7, 8, u.hp > 0 ? ice : muted, 'right');
      rect(g, l + 40, y + 25, 172, 5, ink);
      rect(g, l + 40, y + 25, 172 * BC.u.clamp(u.hp / 100, 0, 1), 5, c);
    });
    text(w.maxTurns > 100 ? 'WIN RULE' : 'TURN LIMIT', l, 574, 8, muted);
    text(w.maxTurns > 100 ? 'LAST STANDING' : w.maxTurns + ' / SEAT', x + width - 16, 573, 9, ice, 'right');
  }

  function controls(g, standalone) {
    const top = 622, bottom = 700;
    plate(g, 24, top, 960, bottom - top);
    text('CONTROLS', 38, 638, 10, gold);
    text('GAMEPAD', 38, 673, 8, muted);
    const cells = [
      [148, 'A/D OR \u2190/\u2192', 'WALK & FLEE', 'PAD \u2190/\u2192'],
      [324, 'W/S OR MOUSE', 'AIM ANGLE', 'PAD \u2191/\u2193'],
      [488, 'SPACE (x2)', 'JUMP / BACKFLIP', 'A BUTTON'],
      [648, 'Q / SCROLL', standalone ? 'SELECT WEAPON' : 'PIECE WEAPON', 'Y / WHEEL'],
      [800, 'LEFT CLICK', 'CHARGE / DETONATE', 'X BUTTON'],
    ];
    for (const [x, key, action, pad] of cells) {
      rect(g, x - 10, top + 12, 1, 53, line);
      text(key, x, 634, 10, ice);
      text(action, x, 654, 8, gold);
      text(pad, x, 676, 7, muted);
    }
  }

  function weaponAt(mx, my) {
    const hit = weaponHits.find(r => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
    return hit ? hit.kind : '';
  }

  function draw(G) {
    const w = G.worms, g = R.ctx;
    if (!w) return;
    const dt = Math.min(0.05, Math.max(0, G.time - (lastDrawT || G.time)));
    lastDrawT = G.time;
    weaponHits = [];
    g.save(); g.imageSmoothingEnabled = false;
    rect(g, 0, 0, BC.W, BC.H, ink);
    const unit = w.units.find(u => u.p === w.active), accent = BC.PLAYER_COLORS[w.active] || gold;
    const retreating = unit && (w.phase === 'shot' || w.phase === 'settle') && w.retreat > 0 && !unit.hurt;
    const bm = BIOMES[(w.theme || 0) % BIOMES.length];
    rect(g, 24, 18, 5, 45, gold);
    text(w.standalone ? 'SPINES  /  LAST SPINE STANDING' : 'BOMBER CHESS  /  PIECE ARTILLERY', 42, 18, 9, muted);
    text('SPINES', 40, 38, 25, ice); text(bm.name, 197, 45, 15, gold);
    text('TURN ' + w.turnNo + '  /  ' + (retreating ? 'RETREAT!' : (phaseNames[w.phase] || 'STANDBY')), 474, 19, 10, retreating ? '#9ef57a' : muted);
    const mine = unit && G.isMine && G.isMine(unit.p);
    text(unit ? BC.PLAYER_NAMES[unit.p] + (mine ? '  YOUR TURN' : '  ON TURN') : 'STANDBY', 474, 40, 18, accent);
    text(retreating ? 'RETREAT' : 'TURN CLOCK', 1040, 33, 10, retreating ? '#9ef57a' : muted);
    const clockTxt = w.phase === 'aim' ? String(Math.ceil(Math.max(0, w.timeLeft))).padStart(2, '0') + 's'
      : retreating ? w.retreat.toFixed(1) + 's' : '--';
    text(clockTxt, 1249, 25, 23,
      w.phase === 'aim' && w.timeLeft < 6 ? '#ff926b' : retreating ? '#9ef57a' : ice, 'right');

    rect(g, FIELD.x - 3, FIELD.y - 3, FIELD.w + 6, FIELD.h + 6, line);
    g.save(); g.translate(FIELD.x, FIELD.y);
    g.beginPath(); g.rect(0, 0, FIELD.w, FIELD.h); g.clip();
    const skyKey = (w.theme || 0) + ':' + (w.mapSeed || 0);
    if (!sky || sky.key !== skyKey) sky = { key: skyKey, cv: backdrop(w.theme || 0, w.mapSeed || 1) };
    g.drawImage(sky.cv, 0, 0, FIELD.w, FIELD.h);
    drawWindSky(g, w, G.time);
    drawWater(g, w, G.time, false);
    battlefield(g, w);
    stepFx(w, dt);
    w.crates.forEach(q => crate(g, q));
    if (w.mortarStand && w.phase !== 'aim') {
      drawStandingMortar(g, w.mortarStand.x, w.mortarStand.y, w.mortarStand.ax, w.mortarStand.ay, false);
    }
    w.units.forEach(u => fighter(g, G, w, u));
    drawFxLayer(g, w);
    if (w.muzzle) drawMuzzleFlash(g, w.muzzle);
    if (w.projectile) drawShot(g, w.projectile);
    w.fragments.forEach(q => drawShot(g, q));
    w.echoes.forEach(b => drawBlast(g, b));
    if (w.blast) drawBlast(g, w.blast);
    drawWater(g, w, G.time, true);
    drawLocalHud(g, G, w, unit);
    g.restore();
    sidebar(g, G, w, unit); controls(g, !!w.standalone);
    g.restore();
  }
  BC.WormsView = { draw, blood: spawnBlood, weaponAt, FIELD };
})();
