window.BC = window.BC || {};

(function () {
  'use strict';

  var MASTER_GAIN = 0.35;
  var SFX_GAIN = 0.8;
  var MUSIC_GAIN = 0.45;
  var LOOKAHEAD = 0.1;
  var TICK_MS = 25;
  var STORAGE_KEY = 'bomberchess.muted';
  var SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  var ctx = null;
  var master = null;
  var sfxBus = null;
  var musicBus = null;
  var noiseBuf = null;
  var waves = {};
  var current = null;
  var muted = loadMuted();

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function loadMuted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function storeMuted(flag) {
    try {
      window.localStorage.setItem(STORAGE_KEY, flag ? '1' : '0');
    } catch (e) {
      // Storage may be blocked (file:// in some browsers); mute state stays in memory.
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

  // Fourier series of a pulse wave with the given duty cycle.
  function pulseWave(duty) {
    var N = 64;
    var re = new Float32Array(N);
    var im = new Float32Array(N);
    for (var n = 1; n < N; n++) {
      var a = Math.PI * n;
      re[n] = 2 * Math.sin(2 * a * duty) / a;
      im[n] = 2 * (1 - Math.cos(2 * a * duty)) / a;
    }
    return ctx.createPeriodicWave(re, im);
  }

  function makeNoise() {
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_GAIN;
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_GAIN;
    musicBus.connect(master);
    noiseBuf = makeNoise();
    waves.p25 = pulseWave(0.25);
    waves.p12 = pulseWave(0.125);
  }

  function envelope(g, t, dur, vol, decay) {
    var a = Math.min(0.004, dur * 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + a);
    if (decay) {
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    } else {
      var r = Math.min(0.03, dur * 0.4);
      g.gain.setValueAtTime(vol, t + dur - r);
      g.gain.linearRampToValueAtTime(0, t + dur);
    }
  }

  // wave: 'square' | 'triangle' | 'sine' | 'p25' | 'p12'; o: optional { to, decay, wob }.
  function tone(bus, wave, f, t, dur, vol, o) {
    o = o || {};
    var osc = ctx.createOscillator();
    if (waves[wave]) osc.setPeriodicWave(waves[wave]);
    else osc.type = wave;
    osc.frequency.setValueAtTime(f, t);
    if (o.wob) {
      for (var k = 1; k <= 90; k++) {
        var p = k / 90;
        osc.frequency.setValueAtTime(f * Math.pow(o.to / f, p) * (1 + o.wob * Math.sin(p * 40)), t + dur * p);
      }
    } else if (o.to) {
      osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    }
    var g = ctx.createGain();
    envelope(g, t, dur, vol, o.decay);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = function () {
      osc.disconnect();
      g.disconnect();
    };
  }

  function hit(bus, t, dur, vol, type, f, to) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (to) flt.frequency.exponentialRampToValueAtTime(to, t + dur);
    var g = ctx.createGain();
    envelope(g, t, dur, vol, true);
    src.connect(flt);
    flt.connect(g);
    g.connect(bus);
    src.start(t, Math.random() * noiseBuf.duration);
    src.stop(t + dur + 0.02);
    src.onended = function () {
      src.disconnect();
      flt.disconnect();
      g.disconnect();
    };
  }

  function phrase(bus, wave, names, durs, t, vol) {
    var at = t;
    for (var i = 0; i < names.length; i++) {
      tone(bus, wave, freqOf(names[i]), at, durs[i], vol);
      at += durs[i];
    }
  }

  function kick(bus, t) {
    tone(bus, 'sine', 150, t, 0.16, 1, { to: 42, decay: true });
  }

  function snare(bus, t) {
    hit(bus, t, 0.16, 0.6, 'highpass', 1200);
    tone(bus, 'triangle', 190, t, 0.09, 0.4, { to: 150, decay: true });
  }

  function hat(bus, t) {
    hit(bus, t, 0.035, 0.22, 'highpass', 7000);
  }

  var DRUMS = { k: kick, s: snare, h: hat };

  var EFFECTS = {
    menuMove: function (bus, t) {
      tone(bus, 'square', 1320, t, 0.05, 0.3, { to: 1480 });
    },
    menuSelect: function (bus, t) {
      phrase(bus, 'square', ['E5', 'A5'], [0.08, 0.16], t, 0.3);
    },
    select: function (bus, t) {
      tone(bus, 'square', 520, t, 0.1, 0.3, { to: 840 });
    },
    move: function (bus, t) {
      tone(bus, 'triangle', 440, t, 0.14, 0.7, { to: 300, decay: true });
      hit(bus, t, 0.02, 0.4, 'bandpass', 2500);
    },
    capture: function (bus, t) {
      hit(bus, t, 0.3, 0.9, 'lowpass', 3000, 300);
      tone(bus, 'square', 180, t, 0.25, 0.4, { to: 60, decay: true });
    },
    check: function (bus, t) {
      phrase(bus, 'square', ['A5', 'E5', 'A5', 'E5'], [0.12, 0.12, 0.12, 0.12], t, 0.3);
    },
    pickup: function (bus, t) {
      phrase(bus, 'square', ['C5', 'E5', 'G5', 'C6', 'E6'], [0.05, 0.05, 0.05, 0.05, 0.14], t, 0.3);
    },
    bombPlace: function (bus, t) {
      tone(bus, 'sine', 120, t, 0.14, 0.9, { to: 55, decay: true });
      hit(bus, t, 0.03, 0.25, 'lowpass', 400);
    },
    // a bomb gets kicked: a thump, then it whooshes off
    kick: function (bus, t) {
      tone(bus, 'sine', 180, t, 0.08, 0.9, { to: 70, decay: true });
      hit(bus, t, 0.05, 0.4, 'lowpass', 900);
      hit(bus, t + 0.04, 0.22, 0.25, 'bandpass', 900, 3200);
    },
    explode: function (bus, t) {
      hit(bus, t, 0.6, 1, 'lowpass', 2400, 180);
      tone(bus, 'sine', 110, t, 0.6, 0.9, { to: 28, decay: true });
    },
    wake: function (bus, t) {
      tone(bus, 'p25', 240, t, 0.1, 0.3, { to: 720 });
      tone(bus, 'p25', 520, t + 0.11, 0.16, 0.3, { to: 1300, wob: 0.08 });
    },
    death: function (bus, t) {
      tone(bus, 'square', 660, t, 1, 0.4, { to: 90, wob: 0.06 });
    },
    // BLOOD: something bursts into wet bits
    splat: function (bus, t) {
      hit(bus, t, 0.28, 0.9, 'lowpass', 1400, 160);
      tone(bus, 'sine', 240, t, 0.22, 0.7, { to: 50, decay: true });
      hit(bus, t + 0.06, 0.16, 0.45, 'bandpass', 700, 260);
      hit(bus, t + 0.14, 0.1, 0.3, 'bandpass', 500, 200);
    },
    phaseBomber: function (bus, t) {
      phrase(bus, 'square', ['C5', 'E5', 'G5', 'C6'], [0.1, 0.1, 0.1, 0.4], t, 0.35);
      tone(bus, 'triangle', freqOf('C3'), t, 0.7, 0.6);
    },
    phaseChess: function (bus, t) {
      phrase(bus, 'triangle', ['D4', 'G4', 'A4', 'D5'], [0.2, 0.2, 0.2, 0.5], t, 0.6);
    },
    // the chess turn passes to you: an arcade fanfare
    yourTurn: function (bus, t) {
      hit(bus, t, 0.25, 0.7, 'lowpass', 1800, 200);
      phrase(bus, 'square', ['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6'], [0.07, 0.07, 0.07, 0.12, 0.07, 0.07, 0.4], t + 0.05, 0.3);
      phrase(bus, 'p25', ['E4', 'G4', 'C5', 'E5', 'C5', 'E5', 'G5'], [0.07, 0.07, 0.07, 0.12, 0.07, 0.07, 0.4], t + 0.05, 0.16);
      tone(bus, 'triangle', freqOf('C3'), t + 0.05, 0.35, 0.6);
      tone(bus, 'triangle', freqOf('G3'), t + 0.47, 0.4, 0.6);
    },
    tickHi: function (bus, t) {
      tone(bus, 'square', 1760, t, 0.06, 0.3, { decay: true });
      tone(bus, 'sine', 2200, t + 0.08, 0.05, 0.4, { decay: true });
    },
    // a sheep (left behind by a missed turn, or stampeding)
    baa: function (bus, t) {
      tone(bus, 'p25', 560, t, 0.42, 0.26, { to: 470, wob: 0.22 });
      tone(bus, 'p12', 1120, t, 0.42, 0.08, { to: 940, wob: 0.22 });
    },
    // the sheep gates swing open: a creaking hinge, then the latch clanks
    gate: function (bus, t) {
      tone(bus, 'square', 210, t, 0.45, 0.12, { to: 150, wob: 0.25 });
      tone(bus, 'p12', 420, t + 0.05, 0.4, 0.06, { to: 300, wob: 0.3 });
      hit(bus, t + 0.48, 0.08, 0.5, 'bandpass', 1800);
      tone(bus, 'square', 1200, t + 0.48, 0.06, 0.15, { decay: true });
    },
    // one strike setting off the next (CHAINED DEATHS)
    chain: function (bus, t) {
      phrase(bus, 'square', ['E5', 'B5', 'E6'], [0.05, 0.05, 0.16], t, 0.26);
    },
    // a wall block of the shrinking arena lands
    thud: function (bus, t) {
      hit(bus, t, 0.22, 0.8, 'lowpass', 900, 120);
      tone(bus, 'sine', 140, t, 0.2, 0.8, { to: 45, decay: true });
    },
    tick: function (bus, t) {
      tone(bus, 'sine', 1800, t, 0.05, 0.6, { decay: true });
    },
    gameOver: function (bus, t) {
      phrase(bus, 'triangle', ['G4', 'F4', 'Eb4', 'D4'], [0.22, 0.22, 0.22, 0.5], t, 0.6);
    },
    win: function (bus, t) {
      phrase(bus, 'square', ['C5', 'E5', 'G5', 'C6', 'B5', 'C6'], [0.1, 0.1, 0.1, 0.25, 0.1, 0.55], t, 0.35);
      tone(bus, 'triangle', freqOf('C3'), t, 0.6, 0.6);
      tone(bus, 'triangle', freqOf('G3'), t + 0.6, 0.6, 0.6);
    },
    promote: function (bus, t) {
      phrase(bus, 'p12', ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], [0.04, 0.04, 0.04, 0.04, 0.04, 0.2], t, 0.3);
    },
    // ---- special captures
    rumble: function (bus, t) {
      hit(bus, t, 0.9, 0.7, 'lowpass', 260, 90);
      tone(bus, 'triangle', 55, t, 0.8, 0.5, { to: 40, wob: 0.15 });
    },
    crack: function (bus, t) {
      hit(bus, t, 0.12, 0.9, 'highpass', 1800);
      tone(bus, 'square', 320, t, 0.18, 0.35, { to: 70, decay: true });
    },
    crash: function (bus, t) {
      hit(bus, t, 0.9, 1, 'lowpass', 1800, 120);
      hit(bus, t + 0.05, 0.5, 0.5, 'bandpass', 900, 300);
      tone(bus, 'sine', 90, t, 0.7, 0.9, { to: 30, decay: true });
    },
    neigh: function (bus, t) {
      tone(bus, 'p25', 1100, t, 0.45, 0.25, { to: 700, wob: 0.12 });
      tone(bus, 'p25', 760, t + 0.42, 0.3, 0.22, { to: 420, wob: 0.08 });
    },
    clop: function (bus, t) {
      tone(bus, 'square', 900, t, 0.04, 0.3, { to: 600, decay: true });
      tone(bus, 'square', 700, t + 0.07, 0.04, 0.25, { to: 450, decay: true });
      hit(bus, t, 0.03, 0.3, 'bandpass', 2000);
    },
    ascend: function (bus, t) {
      phrase(bus, 'triangle', ['C5', 'E5', 'G5', 'C6'], [0.07, 0.07, 0.07, 0.3], t, 0.45);
      tone(bus, 'sine', freqOf('G5'), t + 0.21, 0.35, 0.2);
    },
    thunder: function (bus, t) {
      hit(bus, t, 0.18, 1, 'highpass', 2500);
      hit(bus, t + 0.02, 1.8, 1, 'lowpass', 1600, 70);
      tone(bus, 'sine', 70, t, 1.4, 0.8, { to: 28, decay: true });
    },
    siren: function (bus, t) {
      tone(bus, 'square', 420, t, 0.55, 0.16, { to: 880 });
      tone(bus, 'square', 880, t + 0.55, 0.55, 0.16, { to: 420 });
    },
    plane: function (bus, t) {
      tone(bus, 'square', 70, t, 2.4, 0.16, { to: 58, wob: 0.05 });
      hit(bus, t, 2.4, 0.18, 'bandpass', 260, 180);
    },
    whistle: function (bus, t) {
      tone(bus, 'sine', 1700, t, 0.5, 0.18, { to: 520 });
    },
    alarm: function (bus, t) {
      phrase(bus, 'square', ['A4', 'D4', 'A4'], [0.18, 0.18, 0.18], t, 0.28);
    },
    nuke: function (bus, t) {
      hit(bus, t, 0.25, 1, 'highpass', 1500);
      hit(bus, t, 2.8, 1, 'lowpass', 3000, 50);
      tone(bus, 'sine', 95, t, 2.4, 1, { to: 18, decay: true });
      tone(bus, 'triangle', 60, t + 0.3, 2, 0.6, { to: 25, wob: 0.2 });
    },
    // a strike bouncing off a king's helmet
    clang: function (bus, t) {
      hit(bus, t, 0.05, 0.5, 'highpass', 4000);
      tone(bus, 'square', 1480, t, 0.35, 0.22, { decay: true });
      tone(bus, 'triangle', 2217, t, 0.5, 0.3, { decay: true });
      tone(bus, 'triangle', 987, t + 0.02, 0.4, 0.25, { to: 940, decay: true });
    }
  };

  function joinBars(bars) {
    return [].concat.apply([], bars);
  }

  // Note entries are [note or null for rest, length in 16th steps]; each bar is 16 steps.
  var TRACKS = {
    title: {
      bpm: 132,
      voices: [
        { wave: 'square', vol: 0.5, notes: joinBars([
          [['E5', 2], ['G5', 2], ['A5', 4], ['G5', 2], ['E5', 2], ['D5', 2], ['C5', 2]],
          [['C5', 4], ['D5', 2], ['E5', 2], ['G5', 4], ['A5', 2], ['G5', 2]],
          [['A5', 2], ['G5', 2], ['E5', 4], ['G5', 2], ['A5', 2], ['C6', 4]],
          [['G5', 2], ['E5', 2], ['D5', 4], ['E5', 2], ['G5', 2], ['E5', 4]],
          [['C6', 2], ['A5', 2], ['G5', 4], ['A5', 2], ['C6', 2], ['D6', 4]],
          [['E6', 4], ['D6', 2], ['C6', 2], ['A5', 4], ['G5', 2], ['E5', 2]],
          [['D5', 2], ['E5', 2], ['G5', 2], ['A5', 2], ['G5', 4], ['E5', 4]],
          [['G5', 2], ['A5', 2], ['C6', 2], ['A5', 2], ['G5', 2], ['E5', 2], ['D5', 2], ['C5', 2]]
        ]) },
        { wave: 'triangle', vol: 0.7, notes: joinBars([
          [['C3', 4], ['G3', 4], ['C3', 4], ['G3', 4]],
          [['G2', 4], ['D3', 4], ['G2', 4], ['D3', 4]],
          [['A2', 4], ['E3', 4], ['A2', 4], ['E3', 4]],
          [['F2', 4], ['C3', 4], ['F2', 4], ['C3', 4]],
          [['C3', 4], ['G3', 4], ['C3', 4], ['G3', 4]],
          [['G2', 4], ['D3', 4], ['G2', 4], ['D3', 4]],
          [['F2', 4], ['C3', 4], ['A2', 4], ['E3', 4]],
          [['G2', 4], ['D3', 4], ['G2', 4], ['B2', 4]]
        ]) }
      ],
      drums: 'k.h.s.h.k.h.s.h.'
    },
    chess: {
      bpm: 100,
      voices: [
        { wave: 'p25', vol: 0.45, notes: joinBars([
          [['A4', 8], ['C5', 4], ['D5', 4]],
          [['E5', 4], ['D5', 4], ['C5', 8]],
          [['G4', 4], ['A4', 4], ['C5', 4], ['D5', 4]],
          [['E5', 8], [null, 4], ['D5', 4]],
          [['D5', 4], ['C5', 4], ['A4', 4], ['G4', 4]],
          [['A4', 6], ['C5', 2], ['D5', 4], ['E5', 4]],
          [['G5', 8], ['E5', 4], ['D5', 4]],
          [['C5', 4], ['A4', 4], ['A4', 8]]
        ]) },
        { wave: 'triangle', vol: 0.7, notes: joinBars([
          [['A2', 8], ['A2', 8]],
          [['D2', 8], ['D2', 8]],
          [['F2', 8], ['F2', 8]],
          [['E2', 8], ['E2', 8]],
          [['D2', 8], ['D2', 8]],
          [['F2', 8], ['G2', 8]],
          [['A2', 8], ['E2', 8]],
          [['A2', 8], ['G2', 8]]
        ]) }
      ],
      drums: '....h.......h...'
    },
    bomber: {
      bpm: 150,
      voices: [
        { wave: 'square', vol: 0.4, notes: joinBars([
          [['E5', 2], ['G5', 2], ['A5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['A5', 2], ['G5', 2]],
          [['E5', 2], ['G5', 2], ['A5', 2], ['B5', 2], ['A5', 4], ['G5', 2], ['E5', 2]],
          [['D5', 2], ['E5', 2], ['G5', 2], ['A5', 2], ['B5', 4], ['A5', 2], ['G5', 2]],
          [['B5', 2], ['A5', 2], ['G5', 2], ['E5', 2], ['G5', 4], ['E5', 4]],
          [['E6', 2], ['D6', 2], ['B5', 2], ['A5', 2], ['B5', 4], ['D6', 4]],
          [['G5', 2], ['A5', 2], ['B5', 2], ['D6', 2], ['E6', 4], ['D6', 2], ['B5', 2]],
          [['A5', 1], ['G5', 1], ['A5', 2], ['B5', 2], ['D6', 2], ['B5', 2], ['A5', 2], ['G5', 2], ['E5', 2]],
          [['E5', 4], ['G5', 2], ['A5', 2], ['B5', 4], ['E6', 4]]
        ]) },
        { wave: 'triangle', vol: 0.7, notes: joinBars([
          [['E2', 4], ['E3', 4], ['E2', 4], ['E3', 4]],
          [['C3', 4], ['C4', 4], ['C3', 4], ['C4', 4]],
          [['D3', 4], ['D4', 4], ['D3', 4], ['D4', 4]],
          [['E2', 4], ['E3', 4], ['E2', 4], ['E3', 4]],
          [['E2', 4], ['E3', 4], ['E2', 4], ['E3', 4]],
          [['C3', 4], ['C4', 4], ['C3', 4], ['C4', 4]],
          [['D3', 4], ['D4', 4], ['D3', 4], ['D4', 4]],
          [['B2', 4], ['B3', 4], ['B2', 4], ['E3', 4]]
        ]) }
      ],
      drums: 'k.h.s.h.k.hks.hh'
    },
    gameover: {
      bpm: 72,
      voices: [
        { wave: 'p12', vol: 0.6, notes: joinBars([
          [['D5', 8], ['C5', 4], ['A4', 4]],
          [['G4', 8], ['A4', 4], ['G4', 4]],
          [['F4', 8], ['E4', 4], ['D4', 4]],
          [['D4', 16]]
        ]) },
        { wave: 'triangle', vol: 0.6, notes: joinBars([
          [['D2', 16]],
          [['G2', 16]],
          [['Bb2', 16]],
          [['D2', 16]]
        ]) }
      ]
    }
  };

  function compile(tr) {
    var events = [];
    var len = 0;
    tr.voices.forEach(function (voice) {
      var at = 0;
      voice.notes.forEach(function (n) {
        var f = n[0] ? freqOf(n[0]) : 0;
        if (f) events.push({ at: at, wave: voice.wave, f: f, dur: n[1], vol: voice.vol });
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
      tone(m.bus, e.wave, e.f, t, e.dur * tr.stepSec * 0.9, e.vol);
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

  function startMusic(name) {
    var bus = ctx.createGain();
    bus.connect(musicBus);
    current = {
      name: name,
      tr: compile(TRACKS[name]),
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
    m.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    setTimeout(function () {
      m.bus.disconnect();
    }, 400);
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
    storeMuted(muted);
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.03);
  }

  function isMuted() {
    return muted;
  }

  function toggleMute() {
    setMuted(!muted);
    return muted;
  }

  window.BC.Audio = {
    init: init,
    play: play,
    music: music,
    setMuted: setMuted,
    isMuted: isMuted,
    toggleMute: toggleMute
  };
})();
