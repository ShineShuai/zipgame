"""Icon concepts 16-21: isometric objects, bauhaus compositions, newspaper marks, clay worms,
deco ornaments, map symbols."""

import math

from core import (
    circ,
    ell,
    line,
    path,
    poly,
    rect,
    register,
    text,
)
from kit import linear
from kit2 import (
    Concept,
    arrow_poly,
    dots,
    hatch,
    iso_cube,
    pent,
    plane,
    sine,
    slab,
    sphere,
    tetra,
)


@register
class Iso(Concept):
    """Isometric toy blocks: stairs, slabs, conveyors, pads, rails and solids."""

    key = "16-iso"
    title = "Isometric Solids"
    font = "Outfit,system-ui,sans-serif"
    pal = {"card": "#0b1220"}
    T1, T2, T3 = "#5eead4", "#14b8a6", "#0f766e"
    AMB = "#fbbf24"

    def draw(self, kind, cx):
        shadow = ell(24, 40, 17, 4, fill="#000", opacity=0.35)
        return shadow + getattr(self, kind)(cx)

    def std(self, cx):
        out = ""
        for i, (x, y) in enumerate(((13, 33), (23, 28), (33, 23))):
            out += slab(x, y, 9, 5 + 3 * i, self.T1, self.T2, self.T3)
        return out + circ(33, 17, 2.6, fill=self.AMB)

    def cut(self, cx):
        body = slab(24, 22, 17, 8, self.T1, self.T2, self.T3)
        hole = poly([(24, 17.5), (32, 22), (24, 26.5), (16, 22)], fill="#0b1220")
        wall = poly([(16, 22), (24, 26.5), (24, 29), (16, 24.5)], fill=self.T3)
        return body + hole + wall

    def arr(self, cx):
        body = slab(24, 24, 17, 6, self.T1, self.T2, self.T3)
        arrow = plane(arrow_poly(-8, 0, 8, 0, w=4, head=7, hw=9, fill=self.AMB), 24, 24, 0.9)
        return body + arrow

    def exact(self, cx):
        cube = iso_cube(24, 26, 15, self.T1, self.T2, self.T3)
        seven = plane(
            text(0, 0, "7", 13, font_weight=800, font_family=self.font, fill="#0b1220"),
            24,
            17.5,
            0.85,
        )
        return cube + seven

    def wrap(self, cx):
        body = slab(24, 24, 15, 5, self.T1, self.T2, self.T3)
        out = plane(arrow_poly(8, -2, 17, -2, w=3, head=5, hw=7, fill=self.AMB), 24, 24, 0.9)
        inn = plane(arrow_poly(-17, 2, -8, 2, w=3, head=5, hw=7, fill=self.AMB), 24, 24, 0.9)
        return body + out + inn

    def loop(self, cx):
        out = ell(24, 29, 17, 8.5, fill=self.T3) + ell(24, 25, 17, 8.5, fill=self.T2)
        inner = ell(24, 25, 9.5, 4.5, fill="#0b1220")
        ring = ell(24, 25, 17, 8.5, fill="none", stroke=self.T1, stroke_width=1)
        car = poly([(36, 20), (40, 23), (36, 26)], fill=self.AMB)
        return out + inner + ring + car

    def tele(self, cx):
        def pad(x, y, colour):
            beam = poly(
                [(x - 8, y), (x - 6, y - 14), (x + 6, y - 14), (x + 8, y)],
                fill=colour,
                opacity=0.28,
            )
            return (
                ell(x, y + 2, 9, 4.5, fill=self.T3)
                + ell(x, y, 9, 4.5, fill=self.T2)
                + ell(x, y, 6, 3, fill="none", stroke=colour, stroke_width=1.4)
                + beam
            )

        link = line(
            [(21, 31), (27, 25)],
            stroke=self.AMB,
            stroke_width=1.2,
            stroke_dasharray="0.1 2.2",
            stroke_linecap="round",
        )
        return pad(14, 33, self.AMB) + link + pad(34, 23, "#e2e8f0")

    def pent(self, cx):
        pts = [
            (px, py)
            for px, py in (
                (24 + 14 * math.cos(math.radians(a)), 24 + 7 * math.sin(math.radians(a)))
                for a in range(-90, 270, 72)
            )
        ]
        top_pts = [(px, py - 3) for px, py in pts]
        out = ""
        for i in range(5):
            a, b = top_pts[i], top_pts[(i + 1) % 5]
            if (a[1] + b[1]) / 2 > 24 - 3:
                out += poly(
                    [a, b, (b[0], b[1] + 7), (a[0], a[1] + 7)], fill=self.T2 if i % 2 else self.T3
                )
        return out + poly(top_pts, fill=self.T1)

    def tetra(self, cx):
        return tetra(24, 24, 1.0, self.T1, self.T2, self.T3)

    def cube(self, cx):
        return iso_cube(24, 24, 16, self.T1, self.T2, self.T3)

    def ball(self, cx):
        return sphere(cx, 24, 22, 14, "#a7f3e8", self.T3)


