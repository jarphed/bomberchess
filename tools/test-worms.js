'use strict';
// node tools/test-worms.js
const assert = require('node:assert/strict');
global.window = {};
for (const name of ['core', 'board', 'chess', 'worms']) require('../js/' + name);
const { Board, Chess, Worms } = window.BC;
const tick = 1 / 120;
function game(n = 2, type = 'human') {
  const board = Board.create(n);
  return { board, chess: Chess.create(board), players: Array.from({ length: n }, (_, p) => ({ p, alive: true, type })) };
}
function range() {
  const L = game(), w = Worms.create(L);
  w.terrain = [{ kind: 'girder', x: 0, y: 460, w: 960, h: 12 }];
  for (const [i, u] of w.units.entries()) Object.assign(u, { x: 220 + 460 * i, y: 460, face: i ? -1 : 1, angle: 0 });
  return { L, w, step: (dt, input) => Worms.update(L, w, dt, input) };
}
function fire(step, duration = 0.6) {
  step(duration, { charge: true });
  step(tick, { charge: false });
}

for (const n of [2, 3, 4, 5]) {
  const L = game(n, 'CPU');
  if (n > 2) L.players[1].alive = false;
  const w = Worms.create(L), w2 = Worms.create(L), initial = JSON.stringify(w.terrain);
  assert.notEqual(JSON.stringify(w.terrain), JSON.stringify(w2.terrain), 'each Worms battle generates a fresh random landscape');
  assert(!w.terrain.some(t => t.kind === 'piece'), 'Worms maps use procedural landforms instead of chessboard pieces');
  assert(w.terrain.some(t => t.kind === 'land' && Array.isArray(t.cap)), 'generated Worms map includes hilly islands/landforms');
  assert.deepEqual(w.units.map(u => u.p), L.players.map(pl => pl.p));
  for (const t of w.terrain) assert(t.x >= 0 && t.x + t.w <= 960 && t.y >= 0 && t.y + t.h <= 520);
  for (const u of w.units) {
    assert(u.grounded && u.y < Worms.WATER_Y - 10, 'worms spawn grounded above water');
    assert(!Worms.solid(w, u.x, u.y - 12), 'worms spawn with clear headroom');
  }
  let shots = 0, done = false;
  for (let i = 0; !done && i < 3600; i++) {
    const before = w.turnNo, phase = w.phase;
    done = Worms.update(L, w, 1 / 15, {});
    assert(w.turnNo === before || w.turnNo === before + 1);
    if (phase === 'aim' && w.phase === 'shot') shots++;
  }
  assert(done && shots > 0, `CPU round stalled or no shots: ${n}`);
  assert(w.turnNo <= w.units.length * w.maxTurns);
  assert(w.units.every(u => u.turns <= w.maxTurns));
  assert.deepEqual(w, JSON.parse(JSON.stringify(w)));
  assert.equal(JSON.stringify(w.terrain), initial);
}

{
  const { w, step } = range(), [a, b] = w.units, fixed = { ...b };
  step(0.18, { dx: -1, dy: -1, jump: true, cycle: true, charge: true });
  assert(a.x < 220 && a.y < 460 && a.angle > 0 && a.face === -1);
  assert.equal(a.weapon, 'grenade'); // held cycle isn't repeat
  assert.deepEqual(b, fixed);
  assert(w.charging && !w.projectile);
  step(1, { charge: true });
  assert.equal(a.y, 460);
  assert.equal(w.charge, 1);
  const clone = JSON.parse(JSON.stringify(w));
  step(tick, {});
  Worms.update(game(), clone, tick, {});
  assert.deepEqual(w, clone, 'JSON state alone resumes mid-charge');
  assert.equal(w.projectile.kind, 'grenade');
}

