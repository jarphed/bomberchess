(function () {
  'use strict';
  const BC = window.BC = window.BC || {};

  // Keyboard schemes for human bombers (assigned in order to human players)
  const SCHEMES = [
    { label: 'WASD  BOMB:SPACE', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], bomb: ['Space'] },
    { label: 'ARROWS  BOMB:ENTER', up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], bomb: ['Enter', 'NumpadEnter'] },
    { label: 'IJKL  BOMB:O', up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], bomb: ['KeyO'] },
    { label: 'TFGH  BOMB:Y', up: ['KeyT'], down: ['KeyG'], left: ['KeyF'], right: ['KeyH'], bomb: ['KeyY'] },
    { label: 'NUMPAD 8456  BOMB:0', up: ['Numpad8'], down: ['Numpad5', 'Numpad2'], left: ['Numpad4'], right: ['Numpad6'], bomb: ['Numpad0'] },
  ];

  const I = {
    SCHEMES,
    keys: new Set(),
    pressed: new Set(),
    mouse: { x: 0, y: 0, clicked: false, rclicked: false, moved: false, down: false },
    pads: [],
    padPrev: [],
    padPressed: [],
    anyInput: false,
  };

  I.init = function (canvas) {
    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Tab']);
    window.addEventListener('keydown', e => {
      if (block.has(e.code)) e.preventDefault();
      if (!e.repeat) { I.pressed.add(e.code); I.anyInput = true; }
      I.keys.add(e.code);
    });
    window.addEventListener('keyup', e => { I.keys.delete(e.code); });
    window.addEventListener('blur', () => I.keys.clear());
    const pos = e => {
      const r = canvas.getBoundingClientRect();
      I.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
      I.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
    };
    canvas.addEventListener('mousemove', e => { pos(e); I.mouse.moved = true; });
    canvas.addEventListener('mousedown', e => {
      pos(e);
      if (e.button === 2) I.mouse.rclicked = true; else { I.mouse.clicked = true; I.mouse.down = true; }
      I.anyInput = true;
    });
    window.addEventListener('mouseup', e => { if (e.button !== 2) I.mouse.down = false; });
    window.addEventListener('blur', () => { I.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  };

  I.pollPads = function () {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    I.pads = [];
    for (const gp of list) if (gp && gp.connected) I.pads.push(gp);
    I.padPressed = I.pads.map((gp, i) => {
      const prev = I.padPrev[i] || [];
      const now = gp.buttons.map(b => b.pressed);
      I.padPrev[i] = now;
      const pr = new Set();
      now.forEach((v, k) => { if (v && !prev[k]) pr.add(k); });
      if (pr.size) I.anyInput = true;
      return pr;
    });
  };

  I.endFrame = function () {
    I.pressed.clear();
    I.mouse.clicked = false;
    I.mouse.rclicked = false;
    I.mouse.moved = false;
    I.anyInput = false;
  };

  const down = codes => codes.some(c => I.keys.has(c));
  const hit = codes => codes.some(c => I.pressed.has(c));
  I.hit = (...codes) => hit(codes);

  function padDir(gp) {
    if (!gp) return [0, 0];
    let dx = 0, dy = 0;
    const b = k => gp.buttons[k] && gp.buttons[k].pressed;
    if (b(12)) dy -= 1;
    if (b(13)) dy += 1;
    if (b(14)) dx -= 1;
    if (b(15)) dx += 1;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.abs(ax) > 0.45) dx += Math.sign(ax);
    if (Math.abs(ay) > 0.45) dy += Math.sign(ay);
    return [Math.sign(dx), Math.sign(dy)];
  }

  // Bomber controls for the k-th human player
  I.bomber = function (k) {
    const s = SCHEMES[k] || SCHEMES[0];
    let dx = 0, dy = 0;
    if (down(s.left)) dx -= 1;
    if (down(s.right)) dx += 1;
    if (down(s.up)) dy -= 1;
    if (down(s.down)) dy += 1;
    let bomb = hit(s.bomb);
    const gp = I.pads[k];
    if (gp) {
      const [px, py] = padDir(gp);
      if (px || py) { dx = px; dy = py; }
      const pr = I.padPressed[k];
      if (pr.has(0) || pr.has(2)) bomb = true;
    }
    return { dx, dy, bomb };
  };

  // Menu navigation from any keyboard scheme or pad
  I.menu = function () {
    const all = key => SCHEMES.some(s => hit(s[key]));
    const m = {
      up: all('up'), down: all('down'), left: all('left'), right: all('right'),
      ok: hit(['Enter', 'Space', 'NumpadEnter']),
      back: hit(['Escape', 'Backspace']),
    };
    I.pads.forEach((gp, i) => {
      const pr = I.padPressed[i];
      if (pr.has(12)) m.up = true;
      if (pr.has(13)) m.down = true;
      if (pr.has(14)) m.left = true;
      if (pr.has(15)) m.right = true;
      if (pr.has(0) || pr.has(9)) m.ok = true;
      if (pr.has(1) || pr.has(8)) m.back = true;
    });
    return m;
  };

  BC.Input = I;
})();