@register
class Bauhaus(Concept):
    """Bauhaus primitives: every type is a small composition of circle, square and triangle."""

    key = "17-bauhaus-bento"
    title = "Bauhaus Bento"
    font = "Jost,Futura,'Century Gothic',sans-serif"
    pal = {"card": "#fbf8f1"}
    COLOURS = {
        "std": "#c8391d",
        "cut": "#e8a920",
        "arr": "#1f7a7a",
        "exact": "#2a4d9b",
        "wrap": "#c8391d",
        "loop": "#e8a920",
        "tele": "#1f7a7a",
        "two": "#2a4d9b",
        "pent": "#c8391d",
        "tetra": "#e8a920",
        "cube": "#1f7a7a",
        "ball": "#2a4d9b",
    }
    CREAM, INK = "#fbf8f1", "#1f2a30"

    def accent(self, kind):
        return "#c8391d" if self.COLOURS[kind] == "#e8a920" else "#e8a920"

    def draw(self, kind, cx):
        plate = rect(3, 3, 42, 42, 9, fill=self.COLOURS[kind])
        return plate + getattr(self, kind)(self.accent(kind))

    def std(self, ac):
        return (
            line([(8, 24), (40, 24)], stroke=self.INK, stroke_width=2.4)
            + circ(11, 24, 6, fill=self.CREAM)
            + rect(18, 18, 12, 12, fill=ac)
            + poly([(31, 31), (37, 17), (43, 31)], fill=self.CREAM)
        )

    def cut(self, ac):
        return (
            circ(24, 24, 16, fill=self.CREAM)
            + rect(17, 17, 14, 14, fill=self.INK)
            + circ(24, 24, 3, fill=ac)
        )

    def arr(self, ac):
        return (
            rect(7, 21.5, 22, 5, fill=self.CREAM)
            + poly([(27, 12), (41, 24), (27, 36)], fill=self.CREAM)
            + circ(10, 24, 3.2, fill=ac)
        )

    def exact(self, ac):
        return (
            rect(9, 9, 30, 30, fill=self.CREAM)
            + text(24, 25, "7", 26, font_weight=700, font_family=self.font, fill=self.INK)
            + circ(35, 13, 3, fill=ac)
        )

    def wrap(self, ac):
        return (
            path("M3 11A13 13 0 0 1 3 37Z", fill=self.CREAM)
            + path("M45 11A13 13 0 0 0 45 37Z", fill=self.CREAM)
            + line([(10, 24), (38, 24)], stroke=self.INK, stroke_width=2.4)
            + circ(24, 24, 4, fill=ac)
        )

    def loop(self, ac):
        return (
            circ(24, 24, 16, fill=self.CREAM)
            + circ(24, 24, 10, fill=self.INK)
            + circ(24, 24, 5, fill=ac)
            + path("M24 8A16 16 0 0 1 40 24H24Z", fill=ac)
        )

    def tele(self, ac):
        return (
            line([(14, 14), (34, 34)], stroke=self.INK, stroke_width=2.4)
            + circ(14, 14, 8, fill=self.CREAM)
            + rect(26, 26, 16, 16, fill=ac)
            + poly([(21, 25), (27, 19), (27, 25)], fill=self.INK)
        )

    def pent(self, ac):
        return (
            rect(12, 23, 24, 15, fill=self.CREAM)
            + poly([(9, 24), (24, 9), (39, 24)], fill=ac)
            + circ(24, 31, 4, fill=self.INK)
        )

    def tetra(self, ac):
        return (
            poly([(24, 9), (8, 38), (24, 38)], fill=self.CREAM)
            + poly([(24, 9), (24, 38), (40, 38)], fill=self.INK)
            + circ(24, 31, 3, fill=ac)
        )

    def cube(self, ac):
        return iso_cube(24, 25, 16, self.CREAM, ac, self.INK)

    def ball(self, ac):
        return (
            circ(24, 24, 16, fill=self.CREAM)
            + path("M24 8A16 16 0 0 1 40 24H24Z", fill=ac)
            + path("M24 40A16 16 0 0 1 8 24H24Z", fill=self.INK)
        )


