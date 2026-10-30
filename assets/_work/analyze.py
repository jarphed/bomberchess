import sys
sys.path.insert(0, '/Users/pontusjarphed/code/bomberchess/assets/_work')
from pngtool import read_png

def cell(px, w, cx, cy, cw, ch):
    return [[px[(cy*ch+y)*w + cx*cw + x] for x in range(cw)] for y in range(ch)]

def stats(path, cw, ch, row, cols):
    w, h, px = read_png(path)
    for c in cols:
        g = cell(px, w, c, row, cw, ch)
        pts = [(x, y) for y in range(ch) for x in range(cw) if g[y][x][3] > 0]
        warm = [(x, y) for y in range(ch) for x in range(cw)
                if g[y][x][3] > 0 and g[y][x][0] >= 200 and g[y][x][1] >= 100 and g[y][x][2] <= 90]
        if not pts:
            print('cell', c, 'empty'); continue
        mx = sum(p[0] for p in pts)/len(pts)
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        wx = (sum(p[0] for p in warm)/len(warm)) if warm else float('nan')
        print('cell %d: opaque=%d bbox x%d-%d y%d-%d centroidX=%.2f warmPx=%d warmCentroidX=%.2f'
              % (c, len(pts), min(xs), max(xs), min(ys), max(ys), mx, len(warm), wx))

def flipmatch(path, cw, ch, row, cols):
    w, h, px = read_png(path)
    cells = {c: cell(px, w, c, row, cw, ch) for c in cols}
    print('pixel agreement (alpha>0 in either), direct vs horizontally flipped')
    print('     ' + ''.join('%7d' % b for b in cols))
    for a in cols:
        out = []
        for b in cols:
            same_d = same_f = tot = 0
            for y in range(ch):
                for x in range(cw):
                    pa, pb = cells[a][y][x], cells[b][y][x]
                    pf = cells[a][y][cw-1-x]
                    if pa[3] == 0 and pb[3] == 0: continue
                    tot += 1
                    if pa == pb: same_d += 1
                    if pf == pb: same_f += 1
            out.append('%3d/%3d' % (100*same_d//max(tot,1), 100*same_f//max(tot,1)))
        print('%3d  ' % a + ' '.join('%7s' % o for o in out))

if __name__ == '__main__':
    mode, path, cw, ch, row = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
    cols = [int(c) for c in sys.argv[6].split(',')]
    if mode == 'stats':
        stats(path, cw, ch, row, cols)
    else:
        flipmatch(path, cw, ch, row, cols)
