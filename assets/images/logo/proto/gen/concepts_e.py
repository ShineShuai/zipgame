"""Icon concepts 36-44: chrome Y2K, industrial pictograms, memphis shapes, terminal glyphs,
woodblock, scroll painting, manuscript, art nouveau, pinball table parts."""

import math

from core import (
    circ,
    ell,
    group,
    line,
    n,
    path,
    poly,
    rect,
    register,
    star_pts,
    text,
)
from kit import blur, clip, linear, sparkle
from kit2 import (
    Concept,
    arc_d,
    arrow_poly,
    hatch,
    iso_cube,
    pent,
    sine,
    sphere,
    tetra,
)


@register
class Chrome(Concept):
    """Y2K chrome: sparkle, CD, cursor, LCD, rings, bubbles and glossy solids."""

    key = "36-chrome"
    title = "Y2K Chrome"
    font = "'Bricolage Grotesque','Trebuchet MS',sans-serif"
    pal = {"card": "#e9efff"}
    PK, BU, NV = "#ff5ac8", "#8fd3ff", "#1a1f4d"

    def draw(self, kind, cx):
        grad = linear(cx, [(0, "#fbfcff"), (1, "#b8c3e6")], 0, 0, 0, 1)
        return rect(3, 3, 42, 42, 12, fill=grad, stroke="#ffffff", stroke_width=1.2) + getattr(
            self, kind
        )(cx)

    def metal(self, cx, vertical=True):
        return linear(
            cx,
            [(0, "#ffffff"), (0.45, "#9aa6d6"), (0.55, "#6f7cb5"), (1, "#e8edff")],
            0,
            0,
            0 if vertical else 1,
            1 if vertical else 0,
        )

    def std(self, cx):
        big = poly(
            star_pts(24, 24, 17, 4, 4, -90),
            fill=self.metal(cx),
            stroke=self.NV,
            stroke_width=0.8,
            stroke_linejoin="round",
        )
        return (
            big
            + sparkle(37, 11, 5, self.PK)
            + sparkle(11, 36, 4, self.BU, stroke=self.NV, stroke_width=0.5)
        )

    def cut(self, cx):
        disc = circ(24, 24, 16, fill=self.metal(cx, False), stroke=self.NV, stroke_width=0.8)
        sheen = path("M24 8A16 16 0 0 1 40 24L24 24Z", fill=self.PK, opacity=0.35) + path(
            "M24 40A16 16 0 0 1 8 24L24 24Z", fill=self.BU, opacity=0.4
        )
        return disc + sheen + circ(24, 24, 5, fill="#e9efff", stroke=self.NV, stroke_width=0.8)

    def arr(self, cx):
        cur = poly(
            [(14, 8), (14, 37), (21, 30), (26, 41), (31, 39), (26, 28), (35, 28)],
            fill=self.metal(cx, False),
            stroke=self.NV,
            stroke_width=1.4,
            stroke_linejoin="round",
        )
        return cur

    def exact(self, cx):
        screen = rect(7, 12, 34, 24, 3, fill="#2a3b2a", stroke=self.NV, stroke_width=1)
        digit = text(24, 24.5, "07", 17, font_weight=800, font_family=self.font, fill="#9bff9b")
        return (
            screen
            + digit
            + line([(9, 14), (39, 14)], stroke="#ffffff", stroke_width=0.8, opacity=0.4)
        )

    def wrap(self, cx):
        back = ell(24, 24, 16, 8, fill="none", stroke=self.metal(cx, False), stroke_width=6)
        front = path("M8 24A16 8 0 0 0 40 24", fill="none", stroke=self.PK, stroke_width=3)
        return (
            back
            + front
            + ell(24, 24, 16, 8, fill="none", stroke="#fff", stroke_width=0.8, opacity=0.8)
        )

    def loop(self, cx):
        d = "M24 24C32 10 42 14 40 24C38 34 32 38 24 24C16 10 8 14 8 24C8 34 16 38 24 24Z"
        return (
            path(d, fill="none", stroke=self.NV, stroke_width=7.4, stroke_linejoin="round")
            + path(d, fill="none", stroke=self.PK, stroke_width=5)
            + path(
                d,
                fill="none",
                stroke="#fff",
                stroke_width=1,
                opacity=0.6,
                transform="translate(-0.6 -0.8)",
            )
        )

    def bub(self, cx, x, y, r):
        return sphere(cx, x, y, r, "#ffffff", "#5aa7e8", rim=self.NV)

    def tele(self, cx):
        return (
            self.bub(cx, 14, 15, 8)
            + self.bub(cx, 33, 32, 10)
            + sparkle(24, 24, 3.4, self.PK)
            + sparkle(20, 22, 2, "#fff", stroke=self.NV, stroke_width=0.4)
        )

    def pent(self, cx):
        return poly(
            star_pts(24, 25, 17, 8, 5),
            fill=self.metal(cx),
            stroke=self.NV,
            stroke_width=0.9,
            stroke_linejoin="round",
        ) + circ(24, 25, 4, fill=self.PK)

    def tetra(self, cx):
        return tetra(
            24, 24, 1.0, "#ffffff", "#aab5de", "#6f7cb5", stroke=self.NV, sw=0.9
        ) + sparkle(37, 10, 3.6, self.PK)

    def cube(self, cx):
        return iso_cube(
            24, 25, 15, "#ffffff", "#aab5de", "#6f7cb5", stroke=self.NV, sw=0.9
        ) + sparkle(38, 10, 3.6, self.PK)

    def ball(self, cx):
        ball = sphere(cx, 24, 24, 15, "#ffffff", "#5d6aa8", rim=self.NV)
        horizon = path("M10 26Q24 20 38 26Q24 33 10 26Z", fill="#8fd3ff", opacity=0.5)
        return ball + horizon + sparkle(36, 10, 3.6, self.PK)


