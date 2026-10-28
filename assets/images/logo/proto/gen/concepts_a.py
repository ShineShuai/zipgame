"""Icon concepts 10-15: swiss glyphs, neon signs, candy shop, drafting symbols, concrete blocks,
retro game sprites."""

import math

from core import (
    circ,
    ell,
    group,
    line,
    path,
    poly,
    rect,
    register,
    text,
)
from kit import blur, clip, pix_text, sparkle
from kit2 import (
    Concept,
    arc_d,
    arrow_poly,
    hatch,
    iso_cube,
    pent,
    sine,
    sphere,
    sprite,
    tetra,
)


@register
class Swiss(Concept):
    """Helvetica specimen: every type is one bold glyph or flat shape on a ruled plate."""

    key = "10-swiss"
    title = "Swiss International"
    pal = {"card": "#ffffff"}
    INK, RED = "#111111", "#e4001b"

    def draw(self, kind, cx):
        plate = rect(4, 4, 40, 40, fill="#fff", stroke=self.INK, stroke_width=1.2)
        return plate + getattr(self, kind)(cx)

    def std(self, cx):
        pts = [
            (13, 12),
            (35, 12),
            (35, 17),
            (21, 31),
            (35, 31),
            (35, 36),
            (13, 36),
            (13, 31),
            (27, 17),
            (13, 17),
        ]
        return poly(pts, fill=self.INK)

    def cut(self, cx):
        return circ(24, 24, 12.5, fill="none", stroke=self.INK, stroke_width=7) + rect(
            22, 22, 4, 4, fill=self.RED
        )

    def arr(self, cx):
        return arrow_poly(9, 24, 39, 24, w=7, head=14, hw=19, fill=self.INK)

    def exact(self, cx):
        pts = [(12, 12), (36, 12), (36, 17), (24, 38), (17.5, 38), (29.5, 17), (12, 17)]
        return poly(pts, fill=self.RED)

    def wrap(self, cx):
        enter = poly([(4, 16), (12, 24), (4, 32)], fill=self.RED) + rect(
            12, 21, 9, 6, fill=self.INK
        )
        leave = rect(27, 21, 8, 6, fill=self.INK) + poly(
            [(35, 16), (43, 24), (35, 32)], fill=self.RED
        )
        return enter + leave

    def loop(self, cx):
        arc = path(arc_d(24, 24, 11, -60, 230), fill="none", stroke=self.INK, stroke_width=5)
        return arc + poly([(21.5, 11.7), (13.7, 11.8), (20.1, 19.4)], fill=self.RED)

    def tele(self, cx):
        return (
            line([(21, 21), (27, 27)], stroke=self.INK, stroke_width=0.8)
            + circ(16, 16, 8, fill=self.INK)
            + circ(32, 32, 8, fill=self.RED)
        )

    def pent(self, cx):
        return poly(pent(24, 25, 16), fill=self.INK) + circ(24, 25, 3, fill=self.RED)

    def tetra(self, cx):
        return poly([(24, 9), (8, 37), (24, 37)], fill=self.INK) + poly(
            [(24, 9), (24, 37), (40, 37)], fill=self.RED
        )

    def cube(self, cx):
        return iso_cube(24, 25, 16, "#ffffff", self.RED, self.INK, stroke=self.INK, sw=1)

    def ball(self, cx):
        return circ(24, 24, 15, fill=self.INK) + path(
            "M24 24L24 9A15 15 0 0 1 39 24Z", fill=self.RED
        )


