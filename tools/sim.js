'use strict';
// Headless CPU-only simulation of the shared game logic:
// node tools/sim.js [gamesPerPlayerCount] [brain 0-4] [chain] [gates] [revive] [gate=<round>] [pu=<power-up level 0-4>]
const path = require('path');

global.window = { addEventListener() {} };
for (const f of ['core', 'board', 'chess', 'specials', 'bomber', 'ai', 'logic', 'snap']) require(path.join(__dirname, '..', 'js', f + '.js'));
const BC = global.window.BC;

const GAMES = Number(process.argv[2]) || 4;
const BRAIN = process.argv[3] === undefined ? BC.BRAIN_DEFAULT : Number(process.argv[3]);
const FLAGS = process.argv.slice(4);
const CHAIN = FLAGS.includes('chain');
const GATES = FLAGS.includes('gates');
const REVIVE = FLAGS.includes('revive');
const flagNum = (name, def) => { const f = FLAGS.find(x => x.startsWith(name + '=')); return f ? Number(f.slice(name.length + 1)) : def; };
const GATE_ROUND = flagNum('gate', BC.GATE_ROUND.def);
const POWER = flagNum('pu', BC.POWER_DEFAULT);
const DT = 1 / 60;
const MAX_STEPS = 60 * 60 * 40;

for (const n of [2, 3, 4, 5]) {
  const res = { games: 0, outcomes: {}, outs: {}, minutes: 0, rounds: 0, slowest: 0, errors: [], snapBytes: 0, snaps: 0, specials: {}, strikeKills: 0, ev: {} };
  for (let g = 0; g < GAMES; g++) {
    const L = BC.Logic.create({ n, moves: 10, bomberTime: 30, types: Array(n).fill('CPU'), names: Array(n).fill('CPU'), brain: BRAIN, chain: CHAIN, gates: GATES, gateRound: GATE_ROUND, powerLevel: POWER, revive: REVIVE });
    let steps = 0, lastPhase = L.phase, sentRev = -1, lastSp = null;
    try {
      while (!L.over && steps < MAX_STEPS) {
        const t0 = process.hrtime.bigint();
        L.update(DT, {});
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        res.slowest = Math.max(res.slowest, ms);
        L.events.forEach(e => {
          if (e.e === 'shatter' && e.k) res.strikeKills++;
          if (e.e === 'shatter' && e.k && e.t === 'K') res.errors.push('a strike killed a king');
          const tag = e.e === 'banner' && / GOT /.test(e.text) ? 'kill'
            : e.e === 'banner' && / HIT!$/.test(e.text) ? 'selfHit'
            : e.e === 'popup' && e.text === 'PAWN REVIVED!' ? 'revived'
            : e.e === 'popup' && e.text === 'KING REVIVED!' ? 'kingRevived'
            : e.e === 'popup' && e.text === 'BAA-BOOM!' ? 'sheepBoom'
            : e.e === 'shatter' && !e.k && e.t !== 'P' ? 'pieceLost'
              : e.e === 'popup' && e.text === 'SHIELD BROKE!' ? 'shieldBroke'
                : e.e === 'popup' && e.text === 'CRUSHED!' ? 'crushed'
                  : e.e === 'popup' && /^CHAIN x/.test(e.text) ? 'chained'
                  : e.e === 'spx' && e.f === 'wool' ? 'sheepStruck'
                : e.e === 'spx' && e.f === 'clang' ? 'helmetClang'
                  : e.e === 'snd' && e.n === 'kick' ? 'kick'
                  : e.e === 'snd' && e.n === 'pickup' ? 'pickup'
                  : e.e === 'sheepIn' ? 'sheepIn' : e.e === 'sheepHop' ? 'sheepHop' : '';
          if (tag) res.ev[tag] = (res.ev[tag] || 0) + 1;
          if (e.e === 'sheepIn' && L.chessRound < GATE_ROUND) res.errors.push('a sheep came through the gates before round ' + GATE_ROUND);
        });
        L.events = [];
        const st = L.chess;
        st.sheep.forEach((id, c) => { if (!L.moveAnim && st.occ[c] && !res.errors.includes('a sheep shares a square with a piece')) res.errors.push('a sheep shares a square with a piece'); });
        if (st.roam.size) {
          const ids = new Set(st.sheep.values());
          st.roam.forEach(id => { if (!ids.has(id) && !res.errors.includes('a wandering sheep id has no sheep')) res.errors.push('a wandering sheep id has no sheep'); });
        }
        if (!GATES && st.roam.size) res.errors.push('sheep wander with the gates off');
        if (L.phase === 'chess' && !L.moveAnim && L.players.some(p => p.alive && BC.Chess.kingCell(st, p.p) < 0) && !res.errors.includes('a player in the game has no king')) res.errors.push('a player in the game has no king');
        const ps = L.bomber;
        if (ps && (ps.bombAt.size !== ps.bombs.length || ps.bombs.some(bm => ps.bombAt.get(bm.cell) !== bm)) && !res.errors.includes('bombAt out of step with the bombs')) res.errors.push('bombAt out of step with the bombs');
        if (ps) ps.bombers.forEach(b => { if (b.kicks < 0 && !res.errors.includes('negative kicks')) res.errors.push('negative kicks'); });
        if (L.special && L.special !== lastSp) res.specials[L.special.k] = (res.specials[L.special.k] || 0) + 1;
        lastSp = L.special;
        if (L.phase !== lastPhase) { if (L.phase === 'bomber') res.rounds++; lastPhase = L.phase; }
        if (L.phase === 'bomber' || steps % 6 === 0) {
          const s = BC.Snap.encode(L, L.rev !== sentRev);
          sentRev = L.rev;
          res.snapBytes += JSON.stringify(s).length;
          res.snaps++;
        }
        steps++;
      }
    } catch (e) {
      res.errors.push(e.stack.split('\n').slice(0, 4).join(' | '));
    }
    res.games++;
    res.minutes += steps * DT / 60;
    const key = L.over ? L.over.reason : 'TIMEOUT';
    res.outcomes[key] = (res.outcomes[key] || 0) + 1;
    L.players.forEach(p => { if (!p.alive) res.outs[p.outReason] = (res.outs[p.outReason] || 0) + 1; });
    const places = L.players.map(p => p.place).filter(Boolean);
    if (L.over && new Set(places).size !== places.length) res.errors.push('places clash ' + JSON.stringify(places));
  }
  console.log(`${n}P ${BC.BRAINS[BRAIN]}${CHAIN ? ' CHAIN' : ''}${GATES ? ' GATES@' + GATE_ROUND : ''}${REVIVE ? ' REVIVE' : ''} POWER-UPS ${BC.POWER_LEVELS[POWER].name}: ${res.games} games, avg ${(res.minutes / res.games).toFixed(1)} min, ${(res.rounds / res.games).toFixed(1)} bomber rounds,` +
    ` outcomes ${JSON.stringify(res.outcomes)}, outs ${JSON.stringify(res.outs)}, slowest tick ${res.slowest.toFixed(1)}ms,` +
    ` avg snapshot ${Math.round(res.snapBytes / res.snaps)}B, specials ${JSON.stringify(res.specials)}, strike kills ${res.strikeKills},` +
    ` events ${JSON.stringify(res.ev)}`);
  res.errors.forEach(e => console.log('  ERROR', e));
}