@register
class Utility(Concept):
    """Industrial and packaging pictograms: conveyor, perforated plate, labels, recycle, cones."""

    key = "37-utility"
    title = "Utilitarian Issue"
    font = "'IBM Plex Mono',ui-monospace,monospace"
    pal = {"card": "#d6d4cf"}
    INK, OR, YL = "#141414", "#ff5a1f", "#f5d300"

    def draw(self, kind, cx):
        screws = "".join(
            circ(x, y, 0.8, fill="#8c8a84", stroke=self.INK, stroke_width=0.4)
            for x, y in ((5, 5), (43, 5), (5, 43), (43, 43))
        )
        return (
            rect(3, 3, 42, 42, fill="#e9e7e1", stroke=self.INK, stroke_width=1.6)
            + screws
            + getattr(self, kind)(cx)
        )

    def stripes(self, cx, c1, c2):
        ident = cx.new_id("h")
        cx.add(
            f'<pattern id="{ident}" width="4" height="4" patternUnits="userSpaceOnUse" '
            f'patternTransform="rotate(45)"><rect width="4" height="4" fill="{c1}"/>'
            f'<rect width="2" height="4" fill="{c2}"/></pattern>'
        )
        return f"url(#{ident})"

    def std(self, cx):
        belt = rect(7, 28, 34, 6, 3, fill=self.INK)
        rollers = "".join(circ(x, 31, 2.2, fill="#e9e7e1") for x in (11, 19, 27, 35))
        box = rect(15, 14, 14, 14, fill=self.OR, stroke=self.INK, stroke_width=1.4) + line(
            [(15, 21), (29, 21)], stroke=self.INK, stroke_width=1
        )
        return belt + rollers + box + arrow_poly(33, 20, 41, 20, w=2, head=4, hw=5, fill=self.INK)

    def cut(self, cx):
        plate = rect(8, 8, 32, 32, 1, fill="#c2c0b9", stroke=self.INK, stroke_width=1.4)
        hole = (
            poly(pent(24, 24, 9, -90), fill=self.INK)
            if False
            else circ(24, 24, 8.5, fill=self.INK)
        )
        ring = circ(
            24, 24, 10.5, fill="none", stroke=self.stripes(cx, self.YL, self.INK), stroke_width=3
        )
        return plate + hole + ring

    def arr(self, cx):
        box = rect(9, 9, 30, 30, fill="none", stroke=self.INK, stroke_width=1.6)
        return (
            box
            + arrow_poly(18, 36, 18, 14, w=4, head=8, hw=10, fill=self.INK)
            + arrow_poly(30, 36, 30, 14, w=4, head=8, hw=10, fill=self.INK)
        )

    def exact(self, cx):
        label = rect(7, 11, 34, 26, 1, fill="#fff", stroke=self.INK, stroke_width=1.4)
        bars = "".join(
            rect(10 + i * 2.6, 27, 1.2 if i % 3 else 2, 7, fill=self.INK) for i in range(11)
        )
        return (
            label
            + text(24, 19, "7 kg", 9, font_weight=700, font_family=self.font, fill=self.INK)
            + bars
        )

    def wrap(self, cx):
        crate = iso_cube(24, 25, 15, "#d9b88a", "#c19a66", "#a6824f", stroke=self.INK, sw=1.2)
        bands = line([(11, 18), (24, 25)], stroke=self.OR, stroke_width=3) + line(
            [(24, 25), (37, 18)], stroke=self.OR, stroke_width=3
        )
        wrap_ = line([(11, 27), (24, 34)], stroke="#fff", stroke_width=1.6, opacity=0.8) + line(
            [(24, 34), (37, 27)], stroke="#fff", stroke_width=1.6, opacity=0.8
        )
        return crate + bands + wrap_

    def loop(self, cx):
        out = ""
        for a in (0, 120, 240):
            out += group(
                poly(
                    [(24, 8), (33, 9), (30, 12), (36, 22), (31, 24), (26, 15), (22, 18)],
                    fill=self.OR,
                    stroke=self.INK,
                    stroke_width=0.8,
                    stroke_linejoin="round",
                ),
                transform=f"rotate({a} 24 26)",
            )
        return out

    def tele(self, cx):
        def hatch(x, y):
            return rect(
                x - 7,
                y - 5,
                14,
                10,
                1,
                fill=self.stripes(cx, self.YL, self.INK),
                stroke=self.INK,
                stroke_width=1.2,
            ) + circ(x, y, 2, fill=self.INK)

        pipe = line(
            [(14, 19), (14, 25), (34, 25), (34, 31)],
            stroke=self.INK,
            stroke_width=2.4,
            stroke_dasharray="4 2.4",
        )
        return hatch(14, 14) + hatch(34, 36) + pipe

    def pent(self, cx):
        head = poly(
            pent(24, 25, 15),
            fill="#b8b6af",
            stroke=self.INK,
            stroke_width=1.6,
            stroke_linejoin="round",
        )
        return (
            head
            + circ(24, 25, 6, fill="#e9e7e1", stroke=self.INK, stroke_width=1.4)
            + circ(24, 25, 2.2, fill=self.INK)
        )

    def tetra(self, cx):
        cone = poly(
            [(24, 8), (35, 36), (13, 36)],
            fill=self.OR,
            stroke=self.INK,
            stroke_width=1.4,
            stroke_linejoin="round",
        )
        band = poly([(20, 20), (28, 20), (30, 26), (18, 26)], fill="#fff")
        return rect(8, 34, 32, 6, 1, fill=self.INK) + cone + band

    def cube(self, cx):
        return iso_cube(
            24, 25, 15, "#e9e7e1", "#c2c0b9", "#8c8a84", stroke=self.INK, sw=1.4
        ) + poly(
            [(24, 24), (37, 17), (37, 22), (24, 29)], fill=self.stripes(cx, self.YL, self.INK)
        )

    def ball(self, cx):
        legs = line([(14, 34), (10, 42)], stroke=self.INK, stroke_width=2) + line(
            [(34, 34), (38, 42)], stroke=self.INK, stroke_width=2
        )
        return (
            legs
            + sphere(cx, 24, 22, 13, "#f0eee8", "#8c8a84", rim=self.INK)
            + rect(21, 6, 6, 4, 1, fill=self.OR, stroke=self.INK, stroke_width=1)
            + line([(11, 22), (37, 22)], stroke=self.INK, stroke_width=1)
        )