// Grenades bounce and await their fuse; rockets detonate on the first hit.
for (const kind of ['grenade', 'rocket']) {
  const { w, step } = range();
  w.units[0].weapon = kind;
  fire(step);
  let bounced = false;
  for (let i = 0; w.projectile && i < 720; i++) {
    const old = w.projectile.vy;
    step(tick);
    if (w.projectile && old > 0 && w.projectile.vy < 0) bounced = true;
  }
  assert.equal(bounced, kind === 'grenade');
  assert.equal(w.blast.kind, kind);
}
{
  const speed = seconds => {
    const { w, step } = range();
    fire(step, seconds);
    return w.projectile.vx;
  };
  assert(speed(1) > speed(0.1));
  const damage = kind => {
    const { w, step } = range(), [a, b] = w.units;
    a.weapon = kind;
    fire(step);
    // Same detonation point, irrespective of how a weapon got there.
    Object.assign(w.projectile, { x: b.x, y: b.y - 12, age: 5, vx: 0, vy: 0 });
    step(tick);
    return 100 - b.hp;
  };
  const damages = ['rocket', 'grenade', 'sheep'].map(damage);
  assert(damages.every(d => d > 0) && new Set(damages).size === 3);
}
// Piece-based weapon loadouts: each unique chess piece type unlocks one weapon; duplicates don't stack.
// Cluster, Sheep, Meteor, and Holy Hand Grenade are strictly crate-only (never in starting loadouts).
{
  const L = game(2);
  const wFull = Worms.create(L);
  for (const cw of Worms.CRATE_WEAPONS) {
    assert(!Worms.available(wFull.units[0]).includes(cw), `${cw} must only come from dropped crates (Chess+Worms)`);
  }
  const wStandalone = Worms.create({ ...L, settings: { playChess: false, playBomber: false, playWorms: true } });
  for (const cw of Worms.CRATE_WEAPONS) {
    assert(!Worms.available(wStandalone.units[0]).includes(cw), `${cw} must only come from dropped crates (Standalone)`);
  }
  const wtMap = Object.fromEntries(Worms.CRATE_WEIGHTS);
  assert.equal(wtMap.meteor, wtMap.holy, 'Meteor and Holy Hand Grenade share the exact same rarity');
  assert(wtMap.meteor < wtMap.cluster && wtMap.meteor < wtMap.sheep, 'Meteor & Holy are rarer than Cluster & Sheep');

  L.chess.occ.fill(null);
  // Seat 0: King + 1 Pawn ("king and a bonde") -> exact 2 weapons: rocket + grenade
  L.chess.occ[0] = { t: 'K', o: 0, moved: false, id: 1 };
  L.chess.occ[1] = { t: 'P', o: 0, moved: false, id: 2 };
  // Seat 1: King + 2 Knights ("2 horses") + 3 Pawns -> exact 3 weapons: rocket, grenade, mortar
  L.chess.occ[10] = { t: 'K', o: 1, moved: false, id: 3 };
  L.chess.occ[11] = { t: 'N', o: 1, moved: false, id: 4 };
  L.chess.occ[12] = { t: 'N', o: 1, moved: false, id: 5 };
  L.chess.occ[13] = { t: 'P', o: 1, moved: false, id: 6 };
  L.chess.occ[14] = { t: 'P', o: 1, moved: false, id: 7 };
  L.chess.occ[15] = { t: 'P', o: 1, moved: false, id: 8 };
  const w = Worms.create(L);
  assert.deepEqual(Worms.available(w.units[0]), ['rocket', 'grenade']);
  assert.deepEqual(Worms.available(w.units[1]), ['rocket', 'grenade', 'mortar']);
  // Bare king / eliminated seat always keeps the strong King weapon (rocket).
  L.chess.occ.fill(null);
  const wBare = Worms.create(L);
  assert.deepEqual(Worms.available(wBare.units[0]), ['rocket']);

  // Weapon pill cue stays hidden at turn start, pops up on Q cycle or mouse wheel scroll, and toggles one at a time.
  w.active = 1; // Seat 1 has ['rocket', 'grenade', 'mortar']
  assert.equal(w.weaponCue, 0, 'floating weapon pill is hidden initially');
  Worms.update(L, w, tick, { cycle: true });
  assert.equal(w.units[1].weapon, 'grenade');
  assert(w.weaponCue > 1.5, 'pressing Q shows the single-weapon pill');
  Worms.update(L, w, tick, { cycle: false, wheel: -1 });
  assert.equal(w.units[1].weapon, 'rocket', 'mouse wheel up toggles backward one weapon at a time');
  Worms.update(L, w, tick, { wheel: -1 });
  assert.equal(w.units[1].weapon, 'mortar', 'mouse wheel wraps around available piece weapons');
  Worms.update(L, w, 2.0, {});
  assert.equal(w.weaponCue, 0, 'floating weapon pill fades away after scrolling stops');
}

