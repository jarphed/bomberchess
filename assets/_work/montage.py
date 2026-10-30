import sys
sys.path.insert(0, '/Users/pontusjarphed/code/bomberchess/assets/_work')
from pngtool import read_png, write_png

def montage(out, scale, cols, files, bg=(60, 60, 60, 255)):
    imgs = []
    for f in files:
        w, h, px = read_png(f)
        imgs.append((w, h, px))
    cw = max(w for w, _, _ in imgs) * scale + 8
    ch = max(h for _, h, _ in imgs) * scale + 8
    rows = (len(imgs) + cols - 1) // cols
    W, H = cols * cw, rows * ch
    canvas = [bg] * (W * H)
    for i, (w, h, px) in enumerate(imgs):
        ox, oy = (i % cols) * cw + 4, (i // cols) * ch + 4
        for y in range(h * scale):
            for x in range(w * scale):
                p = px[(y // scale) * w + (x // scale)]
                if p[3] == 0: continue
                canvas[(oy + y) * W + ox + x] = p
    write_png(out, W, H, canvas)
    print('wrote', out, W, 'x', H)

if __name__ == '__main__':
    montage(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:])