@register
class Memphis(Concept):
    """Memphis pop: squiggle, ring, striped triangle, dot dice, linked rings, striped solids."""

    key = "38-memphis"
    title = "Memphis Pop"
    font = "Rubik,'Trebuchet MS',sans-serif"
    pal = {"card": "#ffffff"}
    PK, TL, YL, VI, K = "#ff4fa3", "#18c4b6", "#ffd43b", "#7a5cff", "#000000"

    def draw(self, kind, cx):
        zig = line(
            [(8 + i * 4, 5.6 + (1.6 if i % 2 else 0)) for i in range(9)],
            stroke=self.TL,
            stroke_width=1.0,
            stroke_linejoin="round",
        )
        return (
            rect(3, 3, 42, 42, fill="#ffd9ec", stroke=self.K, stroke_width=1.6)
            + zig
            + getattr(self, kind)(cx)
        )

    def std(self, cx):
        return line(
            sine(7, 26, 41, 26, 7, 2.5),
            stroke=self.K,
            stroke_width=5.4,
            stroke_linecap="round",
            stroke_linejoin="round",
        ) + line(
            sine(7, 26, 41, 26, 7, 2.5),
            stroke=self.VI,
            stroke_width=3,
            stroke_linecap="round",
            stroke_linejoin="round",
        )

    def cut(self, cx):
        return (
            circ(24, 25, 14, fill=self.YL, stroke=self.K, stroke_width=1.6)
            + circ(24, 25, 5.4, fill="#ffd9ec", stroke=self.K, stroke_width=1.6)
            + "".join(
                circ(x, y, 1, fill=self.K) for x, y in ((15, 20), (33, 20), (17, 33), (31, 33))
            )
        )

    def arr(self, cx):
        st = hatch(cx, self.K, 3.4, 1.4, 45)
        tri = poly(
            [(8, 12), (40, 25), (8, 38)],
            fill=self.TL,
            stroke=self.K,
            stroke_width=1.6,
            stroke_linejoin="round",
        )
        return tri + poly([(8, 12), (40, 25), (8, 38)], fill=st, opacity=0.35)

    def exact(self, cx):
        pts = [(14, 16), (24, 12), (34, 16), (10, 27), (20, 24), (30, 27), (38, 27)]
        pts = [(14, 15), (24, 15), (34, 15), (10, 26), (19, 26), (28, 26), (37, 26)]
        cols = [self.PK, self.TL, self.YL, self.VI, self.PK, self.TL, self.YL]
        return "".join(
            circ(x, y, 3.8, fill=c, stroke=self.K, stroke_width=1.2)
            for (x, y), c in zip(pts, cols)
        ) + line([(12, 36), (36, 36)], stroke=self.K, stroke_width=1.6)

    def wrap(self, cx):
        area = clip(cx, circ(24, 25, 15))
        stripes = group(
            "".join(
                rect(5, 6 + i * 6, 38, 3, fill=self.PK if i % 2 else self.YL) for i in range(7)
            ),
            clip_path=area,
        )
        return (
            circ(24, 25, 15, fill="#fff")
            + stripes
            + circ(24, 25, 15, fill="none", stroke=self.K, stroke_width=1.6)
        )

    def loop(self, cx):
        a = circ(18, 25, 10, fill="none", stroke=self.PK, stroke_width=4)
        b = circ(30, 25, 10, fill="none", stroke=self.TL, stroke_width=4)
        return (
            a
            + b
            + circ(18, 25, 12, fill="none", stroke=self.K, stroke_width=0.0)
            + path(arc_d(24, 25, 10, -60, 60), fill="none", stroke=self.PK, stroke_width=4)
        )

    def tele(self, cx):
        a = circ(13, 14, 7, fill=self.TL, stroke=self.K, stroke_width=1.4)
        b = poly(
            [(35, 28), (42, 40), (28, 40)],
            fill=self.YL,
            stroke=self.K,
            stroke_width=1.4,
            stroke_linejoin="round",
        )
        return (
            line(sine(16, 19, 33, 30, 2.2, 2.5), stroke=self.K, stroke_width=1.4)
            + a
            + b
            + circ(13, 14, 2, fill=self.K)
        )

    def pent(self, cx):
        pts = pent(24, 25, 16)
        area = clip(cx, poly(pts))
        stripes = group(
            "".join(rect(5, 6 + i * 5, 38, 2.4, fill=self.VI) for i in range(8)), clip_path=area
        )
        return (
            poly(pts, fill="#fff")
            + stripes
            + poly(pts, fill="none", stroke=self.K, stroke_width=1.6, stroke_linejoin="round")
        )

    def tetra(self, cx):
        return tetra(24, 24, 1.0, self.YL, self.PK, self.TL, stroke=self.K, sw=1.5)

    def cube(self, cx):
        cube = iso_cube(24, 25, 15, "#fff", self.YL, self.VI, stroke=self.K, sw=1.5)
        polka = "".join(circ(x, y, 1.2, fill=self.K) for x, y in ((17, 26), (17, 33), (20, 30)))
        return cube + polka

    def ball(self, cx):
        area = clip(cx, circ(24, 25, 15))
        stripes = group(
            "".join(rect(5, 8 + i * 6, 38, 3, fill=self.PK) for i in range(6)), clip_path=area
        )
        return (
            circ(24, 25, 15, fill=self.YL)
            + stripes
            + circ(24, 25, 15, fill="none", stroke=self.K, stroke_width=1.6)
        )


@register
class Terminal(Concept):
    """Terminal: each type is a command-line glyph or ASCII drawing."""

    key = "39-terminal"
    title = "Terminal Phosphor"
    font = "'Share Tech Mono','Courier New',monospace"
    pal = {"card": "#04110a"}
    G, B = "#37ff8b", "#b6ffd0"

    def draw(self, kind, cx):
        ident = cx.new_id("s")
        cx.add(
            f'<pattern id="{ident}" width="48" height="1.7" patternUnits="userSpaceOnUse">'
            '<rect width="48" height="0.7" fill="#000" opacity="0.28"/></pattern>'
        )
        plate = rect(3, 3, 42, 42, 7, fill="#04170d", stroke="#1c8a4e", stroke_width=1.2)
        return plate + getattr(self, kind)(cx) + rect(3, 3, 42, 42, 7, fill=f"url(#{ident})")

    def tx(self, cx, x, y, s, size, colour=None):
        t = text(x, y, s, size, font_weight=700, font_family=self.font, fill=colour or self.G)
        return group(t, filter=blur(cx, 0.9), opacity=0.7) + t

    def lines(self, cx, rows, size=7.4, gap=7.2, colour=None):
        y0 = 24 - (len(rows) - 1) * gap / 2
        return "".join(self.tx(cx, 24, y0 + i * gap, r, size, colour) for i, r in enumerate(rows))

    def std(self, cx):
        return self.tx(cx, 22, 24, ">_", 15) + rect(34, 28, 5, 2, fill=self.B)

    def cut(self, cx):
        return self.tx(cx, 24, 24, "[  ]", 14)

    def arr(self, cx):
        return self.tx(cx, 24, 24, "->", 18, self.B)

    def exact(self, cx):
        return self.tx(cx, 24, 24, "0x07", 10.5)

    def wrap(self, cx):
        return self.tx(cx, 24, 24.5, "%", 26)

    def loop(self, cx):
        return self.lines(cx, ["for", "(;;)"], 9, 10)

    def tele(self, cx):
        return self.lines(cx, ["goto", "L7:"], 9, 10, self.B)

    def pent(self, cx):
        return self.lines(cx, ["/\\", "/  \\", "|  |", "'--'"], 8, 7)

    def tetra(self, cx):
        return self.lines(cx, ["/\\", "/__\\", "\\  /", "\\/"], 8, 6.6)

    def cube(self, cx):
        return self.lines(cx, ["+--+", "/ /|", "+--+ |", "|  |/", "+--+"], 7.4, 6.2)

    def ball(self, cx):
        return self.lines(cx, [".-'-.", "( @ )", "'-.-'"], 9, 8.5)