{
  const { w, step } = range(), [a, b] = w.units;
  a.weapon = 'sheep'; b.x = a.x + 120; b.hp = 10;
  const events = [];
  const L = game();
  L.emit = ev => events.push(ev);
  Worms.update(L, w, 0.6, { charge: true });
  Worms.update(L, w, tick, { charge: false });
  const vx = w.projectile.vx;
  Worms.update(L, w, 0.15, {});
  assert.equal(w.projectile.vx, vx);
  Worms.update(L, w, 1.5, {});
  assert.deepEqual(w.kills, [{ by: a.p, victim: b.p }]);
  assert.equal(b.hp, 0);
  assert(events.some(e => e.e === 'wb' && e.dead && e.p === b.p), 'fatal hit emits worm blood & gibs');
  assert(events.some(e => e.e === 'snd' && e.n === 'splat'), 'fatal hit plays splat audio');
  assert(step(1), 'one survivor ends round');
}
// Post-shot retreat: worm can walk & jump away from its own live grenade, and damage ends retreat.
{
  const { w, step } = range(), [a] = w.units;
  a.weapon = 'grenade';
  a.angle = 1.35; // lob nearly straight up
  fire(step, 0.12);
  assert.equal(w.phase, 'shot');
  assert(w.retreat > 2.5, 'retreat window opens right after shooting');
  const shotX = a.x;
  // Flee left and hop while grenade bounces near shotX for 3 seconds.
  step(0.1, { dx: -1, jump: true });
  for (let i = 0; i < 35; i++) step(0.08, { dx: -1 });
  assert(a.x < shotX - 140, 'worm flees far clear of its grenade during retreat');
  assert.equal(a.hp, 100, 'fleeing worm escapes self-grenade blast unscathed');
}
{
  // Weapon crate grants one of the crate-only superweapons (cluster, sheep, meteor, holy) for 1 shot, then reverts.
  const { w, step } = range();
  for (const u of w.units) {
    u.pieces = ['K', 'P'];
    u.weapons = ['rocket', 'grenade'];
  }
  for (const kind of ['health', 'weapon']) {
    const old = w.active, turnNo = w.turnNo;
    step(w.timeLeft + 0.15);
    assert.notEqual(w.active, old);
    assert.equal(w.turnNo, turnNo + 1);
    const c = w.crates[w.crates.length - 1], x = c.x;
    assert(c.flying && c.kind === kind);
    step(1);
    assert(!c.flying && c.x !== x);
    const u = w.units.find(v => v.p === w.active);
    u.x = c.x; u.hp = 40;
    step(0.1);
    assert(!w.crates.includes(c));
    if (kind === 'health') assert(u.hp > 40);
    else {
      const granted = u.weapon;
      assert(Worms.CRATE_WEAPONS.includes(granted), `crate granted crate-only weapon: ${granted}`);
      assert.equal(u.ammo[granted], 1);
      fire(step);
      assert.equal(w.projectile.kind, granted);
      assert.equal(u.ammo[granted], undefined);
      assert.equal(u.weapon, 'rocket');
    }
  }
}
{
  const { w, step } = range();
  assert(step(150), 'idle humans have a hard round bound');
  assert.equal(w.turnNo, 6);
  assert(w.units.every(u => u.turns === 3));
}
{
  const { w, step } = range(), [a, b] = w.units;
  w.crates.push({ kind: 'health', x: b.x, y: 452, flying: false });
  fire(step);
  Object.assign(w.projectile, { x: b.x, y: 459, vx: 0, vy: 240 });
  step(tick);
  assert(w.craters.length && b.hp > 0, 'survives the blast');
  step(1.2);
  assert.equal(b.hp, 0, 'unsupported worm falls through the crater');
  assert.equal(w.crates.length, 0, 'unsupported crate falls out too');
  assert.equal(a.y, 460, 'ground outside the blast still holds');
  assert.deepEqual(w.kills, [{ by: a.p, victim: b.p }]);
}
// Blast knockback & fall damage: off-center explosion hurls target sideways; high drop deals fall damage.
{
  const { w, step } = range(), [, b] = w.units;
  const startX = b.x;
  fire(step);
  Object.assign(w.projectile, { x: b.x - 36, y: 459, vx: 120, vy: 240 });
  step(tick);
  assert(b.vx > 80 && !b.grounded, 'explosion knocks worm away from blast center');
  step(0.9);
  assert(b.x > startX + 25, 'knocked-back worm lands displaced downrange');

  // High drop causes classic Worms fall damage.
  b.hp = 100; b.y = 120; b.vy = 0; b.grounded = false;
  step(1.2);
  assert(b.grounded && b.hp < 100 && b.hp > 50, 'hard fall deals bounded fall damage');
}
{
  const { w, step } = range();
  w.terrain.push({ kind: 'girder', x: 255, y: 420, w: 70, h: 40 });
  w.units[0].weapon = 'drill'; fire(step);
  step(.32);
  assert(w.craters.length >= 2 && w.projectile.x > 325, 'drill passes through cover and cuts a tunnel');
}
{
  const { w, step } = range();
  w.units[0].weapon = 'cluster'; w.units[0].angle = 1.15; fire(step, 1);
  // Manual Space tap mid-flight splits cluster early (or fuse splits at 1.55s).
  step(0.35, { charge: false });
  step(tick, { charge: true });
  assert.equal(w.fragments.length, 5);
  assert(w.fragments[0].vx < 0 && w.fragments[4].vx > 0);
  step(2.4);
  assert.equal(w.fragments.length, 0);
  assert.equal(w.craters.length, 5);
}
{
  require('../js/input');
  const I = window.BC.Input;
  I.pressed.add('Space'); I.keys.add('Space');
  const spaceInp = I.worms(0);
  assert.equal(spaceInp.jump, true, 'Space triggers jump in Worms');
  assert.equal(spaceInp.charge, false, 'Space does not trigger shoot/charge in Worms');
  I.endFrame(); I.keys.clear();

  I.mouse.clicked = true; I.mouse.down = true;
  const lmbInp = I.worms(0);
  assert.equal(lmbInp.charge, true, 'Left mouse button triggers shoot/charge in Worms');
  assert.equal(lmbInp.jump, false, 'Left mouse button does not trigger jump in Worms');
  I.mouse.down = false; I.endFrame();
}