@register
class Neon(Concept):
    """Neon sign shop: each type is a glowing tube sign."""

    key = "11-neon"
    title = "Night Circuit"
    pal = {"card": "#070a18"}
    C, M, Y = "#22e4ff", "#ff3da8", "#ffe14d"

    def draw(self, kind, cx):
        plate = rect(3.5, 3.5, 41, 41, 9, fill="#0b1030", stroke="#1d2766", stroke_width=0.8)
        return plate + getattr(self, kind)(cx)

    def tube(self, cx, markup):
        return group(markup, filter=blur(cx, 1.3), opacity=0.9) + markup

    def kw(self, colour, w=1.8):
        return dict(
            fill="none",
            stroke=colour,
            stroke_width=w,
            stroke_linecap="round",
            stroke_linejoin="round",
        )

    def std(self, cx):
        bolt = [(28, 5), (13, 25), (22, 25), (18, 43), (35, 19), (26, 19), (31, 5)]
        return self.tube(cx, poly(bolt, **self.kw(self.C)))

    def cut(self, cx):
        return self.tube(cx, path(arc_d(24, 24, 13, -50, 230), **self.kw(self.M, 2.2)))

    def arr(self, cx):
        shaft = line([(8, 24), (30, 24)], **self.kw(self.M))
        head = line([(25, 14), (40, 24), (25, 34)], **self.kw(self.C))
        return self.tube(cx, shaft + head)

    def exact(self, cx):
        seven = line([(13, 12), (35, 12), (22, 38)], **self.kw(self.M, 2.2))
        return self.tube(cx, seven) + self.tube(cx, circ(36, 36, 1.6, fill=self.C))

    def wrap(self, cx):
        left = line([(6, 24), (17, 24)], **self.kw(self.C)) + line(
            [(12, 17), (18, 24), (12, 31)], **self.kw(self.C)
        )
        right = line([(28, 24), (39, 24)], **self.kw(self.M)) + line(
            [(34, 17), (40, 24), (34, 31)], **self.kw(self.M)
        )
        return self.tube(cx, left) + self.tube(cx, right)

    def loop(self, cx):
        arc = path(arc_d(24, 24, 13, -70, 220), **self.kw(self.C))
        head = line([(15, 10), (20, 14), (15, 19)], **self.kw(self.M))
        return self.tube(cx, arc + head)

    def tele(self, cx):
        a = circ(16, 16, 7, **self.kw(self.C)) + circ(16, 16, 3, **self.kw(self.C))
        b = circ(32, 32, 7, **self.kw(self.M)) + circ(32, 32, 3, **self.kw(self.M))
        link = line(
            [(21, 21), (27, 27)],
            stroke="#ffffff",
            stroke_width=1.2,
            stroke_dasharray="0.1 2.2",
            stroke_linecap="round",
        )
        return self.tube(cx, a) + self.tube(cx, b) + link

    def pent(self, cx):
        return self.tube(cx, poly(pent(24, 25, 16), **self.kw(self.M))) + self.tube(
            cx, poly(pent(24, 25, 7), **self.kw(self.C))
        )

    def tetra(self, cx):
        outer = poly([(24, 8), (8, 37), (40, 37)], **self.kw(self.C))
        inner = line([(24, 8), (24, 28), (8, 37)], **self.kw(self.M)) + line(
            [(24, 28), (40, 37)], **self.kw(self.M)
        )
        return self.tube(cx, outer) + self.tube(cx, inner)

    def cube(self, cx):
        w = 14 * 0.866
        hexa = poly(
            [(24, 10), (24 + w, 17), (24 + w, 31), (24, 38), (24 - w, 31), (24 - w, 17)],
            **self.kw(self.C),
        )
        inner = line([(24 - w, 17), (24, 24), (24 + w, 17)], **self.kw(self.M)) + line(
            [(24, 24), (24, 38)], **self.kw(self.M)
        )
        return self.tube(cx, hexa) + self.tube(cx, inner)

    def ball(self, cx):
        body = circ(24, 27, 13, **self.kw(self.C))
        lat = ell(24, 27, 13, 4.5, **self.kw(self.M, 1.2)) + ell(
            24, 27, 4.5, 13, **self.kw(self.M, 1.2)
        )
        cord = line([(24, 4), (24, 14)], stroke="#9aa6ff", stroke_width=1.2)
        return self.tube(cx, body) + self.tube(cx, lat) + cord + sparkle(38, 9, 3.4, self.Y)