@register
class Ukiyo(Concept):
    """Woodblock print: great wave, fan, crane, hanko seal, torii, sakura, Fuji, masu box."""

    key = "40-ukiyo"
    title = "Ukiyo-e Wave"
    font = "'Shippori Mincho','Hiragino Mincho ProN',serif"
    pal = {"card": "#efe6d0"}
    IND, WAV, RED, GLD, WSH = "#1b3a5c", "#3f7ca6", "#c43a22", "#d4a24c", "#f6efdc"

    def draw(self, kind, cx):
        return (
            rect(3, 3, 42, 42, fill=self.WSH, stroke=self.IND, stroke_width=1.3)
            + rect(4.6, 4.6, 38.8, 38.8, fill="none", stroke=self.IND, stroke_width=0.4)
            + getattr(self, kind)(cx)
        )

    def std(self, cx):
        wave = path(
            "M5 38C8 24 16 12 28 10C38 9 42 18 36 22C32 18 28 18 28 24C28 30 34 34 43 34V43H5Z",
            fill=self.IND,
        )
        foam = "".join(
            circ(x, y, r, fill="#fff")
            for x, y, r in ((33, 12, 2), (38, 15, 1.4), (29, 11, 1.4), (36, 10, 1))
        )
        crest = path("M28 10C38 9 42 18 36 22", fill="none", stroke="#fff", stroke_width=1.4)
        return circ(14, 14, 5, fill=self.RED) + wave + crest + foam

    def cut(self, cx):
        ribs = ""
        for a in range(-60, 61, 20):
            ang = math.radians(a - 90)
            ribs += line(
                [(24, 38), (24 + 25 * math.cos(ang), 38 + 25 * math.sin(ang))],
                stroke=self.IND,
                stroke_width=1,
            )
        fan = path("M24 38L8 14A28 28 0 0 1 40 14Z", fill=self.RED, opacity=0.9)
        return (
            fan
            + ribs
            + circ(24, 38, 2.4, fill=self.IND)
            + path("M24 38L16 24A18 18 0 0 1 32 24Z", fill=self.GLD, opacity=0.8)
        )

    def arr(self, cx):
        body = path("M24 40L22 24L26 24Z", fill=self.IND)
        wings = path("M24 26C14 26 8 20 6 12C14 14 20 18 24 24Z", fill=self.IND) + path(
            "M24 26C34 26 40 20 42 12C34 14 28 18 24 24Z", fill=self.IND
        )
        head = path("M24 24C24 20 22 17 21 14", fill="none", stroke=self.IND, stroke_width=1.6)
        return wings + body + head + circ(24, 36, 0.0) + circ(21, 14, 1.4, fill=self.RED)

    def exact(self, cx):
        return (
            rect(9, 9, 30, 30, 2, fill=self.RED)
            + text(24, 24.5, "7", 24, font_weight=800, font_family=self.font, fill=self.WSH)
            + rect(12, 12, 24, 24, fill="none", stroke=self.WSH, stroke_width=0.8)
        )

    def wrap(self, cx):
        out = ""
        for row in range(3):
            for col in range(-1, 5):
                x = 6 + col * 12 + (6 if row % 2 else 0)
                y = 18 + row * 8
                for r in (6, 4, 2):
                    out += path(
                        f"M{x - r} {y}A{r} {r} 0 0 1 {x + r} {y}",
                        fill="none",
                        stroke=self.WAV,
                        stroke_width=0.8,
                    )
        area = clip(cx, rect(4.6, 4.6, 38.8, 38.8))
        return (
            group(out, clip_path=area)
            + rect(4.6, 4.6, 38.8, 9, fill=self.WSH)
            + circ(36, 12, 3.4, fill=self.RED)
        )

    def loop(self, cx):
        a = path("M24 8A16 16 0 0 1 24 40A8 8 0 0 1 24 24A8 8 0 0 0 24 8Z", fill=self.IND)
        b = path("M24 40A16 16 0 0 1 24 8A8 8 0 0 1 24 24A8 8 0 0 0 24 40Z", fill=self.RED)
        return b + a + circ(24, 16, 2, fill=self.WSH) + circ(24, 32, 2, fill=self.WSH)

    def tele(self, cx):
        beam = rect(6, 12, 36, 4, fill=self.RED) + poly(
            [(4, 12), (44, 12), (42, 9), (6, 9)], fill=self.RED
        )
        return (
            beam
            + rect(10, 17, 28, 2.4, fill=self.RED)
            + rect(14, 16, 3.6, 22, fill=self.RED)
            + rect(30.4, 16, 3.6, 22, fill=self.RED)
            + rect(12, 36, 8, 3, fill=self.IND)
            + rect(28, 36, 8, 3, fill=self.IND)
        )

    def pent(self, cx):
        petals = ""
        for a in range(0, 360, 72):
            petals += group(
                path(
                    "M0 0C-6 -4 -7 -12 -3 -15L0 -12L3 -15C7 -12 6 -4 0 0Z",
                    fill="#f4b8c4",
                    stroke=self.IND,
                    stroke_width=0.7,
                ),
                transform=f"translate(24 25) rotate({a})",
            )
        return petals + circ(24, 25, 2.2, fill=self.GLD)

    def tetra(self, cx):
        sun = circ(24, 17, 7, fill=self.RED)
        fuji = poly([(24, 10), (42, 40), (6, 40)], fill=self.IND)
        snow = poly([(24, 10), (30, 20), (26, 18), (24, 22), (21, 18), (18, 20)], fill="#fff")
        return sun + fuji + snow

    def cube(self, cx):
        return iso_cube(24, 25, 15, "#e7c68a", "#c9a15c", "#a8803f", stroke=self.IND, sw=1.1) + (
            circ(24, 17.5, 4, fill="none", stroke=self.IND, stroke_width=0.8)
        )

    def ball(self, cx):
        body = circ(24, 24, 15, fill=self.RED)
        area = clip(cx, circ(24, 24, 15))
        bands = group(
            path(
                "M8 14L40 34M8 24L40 44M8 4L40 24", stroke=self.WSH, stroke_width=2.4, fill="none"
            )
            + path(
                "M8 34L40 14M8 44L40 24M8 24L40 4", stroke=self.GLD, stroke_width=1.4, fill="none"
            ),
            clip_path=area,
        )
        return body + bands + circ(24, 24, 15, fill="none", stroke=self.IND, stroke_width=1)