@register
class Editorial(Concept):
    """Newspaper marks: masthead page, coupon, manicule, footnote, text wrap, jump line."""

    key = "18-editorial"
    title = "Editorial Daily"
    font = "'Playfair Display',Georgia,serif"
    pal = {"card": "#fbfbfa"}
    INK, HI = "#111111", "#ffe14d"

    def draw(self, kind, cx):
        plate = rect(4, 4, 40, 40, fill="#fff", stroke=self.INK, stroke_width=1.6)
        return plate + getattr(self, kind)(cx)

    def rules(self, x, y, w, count, gap=3.2, widths=None):
        out = ""
        for i in range(count):
            ww = widths[i] if widths else w
            out += line(
                [(x, y + i * gap), (x + ww, y + i * gap)], stroke=self.INK, stroke_width=0.9
            )
        return out

    def std(self, cx):
        img = rect(
            9, 19, 13, 12, fill=dots(cx, self.INK, 2, 0.6), stroke=self.INK, stroke_width=0.8
        )
        return (
            rect(9, 9, 30, 6, fill=self.INK)
            + img
            + self.rules(25, 20, 14, 4)
            + self.rules(9, 34, 30, 3)
        )

    def cut(self, cx):
        box = rect(
            9, 13, 30, 22, fill="none", stroke=self.INK, stroke_width=1.3, stroke_dasharray="3 2"
        )
        scissors = (
            line([(14, 17), (26, 29)], stroke=self.INK, stroke_width=1.2)
            + line([(26, 17), (14, 29)], stroke=self.INK, stroke_width=1.2)
            + circ(12.5, 30.5, 2.2, fill="none", stroke=self.INK, stroke_width=1)
            + circ(27.5, 30.5, 2.2, fill="none", stroke=self.INK, stroke_width=1)
        )
        return (
            box
            + scissors
            + text(34, 24, "5%", 6.5, font_weight=700, font_family=self.font, fill=self.INK)
        )

    def arr(self, cx):
        cuff = rect(6, 19, 7, 14, fill=self.INK)
        hand = rect(13, 20, 13, 12, 2.5, fill="#fff", stroke=self.INK, stroke_width=1.5)
        finger = rect(25, 22, 15, 4.4, 2.2, fill="#fff", stroke=self.INK, stroke_width=1.5)
        thumb = path("M16 20Q18 15 22 17", fill="none", stroke=self.INK, stroke_width=1.5)
        folds = "".join(
            line([(27, y), (29 + k, y)], stroke=self.INK, stroke_width=1.2)
            for k, y in ((0, 29), (0, 31.6))
        )
        return cuff + hand + finger + thumb + folds

    def exact(self, cx):
        return (
            text(21, 26, "7", 28, font_weight=900, font_family=self.font, fill=self.INK)
            + text(35, 14, "12", 10, font_weight=700, font_family=self.font, fill=self.INK)
            + rect(9, 36, 30, 2, fill=self.HI)
        )

    def wrap(self, cx):
        out = circ(29, 25, 9, fill=dots(cx, self.INK, 2, 0.65), stroke=self.INK, stroke_width=1)
        rows = ""
        for i in range(8):
            y = 11 + i * 3.4
            dy = abs(y - 25)
            if dy < 11:
                half = math.sqrt(max(11**2 - dy**2, 0))
                rows += line([(9, y), (max(29 - half, 9.5), y)], stroke=self.INK, stroke_width=0.9)
                rows += line(
                    [(min(29 + half, 38.5), y), (39, y)], stroke=self.INK, stroke_width=0.9
                )
            else:
                rows += line([(9, y), (39, y)], stroke=self.INK, stroke_width=0.9)
        return out + rows

    def loop(self, cx):
        a = circ(17, 24, 8, fill="none", stroke=self.INK, stroke_width=3.2)
        b = circ(31, 24, 8, fill="none", stroke=self.INK, stroke_width=3.2)
        return a + b + rect(9, 36, 30, 2, fill=self.HI)

    def tele(self, cx):
        return (
            text(24, 15, "cont.", 9, font_style="italic", font_family=self.font, fill=self.INK)
            + text(24, 28, "p. 7", 11, font_weight=700, font_family=self.font, fill=self.INK)
            + arrow_poly(10, 36, 38, 36, w=1.6, head=6, hw=6, fill=self.INK)
        )

    def pent(self, cx):
        return poly(
            pent(24, 23, 14),
            fill=dots(cx, self.INK, 2, 0.6),
            stroke=self.INK,
            stroke_width=1.4,
            stroke_linejoin="round",
        ) + rect(9, 36, 30, 3, fill=self.INK)

    def tetra(self, cx):
        return tetra(
            24,
            24,
            1.0,
            "#ffffff",
            hatch(cx, self.INK, 2.2, 0.7, 60),
            dots(cx, self.INK, 1.8, 0.6),
            stroke=self.INK,
            sw=1.1,
        )

    def cube(self, cx):
        return iso_cube(
            24,
            25,
            15,
            "#ffffff",
            hatch(cx, self.INK, 2.2, 0.7, 45),
            dots(cx, self.INK, 1.8, 0.6),
            stroke=self.INK,
            sw=1.1,
        )

    def ball(self, cx):
        return (
            circ(24, 24, 15, fill="#fff")
            + circ(24, 24, 15, fill=hatch(cx, self.INK, 2.2, 0.7, -40))
            + circ(20, 20, 9, fill="#fff")
            + circ(24, 24, 15, fill="none", stroke=self.INK, stroke_width=1.3)
        )


