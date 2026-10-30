import sys, zlib, struct
from collections import Counter

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos, idat, plte, trns = 8, b'', None, None
    while pos < len(data):
        ln, = struct.unpack('>I', data[pos:pos+4])
        typ = data[pos+4:pos+8]
        body = data[pos+8:pos+8+ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct, cm, fm, il = struct.unpack('>IIBBBBB', body)
        elif typ == b'PLTE':
            plte = body
        elif typ == b'tRNS':
            trns = body
        elif typ == b'IDAT':
            idat += body
        elif typ == b'IEND':
            break
    assert bd == 8 and il == 0, 'only 8-bit non-interlaced supported'
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * ch
    prev = bytearray(stride)
    p = 0
    rows = []
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        for i in range(stride):
            a = line[i-ch] if i >= ch else 0
            b = prev[i]
            c = prev[i-ch] if i >= ch else 0
            if f == 1: add = a
            elif f == 2: add = b
            elif f == 3: add = (a + b) >> 1
            elif f == 4:
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                add = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            else: add = 0
            line[i] = (line[i] + add) & 255
        rows.append(line)
        prev = line
    px = []
    for line in rows:
        for x in range(w):
            if ct == 6:
                px.append(tuple(line[x*4:x*4+4]))
            elif ct == 2:
                r, g, b = line[x*3:x*3+3]; px.append((r, g, b, 255))
            elif ct == 0:
                v = line[x]; px.append((v, v, v, 255))
            elif ct == 4:
                v = line[x*2]; px.append((v, v, v, line[x*2+1]))
            elif ct == 3:
                i = line[x]
                r, g, b = plte[i*3:i*3+3]
                a = trns[i] if trns and i < len(trns) else 255
                px.append((r, g, b, a))
    return w, h, px

def write_png(path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(px[y*w+x])
    def chunk(t, b):
        return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t+b) & 0xffffffff)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw))) + chunk(b'IEND', b''))
    open(path, 'wb').write(out)

def hexc(p):
    return '#%02X%02X%02X' % p[:3] + ('' if p[3] == 255 else ' a=%d' % p[3])

def info(path):
    w, h, px = read_png(path)
    print('size', w, 'x', h)
    print('transparent px', sum(1 for p in px if p[3] == 0), 'of', w*h)
    print('corners', hexc(px[0]), hexc(px[w-1]), hexc(px[(h-1)*w]), hexc(px[h*w-1]))
    for c, n in Counter(px).most_common(16):
        print(' ', hexc(c), n)

def bboxes(path, bg=None, minpx=1):
    w, h, px = read_png(path)
    if bg is None:
        fg = [p[3] > 0 for p in px]
    else:
        bgc = tuple(int(bg[i:i+2], 16) for i in (1, 3, 5))
        fg = [p[3] > 0 and p[:3] != bgc for p in px]
    seen = [False]*(w*h)
    comps = []
    for s in range(w*h):
        if seen[s] or not fg[s]: continue
        stack = [s]; seen[s] = True
        x0 = x1 = s % w; y0 = y1 = s // w; n = 0
        while stack:
            i = stack.pop(); n += 1
            x, y = i % w, i // w
            x0, x1 = min(x0, x), max(x1, x); y0, y1 = min(y0, y), max(y1, y)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny*w+nx
                        if not seen[j] and fg[j]:
                            seen[j] = True; stack.append(j)
        if n >= minpx:
            comps.append((y0, x0, x1-x0+1, y1-y0+1, n))
    comps.sort()
    print('components', len(comps))
    for y0, x0, cw, chh, n in comps:
        print('x=%d y=%d w=%d h=%d px=%d' % (x0, y0, cw, chh, n))

def preview(path, scale, grid, out, bg=None):
    w, h, px = read_png(path)
    W, H = w*scale, h*scale
    o = []
    for Y in range(H):
        y = Y // scale
        row = []
        for X in range(W):
            x = X // scale
            p = px[y*w+x]
            if (x % grid == 0 and X % scale == 0) or (y % grid == 0 and Y % scale == 0):
                col = (255, 0, 255, 255) if (x % (grid*2) == 0 or y % (grid*2) == 0) else (0, 255, 255, 255)
                row.append(col); continue
            if p[3] < 255:
                c = 200 if ((X//8 + Y//8) % 2) else 255
                a = p[3] / 255.0
                row.append((int(p[0]*a + c*(1-a)), int(p[1]*a + c*(1-a)), int(p[2]*a + c*(1-a)), 255))
            else:
                row.append(p)
        o.extend(row)
    write_png(out, W, H, o)
    print('wrote', out, W, 'x', H)

def crop(path, x0, y0, rw, rh, scale, grid, out):
    w, h, px = read_png(path)
    W, H = rw*scale, rh*scale
    o = []
    for Y in range(H):
        y = y0 + Y // scale
        for X in range(W):
            x = x0 + X // scale
            if (x % grid == 0 and X % scale == 0) or (y % grid == 0 and Y % scale == 0):
                o.append((255, 0, 255, 255) if (x//grid + y//grid) % 2 == 0 else (0, 255, 255, 255)); continue
            p = px[y*w+x]
            if p[3] < 255:
                c = 200 if ((X//6 + Y//6) % 2) else 255
                a = p[3] / 255.0
                o.append((int(p[0]*a + c*(1-a)), int(p[1]*a + c*(1-a)), int(p[2]*a + c*(1-a)), 255))
            else:
                o.append(p)
    write_png(out, W, H, o)
    print('wrote', out, W, 'x', H, 'region', x0, y0, rw, rh)

def cells(path, cw, ch):
    w, h, px = read_png(path)
    print('cell', cw, 'x', ch, 'grid', w//cw, 'cols x', h//ch, 'rows (opaque px per cell)')
    print('     ' + ''.join('%5d' % c for c in range(w//cw)))
    for r in range(h//ch):
        vals = []
        for c in range(w//cw):
            n = 0
            for y in range(r*ch, (r+1)*ch):
                for x in range(c*cw, (c+1)*cw):
                    if px[y*w+x][3] > 0: n += 1
            vals.append('%5d' % n)
        print('r%2d  ' % r + ''.join(vals))

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'info':
        info(sys.argv[2])
    elif cmd == 'bboxes':
        bboxes(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '-' else None)
    elif cmd == 'preview':
        bg = sys.argv[6] if len(sys.argv) > 6 else None
        preview(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], bg)
    elif cmd == 'crop':
        crop(sys.argv[2], *[int(v) for v in sys.argv[3:9]], sys.argv[9])
    elif cmd == 'cells':
        cells(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