@register
class Song(Concept):
    """Scroll painting: mountains, moon gate, bamboo, seal, hand scroll, bridge, scholar's rock."""

    key = "41-song"
    title = "Song Landscape"
    font = "'Noto Serif SC','Songti SC','STSong',serif"
    pal = {"card": "#ece4cc"}
    INK, CEL, RED, WOOD = "#262624", "#8fb09f", "#b8372a", "#7a5a3a"

    def draw(self, kind, cx):
        rods = (
            rect(2, 2.2, 44, 3, 1.5, fill=self.WOOD)
            + rect(2, 42.8, 44, 3, 1.5, fill=self.WOOD)
            + "".join(
                circ(x, y, 2, fill="#5b3f27")
                for x, y in ((2.6, 3.7), (45.4, 3.7), (2.6, 44.3), (45.4, 44.3))
            )
        )
        return rect(4.5, 4.5, 39, 39, fill="#f6f2e4") + rods + getattr(self, kind)(cx)

    def std(self, cx):
        far = path("M6 30L14 18L20 26L28 14L36 28L42 22V36H6Z", fill=self.CEL, opacity=0.55)
        near = path("M6 38L16 26L24 34L34 24L42 34V40H6Z", fill=self.INK, opacity=0.8)
        river = path("M10 40C20 34 28 38 38 33", fill="none", stroke="#f6f2e4", stroke_width=1.4)
        return far + near + river + circ(36, 12, 3, fill=self.RED)

    def cut(self, cx):
        wall = rect(8, 11, 32, 28, fill="#d9d2b8", stroke=self.INK, stroke_width=1)
        gate = circ(24, 25, 9, fill="#f6f2e4", stroke="#8a8372", stroke_width=2)
        view = path("M17 32L22 24L26 29L30 22L33 32Z", fill=self.CEL, opacity=0.8)
        return wall + gate + view + rect(8, 11, 32, 3, fill="#5b5a52")

    def arr(self, cx):
        out = ""
        for x in (17, 27):
            out += line(
                [(x, 40), (x, 10)], stroke=self.CEL, stroke_width=3.2, stroke_linecap="round"
            )
            for y in (18, 27, 35):
                out += line([(x - 2.2, y), (x + 2.2, y)], stroke=self.INK, stroke_width=0.9)
        leaves = poly([(17, 14), (8, 8), (14, 16)], fill=self.INK) + poly(
            [(27, 12), (37, 6), (31, 15)], fill=self.INK
        )
        return out + leaves + poly([(34, 40), (36, 28), (38, 40)], fill=self.CEL)

    def exact(self, cx):
        return (
            rect(9, 9, 30, 30, 1.5, fill=self.RED)
            + text(24, 24.5, "7", 22, font_weight=700, font_family=self.font, fill="#f6f2e4")
            + rect(11.5, 11.5, 25, 25, fill="none", stroke="#f6f2e4", stroke_width=0.8)
        )

    def wrap(self, cx):
        paper = rect(14, 12, 22, 24, fill="#fffdf6", stroke="#c9c2a8", stroke_width=0.8)
        left = rect(7, 10, 9, 28, 4, fill=self.WOOD) + circ(11.5, 24, 3, fill="#5b3f27")
        right = rect(32, 10, 9, 28, 4, fill=self.WOOD) + circ(36.5, 24, 3, fill="#5b3f27")
        peak = path("M16 34L22 24L26 29L30 20L34 34Z", fill=self.INK, opacity=0.75)
        return paper + peak + left + right

    def loop(self, cx):
        ring = circ(24, 24, 14, fill="none", stroke="#8fb09f", stroke_width=6)
        pat = "".join(
            circ(
                24 + 14 * math.cos(math.radians(a)),
                24 + 14 * math.sin(math.radians(a)),
                1,
                fill="#f6f2e4",
            )
            for a in range(0, 360, 30)
        )
        return ring + pat + circ(24, 24, 11, fill="none", stroke="#6e8d7d", stroke_width=0.6)

    def tele(self, cx):
        water = rect(5, 32, 38, 10, fill="#b7d1c4")
        arch = path("M8 34A16 12 0 0 1 40 34", fill="none", stroke=self.INK, stroke_width=3)
        deck = path("M8 34C16 22 32 22 40 34", fill="none", stroke=self.WOOD, stroke_width=2)
        return (
            water
            + arch
            + deck
            + line([(14, 28), (14, 34)], stroke=self.INK, stroke_width=1)
            + line([(34, 28), (34, 34)], stroke=self.INK, stroke_width=1)
        )

    def pent(self, cx):
        rock = path(
            "M12 36L10 24L18 12L28 10L36 20L34 36Z",
            fill="#8a8780",
            stroke=self.INK,
            stroke_width=1.3,
            stroke_linejoin="round",
        )
        holes = ell(21, 22, 2.6, 4, fill="#f6f2e4") + ell(29, 28, 2, 3, fill="#f6f2e4")
        return (
            rock
            + holes
            + path("M18 12L22 20M28 10L26 18", stroke="#b5b2aa", stroke_width=1.4, fill="none")
        )

    def tetra(self, cx):
        mist = ell(24, 34, 18, 4, fill="#f6f2e4", opacity=0.9)
        peak = poly([(24, 8), (38, 36), (10, 36)], fill=self.INK, opacity=0.85)
        return peak + poly([(24, 8), (38, 36), (24, 36)], fill=self.INK) + mist

    def cube(self, cx):
        stone = iso_cube(24, 28, 13, "#cfd8d2", "#a5b5ab", "#7d9086", stroke=self.INK, sw=1)
        knob = ell(24, 12, 3.6, 4, fill="#a5b5ab", stroke=self.INK, stroke_width=1)
        rect(19.5, 17, 9, 4, fill=self.RED, transform="skewY(0)")
        return knob + stone + rect(21, 17.4, 6, 4, fill=self.RED, opacity=0.9)

    def ball(self, cx):
        wisps = path("M6 36Q16 30 24 36T42 34", fill="none", stroke=self.CEL, stroke_width=1.6)
        return (
            wisps
            + sphere(cx, 24, 22, 13, "#ffffff", "#d9d2b8")
            + path("M10 40Q20 34 28 40T42 38", fill="none", stroke=self.CEL, stroke_width=1.4)
        )


