'use strict';
const assert = require('assert').strict;
global.window = {};
for (const file of ['core', 'board', 'chess', 'specials', 'bomber', 'worms', 'ai', 'logic', 'snap']) require('../js/' + file);
const BC = window.BC;
const cfg = { n: 2, types: ['HUMAN', 'HUMAN'], names: ['A', 'B'], moves: 2, bomberTime: 15 };
const L = BC.Logic.create(cfg), M = BC.Snap.mirror(cfg);
const step = () => L.update(1 / 60, {});
const until = phase => {
  for (let n = 0; L.phase !== phase && n < 1800; n++) step();
  assert.equal(L.phase, phase);
};
const mirror = full => BC.Snap.apply(M, JSON.parse(JSON.stringify(BC.Snap.encode(L, full))));

// Use the real missed-turn and settlement paths, without waiting on human clocks.
const finishChess = () => {
  while (L.phase === 'chess' && !L.over) { L.turnLeft = 0; step(); }
};
finishChess();
until('bomber');
assert.equal(L.bomber.round, 1);
until('chess');
assert.equal(L.chessRound, 2);
L.players[0].sp.walker = true;
const lost = L.chess.occ.findIndex(q => q && q.o === 0 && q.t === 'P');
L.chess.occ[lost] = null;
finishChess();
until('worms');
mirror(true);
assert.equal(M.worms.units.length, 2);
const terrain = M.worms.terrain;
L.worms.craters.push({ x: 320, y: 488, r: 46 });
const victim = L.worms.units.find(u => u.p === 1);
victim.hp = 0;
L.worms.kills.push({ by: 0, victim: 1 });
mirror(false);
assert.ok(terrain.length && M.worms.terrain === terrain, 'delta frames keep the platform map');
assert.deepEqual(M.worms.craters, L.worms.craters, 'delta includes all cuts');
const late = BC.Snap.mirror(cfg);
BC.Snap.apply(late, JSON.parse(JSON.stringify(BC.Snap.encode(L, true))));
assert.deepEqual(late.worms, M.worms, 'rejoining clients reconstruct the same damaged arena');
assert.equal(M.worms.units.find(u => u.p === 1).hp, 0);
until('toChess');
assert.equal(L.pawnGain[0].p, 0);
assert.equal(L.pawnLoss[0].p, 1);
assert.ok(L.players[0].sp.walker, 'Worms must not consume next-Bomber power-ups');
mirror(true);
assert.equal(M.worms, null);
until('chess');
assert.equal(L.chessRound, 3);
finishChess();
until('bomber');
assert.equal(L.bomber.round, 2, 'Worms must not advance the closing walls');
for (const [playBomber, playWorms, phase] of [[true, false, 'toBomber'], [false, true, 'toWorms'], [false, false, 'chess']]) {
  const options = { ...cfg, playChess: true, playBomber, playWorms };
  for (const round of [1, 2]) {
    const game = BC.Logic.create(options);
    assert.equal(game.chess.powerups.size > 0, playBomber, 'Bomber power-ups only spawn when Bomberman is selected');
    game.chessRound = round;
    for (let i = 0; i < cfg.moves; i++) { game.turnLeft = 0; game.update(1 / 60, {}); }
    assert.equal(game.phase, phase);
    if (phase === 'chess') {
      assert.equal(game.chessRound, round + 1);
      assert.equal(game.pliesLeft, cfg.moves);
    }
    assert.equal(BC.nextBattle(BC.Snap.mirror(options).settings, round), BC.nextBattle(game.settings, round));
  }
}

