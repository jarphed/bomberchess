(function () {
  'use strict';
  const BC = window.BC = window.BC || {};
  const W = 960, H = 520, WATER_Y = 504, TURN = 14, RETREAT = 3, GRAVITY = 690;
  const HOLY_CHOIR_AT = 2.25, MORTAR_MIN = 1.08, MORTAR_MAX = 2.06;
  const PIECE_ORDER = ['K', 'P', 'N', 'B', 'R', 'Q'];
  const PIECE_WEAPON = { K: 'rocket', P: 'grenade', N: 'mortar', B: 'shotgun', R: 'drill', Q: 'dynamite' };
  const WEAPON_PIECE = { rocket: 'K', grenade: 'P', mortar: 'N', shotgun: 'B', drill: 'R', dynamite: 'Q' };
  const CRATE_WEAPONS = ['cluster', 'sheep', 'meteor', 'holy'];
  // Cluster & Sheep are common crate finds; Meteor & Holy Hand Grenade share the exact same rarer weight.
  const CRATE_WEIGHTS = [['cluster', 36], ['sheep', 32], ['meteor', 16], ['holy', 16]];
  const weapons = PIECE_ORDER.map(t => PIECE_WEAPON[t]).concat(CRATE_WEAPONS);
  // [blastRadius, maxDamage, knockback]
  const blasts = {
    rocket: [86, 72, 275], grenade: [104, 76, 295], mortar: [88, 74, 265],
    shotgun: [46, 52, 245], drill: [64, 62, 200], dynamite: [116, 88, 330],
    sheep: [102, 84, 295], meteor: [114, 86, 320], holy: [158, 104, 395],
    pellet: [52, 30, 145],
  };
  const fuses = {
    rocket: 6, grenade: 3, mortar: 7, shotgun: 3.5, drill: 3, dynamite: 2.7,
    sheep: 3.6, meteor: 3.2, cluster: 2.2, holy: 3.5, pellet: 2.2,
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const emit = (L, ev) => { if (L && L.emit) L.emit(ev); };
  const snd = (L, n) => emit(L, { e: 'snd', n });

  function rngOf(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministic PRNG stored on `w.seed` so JSON state snapshots resume identically.
  function nextRand(w) {
    w.seed = (Math.imul(w.seed >>> 0, 1664525) + 1013904223) >>> 0;
    return w.seed / 4294967296;
  }
  function rollWind(w) {
    return Math.round((nextRand(w) * 2 - 1) * 100) / 100;
  }
  function rollCrateWeapon(w) {
    let total = 0;
    for (const [, wt] of CRATE_WEIGHTS) total += wt;
    let r = nextRand(w) * total;
    for (const [kind, wt] of CRATE_WEIGHTS) {
      r -= wt;
      if (r <= 0) return kind;
    }
    return CRATE_WEIGHTS[0][0];
  }

  function available(u) {
    return weapons.filter(k => u.weapons.includes(k) || (u.ammo[k] || 0) > 0);
  }

  function loadoutFor(L, p, standalone) {
    if (standalone) {
      return {
        pieces: [],
        unlocked: ['rocket', 'grenade', 'mortar', 'shotgun'],
        ammo: { drill: 2, dynamite: 1 },
      };
    }
    const owned = new Set(['K']);
    L.chess.occ.forEach(q => { if (q && q.o === p && PIECE_WEAPON[q.t]) owned.add(q.t); });
    const pieces = PIECE_ORDER.filter(t => owned.has(t));
    return { pieces, unlocked: pieces.map(t => PIECE_WEAPON[t]), ammo: {} };
  }

  function polyItem(kind, poly, cap) {
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const out = { kind, poly, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    if (cap) out.cap = cap;
    return out;
  }

  function buildIsland(x0, x1, baseY, amp, coast, rnd) {
    x0 = Math.round(clamp(x0, 0, W - 40));
    x1 = Math.round(clamp(x1, x0 + 40, W));
    const span = x1 - x0;
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    const f1 = (1.1 + rnd() * 1.3) * Math.PI * 2 / span;
    const f2 = (2.4 + rnd() * 2.2) * Math.PI * 2 / span;
    const f3 = (5.0 + rnd() * 3.5) * Math.PI * 2 / span;
    const stepH = 14 + rnd() * 14;
    const blend = rnd() * 0.42;
    const cap = [];
    const steps = Math.max(6, Math.round(span / 10));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + span * i / steps);
      const u = i / steps;
      const edge = Math.min(u * span, (1 - u) * span);
      const sink = edge < coast ? Math.pow(1 - edge / coast, 1.75) : 0;
      let y = baseY(u)
        + Math.sin(x * f1 + p1) * amp * 0.58
        + Math.sin(x * f2 + p2) * amp * 0.29
        + Math.sin(x * f3 + p3) * amp * 0.13;
      const terraced = Math.round(y / stepH) * stepH;
      y = y * (1 - blend) + terraced * blend;
      y = clamp(y, 148, WATER_Y - 26);
      y = Math.round(clamp(y + sink * (H - y), 140, H));
      cap.push([x, y]);
    }
    const poly = [[x0, H], ...cap, [x1, H]];
    return polyItem('land', poly, cap);
  }

  function buildFloating(cx, cy, rx, ry, rnd) {
    cx = clamp(cx, rx + 18, W - rx - 18);
    cy = clamp(cy, ry + 54, 370);
    const p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
    const n = Math.max(8, Math.round((rx * 2) / 10));
    const cap = [], under = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 - 1;
      const x = Math.round(cx + t * rx);
      const env = Math.sqrt(Math.max(0, 1 - t * t));
      const dome = cy - env * ry * (0.48 + 0.16 * Math.sin(t * 3.1 + p1)) + Math.sin(t * 6.2 + p2) * 4;
      cap.push([x, Math.round(clamp(dome, 52, WATER_Y - 60))]);
    }
    for (let i = n - 1; i >= 1; i--) {
      const t = (i / n) * 2 - 1;
      const x = Math.round(cx + t * rx);
      const env = Math.pow(Math.max(0, 1 - t * t), 0.7);
      const keel = cy + env * ry * (0.85 + 0.28 * Math.sin(t * 5.3 + p3)) + Math.cos(t * 9.1 + p1) * 5;
      under.push([x, Math.round(clamp(Math.max(cap[i][1] + 14, keel), 68, WATER_Y - 40))]);
    }
    return polyItem('land', [...cap, ...under], cap);
  }

  // Procedurally generate a fresh original-Worms-style landscape every battle.
  function makeTerrain(mapSeed) {
    const rnd = rngOf(mapSeed);
    const arch = Math.floor(rnd() * 4);
    const out = [];
    const addGirder = (x, y, w) => {
      const gx = Math.round(clamp(x, 12, W - w - 12));
      const gy = Math.round(clamp(y, 96, WATER_Y - 38));
      out.push({ kind: 'girder', x: gx, y: gy, w: Math.round(w), h: 13 });
    };

    if (arch === 0) {
      // Twin hilly islands separated by a central water channel + floating island + bridge.
      const gapX = Math.round(450 + (rnd() - 0.5) * 90);
      const gapW = Math.round(74 + rnd() * 42);
      const lBase = 315 + rnd() * 65, rBase = 315 + rnd() * 65;
      out.push(buildIsland(16, gapX - Math.round(gapW / 2), u => lBase - Math.sin(u * Math.PI) * 58, 52, 42, rnd));
      out.push(buildIsland(gapX + Math.round(gapW / 2), W - 16, u => rBase - Math.sin(u * Math.PI) * 58, 52, 42, rnd));
      out.push(buildFloating(gapX + (rnd() - 0.5) * 70, 185 + rnd() * 42, 74 + rnd() * 28, 34 + rnd() * 12, rnd));
      if (rnd() < 0.65) {
        out.push(buildFloating(rnd() < 0.5 ? 190 + rnd() * 70 : 700 + rnd() * 70, 165 + rnd() * 40, 56 + rnd() * 20, 28, rnd));
      }
      addGirder(gapX - 58 + (rnd() - 0.5) * 24, 392 + rnd() * 38, 116);
      addGirder(95 + rnd() * 90, 235 + rnd() * 45, 96);
      addGirder(740 - rnd() * 80, 235 + rnd() * 45, 96);
    } else if (arch === 1) {
      // Three-peak archipelago with two water channels and high outcrops.
      const c1 = Math.round(298 + (rnd() - 0.5) * 34);
      const c2 = Math.round(662 + (rnd() - 0.5) * 34);
      out.push(buildIsland(14, c1 - 28, u => 330 + (0.5 - u) * 38, 46, 34, rnd));
      out.push(buildIsland(c1 + 28, c2 - 28, u => 295 - Math.sin(u * Math.PI) * 54, 48, 36, rnd));
      out.push(buildIsland(c2 + 28, W - 14, u => 330 + (u - 0.5) * 38, 46, 34, rnd));
      out.push(buildFloating(c1 + (rnd() - 0.5) * 30, 182 + rnd() * 38, 62 + rnd() * 18, 30, rnd));
      out.push(buildFloating(c2 + (rnd() - 0.5) * 30, 182 + rnd() * 38, 62 + rnd() * 18, 30, rnd));
      addGirder((c1 + c2) / 2 - 52, 162 + rnd() * 32, 104);
    } else if (arch === 2) {
      // Towering canyon cliffs sloping into a central basin with sky-islands overhead.
      const split = rnd() < 0.45;
      if (split) {
        out.push(buildIsland(10, 446, u => 235 + u * u * 175, 44, 34, rnd));
        out.push(buildIsland(514, W - 10, u => 235 + (1 - u) * (1 - u) * 175, 44, 34, rnd));
        addGirder(428, 424 + rnd() * 24, 104);
      } else {
        out.push(buildIsland(12, W - 12, u => 230 + Math.sin(u * Math.PI) * 185, 46, 40, rnd));
      }
      out.push(buildFloating(335 + rnd() * 60, 175 + rnd() * 36, 78 + rnd() * 24, 34, rnd));
      out.push(buildFloating(565 + rnd() * 60, 195 + rnd() * 38, 72 + rnd() * 22, 32, rnd));
      addGirder(430 + (rnd() - 0.5) * 50, 295 + rnd() * 35, 110);
    } else {
      // Rolling highlands & sea stack with stepped floating turf ledges.
      const flip = rnd() < 0.5;
      const cut = Math.round(615 + (rnd() - 0.5) * 50);
      if (!flip) {
        out.push(buildIsland(18, cut - 32, u => 335 - Math.sin(u * Math.PI * 1.3) * 68, 56, 40, rnd));
        out.push(buildIsland(cut + 32, W - 18, u => 285 - Math.sin(u * Math.PI) * 48, 44, 34, rnd));
      } else {
        const mCut = W - cut;
        out.push(buildIsland(18, mCut - 32, u => 285 - Math.sin(u * Math.PI) * 48, 44, 34, rnd));
        out.push(buildIsland(mCut + 32, W - 18, u => 335 - Math.sin((1 - u) * Math.PI * 1.3) * 68, 56, 40, rnd));
      }
      out.push(buildFloating(250 + rnd() * 90, 175 + rnd() * 40, 68 + rnd() * 22, 32, rnd));
      out.push(buildFloating(610 + rnd() * 90, 195 + rnd() * 42, 66 + rnd() * 22, 30, rnd));
      addGirder((flip ? W - cut : cut) - 56, 365 + rnd() * 45, 112);
      addGirder(420 + (rnd() - 0.5) * 90, 250 + rnd() * 40, 96);
    }
    return out;
  }

  // Sample the intact polygons once. Store only circular cuts on the wire, so a
  // late joiner can reconstruct exactly the same collision map as the host.
  const masks = new WeakMap(), PX = 2, COLS = W / PX, ROWS = H / PX;
  function cutColumns(c, visit) {
    const first = Math.max(0, Math.ceil((c.x - c.r) / PX - .5));
    const last = Math.min(COLS - 1, Math.floor((c.x + c.r) / PX - .5));
    for (let i = first; i <= last; i++) {
      const dx = (i + .5) * PX - c.x, dy = Math.sqrt(Math.max(0, c.r * c.r - dx * dx));
      const top = Math.max(0, Math.ceil((c.y - dy) / PX - .5));
      const end = Math.min(ROWS, Math.floor((c.y + dy) / PX - .5) + 1);
      if (end > top) visit(i, top, end);
    }
  }
  function mask(w) {
    let m = masks.get(w.terrain);
    if (!m || m.len !== w.terrain.length || m.cuts > w.craters.length) {
      m = { pixels: new Uint8Array(COLS * ROWS), len: w.terrain.length, cuts: 0 };
      for (const t of w.terrain) {
        for (let i = Math.max(0, Math.ceil(t.x / PX - .5)); i < Math.min(COLS, Math.ceil((t.x + t.w) / PX - .5)); i++) {
          const x = (i + .5) * PX;
          if (t.poly) {
            const ys = [];
            for (let j = 0; j < t.poly.length; j++) {
              const [ax, ay] = t.poly[j], [bx, by] = t.poly[(j + 1) % t.poly.length];
              if ((ax > x) === (bx > x)) continue;
              ys.push(ay + (by - ay) * (x - ax) / (bx - ax));
            }
            ys.sort((a, b) => a - b);
            for (let k = 0; k + 1 < ys.length; k += 2) {
              const top = Math.max(0, Math.ceil(ys[k] / PX - .5));
              const end = Math.min(ROWS, Math.ceil(ys[k + 1] / PX - .5));
              if (end > top) m.pixels.fill(1, i * ROWS + top, i * ROWS + end);
            }
          } else if (t.h > 0) {
            const top = Math.max(0, Math.ceil(t.y / PX - .5));
            const end = Math.min(ROWS, Math.ceil((t.y + t.h) / PX - .5));
            if (end > top) m.pixels.fill(1, i * ROWS + top, i * ROWS + end);
          }
        }
      }
      masks.set(w.terrain, m);
    }
    while (m.cuts < w.craters.length) cutColumns(w.craters[m.cuts++], (i, top, end) => m.pixels.fill(0, i * ROWS + top, i * ROWS + end));
    return m.pixels;
  }
  function solid(w, x, y) {
    return x >= 0 && x < W && y >= 0 && y < H && !!mask(w)[Math.floor(x / PX) * ROWS + Math.floor(y / PX)];
  }
  function landing(w, x, from, to) {
    if (to < from || x < 0 || x >= W) return Infinity;
    const bits = mask(w), offset = Math.floor(x / PX) * ROWS;
    for (let j = Math.max(0, Math.ceil((from - .001) / PX)); j <= Math.min(ROWS - 1, Math.floor(to / PX)); j++) {
      if (bits[offset + j] && (!j || !bits[offset + j - 1])) return j * PX;
    }
    return Infinity;
  }
  function bodyBlocked(w, x, y) {
    return solid(w, x, y - 10) || solid(w, x, y - 17);
  }
  function surfaceNormal(w, x, y) {
    let nx = 0, ny = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if ((dx || dy) && solid(w, x + dx * PX, y + dy * PX)) { nx -= dx; ny -= dy; }
      }
    }
    const len = Math.hypot(nx, ny);
    return len > 1e-4 ? [nx / len, ny / len] : [0, -1];
  }

  function findSpawns(w, count) {
    const spots = [];
    for (let x = 42; x <= W - 42; x += 4) {
      // Check both upper sky-islands and main island surfaces so spawns spread naturally.
      let y = landing(w, x, 36, WATER_Y - 18);
      if (y === Infinity) continue;
      if (bodyBlocked(w, x, y) || solid(w, x, y - 24)) {
        const lower = landing(w, x, y + 18, WATER_Y - 18);
        if (lower < Infinity && !bodyBlocked(w, x, lower) && !solid(w, x, lower - 24)) y = lower;
        else continue;
      }
      const l = landing(w, x - 6, y - 10, y + 12), r = landing(w, x + 6, y - 10, y + 12);
      if (l >= WATER_Y - 14 || r >= WATER_Y - 14) continue;
      spots.push({ x, y });
    }
    const chosen = [];
    for (let i = 0; i < count; i++) {
      const ideal = count === 1 ? W / 2 : 120 + (W - 240) * i / (count - 1);
      let pick = null;
      for (const minSep of [80, 40, 0]) {
        let bestScore = Infinity;
        for (const s of spots) {
          if (chosen.some(c => Math.abs(c.x - s.x) < minSep)) continue;
          const score = Math.abs(s.x - ideal) * 2.4 + Math.abs(s.y - 290) * 0.35;
          if (score < bestScore) { bestScore = score; pick = s; }
        }
        if (pick) break;
      }
      chosen.push(pick || { x: Math.round(ideal), y: Math.min(WATER_Y - 20, landing(w, ideal, 0, H)) });
    }
    return chosen;
  }

  function create(L) {
    const mapSeed = L && Number.isInteger(L.wormSeed)
      ? (L.wormSeed >>> 0) || 1
      : ((Math.random() * 0xfffffffe) >>> 0) + 1;
    const terrain = makeTerrain(mapSeed);
    const standalone = !!(L && L.settings && L.settings.playChess === false);
    const wormsOnly = !!(BC.isWormsOnly && L && L.settings && BC.isWormsOnly(L.settings));
    const w = {
      terrain, mapSeed, theme: mapSeed % 4, standalone,
      units: [], active: -1, phase: 'aim', turnNo: 1, maxTurns: wormsOnly ? 9999 : 3,
      timeLeft: TURN, retreat: 0, charge: 0, charging: false, chargeHeld: false, jumpHeld: false, cycleHeld: false,
      jumpTap: 0, weaponCue: 0, rearm: false, wind: 0, seed: mapSeed,
      projectile: null, fragments: [], muzzle: null, mortarStand: null,
      blast: null, echoes: [], craters: [], crates: [], kills: [], deathOrder: [], delay: 0,
    };
    w.wind = rollWind(w);
    // Eliminated chess seats still battle for the same revival stakes as Bomber (when Chess is active).
    const seats = L.players;
    const spawns = findSpawns(w, seats.length);
    seats.forEach((pl, i) => {
      const { x, y } = spawns[i];
      const { pieces, unlocked, ammo } = loadoutFor(L, pl.p, standalone);
      w.units.push({
        p: pl.p, x, y, hp: 100, vx: 0, vy: 0, grounded: true,
        face: x < W / 2 ? 1 : -1, angle: 0.45, weapon: unlocked[0],
        pieces, weapons: unlocked, ammo, lastPower: 0, hurt: false, backflipped: false, turns: 0,
      });
    });
    if (seats.length) w.active = seats[0].p;
    if (seats.length < 2) w.phase = 'done';
    return w;
  }

  function enforceWeaponAngle(u) {
    if (u.weapon === 'mortar') {
      if (u.angle < MORTAR_MIN || u.angle > MORTAR_MAX) u.angle = 1.32;
    } else if (u.angle > 1.48) {
      u.angle = clamp(Math.PI - u.angle, 0.25, 1.35);
    } else {
      u.angle = clamp(u.angle, -1.15, 1.48);
    }
  }

  function mortarBase(w, u) {
    const mx = clamp(u.x + u.face * 15, 12, W - 12);
    const ly = landing(w, mx, u.y - 10, u.y + 10);
    return { x: mx, y: ly < Infinity ? ly : u.y };
  }

  function shotGravity(kind) {
    return kind === 'rocket' ? 285
      : kind === 'cluster' ? 510
      : kind === 'mortar' ? 560
      : kind === 'holy' ? 640
      : kind === 'shotgun' ? 0
      : kind === 'drill' ? 36
      : GRAVITY;
  }

  function shotSpeed(kind, power) {
    if (kind === 'rocket') return 165 + 275 * power;
    if (kind === 'cluster') return 240 + 380 * power;
    if (kind === 'holy') return 175 + 330 * power;
    if (kind === 'mortar') return 250 + 470 * power;
    if (kind === 'dynamite') return 90 + 190 * power;
    return 155 + 300 * power;
  }

  function consumeAmmo(u, kind) {
    if ((u.ammo[kind] || 0) > 0 && --u.ammo[kind] <= 0) {
      delete u.ammo[kind];
      if (!u.weapons.includes(kind)) {
        u.weapon = u.weapons[0] || 'rocket';
        enforceWeaponAngle(u);
      }
    }
  }

  // Hitscan shotgun: fires instantly along the aim line with a muzzle flash and immediate target impact.
  function fireShotgun(L, w, u) {
    const ax = u.face * Math.cos(u.angle), ay = -Math.sin(u.angle);
    const mx = u.x + ax * 18, my = u.y - 14 + ay * 18;
    consumeAmmo(u, 'shotgun');
    let rx = mx, ry = my, hit = false;
    for (let d = 0; d <= 1150; d += 1.5) {
      rx = mx + ax * d;
      ry = my + ay * d;
      if (rx < -4 || rx > W + 4 || ry < -4 || ry >= WATER_Y + 2) break;
      if (d > 4 && w.units.some(v => v !== u && v.hp > 0 && Math.hypot(rx - v.x, ry - (v.y - 12)) < 13)) {
        hit = true;
        break;
      }
      if (solid(w, rx, ry)) {
        hit = true;
        break;
      }
    }
    w.muzzle = {
      x: Math.round(mx), y: Math.round(my),
      ax: Math.round(ax * 1000) / 1000, ay: Math.round(ay * 1000) / 1000,
      age: 0,
    };
    snd(L, 'shotgun');
    emit(L, { e: 'shake', v: 5 });
    if (hit) explode(L, w, { kind: 'shotgun', by: u.p, x: rx, y: ry });
    w.charging = false; w.charge = 0; w.weaponCue = 0; w.projectile = null;
    w.phase = 'settle'; w.delay = 0.55; w.retreat = RETREAT; w.rearm = false;
  }

  function beginShot(L, w, u) {
    const kind = u.weapon, power = w.charge, speed = shotSpeed(kind, power);
    const ax = u.face * Math.cos(u.angle), ay = -Math.sin(u.angle);
    let sx = u.x + ax * 14, sy = u.y - 14 + ay * 14;
    if (kind === 'mortar') {
      const mb = mortarBase(w, u);
      sx = mb.x + ax * 18;
      sy = (mb.y - 4) + ay * 18;
      w.mortarStand = {
        x: Math.round(mb.x), y: Math.round(mb.y),
        ax: Math.round(ax * 1000) / 1000, ay: Math.round(ay * 1000) / 1000,
        age: 0,
      };
      w.muzzle = {
        x: Math.round(sx), y: Math.round(sy),
        ax: Math.round(ax * 1000) / 1000, ay: Math.round(ay * 1000) / 1000,
        age: 0,
      };
    }
    const s = { kind, by: u.p, x: sx, y: sy, vx: ax * speed, vy: ay * speed, age: 0 };
    if (kind === 'sheep') {
      s.vx = u.face * (135 + 95 * power); s.vy = -125;
    } else if (kind === 'meteor') {
      const tx = clamp(u.x + u.face * (54 + 786 * power), 16, W - 16);
      s.x = clamp(tx - u.face * 46, 8, W - 8);
      s.y = 4; s.vx = u.face * 56; s.vy = 290;
    }
    consumeAmmo(u, kind);
    u.lastPower = Math.round(power * 100) / 100;
    const fireSnd = kind === 'sheep' ? 'baa'
      : kind === 'meteor' ? 'whistle'
      : kind === 'mortar' ? 'mortar'
      : kind === 'rocket' ? 'rocket'
      : kind === 'drill' ? 'drill'
      : 'throw';
    snd(L, fireSnd);
    w.charging = false; w.charge = 0; w.weaponCue = 0; w.projectile = s; w.phase = 'shot';
    w.retreat = RETREAT; w.rearm = false;
  }

  function carve(w, s, r) {
    w.craters.push({ x: Math.round(s.x), y: Math.round(s.y), r });
    for (const u of w.units) {
      if (u.hp && u.grounded && landing(w, u.x, u.y, u.y) === Infinity) {
        u.grounded = false; u.fallBy = s.by;
      }
    }
  }

  function hurtWorm(L, w, u, dmg, bx, by, attacker, push) {
    if (u.hp <= 0 || dmg <= 0) return;
    u.hp = Math.max(0, u.hp - dmg);
    if (push > 0) {
      const dx = u.x - bx, dy = (u.y - 14) - by, d = Math.hypot(dx, dy);
      const ux = d > 1 ? dx / d : 0, uy = d > 1 ? dy / d : -1;
      u.vx = clamp((u.vx || 0) + ux * push, -420, 420);
      u.vy = clamp(Math.min(u.vy, -65) + uy * push * 0.78 - 75, -430, 320);
      u.grounded = false;
      if (attacker !== undefined && attacker >= 0) u.fallBy = attacker;
    }
    if (u.p === w.active) { u.hurt = true; w.retreat = 0; }
    const dead = u.hp <= 0;
    if (dead) {
      const killer = attacker === undefined ? u.p : attacker;
      w.kills.push({ by: killer, victim: u.p });
      if (w.deathOrder) w.deathOrder.push({ p: u.p, by: killer, drowned: false });
      snd(L, 'splat');
    } else {
      snd(L, 'hurt');
    }
    emit(L, { e: 'wb', p: u.p, x: Math.round(u.x), y: Math.round(u.y - 12), bx: Math.round(bx), by: Math.round(by), dmg, dead, face: u.face });
  }

  function explode(L, w, s) {
    const [r, damage, maxPush] = blasts[s.kind];
    carve(w, s, Math.round(r * (s.kind === 'holy' ? 0.65 : 0.54)));
    if (w.blast) w.echoes.push(w.blast);
    w.blast = { kind: s.kind, x: s.x, y: s.y, r, age: 0 };
    if (s.kind === 'sheep') {
      emit(L, { e: 'wb', sheep: true, x: Math.round(s.x), y: Math.round(s.y), bx: Math.round(s.x), by: Math.round(s.y + 8), dmg: 40 });
      snd(L, 'splat');
    }
    for (const u of w.units) {
      const d = Math.hypot(u.x - s.x, u.y - 12 - s.y);
      if (u.hp <= 0 || d >= r) continue;
      const f = 1 - d / r;
      hurtWorm(L, w, u, Math.ceil(damage * f), s.x, s.y, s.by, maxPush * (0.28 + 0.72 * f));
    }
    emit(L, { e: 'shake', v: s.kind === 'holy' ? 14 : Math.min(12, Math.round(r / 11)) });
    snd(L, 'explode');
    return true;
  }

  function scatter(L, w, s, x, y) {
    for (let i = -2; i <= 2; i++) {
      w.fragments.push({ kind: 'pellet', by: s.by, x, y, age: 0, vx: i * 76 + .35 * s.vx, vy: -170 - (2 - Math.abs(i)) * 32 });
    }
    snd(L, 'crack');
    return true;
  }

  const TIMED_BOUNCE = new Set(['grenade', 'holy', 'dynamite']);

  function flight(L, w, s, dt) {
    const ox = s.x, oy = s.y;
    s.age += dt;
    if (s.kind === 'holy' && s.age >= HOLY_CHOIR_AT && s.age < fuses.holy) {
      if (!s.holyChoir) {
        s.holyChoir = true;
        s.vx = 0; s.vy = 0;
        const gy = landing(w, s.x, s.y - 8, s.y + 18);
        s.baseY = gy < Infinity ? gy - 4 : s.y;
        snd(L, 'hallelujah');
      }
      const tChoir = s.age - HOLY_CHOIR_AT;
      s.y = s.baseY - 7 * Math.min(1, tChoir / 0.34) - Math.sin(tChoir * 7.5) * 1.1;
      return false;
    }
    if (s.kind === 'rocket') s.vx += w.wind * 290 * dt;
    else if (s.kind === 'mortar') s.vx += w.wind * 75 * dt;
    else if (s.kind === 'meteor') s.vx += w.wind * 65 * dt;
    s.vy += shotGravity(s.kind) * dt;
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.kind === 'sheep') {
      // Bounce back from steep walls; hop smoothly onto reachable ledges.
      if (solid(w, s.x, s.y - 6) && landing(w, s.x, s.y - 16, s.y + 4) === Infinity) {
        s.x = ox; s.vx *= -1;
      }
      const y = landing(w, s.x, oy - 12, s.y + 5);
      if (y < Infinity && s.vy >= 0) { s.y = y - 4; s.vy = -150; }
      if (s.x < 6 || s.x > W - 6) { s.vx *= -1; s.x = clamp(s.x, 6, W - 6); }
    } else {
      const n = Math.max(1, Math.ceil(Math.hypot(s.x - ox, s.y - oy) / PX));
      for (let i = 1; i <= n; i++) {
        const x = ox + (s.x - ox) * i / n, y = oy + (s.y - oy) * i / n;
        if (!solid(w, x, y)) continue;
        if (s.kind === 'drill' && (s.bores || 0) < 6) {
          carve(w, { x, y, by: s.by }, 15); s.bores = (s.bores || 0) + 1;
          if (s.bores % 2 === 1) snd(L, 'drill');
          continue;
        }
        if (s.kind === 'cluster') return scatter(L, w, s, ox, oy);
        if (!TIMED_BOUNCE.has(s.kind)) { s.x = x; s.y = y; return explode(L, w, s); }
        const [nx, ny] = surfaceNormal(w, x, y);
        const vn = s.vx * nx + s.vy * ny;
        const tf = s.kind === 'dynamite' ? 0.36 : s.kind === 'holy' ? 0.68 : 0.8;
        const nf = s.kind === 'dynamite' ? 0.24 : s.kind === 'holy' ? 0.45 : 0.58;
        if (vn < 0) {
          const tx = s.vx - vn * nx, ty = s.vy - vn * ny;
          s.vx = tx * tf - vn * nx * nf;
          s.vy = ty * tf - vn * ny * nf;
          if (Math.hypot(s.vx, s.vy) > 85) snd(L, 'bounce');
        } else {
          s.vx *= -nf; s.vy *= -nf;
        }
        const back = Math.max(0, (i - 1) / n);
        s.x = ox + (s.x - ox) * back + nx * 1.5;
        s.y = oy + (s.y - oy) * back + ny * 1.5;
        break;
      }
    }
    const contact = !TIMED_BOUNCE.has(s.kind) && w.units.some(u => u.hp > 0 && (u.p !== s.by || s.age > 0.25)
      && Math.hypot(s.x - u.x, s.y - (u.y - 12)) < 14);
    if (contact || s.age >= fuses[s.kind] || s.x < -16 || s.x > W + 16 || s.y >= WATER_Y + 4) {
      return s.kind === 'cluster' ? scatter(L, w, s, s.x, Math.min(s.y, WATER_Y)) : explode(L, w, s);
    }
  }

  function hasClearSky(w, x, y) {
    for (let cy = 8; cy < y - 22; cy += 8) if (solid(w, x, cy)) return false;
    return true;
  }
  function lineBlocked(w, x1, y1, x2, y2) {
    const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 10));
    for (let i = 2; i < n - 2; i++) {
      if (solid(w, x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n)) return true;
    }
    return false;
  }

  function cpu(w, u, dt) {
    const t = TURN - w.timeLeft;
    const target = w.units.filter(v => v !== u && v.hp > 0)
      .sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
    if (!target) return {};
    const dir = Math.sign(target.x - u.x) || 1;
    if (t < 0.45) {
      const crate = w.crates.find(c => !c.flying && Math.abs(c.x - u.x) < 75 && Math.abs(c.y - u.y) < 70);
      return { dx: crate ? Math.sign(crate.x - u.x) : dir };
    }
    u.face = dir;
    const avail = available(u), has = k => avail.includes(k);
    const dist = Math.abs(target.x - u.x), rise = u.y - target.y;
    const blocked = lineBlocked(w, u.x, u.y - 14, target.x, target.y - 12);
    if (!w.charging) {
      u.weapon = has('meteor') && hasClearSky(w, target.x, target.y) ? 'meteor'
        : has('holy') && dist > 95 && dist < 440 ? 'holy'
        : blocked && has('drill') && Math.abs(rise) < 90 ? 'drill'
        : dist < 165 && has('sheep') && Math.abs(rise) < 48 ? 'sheep'
        : dist > 110 && has('cluster') ? 'cluster'
        : dist < 145 && has('dynamite') && Math.abs(rise) < 70 ? 'dynamite'
        : !blocked && has('shotgun') && dist < 420 ? 'shotgun'
        : blocked && has('mortar') && dist > 60 && dist < 540 ? 'mortar'
        : dist < 210 && has('grenade') && (blocked || u.turns % 2 === 1) ? 'grenade'
        : 'rocket';
      enforceWeaponAngle(u);
    }
    if (u.weapon === 'shotgun') {
      u.angle = clamp(Math.atan2((u.y - 14) - (target.y - 12), Math.max(8, dist)), -1.15, 1.48);
      return { charge: t > 0.6 };
    }
    let power;
    if (u.weapon === 'meteor') {
      power = clamp((dist - 50) / 790, 0.04, 1);
      u.angle = 0.75;
    } else if (u.weapon === 'mortar') {
      power = clamp(0.45 + dist / 620, 0.45, 1);
      if (!w.charging) {
        const g = shotGravity('mortar'), spd = shotSpeed('mortar', power);
        const effDist = Math.max(12, dist - u.face * w.wind * 45);
        const v2 = spd * spd;
        const disc = Math.max(0, v2 * v2 - g * (g * effDist * effDist + 2 * rise * v2));
        u.angle = clamp(Math.atan2(v2 + Math.sqrt(disc), g * effDist), MORTAR_MIN, 1.54);
      }
    } else {
      power = clamp(u.weapon === 'rocket' ? 0.42 + dist / 620 : 0.35 + dist / 820, 0.35, 1);
      if (!w.charging) {
        const rocket = u.weapon === 'rocket', g = shotGravity(u.weapon);
        const spd = shotSpeed(u.weapon, power);
        const tEst = dist / Math.max(120, spd * 0.75);
        const effDist = Math.max(8, dist - (rocket ? u.face * 0.5 * w.wind * 290 * tEst * tEst : 0));
        const v2 = spd * spd;
        const disc = Math.max(0, v2 * v2 - g * (g * effDist * effDist + 2 * rise * v2));
        u.angle = clamp(Math.atan2(v2 - Math.sqrt(disc), g * effDist), -1.15, 1.48);
      }
    }
    return { charge: w.charge < power - dt * 0.25 };
  }

  function cpuRetreat(w, u) {
    const threats = (w.projectile ? [w.projectile] : []).concat(w.fragments);
    const near = threats.find(s => Math.hypot(s.x - u.x, s.y - (u.y - 12)) < 135);
    if (!near) return {};
    const away = Math.sign(u.x - near.x) || -u.face;
    const nx = clamp(u.x + away * 10, 12, W - 12);
    const wall = u.grounded && landing(w, nx, u.y - 8, u.y + 8) === Infinity && solid(w, nx, u.y - 4);
    return { dx: away, jump: wall || Math.abs(u.x - near.x) < 44 };
  }

  function footBlocked(w, x, y) {
    return solid(w, x, y - 2) || solid(w, x, y - 6) || bodyBlocked(w, x, y);
  }
  function moveWorm(L, w, u, input, dt) {
    const dx = clamp(input.dx || 0, -1, 1);
    if (dx) {
      u.face = Math.sign(dx);
      const x = clamp(u.x + dx * 92 * dt, 8, W - 8);
      if (u.grounded) {
        const ledge = landing(w, x, u.y - 8, u.y + 8);
        if (ledge !== Infinity) {
          if (!bodyBlocked(w, x, ledge) || bodyBlocked(w, u.x, u.y)) { u.x = x; u.y = ledge; }
        } else if (!solid(w, x, u.y - 4) && (!bodyBlocked(w, x, u.y) || bodyBlocked(w, u.x, u.y))) {
          u.x = x; u.grounded = false;
        }
      } else if (Math.abs(u.vx) < 150) {
        if (!footBlocked(w, x, u.y) || footBlocked(w, u.x, u.y)) {
          u.x = x;
        } else if (u.vy >= -40) {
          const stepY = landing(w, x, u.y - 8, u.y + 2);
          if (stepY < Infinity && !bodyBlocked(w, x, stepY)) { u.x = x; u.y = stepY; }
        }
      }
    }
    if (input.jump && !w.jumpHeld) {
      if (u.grounded) {
        u.vy = -305;
        u.vx = (dx ? Math.sign(dx) : u.face) * (dx ? 35 : 85);
        u.grounded = false;
        u.backflipped = false;
        w.jumpTap = 0.34;
        snd(L, 'jump');
      } else if (w.jumpTap > 0 && !u.backflipped) {
        // Classic Worms double-jump backflip to reach high platforms behind you.
        u.vy = -345;
        u.vx = -u.face * 75;
        u.backflipped = true;
        w.jumpTap = 0;
        snd(L, 'backflip');
      }
    }
    w.jumpHeld = !!input.jump;
  }

  function grantCrate(L, w, u, kind) {
    if (kind === 'health') {
      u.hp = Math.min(100, u.hp + 35);
    } else {
      const pick = rollCrateWeapon(w);
      u.ammo[pick] = (u.ammo[pick] || 0) + 1;
      u.weapon = pick;
      w.weaponCue = 1.9;
    }
    snd(L, 'pickup');
  }

  function nextTurn(w) {
    const idx = w.units.findIndex(u => u.p === w.active);
    if (idx >= 0) { w.units[idx].turns++; w.units[idx].hurt = false; }
    let next;
    for (let i = 1; i <= w.units.length; i++) {
      const u = w.units[(idx + i) % w.units.length];
      if (u.hp > 0 && u.turns < w.maxTurns) { next = u; break; }
    }
    if (!next || w.units.filter(u => u.hp > 0).length < 2) { w.phase = 'done'; w.retreat = 0; return; }
    const avail = available(next);
    if (!avail.includes(next.weapon)) next.weapon = avail[0] || 'rocket';
    enforceWeaponAngle(next);
    next.hurt = false;
    w.wind = rollWind(w);
    const kind = w.turnNo % 3 === 1 ? 'health' : 'weapon';
    const dir = next.x < W / 2 ? 1 : -1;
    let tx = clamp(next.x + dir * 34, 24, W - 24);
    let landY = landing(w, tx, 0, WATER_Y - 10);
    if (landY === Infinity) {
      for (const off of [-36, 68, -72, 108, -112, 0]) {
        const cx = clamp(next.x + dir * off, 24, W - 24);
        const ly = landing(w, cx, 0, WATER_Y - 10);
        if (ly < Infinity) { tx = cx; landY = ly; break; }
      }
    }
    const ty = Math.min(WATER_Y - 10, (landY < Infinity ? landY : next.y) - 8);
    w.crates.push({ kind, x: tx < W / 2 ? -14 : W + 14, y: 30, tx, ty, flying: true });
    w.phase = 'drop'; w.delay = 0.85;
    w.active = next.p; w.turnNo++;
    w.timeLeft = TURN; w.retreat = 0; w.jumpTap = 0; w.weaponCue = 0;
    w.muzzle = null; w.mortarStand = null;
    w.charging = w.jumpHeld = w.cycleHeld = w.rearm = false; w.charge = 0;
  }

  function collectCrates(L, w, u) {
    if (!u || u.hp <= 0) return;
    w.crates = w.crates.filter(c => {
      if (c.flying || Math.hypot(u.x - c.x, u.y - 10 - c.y) > 19) return true;
      grantCrate(L, w, u, c.kind);
      return false;
    });
  }

  function step(L, w, dt, input) {
    if (w.blast && (w.blast.age += dt) > 0.55) w.blast = null;
    if (w.echoes.length) w.echoes = w.echoes.filter(b => (b.age += dt) <= .55);
    if (w.muzzle && (w.muzzle.age += dt) > 0.22) w.muzzle = null;
    if (w.mortarStand && (w.mortarStand.age += dt) > 1.4) w.mortarStand = null;
    if (w.jumpTap > 0) w.jumpTap = Math.max(0, w.jumpTap - dt);
    if (w.weaponCue > 0) w.weaponCue = Math.max(0, w.weaponCue - dt);
    const u = w.units.find(v => v.p === w.active);
    const aiming = w.phase === 'aim';
    const retreating = (w.phase === 'shot' || w.phase === 'settle') && w.retreat > 0 && u && u.hp > 0 && !u.hurt;
    const rawInput = input;

    if (aiming && u && u.hp > 0) {
      if (L.players[u.p].type === 'CPU') input = cpu(w, u, dt);
      moveWorm(L, w, u, input, dt);
      const avail = available(u);
      const scrollDir = !w.charging ? (input.wheel ? Math.sign(input.wheel) : (input.cycle && !w.cycleHeld ? 1 : 0)) : 0;
      if (scrollDir) {
        if (avail.length > 1) {
          const curIdx = Math.max(0, avail.indexOf(u.weapon));
          u.weapon = avail[(curIdx + scrollDir + avail.length) % avail.length];
          enforceWeaponAngle(u);
        }
        w.weaponCue = 1.65;
        snd(L, 'weaponSwitch');
      } else if (input.select && !w.charging && avail.includes(input.select) && u.weapon !== input.select) {
        u.weapon = input.select;
        enforceWeaponAngle(u);
        snd(L, 'weaponSwitch');
      }
      w.cycleHeld = !!input.cycle;
      if (u.weapon === 'mortar') {
        enforceWeaponAngle(u);
        u.angle = clamp(u.angle - clamp(input.dy || 0, -1, 1) * 1.15 * dt, MORTAR_MIN, MORTAR_MAX);
      } else {
        u.angle = clamp(u.angle - clamp(input.dy || 0, -1, 1) * 1.65 * dt, -1.15, 1.48);
      }
    } else if (retreating) {
      const rIn = L.players[u.p].type === 'CPU' ? cpuRetreat(w, u) : rawInput;
      moveWorm(L, w, u, rIn, dt);
      w.retreat = Math.max(0, w.retreat - dt);
      if (w.phase === 'shot' && w.projectile && (w.projectile.kind === 'sheep' || w.projectile.kind === 'cluster')) {
        if (!rawInput.charge) w.rearm = true;
        else if (w.rearm && w.projectile.age > 0.22 && L.players[u.p].type !== 'CPU') {
          const s = w.projectile;
          w.projectile = null;
          if (s.kind === 'cluster') scatter(L, w, s, s.x, s.y);
          else explode(L, w, s);
        }
      }
    }

    for (const v of w.units) {
      if (v.hp <= 0) continue;
      if (v.vx) {
        const nx = v.x + v.vx * dt;
        const blocked = nx < 7 || nx > W - 7 || (!v.grounded && footBlocked(w, nx, v.y) && !footBlocked(w, v.x, v.y));
        if (blocked) {
          const stepY = (nx >= 7 && nx <= W - 7 && v.vy >= -40) ? landing(w, nx, v.y - 10, v.y + 2) : Infinity;
          if (stepY < Infinity && !bodyBlocked(w, nx, stepY)) {
            v.x = nx;
            v.y = stepY;
          } else {
            v.vx *= -0.45;
            v.x = clamp(v.x, 7, W - 7);
          }
        } else {
          v.x = nx;
        }
      }
      const prevVy = v.vy;
      v.vy += GRAVITY * dt;
      const dest = v.y + v.vy * dt;
      if (v.vy < 0) {
        if (solid(w, v.x, dest - 19) && !solid(w, v.x, v.y - 19)) v.vy = 0;
        else v.y = dest;
        v.grounded = false;
      } else {
        let y = landing(w, v.x, v.y, dest);
        // If feet ended up slightly inside solid terrain (e.g. crater slope), recover to the walkable surface above.
        if (y === Infinity && solid(w, v.x, v.y)) {
          y = landing(w, v.x, Math.max(0, v.y - 18), dest);
        }
        const wasGrounded = v.grounded;
        v.grounded = y < Infinity;
        if (v.grounded) {
          v.y = y; v.vy = 0; v.vx = 0; v.backflipped = false;
          if (prevVy > 455) {
            const fdmg = Math.min(35, Math.ceil((prevVy - 455) * 0.085));
            snd(L, 'thud');
            hurtWorm(L, w, v, fdmg, v.x, y + 6, v.fallBy, 0);
          } else if (!wasGrounded && prevVy > 130) {
            snd(L, 'land');
          }
          delete v.fallBy;
        } else {
          v.y = dest;
        }
      }
      if (v.hp > 0 && v.y >= WATER_Y + 2) {
        const killer = v.fallBy === undefined ? v.p : v.fallBy;
        v.hp = 0; v.vx = 0;
        w.kills.push({ by: killer, victim: v.p });
        if (w.deathOrder) w.deathOrder.push({ p: v.p, by: killer, drowned: true });
        snd(L, 'splash');
        emit(L, { e: 'wb', p: v.p, x: Math.round(v.x), y: WATER_Y - 2, bx: Math.round(v.x), by: WATER_Y + 18, dmg: 60, dead: true, fall: true });
      }
    }

    for (const c of w.crates) {
      if (c.flying) continue;
      const prevCvy = c.vy || 0;
      c.vy = prevCvy + GRAVITY * dt;
      const bottom = c.y + 8, y = landing(w, c.x, bottom, bottom + c.vy * dt);
      if (y < Infinity) {
        c.y = y - 8;
        if (prevCvy > 110) snd(L, 'crateLand');
        c.vy = 0;
      } else c.y += c.vy * dt;
    }
    if (w.crates.some(c => !c.flying && c.y >= WATER_Y + 2)) {
      snd(L, 'splash');
      w.crates = w.crates.filter(c => c.flying || c.y < WATER_Y + 2);
    }

    if (aiming) {
      if (!u || u.hp <= 0) { nextTurn(w); return; }
      collectCrates(L, w, u);
      w.timeLeft = Math.max(0, w.timeLeft - dt);
      if (u.weapon === 'shotgun') {
        if (input.charge && !w.chargeHeld) {
          w.chargeHeld = true;
          fireShotgun(L, w, u);
          return;
        }
        w.chargeHeld = !!input.charge;
        if (!w.timeLeft) nextTurn(w);
      } else {
        if (input.charge && !w.chargeHeld) {
          w.charging = true;
          w.weaponCue = 0;
        }
        if (w.charging && input.charge) {
          w.charge = Math.min(1, w.charge + dt / 1.15);
        }
        w.chargeHeld = !!input.charge;
        if (w.charging && (!input.charge || !w.timeLeft)) beginShot(L, w, u);
        else if (!w.timeLeft) nextTurn(w);
      }
    } else if (w.phase === 'shot') {
      w.chargeHeld = !!rawInput.charge;
      if (retreating) collectCrates(L, w, u);
      if (w.projectile && flight(L, w, w.projectile, dt)) w.projectile = null;
      if (w.fragments.length) w.fragments = w.fragments.filter(s => !flight(L, w, s, dt));
      if (!w.projectile && !w.fragments.length) { w.phase = 'settle'; w.delay = .55; }
    } else if (w.phase === 'settle') {
      w.chargeHeld = !!rawInput.charge;
      if (retreating) collectCrates(L, w, u);
      w.delay -= dt;
      const activelyFleeing = retreating && !!(L.players[u.p].type === 'CPU' ? cpuRetreat(w, u).dx : rawInput.dx);
      if (w.delay <= 0 && !activelyFleeing && w.units.every(v => !v.hp || v.grounded)) nextTurn(w);
    } else if (w.phase === 'drop') {
      w.chargeHeld = !!rawInput.charge;
      const c = w.crates[w.crates.length - 1];
      const f = Math.min(1, dt / w.delay);
      c.x += (c.tx - c.x) * f; c.y += (c.ty - c.y) * f;
      if ((w.delay -= dt) <= 0) { c.flying = false; snd(L, 'crateLand'); w.phase = 'aim'; }
    }
  }

  function update(L, w, dt, input) {
    // Substep for collisions on thin girders even with a slow host tick. Never
    // reuse the previous seat's command if a call straddles a turn boundary.
    if (!Number.isFinite(dt) || dt <= 0) return w.phase === 'done';
    dt = Math.min(dt, (TURN + 8) * w.units.length * Math.min(w.maxTurns, 12));
    const seat = w.turnNo, steps = Math.ceil(dt * 120), h = dt / steps;
    for (let i = 0; i < steps && w.phase !== 'done'; i++) {
      const sub = (w.turnNo === seat && input) ? (i === 0 ? input : { ...input, select: '', wheel: 0 }) : {};
      step(L, w, h, sub);
    }
    return w.phase === 'done';
  }

  BC.Worms = {
    create, update, makeTerrain, cutColumns, solid, landing, available, mortarBase,
    pixelSize: PX, WATER_Y, HOLY_CHOIR_AT, MORTAR_MIN, MORTAR_MAX,
    PIECE_ORDER, PIECE_WEAPON, WEAPON_PIECE, CRATE_WEAPONS, CRATE_WEIGHTS, fuses,
  };
})();