@register
class Manuscript(Concept):
    """Illuminated manuscript: initial, keyhole, quill, Roman numeral, ribbon, knot, shield."""

    key = "42-manuscript"
    title = "Illuminated Manuscript"
    font = "'IM Fell English',Georgia,serif"
    pal = {"card": "#eddcb0"}
    GD, LP, VM, VD, INK = "#d4a72c", "#26479b", "#c8322a", "#2f6b4f", "#2b1a10"

    def draw(self, kind, cx):
        fl = "".join(
            circ(x, y, 1.4, fill=self.VM, stroke=self.GD, stroke_width=0.6)
            for x, y in ((3, 3), (45, 3), (3, 45), (45, 45))
        )
        return (
            rect(3, 3, 42, 42, fill="#f4e6c4", stroke=self.GD, stroke_width=1.6)
            + rect(4.8, 4.8, 38.4, 38.4, fill="none", stroke=self.GD, stroke_width=0.4)
            + fl
            + getattr(self, kind)(cx)
        )

    def std(self, cx):
        frame = rect(9, 9, 30, 30, fill=self.LP, stroke=self.GD, stroke_width=1.4)
        z = poly(
            [
                (14, 14),
                (34, 14),
                (34, 18),
                (21, 30),
                (34, 30),
                (34, 34),
                (14, 34),
                (14, 30),
                (27, 18),
                (14, 18),
            ],
            fill=self.GD,
        )
        vine = path("M10 38C14 34 16 40 20 36", fill="none", stroke=self.VD, stroke_width=1.2)
        return frame + z + vine + circ(36, 12, 1.6, fill=self.VM)

    def cut(self, cx):
        key = path("M24 10A9 9 0 0 0 20 27L17 40H31L28 27A9 9 0 0 0 24 10Z", fill=self.INK)
        return (
            circ(24, 24, 18, fill="#f4e6c4", stroke=self.GD, stroke_width=1.6)
            + key
            + circ(24, 18, 3, fill="#f4e6c4")
        )

    def arr(self, cx):
        vane = path(
            "M10 38C12 22 24 10 40 8C38 24 28 34 14 40Z",
            fill=self.LP,
            stroke=self.GD,
            stroke_width=1,
            stroke_linejoin="round",
        )
        quill = line([(8, 40), (38, 10)], stroke=self.INK, stroke_width=1.4)
        return (
            vane
            + quill
            + line([(16, 30), (26, 34)], stroke=self.GD, stroke_width=0.8)
            + line([(20, 24), (30, 28)], stroke=self.GD, stroke_width=0.8)
        )

    def exact(self, cx):
        return (
            circ(24, 24, 16, fill=self.VM, stroke=self.GD, stroke_width=2)
            + circ(24, 24, 12.5, fill="none", stroke=self.GD, stroke_width=0.6)
            + text(24, 24.5, "VII", 11, font_weight=700, font_family=self.font, fill="#f7ecd0")
        )

    def wrap(self, cx):
        book = rect(9, 11, 30, 26, 1, fill="#fffaf0", stroke=self.GD, stroke_width=1.2) + line(
            [(24, 11), (24, 37)], stroke=self.GD, stroke_width=0.8
        )
        text_lines = "".join(
            line([(12, y), (22, y)], stroke=self.INK, stroke_width=0.6) for y in (16, 20, 24, 28)
        ) + "".join(
            line([(26, y), (36, y)], stroke=self.INK, stroke_width=0.6) for y in (16, 20, 24, 28)
        )
        ribbon = path("M30 6V28L33 25L36 28V6Z", fill=self.VM) + path(
            "M30 28L26 40L30 38L33 42L36 28", fill=self.VM
        )
        return book + text_lines + ribbon

    def loop(self, cx):
        out = ""
        for a in (-90, 30, 150):
            x, y = 24 + 7 * math.cos(math.radians(a)), 25 + 7 * math.sin(math.radians(a))
            out += circ(x, y, 10, fill="none", stroke=self.GD, stroke_width=2.6)
        return out + circ(24, 25, 3, fill=self.VM)

    def tele(self, cx):
        door = path(
            "M12 40V20A12 12 0 0 1 36 20V40Z", fill=self.LP, stroke=self.GD, stroke_width=2
        )
        arch = path("M17 40V21A7 7 0 0 1 31 21V40Z", fill="#14275a")
        circ(34, 36, 3, fill="none", stroke=self.GD, stroke_width=1.6) + line(
            [(34, 33), (34, 22)], stroke=self.GD, stroke_width=1.6
        )
        return door + arch + circ(24, 30, 1.6, fill=self.GD) + rect(4, 40, 40, 2, fill=self.GD)

    def pent(self, cx):
        shield = path(
            "M10 10H38V24C38 33 31 39 24 42C17 39 10 33 10 24Z",
            fill=self.VM,
            stroke=self.GD,
            stroke_width=1.8,
            stroke_linejoin="round",
        )
        chev = line(
            [(14, 24), (24, 16), (34, 24)],
            stroke=self.GD,
            stroke_width=3.4,
            stroke_linejoin="miter",
        )
        return shield + chev + circ(24, 33, 2.4, fill=self.GD)

    def tetra(self, cx):
        return tetra(24, 24, 1.0, "#f0cf6e", self.GD, "#a07c12", stroke=self.INK, sw=0.9)

    def cube(self, cx):
        cube = iso_cube(24, 25, 15, "#3558b8", self.LP, "#1b3374", stroke=self.GD, sw=1.4)
        return (
            cube
            + line([(24, 25), (24, 40)], stroke=self.GD, stroke_width=2)
            + circ(24, 16, 1.6, fill=self.GD)
        )

    def ball(self, cx):
        orb = sphere(cx, 24, 28, 13, "#ffe18a", self.GD, rim=self.INK)
        cross = rect(22.6, 6, 2.8, 9, fill=self.GD, stroke=self.INK, stroke_width=0.6) + rect(
            20, 8.6, 8, 2.6, fill=self.GD, stroke=self.INK, stroke_width=0.6
        )
        band = path("M12 26Q24 32 36 26", fill="none", stroke=self.VM, stroke_width=1.6)
        return cross + orb + band