// Rocket speed & strong wind curve, longer Cluster throw, Holy Hand Grenade levitation + Hallelujah choir + mega crater, and Music mute.
{
  // 1. Rocket stays well inside arena at moderate charge and curves strongly with wind
  const { w: wCalm, step: stepCalm } = range();
  wCalm.wind = 0; wCalm.units[0].angle = 0.78;
  fire(stepCalm, 0.75);
  assert(Math.hypot(wCalm.projectile.vx, wCalm.projectile.vy) < 445, 'rocket speed is moderated so it stays in bounds');
  while (wCalm.projectile) stepCalm(tick);
  const calmX = wCalm.blast.x;

  const { w: wHead, step: stepHead } = range();
  wHead.wind = -1; wHead.units[0].angle = 0.78;
  fire(stepHead, 0.75);
  while (wHead.projectile) stepHead(tick);
  assert(calmX - wHead.blast.x > 160, 'rocket curves strongly into the wind');

  // 2. Cluster bomb throws far clear of the thrower even at moderate power
  const { w: wCl, step: stepCl } = range();
  wCl.units[0].ammo.cluster = 1;
  wCl.units[0].weapon = 'cluster';
  wCl.units[0].angle = 0.78;
  const startHp = wCl.units[0].hp;
  fire(stepCl, 0.55);
  while (wCl.projectile || wCl.fragments.length) stepCl(tick);
  assert.equal(wCl.units[0].hp, startHp, 'medium-power cluster throw clears the thrower safely');

  // 3. Holy Hand Grenade bounces, levitates upright with "hallelujah" choir, and carves a bigger crater than regular grenade
  const { w: wReg, step: stepReg } = range();
  wReg.units[0].weapon = 'grenade'; wReg.units[0].angle = 0.5;
  fire(stepReg, 0.5);
  while (wReg.projectile) stepReg(tick);
  const regCrater = wReg.craters[0].r;

  const Lh = game();
  const sounds = [];
  Lh.emit = ev => { if (ev.e === 'snd') sounds.push(ev.n); };
  const wHoly = Worms.create(Lh);
  wHoly.terrain = [{ kind: 'girder', x: 0, y: 460, w: 960, h: 12 }];
  Object.assign(wHoly.units[0], { x: 220, y: 460, face: 1, angle: 0.5, weapon: 'holy', ammo: { holy: 1 } });
  Object.assign(wHoly.units[1], { x: 760, y: 460, face: -1 });
  Worms.update(Lh, wHoly, 0.5, { charge: true });
  Worms.update(Lh, wHoly, tick, { charge: false });
  Worms.update(Lh, wHoly, 2.45, {});
  assert.equal(wHoly.projectile.holyChoir, true, 'Holy Hand Grenade enters heavenly choir phase before exploding');
  assert(wHoly.projectile.y < wHoly.projectile.baseY - 4, 'Holy Hand Grenade levitates slightly above ground');
  assert(sounds.includes('hallelujah'), 'Holy Hand Grenade triggers the Hallelujah choir sound');
  while (wHoly.projectile) Worms.update(Lh, wHoly, tick, {});
  assert(wHoly.craters[0].r > regCrater * 1.6, 'Holy Hand Grenade carves a much larger crater than a regular grenade');

  // 4. Music mute toggles independently of master sound mute
  require('../js/audio');
  const A = window.BC.Audio;
  A.setMuted(false);
  A.setMusicMuted(false);
  assert.equal(A.isMusicMuted(), false);
  A.toggleMusic();
  assert.equal(A.isMusicMuted(), true, 'music is muted');
  assert.equal(A.isMuted(), false, 'master/SFX sound remains unmuted');
  A.setMusicMuted(false);

  // 5. Shotgun fires instantly (hitscan) with muzzle flash, no charging, no bullet projectile, immediate impact
  const { w: wSg, step: stepSg } = range();
  const [sgA, sgB] = wSg.units;
  sgA.weapon = 'shotgun';
  sgA.angle = 0; // straight horizontal line to sgB at y = 460
  stepSg(tick, { charge: true });
  assert.equal(wSg.projectile, null, 'hitscan shotgun spawns no flying bullet');
  assert.ok(wSg.muzzle && wSg.muzzle.x > sgA.x, 'hitscan shotgun creates a muzzle flash');
  assert(sgB.hp < 100, 'hitscan shotgun damages target on the very first click tick');
  assert.equal(wSg.phase, 'settle', 'shotgun transitions straight to aftermath/retreat');

  // 6. Standing Mortar clamps aim to an upright left/right cone in front of the worm and lobs shells high up then down
  const { w: wMo, step: stepMo } = range();
  const [moA] = wMo.units;
  stepMo(tick, { select: 'mortar' });
  assert.equal(moA.weapon, 'mortar');
  assert(moA.angle >= Worms.MORTAR_MIN && moA.angle <= Worms.MORTAR_MAX, 'switching to mortar snaps barrel upright');
  stepMo(2.0, { dy: 1 }); // try to aim all the way down
  assert.equal(moA.angle, Worms.MORTAR_MIN, 'standing mortar cannot aim below upright forward limit');
  stepMo(2.0, { dy: -1 }); // tilt across vertical to the backward upright limit
  assert.equal(moA.angle, Worms.MORTAR_MAX, 'standing mortar tilts across vertical to slight backward angle');
  moA.angle = 1.22; // steep upward forward
  fire(stepMo, 0.7);
  assert.ok(wMo.mortarStand && wMo.mortarStand.x > moA.x, 'standing mortar emplacement is planted in front of player');
  assert(wMo.projectile.vy < -350 && Math.abs(wMo.projectile.vy) > Math.abs(wMo.projectile.vx), 'mortar fires steeply upward');
  while (wMo.projectile && wMo.projectile.vy < 0) stepMo(tick);
  const apexY = wMo.projectile.y;
  assert(apexY < 260, 'mortar shell climbs high into the sky');
  while (wMo.projectile) stepMo(tick);
  assert(wMo.blast.x > moA.x + 120, 'falling mortar shell impacts downrange');
}

