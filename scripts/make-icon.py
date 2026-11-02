"""Draws the extension icon: curly braces around a hash sign.

Usage: python scripts/make-icon.py media/icon.png

The Marketplace requires a PNG listing icon (SVG is not accepted). The icon is
drawn at 4x and downsampled for smooth edges. Requires Pillow.
"""

import sys

from PIL import Image, ImageDraw

SIZE = 256
SCALE = 4
S = SIZE * SCALE

BACKGROUND_TOP = (24, 42, 66)
BACKGROUND_BOTTOM = (15, 28, 46)
BRACE = (236, 241, 247)
HASH = (53, 208, 165)


def cubic(p0, p1, p2, p3, steps=400):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        yield x, y


def line(a, b, steps=400):
    for i in range(steps + 1):
        t = i / steps
        yield a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def stroke(draw, points, radius, color):
    """Round-capped stroke: stamp a disc at every sampled point."""
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def brace_points(mirror=False):
    # Left brace in a 1024 x 1024 canvas; the right brace mirrors it at x = 512.
    segments = [
        cubic((330, 214), (282, 214), (252, 236), (252, 292)),
        line((252, 292), (252, 446)),
        cubic((252, 446), (252, 490), (222, 512), (176, 512)),
        cubic((176, 512), (222, 512), (252, 534), (252, 578)),
        line((252, 578), (252, 732)),
        cubic((252, 732), (252, 788), (282, 810), (330, 810)),
    ]
    for segment in segments:
        for x, y in segment:
            yield (S - x if mirror else x), y


def main(path):
    image = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # Rounded square with a gentle vertical gradient.
    gradient = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(gradient)
    for y in range(S):
        t = y / (S - 1)
        color = tuple(round(a + (b - a) * t) for a, b in zip(BACKGROUND_TOP, BACKGROUND_BOTTOM))
        gd.line([(0, y), (S, y)], fill=color + (255,))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=round(S * 0.2), fill=255)
    image.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(image)
    stroke(draw, brace_points(), 30, BRACE)
    stroke(draw, brace_points(mirror=True), 30, BRACE)

    # Hash sign: two slanted uprights and two crossbars.
    hash_radius = 22
    stroke(draw, line((474, 384), (446, 640)), hash_radius, HASH)
    stroke(draw, line((578, 384), (550, 640)), hash_radius, HASH)
    stroke(draw, line((398, 468), (634, 468)), hash_radius, HASH)
    stroke(draw, line((390, 556), (626, 556)), hash_radius, HASH)

    image.resize((SIZE, SIZE), Image.LANCZOS).save(path, optimize=True)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: python scripts/make-icon.py <output.png>')
    main(sys.argv[1])