@register
class Nouveau(Concept):
    """Art nouveau: whiplash curve, peacock eye, dragonfly, clock, halo, lilies, cinquefoil."""

    key = "43-nouveau"
    title = "Art Nouveau"
    font = "Marcellus,'Trajan Pro',Georgia,serif"
    pal = {"card": "#ecedd6"}
    OL, SG, RS, GD = "#3f4f2f", "#a8b98a", "#d98e96", "#c9a24a"

    def draw(self, kind, cx):
        arch = path(
            "M3 15Q3 3 15 3H33Q45 3 45 15V45H3Z", fill="#f6f6e4", stroke=self.GD, stroke_width=1.3
        )
        return arch + getattr(self, kind)(cx)

    def vine(self, d, w=2.2, c=None):
        return path(d, fill="none", stroke=c or self.OL, stroke_width=w, stroke_linecap="round")

    def std(self, cx):
        d = "M10 40C10 22 38 30 38 14C38 8 30 8 30 13C30 17 35 17 35 13"
        return self.vine(d, 2.6) + circ(10, 40, 2, fill=self.RS) + circ(35, 13, 1.6, fill=self.GD)

    def cut(self, cx):
        out = ell(24, 24, 11, 16, fill=self.OL)
        return (
            out
            + ell(24, 24, 8, 13, fill="#5f8a8a")
            + ell(24, 24, 5, 9, fill=self.GD)
            + ell(24, 24, 2.6, 5, fill=self.RS)
        )

    def arr(self, cx):
        wings = "".join(
            ell(
                x,
                y,
                8,
                3,
                fill="#bfd9d3",
                stroke=self.OL,
                stroke_width=0.8,
                transform=f"rotate({a} {x} {y})",
            )
            for x, y, a in ((14, 19, -20), (34, 19, 20), (15, 27, 15), (33, 27, -15))
        )
        body = line([(24, 8), (24, 42)], stroke=self.OL, stroke_width=2.6, stroke_linecap="round")
        return wings + body + circ(24, 10, 2.6, fill=self.RS)

    def exact(self, cx):
        petals = "".join(
            ell(
                24,
                11,
                3,
                6,
                fill=self.SG,
                stroke=self.OL,
                stroke_width=0.7,
                transform=f"rotate({a} 24 25)",
            )
            for a in range(0, 360, 45)
        )
        return (
            petals
            + circ(24, 25, 9, fill="#f6f6e4", stroke=self.GD, stroke_width=1.2)
            + text(24, 25.4, "7", 11, font_weight=700, font_family=self.font, fill=self.OL)
        )

    def wrap(self, cx):
        ring = circ(24, 24, 11, fill="none", stroke=self.GD, stroke_width=3)
        v1 = self.vine("M5 30C14 36 18 20 24 24")
        v2 = self.vine("M24 24C30 28 34 12 43 18")
        return v1 + ring + v2 + circ(5, 30, 1.6, fill=self.RS) + circ(43, 18, 1.6, fill=self.RS)

    def loop(self, cx):
        out = circ(24, 24, 15, fill="none", stroke=self.GD, stroke_width=1.6)
        inn = circ(24, 24, 10.5, fill="none", stroke=self.OL, stroke_width=1.2)
        beads = "".join(
            circ(
                24 + 12.8 * math.cos(math.radians(a)),
                24 + 12.8 * math.sin(math.radians(a)),
                1.6,
                fill=self.RS,
            )
            for a in range(-90, 270, 45)
        )
        return out + inn + beads

    def tele(self, cx):
        def lily(x, y):
            return "".join(
                ell(
                    x,
                    y - 5,
                    2.6,
                    5,
                    fill=self.RS,
                    stroke=self.OL,
                    stroke_width=0.6,
                    transform=f"rotate({a} {x} {y})",
                )
                for a in (-35, 0, 35)
            )

        stem = self.vine("M12 40C14 28 30 34 36 22", 1.8)
        return (
            stem
            + lily(12, 28)
            + lily(36, 16)
            + circ(12, 28, 1.6, fill=self.GD)
            + circ(36, 16, 1.6, fill=self.GD)
        )

    def pent(self, cx):
        pts = pent(24, 25, 15)
        d = f"M{n(pts[0][0])} {n(pts[0][1])}"
        for i in range(5):
            a, b = pts[i], pts[(i + 1) % 5]
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            ctrl = (mid[0] + (mid[0] - 24) * 0.12, mid[1] + (mid[1] - 25) * 0.12)
            d += f"Q{n(ctrl[0])} {n(ctrl[1])} {n(b[0])} {n(b[1])}"
        return path(d + "Z", fill=self.SG, stroke=self.OL, stroke_width=1.4) + circ(
            24, 25, 3.6, fill=self.RS, stroke=self.GD, stroke_width=0.8
        )

    def tetra(self, cx):
        return tetra(24, 24, 1.0, "#e2ebc9", self.SG, "#7d8a62", stroke=self.OL, sw=1) + circ(
            24, 20, 1.6, fill=self.RS
        )

    def cube(self, cx):
        return iso_cube(
            24, 25, 15, "#e2ebc9", self.SG, "#7d8a62", stroke=self.OL, sw=1
        ) + self.vine("M14 22C18 28 22 24 24 30", 1.4, self.GD)

    def ball(self, cx):
        halo = circ(24, 24, 17, fill="none", stroke=self.GD, stroke_width=1.2)
        return halo + sphere(cx, 24, 24, 12.5, "#ffffff", "#d7d0c0", rim=self.GD)