// Crater collision: jumping into a crater, being knocked back into a crater wall, and walking across a crater never fall through solid ground.
{
  const L = game(), w = Worms.create(L);
  // Thick solid island slab so craters carve bowls with walkable floors underneath.
  w.terrain = [{ kind: 'girder', x: 0, y: 300, w: 960, h: 200 }];
  w.craters.push({ x: 360, y: 300, r: 52 });
  const [a, b] = w.units;
  Object.assign(a, { x: 295, y: 300, grounded: true, face: 1, vx: 0, vy: 0, hp: 100 });
  Object.assign(b, { x: 382, y: 348, grounded: false, face: -1, vx: 0, vy: 0, hp: 100 });
  // Jump right into the crater bowl
  Worms.update(L, w, 0.08, { dx: 1, jump: true });
  for (let i = 0; i < 180; i++) Worms.update(L, w, 1 / 60, { dx: 1 });
  assert(a.hp > 0 && a.y < 420 && a.grounded, 'jumping into a crater lands on walkable crater ground without falling through');
  // Walk back and forth inside the crater floor
  const beforeWalkX = a.x;
  for (let i = 0; i < 40; i++) Worms.update(L, w, 1 / 60, { dx: -1 });
  assert(a.hp > 0 && a.grounded && a.x < beforeWalkX - 10, 'worm walks across crater ground');

  // Knockback into a crater slope never tunnels through solid earth
  Object.assign(b, { x: 340, y: 344, grounded: false, vx: 290, vy: -90, hp: 100 });
  for (let i = 0; i < 180; i++) Worms.update(L, w, 1 / 60, {});
  assert(b.hp > 0 && b.grounded && b.y < 420, 'knocked-back worm hitting crater wall lands safely instead of falling through');
}

