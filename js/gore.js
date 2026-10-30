(function () {
  'use strict';
  // BLOOD (a lobby option), client side only. With it on, a sheep that blows up at the end of a chained
  // stampede and a knocked-out bomber burst into bloody pixel bits, and a sheep caught by a strike bleeds.
  // The blood and some of the bits stay for the rest of the round: whatever lands for good is painted onto a
  // ground layer under the pieces, which fades away when the board flips between chess and bomber.
  const BC = window.BC;
  const u = BC.u;
  const R = BC.Render;
  const X = {};
  const TAU = Math.PI * 2;
  const GRAV = 1300;   // px/s/s pulling bits and drops back to the ground
  const FADE_T = 0.5;  // the ground layer fades this long when the board flips
  const MAX_LIVE = 1500;
  const RED = ['#4e0610', '#7a0a14', '#a8101c', '#d01c28'];
  // a bit of bone (1 canvas px per sprite px)
  const BONE = ['w....w', 'wwwwww', 'w....w'];

  X.fresh = () => ({ layer: null, live: [], done: new Set(), fadeAt: null });

  // the board flips: everything on the ground fades away
  X.fadeOut = function (G) {
    if (G.gore && G.gore.fadeAt === null) G.gore.fadeAt = G.time;
  };

  function layer(st) {
    if (!st.layer) st.layer = BC.Assets.canvas(BC.BOARD_BOX.w, BC.BOARD_BOX.h);
    return st.layer[1];
  }

  // ------------------------------------------------------------------ blood on the ground
  // a flat pixel ellipse (squashed: it lies on the ground), one row at a time
  function blob(g, cx, cy, r, p, col) {
    g.fillStyle = col;
    const rx = Math.max(p * 0.5, r), ry = Math.max(p * 0.5, r * 0.6);
    for (let yy = -ry; yy <= ry; yy += p) {
      const w = rx * Math.sqrt(Math.max(0, 1 - (yy / ry) * (yy / ry)));
      const x0 = Math.round((cx - w) / p) * p, x1 = Math.max(x0 + p, Math.round((cx + w) / p) * p);
      g.fillRect(x0, Math.round((cy + yy) / p) * p, x1 - x0, p);
    }
  }

  // a blood stain at ground point (x, y) on screen: a dark pool with a few blobs around it and a wet shine
  function splat(st, x, y, r, p) {
    const g = layer(st), box = BC.BOARD_BOX;
    p = Math.max(1, Math.round(p));
    x -= box.x; y -= box.y;
    const n = Math.min(7, Math.round(r / (p * 2.5)));
    g.globalAlpha = 0.92;
    blob(g, x, y, r * 0.65, p, RED[1]);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = r * u.rand(0.4, 0.9);
      blob(g, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, r * u.rand(0.12, 0.35), p, RED[1 + (i % 2)]);
    }
    if (r > p * 2) blob(g, x - r * 0.15, y - r * 0.12, r * 0.25, p, RED[2]);
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ body parts
  // part of a sprite (1 canvas px per sprite px), its torn edges (where the body went on) painted red. Done
  // with compositing only: canvases drawn from images loaded over file:// can't have their pixels read.
  function cut(src, sx, sy, sw, sh) {
    const A = BC.Assets;
    const [cv, g] = A.canvas(sw, sh);
    g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    // the pixels just outside each side of the part, moved onto the part's own edge pixels
    const [ev, e] = A.canvas(sw, sh);
    if (sx > 0) e.drawImage(src, sx - 1, sy, 1, sh, 0, 0, 1, sh);
    if (sx + sw < src.width) e.drawImage(src, sx + sw, sy, 1, sh, sw - 1, 0, 1, sh);
    if (sy > 0) e.drawImage(src, sx, sy - 1, sw, 1, 0, 0, sw, 1);
    if (sy + sh < src.height) e.drawImage(src, sx, sy + sh, sw, 1, 0, sh - 1, sw, 1);
    e.globalCompositeOperation = 'destination-in';
    e.drawImage(cv, 0, 0);
    e.globalCompositeOperation = 'source-in';
    e.fillStyle = RED[3];
    e.fillRect(0, 0, sw, sh);
    g.drawImage(ev, 0, 0);
    return cv;
  }

  const partCache = {};

  // a bomber's head, arms, body and legs, cut from its standing frame (frame 1 of its strip)
  function bomberParts(p) {
    if (partCache['b' + p]) return partCache['b' + p];
    const src = BC.Assets.chars[p];
    if (!src || !BC.Assets.ok.sheet) return [];
    const f = 16;
    partCache['b' + p] = [[4, 0, 9, 6], [1, 5, 4, 6], [11, 5, 4, 6], [5, 6, 6, 6], [4, 12, 4, 3], [8, 12, 4, 3]]
      .map(([x, y, w, h]) => ({ img: cut(src, f + x, y, w, h), x: x + w / 2, y: y + h / 2 }));
    return partCache['b' + p];
  }

  function boneImg() {
    if (partCache.bone) return partCache.bone;
    const [cv, g] = BC.Assets.canvas(6, 3);
    BONE.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'w') { g.fillStyle = x === 0 ? RED[3] : '#f4ecdc'; g.fillRect(x, y, 1, 1); } });
    partCache.bone = cv;
    return cv;
  }

  // a sheep's head, four lumps of its body, its four legs and a bone (on the sheep canvas, 14x13)
  function sheepParts() {
    if (partCache.sheep) return partCache.sheep;
    const src = BC.SpecialFx.sheepCanvas();
    const list = [[0, 3, 5, 7], [4, 0, 5, 5], [9, 0, 5, 5], [5, 5, 4, 4], [9, 5, 5, 4], [5, 9, 1, 4], [7, 9, 1, 4], [10, 9, 1, 4], [12, 9, 1, 4]]
      .map(([x, y, w, h]) => ({ img: cut(src, x, y, w, h), x: x + w / 2, y: y + h / 2 }));
    list.push({ img: boneImg(), x: 9, y: 5 });
    partCache.sheep = list;
    return list;
  }

  // ------------------------------------------------------------------ spawning
  // parts fly off from the sprite drawn at (left, top) with pixel scale k, standing on the ground at gy;
  // keep: indexes of the parts that stay on the ground for the rest of the round
  function burst(st, parts, left, top, gy, cx, k, keep, power) {
    parts.forEach((pt, i) => {
      if (st.live.length >= MAX_LIVE) return;
      const px = left + pt.x * k, py = top + pt.y * k;
      const a = Math.random() * TAU, sp = u.rand(50, 170) * power;
      st.live.push({
        kind: 'gib', img: pt.img, k, x: px, y: gy + u.rand(-3, 3), z: Math.max(0, gy - py),
        vx: (px - cx) * 5 * power + Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: u.rand(240, 520) * power,
        rot: 0, vr: u.rand(-16, 16), keep: keep.includes(i), life: u.rand(2.5, 5), bleed: u.rand(0.3, 0.9), rest: false,
      });
    });
  }

  // n drops of blood from (x, y) at height z
  function drops(st, x, y, z, n, p, speed, up) {
    for (let i = 0; i < n && st.live.length < MAX_LIVE; i++) {
      const a = Math.random() * TAU, sp = u.rand(20, speed);
      st.live.push({
        kind: 'drop', x, y, z: z * u.rand(0.5, 1), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: u.rand(up * 0.2, up),
        s: Math.max(1, Math.round(p * (Math.random() < 0.3 ? 2 : 1))), p,
      });
    }
  }

  function mist(G, x, y, r, n) {
    for (let i = 0; i < n; i++) {
      G.fx.push({ type: 'puff', x: x + u.rand(-r, r) * 0.5, y: y + u.rand(-r, r) * 0.4, r, color: i % 2 ? RED[2] : RED[3], t: 0, dur: 0.6, rise: r * 0.3, alpha: 0.35 });
    }
  }

  // a bomber blown to bits
  function bomberGore(G, b) {
    const st = G.gore, S = 16 * G.board.sprScale, k = S / 16;
    const [x, y] = R.bomberPos(G, b);
    const gy = y + S * 0.38;
    // the head and two other bits stay
    const keep = [0].concat(u.shuffle([1, 2, 3, 4, 5]).slice(0, 2));
    burst(st, bomberParts(b.p), x - S / 2, y - S * 0.62, gy, x, k, keep, 1);
    drops(st, x, gy, S * 0.5, 70, k, 200, 440);
    splat(st, x, gy, S * 0.45, k);
    mist(G, x, y - S * 0.1, S * 0.35, 3);
    G.burst(x, y - S * 0.1, RED, 30, 260, Math.max(2, Math.round(k)));
    BC.Audio.play('splat');
  }

  // a bomber squashed by a falling wall: blood squirts out from under it, an arm and a leg with it
  function crushedGore(G, b) {
    const st = G.gore, S = 16 * G.board.sprScale, k = S / 16;
    const [x, y] = R.bomberPos(G, b);
    const gy = y + S * 0.38;
    const parts = bomberParts(b.p);
    const side = [parts[1], parts[4]].filter(Boolean);
    side.forEach((pt, i) => {
      const dir = i ? 1 : -1;
      st.live.push({
        kind: 'gib', img: pt.img, k, x: x + dir * S * 0.3, y: gy - S * 0.1, z: 2, vx: dir * u.rand(160, 260), vy: u.rand(-60, 60), vz: u.rand(120, 220),
        rot: 0, vr: u.rand(-10, 10), keep: true, life: 0, bleed: 0.6, rest: false,
      });
    });
    drops(st, x, gy - S * 0.2, 4, 60, k, 360, 260);
    splat(st, x, gy - S * 0.2, G.board.cellPx * 0.6, k);
    BC.Audio.play('splat');
  }

  // a sheep blowing up at the end of a chained stampede (SpecialFx 'gib'), on cell c
  X.sheep = function (G, c) {
    const st = G.gore;
    if (!st || !BC.SpecialFx) return;
    const k = G.board.pieceScale, s = 14 * k;
    const gy = c.sy + s * 0.36;
    const parts = sheepParts();
    // the head, a leg, a lump and the bone stay
    burst(st, parts, c.sx - s / 2, gy - 13 * k, gy, c.sx, k, [0, 5 + u.randInt(0, 3), u.randInt(1, 4), 9], 1.25);
    drops(st, c.sx, gy, s * 0.4, 90, k, 260, 500);
    splat(st, c.sx, gy - s * 0.2, G.board.cellPx * 0.55, k);
    mist(G, c.sx, c.sy - s * 0.2, s * 0.4, 4);
    BC.Audio.play('splat');
  };

  // a sheep caught by a strike (it stampedes on): it bleeds, and bloody tufts of wool come off
  X.wound = function (G, c) {
    const st = G.gore;
    if (!st || !BC.SpecialFx) return;
    const k = G.board.pieceScale, s = 14 * k;
    const gy = c.sy + s * 0.3;
    const parts = sheepParts();
    burst(st, [parts[u.randInt(1, 4)]], c.sx - s / 2, gy - 13 * k, gy, c.sx, k, [], 0.8);
    drops(st, c.sx, gy, s * 0.4, 28, k, 200, 420);
    splat(st, c.sx, gy - s * 0.1, s * 0.3, k);
    BC.Audio.play('splat');
  };

  // ------------------------------------------------------------------ update
  function step(st, o, dt, box) {
    if (o.rest) {
      if ((o.restT += dt) >= o.life) o.gone = true;
      return;
    }
    o.vz -= GRAV * dt;
    o.z += o.vz * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    // the board box is the edge of the world
    if (o.x < box.x + 6 || o.x > box.x + box.w - 6) { o.x = u.clamp(o.x, box.x + 6, box.x + box.w - 6); o.vx *= -0.4; }
    if (o.y < box.y + 6 || o.y > box.y + box.h - 6) { o.y = u.clamp(o.y, box.y + 6, box.y + box.h - 6); o.vy *= -0.4; }
    if (o.kind === 'drop') {
      if (o.z <= 0) { splat(st, o.x, o.y, o.s * u.rand(0.6, 1.4), o.p); o.gone = true; }
      return;
    }
    o.rot += o.vr * dt;
    if (o.bleed > 0) {
      o.bleed -= dt;
      if (Math.random() < dt * 30) drops(st, o.x, o.y, o.z, 1, o.k, 30, 60);
    }
    if (o.z > 0) return;
    o.z = 0;
    splat(st, o.x, o.y, o.k * u.rand(1.5, 3), o.k);
    if (o.vz < -160) {
      o.vz *= -0.3; o.vx *= 0.5; o.vy *= 0.5; o.vr *= 0.4;
      return;
    }
    // it lies still, squared up with the pixel grid; keepers are painted onto the ground for good
    o.rest = true;
    o.restT = 0;
    o.rot = Math.round(o.rot / (Math.PI / 2)) * Math.PI / 2;
    if (o.keep) { stamp(st, o); o.gone = true; }
  }

  function stamp(st, o) {
    const g = layer(st), box = BC.BOARD_BOX;
    const w = o.img.width * o.k, h = o.img.height * o.k;
    g.save();
    g.translate(Math.round(o.x - box.x), Math.round(o.y - box.y));
    g.rotate(o.rot);
    g.drawImage(o.img, Math.round(-w / 2), Math.round(-h / 2), w, h);
    g.restore();
  }

  X.update = function (G, dt) {
    const st = G.gore;
    if (st.fadeAt !== null && G.time - st.fadeAt >= FADE_T) {
      st.layer = null;
      st.live = [];
      st.fadeAt = null;
    }
    // knocked-out bombers burst once their hit flash is over (squashed ones straight away)
    const ps = G.bomber;
    if (ps && G.boardMode === 'bomber' && G.cfg && G.cfg.blood && BC.Assets.ok.sheet) {
      ps.bombers.forEach(b => {
        if (!b.alive || !b.dying) return;
        const key = (ps.round || 0) + ':' + b.p;
        if (st.done.has(key) || (!b.crushed && b.deathT < R.DEATH_HIT)) return;
        st.done.add(key);
        if (b.crushed) crushedGore(G, b); else bomberGore(G, b);
      });
    }
    if (!st.live.length) return;
    const box = BC.BOARD_BOX;
    st.live.forEach(o => step(st, o, dt, box));
    st.live = st.live.filter(o => !o.gone);
  };

  // ------------------------------------------------------------------ drawing
  function fade(G) {
    const st = G.gore;
    return st.fadeAt === null ? 1 : Math.max(0, 1 - (G.time - st.fadeAt) / FADE_T);
  }

  function drawGib(ctx, o, alpha) {
    const w = o.img.width * o.k, h = o.img.height * o.k;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.round(o.x), Math.round(o.y - o.z));
    ctx.rotate(o.rot);
    ctx.drawImage(o.img, Math.round(-w / 2), Math.round(-h / 2), w, h);
    ctx.restore();
  }

  // under the pieces: the blood and the bits lying on the ground
  X.drawGround = function (G) {
    const st = G.gore;
    if (!st) return;
    const a = fade(G);
    if (a <= 0) return;
    const ctx = R.ctx, box = BC.BOARD_BOX;
    if (st.layer) {
      ctx.globalAlpha = a;
      ctx.drawImage(st.layer[0], box.x, box.y);
      ctx.globalAlpha = 1;
    }
    st.live.forEach(o => {
      if (o.kind === 'gib' && o.rest) drawGib(ctx, o, a * u.clamp((o.life - o.restT) / 0.6, 0, 1));
    });
  };

  // over everything: the bits and drops still in the air, with their shadows on the ground
  X.drawAir = function (G) {
    const st = G.gore;
    if (!st || !st.live.length) return;
    const a = fade(G);
    if (a <= 0) return;
    const ctx = R.ctx;
    st.live.forEach(o => {
      if (o.rest) return;
      if (o.kind === 'drop') {
        ctx.globalAlpha = a;
        ctx.fillStyle = o.s > o.p ? RED[2] : RED[3];
        ctx.fillRect(Math.round(o.x - o.s / 2), Math.round(o.y - o.z - o.s / 2), o.s, o.s);
        return;
      }
      const w = o.img.width * o.k;
      ctx.globalAlpha = a * 0.3 / (1 + o.z / 60);
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(o.x, o.y, w * 0.4, w * 0.13, 0, 0, TAU); ctx.fill();
      drawGib(ctx, o, a);
    });
    ctx.globalAlpha = 1;
  };

  BC.Gore = X;
})();