@register
class Pinball(Concept):
    """Pinball playfield parts: lane, drain, arrow lights, score reel, orbit, saucers, flippers."""

    key = "44-pinball"
    title = "Pinball Marquee"
    font = "'Lilita One','Trebuchet MS',sans-serif"
    pal = {"card": "#0d0b14"}
    Y, R, C, V = "#ffd60a", "#ff3b30", "#2ee6ff", "#4a3fa8"

    def draw(self, kind, cx):
        bulbs = []
        for i in range(16):
            t = i / 16 * 4
            side, f = int(t), t - int(t)
            span = 36.0
            if side == 0:
                px, py = 6 + f * span, 4.7
            elif side == 1:
                px, py = 43.3, 6 + f * span
            elif side == 2:
                px, py = 42 - f * span, 43.3
            else:
                px, py = 4.7, 42 - f * span
            bulbs.append(circ(px, py, 1.0, fill=self.Y))
        return (
            rect(3, 3, 42, 42, 11, fill="#16204a", stroke=self.V, stroke_width=1.2)
            + group("".join(bulbs), filter=blur(cx, 0.9), opacity=0.8)
            + "".join(bulbs)
            + getattr(self, kind)(cx)
        )

    def glow(self, cx, markup, std=1.4):
        return group(markup, filter=blur(cx, std), opacity=0.85) + markup

    def steel(self, cx, x, y, r):
        return sphere(cx, x, y, r, "#ffffff", "#2b3050")

    def std(self, cx):
        rails = path(
            "M8 38C8 20 20 12 40 12", fill="none", stroke="#c0c8e8", stroke_width=2
        ) + path("M14 38C14 26 24 20 40 20", fill="none", stroke="#c0c8e8", stroke_width=2)
        return rails + self.steel(cx, 12, 32, 4)

    def cut(self, cx):
        return (
            circ(24, 24, 11, fill="#05040a", stroke=self.R, stroke_width=1.6)
            + circ(
                24, 24, 14, fill="none", stroke=self.R, stroke_width=0.8, stroke_dasharray="2 2"
            )
            + (poly([(21, 8), (27, 8), (24, 13)], fill=self.R))
        )

    def arr(self, cx):
        out = ""
        for i, (y, op) in enumerate(((12, 0.35), (21, 0.65), (30, 1.0))):
            chev = line(
                [(12, y + 7), (24, y), (36, y + 7)],
                stroke=self.C,
                stroke_width=3.4,
                stroke_linejoin="miter",
                opacity=op,
            )
            out += self.glow(cx, chev) if op == 1.0 else chev
        return out

    def exact(self, cx):
        screen = rect(7, 14, 34, 20, 2, fill="#05040a", stroke="#555", stroke_width=1)
        d = text(24, 24.5, "007", 14, font_family=self.font, fill="#ff9f0a")
        return screen + self.glow(cx, d, 1.2)

    def wrap(self, cx):
        a = path("M4 34C14 34 18 20 24 20", fill="none", stroke="#c0c8e8", stroke_width=2)
        b = path("M44 34C34 34 30 20 24 20", fill="none", stroke="#c0c8e8", stroke_width=2)
        return (
            a
            + b
            + poly([(4, 30), (8, 38), (2, 38)], fill=self.C, opacity=0.0)
            + self.steel(cx, 24, 14, 4)
            + line([(10, 12), (14, 12)], stroke=self.C, stroke_width=0.0)
        )

    def loop(self, cx):
        ring = circ(24, 24, 13, fill="none", stroke="#c0c8e8", stroke_width=2)
        lights = "".join(
            circ(
                24 + 13 * math.cos(math.radians(a)),
                24 + 13 * math.sin(math.radians(a)),
                1.7,
                fill=self.Y if i % 2 else self.R,
            )
            for i, a in enumerate(range(-90, 270, 45))
        )
        return ring + lights + self.steel(cx, 24, 24, 4.4)

    def tele(self, cx):
        def saucer(x, y):
            return circ(x, y, 7, fill="#05040a", stroke=self.C, stroke_width=1.6) + circ(
                x, y, 3, fill=self.C, opacity=0.6
            )

        wire = path(
            "M18 18C24 30 24 20 32 32",
            fill="none",
            stroke="#c0c8e8",
            stroke_width=1.4,
            stroke_dasharray="2 2",
        )
        return saucer(14, 14) + saucer(34, 34) + wire

    def two(self, cx):
        def flipper(x, y, ang):
            return group(
                rect(-2, -3, 17, 6, 3, fill=self.R, stroke="#fff", stroke_width=0.8)
                + circ(0, 0, 2.2, fill="#fff"),
                transform=f"translate({x} {y}) rotate({ang})",
            )

        return (
            flipper(7, 28, 28) + group(flipper(0, 0, 0), transform="matrix(-1 0 0 1 48 0)")
            if False
            else (
                flipper(7, 26, 24)
                + group(flipper(7, 26, 24), transform="translate(48 0) scale(-1 1)")
            )
        )

    def pent(self, cx):
        pts = pent(24, 24, 14)
        return (
            self.glow(cx, poly(pts, fill=self.R), 2)
            + poly(pts, fill="#2a1f8a", stroke="#fff", stroke_width=1.2)
            + circ(24, 24, 5.4, fill=self.R, stroke="#fff", stroke_width=0.8)
        )

    def tetra(self, cx):
        path("M8 38L24 10L40 38", fill="none", stroke="#c0c8e8", stroke_width=1.4)
        return (
            poly(
                [(24, 10), (40, 38), (8, 38)],
                fill="#2a3680",
                stroke=self.Y,
                stroke_width=1.4,
                stroke_linejoin="round",
            )
            + line([(14, 34), (34, 34)], stroke=self.R, stroke_width=1.6, stroke_dasharray="3 1.6")
            + line([(18, 26), (30, 26)], stroke=self.R, stroke_width=1.6, stroke_dasharray="3 1.6")
        )

    def cube(self, cx):
        return iso_cube(24, 25, 14, "#ff7a70", self.R, "#b02018", stroke="#fff", sw=1.2)

    def ball(self, cx):
        return self.steel(cx, 24, 24, 14) + ell(
            18, 15, 4, 2, fill="#fff", opacity=0.7, transform="rotate(-35 18 15)"
        )
