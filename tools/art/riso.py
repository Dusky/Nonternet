"""Print a picture as a two-ink risograph on the site's paper.

The model draws; this does the printing. It throws away every colour the picture had and rebuilds it from two
spot inks laid over paper, each as a real halftone screen at its own angle, slightly out of register, with uneven
ink and paper grain. Gradients, glows and the hundreds of in-between colours a generator leaves behind cannot
survive it.

    python riso.py in.png out.png --width 1200 [--paper fff3c4 --ink1 141414 --ink2 ff4fa0]
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def screen(h, w, cell, angle):
    """A dot-screen threshold map in [0,1]: ink goes where the plate's density is above it."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.deg2rad(angle)
    u = (x * np.cos(a) + y * np.sin(a)) / cell
    v = (-x * np.sin(a) + y * np.cos(a)) / cell
    return 0.5 - 0.25 * (np.cos(2 * np.pi * u) + np.cos(2 * np.pi * v))


def smooth(t, lo, hi):
    t = np.clip((t - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def plates(rgb):
    """Split a picture into a key (dark) plate and a colour plate, both densities in [0,1]."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0)
    # Warm colours (reds, oranges, pinks) go to the colour ink; cool colours and greys go to the key ink.
    warm = np.clip((r - np.maximum(g, b)) * 3.0, 0, 1)
    cool = sat * (1 - warm)                                           # teals, blues, greens
    key = smooth(1 - lum, 0.38, 1.0) * (1 - 0.65 * warm) * (1 - 0.5 * smooth(cool, 0.2, 0.6))
    key = np.maximum(key, (lum < 0.33).astype(np.float32))          # drawn lines stay solid
    colour = np.clip(warm * 1.25, 0, 1) * smooth(1 - lum, 0.05, 0.55)
    colour = np.maximum(colour, smooth(sat, 0.25, 0.7) * (1 - warm) * 0.35 * smooth(1 - lum, 0.1, 0.6))
    # The source's own paper (light, nearly colourless) is our paper: no ink at all there.
    bare = smooth(lum, 0.74, 0.86) * (1 - smooth(warm, 0.15, 0.4))
    return key * (1 - bare), colour * (1 - bare)


def print_riso(img, width, paper, ink1, ink2, cell=None, seed=7, offset=(3, -2)):
    img = img.convert('RGB')
    h = round(img.height * width / img.width)
    rgb = np.asarray(img.resize((width, h), Image.LANCZOS), dtype=np.float32) / 255.0
    # A little blur first, so the screen samples tone rather than the generator's fine noise.
    rgb = ndimage.gaussian_filter(rgb, sigma=(1.0, 1.0, 0))
    key, colour = plates(rgb)
    cell = cell or max(4.0, width / 240)
    rng = np.random.default_rng(seed)
    ink_k = (key > screen(h, width, cell, 45)).astype(np.float32)
    ink_c = (colour > screen(h, width, cell * 1.1, 15)).astype(np.float32)
    ink_c = np.roll(ink_c, offset, axis=(0, 1))                      # out of register
    # Uneven ink: a soft blotchy field, thinner in places, like a drum that wasn't quite even.
    def blotch(scale):
        n = ndimage.gaussian_filter(rng.standard_normal((h, width)), scale)
        return np.clip(0.88 + 0.12 * n / (n.std() + 1e-6), 0.6, 1.0)
    cov_k = ink_k * blotch(width / 30) * 0.94
    cov_c = ink_c * blotch(width / 25) * 0.9
    out = np.ones((h, width, 3), np.float32) * paper
    grain = 1 - 0.02 * ndimage.gaussian_filter(rng.standard_normal((h, width)), 0.7)[..., None]
    out *= grain
    # Inks are translucent and overprint: each one multiplies what is under it.
    out *= 1 - cov_c[..., None] * (1 - ink2)
    out *= 1 - cov_k[..., None] * (1 - ink1)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('src'); p.add_argument('dst')
    p.add_argument('--width', type=int, default=1200)
    p.add_argument('--paper', default='fff3c4'); p.add_argument('--ink1', default='141414'); p.add_argument('--ink2', default='ff4fa0')
    p.add_argument('--cell', type=float, default=None)
    a = p.parse_args()
    print_riso(Image.open(a.src), a.width, hex_rgb(a.paper), hex_rgb(a.ink1), hex_rgb(a.ink2), a.cell).save(a.dst)