// Chess deselected:
// - Bomber + Worms alternates battles.
// - Worms-only starts immediately in Worms with no chess pieces and ends the match when the last worm is standing.
// - Bomber-only starts immediately in Bomberman with stone pillars (no chess pieces), spawns random power-ups live,
//   keeps running past bomberTime into Sudden Death, and ends the match when the last bomber is standing.
{
  const bw = BC.Logic.create({ ...cfg, playChess: false, playBomber: true, playWorms: true });
  assert.equal(bw.phase, 'toBomber');
  assert.equal(bw.chess.powerups.size, 0, 'no chess phase means no chessboard power-ups');
  const stepBw = () => bw.update(1 / 60, {});
  const untilBw = ph => { for (let n = 0; bw.phase !== ph && n < 2400; n++) stepBw(); assert.equal(bw.phase, ph); };
  untilBw('bomber');
  bw.bomber.bombers[1].alive = false;
  bw.bomber.hits.push(1);
  untilBw('toChess');
  untilBw('pawnLoss');
  untilBw('toWorms');
  untilBw('worms');
  bw.worms.units[0].hp = 0;
  untilBw('toChess');
  untilBw('pawnLoss');
  untilBw('toBomber');

  const wOnly = BC.Logic.create({ ...cfg, n: 3, types: ['HUMAN', 'HUMAN', 'HUMAN'], names: ['A', 'B', 'C'], playChess: false, playBomber: false, playWorms: true });
  assert.equal(wOnly.phase, 'worms', 'Worms-only starts straight in Worms without chessboard');
  assert.ok(wOnly.chess.occ.every(q => q === null), 'Worms-only has zero chess pieces');
  assert.ok(wOnly.worms.standalone, 'Worms-only uses standalone Worms loadout');
  // Surviving past 3 turns per player does NOT end Worms-only while multiple worms live
  for (let t = 0; t < 10; t++) wOnly.update(15, {});
  assert.equal(wOnly.over, null, 'Worms-only continues past 3 turns until last worm is standing');
  assert.equal(wOnly.phase, 'worms');
  // Knock out seats 1 and 2; seat 0 is the last worm standing -> game ends directly without pawnLoss
  wOnly.worms.units[1].hp = 0;
  wOnly.worms.deathOrder.push({ p: 1, by: 0, drowned: false });
  wOnly.worms.units[2].hp = 0;
  wOnly.worms.deathOrder.push({ p: 2, by: 0, drowned: true });
  wOnly.update(15, {});
  assert.ok(wOnly.over, 'Worms-only ends the game when last worm is standing');
  assert.equal(wOnly.over.winner, 0);
  assert.equal(wOnly.over.reason, 'LAST WORM STANDING');
  assert.equal(wOnly.pawnLoss.length, 0, 'Worms-only never triggers chess piece removal');

  const bOnly = BC.Logic.create({ ...cfg, bomberTime: 15, playChess: false, playBomber: true, playWorms: false });
  assert.equal(bOnly.phase, 'bomber', 'Bomber-only starts straight in Bomberman without chessboard');
  assert.ok(bOnly.chess.occ.every(q => !q || q.t === 'W'), 'Bomber-only uses only stone pillars, zero chess pieces');
  assert.ok(bOnly.chess.occ.some(q => q && q.t === 'W'), 'Bomber-only places stone pillars on the arena');
  const bMirror = BC.Snap.mirror({ ...cfg, bomberTime: 15, playChess: false, playBomber: true, playWorms: false });
  BC.Snap.apply(bMirror, JSON.parse(JSON.stringify(BC.Snap.encode(bOnly, true))));
  assert.ok(bMirror.chess.occ.some(q => q && q.t === 'W'), 'stone pillars sync cleanly over LAN snapshots');

  // Advance past READY? GO!! and past 15s bomberTime: power-ups spawn randomly and match keeps running while 2+ live!
  for (let i = 0; i < 60 * 18; i++) bOnly.update(1 / 60, {});
  assert.equal(bOnly.over, null, 'Bomber-only does not end on timer while multiple bombers survive');
  assert.ok(bOnly.chess.powerups.size > 0, 'Bomber-only spawns random power-ups during gameplay');
  // Walk bomber 0 onto a spawned power-up cell and verify live collection
  const [puCell, puId] = [...bOnly.chess.powerups.entries()][0];
  const b0 = bOnly.bomber.bombers[0];
  Object.assign(b0, { cell: puCell, from: puCell, to: puCell, moving: false });
  bOnly.update(1 / 60, {});
  assert.ok(!bOnly.chess.powerups.has(puCell), `walking onto spawned ${puId} collects it live`);

  // Eliminate bomber 1 -> game ends directly with bomber 0 as LAST MAN STANDING
  bOnly.bomber.bombers[1].dying = true;
  bOnly.bomber.bombers[1].deathT = 1.6;
  bOnly.bomber.deathOrder.push({ p: 1, by: 0, crushed: false });
  bOnly.update(1 / 60, {});
  assert.ok(bOnly.over, 'Bomber-only ends when last bomber is standing');
  assert.equal(bOnly.over.winner, 0);
  assert.equal(bOnly.over.reason, 'LAST MAN STANDING');
}

