import sys
sys.path.insert(0, '/Users/pontusjarphed/code/bomberchess/assets/_work')
from pngtool import read_png
for f in sys.argv[1:]:
    w, h, px = read_png(f)
    best = None
    for k in (1, 2, 3, 4):
        for ox in range(k):
            for oy in range(k):
                tot = ok = 0
                for by in range(oy, h - k + 1, k):
                    for bx in range(ox, w - k + 1, k):
                        blk = {px[(by+j)*w + bx+i] for j in range(k) for i in range(k)}
                        tot += 1
                        if len(blk) == 1: ok += 1
                frac = ok / max(tot, 1)
                if k == 2 and ox == 0 and oy == 0: two = frac
                if best is None or frac > best[0] + 1e-9 or (abs(frac-best[0]) < 1e-9 and k < best[1]):
                    best = (frac, k, ox, oy)
    xs = [x for y in range(h) for x in range(w) if px[y*w+x][3] > 0]
    ys = [y for y in range(h) for x in range(w) if px[y*w+x][3] > 0]
    print(f, 'opaque bbox x%d-%d y%d-%d' % (min(xs), max(xs), min(ys), max(ys)),
          'best block k=%d offset=(%d,%d) uniform=%.3f' % (best[1], best[2], best[3], best[0]),
          'k2@0,0=%.3f' % two)