@register
class Clay(Concept):
    """Claymation: every type is a soft clay worm or lump."""

    key = "19-clay"
    title = "Soft Clay"
    font = "Nunito,'Segoe UI',sans-serif"
    pal = {"card": "#e7ebf2"}
    IND, PEACH, MINT = "#6c63ff", "#ff9f7a", "#6fd6b2"

    def draw(self, kind, cx):
        return rect(4, 4, 40, 40, 12, fill="#eef1f7") + getattr(self, kind)(cx)

    def worm(self, pts, colour, w=8.5, eyes=True, shade=None):
        body = line(
            pts,
            stroke=shade or "#00000022",
            stroke_width=w + 1.2,
            stroke_linecap="round",
            stroke_linejoin="round",
            transform="translate(0.7 1.1)",
        )
        body += line(
            pts, stroke=colour, stroke_width=w, stroke_linecap="round", stroke_linejoin="round"
        )
        body += line(
            [(x - 1, y - 1.6) for x, y in pts],
            stroke="#ffffff",
            stroke_width=1.6,
            stroke_linecap="round",
            opacity=0.45,
        )
        return body

    def eyes(self, x, y):
        return (
            circ(x - 1.8, y - 1, 1.6, fill="#fff")
            + circ(x + 1.8, y - 1, 1.6, fill="#fff")
            + circ(x - 1.8, y - 0.8, 0.7, fill="#2b3547")
            + circ(x + 1.8, y - 0.8, 0.7, fill="#2b3547")
        )

    def std(self, cx):
        sine(8, 38, 40, 10, 0, 1, 2)
        s = [(9, 34), (16, 20), (24, 30), (32, 16), (38, 12)]
        return self.worm(s, self.IND) + self.eyes(38, 12)

    def cut(self, cx):
        body = circ(24.7, 25, 15, fill="#00000022") + sphere(
            cx, 24, 24, 15, "#ffc4ae", self.PEACH, spot=False
        )
        return (
            body
            + circ(24, 24, 5.5, fill="#eef1f7")
            + circ(24.6, 24.8, 5.5, fill="none", stroke="#00000018", stroke_width=1)
        )

    def arr(self, cx):
        a = arrow_poly(
            9,
            24,
            39,
            24,
            w=9,
            head=15,
            hw=20,
            fill=self.MINT,
            stroke=self.MINT,
            stroke_width=3,
            stroke_linejoin="round",
        )
        sh = arrow_poly(
            9,
            24,
            39,
            24,
            w=9,
            head=15,
            hw=20,
            fill="#00000022",
            stroke="#00000022",
            stroke_width=3,
            stroke_linejoin="round",
            transform="translate(0.7 1.2)",
        )
        return (
            sh
            + a
            + line(
                [(11, 21), (26, 21)],
                stroke="#fff",
                stroke_width=1.4,
                opacity=0.5,
                stroke_linecap="round",
            )
        )

    def exact(self, cx):
        pts = [(14, 13), (34, 13), (22, 36)]
        return self.worm(pts, self.PEACH, 7.5)

    def wrap(self, cx):
        block = rect(15, 12, 18, 24, 6, fill="#d5dbe8") + rect(
            15, 12, 18, 24, 6, fill="none", stroke="#00000014"
        )
        left = self.worm([(5, 30), (13, 30)], self.IND, 7)
        right = self.worm([(35, 18), (43, 18)], self.IND, 7)
        return left + block + right + self.eyes(43, 18)

    def loop(self, cx):
        ring = circ(24.7, 25, 13, fill="none", stroke="#00000022", stroke_width=9.7) + circ(
            24, 24, 13, fill="none", stroke=self.MINT, stroke_width=8.5
        )
        ring += circ(
            21.5,
            20.5,
            13,
            fill="none",
            stroke="#fff",
            stroke_width=1.4,
            opacity=0.4,
            stroke_dasharray="20 80",
        )
        return ring + self.eyes(37, 24)

    def tele(self, cx):
        def hole(x, y):
            return ell(x, y + 1, 9, 4.6, fill="#c7cede") + ell(x, y, 8, 4, fill="#2b3547")

        a = self.worm([(9, 28), (9, 22)], self.IND, 7)
        return (
            hole(14, 32)
            + hole(34, 17)
            + a
            + self.worm([(34, 15), (34, 7)], self.IND, 7)
            + self.eyes(34, 7)
        )

    def pent(self, cx):
        pts = pent(24, 25, 15)
        body = poly(
            pts, fill=self.PEACH, stroke=self.PEACH, stroke_width=7, stroke_linejoin="round"
        )
        sh = poly(
            pts,
            fill="#00000022",
            stroke="#00000022",
            stroke_width=7,
            stroke_linejoin="round",
            transform="translate(0.7 1.1)",
        )
        dimples = "".join(
            circ(x, y, 1.1, fill="#e07c58") for x, y in ((19, 23), (28, 25), (23, 31))
        )
        return (
            sh
            + body
            + dimples
            + ell(18, 16, 4, 2, fill="#fff", opacity=0.5, transform="rotate(-30 18 16)")
        )

    def tetra(self, cx):
        return poly([(10, 38), (38, 38), (24, 40)], fill="#00000018") + tetra(
            24, 24, 1.0, "#c9c5ff", self.IND, "#4f47d6", stroke="#6c63ff", sw=3
        )

    def cube(self, cx):
        return iso_cube(24, 25, 14, "#8fe8cc", self.MINT, "#4fb796", stroke="#6fd6b2", sw=3)

    def ball(self, cx):
        return circ(25, 26, 15, fill="#00000022") + sphere(cx, 24, 24, 15, "#ffd2c0", self.PEACH)


