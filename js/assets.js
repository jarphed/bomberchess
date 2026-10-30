(function () {
  'use strict';
  const BC = window.BC = window.BC || {};

  // Bomb Party sheet (CC-BY 3.0) – 16px grid
  const T = 16;
  const SHEET = {
    charRow: [17, 16, 14, 15, 14], // per player: orange, purple, green, blue, (green hue-shifted to red)
    flameL: [0, 18], flameH: [1, 18], flameC: [2, 18], flameR: [3, 18],
    burst: [[14, 16], [14, 17], [14, 18]],
    bomb: [[4, 18], [5, 18], [6, 18], [7, 18], [8, 18], [9, 18]],
    grassA: [1, 13], grassB: [2, 13], dirt: [0, 13], crate: [9, 13],
    block: [10, 17], wall: [10, 18],
  };
  const PIECE_FILES = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

  const A = {
    T, SHEET, img: {}, ok: {},
    chars: [], charWhite: [], pieces: {}, icons: {}, glyphs: {},
  };

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  A.canvas = canvas;

  function loadImage(key, src) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => { A.img[key] = im; A.ok[key] = true; res(); };
      im.onerror = () => { A.ok[key] = false; res(); };
      im.src = src;
    });
  }

  A.load = function () {
    const jobs = [loadImage('sheet', 'assets/bomb-party/complete_v4.png')];
    Object.keys(PIECE_FILES).forEach(k => jobs.push(loadImage('piece' + k, 'assets/chess-lucas312/' + PIECE_FILES[k] + '.png')));
    return Promise.all(jobs).then(build);
  };

  // tile from sheet into its own canvas
  function tile(col, row, w, h) {
    const [c, g] = canvas((w || 1) * T, (h || 1) * T);
    if (A.ok.sheet) g.drawImage(A.img.sheet, col * T, row * T, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  A.tile = tile;

  function recolor(src, color, op) {
    const [c, g] = canvas(src.width, src.height);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = op;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src, 0, 0);
    return c;
  }

  function silhouette(src, color) {
    const [c, g] = canvas(src.width, src.height);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  A.silhouette = silhouette;

  // ------------------------------------------------------------ pixel glyphs (original art)
  const PAL = {
    k: '#140c1c', w: '#ffffff', g: '#9aa4b8', G: '#5a6278', r: '#e8313c', R: '#8c1822',
    y: '#ffd93d', o: '#ff8a1c', b: '#3fa0ff', B: '#173a8c', n: '#b8562a', N: '#6e2c16',
    m: '#e8c8a0', p: '#ff7ab8', c: '#7ef2ff',
  };
  const GLYPHS = {
    skate: [
      '................',
      '......kkkkk.....',
      '.....kwwwwwk....',
      '.....kwrrrwk....',
      '.....kwwwwwk....',
      '.....kwrrrwk....',
      '.....kwwwwwkkk..',
      '.....kwwwwwwwwk.',
      '....kwwwwwwwwwk.',
      '....krrrrrrrrrk.',
      '....kkkkkkkkkkk.',
      '.....kGk...kGk..',
      '....kgggk.kgggk.',
      '....kgGgk.kgGgk.',
      '.....kkk...kkk..',
      '................',
    ],
    arrow: [
      '................',
      '................',
      '................',
      '................',
      '.........k......',
      '.........kk.....',
      '..kkkkkkkkwk....',
      '..kwwwwwwwwwk...',
      '..kwwwwwwwwwwk..',
      '..kwwwwwwwwwk...',
      '..kkkkkkkkwk....',
      '.........kk.....',
      '.........k......',
      '................',
      '................',
      '................',
    ],
    walker: [
      '...........y....',
      '..........yoy...',
      '...........k....',
      '.....kkkkkk.....',
      '....kGggGGGk....',
      '...kGgGGGGGGk...',
      '...kGwwGGwwGk...',
      '...kGwkGGwkGk...',
      '...kGGGGGGGGk...',
      '...kGGGGGGGGk...',
      '....kGGGGGGk....',
      '.....kkkkkk.....',
      '.....k....k.....',
      '....rrr...k.....',
      '....RRR...rrr...',
      '..........RRR...',
    ],
    // a boot kicking to the right (KICK power-up)
    boot: [
      '................',
      '..kkkkk.........',
      '..kwwwk.........',
      '..knnnk.........',
      '..knnnk.........',
      '..knnnk.........',
      '..knnnk.........',
      '..knnnkkkk......',
      '..knnnnnnnk.....',
      '..knnnnnnnnk....',
      '..knnnnnnnnk....',
      '..kNNNNNNNNk....',
      '..kkkkkkkkkk....',
      '................',
      '................',
      '................',
    ],
    shield: [
      '................',
      '..kkkkkkkkkkkk..',
      '..kbbbbbbbbbbk..',
      '..kbccbbbbbbbk..',
      '..kbcbbbbbbbbk..',
      '..kbbbbbbbbbbk..',
      '..kbbbbbbbbbbk..',
      '..kbbbbbbbbbbk..',
      '...kbbbbbbbbk...',
      '...kbbbbbbbbk...',
      '....kbbbbbbk....',
      '.....kbbbbk.....',
      '......kbbk......',
      '.......kk.......',
      '................',
      '................',
    ],
    question: [
      '................',
      '.....kkkkkk.....',
      '....kyyyyyyk....',
      '...kyykkkkyyk...',
      '...kyyk..kyyk...',
      '....kk..kyyk....',
      '.......kyyk.....',
      '......kyyk......',
      '......kyyk......',
      '.......kk.......',
      '......kkkk......',
      '......kyyk......',
      '......kyyk......',
      '.......kk.......',
      '................',
      '................',
    ],
    crown: [
      '................',
      '................',
      '..k....k....k...',
      '.kyk..kyk..kyk..',
      '.kyyk.kyk.kyyk..',
      '.kyyykyyykyyyk..',
      '.kyyyyyyyyyyyk..',
      '.kyrryyyyyrryk..',
      '.kyyyyyyyyyyyk..',
      '.kkkkkkkkkkkkk..',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    // top-down bomber for the queen's airstrike, nose pointing right
    plane: [
      '................',
      '........kkkk....',
      '........krrk....',
      '........kggk....',
      '.kkk....kggk....',
      '.kgk....kggk....',
      '.kgkkkkkkggkkk..',
      '.kgggwwwwwwwwcck',
      '.kgGGGGGGGGGGGGk',
      '.kGkkkkkkGGkkk..',
      '.kGk....kGGk....',
      '.kkk....kGGk....',
      '........kGGk....',
      '........krrk....',
      '........kkkk....',
      '................',
    ],
  };

  function glyph(rows) {
    const [c, g] = canvas(16, 16);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = PAL[row[x]];
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    });
    return c;
  }

  // ------------------------------------------------------------ power-up panels (20x20)
  const ICON_BG = {
    bomb: ['#3b2a7a', '#6c54d8'], fire: ['#7a1e1e', '#e0482c'], speed: ['#14506e', '#2fb0d8'],
    xbomb: ['#2e2e3a', '#9a9ab0'], walker: ['#145a5a', '#38c8b8'], bombpass: ['#2a5a1e', '#5cc23a'],
    flamepass: ['#6e1450', '#e04ab0'], mystery: ['#6e5a10', '#e8c22c'], kick: ['#5a2a10', '#e8822c'],
  };

  function iconPanel(id) {
    const [c, g] = canvas(20, 20);
    const [d, l] = ICON_BG[id];
    g.fillStyle = '#140c1c'; g.fillRect(1, 0, 18, 20); g.fillRect(0, 1, 20, 18);
    g.fillStyle = d; g.fillRect(1, 1, 18, 18);
    g.fillStyle = l; g.fillRect(2, 2, 16, 15);
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(2, 2, 16, 1); g.fillRect(2, 2, 1, 14);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(2, 16, 16, 1);
    const S = SHEET;
    const sheetGlyph = (pos, x, y, s) => {
      if (!A.ok.sheet) return;
      g.drawImage(A.img.sheet, pos[0] * T, pos[1] * T, T, T, x, y, T * (s || 1), T * (s || 1));
    };
    switch (id) {
      case 'bomb': sheetGlyph(S.bomb[0], 2, 2); break;
      case 'fire': sheetGlyph(S.burst[1], 2, 2); break;
      case 'speed': g.drawImage(A.glyphs.skate, 2, 2); break;
      case 'xbomb': {
        const d = dynamite([45, 135], 1, 5.4);
        g.drawImage(d.img, 0, 1);
        g.fillStyle = '#ffe14a'; g.fillRect(d.tip[0], d.tip[1] + 1, 2, 1); g.fillRect(d.tip[0], d.tip[1], 1, 2);
        g.fillStyle = '#fff'; g.fillRect(d.tip[0], d.tip[1] + 1, 1, 1);
        break;
      }
      case 'walker': g.drawImage(A.glyphs.walker, 2, 2); break;
      case 'bombpass': sheetGlyph(S.bomb[0], 2, 2); g.drawImage(A.glyphs.arrow, 2, 4); break;
      case 'flamepass': sheetGlyph(S.burst[2], 2, 2); g.drawImage(A.glyphs.shield, 5, 5, 12, 12); break;
      case 'mystery': g.drawImage(A.glyphs.question, 2, 2); break;
      case 'kick': sheetGlyph(S.bomb[0], 7, 2, 0.6875); g.drawImage(A.glyphs.boot, 1, 3); break;
    }
    return c;
  }

  // ------------------------------------------------------------ X-bomb: crossed sticks of dynamite
  // One stick per pair of opposite blast directions, so the sticks point where the fire goes: an X on the
  // square boards. Rasterised pixel by pixel on a 20px canvas (16px sprite grid + 2px margin for the fuse)
  // so it stays crisp pixel art at any angle. fuse: 0..1 of the fuse left. Returns { img, tip } where tip
  // is the pixel the spark sits on.
  const DYN = { ink: '#140c1c', hi: '#ff9a8a', red: '#e8313c', mid: '#c42430', dark: '#8c1822', band: '#5a0c14', cap: '#f0dcae', capDark: '#c0a070', wire: '#3a3440', wireHi: '#8a8490' };

  function dynamite(angles, fuse, len) {
    const size = 20, c0 = size / 2, L = len || 6.2, HB = angles.length > 2 ? 1.1 : 1.55;
    const [c, g] = canvas(size, size);
    const sticks = angles.map(a => {
      const dx = Math.cos(a * Math.PI / 180), dy = Math.sin(a * Math.PI / 180);
      // which side of the stick faces the light (top-left)
      return { dx, dy, light: (-dy * -0.6 + dx * -0.8) > 0 ? 1 : -1 };
    });
    const geo = (s, x, y) => {
      const px = x + 0.5 - c0, py = y + 0.5 - c0;
      return { along: px * s.dx + py * s.dy, perp: -px * s.dy + py * s.dx };
    };
    const body = (s, x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      const q = geo(s, x, y);
      return Math.abs(q.perp) <= HB && Math.abs(q.along) <= L;
    };
    // later sticks lie on top: their outline cuts across the stick underneath
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let col = null;
        for (let i = sticks.length - 1; i >= 0 && !col; i--) {
          const s = sticks[i];
          if (body(s, x, y)) {
            const q = geo(s, x, y);
            const aa = Math.abs(q.along), side = q.perp * s.light;
            if (aa > L - 1.1) col = side > 0.3 ? DYN.cap : DYN.capDark;
            else if (aa > L - 2.3 && aa <= L - 1.6) col = DYN.band;
            else col = side >= 1 ? DYN.hi : side > -0.3 ? DYN.red : side > -1 ? DYN.mid : DYN.dark;
          } else if (body(s, x - 1, y) || body(s, x + 1, y) || body(s, x, y - 1) || body(s, x, y + 1)) {
            col = DYN.ink;
          }
        }
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    // the fuse leaves the upper end of the top stick and climbs outwards in a little staircase
    const top = sticks[sticks.length - 1];
    const sg = top.dy > 0 || (top.dy === 0 && top.dx < 0) ? -1 : 1;
    const ux = top.dx * sg, uy = top.dy * sg;
    const sx = Math.abs(ux) < 0.2 ? 1 : Math.sign(ux);
    let fx = Math.floor(c0 + ux * (L + 0.7)), fy = Math.floor(c0 + uy * (L + 0.7));
    const n = Math.round(4 * BC.u.clamp(fuse, 0, 1));
    let tip = [fx, fy];
    for (let k = 0; k < n; k++) {
      if (k > 0) { if (k % 2) fy -= 1; else fx += sx; }
      g.fillStyle = k === n - 1 ? DYN.wireHi : DYN.wire;
      g.fillRect(fx, fy, 1, 1);
      tip = [fx, fy];
    }
    if (n) tip = [tip[0] + (n % 2 ? 0 : sx), tip[1] - (n % 2 ? 1 : 0)];
    tip = [BC.u.clamp(tip[0], 1, size - 2), BC.u.clamp(tip[1], 1, size - 2)];
    return { img: c, tip };
  }
  A.dynamite = dynamite;

  // per-board X-bomb frames (the sticks follow that board's diagonal = bishop lines), fuse burning down
  A.xbombFrames = function (board) {
    if (board.xbombFrames) return board.xbombFrames;
    const seen = new Set();
    board.dirs.forEach(d => { if (d.type === 'B') seen.add(Math.round(((d.ang % 180) + 180) % 180)); });
    const angles = [...seen].sort((a, b) => a - b);
    board.xbombFrames = [1, 0.75, 0.5, 0.25, 0].map(f => {
      const d = dynamite(angles, f);
      d.white = silhouette(d.img, '#ffffff');
      return d;
    });
    return board.xbombFrames;
  };

  // ------------------------------------------------------------ build everything
  function build() {
    Object.keys(GLYPHS).forEach(k => { A.glyphs[k] = glyph(GLYPHS[k]); });

    // character strips: frames 0..9 from sheet, 10..13 = mirrored side frames (facing left)
    for (let p = 0; p < 5; p++) {
      const [c, g] = canvas(14 * T, T);
      if (A.ok.sheet) {
        g.drawImage(A.img.sheet, 0, SHEET.charRow[p] * T, 10 * T, T, 0, 0, 10 * T, T);
        for (let f = 0; f < 4; f++) {
          g.save();
          g.translate((10 + f) * T + T, 0);
          g.scale(-1, 1);
          g.drawImage(A.img.sheet, (4 + f) * T, SHEET.charRow[p] * T, T, T, 0, 0, T, T);
          g.restore();
        }
      }
      A.chars[p] = p === 4 ? recolor(c, '#ff2030', 'hue') : c;
      A.charWhite[p] = silhouette(A.chars[p], '#ffffff');
    }

    // tinted chess pieces per owner (0..4) and neutral (-1)
    const owners = [0, 1, 2, 3, 4, -1];
    owners.forEach(o => {
      A.pieces[o] = {};
      Object.keys(PIECE_FILES).forEach(t => {
        const im = A.img['piece' + t];
        if (!A.ok['piece' + t]) { A.pieces[o][t] = null; return; }
        const color = o < 0 ? BC.NEUTRAL_COLOR : BC.PLAYER_COLORS[o];
        const [c, g] = canvas(im.width, im.height);
        g.drawImage(im, 0, 0);
        const tinted = recolor(c, color, 'multiply');
        // screening the tint onto itself brightens the body while black outlines stay black
        const [c2, g2] = canvas(im.width, im.height);
        g2.drawImage(tinted, 0, 0);
        g2.globalCompositeOperation = 'screen';
        g2.drawImage(tinted, 0, 0);
        A.pieces[o][t] = c2;
      });
    });
    A.pieceWhite = {};
    A.pieceChar = {};
    Object.keys(PIECE_FILES).forEach(t => {
      if (!A.ok['piece' + t]) return;
      A.pieceWhite[t] = silhouette(A.img['piece' + t], '#ffffff');
      A.pieceChar[t] = silhouette(A.img['piece' + t], '#2a2026');
    });

    BC.POWERUPS.forEach(pu => { A.icons[pu.id] = iconPanel(pu.id); });

    A.tiles = {
      grassA: tile(...SHEET.grassA), grassB: tile(...SHEET.grassB), dirt: tile(...SHEET.dirt),
      crate: tile(...SHEET.crate), block: tile(...SHEET.block), wall: tile(...SHEET.wall),
    };
    A.ready = true;
  }

  // Scaled pattern canvases (rebuilt when board scale changes)
  A.patterns = function (ctx, scale) {
    const mk = (src, s) => {
      const [c, g] = canvas(src.width * s, src.height * s);
      g.drawImage(src, 0, 0, c.width, c.height);
      return ctx.createPattern(c, 'repeat');
    };
    const [gc, gg] = canvas(T * 2 * scale, T * 2 * scale);
    const tl = A.tiles;
    const ts = T * scale;
    gg.drawImage(tl.grassA, 0, 0, ts, ts); gg.drawImage(tl.grassB, ts, 0, ts, ts);
    gg.drawImage(tl.grassB, 0, ts, ts, ts); gg.drawImage(tl.grassA, ts, ts, ts, ts);
    return {
      grass: ctx.createPattern(gc, 'repeat'),
      crate: mk(tl.crate, scale), block: mk(tl.block, scale), wall: mk(tl.wall, scale), dirt: mk(tl.dirt, scale),
    };
  };

  BC.Assets = A;
})();
