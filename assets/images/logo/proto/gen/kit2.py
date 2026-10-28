"""Shapes and patterns for the icon concepts: the Concept base, arcs, waves, pixel sprites,
isometric solids, spheres, dot and hatch fills.

Rebuilt from the design pages: every icon of the 33 pages regenerates byte for byte.
"""

import math

from core import Style, circ, group, n, poly, rect, reg_pts


class Concept(Style):
    """Base of every design class (see core.Style)."""


def arc_d(cx, cy, r, a0, a1):
    """Path data of the clockwise arc from angle a0 to a1 (degrees, 0 = right, y down)."""
    x0, y0 = cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0))
    x1, y1 = cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1))
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{n(x0)} {n(y0)}A{n(r)} {n(r)} 0 {large} 1 {n(x1)} {n(y1)}"


def sine(x0, y0, x1, y1, amp, cycles=1, steps=28, phase=0):
    """Points along a segment, pushed sideways by amp * sin(2 pi cycles t + phase)."""
    length = math.hypot(x1 - x0, y1 - y0)
    nx, ny = -(y1 - y0) / length, (x1 - x0) / length
    out = []
    for i in range(steps + 1):
        t = i / steps
        d = amp * math.sin(2 * math.pi * cycles * t + phase)
        out.append((x0 + (x1 - x0) * t + nx * d, y0 + (y1 - y0) * t + ny * d))
    return out


def spiral(cx, cy, r0, r1, turns, steps=48):
    """Points of an Archimedean spiral from radius r0 to r1."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        a = t * turns * 2 * math.pi
        r = r0 + (r1 - r0) * t
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def sprite(rows, colours, cx, cy, px):
    """Pixel art centred on (cx, cy): one rect per run of one character, rows top to bottom."""
    h, w = len(rows), max(len(r) for r in rows)
    x0, y0 = cx - w * px / 2, cy - h * px / 2
    out = ""
    for j, row in enumerate(rows):
        i = 0
        while i < len(row):
            ch, end = row[i], i
            while end < len(row) and row[end] == ch:
                end += 1
            if ch in colours:
                out += rect(x0 + i * px, y0 + j * px, (end - i) * px, px, fill=colours[ch])
            i = end
    return out


def dots(cx, colour, pitch, r):
    """Dot pattern fill, as a url(#id)."""
    ident = cx.new_id("p")
    cx.add(
        f'<pattern id="{ident}" width="{n(pitch)}" height="{n(pitch)}" patternUnits="userSpaceOnUse">'
        f'<circle cx="{n(pitch / 2)}" cy="{n(pitch / 2)}" r="{n(r)}" fill="{colour}"/></pattern>'
    )
    return f"url(#{ident})"


def hatch(cx, colour, pitch, thick, angle):
    """Diagonal stripe pattern fill, as a url(#id)."""
    ident = cx.new_id("h")
    cx.add(
        f'<pattern id="{ident}" width="{n(pitch)}" height="{n(pitch)}" patternUnits="userSpaceOnUse" '
        f'patternTransform="rotate({n(angle)})">'
        f'<rect width="{n(thick)}" height="{n(pitch)}" fill="{colour}"/></pattern>'
    )
    return f"url(#{ident})"


def arrow_poly(x0, y0, x1, y1, w=7, head=14, hw=19, **kw):
    """Arrow from (x0, y0) to the tip (x1, y1): shaft width w, head length and width."""
    length = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    nx, ny = -uy, ux
    bx, by = x1 - ux * head, y1 - uy * head
    pts = [
        (x0 + nx * w / 2, y0 + ny * w / 2),
        (bx + nx * w / 2, by + ny * w / 2),
        (bx + nx * hw / 2, by + ny * hw / 2),
        (x1, y1),
        (bx - nx * hw / 2, by - ny * hw / 2),
        (bx - nx * w / 2, by - ny * w / 2),
        (x0 - nx * w / 2, y0 - ny * w / 2),
    ]
    return poly(pts, **kw)


def pent(cx, cy, r):
    """Regular pentagon, one corner up."""
    return reg_pts(cx, cy, r, 5, -90)


def _outline(stroke, sw):
    return dict(stroke=stroke, stroke_width=sw, stroke_linejoin="round") if stroke else {}


def iso_cube(cx, cy, s, top, left, right, stroke=None, sw=1):
    """Isometric cube whose bottom corner is (cx, cy + s); faces drawn left, right, top."""
    k, edge = s * math.sqrt(3) / 2, _outline(stroke, sw)
    return (
        poly([(cx - k, cy - s / 2), (cx, cy), (cx, cy + s), (cx - k, cy + s / 2)], fill=left, **edge)
        + poly([(cx, cy), (cx + k, cy - s / 2), (cx + k, cy + s / 2), (cx, cy + s)], fill=right, **edge)
        + poly([(cx, cy - s), (cx + k, cy - s / 2), (cx, cy), (cx - k, cy - s / 2)], fill=top, **edge)
    )


TETRA_FACES = (  # (points, colour slot: 0 top, 1 left, 2 right), drawn right, left, bottom
    ("24,9 40,36 25,28.2", 2),
    ("22.5,9.8 8,36 23,28.2", 1),
    ("9.5,38 38.5,38 24,30.2", 0),
)


def tetra(cx, cy, s, top, left, right, stroke=None, sw=1):
    """Tetrahedron, scaled by s around (24, 24) and moved to (cx, cy)."""
    colours, edge, out = (top, left, right), _outline(stroke, sw), ""
    for text_pts, slot in TETRA_FACES:
        pts = [tuple(map(float, p.split(","))) for p in text_pts.split()]
        out += poly([(cx + (x - 24) * s, cy + (y - 24) * s) for x, y in pts], fill=colours[slot], **edge)
    return out


def sphere(cx, x, y, r, c1, c2, rim=None, spot=True):
    """Ball with a radial gradient (light c1 to c2), an optional rim and a highlight."""
    ident = cx.new_id("r")
    cx.add(
        f'<radialGradient id="{ident}" fx="0.35" fy="0.3"><stop offset="0" stop-color="{c1}"/>'
        f'<stop offset="1" stop-color="{c2}"/></radialGradient>'
    )
    out = circ(x, y, r, fill=f"url(#{ident})", **(dict(stroke=rim, stroke_width=0.8) if rim else {}))
    if spot:
        out += circ(x - r * 0.36, y - r * 0.4, r * 0.2, fill="#ffffff", opacity=0.6)
    return out


def plane(markup, cx, cy, s):
    """Lay flat artwork (drawn around 0, 0) on an isometric ground plane at (cx, cy), scaled by s."""
    a, b = 0.866 * s, 0.5 * s
    return group(markup, transform=f"matrix({n(a)} {n(b)} {n(-a)} {n(b)} {n(cx)} {n(cy)})")


def slab(cx, cy, w, h, top, left, right):
    """Isometric slab: a rhombus top w wide on each side (w / 2 high), h thick, centred on (cx, cy)."""
    v = w / 2
    return (
        poly([(cx - w, cy), (cx, cy + v), (cx, cy + v + h), (cx - w, cy + h)], fill=left)
        + poly([(cx, cy + v), (cx + w, cy), (cx + w, cy + h), (cx, cy + v + h)], fill=right)
        + poly([(cx, cy - v), (cx + w, cy), (cx, cy + v), (cx - w, cy)], fill=top)
    )