// Randomized worm spawns: seat 0 is not pinned to the left side across battles, and worms stay spaced apart.
{
  let p0Left = 0, p0Right = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const L = game(4);
    L.wormSeed = seed * 9973;
    const w = Worms.create(L);
    if (w.units[0].x < 480) p0Left++; else p0Right++;
    for (let i = 0; i < w.units.length; i++) {
      for (let j = i + 1; j < w.units.length; j++) {
        const d = Math.hypot(w.units[i].x - w.units[j].x, w.units[i].y - w.units[j].y);
        assert(d >= 70, `worms spawn with reasonable spacing (got ${d.toFixed(1)})`);
      }
    }
  }
  assert(p0Left >= 8 && p0Right >= 8, `seat 0 spawns randomly on both sides (left=${p0Left}, right=${p0Right})`);
}

// Grenade throw range: min power barely throws, max power throws far across the arena.
{
  const throwLandingX = chargeDuration => {
    const { w, step } = range();
    w.units[0].x = 80;
    w.units[0].weapon = 'grenade';
    w.units[0].angle = Math.PI / 4;
    fire(step, chargeDuration);
    while (w.projectile) {
      const prevVy = w.projectile.vy;
      step(tick);
      if (w.projectile && prevVy > 0 && w.projectile.vy < 0) return w.projectile.x;
    }
    return w.blast.x;
  };
  const shortDist = throwLandingX(0.02) - 80;
  const longDist = throwLandingX(1.2) - 80;
  assert(shortDist > 0 && shortDist < 55, `min-power grenade barely throws (dist=${shortDist.toFixed(1)})`);
  assert(longDist > 580, `max-power grenade throws far across the map (dist=${longDist.toFixed(1)})`);
}
console.log('Worms tests passed (terrain, CPU, turns, controls, weapons, crates, elimination).');