// Only-kings endgame: strikes (knight, bishop, stampede, airstrike, etc.) hit kings, denting their helmet up to 10 hits,
// then eliminating the king on the 11th hit.
{
  const kGame = BC.Logic.create({ ...cfg, n: 3, types: ['HUMAN', 'HUMAN', 'HUMAN'], names: ['A', 'B', 'C'], playBomber: false, playWorms: false });
  // Strip everything except the three kings and trigger repeated bishop lightning strikes against seat 1's king.
  const kCells = [];
  kGame.chess.occ.forEach((q, i) => {
    if (!q) return;
    if (q.t === 'K') kCells[q.o] = i;
    else kGame.chess.occ[i] = null;
  });
  // Verify knight/sheep target finding and bishop targeting can pick a king when only kings remain.
  const bishopPlan = BC.Specials.plan(kGame.board, kGame.chess.occ, kGame.chess.sheep, 'B', kCells[0], 0, -1, 0);
  assert.ok(kCells.includes(bishopPlan.view.tc), 'bishop lightning targets a king when only kings remain');
  const knightPlan = BC.Specials.plan(kGame.board, kGame.chess.occ, kGame.chess.sheep, 'N', kCells[0], 0, kGame.chess.occ[kCells[0]].id, 0);
  assert.ok(knightPlan.view.hit >= 0 && kGame.chess.occ[knightPlan.view.hit].t === 'K', 'knight/stampede can charge a king');

  // Place a sacrificial rook next to seat 1's king 10 times to break its helmet, then once more to finish the king.
  const targetK = kCells[1];
  let adj = -1;
  kGame.board.dirs.forEach((d, di) => {
    if (d.type === 'R' && kGame.board.cells[targetK].rays[di].length) adj = kGame.board.cells[targetK].rays[di][0];
  });
  assert.ok(adj >= 0);
  // Find a piece spot that can capture on `adj` without being `targetK`
  const capFrom = kGame.board.cells[adj].king.find(c => c !== targetK && !kGame.chess.occ[c]);
  for (let hit = 1; hit <= BC.KING_HELMET_HITS + 1; hit++) {
    kGame.turn = 0;
    kGame.pliesLeft = 10;
    kGame.chess.occ[capFrom] = { t: 'Q', o: 0, moved: true, id: kGame.chess.uid++ };
    kGame.chess.occ[adj] = { t: 'R', o: 2, moved: true, id: kGame.chess.uid++ };
    assert.ok(kGame.tryMove(0, capFrom, adj));
    for (let s = 0; (kGame.moveAnim || kGame.special) && s < 600; s++) kGame.update(1 / 60, {});
    kGame.chess.occ[adj] = null;
    if (hit <= BC.KING_HELMET_HITS) {
      assert.equal(kGame.players[1].helmetHits, hit);
      assert.ok(kGame.players[1].alive, `king survives hit ${hit} with helmet`);
      assert.equal(kGame.chess.occ[targetK].t, 'K');
    } else {
      assert.ok(!kGame.players[1].alive, 'king is eliminated once its broken helmet is gone');
      assert.equal(kGame.chess.occ[targetK], null);
    }
  }
  const snapMirror = BC.Snap.mirror({ n: 3, types: ['HUMAN', 'HUMAN', 'HUMAN'], names: ['A', 'B', 'C'], moves: 2, bomberTime: 15 });
  kGame.players[0].helmetHits = 6;
  BC.Snap.apply(snapMirror, JSON.parse(JSON.stringify(BC.Snap.encode(kGame, true))));
  assert.equal(snapMirror.players[0].helmetHits, 6, 'helmet damage syncs over LAN snapshots');
}
console.log('Battle cycle, LAN snapshots and chess consequences passed.');
