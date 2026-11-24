window.BC = window.BC || {};

(function () {
  'use strict';

  var MASTER_GAIN = 0.28;
  var SFX_GAIN = 0.72;
  var MUSIC_GAIN = 0.30;
  var LOOKAHEAD = 0.12;
  var TICK_MS = 25;
  var STORAGE_KEY = 'bomberchess.muted';
  var MUSIC_STORAGE_KEY = 'bomberchess.musicMuted';
  var SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  var ctx = null;
  var master = null;
  var sfxBus = null;
  var musicBus = null;
  var noiseBuf = null;
  var waves = {};
  var current = null;
  var lastVariant = {};
  var muted = loadFlag(STORAGE_KEY);
  var musicMuted = loadFlag(MUSIC_STORAGE_KEY);

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function loadFlag(key) {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch (e) {
      return false;
    }
  }

  function storeFlag(key, flag) {
    try {
      window.localStorage.setItem(key, flag ? '1' : '0');
    } catch (e) {
      // Storage may be blocked (file:// in some browsers); state stays in memory.
    }
  }

  // Note name such as 'C#5', 'Eb3' or 'A4' to Hz; 0 if invalid.
  function freqOf(name) {
    var m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if (!m) return 0;
    var midi = (parseInt(m[3], 10) + 1) * 12 + SEMITONE[m[1]];
    if (m[2] === '#') midi += 1;
    if (m[2] === 'b') midi -= 1;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Softened band-limited pulse wave (gentle harmonic roll-off to avoid harsh buzz).
  function pulseWave(duty) {
    var N = 24;
    var re = new Float32Array(N);
    var im = new Float32Array(N);
    for (var n = 1; n < N; n++) {
      var a = Math.PI * n;
      var roll = 1 / (1 + n * n * 0.045);
      re[n] = (2 * Math.sin(2 * a * duty) / a) * roll;
      im[n] = (2 * (1 - Math.cos(2 * a * duty)) / a) * roll;
    }
    return ctx.createPeriodicWave(re, im);
  }

  // Warm electric-piano / marimba harmonic spectrum.
  function warmWave() {
    var re = new Float32Array([0, 0, 0, 0, 0, 0, 0]);
    var im = new Float32Array([0, 1.0, 0.36, 0.14, 0.06, 0.025, 0.01]);
    return ctx.createPeriodicWave(re, im);
  }

  // Soft woody organ/flute tone.
  function fluteWave() {
    var re = new Float32Array([0, 0, 0, 0, 0]);
    var im = new Float32Array([0, 1.0, 0.22, 0.08, 0.02]);
    return ctx.createPeriodicWave(re, im);
  }

  function makeNoise() {
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    // Slightly pink-tinted noise sounds much warmer than raw white noise.
    var b0 = 0, b1 = 0, b2 = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.950 * b2 + w * 0.048;
      data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + w * 0.42) * 0.85));
    }
    return buf;
  }

  function makeWarmSpace(dest, wetLevel, delaySec, cutoff) {
    var send = ctx.createGain();
    send.gain.value = wetLevel;
    var dly = ctx.createDelay(0.5);
    dly.delayTime.value = delaySec;
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    var fb = ctx.createGain();
    fb.gain.value = 0.22;
    send.connect(dly);
    dly.connect(lp);
    lp.connect(dest);
    lp.connect(fb);
    fb.connect(dly);
    return send;
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;

    // Gentle master limiter + warm high-end roll-off prevents any harshness or clipping.
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.008;
    comp.release.value = 0.16;

    var masterLP = ctx.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = 6400;
    masterLP.Q.value = 0.5;

    master.connect(comp);
    comp.connect(masterLP);
    masterLP.connect(ctx.destination);

    // SFX bus: crisp but never shrill, with a tiny touch of room glue.
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_GAIN;
    var sfxLP = ctx.createBiquadFilter();
    sfxLP.type = 'lowpass';
    sfxLP.frequency.value = 5400;
    sfxLP.Q.value = 0.55;
    sfxBus.connect(sfxLP);
    sfxLP.connect(master);
    sfxLP.connect(makeWarmSpace(master, 0.08, 0.11, 2200));

    // Music bus: warm lowpass + soft room echo so music sits comfortably beneath SFX.
    musicBus = ctx.createGain();
    musicBus.gain.value = musicMuted ? 0 : MUSIC_GAIN;
    var musicLP = ctx.createBiquadFilter();
    musicLP.type = 'lowpass';
    musicLP.frequency.value = 2600;
    musicLP.Q.value = 0.5;
    musicBus.connect(musicLP);
    musicLP.connect(master);
    musicLP.connect(makeWarmSpace(master, 0.16, 0.19, 1500));

    noiseBuf = makeNoise();
    waves.p25 = pulseWave(0.25);
    waves.p12 = pulseWave(0.125);
    waves.softSq = pulseWave(0.5);
    waves.warm = warmWave();
    waves.flute = fluteWave();
  }

  function envelope(g, t, dur, vol, decay, atkSec) {
    var a = Math.min(atkSec || 0.008, dur * 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a);
    if (decay) {
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      var r = Math.min(0.045, dur * 0.45);
      g.gain.setValueAtTime(Math.max(0.0002, vol), t + Math.max(a, dur - r));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }
  }

  // wave: 'sine' | 'triangle' | 'softSq' | 'p25' | 'p12' | 'warm' | 'flute' | 'sawtooth'
  // o: optional { to, decay, wob, atk, lp, lpTo, detune }
  function tone(bus, wave, f, t, dur, vol, o) {
    o = o || {};
    var osc = ctx.createOscillator();
    if (wave === 'square') wave = 'softSq';
    if (waves[wave]) osc.setPeriodicWave(waves[wave]);
    else osc.type = wave;
    osc.frequency.setValueAtTime(f, t);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    if (o.wob) {
      for (var k = 1; k <= 64; k++) {
        var p = k / 64;
        osc.frequency.setValueAtTime(f * Math.pow((o.to || f) / f, p) * (1 + o.wob * Math.sin(p * 36)), t + dur * p);
      }
    } else if (o.to) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(15, o.to), t + dur);
    }
    var g = ctx.createGain();
    envelope(g, t, dur, vol, o.decay, o.atk);
    var flt = null;
    if (o.lp) {
      flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = o.q || 0.7;
      flt.frequency.setValueAtTime(o.lp, t);
      if (o.lpTo) flt.frequency.exponentialRampToValueAtTime(Math.max(60, o.lpTo), t + dur);
      osc.connect(flt);
      flt.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    osc.onended = function () {
      osc.disconnect();
      if (flt) flt.disconnect();
      g.disconnect();
    };
  }

  function hit(bus, t, dur, vol, type, f, to, q) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var flt = ctx.createBiquadFilter();
    flt.type = type;
    if (q) flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    if (to) flt.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    var g = ctx.createGain();
    envelope(g, t, dur, vol, true, 0.005);
    src.connect(flt);
    flt.connect(g);
    g.connect(bus);
    src.start(t, Math.random() * noiseBuf.duration);
    src.stop(t + dur + 0.03);
    src.onended = function () {
      src.disconnect();
      flt.disconnect();
      g.disconnect();
    };
  }

  function phrase(bus, wave, names, durs, t, vol, o) {
    var at = t;
    for (var i = 0; i < names.length; i++) {
      var f = freqOf(names[i]);
      if (f) tone(bus, wave, f, at, durs[i], vol, o);
      at += durs[i];
    }
  }

  // Soft, balanced percussion for music tracks.
  function kick(bus, t) {
    tone(bus, 'sine', 120, t, 0.14, 0.52, { to: 42, decay: true, atk: 0.004 });
  }

  function snare(bus, t) {
    hit(bus, t, 0.12, 0.24, 'bandpass', 1500, 900, 0.9);
    tone(bus, 'triangle', 175, t, 0.075, 0.22, { to: 115, decay: true, atk: 0.004 });
  }

  function hat(bus, t) {
    hit(bus, t, 0.028, 0.09, 'bandpass', 5800, 4200, 1.4);
  }

  function rim(bus, t) {
    tone(bus, 'triangle', 760, t, 0.032, 0.14, { to: 460, decay: true, atk: 0.003 });
  }

  function shaker(bus, t) {
    hit(bus, t, 0.04, 0.06, 'bandpass', 4600, 3600, 1.8);
  }

  // Synthesize one choral SATB syllable through parallel vocal formant filters.
  function choirSyllable(bus, t, dur, notes, f1, f2, f3, vol, opts) {
    opts = opts || {};
    var env = ctx.createGain();
    var atk = Math.min(0.036, dur * 0.28);
    var rel = Math.min(0.07, dur * 0.32);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(vol * 0.72, t + atk);
    env.gain.setValueAtTime(vol * 0.72, t + dur - rel);
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    env.connect(bus);

    var sum = ctx.createGain();
    sum.gain.value = 1 / Math.max(1, notes.length);
    var specs = [
      [f1, opts.f1To, 4.5, 1.0],
      [f2, opts.f2To, 5.5, 0.68],
      [f3, null, 6.5, 0.26],
    ];
    var nodes = [env, sum];
    specs.forEach(function (sp) {
      var flt = ctx.createBiquadFilter();
      flt.type = 'bandpass';
      flt.Q.value = sp[2];
      flt.frequency.setValueAtTime(sp[0], t);
      if (sp[1]) flt.frequency.exponentialRampToValueAtTime(sp[1], t + Math.min(0.07, dur * 0.4));
      var fg = ctx.createGain();
      fg.gain.value = sp[3];
      sum.connect(flt);
      flt.connect(fg);
      fg.connect(env);
      nodes.push(flt, fg);
    });

    if (opts.breath) {
      hit(bus, t, 0.04, vol * 0.18, 'bandpass', 1650);
    }

    var warm = ctx.createGain();
    warm.gain.value = 0.24 / Math.max(1, notes.length);
    warm.connect(env);
    nodes.push(warm);

    var left = 0;
    function done() {
      if (--left > 0) return;
      for (var k = 0; k < nodes.length; k++) {
        try { nodes[k].disconnect(); } catch (e) {}
      }
    }

    notes.forEach(function (name) {
      var baseF = freqOf(name);
      if (!baseF) return;
      [-5, 5].forEach(function (cents) {
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(baseF, t);
        osc.detune.setValueAtTime(cents, t);
        if (opts.vib) {
          for (var s = 2; s <= 24; s++) {
            var p = s / 24;
            osc.detune.setValueAtTime(cents + Math.sin(p * 18) * 10, t + dur * p);
          }
        }
        osc.connect(sum);
        left++;
        osc.onended = function () { osc.disconnect(); done(); };
        osc.start(t);
        osc.stop(t + dur + 0.02);
      });
      var sub = ctx.createOscillator();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(baseF, t);
      sub.connect(warm);
      left++;
      sub.onended = function () { sub.disconnect(); done(); };
      sub.start(t);
      sub.stop(t + dur + 0.02);
    });
  }

  var DRUMS = { k: kick, s: snare, h: hat, r: rim, x: shaker };

  var EFFECTS = {
    // ---- UI & navigation (warm wooden/marimba clicks)
    menuMove: function (bus, t) {
      tone(bus, 'warm', 660, t, 0.048, 0.22, { to: 740, decay: true, atk: 0.004 });
    },
    menuSelect: function (bus, t) {
      phrase(bus, 'warm', ['E5', 'A5'], [0.065, 0.14], t, 0.24, { decay: true, lp: 2800 });
    },
    select: function (bus, t) {
      tone(bus, 'warm', 440, t, 0.08, 0.24, { to: 620, decay: true });
    },
    weaponSwitch: function (bus, t) {
      tone(bus, 'triangle', 520, t, 0.035, 0.22, { to: 780, decay: true, atk: 0.003 });
      hit(bus, t, 0.02, 0.12, 'bandpass', 2400);
    },

    // ---- Chess
    move: function (bus, t) {
      tone(bus, 'triangle', 320, t, 0.10, 0.45, { to: 190, decay: true, atk: 0.004 });
      hit(bus, t, 0.025, 0.22, 'bandpass', 1600, 900);
    },
    capture: function (bus, t) {
      hit(bus, t, 0.22, 0.55, 'lowpass', 2000, 240);
      tone(bus, 'triangle', 175, t, 0.20, 0.45, { to: 58, decay: true });
      tone(bus, 'warm', 340, t + 0.015, 0.10, 0.22, { to: 140, decay: true });
    },
    check: function (bus, t) {
      phrase(bus, 'warm', ['A4', 'E5', 'A5'], [0.09, 0.09, 0.18], t, 0.26, { decay: true, lp: 2600 });
      tone(bus, 'triangle', freqOf('A3'), t, 0.36, 0.24, { decay: true });
    },
    promote: function (bus, t) {
      phrase(bus, 'warm', ['C5', 'E5', 'G5', 'B5', 'C6'], [0.055, 0.055, 0.055, 0.055, 0.24], t, 0.26, { decay: true, lp: 3400 });
      tone(bus, 'sine', freqOf('C4'), t, 0.42, 0.22, { decay: true });
    },
    revive: function (bus, t) {
      phrase(bus, 'warm', ['C5', 'E5', 'G5', 'C6', 'E6'], [0.07, 0.07, 0.07, 0.11, 0.38], t, 0.28, { decay: true, lp: 3600 });
      phrase(bus, 'flute', ['G4', 'C5', 'E5', 'G5'], [0.10, 0.10, 0.10, 0.36], t + 0.06, 0.18, { decay: true });
      tone(bus, 'triangle', freqOf('C3'), t, 0.65, 0.32, { decay: true });
    },

    // ---- Bomberman & general gameplay
    pickup: function (bus, t) {
      phrase(bus, 'warm', ['C5', 'E5', 'G5', 'C6'], [0.048, 0.048, 0.048, 0.16], t, 0.24, { decay: true, lp: 3400 });
    },
    bombPlace: function (bus, t) {
      tone(bus, 'sine', 135, t, 0.12, 0.55, { to: 58, decay: true, atk: 0.004 });
      hit(bus, t, 0.03, 0.16, 'lowpass', 550);
    },
    kick: function (bus, t) {
      tone(bus, 'sine', 170, t, 0.08, 0.58, { to: 68, decay: true, atk: 0.004 });
      hit(bus, t, 0.045, 0.25, 'lowpass', 850);
      hit(bus, t + 0.035, 0.18, 0.18, 'bandpass', 750, 2200);
    },
    shield: function (bus, t) {
      tone(bus, 'warm', 980, t, 0.22, 0.26, { to: 1480, decay: true });
      tone(bus, 'sine', 1480, t + 0.03, 0.26, 0.20, { to: 1960, decay: true });
      hit(bus, t, 0.08, 0.16, 'bandpass', 3200, 1800);
    },
    explode: function (bus, t) {
      hit(bus, t, 0.52, 0.72, 'lowpass', 1650, 140);
      tone(bus, 'sine', 105, t, 0.48, 0.70, { to: 28, decay: true, atk: 0.004 });
      tone(bus, 'triangle', 72, t + 0.02, 0.32, 0.30, { to: 32, decay: true });
    },
    wake: function (bus, t) {
      tone(bus, 'warm', 260, t, 0.09, 0.24, { to: 620, lp: 2200 });
      tone(bus, 'warm', 480, t + 0.09, 0.15, 0.24, { to: 960, wob: 0.05, lp: 2400 });
    },
    death: function (bus, t) {
      tone(bus, 'warm', 520, t, 0.75, 0.30, { to: 95, wob: 0.04, lp: 1800, lpTo: 320 });
      tone(bus, 'triangle', 260, t + 0.06, 0.65, 0.24, { to: 65, decay: true });
    },
    splat: function (bus, t) {
      hit(bus, t, 0.24, 0.56, 'lowpass', 1150, 150);
      tone(bus, 'sine', 210, t, 0.19, 0.50, { to: 52, decay: true });
      hit(bus, t + 0.055, 0.14, 0.28, 'bandpass', 640, 240);
    },

    // ---- Worms-specific sound effects
    jump: function (bus, t) {
      tone(bus, 'sine', 230, t, 0.14, 0.30, { to: 520, decay: true, atk: 0.005 });
      tone(bus, 'triangle', 340, t + 0.02, 0.11, 0.16, { to: 660, decay: true });
    },
    backflip: function (bus, t) {
      tone(bus, 'warm', 320, t, 0.12, 0.24, { to: 720, decay: true });
      tone(bus, 'warm', 520, t + 0.07, 0.14, 0.22, { to: 980, decay: true });
    },
    land: function (bus, t) {
      tone(bus, 'sine', 110, t, 0.06, 0.22, { to: 55, decay: true, atk: 0.003 });
      hit(bus, t, 0.03, 0.12, 'lowpass', 520);
    },
    rocket: function (bus, t) {
      tone(bus, 'sine', 160, t, 0.14, 0.45, { to: 65, decay: true, atk: 0.004 });
      hit(bus, t, 0.28, 0.36, 'bandpass', 720, 1800, 0.9);
    },
    throw: function (bus, t) {
      hit(bus, t, 0.13, 0.24, 'bandpass', 620, 1750, 1.2);
      tone(bus, 'sine', 280, t, 0.09, 0.18, { to: 510, decay: true });
    },
    mortar: function (bus, t) {
      tone(bus, 'sine', 140, t, 0.22, 0.62, { to: 48, decay: true, atk: 0.004 });
      tone(bus, 'triangle', 260, t, 0.12, 0.28, { to: 95, decay: true });
      hit(bus, t, 0.16, 0.34, 'lowpass', 950, 220);
    },
    drill: function (bus, t) {
      tone(bus, 'p25', 145, t, 0.14, 0.22, { to: 110, wob: 0.12, lp: 950 });
      hit(bus, t, 0.14, 0.28, 'bandpass', 1200, 620, 1.2);
    },
    bounce: function (bus, t) {
      tone(bus, 'triangle', 540, t, 0.055, 0.24, { to: 360, decay: true, atk: 0.003 });
      hit(bus, t, 0.025, 0.14, 'bandpass', 1800, 1100);
    },
    splash: function (bus, t) {
      hit(bus, t, 0.42, 0.48, 'bandpass', 1400, 320, 0.7);
      tone(bus, 'sine', 340, t, 0.14, 0.30, { to: 120, decay: true });
      tone(bus, 'sine', 520, t + 0.08, 0.12, 0.18, { to: 290, decay: true });
      hit(bus, t + 0.06, 0.32, 0.24, 'bandpass', 2400, 800, 1.1);
    },
    crateLand: function (bus, t) {
      tone(bus, 'triangle', 190, t, 0.09, 0.32, { to: 92, decay: true, atk: 0.004 });
      hit(bus, t, 0.045, 0.18, 'lowpass', 720);
    },
    hurt: function (bus, t) {
      tone(bus, 'warm', 420, t, 0.16, 0.26, { to: 210, decay: true, lp: 1800 });
    },

    // ---- Phase transitions & alerts
    phaseBomber: function (bus, t) {
      phrase(bus, 'warm', ['C5', 'E5', 'G5', 'C6'], [0.09, 0.09, 0.09, 0.36], t, 0.28, { decay: true, lp: 3000 });
      tone(bus, 'triangle', freqOf('C3'), t, 0.62, 0.38, { decay: true });
    },
    phaseWorms: function (bus, t) {
      phrase(bus, 'warm', ['G4', 'B4', 'D5', 'G5'], [0.085, 0.085, 0.085, 0.36], t, 0.28, { decay: true, lp: 2800 });
      phrase(bus, 'flute', ['D4', 'G4', 'B4', 'D5'], [0.085, 0.085, 0.085, 0.36], t + 0.02, 0.16, { decay: true });
      tone(bus, 'triangle', freqOf('G2'), t, 0.62, 0.36, { decay: true });
    },
    phaseChess: function (bus, t) {
      phrase(bus, 'flute', ['D4', 'G4', 'A4', 'D5'], [0.16, 0.16, 0.16, 0.45], t, 0.34, { decay: true });
      tone(bus, 'sine', freqOf('G3'), t, 0.85, 0.24, { decay: true });
    },
    yourTurn: function (bus, t) {
      phrase(bus, 'warm', ['C5', 'E5', 'G5', 'C6'], [0.065, 0.065, 0.065, 0.26], t, 0.26, { decay: true, lp: 3000 });
      phrase(bus, 'flute', ['G4', 'C5', 'E5', 'G5'], [0.065, 0.065, 0.065, 0.26], t + 0.02, 0.15, { decay: true });
      tone(bus, 'triangle', freqOf('C3'), t, 0.42, 0.30, { decay: true });
    },
    tick: function (bus, t) {
      tone(bus, 'sine', 960, t, 0.04, 0.24, { decay: true, atk: 0.003 });
    },
    tickHi: function (bus, t) {
      tone(bus, 'warm', 1180, t, 0.05, 0.22, { decay: true, atk: 0.003 });
      tone(bus, 'sine', 1480, t + 0.065, 0.045, 0.20, { decay: true, atk: 0.003 });
    },
    baa: function (bus, t) {
      tone(bus, 'p25', 490, t, 0.38, 0.22, { to: 410, wob: 0.18, lp: 1500 });
      tone(bus, 'warm', 980, t, 0.38, 0.07, { to: 820, wob: 0.18, lp: 2000 });
    },
    gate: function (bus, t) {
      tone(bus, 'p25', 195, t, 0.42, 0.14, { to: 145, wob: 0.20, lp: 800 });
      hit(bus, t + 0.44, 0.07, 0.32, 'bandpass', 1500);
      tone(bus, 'triangle', 740, t + 0.44, 0.06, 0.18, { decay: true });
    },
    chain: function (bus, t) {
      phrase(bus, 'warm', ['E5', 'B5', 'E6'], [0.05, 0.05, 0.15], t, 0.22, { decay: true, lp: 3200 });
    },
    thud: function (bus, t) {
      hit(bus, t, 0.20, 0.55, 'lowpass', 720, 110);
      tone(bus, 'sine', 125, t, 0.18, 0.58, { to: 42, decay: true, atk: 0.004 });
    },
    gameOver: function (bus, t) {
      phrase(bus, 'flute', ['G4', 'F4', 'Eb4', 'D4'], [0.22, 0.22, 0.22, 0.55], t, 0.36, { decay: true });
      tone(bus, 'triangle', freqOf('G2'), t, 1.1, 0.28, { decay: true });
    },
    win: function (bus, t) {
      phrase(bus, 'warm', ['C5', 'E5', 'G5', 'C6', 'B5', 'C6'], [0.09, 0.09, 0.09, 0.22, 0.09, 0.50], t, 0.28, { decay: true, lp: 3400 });
      tone(bus, 'triangle', freqOf('C3'), t, 0.55, 0.36, { decay: true });
      tone(bus, 'triangle', freqOf('G3'), t + 0.55, 0.55, 0.36, { decay: true });
    },

    // ---- Special captures
    rumble: function (bus, t) {
      hit(bus, t, 0.85, 0.48, 'lowpass', 240, 80);
      tone(bus, 'triangle', 55, t, 0.78, 0.38, { to: 38, wob: 0.12 });
    },
    crack: function (bus, t) {
      hit(bus, t, 0.11, 0.58, 'bandpass', 2000, 800, 0.8);
      tone(bus, 'triangle', 290, t, 0.16, 0.32, { to: 68, decay: true });
    },
    shotgun: function (bus, t) {
      hit(bus, t, 0.055, 0.68, 'bandpass', 2400, 1200, 0.7);
      hit(bus, t, 0.24, 0.65, 'lowpass', 2100, 190);
      tone(bus, 'sine', 155, t, 0.18, 0.65, { to: 42, decay: true, atk: 0.003 });
      hit(bus, t + 0.16, 0.06, 0.22, 'bandpass', 1650, 950);
    },
    crash: function (bus, t) {
      hit(bus, t, 0.82, 0.68, 'lowpass', 1450, 110);
      hit(bus, t + 0.05, 0.45, 0.35, 'bandpass', 820, 260);
      tone(bus, 'sine', 88, t, 0.65, 0.65, { to: 28, decay: true });
    },
    neigh: function (bus, t) {
      tone(bus, 'p25', 920, t, 0.40, 0.20, { to: 620, wob: 0.10, lp: 2000 });
      tone(bus, 'p25', 660, t + 0.38, 0.28, 0.18, { to: 380, wob: 0.07, lp: 1700 });
    },
    clop: function (bus, t) {
      tone(bus, 'triangle', 680, t, 0.04, 0.26, { to: 420, decay: true, atk: 0.003 });
      tone(bus, 'triangle', 540, t + 0.065, 0.04, 0.22, { to: 340, decay: true, atk: 0.003 });
      hit(bus, t, 0.025, 0.18, 'bandpass', 1500);
    },
    ascend: function (bus, t) {
      phrase(bus, 'flute', ['C5', 'E5', 'G5', 'C6'], [0.07, 0.07, 0.07, 0.32], t, 0.30, { decay: true });
      tone(bus, 'sine', freqOf('G5'), t + 0.21, 0.35, 0.16, { decay: true });
    },
    thunder: function (bus, t) {
      hit(bus, t, 0.16, 0.62, 'bandpass', 2100, 900, 0.6);
      hit(bus, t + 0.02, 1.6, 0.68, 'lowpass', 1350, 65);
      tone(bus, 'sine', 68, t, 1.3, 0.60, { to: 26, decay: true });
    },
    siren: function (bus, t) {
      tone(bus, 'flute', 420, t, 0.55, 0.18, { to: 820 });
      tone(bus, 'flute', 820, t + 0.55, 0.55, 0.18, { to: 420 });
    },
    plane: function (bus, t) {
      tone(bus, 'triangle', 74, t, 2.2, 0.20, { to: 60, wob: 0.04 });
      hit(bus, t, 2.2, 0.16, 'bandpass', 240, 165);
    },
    whistle: function (bus, t) {
      tone(bus, 'sine', 1380, t, 0.48, 0.16, { to: 460 });
    },
    alarm: function (bus, t) {
      phrase(bus, 'warm', ['A4', 'D4', 'A4'], [0.16, 0.16, 0.16], t, 0.24, { lp: 1800 });
    },
    nuke: function (bus, t) {
      hit(bus, t, 0.22, 0.65, 'bandpass', 1600, 600, 0.7);
      hit(bus, t, 2.5, 0.72, 'lowpass', 2200, 50);
      tone(bus, 'sine', 92, t, 2.2, 0.75, { to: 20, decay: true });
      tone(bus, 'triangle', 58, t + 0.25, 1.8, 0.45, { to: 26, wob: 0.15 });
    },
    clang: function (bus, t) {
      hit(bus, t, 0.04, 0.30, 'bandpass', 3200, 1800);
      tone(bus, 'warm', 1240, t, 0.30, 0.20, { decay: true });
      tone(bus, 'triangle', 1860, t, 0.42, 0.22, { decay: true });
      tone(bus, 'triangle', 930, t + 0.02, 0.34, 0.20, { to: 890, decay: true });
    },
    hallelujah: function (bus, t) {
      choirSyllable(bus, t, 0.17, ['D3', 'A3', 'F#4', 'D5'], 780, 1220, 2650, 0.92, { breath: true });
      choirSyllable(bus, t + 0.18, 0.14, ['E3', 'A3', 'E4', 'C#5'], 530, 1840, 2550, 0.88);
      choirSyllable(bus, t + 0.33, 0.20, ['F#3', 'B3', 'F#4', 'D5'], 330, 840, 2400, 0.92);
      choirSyllable(bus, t + 0.54, 0.58, ['D3', 'A3', 'F#4', 'A4', 'D5', 'F#5'], 320, 2050, 2750, 1.05, {
        f1To: 820, f2To: 1240, vib: true
      });
    }
  };

  function joinBars(bars) {
    return [].concat.apply([], bars);
  }

  // Multiple warm, varied 16-bar musical versions per game phase.
  // Each note is [noteName or null, length in 16th steps]; each bar is 16 steps.
  var TRACKS = {
    title: [
      {
        // Version 1: Warm upbeat chiptune-lofi overture in C major
        bpm: 120,
        voices: [
          { wave: 'warm', vol: 0.34, lp: 2200, decay: true, notes: joinBars([
            [['E5', 2], ['G5', 2], ['A5', 4], ['G5', 2], ['E5', 2], ['D5', 2], ['C5', 2]],
            [['C5', 4], ['D5', 2], ['E5', 2], ['G5', 4], ['A5', 2], ['G5', 2]],
            [['A5', 2], ['G5', 2], ['E5', 4], ['G5', 2], ['A5', 2], ['C6', 4]],
            [['G5', 2], ['E5', 2], ['D5', 4], ['E5', 2], ['G5', 2], ['E5', 4]],
            [['C6', 2], ['A5', 2], ['G5', 4], ['A5', 2], ['C6', 2], ['D6', 4]],
            [['E6', 4], ['D6', 2], ['C6', 2], ['A5', 4], ['G5', 2], ['E5', 2]],
            [['D5', 2], ['E5', 2], ['G5', 2], ['A5', 2], ['G5', 4], ['E5', 4]],
            [['G5', 2], ['A5', 2], ['C6', 2], ['A5', 2], ['G5', 4], [null, 4]],
            [['E5', 4], ['G5', 4], ['C6', 4], ['B5', 4]],
            [['A5', 4], ['G5', 4], ['E5', 4], ['D5', 4]],
            [['F5', 4], ['A5', 4], ['G5', 4], ['E5', 4]],
            [['D5', 6], ['E5', 2], ['G5', 4], [null, 4]],
            [['C6', 4], ['B5', 2], ['A5', 2], ['G5', 4], ['E5', 4]],
            [['F5', 4], ['E5', 2], ['D5', 2], ['E5', 4], ['G5', 4]],
            [['A5', 4], ['G5', 4], ['E5', 4], ['D5', 4]],
            [['C5', 8], [null, 8]]
          ]) },
          { wave: 'flute', vol: 0.16, atk: 0.03, notes: joinBars([
            [['C4', 8], ['E4', 8]], [['B3', 8], ['D4', 8]],
            [['A3', 8], ['C4', 8]], [['F3', 8], ['A3', 8]],
            [['C4', 8], ['E4', 8]], [['B3', 8], ['D4', 8]],
            [['F3', 8], ['A3', 8]], [['G3', 8], ['B3', 8]],
            [['C4', 8], ['G4', 8]], [['A3', 8], ['E4', 8]],
            [['F3', 8], ['C4', 8]], [['G3', 8], ['D4', 8]],
            [['A3', 8], ['E4', 8]], [['F3', 8], ['C4', 8]],
            [['D4', 8], ['G3', 8]], [['C4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.42, notes: joinBars([
            [['C3', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['G2', 4], ['D3', 4], ['G2', 4], ['D3', 4]],
            [['A2', 4], ['E3', 4], ['A2', 4], ['E3', 4]],
            [['F2', 4], ['C3', 4], ['F2', 4], ['C3', 4]],
            [['C3', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['G2', 4], ['D3', 4], ['G2', 4], ['D3', 4]],
            [['F2', 4], ['C3', 4], ['A2', 4], ['E3', 4]],
            [['G2', 4], ['D3', 4], ['G2', 4], ['B2', 4]],
            [['C3', 8], ['G2', 8]], [['A2', 8], ['E2', 8]],
            [['F2', 8], ['C3', 8]], [['G2', 8], ['D3', 8]],
            [['A2', 8], ['E3', 8]], [['F2', 8], ['C3', 8]],
            [['D2', 8], ['G2', 8]], [['C3', 8], ['G2', 8]]
          ]) }
        ],
        drums: 'k.h.s.h.k.h.s.x.'
      },
      {
        // Version 2: Breezy F-major arcade adventure theme
        bpm: 126,
        voices: [
          { wave: 'warm', vol: 0.34, lp: 2100, decay: true, notes: joinBars([
            [['F5', 4], ['A5', 2], ['G5', 2], ['F5', 4], ['C5', 4]],
            [['D5', 4], ['F5', 2], ['G5', 2], ['A5', 8]],
            [['Bb5', 4], ['A5', 2], ['G5', 2], ['F5', 4], ['D5', 4]],
            [['C5', 4], ['D5', 2], ['F5', 2], ['G5', 8]],
            [['A5', 4], ['C6', 2], ['Bb5', 2], ['A5', 4], ['F5', 4]],
            [['G5', 4], ['A5', 2], ['G5', 2], ['F5', 4], ['D5', 4]],
            [['C5', 2], ['D5', 2], ['F5', 4], ['G5', 4], ['A5', 4]],
            [['F5', 8], [null, 8]],
            [['C6', 4], ['A5', 4], ['G5', 4], ['F5', 4]],
            [['Bb5', 4], ['G5', 4], ['F5', 4], ['D5', 4]],
            [['A5', 4], ['F5', 4], ['E5', 4], ['D5', 4]],
            [['C5', 6], ['D5', 2], ['E5', 4], ['G5', 4]],
            [['A5', 4], ['Bb5', 4], ['C6', 4], ['A5', 4]],
            [['G5', 4], ['F5', 4], ['D5', 4], ['F5', 4]],
            [['G5', 4], ['A5', 4], ['G5', 4], ['E5', 4]],
            [['F5', 12], [null, 4]]
          ]) },
          { wave: 'p25', vol: 0.14, lp: 1500, decay: true, notes: joinBars([
            [['C4', 2], ['F4', 2], ['A4', 2], ['F4', 2], ['C4', 2], ['F4', 2], ['A4', 2], ['F4', 2]],
            [['D4', 2], ['F4', 2], ['A4', 2], ['F4', 2], ['D4', 2], ['F4', 2], ['A4', 2], ['F4', 2]],
            [['Bb3', 2], ['D4', 2], ['F4', 2], ['D4', 2], ['Bb3', 2], ['D4', 2], ['F4', 2], ['D4', 2]],
            [['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2], ['C4', 2], ['E4', 2], ['G4', 2], ['E4', 2]],
            [['C4', 2], ['F4', 2], ['A4', 2], ['F4', 2], ['C4', 2], ['F4', 2], ['A4', 2], ['F4', 2]],
            [['Bb3', 2], ['D4', 2], ['G4', 2], ['D4', 2], ['Bb3', 2], ['D4', 2], ['F4', 2], ['D4', 2]],
            [['C4', 4], ['F4', 4], ['C4', 4], ['E4', 4]],
            [['C4', 4], ['F4', 4], ['A4', 4], ['F4', 4]],
            [['A3', 4], ['C4', 4], ['F4', 4], ['C4', 4]],
            [['Bb3', 4], ['D4', 4], ['G4', 4], ['D4', 4]],
            [['A3', 4], ['D4', 4], ['F4', 4], ['D4', 4]],
            [['G3', 4], ['C4', 4], ['E4', 4], ['C4', 4]],
            [['F3', 4], ['A3', 4], ['C4', 4], ['F4', 4]],
            [['Bb3', 4], ['D4', 4], ['F4', 4], ['D4', 4]],
            [['C4', 4], ['E4', 4], ['G4', 4], ['E4', 4]],
            [['F3', 8], ['C4', 8]]
          ]) },
          { wave: 'triangle', vol: 0.42, notes: joinBars([
            [['F2', 4], ['C3', 4], ['F2', 4], ['C3', 4]],
            [['D2', 4], ['A2', 4], ['D2', 4], ['A2', 4]],
            [['Bb2', 4], ['F2', 4], ['Bb2', 4], ['F2', 4]],
            [['C3', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['F2', 4], ['C3', 4], ['F2', 4], ['C3', 4]],
            [['G2', 4], ['D3', 4], ['Bb2', 4], ['F2', 4]],
            [['C3', 8], ['C2', 8]],
            [['F2', 4], ['C3', 4], ['F2', 8]],
            [['F2', 8], ['C3', 8]], [['G2', 8], ['Bb2', 8]],
            [['D2', 8], ['A2', 8]], [['C2', 8], ['G2', 8]],
            [['F2', 8], ['A2', 8]], [['Bb2', 8], ['G2', 8]],
            [['C3', 8], ['C2', 8]], [['F2', 16]]
          ]) }
        ],
        drums: 'k.x.r.h.k.h.s.x.'
      }
    ],

    chess: [
      {
        // Version 1: Calm A-minor electric piano & flute study
        bpm: 92,
        voices: [
          { wave: 'warm', vol: 0.30, lp: 1800, decay: true, notes: joinBars([
            [['A4', 6], ['C5', 2], ['D5', 4], ['E5', 4]],
            [['E5', 4], ['D5', 4], ['C5', 8]],
            [['G4', 4], ['A4', 4], ['C5', 4], ['D5', 4]],
            [['E5', 8], [null, 4], ['D5', 4]],
            [['D5', 4], ['C5', 4], ['A4', 4], ['G4', 4]],
            [['A4', 6], ['C5', 2], ['D5', 4], ['E5', 4]],
            [['G5', 6], ['E5', 2], ['D5', 4], ['C5', 4]],
            [['A4', 12], [null, 4]],
            [['E5', 6], ['G5', 2], ['A5', 4], ['G5', 4]],
            [['F5', 4], ['E5', 4], ['D5', 8]],
            [['D5', 6], ['E5', 2], ['F5', 4], ['E5', 4]],
            [['C5', 8], ['B4', 8]],
            [['A4', 4], ['C5', 4], ['E5', 4], ['D5', 4]],
            [['C5', 4], ['B4', 4], ['A4', 4], ['G4', 4]],
            [['A4', 4], ['C5', 4], ['B4', 4], ['G4', 4]],
            [['A4', 12], [null, 4]]
          ]) },
          { wave: 'flute', vol: 0.14, atk: 0.04, notes: joinBars([
            [['E4', 16]], [['F4', 16]], [['D4', 16]], [['E4', 16]],
            [['D4', 16]], [['C4', 8], ['D4', 8]], [['E4', 8], ['B3', 8]], [['C4', 16]],
            [['C4', 16]], [['A3', 16]], [['B3', 16]], [['G#3', 16]],
            [['C4', 16]], [['A3', 16]], [['B3', 8], ['G3', 8]], [['A3', 16]]
          ]) },
          { wave: 'triangle', vol: 0.36, notes: joinBars([
            [['A2', 8], ['E2', 8]], [['D2', 8], ['A2', 8]],
            [['F2', 8], ['C3', 8]], [['E2', 8], ['B2', 8]],
            [['D2', 8], ['A2', 8]], [['F2', 8], ['G2', 8]],
            [['A2', 8], ['E2', 8]], [['A2', 8], ['G2', 8]],
            [['A2', 8], ['G2', 8]], [['F2', 8], ['D2', 8]],
            [['G2', 8], ['F2', 8]], [['E2', 16]],
            [['A2', 8], ['G2', 8]], [['F2', 8], ['E2', 8]],
            [['D2', 8], ['E2', 8]], [['A2', 16]]
          ]) }
        ],
        drums: '....x.......r...'
      },
      {
        // Version 2: Warm D-dorian lo-fi lounge tactics groove
        bpm: 96,
        voices: [
          { wave: 'warm', vol: 0.30, lp: 1750, decay: true, notes: joinBars([
            [['D5', 4], ['F5', 4], ['A5', 4], ['G5', 4]],
            [['F5', 6], ['E5', 2], ['D5', 8]],
            [['C5', 4], ['E5', 4], ['G5', 4], ['F5', 4]],
            [['E5', 6], ['D5', 2], ['C5', 8]],
            [['D5', 4], ['E5', 2], ['F5', 2], ['G5', 4], ['A5', 4]],
            [['B5', 4], ['A5', 4], ['G5', 8]],
            [['F5', 4], ['E5', 4], ['D5', 4], ['C5', 4]],
            [['D5', 12], [null, 4]],
            [['A5', 6], ['G5', 2], ['F5', 4], ['E5', 4]],
            [['F5', 4], ['G5', 4], ['A5', 8]],
            [['G5', 6], ['F5', 2], ['E5', 4], ['D5', 4]],
            [['E5', 4], ['F5', 4], ['G5', 8]],
            [['F5', 4], ['A5', 4], ['G5', 4], ['E5', 4]],
            [['D5', 4], ['F5', 4], ['E5', 4], ['C5', 4]],
            [['D5', 4], ['E5', 4], ['F5', 4], ['E5', 4]],
            [['D5', 12], [null, 4]]
          ]) },
          { wave: 'sine', vol: 0.16, atk: 0.03, notes: joinBars([
            [['F4', 8], ['A4', 8]], [['F4', 8], ['A4', 8]],
            [['E4', 8], ['G4', 8]], [['E4', 8], ['G4', 8]],
            [['F4', 8], ['A4', 8]], [['G4', 8], ['B4', 8]],
            [['F4', 8], ['E4', 8]], [['F4', 16]],
            [['A4', 8], ['C5', 8]], [['A4', 8], ['C5', 8]],
            [['G4', 8], ['B4', 8]], [['G4', 8], ['B4', 8]],
            [['A4', 8], ['G4', 8]], [['F4', 8], ['E4', 8]],
            [['F4', 8], ['G4', 8]], [['F4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.36, notes: joinBars([
            [['D2', 4], ['A2', 4], ['D3', 4], ['A2', 4]],
            [['D2', 4], ['A2', 4], ['F2', 4], ['A2', 4]],
            [['C2', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['C2', 4], ['G2', 4], ['E2', 4], ['G2', 4]],
            [['D2', 4], ['A2', 4], ['F2', 4], ['A2', 4]],
            [['G2', 4], ['D3', 4], ['B2', 4], ['G2', 4]],
            [['A2', 8], ['G2', 8]], [['D2', 8], ['A2', 8]],
            [['D2', 8], ['F2', 8]], [['G2', 8], ['A2', 8]],
            [['C2', 8], ['E2', 8]], [['G2', 8], ['A2', 8]],
            [['D2', 8], ['C3', 8]], [['Bb2', 8], ['A2', 8]],
            [['G2', 8], ['A2', 8]], [['D2', 16]]
          ]) }
        ],
        drums: 'k...x...r...x...'
      },
      {
        // Version 3: Serene G-minor music-box & cello nocturne
        bpm: 86,
        voices: [
          { wave: 'flute', vol: 0.28, decay: true, notes: joinBars([
            [['G4', 4], ['Bb4', 4], ['D5', 8]],
            [['C5', 4], ['Bb4', 4], ['A4', 8]],
            [['Bb4', 4], ['D5', 4], ['F5', 8]],
            [['E5', 4], ['D5', 4], ['C5', 8]],
            [['D5', 6], ['C5', 2], ['Bb4', 4], ['A4', 4]],
            [['G4', 4], ['A4', 4], ['Bb4', 8]],
            [['A4', 4], ['G4', 4], ['F#4', 8]],
            [['G4', 12], [null, 4]],
            [['G5', 6], ['F5', 2], ['Eb5', 4], ['D5', 4]],
            [['C5', 4], ['D5', 4], ['Eb5', 8]],
            [['F5', 6], ['Eb5', 2], ['D5', 4], ['C5', 4]],
            [['Bb4', 4], ['C5', 4], ['D5', 8]],
            [['Eb5', 4], ['D5', 4], ['C5', 4], ['Bb4', 4]],
            [['A4', 4], ['Bb4', 4], ['C5', 8]],
            [['D5', 4], ['C5', 4], ['Bb4', 4], ['A4', 4]],
            [['G4', 12], [null, 4]]
          ]) },
          { wave: 'sine', vol: 0.14, atk: 0.05, notes: joinBars([
            [['D4', 16]], [['C4', 16]], [['D4', 16]], [['C4', 16]],
            [['Bb3', 16]], [['Bb3', 16]], [['A3', 16]], [['Bb3', 16]],
            [['Bb3', 16]], [['C4', 16]], [['A3', 16]], [['Bb3', 16]],
            [['C4', 16]], [['C4', 16]], [['D4', 8], ['C4', 8]], [['Bb3', 16]]
          ]) },
          { wave: 'triangle', vol: 0.36, notes: joinBars([
            [['G2', 8], ['D3', 8]], [['F2', 8], ['C3', 8]],
            [['Eb2', 8], ['Bb2', 8]], [['D2', 8], ['A2', 8]],
            [['G2', 8], ['D3', 8]], [['Eb2', 8], ['Bb2', 8]],
            [['C2', 8], ['D2', 8]], [['G2', 16]],
            [['Eb2', 8], ['Bb2', 8]], [['C2', 8], ['G2', 8]],
            [['F2', 8], ['C3', 8]], [['Bb2', 8], ['F2', 8]],
            [['C2', 8], ['G2', 8]], [['F2', 8], ['Eb2', 8]],
            [['D2', 16]], [['G2', 16]]
          ]) }
        ],
        drums: '........x.......'
      }
    ],

    bomber: [
      {
        // Version 1: Punchy warm E-minor retro action groove
        bpm: 142,
        voices: [
          { wave: 'p25', vol: 0.26, lp: 1950, decay: true, notes: joinBars([
            [['E5', 2], ['G5', 2], ['A5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['A5', 2], ['G5', 2]],
            [['E5', 2], ['G5', 2], ['A5', 2], ['B5', 2], ['A5', 4], ['G5', 2], ['E5', 2]],
            [['D5', 2], ['E5', 2], ['G5', 2], ['A5', 2], ['B5', 4], ['A5', 2], ['G5', 2]],
            [['B5', 2], ['A5', 2], ['G5', 2], ['E5', 2], ['G5', 4], ['E5', 4]],
            [['E6', 2], ['D6', 2], ['B5', 2], ['A5', 2], ['B5', 4], ['D6', 4]],
            [['G5', 2], ['A5', 2], ['B5', 2], ['D6', 2], ['E6', 4], ['D6', 2], ['B5', 2]],
            [['A5', 2], ['G5', 2], ['A5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['A5', 2], ['G5', 2]],
            [['E5', 4], ['G5', 2], ['A5', 2], ['B5', 4], [null, 4]],
            [['B5', 2], ['B5', 2], ['D6', 4], ['B5', 2], ['A5', 2], ['G5', 4]],
            [['A5', 2], ['A5', 2], ['C6', 4], ['A5', 2], ['G5', 2], ['E5', 4]],
            [['G5', 2], ['G5', 2], ['B5', 4], ['A5', 2], ['G5', 2], ['F#5', 4]],
            [['E5', 2], ['F#5', 2], ['G5', 2], ['A5', 2], ['B5', 8]],
            [['E6', 4], ['D6', 2], ['B5', 2], ['A5', 4], ['G5', 4]],
            [['A5', 4], ['B5', 2], ['A5', 2], ['G5', 4], ['E5', 4]],
            [['D5', 2], ['E5', 2], ['G5', 2], ['A5', 2], ['B5', 4], ['A5', 4]],
            [['E5', 8], [null, 8]]
          ]) },
          { wave: 'warm', vol: 0.16, lp: 1500, notes: joinBars([
            [['B3', 8], ['E4', 8]], [['C4', 8], ['E4', 8]],
            [['D4', 8], ['F#4', 8]], [['B3', 8], ['E4', 8]],
            [['B3', 8], ['E4', 8]], [['C4', 8], ['E4', 8]],
            [['D4', 8], ['F#4', 8]], [['B3', 8], ['D4', 8]],
            [['E4', 8], ['G4', 8]], [['C4', 8], ['E4', 8]],
            [['D4', 8], ['F#4', 8]], [['B3', 8], ['E4', 8]],
            [['C4', 8], ['G4', 8]], [['A3', 8], ['E4', 8]],
            [['B3', 8], ['D4', 8]], [['E4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.44, notes: joinBars([
            [['E2', 4], ['E3', 4], ['E2', 4], ['E3', 4]],
            [['C3', 4], ['C4', 4], ['C3', 4], ['C4', 4]],
            [['D3', 4], ['D4', 4], ['D3', 4], ['D4', 4]],
            [['E2', 4], ['E3', 4], ['E2', 4], ['E3', 4]],
            [['E2', 4], ['E3', 4], ['E2', 4], ['E3', 4]],
            [['C3', 4], ['C4', 4], ['C3', 4], ['C4', 4]],
            [['D3', 4], ['D4', 4], ['D3', 4], ['D4', 4]],
            [['B2', 4], ['B3', 4], ['B2', 4], ['E3', 4]],
            [['E2', 4], ['B2', 4], ['E3', 4], ['B2', 4]],
            [['C2', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['D2', 4], ['A2', 4], ['D3', 4], ['A2', 4]],
            [['E2', 4], ['B2', 4], ['E3', 4], ['D3', 4]],
            [['C3', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['A2', 4], ['E2', 4], ['A2', 4], ['E2', 4]],
            [['B2', 4], ['F#2', 4], ['B2', 4], ['D3', 4]],
            [['E2', 8], ['B2', 8]]
          ]) }
        ],
        drums: 'k.h.s.h.k.hks.hh'
      },
      {
        // Version 2: Funky C-minor arcade scramble
        bpm: 136,
        voices: [
          { wave: 'warm', vol: 0.30, lp: 2000, decay: true, notes: joinBars([
            [['C5', 2], ['Eb5', 2], ['G5', 4], ['F5', 2], ['Eb5', 2], ['C5', 4]],
            [['Bb4', 2], ['C5', 2], ['Eb5', 4], ['G5', 4], ['F5', 4]],
            [['G5', 2], ['F5', 2], ['Eb5', 2], ['C5', 2], ['Eb5', 4], ['F5', 4]],
            [['G5', 6], ['F5', 2], ['Eb5', 4], [null, 4]],
            [['C6', 2], ['Bb5', 2], ['G5', 4], ['F5', 2], ['Eb5', 2], ['G5', 4]],
            [['Ab5', 2], ['G5', 2], ['F5', 4], ['Eb5', 2], ['D5', 2], ['C5', 4]],
            [['D5', 2], ['Eb5', 2], ['F5', 2], ['G5', 2], ['F5', 4], ['D5', 4]],
            [['C5', 8], [null, 8]],
            [['Eb5', 4], ['G5', 2], ['Bb5', 2], ['C6', 4], ['Bb5', 4]],
            [['Ab5', 4], ['G5', 2], ['F5', 2], ['Eb5', 4], ['C5', 4]],
            [['F5', 4], ['Eb5', 2], ['D5', 2], ['C5', 4], ['Bb4', 4]],
            [['C5', 2], ['D5', 2], ['Eb5', 2], ['F5', 2], ['G5', 8]],
            [['C6', 4], ['G5', 4], ['Bb5', 4], ['F5', 4]],
            [['Ab5', 4], ['Eb5', 4], ['G5', 4], ['D5', 4]],
            [['Eb5', 2], ['F5', 2], ['G5', 2], ['Bb5', 2], ['G5', 4], ['F5', 4]],
            [['C5', 8], [null, 8]]
          ]) },
          { wave: 'p25', vol: 0.14, lp: 1450, decay: true, notes: joinBars([
            [[null, 4], ['G4', 2], [null, 2], [null, 4], ['G4', 2], [null, 2]],
            [[null, 4], ['F4', 2], [null, 2], [null, 4], ['F4', 2], [null, 2]],
            [[null, 4], ['Eb4', 2], [null, 2], [null, 4], ['Eb4', 2], [null, 2]],
            [[null, 4], ['D4', 2], [null, 2], ['G4', 4], [null, 4]],
            [[null, 4], ['G4', 2], [null, 2], [null, 4], ['G4', 2], [null, 2]],
            [[null, 4], ['Ab4', 2], [null, 2], [null, 4], ['F4', 2], [null, 2]],
            [[null, 4], ['F4', 2], [null, 2], ['G4', 4], [null, 4]],
            [['Eb4', 4], ['G4', 4], [null, 8]],
            [['G4', 8], ['Bb4', 8]], [['Ab4', 8], ['G4', 8]],
            [['F4', 8], ['D4', 8]], [['Eb4', 8], ['G4', 8]],
            [['G4', 8], ['F4', 8]], [['Eb4', 8], ['D4', 8]],
            [['Eb4', 8], ['G4', 8]], [['C4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.44, notes: joinBars([
            [['C2', 4], ['C3', 2], ['G2', 2], ['C2', 4], ['Bb2', 4]],
            [['Bb2', 4], ['F2', 2], ['Bb2', 2], ['G2', 4], ['Bb2', 4]],
            [['Ab2', 4], ['Eb2', 2], ['Ab2', 2], ['F2', 4], ['Ab2', 4]],
            [['G2', 4], ['D3', 4], ['G2', 4], ['B2', 4]],
            [['C2', 4], ['C3', 2], ['G2', 2], ['C2', 4], ['Bb2', 4]],
            [['Ab2', 4], ['Eb3', 4], ['F2', 4], ['C3', 4]],
            [['G2', 4], ['F2', 4], ['G2', 4], ['B2', 4]],
            [['C2', 4], ['G2', 4], ['C3', 8]],
            [['C2', 8], ['Eb2', 8]], [['F2', 8], ['Ab2', 8]],
            [['Bb2', 8], ['G2', 8]], [['C2', 8], ['G2', 8]],
            [['C3', 8], ['Bb2', 8]], [['Ab2', 8], ['G2', 8]],
            [['F2', 8], ['G2', 8]], [['C2', 16]]
          ]) }
        ],
        drums: 'k.h.s.h.k.h.s.xh'
      },
      {
        // Version 3: Energetic D-minor boss rush
        bpm: 146,
        voices: [
          { wave: 'p25', vol: 0.25, lp: 1900, decay: true, notes: joinBars([
            [['D5', 2], ['F5', 2], ['A5', 4], ['G5', 2], ['F5', 2], ['E5', 4]],
            [['D5', 2], ['F5', 2], ['A5', 2], ['Bb5', 2], ['A5', 4], ['F5', 4]],
            [['C5', 2], ['E5', 2], ['G5', 4], ['F5', 2], ['E5', 2], ['D5', 4]],
            [['A5', 4], ['G5', 2], ['F5', 2], ['E5', 8]],
            [['D6', 2], ['C6', 2], ['Bb5', 2], ['A5', 2], ['G5', 4], ['A5', 4]],
            [['Bb5', 2], ['A5', 2], ['G5', 2], ['F5', 2], ['E5', 4], ['G5', 4]],
            [['F5', 2], ['G5', 2], ['A5', 2], ['G5', 2], ['F5', 4], ['E5', 4]],
            [['D5', 8], [null, 8]],
            [['A5', 4], ['A5', 2], ['Bb5', 2], ['C6', 4], ['A5', 4]],
            [['G5', 4], ['G5', 2], ['A5', 2], ['Bb5', 4], ['G5', 4]],
            [['F5', 4], ['F5', 2], ['G5', 2], ['A5', 4], ['F5', 4]],
            [['E5', 4], ['G5', 4], ['A5', 8]],
            [['D6', 4], ['A5', 4], ['Bb5', 4], ['G5', 4]],
            [['A5', 4], ['F5', 4], ['G5', 4], ['E5', 4]],
            [['F5', 2], ['E5', 2], ['D5', 2], ['F5', 2], ['E5', 4], ['A4', 4]],
            [['D5', 8], [null, 8]]
          ]) },
          { wave: 'flute', vol: 0.15, notes: joinBars([
            [['A3', 8], ['D4', 8]], [['Bb3', 8], ['D4', 8]],
            [['G3', 8], ['C4', 8]], [['A3', 8], ['C#4', 8]],
            [['D4', 8], ['F4', 8]], [['Bb3', 8], ['D4', 8]],
            [['A3', 8], ['C#4', 8]], [['D4', 16]],
            [['F4', 8], ['A4', 8]], [['G4', 8], ['Bb4', 8]],
            [['D4', 8], ['F4', 8]], [['E4', 8], ['A4', 8]],
            [['F4', 8], ['G4', 8]], [['F4', 8], ['E4', 8]],
            [['D4', 8], ['C#4', 8]], [['D4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.44, notes: joinBars([
            [['D2', 4], ['D3', 4], ['D2', 4], ['D3', 4]],
            [['Bb2', 4], ['Bb3', 4], ['Bb2', 4], ['F2', 4]],
            [['C3', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['A2', 4], ['E2', 4], ['A2', 4], ['C#3', 4]],
            [['D2', 4], ['A2', 4], ['D3', 4], ['A2', 4]],
            [['G2', 4], ['D3', 4], ['Bb2', 4], ['G2', 4]],
            [['A2', 4], ['E2', 4], ['A2', 4], ['C#3', 4]],
            [['D2', 4], ['A2', 4], ['D2', 8]],
            [['D2', 4], ['A2', 4], ['F2', 4], ['A2', 4]],
            [['G2', 4], ['D3', 4], ['Bb2', 4], ['D3', 4]],
            [['Bb2', 4], ['F2', 4], ['D2', 4], ['F2', 4]],
            [['A2', 4], ['E2', 4], ['A2', 4], ['G2', 4]],
            [['D2', 4], ['F2', 4], ['G2', 4], ['Bb2', 4]],
            [['A2', 4], ['D3', 4], ['G2', 4], ['C3', 4]],
            [['Bb2', 4], ['G2', 4], ['A2', 4], ['A2', 4]],
            [['D2', 16]]
          ]) }
        ],
        drums: 'k.h.s.h.kkh.s.hh'
      }
    ],

    worms: [
      {
        // Version 1: Jaunty G-major artillery march
        bpm: 118,
        voices: [
          { wave: 'warm', vol: 0.32, lp: 2100, decay: true, notes: joinBars([
            [['G5', 4], ['D5', 2], ['E5', 2], ['G5', 4], ['A5', 4]],
            [['B5', 4], ['A5', 2], ['G5', 2], ['E5', 4], ['D5', 4]],
            [['C5', 4], ['E5', 2], ['G5', 2], ['A5', 4], ['G5', 4]],
            [['F#5', 4], ['E5', 2], ['D5', 2], ['D5', 8]],
            [['G5', 4], ['B5', 2], ['A5', 2], ['G5', 4], ['D5', 4]],
            [['E5', 4], ['G5', 2], ['F#5', 2], ['E5', 4], ['C5', 4]],
            [['D5', 2], ['E5', 2], ['G5', 2], ['B5', 2], ['A5', 4], ['F#5', 4]],
            [['G5', 8], [null, 8]],
            [['B5', 4], ['D6', 4], ['C6', 4], ['A5', 4]],
            [['G5', 4], ['B5', 4], ['A5', 4], ['F#5', 4]],
            [['E5', 4], ['G5', 4], ['F#5', 4], ['D5', 4]],
            [['E5', 4], ['F#5', 4], ['G5', 8]],
            [['C6', 4], ['B5', 2], ['A5', 2], ['G5', 4], ['E5', 4]],
            [['D5', 4], ['G5', 2], ['B5', 2], ['A5', 4], ['F#5', 4]],
            [['G5', 2], ['A5', 2], ['B5', 2], ['G5', 2], ['A5', 4], ['F#5', 4]],
            [['G5', 12], [null, 4]]
          ]) },
          { wave: 'flute', vol: 0.16, notes: joinBars([
            [['B3', 4], ['D4', 4], ['B3', 4], ['D4', 4]],
            [['D4', 4], ['G4', 4], ['C4', 4], ['B3', 4]],
            [['C4', 4], ['E4', 4], ['C4', 4], ['E4', 4]],
            [['A3', 4], ['D4', 4], ['C4', 4], ['A3', 4]],
            [['B3', 4], ['D4', 4], ['B3', 4], ['D4', 4]],
            [['C4', 4], ['E4', 4], ['C4', 4], ['E4', 4]],
            [['B3', 4], ['D4', 4], ['C4', 4], ['D4', 4]],
            [['B3', 8], ['D4', 8]],
            [['D4', 8], ['E4', 8]], [['D4', 8], ['C4', 8]],
            [['C4', 8], ['A3', 8]], [['B3', 8], ['D4', 8]],
            [['E4', 8], ['C4', 8]], [['B3', 8], ['C4', 8]],
            [['B3', 8], ['C4', 8]], [['B3', 16]]
          ]) },
          { wave: 'triangle', vol: 0.44, notes: joinBars([
            [['G2', 4], ['D3', 4], ['G2', 4], ['D3', 4]],
            [['G2', 4], ['D3', 4], ['E2', 4], ['B2', 4]],
            [['C2', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['D2', 4], ['A2', 4], ['D3', 4], ['A2', 4]],
            [['G2', 4], ['D3', 4], ['G2', 4], ['B2', 4]],
            [['C2', 4], ['G2', 4], ['A2', 4], ['E2', 4]],
            [['D2', 4], ['G2', 4], ['D2', 4], ['A2', 4]],
            [['G2', 4], ['D3', 4], ['G2', 8]],
            [['G2', 4], ['B2', 4], ['C3', 4], ['A2', 4]],
            [['G2', 4], ['B2', 4], ['D2', 4], ['A2', 4]],
            [['C2', 4], ['G2', 4], ['D2', 4], ['A2', 4]],
            [['E2', 4], ['B2', 4], ['G2', 4], ['D3', 4]],
            [['C3', 4], ['G2', 4], ['A2', 4], ['E2', 4]],
            [['G2', 4], ['B2', 4], ['D2', 4], ['A2', 4]],
            [['G2', 4], ['E2', 4], ['D2', 4], ['A2', 4]],
            [['G2', 16]]
          ]) }
        ],
        drums: 'k.r.s.r.k.r.s.xr'
      },
      {
        // Version 2: Cheeky C-minor spy/artillery caper
        bpm: 112,
        voices: [
          { wave: 'p25', vol: 0.24, lp: 1650, decay: true, notes: joinBars([
            [['C5', 3], [null, 1], ['Eb5', 2], ['G5', 2], ['F#5', 4], ['G5', 4]],
            [['C5', 3], [null, 1], ['Eb5', 2], ['F5', 2], ['Eb5', 4], ['C5', 4]],
            [['Bb4', 3], [null, 1], ['D5', 2], ['F5', 2], ['E5', 4], ['F5', 4]],
            [['G5', 4], ['F5', 2], ['Eb5', 2], ['D5', 8]],
            [['C5', 3], [null, 1], ['G5', 2], ['Ab5', 2], ['G5', 4], ['Eb5', 4]],
            [['F5', 3], [null, 1], ['Eb5', 2], ['D5', 2], ['C5', 4], ['Bb4', 4]],
            [['Ab4', 4], ['C5', 4], ['B4', 4], ['G4', 4]],
            [['C5', 8], [null, 8]],
            [['G5', 4], ['Ab5', 2], ['G5', 2], ['F5', 4], ['Eb5', 4]],
            [['D5', 4], ['Eb5', 2], ['F5', 2], ['G5', 8]],
            [['Ab5', 4], ['G5', 2], ['F5', 2], ['Eb5', 4], ['D5', 4]],
            [['C5', 4], ['D5', 4], ['Eb5', 8]],
            [['G5', 2], ['F#5', 2], ['G5', 4], ['C6', 4], ['G5', 4]],
            [['F5', 2], ['E5', 2], ['F5', 4], ['Ab5', 4], ['F5', 4]],
            [['Eb5', 4], ['D5', 4], ['C5', 4], ['B4', 4]],
            [['C5', 12], [null, 4]]
          ]) },
          { wave: 'warm', vol: 0.16, lp: 1300, decay: true, notes: joinBars([
            [['Eb4', 2], [null, 2], ['G4', 2], [null, 2], ['Eb4', 2], [null, 2], ['G4', 2], [null, 2]],
            [['Eb4', 2], [null, 2], ['G4', 2], [null, 2], ['Eb4', 2], [null, 2], ['G4', 2], [null, 2]],
            [['D4', 2], [null, 2], ['F4', 2], [null, 2], ['D4', 2], [null, 2], ['F4', 2], [null, 2]],
            [['D4', 2], [null, 2], ['G4', 2], [null, 2], ['F4', 2], [null, 2], ['D4', 2], [null, 2]],
            [['Eb4', 2], [null, 2], ['G4', 2], [null, 2], ['Eb4', 2], [null, 2], ['G4', 2], [null, 2]],
            [['C4', 2], [null, 2], ['F4', 2], [null, 2], ['D4', 2], [null, 2], ['F4', 2], [null, 2]],
            [['C4', 4], ['Eb4', 4], ['D4', 4], ['F4', 4]],
            [['Eb4', 8], [null, 8]],
            [['Eb4', 8], ['C4', 8]], [['D4', 8], ['G4', 8]],
            [['F4', 8], ['Eb4', 8]], [['C4', 8], ['Eb4', 8]],
            [['Eb4', 8], ['G4', 8]], [['C4', 8], ['F4', 8]],
            [['Eb4', 8], ['D4', 8]], [['Eb4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.42, notes: joinBars([
            [['C2', 4], ['G2', 4], ['Ab2', 4], ['G2', 4]],
            [['C2', 4], ['G2', 4], ['Bb2', 4], ['G2', 4]],
            [['Bb2', 4], ['F2', 4], ['G2', 4], ['F2', 4]],
            [['G2', 4], ['D3', 4], ['G2', 4], ['F2', 4]],
            [['C2', 4], ['G2', 4], ['Ab2', 4], ['G2', 4]],
            [['F2', 4], ['C3', 4], ['Bb2', 4], ['F2', 4]],
            [['Ab2', 8], ['G2', 8]], [['C2', 8], ['G2', 8]],
            [['C2', 8], ['Ab2', 8]], [['Bb2', 8], ['G2', 8]],
            [['F2', 8], ['Ab2', 8]], [['C2', 8], ['Eb2', 8]],
            [['C2', 4], ['G2', 4], ['C3', 4], ['G2', 4]],
            [['F2', 4], ['C3', 4], ['Ab2', 4], ['F2', 4]],
            [['G2', 8], ['G2', 8]], [['C2', 16]]
          ]) }
        ],
        drums: 'k..xr.h.k..xr.x.'
      },
      {
        // Version 3: Sunny F-major island battle theme
        bpm: 124,
        voices: [
          { wave: 'warm', vol: 0.32, lp: 2200, decay: true, notes: joinBars([
            [['C5', 2], ['F5', 2], ['A5', 4], ['G5', 2], ['F5', 2], ['D5', 4]],
            [['C5', 2], ['D5', 2], ['F5', 4], ['G5', 4], ['A5', 4]],
            [['Bb5', 4], ['A5', 2], ['G5', 2], ['F5', 4], ['G5', 4]],
            [['A5', 6], ['G5', 2], ['F5', 4], [null, 4]],
            [['C6', 4], ['A5', 2], ['G5', 2], ['F5', 4], ['D5', 4]],
            [['G5', 4], ['F5', 2], ['D5', 2], ['C5', 4], ['F5', 4]],
            [['G5', 2], ['A5', 2], ['Bb5', 4], ['A5', 4], ['G5', 4]],
            [['F5', 8], [null, 8]],
            [['A5', 4], ['C6', 4], ['Bb5', 4], ['G5', 4]],
            [['A5', 4], ['F5', 4], ['G5', 4], ['E5', 4]],
            [['F5', 4], ['D5', 4], ['E5', 4], ['C5', 4]],
            [['D5', 4], ['F5', 4], ['G5', 8]],
            [['A5', 2], ['Bb5', 2], ['C6', 4], ['A5', 4], ['F5', 4]],
            [['G5', 2], ['A5', 2], ['Bb5', 4], ['G5', 4], ['D5', 4]],
            [['C5', 2], ['F5', 2], ['A5', 4], ['G5', 4], ['E5', 4]],
            [['F5', 12], [null, 4]]
          ]) },
          { wave: 'flute', vol: 0.16, atk: 0.03, notes: joinBars([
            [['A3', 8], ['C4', 8]], [['A3', 8], ['C4', 8]],
            [['Bb3', 8], ['D4', 8]], [['C4', 8], ['A3', 8]],
            [['A3', 8], ['D4', 8]], [['Bb3', 8], ['C4', 8]],
            [['Bb3', 8], ['C4', 8]], [['A3', 16]],
            [['C4', 8], ['D4', 8]], [['C4', 8], ['C4', 8]],
            [['A3', 8], ['G3', 8]], [['Bb3', 8], ['C4', 8]],
            [['C4', 8], ['A3', 8]], [['D4', 8], ['Bb3', 8]],
            [['A3', 8], ['C4', 8]], [['A3', 16]]
          ]) },
          { wave: 'triangle', vol: 0.42, notes: joinBars([
            [['F2', 4], ['C3', 4], ['F2', 4], ['A2', 4]],
            [['D2', 4], ['A2', 4], ['G2', 4], ['C3', 4]],
            [['Bb2', 4], ['F2', 4], ['C3', 4], ['G2', 4]],
            [['F2', 4], ['C3', 4], ['F2', 4], ['A2', 4]],
            [['F2', 4], ['A2', 4], ['Bb2', 4], ['D2', 4]],
            [['G2', 4], ['Bb2', 4], ['C3', 4], ['G2', 4]],
            [['Bb2', 4], ['G2', 4], ['C3', 4], ['C2', 4]],
            [['F2', 4], ['C3', 4], ['F2', 8]],
            [['F2', 8], ['G2', 8]], [['F2', 8], ['C3', 8]],
            [['D2', 8], ['C2', 8]], [['Bb2', 8], ['C3', 8]],
            [['F2', 8], ['D2', 8]], [['G2', 8], ['Bb2', 8]],
            [['C3', 8], ['C2', 8]], [['F2', 16]]
          ]) }
        ],
        drums: 'k.x.r.x.k.x.s.h.'
      }
    ],

    gameover: [
      {
        // Version 1: Warm melancholic D-minor lullaby
        bpm: 72,
        voices: [
          { wave: 'flute', vol: 0.30, decay: true, notes: joinBars([
            [['D5', 8], ['C5', 4], ['A4', 4]],
            [['G4', 8], ['A4', 4], ['G4', 4]],
            [['F4', 8], ['E4', 4], ['D4', 4]],
            [['D4', 16]],
            [['A4', 8], ['G4', 4], ['F4', 4]],
            [['E4', 8], ['F4', 4], ['G4', 4]],
            [['F4', 8], ['E4', 4], ['C#4', 4]],
            [['D4', 16]]
          ]) },
          { wave: 'sine', vol: 0.16, atk: 0.06, notes: joinBars([
            [['F4', 16]], [['D4', 16]], [['D4', 16]], [['A3', 16]],
            [['D4', 16]], [['C4', 16]], [['A3', 16]], [['A3', 16]]
          ]) },
          { wave: 'triangle', vol: 0.34, notes: joinBars([
            [['D2', 16]], [['G2', 16]], [['Bb2', 16]], [['D2', 16]],
            [['F2', 16]], [['C2', 16]], [['A2', 16]], [['D2', 16]]
          ]) }
        ]
      },
      {
        // Version 2: Gentle bittersweet A-minor cadence
        bpm: 76,
        voices: [
          { wave: 'warm', vol: 0.28, lp: 1500, decay: true, notes: joinBars([
            [['E5', 8], ['D5', 4], ['C5', 4]],
            [['B4', 8], ['C5', 4], ['A4', 4]],
            [['G4', 8], ['A4', 4], ['B4', 4]],
            [['A4', 16]],
            [['C5', 8], ['B4', 4], ['A4', 4]],
            [['G4', 8], ['F4', 4], ['E4', 4]],
            [['F4', 8], ['E4', 4], ['D4', 4]],
            [['E4', 16]]
          ]) },
          { wave: 'triangle', vol: 0.34, notes: joinBars([
            [['A2', 16]], [['F2', 16]], [['G2', 16]], [['A2', 16]],
            [['F2', 16]], [['C2', 16]], [['D2', 16]], [['E2', 16]]
          ]) }
        ]
      }
    ]
  };

  function compile(tr) {
    var events = [];
    var len = 0;
    tr.voices.forEach(function (voice) {
      var at = 0;
      voice.notes.forEach(function (n) {
        var f = n[0] ? freqOf(n[0]) : 0;
        if (f) {
          events.push({
            at: at, wave: voice.wave, f: f, dur: n[1], vol: voice.vol,
            lp: voice.lp, decay: voice.decay, atk: voice.atk
          });
        }
        at += n[1];
      });
      len = Math.max(len, at);
    });
    var byStep = [];
    for (var i = 0; i < len; i++) byStep.push([]);
    events.forEach(function (e) {
      byStep[e.at].push(e);
    });
    return { len: len, stepSec: 60 / tr.bpm / 4, byStep: byStep, drums: tr.drums || '' };
  }

  function scheduleStep(m, step, t) {
    var tr = m.tr;
    var i = step % tr.len;
    var events = tr.byStep[i];
    for (var k = 0; k < events.length; k++) {
      var e = events[k];
      tone(m.bus, e.wave, e.f, t, e.dur * tr.stepSec * 0.92, e.vol, {
        lp: e.lp, decay: e.decay, atk: e.atk || 0.012
      });
    }
    if (tr.drums) {
      var drum = DRUMS[tr.drums.charAt(i % tr.drums.length)];
      if (drum) drum(m.bus, t);
    }
  }

  function scheduleAhead() {
    var m = current;
    if (!m) return;
    var now = ctx.currentTime;
    if (m.nextTime < now - 0.5) m.nextTime = now;
    while (m.nextTime < now + LOOKAHEAD) {
      scheduleStep(m, m.step, m.nextTime);
      m.nextTime += m.tr.stepSec;
      m.step++;
    }
  }

  function pickVariant(name) {
    var list = TRACKS[name];
    if (!Array.isArray(list)) return list;
    if (list.length === 1) return list[0];
    var prev = has(lastVariant, name) ? lastVariant[name] : -1;
    var idx = Math.floor(Math.random() * (list.length - (prev >= 0 ? 1 : 0)));
    if (prev >= 0 && idx >= prev) idx++;
    lastVariant[name] = idx;
    return list[idx];
  }

  function startMusic(name) {
    var bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.25);
    bus.connect(musicBus);
    current = {
      name: name,
      tr: compile(pickVariant(name)),
      bus: bus,
      step: 0,
      nextTime: ctx.currentTime + 0.1,
      timer: 0
    };
    scheduleAhead();
    current.timer = setInterval(scheduleAhead, TICK_MS);
  }

  function stopMusic() {
    var m = current;
    if (!m) return;
    current = null;
    clearInterval(m.timer);
    m.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(function () {
      try { m.bus.disconnect(); } catch (e) {}
    }, 450);
  }

  function init() {
    if (!ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        ctx = new Ctor();
        build();
      } catch (e) {
        ctx = null;
        return;
      }
    }
    if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
      var p = ctx.resume();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function play(name) {
    if (!ctx || !has(EFFECTS, name)) return;
    EFFECTS[name](sfxBus, ctx.currentTime + 0.01);
  }

  function music(name) {
    if (!ctx) return;
    var want = name == null ? null : String(name);
    if (want !== null && !has(TRACKS, want)) return;
    if (want === (current ? current.name : null)) return;
    stopMusic();
    if (want !== null) startMusic(want);
  }

  function setMuted(flag) {
    muted = !!flag;
    storeFlag(STORAGE_KEY, muted);
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.03);
  }

  function isMuted() {
    return muted;
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  function setMusicMuted(flag) {
    musicMuted = !!flag;
    storeFlag(MUSIC_STORAGE_KEY, musicMuted);
    if (musicBus) musicBus.gain.setTargetAtTime(musicMuted ? 0 : MUSIC_GAIN, ctx.currentTime, 0.03);
  }

  function isMusicMuted() {
    return musicMuted;
  }

  function toggleMusic() {
    setMusicMuted(!musicMuted);
    return musicMuted;
  }

  window.BC.Audio = {
    init: init,
    play: play,
    music: music,
    setMuted: setMuted,
    isMuted: isMuted,
    toggleMute: toggleMute,
    setMusicMuted: setMusicMuted,
    isMusicMuted: isMusicMuted,
    toggleMusic: toggleMusic
  };
})();