@register
class Deco(Concept):
    """Art deco ornaments in gold: ziggurat, octagon, chevrons, sunburst, fan, elevator doors."""

    key = "20-deco"
    title = "Art Deco Gold"
    font = "'Josefin Sans','Century Gothic',sans-serif"
    pal = {"card": "#0c1613"}
    G, G2, N = "#d9b45a", "#f2d38a", "#0c1613"

    def draw(self, kind, cx):
        s = 4.5
        d = (
            f"M{3 + s} 3H{45 - s}V{3 + s / 2}H{45 - s / 2}V{3 + s}H45V{45 - s}H{45 - s / 2}"
            f"V{45 - s / 2}H{45 - s}V45H{3 + s}V{45 - s / 2}H{3 + s / 2}V{45 - s}H3V{3 + s}"
            f"H{3 + s / 2}V{3 + s / 2}H{3 + s}Z"
        )
        return path(d, fill=self.N, stroke=self.G, stroke_width=1.2) + getattr(self, kind)(cx)

    def std(self, cx):
        steps = "M8 38V32H13V26H18V20H23V14H25V20H30V26H35V32H40V38Z"
        return (
            path(steps, fill=self.G)
            + path("M24 14V38", stroke=self.N, stroke_width=0.8)
            + path("M13 32H35M18 26H30", stroke=self.N, stroke_width=0.8)
        )

    def cut(self, cx):
        o = [(17, 8), (31, 8), (40, 17), (40, 31), (31, 40), (17, 40), (8, 31), (8, 17)]
        return poly(o, fill="none", stroke=self.G, stroke_width=2) + poly(
            [(24, 14), (34, 24), (24, 34), (14, 24)],
            fill="#050b09",
            stroke=self.G2,
            stroke_width=1,
        )

    def arr(self, cx):
        out = ""
        for k in range(3):
            y = 14 + k * 8
            out += line(
                [(10, y + 8), (24, y), (38, y + 8)],
                stroke=self.G,
                stroke_width=2.6,
                stroke_linejoin="miter",
            )
        return out

    def exact(self, cx):
        rays = "".join(
            f"M{24 + 9 * math.cos(math.radians(a)):.1f} {24 + 9 * math.sin(math.radians(a)):.1f}"
            f"L{24 + 16 * math.cos(math.radians(a)):.1f} {24 + 16 * math.sin(math.radians(a)):.1f}"
            for a in range(0, 360, 22)
        )
        return (
            path(rays, stroke=self.G, stroke_width=1.2, fill="none")
            + circ(24, 24, 9, fill=self.N, stroke=self.G, stroke_width=1.6)
            + text(24, 24.5, "VII", 7.5, font_weight=700, font_family=self.font, fill=self.G2)
        )

    def wrap(self, cx):
        band = path(
            "M8 24H12V18H18V30H24V18H30V30H36V24H40",
            fill="none",
            stroke=self.G,
            stroke_width=2.2,
            stroke_linejoin="miter",
        )
        left = poly([(4, 19), (9, 24), (4, 29)], fill=self.G2)
        right = poly([(39, 19), (44, 24), (39, 29)], fill=self.G2)
        return band + left + right

    def loop(self, cx):
        out = ""
        for r, w in ((15, 2.4), (10.5, 1.4), (6, 2.4)):
            out += circ(24, 24, r, fill="none", stroke=self.G, stroke_width=w)
        return (
            out
            + circ(24, 24, 2, fill=self.G2)
            + line([(24, 7), (24, 11)], stroke=self.G, stroke_width=2)
        )

    def tele(self, cx):
        frame = path(
            "M10 40V18A14 14 0 0 1 38 18V40Z", fill="none", stroke=self.G, stroke_width=1.8
        )
        doors = rect(14, 20, 9.6, 20, fill=self.G) + rect(24.4, 20, 9.6, 20, fill=self.G)
        dial = path("M17 17A8 8 0 0 1 31 17", fill="none", stroke=self.G2, stroke_width=1) + line(
            [(24, 17), (28, 13)], stroke=self.G2, stroke_width=1
        )
        return frame + doors + dial

    def pent(self, cx):
        pts = pent(24, 25, 15)
        diag = "".join(
            f"M{pts[i][0]:.1f} {pts[i][1]:.1f}L{pts[(i + 2) % 5][0]:.1f} {pts[(i + 2) % 5][1]:.1f}"
            for i in range(5)
        )
        return poly(
            pts, fill="#14332b", stroke=self.G, stroke_width=2, stroke_linejoin="miter"
        ) + path(diag, stroke=self.G2, stroke_width=0.8, fill="none")

    def tetra(self, cx):
        rays = "".join(
            line(
                [
                    (24, 6),
                    (24 + 16 * math.sin(math.radians(a)), 6 + 16 * math.cos(math.radians(a))),
                ],
                stroke=self.G,
                stroke_width=0.8,
            )
            for a in (-70, -45, -20, 20, 45, 70)
        )
        return rays + tetra(24, 27, 0.9, "#1f4a3d", "#14332b", "#0a1a15", stroke=self.G, sw=1.3)

    def cube(self, cx):
        return iso_cube(24, 25, 15, "#1f4a3d", "#14332b", "#0a1a15", stroke=self.G, sw=1.4) + line(
            [(24, 25), (24, 40)], stroke=self.G2, stroke_width=0.6
        )

    def ball(self, cx):
        body = circ(24, 22, 14, fill="#14332b", stroke=self.G, stroke_width=1.6)
        mer = ell(24, 22, 6, 14, fill="none", stroke=self.G, stroke_width=0.8) + ell(
            24, 22, 14, 5, fill="none", stroke=self.G, stroke_width=0.8
        )
        stand = path("M16 40H32M24 36V40", stroke=self.G, stroke_width=2, fill="none")
        return body + mer + stand