@register
class Candy(Concept):
    """Gummy sweets: worm, chocolate bar, striped arrow, candy digit, bead ring, ring portals."""

    key = "12-candy"
    title = "Candy Tiles"
    font = "Fredoka,'Trebuchet MS',sans-serif"
    pal = {"card": "#efe7ff"}
    BERRY, GRAPE, SUN, MINT, PINK = "#e8384f", "#6a4cf0", "#ffc531", "#14b8a6", "#ff6fa8"
    LIME, ORG, CHOC = "#8bd450", "#ff9a3c", "#6b3a1e"
    ALTS = [
        ("tele", "A ring pair"),
        ("tele_b", "B gumball machine"),
        ("tele_c", "C jars and tube"),
        ("tele_d", "D twin wrappers"),
    ]

    def draw(self, kind, cx):
        plate = rect(3, 4.6, 42, 40, 12, fill="#d6c8ff") + rect(3, 3, 42, 40, 12, fill="#ffffff")
        return plate + getattr(self, kind)(cx)

    def worm(self, pts, c1, c2=None, w=8):
        half = len(pts) // 2
        kw = dict(stroke_width=w, stroke_linecap="round", stroke_linejoin="round")
        out = line(pts[: half + 1], stroke=c1, **kw) + line(pts[half:], stroke=c2 or c1, **kw)
        shine = [(x - 1, y - 1.8) for x, y in pts]
        out += line(shine, stroke="#fff", stroke_width=1.4, stroke_linecap="round", opacity=0.5)
        x, y = pts[-1]
        eyes = circ(x - 1.4, y - 2, 1.5, fill="#fff") + circ(x + 1.8, y - 1.2, 1.5, fill="#fff")
        return (
            out
            + eyes
            + circ(x - 1.1, y - 2, 0.6, fill="#2a1d6e")
            + circ(x + 2.1, y - 1.2, 0.6, fill="#2a1d6e")
        )

    def std(self, cx):
        return self.worm(sine(8, 34, 40, 14, 4.5, 1.5), self.LIME, self.ORG)

    def cut(self, cx):
        out = ""
        for r in range(3):
            for c in range(3):
                if (r, c) in ((1, 1), (2, 2)):
                    continue
                x, y = 8 + c * 10.4, 8 + r * 10.4
                out += (
                    rect(x, y, 9, 9, 2, fill=self.CHOC)
                    + rect(x + 1.2, y + 1.2, 6.6, 6.6, 1.2, fill="#8a4f2a")
                    + rect(x + 1.2, y + 1.2, 6.6, 1.6, 0.8, fill="#b57a48")
                )
        return out

    def arr(self, cx):
        shape = dict(w=11, head=14, hw=22)
        base = arrow_poly(
            8,
            24,
            40,
            24,
            fill="#fff",
            stroke=self.BERRY,
            stroke_width=2,
            stroke_linejoin="round",
            **shape,
        )
        return base + arrow_poly(8, 24, 40, 24, fill=hatch(cx, self.BERRY, 6, 3, 45), **shape)

    def exact(self, cx):
        d = [(14, 13), (34, 13), (22, 37)]
        kw = dict(fill="none", stroke_linecap="round", stroke_linejoin="round")
        return (
            line(d, stroke=self.GRAPE, stroke_width=10.6, **kw)
            + line(d, stroke="#ffffff", stroke_width=8, **kw)
            + line(
                d,
                stroke=self.BERRY,
                stroke_width=8,
                stroke_dasharray="3.6 3.6",
                stroke_linecap="butt",
                stroke_linejoin="round",
                fill="none",
            )
        )

    def wrap(self, cx):
        area = clip(cx, rect(4, 4, 40, 40, 11))
        tail = self.worm_body(sine(2, 27, 18, 27, 2, 0.5), self.LIME)
        head = self.worm(sine(28, 21, 42, 21, 2, 0.5), self.LIME, self.ORG)
        link = line(
            [(20, 26), (26, 22)],
            stroke="#c9b8f5",
            stroke_width=1.4,
            stroke_dasharray="0.1 2.6",
            stroke_linecap="round",
        )
        return group(tail + head, clip_path=area) + link

    def worm_body(self, pts, colour, w=8):
        kw = dict(stroke_width=w, stroke_linecap="round", stroke_linejoin="round")
        shine = [(x - 1, y - 1.8) for x, y in pts]
        return line(pts, stroke=colour, **kw) + line(
            shine, stroke="#fff", stroke_width=1.4, stroke_linecap="round", opacity=0.5
        )

    def loop(self, cx):
        colours = [self.BERRY, self.SUN, self.MINT, self.PINK, self.GRAPE]
        out = circ(24, 24, 13, fill="none", stroke="#d8c9ff", stroke_width=1)
        for i in range(12):
            a = math.radians(i * 30 - 90)
            x, y = 24 + 13 * math.cos(a), 24 + 13 * math.sin(a)
            out += circ(x, y, 3.3, fill=colours[i % 5]) + circ(
                x - 1, y - 1, 1, fill="#fff", opacity=0.7
            )
        return out

    def ring(self, x, y, colour):
        ticks = "".join(
            line(
                [
                    (x + 5 * math.cos(math.radians(a)), y + 5 * math.sin(math.radians(a))),
                    (x + 7.4 * math.cos(math.radians(a)), y + 7.4 * math.sin(math.radians(a))),
                ],
                stroke="#fff",
                stroke_width=1.4,
                stroke_linecap="round",
                opacity=0.85,
            )
            for a in range(0, 360, 60)
        )
        return (
            circ(x, y, 8.6, fill=colour)
            + circ(x, y, 3.6, fill="#ffffff")
            + ticks
            + circ(x - 3.6, y - 4.4, 1.2, fill="#fff", opacity=0.8)
        )

    def tele(self, cx):
        a, b = (15, 16), (33, 32)
        colours = [self.SUN, self.BERRY, self.GRAPE, self.LIME]
        trail = ""
        for i, t in enumerate((0.3, 0.45, 0.6, 0.75)):
            x = (1 - t) ** 2 * a[0] + 2 * t * (1 - t) * 31 + t * t * b[0]
            y = (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * 18 + t * t * b[1]
            trail += circ(x, y, 1.5, fill=colours[i])
        return self.ring(15, 16, self.MINT) + trail + self.ring(33, 32, self.PINK)

    def tele_b(self, cx):
        globe = circ(24, 15, 11, fill="#dff3ff", stroke="#9ec9e8", stroke_width=1)
        balls = "".join(
            circ(x, y, 2.8, fill=c)
            for x, y, c in (
                (20, 17, self.BERRY),
                (27, 18, self.SUN),
                (24, 11, self.MINT),
                (19, 12, self.GRAPE),
                (29, 12, self.PINK),
            )
        )
        body = rect(14, 26, 20, 12, 3, fill=self.BERRY) + circ(24, 31, 3, fill=self.SUN)
        tray = rect(18, 38, 12, 4, 1.5, fill="#6e5aa8") + circ(24, 36.6, 2.6, fill=self.LIME)
        return (
            globe
            + balls
            + body
            + tray
            + arrow_poly(38, 24, 38, 40, w=2, head=5, hw=6, fill=self.GRAPE)
        )

    def tele_c(self, cx):
        def jar(x, y, colours):
            lid = rect(x + 2, y, 10, 4, 1.5, fill=self.BERRY)
            glass = rect(x, y + 3, 14, 14, 3, fill="#eaf4ff", stroke="#9ec9e8", stroke_width=1)
            sweets = "".join(
                circ(x + dx, y + 12, 2.2, fill=c) for dx, c in zip((4, 7.5, 11), colours)
            )
            return glass + lid + sweets

        tube = path(
            "M19 15H31V28",
            fill="none",
            stroke="#9ec9e8",
            stroke_width=5.6,
            stroke_linecap="round",
            stroke_linejoin="round",
        ) + path(
            "M19 15H31V28",
            fill="none",
            stroke="#eaf4ff",
            stroke_width=3.4,
            stroke_linecap="round",
            stroke_linejoin="round",
        )
        return (
            jar(5, 6, (self.SUN, self.MINT, self.PINK))
            + tube
            + circ(26, 15, 2.4, fill=self.GRAPE)
            + jar(29, 28, (self.PINK, self.LIME, self.SUN))
        )

    def tele_d(self, cx):
        def wrapped(x, y, c):
            ends = poly([(x - 6, y), (x - 12, y - 5), (x - 12, y + 5)], fill=self.MINT) + poly(
                [(x + 6, y), (x + 12, y - 5), (x + 12, y + 5)], fill=self.MINT
            )
            return (
                ends
                + ell(x, y, 8, 6, fill=c)
                + path(
                    f"M{x - 5} {y - 2}Q{x} {y - 6} {x + 5} {y - 2}",
                    fill="none",
                    stroke="#fff",
                    stroke_width=1.2,
                )
            )

        link = line(
            [(20, 21), (28, 28)],
            stroke="#c9b8f5",
            stroke_width=1.6,
            stroke_dasharray="0.1 2.6",
            stroke_linecap="round",
        )
        return (
            wrapped(14, 14, self.BERRY)
            + link
            + wrapped(34, 34, self.BERRY)
            + sparkle(36, 12, 3.4, self.SUN)
            + sparkle(12, 36, 3, self.SUN)
        )

    def pent(self, cx):
        pts = pent(24, 25, 15)
        crystals = "".join(
            circ(x, y, 0.9, fill="#fff")
            for x, y in ((18, 28), (29, 29), (24, 33), (20, 21), (30, 22), (24, 25))
        )
        return (
            poly(pts, fill=self.SUN, stroke=self.SUN, stroke_width=5, stroke_linejoin="round")
            + crystals
            + ell(18, 17, 4.5, 2.2, fill="#fff", opacity=0.6, transform="rotate(-30 18 17)")
        )

    def tetra(self, cx):
        sugar = "".join(
            circ(x, y, 0.8, fill="#fff")
            for x, y in ((24, 18), (20, 30), (30, 31), (27, 24), (15, 34))
        )
        return tetra(24, 24, 1.05, "#ffc2d9", self.PINK, "#d93d7b") + sugar

    def cube(self, cx):
        sugar = "".join(
            circ(x, y, 0.8, fill="#fff")
            for x, y in ((24, 15), (20, 20), (28, 20), (16, 26), (32, 28), (24, 33))
        )
        return (
            iso_cube(24, 25, 15, "#c9ef9e", self.LIME, "#5fa82f")
            + sugar
            + sparkle(37, 10, 3.4, self.SUN)
        )

    def ball(self, cx):
        return sphere(cx, 24, 24, 15, "#ff8a9a", self.BERRY) + circ(
            24, 24, 15, fill="none", stroke="#fff", stroke_width=0.8, opacity=0.4
        )


@register
class Blueprint(Concept):
    """Drafting symbols: dimension lines, sections, callouts and construction geometry."""

    key = "13-blueprint"
    title = "Blueprint"
    font = "'JetBrains Mono',ui-monospace,Menlo,monospace"
    pal = {"card": "#0b3bd8"}
    W, Y = "#ffffff", "#ffd23f"

    def draw(self, kind, cx):
        plate = rect(3, 3, 42, 42, 2, fill="#0a32b8", stroke="#ffffff", stroke_width=0.7)
        return plate + getattr(self, kind)(cx)

    def ln(self, pts, colour=None, w=1.0, **kw):
        return line(pts, stroke=colour or self.W, stroke_width=w, **kw)

    def head(self, x, y, dx, dy, colour=None):
        nx, ny = -dy, dx
        pts = [
            (x, y),
            (x - dx * 4 + nx * 1.5, y - dy * 4 + ny * 1.5),
            (x - dx * 4 - nx * 1.5, y - dy * 4 - ny * 1.5),
        ]
        return poly(pts, fill=colour or self.W)

    def std(self, cx):
        ticks = "".join(f"M{6 + i * 3.6:.1f} 17v{4 if i % 2 == 0 else 2.4}" for i in range(11))
        return (
            rect(6, 17, 36, 13, fill="none", stroke=self.W, stroke_width=1)
            + path(ticks, stroke=self.W, stroke_width=0.8, fill="none")
            + self.ln([(8, 38), (40, 38)], self.Y)
            + self.head(8, 38, -1, 0, self.Y)
            + self.head(40, 38, 1, 0, self.Y)
        )

    def cut(self, cx):
        "".join(f"M{8 + k} 38L{38} {8 + k - 0}" for k in ())
        "".join(f"M{10 + k} 38L38 {10 + k}M10 {10 + k}L{10 + k} 10" for k in ())
        diag = "".join(f"M{10} {14 + k}L{14 + k} 10" for k in range(0, 28, 5))
        diag += "".join(f"M{38} {20 + k}L{20 + k} 38" for k in range(0, 18, 5))
        return (
            rect(10, 10, 28, 28, fill="none", stroke=self.W, stroke_width=1.2)
            + path(diag, stroke=self.Y, stroke_width=0.8, fill="none")
            + self.ln([(5, 24), (43, 24)], self.W, 0.8, stroke_dasharray="6 1.6 1 1.6")
            + self.head(5, 12, 0, 1, self.W)
            + self.head(43, 12, 0, 1, self.W)
        )

    def arr(self, cx):
        return (
            self.ln([(12, 36), (28, 14), (41, 14)], self.W, 1.1)
            + self.head(11, 37.5, -0.5, 0.86, self.Y)
            + circ(41, 14, 1.2, fill=self.Y)
            + self.ln([(30, 20), (30, 38)], self.Y, 0.8, stroke_dasharray="2 1.5")
        )

    def exact(self, cx):
        return (
            self.ln([(8, 31), (40, 31)], self.W)
            + self.head(8, 31, -1, 0)
            + self.head(40, 31, 1, 0)
            + self.ln([(8, 22), (8, 36)])
            + self.ln([(40, 22), (40, 36)])
            + text(24, 22, "12.0", 8, font_family=self.font, font_weight=700, fill=self.Y)
        )

    def wrap(self, cx):
        brk = self.ln([(24, 5), (24, 43)], self.W, 0.9, stroke_dasharray="5 1.5 1 1.5")
        left = self.ln([(8, 17), (22, 17)], self.Y, 1.2) + self.head(22, 17, 1, 0, self.Y)
        right = self.ln([(26, 31), (40, 31)], self.Y, 1.2) + self.head(40, 31, 1, 0, self.Y)
        return (
            brk
            + left
            + right
            + circ(10, 31, 3.4, fill="none", stroke=self.W, stroke_width=1)
            + circ(38, 17, 3.4, fill="none", stroke=self.W, stroke_width=1)
        )

    def loop(self, cx):
        arc = path(arc_d(24, 24, 13, -60, 230), fill="none", stroke=self.Y, stroke_width=1.3)
        axis = self.ln([(24, 4), (24, 44)], self.W, 0.7, stroke_dasharray="5 1.5 1 1.5") + self.ln(
            [(4, 24), (44, 24)], self.W, 0.7, stroke_dasharray="5 1.5 1 1.5"
        )
        return (
            axis
            + arc
            + self.head(16.5, 14.5, 0.65, -0.76, self.Y)
            + circ(24, 24, 2, fill="none", stroke=self.W, stroke_width=0.8)
        )

    def tele(self, cx):
        small = circ(13, 34, 5, fill="none", stroke=self.W, stroke_width=1.1) + self.ln(
            [(10, 34), (16, 34)], self.Y, 0.8
        )
        big = circ(31, 17, 11, fill="none", stroke=self.W, stroke_width=1.1) + rect(
            26, 12, 10, 10, fill="none", stroke=self.Y, stroke_width=1
        )
        links = self.ln([(16.5, 30.5), (22.5, 24.5)], self.W, 0.8) + self.ln(
            [(16.8, 36.5), (37.5, 26)], self.W, 0.8
        )
        return small + big + links

    def pent(self, cx):
        pts = pent(24, 24, 13)
        diag = "".join(
            f"M{pts[i][0]:.1f} {pts[i][1]:.1f}L{pts[(i + 2) % 5][0]:.1f} {pts[(i + 2) % 5][1]:.1f}"
            for i in range(5)
        )
        return (
            circ(
                24, 24, 13, fill="none", stroke=self.Y, stroke_width=0.8, stroke_dasharray="3 1.5"
            )
            + poly(pts, fill="none", stroke=self.W, stroke_width=1.3)
            + path(diag, stroke=self.W, stroke_width=0.6, fill="none", opacity=0.8)
        )

    def tetra(self, cx):
        return (
            poly([(24, 8), (7, 38), (41, 38)], fill="none", stroke=self.W, stroke_width=1.3)
            + self.ln([(24, 8), (24, 28), (7, 38)], self.W, 1.0)
            + self.ln([(24, 28), (41, 38)], self.W, 1.0)
            + self.ln([(24, 4), (24, 44)], self.Y, 0.6, stroke_dasharray="5 1.5 1 1.5")
        )

    def cube(self, cx):
        w = 14 * 0.866
        hexa = poly(
            [(24, 10), (24 + w, 17), (24 + w, 31), (24, 38), (24 - w, 31), (24 - w, 17)],
            fill="none",
            stroke=self.W,
            stroke_width=1.3,
            stroke_linejoin="miter",
        )
        near = self.ln([(24 - w, 17), (24, 24), (24 + w, 17)], self.W, 1.1) + self.ln(
            [(24, 24), (24, 38)], self.W, 1.1
        )
        hidden = (
            self.ln([(24, 24), (24, 10)], self.Y, 0.8, stroke_dasharray="2 1.5")
            + self.ln([(24, 24), (24 - w, 31)], self.Y, 0.8, stroke_dasharray="2 1.5")
            + self.ln([(24, 24), (24 + w, 31)], self.Y, 0.8, stroke_dasharray="2 1.5")
        )
        return hexa + hidden + near

    def ball(self, cx):
        return (
            circ(24, 24, 14, fill="none", stroke=self.W, stroke_width=1.3)
            + ell(
                24,
                24,
                14,
                5,
                fill="none",
                stroke=self.W,
                stroke_width=0.8,
                stroke_dasharray="2 1.5",
            )
            + ell(24, 24, 5, 14, fill="none", stroke=self.W, stroke_width=0.8)
            + self.ln([(24, 4), (24, 44)], self.Y, 0.7, stroke_dasharray="5 1.5 1 1.5")
            + self.ln([(4, 24), (44, 24)], self.Y, 0.7, stroke_dasharray="5 1.5 1 1.5")
        )


@register
class Brutalist(Concept):
    """Concrete architecture: chunky blocks with hard shadows."""

    key = "14-brutalist"
    title = "Pop Brutalist"
    font = "Archivo,'Arial Black',sans-serif"
    pal = {"card": "#ffdc4a"}
    PINK, BLUE, INK = "#ff5fa2", "#3d5afe", "#000000"

    def draw(self, kind, cx):
        plate = rect(6, 6, 38, 38, fill=self.INK) + rect(
            3, 3, 38, 38, fill="#ffdc4a", stroke=self.INK, stroke_width=2
        )
        return plate + getattr(self, kind)(cx)

    def hard(self, fn, d=2.4):
        """fn(fill, stroke) -> markup. Black copy offset, then the coloured one."""
        return group(fn(self.INK, self.INK), transform=f"translate({d} {d})") + fn(None, self.INK)

    def blk(self, pts, fill, **extra):
        return lambda f, s: poly(
            pts, fill=f or fill, stroke=s, stroke_width=2.2, stroke_linejoin="miter", **extra
        )

    def std(self, cx):
        pts = [(7, 38), (7, 30), (15, 30), (15, 22), (23, 22), (23, 14), (31, 14), (31, 38)]
        return self.hard(self.blk(pts, self.PINK))

    def cut(self, cx):
        rect(7, 7, 28, 28, fill="#fff", stroke=self.INK, stroke_width=2.2)
        return self.hard(
            lambda f, s: rect(7, 7, 28, 28, fill=f or "#fff", stroke=s, stroke_width=2.2)
        ) + rect(15, 15, 12, 12, fill=self.INK)

    def arr(self, cx):
        pts = [(5, 17), (22, 17), (22, 8), (37, 21), (22, 34), (22, 25), (5, 25)]
        return self.hard(self.blk(pts, self.BLUE))

    def exact(self, cx):
        return self.hard(
            lambda f, s: rect(7, 7, 28, 28, fill=f or "#fff", stroke=s, stroke_width=2.2)
        ) + text(21, 22, "7", 26, font_weight=900, font_family=self.font, fill=self.INK)

    def wrap(self, cx):
        body = lambda f, s: rect(7, 12, 27, 20, fill=f or self.PINK, stroke=s, stroke_width=2.2)
        tab = lambda f, s: circ(35, 22, 4, fill=f or self.PINK, stroke=s, stroke_width=2.2)
        return (
            self.hard(body)
            + self.hard(tab)
            + circ(7, 22, 4, fill="#ffdc4a", stroke=self.INK, stroke_width=2.2)
        )

    def loop(self, cx):
        return self.hard(
            lambda f, s: circ(21, 21, 14, fill=f or self.BLUE, stroke=s, stroke_width=2.2)
        ) + circ(21, 21, 6, fill="#ffdc4a", stroke=self.INK, stroke_width=2.2)

    def tele(self, cx):
        door = "M14 36V22a7 7 0 0 1 14 0V36Z"
        return self.hard(
            lambda f, s: rect(7, 7, 28, 29, fill=f or "#fff", stroke=s, stroke_width=2.2)
        ) + path(door, fill=self.INK)

    def pent(self, cx):
        pts = [(21, 6), (36, 17), (31, 37), (11, 37), (6, 17)]
        return self.hard(self.blk(pts, "#fff"))

    def tetra(self, cx):
        pts = [(21, 6), (37, 36), (5, 36)]
        return self.hard(self.blk(pts, self.PINK)) + line(
            [(21, 6), (21, 36)], stroke=self.INK, stroke_width=2.2
        )

    def cube(self, cx):
        return group(
            iso_cube(23, 24, 15, self.INK, self.INK, self.INK, stroke=self.INK, sw=2),
            transform="translate(2.4 2.4)",
        ) + iso_cube(21, 22, 15, "#fff", self.PINK, self.BLUE, stroke=self.INK, sw=2.2)

    def ball(self, cx):
        return self.hard(
            lambda f, s: circ(21, 21, 15, fill=f or self.PINK, stroke=s, stroke_width=2.2)
        ) + circ(15, 14, 3.4, fill="#fff", stroke=self.INK, stroke_width=1.4)


@register
class Pixel(Concept):
    """Retro game sprites: snake, wall, d-pad, score, pac-man, pipe, ghosts, tetromino, dice."""

    key = "15-pixel"
    title = "Pixel Arcade"
    font = "Silkscreen,'Courier New',monospace"
    pal = {"card": "#120d2b"}

    def draw(self, kind, cx):
        step = 3
        d = (
            f"M{3 + step} 3H{45 - step}V{3 + step}H45V{45 - step}H{45 - step}V45H{3 + step}"
            f"V{45 - step}H3V{3 + step}H{3 + step}Z"
        )
        plate = path(d, fill="#1b1445", stroke="#5b4bb5", stroke_width=1.5)
        return group(plate + getattr(self, kind)(cx), shape_rendering="crispEdges")

    def disc(self, size, r, colours, light=(-0.5, -0.5)):
        rows = []
        c = (size - 1) / 2
        for j in range(size):
            row = ""
            for i in range(size):
                d = math.hypot(i - c, j - c)
                if d > r:
                    row += "."
                    continue
                shade = ((i - c) * light[0] + (j - c) * light[1]) / max(d, 0.1)
                row += "L" if (shade > 0.78 and d > 1.2) else ("D" if shade < -0.7 else "M")
            rows.append(row)
        return rows

    def std(self, cx):
        rows = [
            ".GGGGGGGGGG.",
            ".G..........",
            ".GGGGGGGGGG.",
            "..........G.",
            ".GGGGGGGGGG.",
            ".G..........",
            ".GGGGGGGGGHR",
        ]
        return sprite(rows, {"G": "#3dff8b", "H": "#b6ffd0", "R": "#ff4d6d"}, 24, 24, 3)

    def cut(self, cx):
        rows = [
            "BBBBBBBBBBBB",
            "MMMMMMMMMMMM",
            "BBBB....BBBB",
            "BBB......BBB",
            "MMM......MMM",
            "BBB......BBB",
            "BBBB....BBBB",
            "MMMMMMMMMMMM",
            "BBBBBBBBBBBB",
        ]
        return sprite(rows, {"B": "#e2572a", "M": "#7a2e12"}, 24, 24, 3)

    def arr(self, cx):
        rows = [
            "...DDD...",
            "...DAD...",
            "...DDD...",
            "DDDDDDDDD",
            "DADDCDDAD",
            "DDDDDDDDD",
            "...DDD...",
            "...DAD...",
            "...DDD...",
        ]
        return sprite(rows, {"D": "#8a7fd6", "A": "#41e0ff", "C": "#3a2f80"}, 24, 24, 4)

    def exact(self, cx):
        return pix_text(24, 24, "07", 5, "#ffb000") + sprite(
            ["XXXXXXXXXXXX"], {"X": "#5b4bb5"}, 24, 38.5, 2.6
        )

    def wrap(self, cx):
        pac = [
            "..YYYYY..",
            ".YYYYYYY.",
            "YYYYYYY..",
            "YYYYYY...",
            "YYYYY....",
            "YYYYYY...",
            "YYYYYYY..",
            ".YYYYYYY.",
            "..YYYYY..",
        ]
        dots = sprite(["XX", "XX"], {"X": "#ffffff"}, 38, 24, 2.4)
        chev = ["X..", ".X.", "..X", ".X.", "X.."]
        edges = sprite(chev, {"X": "#41e0ff"}, 7, 12, 2) + sprite(
            chev, {"X": "#41e0ff"}, 41, 36, 2
        )
        return dots + sprite(pac, {"Y": "#ffd60a"}, 22, 24, 3.2) + edges

    def loop(self, cx):
        rows = []
        size = 11
        c = 5
        for j in range(size):
            row = ""
            for i in range(size):
                d = math.hypot(i - c, j - c)
                ang = math.degrees(math.atan2(j - c, i - c))
                gap = -80 < ang < -35
                row += "X" if (3.6 <= d <= 5.4 and not gap) else "."
            rows.append(row)
        head = sprite(["X..", "XX.", "XXX", "XX.", "X.."], {"X": "#ff4da6"}, 33, 10, 3)
        return sprite(rows, {"X": "#3dff8b"}, 24, 25, 3) + head

    def tele(self, cx):
        rows = [
            "DDDDDDDDDD",
            "DLLGGGGGGD",
            "DLLGGGGGGD",
            "DDDDDDDDDD",
            ".DLGGGGGD.",
            ".DLGGGGGD.",
            ".DLGGGGGD.",
            ".DLGGGGGD.",
            ".DDDDDDDD.",
        ]
        star = sprite([".X.", "XXX", ".X."], {"X": "#ffd60a"}, 24, 8, 2.6)
        return sprite(rows, {"G": "#2fd36b", "L": "#8dffb5", "D": "#138a3e"}, 24, 28, 3.4) + star

    def pent(self, cx):
        rows = [
            "....X....",
            "...XXX...",
            "..XXXXX..",
            ".XXXXXXX.",
            "XXXXXXXXX",
            "XXXXXXXXX",
            ".XXXXXXX.",
            ".XXXXXXX.",
        ]
        shine = sprite(["L", "L"], {"L": "#d8f8ff"}, 19.5, 20, 2.4)
        return sprite(rows, {"X": "#41e0ff"}, 24, 24, 4) + shine

    def tetra(self, cx):
        out = ""
        for bx, by in ((9, 13), (19, 13), (29, 13), (19, 23)):
            out += (
                rect(bx, by, 10, 10, fill="#b66cff")
                + rect(bx, by, 10, 2, fill="#e3c2ff")
                + rect(bx, by, 2, 10, fill="#e3c2ff")
                + rect(bx + 8, by, 2, 10, fill="#7a3fd0")
                + rect(bx, by + 8, 10, 2, fill="#7a3fd0")
            )
        return out

    def cube(self, cx):
        rows = [
            "WWWWWWWWWW",
            "WKKWWWWKKW",
            "WKKWWWWKKW",
            "WWWWWWWWWW",
            "WWWWKKWWWW",
            "WWWWKKWWWW",
            "WWWWWWWWWW",
            "WKKWWWWKKW",
            "WKKWWWWKKW",
            "WWWWWWWWWW",
        ]
        rows = [r[:-1] + "S" for r in rows[:-1]] + ["S" * 10]
        return sprite(rows, {"W": "#f4f1ff", "K": "#1b1445", "S": "#a69be0"}, 24, 24, 3.4)

    def ball(self, cx):
        rows = self.disc(11, 5.3, None)
        colours = {"M": "#ffffff", "L": "#ffffff", "D": "#8a7fd6"}
        trail = sprite(["X", "X"], {"X": "#41e0ff"}, 6, 24, 3) + sprite(
            ["X", "X"], {"X": "#41e0ff"}, 11, 24, 3
        )
        return trail + sprite(rows, colours, 29, 24, 3.2)
