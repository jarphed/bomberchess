(function () {
  'use strict';
  const BC = window.BC = window.BC || {};

  BC.W = 1280;
  BC.H = 720;
  BC.BOARD_BOX = { x: 12, y: 12, w: 696, h: 696 };

  BC.PLAYER_COLORS = ['#ff9f1c', '#a466ff', '#4fd13a', '#3fa0ff', '#ff3d5a'];
  BC.PLAYER_DARK = ['#8a4a00', '#4a1e9a', '#1d6e12', '#11468a', '#8a0f22'];
  BC.PLAYER_NAMES = ['1P', '2P', '3P', '4P', '5P'];
  BC.NEUTRAL_COLOR = '#8c8c94';

  BC.PIECE_VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };
  BC.PIECE_NAMES = { K: 'KING', Q: 'QUEEN', R: 'ROOK', B: 'BISHOP', N: 'KNIGHT', P: 'PAWN' };

  // The 1985 Bomberman power-ups, with the detonator swapped for walking bombs and wallpass for X-bombs.
  // info: the longer explanation shown when the power-up is clicked in the in-game power-up column
  BC.POWERUPS = [
    { id: 'bomb', name: 'BOMB UP', jp: 'ボム', desc: '+1 bomb at a time', w: 24,
      info: ['CARRY ONE MORE BOMB AT A TIME.'] },
    { id: 'fire', name: 'FIRE', jp: 'ファイヤー', desc: '+1 blast range', w: 24,
      info: ['YOUR BLASTS REACH ONE CELL FURTHER.'] },
    { id: 'speed', name: 'SPEED', jp: 'スピード', desc: 'Run faster', w: 14,
      info: ['YOUR BOMBER RUNS FASTER.'] },
    { id: 'kick', name: 'KICK', jp: 'キック', desc: 'Kick 3 bombs away', w: 8,
      info: ['RUN INTO A BOMB TO KICK IT. IT SLIDES', 'AWAY UNTIL IT HITS A WALL, A PIECE,', 'ANOTHER BOMB OR A BOMBER. EVERY KICK', 'POWER-UP IS GOOD FOR 3 KICKS. KICKING', 'COMES BEFORE BOMBPASS.'] },
    { id: 'xbomb', name: 'X-BOMB', jp: 'クロスボム', desc: 'Bombs blast diagonally', w: 8,
      info: ['YOUR BOMBS TURN INTO CROSSED DYNAMITE.', 'THE FIRE SPREADS ALONG THE DIAGONALS', '(THE BISHOP LINES), NOT STRAIGHT.'] },
    { id: 'walker', name: 'WALKER', jp: 'ウォークボム', desc: 'Bombs grow legs and run around', w: 8,
      info: ['YOUR BOMBS GROW LEGS AND WANDER OFF', 'ON THEIR OWN. THEY HAVE A LONGER FUSE.'] },
    { id: 'bombpass', name: 'BOMBPASS', jp: 'ボムパス', desc: 'Walk over bombs', w: 8,
      info: ['WALK STRAIGHT OVER BOMBS - YOUR OWN', 'AND EVERYONE ELSE\'S.'] },
    { id: 'flamepass', name: 'FLAMEPASS', jp: 'ファイヤーパス', desc: 'Shield that blocks one blast', w: 5,
      info: ['A SHIELD THAT SOAKS UP ONE BLAST,', 'THEN BREAKS.'] },
    { id: 'mystery', name: 'MYSTERY', jp: 'ミステリー', desc: 'Invincible for 12s', w: 9,
      info: ['NOTHING CAN BLOW YOU UP DURING THE', 'FIRST 12 SECONDS OF THE ROUND.'] },
  ];
  BC.POWERUP_BY_ID = {};
  BC.POWERUPS.forEach(p => { BC.POWERUP_BY_ID[p.id] = p; });
  BC.SPECIALS = ['xbomb', 'walker', 'bombpass', 'flamepass', 'mystery'];
  BC.STAT_MAX = { bomb: 8, fire: 8, speed: 4 };
  // kicks each KICK power-up is good for; they're kept until used
  BC.KICKS = 3;

  // "Brain size of CPU": how sharp the CPU players are (the IQ table in ai.js has one entry per level)
  BC.BRAINS = ['STUPID', 'DIM', 'AVERAGE', 'SHARP', 'GRANDMASTER'];
  BC.BRAIN_DEFAULT = 2;

  // "Power-ups" lobby slider: how many power-ups lie on the chessboard; k scales the normal amount
  BC.POWER_LEVELS = [
    { name: 'CHILLIN\'', k: 0.5 }, { name: 'MILD', k: 0.75 }, { name: 'MEDIUM', k: 1 }, { name: 'SPICY', k: 2 }, { name: 'INSANITY', k: 4 },
  ];
  BC.POWER_DEFAULT = 2;
  BC.powerLevelOf = v => (Number.isInteger(v) ? Math.min(BC.POWER_LEVELS.length - 1, Math.max(0, v)) : BC.POWER_DEFAULT);

  // seconds per chess turn, set in the lobby; running out leaves a sheep on the board
  BC.TURN_TIME = { min: 15, max: 120, step: 15, def: 30 };
  BC.turnTimeOf = v => {
    const T = BC.TURN_TIME;
    v = Number(v);
    if (!isFinite(v)) return T.def;
    return Math.min(T.max, Math.max(T.min, Math.round(v / T.step) * T.step));
  };

  // SHEEP GATES (a lobby option): the gates in the board's corners swing open when the chess round set in the
  // lobby starts (GATE_ROUND), and from then on each gate lets one sheep in at the start of every chess round.
  // GATE_SHEEP caps the wandering sheep on the board at this many per gate.
  BC.GATE_ROUND = { min: 1, max: 12, def: 6 };
  BC.gateRoundOf = v => (Number.isInteger(v) ? Math.min(BC.GATE_ROUND.max, Math.max(BC.GATE_ROUND.min, v)) : BC.GATE_ROUND.def);
  BC.GATE_SHEEP = 3;

  BC.BOARD_LABEL = {
    2: { name: 'SQUARE', jp: 'スクエア' },
    3: { name: 'TRIANGLE', jp: 'トライアングル' },
    4: { name: 'SQUARE CROSS', jp: 'クロス' },
    5: { name: 'PENTAGON', jp: 'ペンタゴン' },
  };

  BC.u = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    pick: arr => arr[Math.floor(Math.random() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    weighted(list) {
      let sum = 0;
      list.forEach(e => { sum += e.w; });
      let r = Math.random() * sum;
      for (const e of list) { r -= e.w; if (r <= 0) return e; }
      return list[list.length - 1];
    },
    easeOutBack(t) {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    hexToRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgba(hex, a) {
      const c = BC.u.hexToRgb(hex);
      return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    },
  };
})();