@register
class RouteGlass(Concept):
    """Map app: pins, routes, one-way signs, roundabouts, globes on a glass plate."""

    key = "21-route"
    title = "Route Glass"
    font = "Manrope,'Segoe UI',sans-serif"
    pal = {"card": "#f4f7ff"}
    AMB, W = "#ffb020", "#ffffff"

    def draw(self, kind, cx):
        grad = linear(cx, [(0, "#6b93ff"), (1, "#2342c4")], 0, 0, 1, 1)
        plate = rect(3, 3, 42, 42, 12, fill=grad) + ell(24, 11, 17, 7, fill="#fff", opacity=0.2)
        return plate + getattr(self, kind)(cx)

    def pin(self, x, y, colour, label=None, r=5.2):
        body = path(
            f"M{x} {y}C{x - r * 1.6} {y - r * 1.5} {x - r} {y - r * 3.2} {x} {y - r * 3.2}"
            f"C{x + r} {y - r * 3.2} {x + r * 1.6} {y - r * 1.5} {x} {y}Z",
            fill=colour,
        )
        out = body + circ(x, y - r * 1.9, r * 0.5, fill="#fff")
        if label:
            out = body + text(
                x,
                y - r * 1.9,
                label,
                r * 1.1,
                font_weight=800,
                font_family=self.font,
                fill="#2342c4",
            )
        return out

    def rt(self, pts, colour=None, w=2.6, **kw):
        return path(
            pts,
            fill="none",
            stroke=colour or self.AMB,
            stroke_width=w,
            stroke_linecap="round",
            stroke_linejoin="round",
            **kw,
        )

    def std(self, cx):
        r = self.rt("M10 36C10 26 22 30 24 22S36 20 33 12")
        return r + circ(10, 36, 3, fill=self.W) + self.pin(34, 17, self.AMB)

    def cut(self, cx):
        r = self.rt("M8 36H22")
        detour = self.rt("M22 36C26 36 26 28 30 28H40", w=2, stroke_dasharray="3 3")
        stop = circ(24, 20, 7.5, fill="#ef4444", stroke="#fff", stroke_width=1.6) + rect(
            19.5, 18.8, 9, 2.6, fill="#fff"
        )
        return r + detour + stop

    def arr(self, cx):
        sign = rect(7, 14, 34, 20, 4, fill="#fff")
        return sign + arrow_poly(12, 24, 36, 24, w=5, head=10, hw=13, fill="#2342c4")

    def exact(self, cx):
        base = self.rt("M10 36L24 28L38 36", w=1.6, stroke_dasharray="2 2.4", colour="#ffffff")
        return (
            base
            + self.pin(10, 37, "#ffffff", "1", 4.4)
            + self.pin(24, 29, "#ffffff", "2", 4.4)
            + self.pin(38, 37, self.AMB, "7", 4.4)
        )

    def wrap(self, cx):
        globe = circ(
            24, 24, 15, fill="#ffffff", fill_opacity=0.22, stroke="#fff", stroke_width=1.2
        )
        orbit = ell(
            24,
            24,
            20,
            6,
            fill="none",
            stroke=self.AMB,
            stroke_width=2.4,
            transform="rotate(-24 24 24)",
        )
        mer = ell(24, 24, 6, 15, fill="none", stroke="#fff", stroke_width=0.8, opacity=0.7)
        return globe + mer + orbit + poly([(38, 18), (44, 21), (37, 24)], fill=self.AMB)

    def loop(self, cx):
        ring = circ(24, 24, 11, fill="none", stroke="#fff", stroke_width=5)
        spokes = "".join(
            line(
                [
                    (24 + 11 * math.cos(math.radians(a)), 24 + 11 * math.sin(math.radians(a))),
                    (24 + 19 * math.cos(math.radians(a)), 24 + 19 * math.sin(math.radians(a))),
                ],
                stroke="#fff",
                stroke_width=4,
            )
            for a in (90, 210, 330)
        )
        return (
            spokes
            + ring
            + circ(
                24, 24, 11, fill="none", stroke=self.AMB, stroke_width=1.4, stroke_dasharray="3 3"
            )
            + circ(35, 24, 2.6, fill=self.AMB)
        )

    def tele(self, cx):
        arc = self.rt("M12 34Q24 8 36 14", w=1.8, stroke_dasharray="0.1 4")
        return arc + self.pin(12, 36, "#ffffff") + self.pin(36, 20, self.AMB)

    def pent(self, cx):
        pts = pent(24, 25, 15)
        return poly(
            pts,
            fill=self.AMB,
            fill_opacity=0.28,
            stroke=self.AMB,
            stroke_width=2,
            stroke_dasharray="4 2",
            stroke_linejoin="round",
        ) + self.pin(24, 29, "#ffffff")

    def tetra(self, cx):
        return tetra(24, 24, 1.0, "#ffffff", "#c9d6ff", "#9fb4f5", stroke="#ffffff", sw=0.9)

    def cube(self, cx):
        wins = ""
        return (
            iso_cube(24, 25, 15, "#ffffff", "#c9d6ff", "#9fb4f5", stroke="#fff", sw=0.9)
            + wins
            + (circ(24, 22, 1.4, fill=self.AMB))
        )

    def ball(self, cx):
        return sphere(cx, 24, 25, 15, "#dbe6ff", "#4a6fe0") + self.pin(30, 22, self.AMB, None, 4)
