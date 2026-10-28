"""Icon concepts 29-35: space, garden, paper folding, building bricks, atomic age, stained glass,
sewing kit."""

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
from kit import blur, clip, sparkle
from kit2 import (
    Concept,
    arrow_poly,
    iso_cube,
    pent,
    sphere,
    tetra,
)


@register
class Cosmic(Concept):
    """Deep space objects: comet, eclipse, rocket, planet systems, wormhole, satellite."""

    key = "29-cosmic"
    title = "Cosmic Orbit"
    font = "Sora,'Segoe UI',sans-serif"
    pal = {"card": "#070b1f"}
    SUN, ICE, MARS, NEB = "#ffd166", "#7fd8ff", "#ff7b54", "#8a6bff"

    def draw(self, kind, cx):
        stars = "".join(
            circ(x, y, r, fill="#fff", opacity=o)
            for x, y, r, o in (
                (8, 9, 0.7, 0.9),
                (39, 7, 0.5, 0.7),
                (41, 40, 0.7, 0.9),
                (7, 39, 0.5, 0.7),
                (24, 5.5, 0.4, 0.6),
                (5.5, 24, 0.4, 0.6),
            )
        )
        plate = rect(3, 3, 42, 42, 12, fill="#0a0f2e", stroke="#2a2f6e", stroke_width=0.8)
        return plate + stars + getattr(self, kind)(cx)

    def glow(self, cx, markup, std=1.6, op=0.7):
        return group(markup, filter=blur(cx, std), opacity=op) + markup

    def std(self, cx):
        tail = poly([(30, 18), (7, 40), (11, 41), (33, 21)], fill=self.ICE, opacity=0.55)
        tail2 = poly([(30, 18), (9, 34), (12, 35), (33, 21)], fill=self.NEB, opacity=0.5)
        head = circ(33, 17, 6, fill=self.SUN)
        return tail + tail2 + self.glow(cx, head) + head

    def cut(self, cx):
        sun = circ(24, 24, 13, fill=self.SUN)
        corona = circ(24, 24, 16, fill="none", stroke=self.SUN, stroke_width=1.2, opacity=0.5)
        return (
            self.glow(cx, sun, 3, 0.7)
            + corona
            + circ(24, 24, 13, fill=self.SUN)
            + circ(30, 22, 12, fill="#070b1f")
        )

    def arr(self, cx):
        body = ell(24, 24, 5.5, 13, fill="#e8eeff", transform="rotate(45 24 24)")
        circ(30.5, 17.5, 4.2, fill=self.MARS)
        win = circ(25, 23, 2.4, fill=self.ICE)
        fins = poly([(15, 27), (11, 36), (20, 33)], fill=self.MARS) + poly(
            [(21, 33), (12, 37), (17, 28)], fill=self.MARS, opacity=0.0
        )
        flame = poly([(15, 33), (9, 39), (17, 35)], fill=self.SUN)
        return flame + fins + body + win

    def exact(self, cx):
        orbit = ell(24, 24, 16, 7, fill="none", stroke=self.NEB, stroke_width=0.7, opacity=0.8)
        moons = "".join(
            circ(
                24 + 16 * math.cos(math.radians(a)),
                24 + 7 * math.sin(math.radians(a)),
                1.7,
                fill=self.ICE,
            )
            for a in range(0, 360, 51)
        )
        return orbit + moons + sphere(cx, 24, 24, 7, "#ffb08a", self.MARS)

    def wrap(self, cx):
        back = path(
            "M6 24A18 6 0 0 1 42 24",
            fill="none",
            stroke=self.ICE,
            stroke_width=2,
            transform="rotate(-20 24 24)",
            opacity=0.6,
        )
        planet = sphere(cx, 24, 24, 10, "#ffe2a8", "#c27a2c")
        front = path(
            "M6 24A18 6 0 0 0 42 24",
            fill="none",
            stroke=self.ICE,
            stroke_width=2.2,
            transform="rotate(-20 24 24)",
        )
        return back + planet + front

    def loop(self, cx):
        orbit = circ(
            24, 24, 15, fill="none", stroke=self.NEB, stroke_width=1, stroke_dasharray="3 2"
        )
        star = circ(24, 24, 5, fill=self.SUN)
        return (
            orbit
            + self.glow(cx, star)
            + star
            + circ(39, 24, 3.2, fill=self.ICE)
            + poly([(39, 12), (44, 17), (36, 16)], fill=self.NEB)
        )

    def tele(self, cx):
        out = ""
        for i, r in enumerate((16, 12, 8, 4.5)):
            out += ell(
                24,
                14 + i * 7,
                r,
                r * 0.35,
                fill="none",
                stroke=self.NEB if i % 2 == 0 else self.ICE,
                stroke_width=1.6,
            )
        return out + circ(24, 38, 2.2, fill="#000", stroke=self.MARS, stroke_width=1)

    def pent(self, cx):
        pts = pent(24, 25, 15)
        body = poly(pts, fill="#4a5190", stroke=self.ICE, stroke_width=1, stroke_linejoin="round")
        craters = (
            circ(21, 22, 2.4, fill="#2f3570")
            + circ(29, 28, 1.8, fill="#2f3570")
            + circ(24, 31, 1.4, fill="#2f3570")
        )
        return body + craters

    def tetra(self, cx):
        return self.glow(cx, circ(24, 24, 14, fill=self.NEB), 4, 0.3) + tetra(
            24, 24, 0.95, "#c4b5fd", self.NEB, "#4c3aa8", stroke=self.ICE, sw=0.8
        )

    def cube(self, cx):
        wing = lambda x: rect(x, 21, 10, 8, fill="#4a5190", stroke=self.ICE, stroke_width=0.6)
        return (
            wing(4)
            + wing(34)
            + line([(14, 25), (18, 25)], stroke=self.ICE, stroke_width=1)
            + line([(30, 25), (34, 25)], stroke=self.ICE, stroke_width=1)
            + iso_cube(24, 25, 11, "#e8eeff", "#b4bde8", "#8793c9")
        )

    def ball(self, cx):
        return (
            sphere(cx, 24, 24, 14, "#ffb08a", "#7a2a3a")
            + circ(19, 27, 2.6, fill="#7a2a3a", opacity=0.5)
            + circ(29, 20, 1.8, fill="#7a2a3a", opacity=0.5)
        )


@register
class Botanical(Concept):
    """Garden: sprout, monstera, arrowhead leaf, daisy, twining vine, wreath, blossom, pine."""

    key = "30-botanical"
    title = "Botanical Garden"
    font = "Quicksand,'Trebuchet MS',sans-serif"
    pal = {"card": "#f1f7f2"}
    G, GD, PK, SUN = "#2f6b4f", "#143d2e", "#ff9bb3", "#f7c948"

    def draw(self, kind, cx):
        plate = path(
            "M20 3H44V28A17 17 0 0 1 27 45H3V20A17 17 0 0 1 20 3Z",
            fill="#ffffff",
            stroke="#cfe3d6",
            stroke_width=1,
        )
        return plate + getattr(self, kind)(cx)

    def leaf(self, x, y, ang, length=12, width=5, fill=None):
        fill = fill or self.G
        return group(
            path(f"M0 0Q{length * 0.5} {-width} {length} 0Q{length * 0.5} {width} 0 0Z", fill=fill)
            + line([(1, 0), (length * 0.85, 0)], stroke="#cfe8d6", stroke_width=0.7),
            transform=f"translate({n(x)} {n(y)}) rotate({ang})",
        )

    def std(self, cx):
        stem = path(
            "M24 41C24 30 22 24 26 14",
            fill="none",
            stroke=self.GD,
            stroke_width=2,
            stroke_linecap="round",
        )
        return (
            stem
            + self.leaf(24, 30, -150, 13, 5)
            + self.leaf(25, 22, -25, 13, 5)
            + self.leaf(26, 14, -75, 8, 3.4, "#4f9a5f")
        )

    def cut(self, cx):
        body = path(
            "M24 40C8 32 6 16 16 10C20 8 22 12 24 14C26 12 28 8 32 10C42 16 40 32 24 40Z",
            fill=self.G,
        )
        holes = "".join(
            ell(x, y, 2.2, 3.4, fill="#fff", transform=f"rotate({a} {x} {y})")
            for x, y, a in ((16, 20, 30), (31, 20, -30), (24, 28, 0))
        )
        slit = line([(24, 14), (24, 38)], stroke="#cfe8d6", stroke_width=0.9)
        return body + holes + slit

    def arr(self, cx):
        body = path("M24 6L36 28L26 25L26 40H22V25L12 28Z", fill=self.G)
        return body + line([(24, 10), (24, 38)], stroke="#cfe8d6", stroke_width=0.9)

    def exact(self, cx):
        petals = "".join(
            ell(
                24,
                12,
                3.4,
                7,
                fill="#fff",
                stroke=self.PK,
                stroke_width=1,
                transform=f"rotate({a} 24 24)",
            )
            for a in range(0, 360, 51)
        )
        return (
            petals
            + circ(24, 24, 5.4, fill=self.SUN)
            + text(24, 24.4, "7", 7, font_weight=800, font_family=self.font, fill=self.GD)
        )

    def wrap(self, cx):
        pole = rect(21, 5, 6, 38, 2, fill="#a1744a")
        vine = path(
            "M22 40C30 36 30 33 22 29C14 25 14 22 22 18C30 14 30 11 22 7",
            fill="none",
            stroke=self.G,
            stroke_width=2.2,
            stroke_linecap="round",
        )
        path("M26 38C18 34 18 31 26 27", fill="none", stroke=self.GD, stroke_width=0)
        return (
            pole
            + vine
            + self.leaf(30, 33, -20, 8, 3.4)
            + self.leaf(15, 22, 200, 8, 3.4)
            + (self.leaf(30, 12, -20, 8, 3.4))
        )

    def loop(self, cx):
        out = ""
        for i in range(10):
            a = i * 36
            x, y = 24 + 13 * math.cos(math.radians(a)), 24 + 13 * math.sin(math.radians(a))
            out += self.leaf(x, y, a + 70, 9, 3.6, self.G if i % 2 else "#4f9a5f")
        return (
            circ(24, 24, 13, fill="none", stroke=self.GD, stroke_width=1.2)
            + out
            + circ(24, 11, 2, fill=self.PK)
        )

    def tele(self, cx):
        def sprout(x, y):
            return (
                line([(x, y), (x, y - 9)], stroke=self.GD, stroke_width=1.8)
                + self.leaf(x, y - 6, -150, 6, 3)
                + self.leaf(x, y - 8, -30, 6, 3)
            )

        roots = path(
            "M12 28C14 40 34 40 36 18",
            fill="none",
            stroke="#a1744a",
            stroke_width=1.4,
            stroke_dasharray="2 2",
        )
        return (
            line([(5, 28), (43, 28)], stroke="#cfe3d6", stroke_width=1)
            + roots
            + sprout(12, 28)
            + sprout(36, 18)
            + line([(30, 18), (43, 18)], stroke="#cfe3d6", stroke_width=1)
        )

    def pent(self, cx):
        petals = "".join(
            ell(24, 14, 4.8, 8, fill=self.PK, transform=f"rotate({a} 24 25)")
            for a in range(0, 360, 72)
        )
        return petals + circ(24, 25, 5.2, fill=self.SUN) + circ(24, 25, 2, fill="#f59e0b")

    def tetra(self, cx):
        tiers = ""
        for i, (y, w) in enumerate(((8, 10), (17, 14), (26, 18))):
            tiers += poly(
                [(24, y), (24 + w, y + 13), (24 - w, y + 13)], fill=self.G if i % 2 else "#3f8a63"
            )
        return tiers + rect(22, 39, 4, 5, fill="#a1744a")

    def cube(self, cx):
        box = iso_cube(24, 31, 12, "#a1744a", "#8a5f3a", "#6e4a2c")
        soil = poly([(24, 20), (34.4, 26), (24, 32), (13.6, 26)], fill="#5a3a22")
        plant = (
            self.leaf(24, 24, -120, 9, 3.6)
            + self.leaf(24, 24, -60, 9, 3.6)
            + self.leaf(24, 24, -90, 11, 3.8, "#4f9a5f")
        )
        return box + soil + plant

    def ball(self, cx):
        body = sphere(cx, 24, 24, 14, "#8fd49a", "#2f6b4f", spot=False)
        dots_ = "".join(
            circ(x, y, 1.4, fill="#fff", opacity=0.5)
            for x, y in ((18, 18), (29, 20), (22, 27), (30, 30), (17, 30))
        )
        return body + dots_ + circ(24, 10, 2, fill=self.PK)


@register
class Origami(Concept):
    """Paper folding: boat, plane, cootie catcher, rings, pinwheel, lucky star, folded solids."""

    key = "31-origami"
    title = "Origami Paper"
    font = "Lexend,'Segoe UI',sans-serif"
    pal = {"card": "#f3f0fa"}
    V, O, T, Y = "#6c5ce7", "#ff7a3d", "#12b5a6", "#ffc83d"

    def draw(self, kind, cx):
        sheet = path(
            "M4 4H34L44 14V44H4Z",
            fill="#ffffff",
            stroke="#d9d3f5",
            stroke_width=0.8,
            stroke_linejoin="round",
        ) + poly([(34, 4), (44, 14), (34, 14)], fill="#d9d3f5")
        return sheet + getattr(self, kind)(cx)

    def std(self, cx):
        hull = poly([(7, 28), (41, 28), (35, 38), (13, 38)], fill=self.O)
        shade = poly([(24, 28), (41, 28), (35, 38), (24, 38)], fill="#e0561c")
        sail = poly([(24, 8), (36, 26), (24, 26)], fill=self.V) + poly(
            [(24, 8), (24, 26), (12, 26)], fill="#a99df0"
        )
        return hull + shade + sail

    def cut(self, cx):
        paper = poly(
            [(10, 10), (38, 10), (38, 38), (10, 38)], fill="#fff", stroke=self.V, stroke_width=1.2
        )
        cuts = poly([(24, 15), (31, 24), (24, 33), (17, 24)], fill="#d9d3f5") + poly(
            [(24, 15), (31, 24), (24, 24)], fill="#bdb4ee"
        )
        corner = poly([(30, 38), (38, 38), (38, 30)], fill="#a99df0")
        return paper + cuts + corner

    def arr(self, cx):
        return (
            poly(
                [(6, 24), (42, 10), (30, 38), (26, 28)],
                fill="#ffffff",
                stroke=self.T,
                stroke_width=0.8,
                stroke_linejoin="round",
            )
            + poly([(6, 24), (42, 10), (26, 28)], fill=self.T)
            + poly([(26, 28), (42, 10), (30, 38)], fill="#0b8478")
        )

    def exact(self, cx):
        base = poly(
            [(24, 6), (42, 24), (24, 42), (6, 24)], fill="#fff", stroke=self.V, stroke_width=1
        )
        quad = "".join(
            poly(p, fill=c)
            for p, c in (
                ([(24, 6), (42, 24), (24, 24)], self.O),
                ([(42, 24), (24, 42), (24, 24)], self.T),
                ([(24, 42), (6, 24), (24, 24)], self.Y),
                ([(6, 24), (24, 6), (24, 24)], self.V),
            )
        )
        return (
            base
            + quad
            + circ(24, 24, 6, fill="#fff")
            + text(24, 24.4, "7", 9, font_weight=800, font_family=self.font, fill=self.V)
        )

    def wrap(self, cx):
        a = ell(24, 24, 17, 9, fill="none", stroke=self.V, stroke_width=7)
        b = path("M7 24A17 9 0 0 0 41 24", fill="none", stroke="#a99df0", stroke_width=7)
        return (
            a + b + ell(24, 24, 17, 9, fill="none", stroke="#fff", stroke_width=0.8, opacity=0.6)
        )

    def loop(self, cx):
        a = rect(6, 14, 24, 20, 8, fill="none", stroke=self.O, stroke_width=5)
        b = rect(18, 14, 24, 20, 8, fill="none", stroke=self.V, stroke_width=5)
        fix = path("M18 18A8 8 0 0 0 18 30", fill="none", stroke=self.O, stroke_width=5)
        return b + a + fix

    def tele(self, cx):
        def portal(x, y, c):
            outer = poly([(x, y - 9), (x + 9, y), (x, y + 9), (x - 9, y)], fill=c)
            shade = poly([(x, y - 9), (x + 9, y), (x, y)], fill="#fff", opacity=0.25)
            hole = poly([(x, y - 3.6), (x + 3.6, y), (x, y + 3.6), (x - 3.6, y)], fill="#ffffff")
            return outer + shade + hole

        link = line(
            [(21, 21), (27, 27)],
            stroke=self.V,
            stroke_width=1.4,
            stroke_dasharray="0.1 2.6",
            stroke_linecap="round",
        )
        return portal(14, 14, self.V) + link + portal(34, 34, self.O)

    def pent(self, cx):
        pts = star_pts(24, 25, 17, 8, 5)
        out = poly(pts, fill=self.Y, stroke="#fff", stroke_width=0.8, stroke_linejoin="round")
        for i in range(0, 10, 2):
            out += poly([(24, 25), pts[i], pts[(i + 1) % 10]], fill="#e0a31c", opacity=0.55)
        return out

    def tetra(self, cx):
        return tetra(24, 24, 1.0, "#ece8ff", "#cfc7f7", "#a99df0", stroke="#fff", sw=1) + line(
            [(24, 9), (24, 28)], stroke="#fff", stroke_width=0.8
        )

    def cube(self, cx):
        return iso_cube(24, 25, 15, "#ece8ff", "#cfc7f7", "#a99df0", stroke="#fff", sw=1) + line(
            [(11, 18), (37, 32)], stroke="#fff", stroke_width=0.6, opacity=0.6
        )

    def ball(self, cx):
        body = circ(24, 24, 15, fill="#cfc7f7")
        tris = ""
        for i in range(6):
            a = i * 60
            pts = [
                (24, 24),
                (24 + 15 * math.cos(math.radians(a)), 24 + 15 * math.sin(math.radians(a))),
                (
                    24 + 15 * math.cos(math.radians(a + 60)),
                    24 + 15 * math.sin(math.radians(a + 60)),
                ),
            ]
            tris += poly(
                pts,
                fill=[self.V, "#a99df0", "#ece8ff"][i % 3],
                stroke="#fff",
                stroke_width=0.6,
                opacity=0.85,
            )
        return body + tris + circ(24, 24, 15, fill="none", stroke="#fff", stroke_width=0.8)


@register
class Modular(Concept):
    """Building bricks: every type is a studded brick, tile or built shape."""

    key = "32-modular"
    title = "Modular Bento"
    font = "'Inter Tight',Helvetica,Arial,sans-serif"
    pal = {"card": "#eeeae0"}
    B, M, INK, W = "#1f45d6", "#f0b429", "#14161c", "#f8f6ef"

    def draw(self, kind, cx):
        plate = rect(4, 4, 40, 40, fill="#f8f6ef", stroke=self.INK, stroke_width=0.9)
        return plate + getattr(self, kind)(cx)

    def brick(self, x, y, studs, colour, h=11, shade="#00000030"):
        w = studs * 8
        body = rect(x, y, w, h, 1, fill=colour) + rect(x, y + h - 2, w, 2, fill=shade)
        s = "".join(
            rect(x + 1.4 + i * 8, y - 3, 5.2, 3.2, 1, fill=colour)
            + rect(x + 1.4 + i * 8, y - 1.6, 5.2, 1.2, fill="#ffffff", opacity=0.25)
            for i in range(studs)
        )
        return s + body

    def std(self, cx):
        return self.brick(8, 22, 4, self.B, 12)

    def cut(self, cx):
        b = self.brick(8, 22, 4, self.M, 12)
        holes = "".join(
            circ(x, 28, 2.6, fill=self.W, stroke=self.INK, stroke_width=0.8) for x in (16, 24, 32)
        )
        return b + holes + rect(8, 18.5, 8, 4, fill=self.W)

    def arr(self, cx):
        tile = rect(8, 14, 32, 22, 2, fill=self.M) + rect(8, 33, 32, 3, fill="#00000030")
        return tile + arrow_poly(13, 24, 35, 24, w=5, head=9, hw=13, fill=self.INK)

    def exact(self, cx):
        tile = rect(8, 12, 32, 24, 2, fill=self.W, stroke=self.INK, stroke_width=1.2)
        return tile + text(24, 25, "7", 20, font_weight=800, font_family=self.font, fill=self.B)

    def wrap(self, cx):
        area = clip(cx, rect(4, 4, 40, 40))
        return group(self.brick(-2, 22, 7, self.B, 12), clip_path=area)

    def loop(self, cx):
        out = ""
        for x, y in ((9, 9), (25, 9), (9, 25), (25, 25)):
            out += rect(x, y, 14, 14, 1.5, fill=self.B if (x + y) % 32 else self.M)
        return out + rect(18, 18, 12, 12, 2, fill=self.W)

    def tele(self, cx):
        a = self.brick(6, 10, 2, self.B, 10)
        b = self.brick(26, 28, 2, self.M, 10)
        rect(20, 18, 8, 3.4, 1.6, fill=self.INK) + rect(20, 29, 8, 3.4, 1.6, fill=self.INK)
        return (
            a
            + b
            + line(
                [(14, 20), (14, 30), (26, 33)],
                stroke=self.INK,
                stroke_width=1.2,
                stroke_dasharray="2 2",
            )
        )

    def pent(self, cx):
        pts = pent(24, 26, 15)
        studs = "".join(
            circ(
                24 + 8 * math.cos(math.radians(a)),
                26 + 8 * math.sin(math.radians(a)),
                2.4,
                fill=self.W,
                opacity=0.9,
            )
            for a in range(-90, 270, 72)
        )
        return (
            poly(pts, fill=self.B, stroke="#00000040", stroke_width=1)
            + studs
            + circ(24, 26, 2.4, fill=self.W)
        )

    def tetra(self, cx):
        out = self.brick(18, 10, 1, self.M, 8)
        out += self.brick(10, 21, 2, self.B, 8) + self.brick(10, 32, 3, self.INK, 8)
        return out

    def cube(self, cx):
        cube = iso_cube(24, 27, 13, "#2f5be8", "#1f45d6", "#1636a8")
        studs = "".join(
            ell(x, y, 3.2, 1.7, fill="#2f5be8", stroke="#1636a8", stroke_width=0.6)
            for x, y in ((24, 19), (19, 22), (29, 22), (24, 25.5))
        )
        return cube + studs

    def ball(self, cx):
        return (
            rect(22, 7, 4, 5, 1, fill=self.M)
            + ell(24, 13, 6.4, 2.4, fill=self.M)
            + sphere(cx, 24, 27, 13, "#ffd86a", self.M)
        )


@register
class Atomic(Concept):
    """Atomic age: boomerang, kidney table, starburst clock, atom, saucer, sputnik."""

    key = "33-atomic"
    title = "Atomic Bento"
    font = "'DM Sans','Avenir Next',sans-serif"
    pal = {"card": "#f2e6cf"}
    TEAL, BURN, MUS, WAL = "#1f6f78", "#c2410c", "#e2a42b", "#4a2f20"

    def draw(self, kind, cx):
        return rect(3, 3, 42, 42, 17, fill="#fbf4e4") + getattr(self, kind)(cx)

    def burst(self, x, y, outer, inner, fill, spikes=8, **kw):
        return poly(star_pts(x, y, outer, inner, spikes, -90), fill=fill, **kw)

    def std(self, cx):
        return path(
            "M8 36C12 18 22 10 40 12C36 14 24 18 22 36C18 36 12 38 8 36Z",
            fill=self.MUS,
            stroke=self.WAL,
            stroke_width=1,
            stroke_linejoin="round",
        ) + circ(14, 32, 1.6, fill=self.WAL)

    def cut(self, cx):
        body = path(
            "M8 26C6 14 18 8 26 12C32 8 42 14 40 26C42 36 30 42 22 38C14 42 6 36 8 26Z",
            fill=self.TEAL,
        )
        return (
            body + circ(24, 25, 6, fill="#fbf4e4") + circ(15, 18, 2, fill="#fbf4e4", opacity=0.5)
        )

    def arr(self, cx):
        return self.burst(11, 24, 8, 4, self.MUS, 8) + arrow_poly(
            14, 24, 41, 24, w=5, head=11, hw=14, fill=self.BURN
        )

    def exact(self, cx):
        rays = self.burst(24, 24, 18, 12, self.MUS, 16)
        return (
            rays
            + circ(24, 24, 11, fill="#fbf4e4", stroke=self.WAL, stroke_width=1.2)
            + text(24, 24.4, "7", 13, font_weight=800, font_family=self.font, fill=self.BURN)
        )

    def wrap(self, cx):
        arc = path(
            "M40 12C30 6 10 12 8 30",
            fill="none",
            stroke=self.WAL,
            stroke_width=1.4,
            stroke_dasharray="2 2.4",
            stroke_linecap="round",
        )
        boom = path(
            "M5 30C8 24 12 22 18 24C14 26 12 30 11 36C8 36 6 34 5 30Z",
            fill=self.BURN,
            stroke=self.WAL,
            stroke_width=0.8,
            stroke_linejoin="round",
        )
        return arc + boom + poly([(36, 7), (43, 12), (34, 15)], fill=self.WAL)

    def loop(self, cx):
        rings = "".join(
            ell(
                24,
                24,
                16,
                6.2,
                fill="none",
                stroke=self.TEAL,
                stroke_width=1.4,
                transform=f"rotate({a} 24 24)",
            )
            for a in (0, 60, 120)
        )
        return rings + circ(24, 24, 3.4, fill=self.BURN) + circ(38, 22, 2, fill=self.MUS)

    def tele(self, cx):
        beam = poly([(18, 24), (30, 24), (36, 41), (12, 41)], fill=self.MUS, opacity=0.4)
        saucer = ell(24, 21, 15, 4.4, fill=self.TEAL) + path(
            "M15 20A9 8 0 0 1 33 20Z", fill="#9fd8de"
        )
        dots_ = "".join(circ(x, 21.5, 1.1, fill=self.MUS) for x in (14, 19, 24, 29, 34))
        return beam + saucer + dots_ + sparkle(37, 10, 3.2, self.BURN)

    def pent(self, cx):
        pts = pent(24, 25, 16)
        return poly(
            pts, fill=self.BURN, stroke=self.WAL, stroke_width=1, stroke_linejoin="round"
        ) + (
            self.burst(24, 25, 8, 4, self.MUS, 5, rot=0)
            if False
            else self.burst(24, 25, 7, 3.4, self.MUS, 5)
        )

    def tetra(self, cx):
        legs = "".join(
            line([(24, 28), p], stroke=self.WAL, stroke_width=1.2)
            for p in ((10, 42), (24, 44), (38, 42))
        )
        return tetra(24, 20, 0.85, "#ffd479", self.MUS, self.BURN, stroke=self.WAL, sw=0.9) + legs

    def cube(self, cx):
        ants = line([(24, 12), (15, 4)], stroke=self.WAL, stroke_width=1.2) + line(
            [(24, 12), (33, 4)], stroke=self.WAL, stroke_width=1.2
        )
        tv = iso_cube(24, 27, 14, "#e9dcc0", self.TEAL, "#17565d", stroke=self.WAL, sw=0.9)
        return ants + tv + circ(19, 30, 3.2, fill="#9fd8de", stroke=self.WAL, stroke_width=0.6)

    def ball(self, cx):
        ants = "".join(
            line(
                [
                    (24, 24),
                    (24 + 20 * math.cos(math.radians(a)), 24 + 20 * math.sin(math.radians(a))),
                ],
                stroke=self.WAL,
                stroke_width=1,
            )
            for a in (-160, -135, -45, -20)
        )
        return ants + sphere(cx, 24, 24, 9.5, "#e9f6f7", "#6fa8ad")


@register
class Glass(Concept):
    """Stained glass: lead-lined jewel panes, rose window, lancets and faceted gems."""

    key = "34-glass"
    title = "Stained Glass"
    font = "Cinzel,'Times New Roman',serif"
    pal = {"card": "#14100e"}
    LEAD = "#14100e"
    RU, SA, EM, AM, AMY = "#b3202a", "#1e48a8", "#157a48", "#d9930d", "#6d3a9c"

    def draw(self, kind, cx):
        arch = path(
            "M4 46V18A20 16 0 0 1 44 18V46Z",
            fill="#1c1612",
            stroke="#8a7a62",
            stroke_width=1.6,
            stroke_linejoin="round",
        )
        return arch + getattr(self, kind)(cx)

    def lead(self, **kw):
        return dict(stroke=self.LEAD, stroke_width=1.6, stroke_linejoin="round", **kw)

    def std(self, cx):
        panes = ""
        for i, c in enumerate((self.RU, self.AM, self.SA, self.EM)):
            panes += rect(15, 11 + i * 8.2, 18, 8.2, fill=c, **self.lead())
        return panes + path("M15 11A9 7 0 0 1 33 11", fill=self.AMY, **self.lead())

    def cut(self, cx):
        return poly(
            [(24, 8), (38, 24), (24, 40), (10, 24)],
            fill="#d6eef2",
            fill_opacity=0.35,
            **self.lead(),
        ) + poly(
            [(24, 14), (32, 24), (24, 34), (16, 24)],
            fill="#14100e",
            fill_opacity=0.4,
            **self.lead(),
        )

    def arr(self, cx):
        return poly(
            [(24, 7), (37, 22), (28, 22), (28, 40), (20, 40), (20, 22), (11, 22)],
            fill=self.AM,
            **self.lead(),
        ) + line([(24, 12), (24, 38)], stroke=self.LEAD, stroke_width=1.2)

    def exact(self, cx):
        return (
            circ(24, 24, 14, fill=self.SA, **self.lead())
            + circ(24, 24, 9, fill="#fff1b8", **self.lead())
            + text(24, 24.4, "7", 12, font_weight=800, font_family=self.font, fill=self.LEAD)
        )

    def wrap(self, cx):
        left = path("M24 10A14 14 0 0 0 24 38Z", fill=self.RU, **self.lead())
        right = path("M24 10A14 14 0 0 1 24 38Z", fill=self.SA, **self.lead())
        return (
            left
            + right
            + line([(24, 6), (24, 42)], stroke=self.LEAD, stroke_width=2.4)
            + poly([(24, 18), (30, 24), (24, 30), (18, 24)], fill=self.AM, **self.lead())
        )

    def loop(self, cx):
        petals = "".join(
            circ(
                24 + 9 * math.cos(math.radians(a)),
                24 + 9 * math.sin(math.radians(a)),
                5.4,
                fill=[self.RU, self.AM, self.SA, self.EM, self.AMY, self.AM][i % 6],
                **self.lead(),
            )
            for i, a in enumerate(range(-90, 270, 60))
        )
        return (
            circ(24, 24, 15, fill="#14100e", stroke="#d9b45a", stroke_width=0.8)
            + petals
            + circ(24, 24, 4, fill="#fff1b8", **self.lead())
        )

    def tele(self, cx):
        sun = circ(24, 14, 8, fill=self.AM, **self.lead())
        rays = "".join(
            line(
                [
                    (24 + 8 * math.cos(math.radians(a)), 14 + 8 * math.sin(math.radians(a))),
                    (24 + 11 * math.cos(math.radians(a)), 14 + 11 * math.sin(math.radians(a))),
                ],
                stroke=self.AM,
                stroke_width=1.4,
            )
            for a in range(0, 360, 45)
        )
        moon = circ(24, 33, 8, fill=self.SA, **self.lead()) + circ(27, 31, 6, fill="#1c1612")
        return rays + sun + moon

    def pent(self, cx):
        pts = pent(24, 25, 15)
        facets = "".join(
            poly(
                [(24, 25), pts[i], pts[(i + 1) % 5]],
                fill=[self.EM, self.AM, self.RU, self.SA, self.AMY][i],
                **self.lead(),
            )
            for i in range(5)
        )
        return facets

    def tetra(self, cx):
        return tetra(24, 24, 1.0, self.AM, self.RU, self.SA, stroke=self.LEAD, sw=1.6)

    def cube(self, cx):
        return iso_cube(24, 25, 15, self.AM, self.EM, self.AMY, stroke=self.LEAD, sw=1.6)

    def ball(self, cx):
        return sphere(cx, 24, 24, 14, "#7aa2ff", self.SA, rim=self.LEAD) + circ(
            24, 24, 14, fill="none", stroke=self.LEAD, stroke_width=1.6
        )


@register
class Stitch(Concept):
    """Sewing kit: needle, eyelet, tape measure, spool, hoop, pincushion, yarn."""

    key = "35-stitch"
    title = "Cross-Stitch Sampler"
    font = "Mali,'Comic Sans MS',cursive"
    pal = {"card": "#f2ead7"}
    RED, BLUE, GRN, GOLD = "#c43a31", "#2b5aa8", "#3c8d5a", "#e0a82e"

    def draw(self, kind, cx):
        plate = circ(24, 24.6, 21, fill="#f8f1de", stroke="#b9854d", stroke_width=2.4)
        return plate + getattr(self, kind)(cx)

    def st(self, d, colour=None, w=1.6, dash="2.6 2", **kw):
        return path(
            d,
            fill="none",
            stroke=colour or self.RED,
            stroke_width=w,
            stroke_dasharray=dash,
            stroke_linecap="round",
            **kw,
        )

    def std(self, cx):
        needle = line(
            [(10, 38), (36, 12)], stroke="#9aa0a6", stroke_width=2, stroke_linecap="round"
        )
        eye = ell(
            34,
            14,
            1.2,
            2.6,
            fill="#f8f1de",
            stroke="#9aa0a6",
            stroke_width=0.6,
            transform="rotate(45 34 14)",
        )
        thread = path(
            "M34 14C44 10 40 24 30 22C20 20 18 34 10 30",
            fill="none",
            stroke=self.RED,
            stroke_width=1.6,
            stroke_linecap="round",
        )
        return thread + needle + eye

    def cut(self, cx):
        ring = circ(
            24, 24, 11, fill="none", stroke=self.RED, stroke_width=1.8, stroke_dasharray="2.6 2"
        )
        hole = circ(24, 24, 6.5, fill="#c9b78a") + circ(24, 24, 5.4, fill="#6b5a38")
        return ring + circ(24, 24, 8, fill="none", stroke=self.RED, stroke_width=1.2) + hole

    def arr(self, cx):
        body = arrow_poly(9, 24, 39, 24, w=11, head=14, hw=21, fill=self.GRN)
        return body + self.st("M11 21H27M11 27H27", "#f8f1de", 1.2, "2 1.6")

    def exact(self, cx):
        tape = rect(6, 16, 36, 16, 2, fill="#f6e08a", stroke="#b9854d", stroke_width=0.9)
        ticks = "".join(f"M{9 + i * 3} 16v{4 if i % 5 == 0 else 2.4}" for i in range(12))
        return (
            tape
            + path(ticks, stroke="#7a5a14", stroke_width=0.8, fill="none")
            + text(24, 27, "7", 9, font_weight=800, font_family=self.font, fill=self.RED)
        )

    def wrap(self, cx):
        body = rect(15, 11, 18, 26, 2, fill=self.BLUE)
        thread = "".join(
            path(f"M15 {y}L33 {y + 3}", stroke="#8fb0e8", stroke_width=1.6, fill="none")
            for y in (14, 18, 22, 26, 30)
        )
        return (
            rect(12, 8, 24, 4, 1, fill="#d9a96a")
            + rect(12, 36, 24, 4, 1, fill="#d9a96a")
            + body
            + thread
        )

    def loop(self, cx):
        out = circ(24, 24, 14, fill="none", stroke="#b9854d", stroke_width=3.6) + circ(
            24, 24, 11.6, fill="none", stroke="#7a5a2e", stroke_width=0.5
        )
        screw = rect(21, 6, 6, 5, 1, fill="#d9a96a", stroke="#7a5a2e", stroke_width=0.6)
        return out + screw + self.st("M15 26Q20 20 24 26T33 24", self.RED, 1.4)

    def tele(self, cx):
        fabric = rect(6, 20, 36, 14, 2, fill="#e8dcc0")
        holes = circ(15, 27, 1.6, fill="#6b5a38") + circ(33, 27, 1.6, fill="#6b5a38")
        thread = path(
            "M15 27C16 8 32 8 33 27",
            fill="none",
            stroke=self.RED,
            stroke_width=1.5,
            stroke_dasharray="2.6 2",
        )
        return (
            fabric
            + holes
            + thread
            + line(
                [(11, 36), (19, 20)], stroke="#9aa0a6", stroke_width=1.6, stroke_linecap="round"
            )
        )

    def pent(self, cx):
        pts = pent(24, 25, 14)
        patch = poly(
            pts, fill="#e8c27a", stroke="#c9a05a", stroke_width=1, stroke_linejoin="round"
        )
        inner = poly(
            pent(24, 25, 10.5),
            fill="none",
            stroke=self.RED,
            stroke_width=1.2,
            stroke_dasharray="2 1.6",
            stroke_linejoin="round",
        )
        return patch + inner

    def tetra(self, cx):
        pins = "".join(
            line([(x, y), (x + dx, y - 9)], stroke="#cfd3d8", stroke_width=0.9)
            + circ(x + dx, y - 9, 1.5, fill=c)
            for x, y, dx, c in (
                (20, 24, -3, self.BLUE),
                (26, 22, 1, self.GOLD),
                (30, 28, 4, self.GRN),
            )
        )
        return tetra(24, 28, 0.85, "#e0645c", self.RED, "#8c2822", stroke="#f8f1de", sw=0.8) + pins

    def cube(self, cx):
        cubic = iso_cube(24, 25, 14, "#e8c27a", self.RED, self.BLUE, stroke="#f8f1de", sw=1)
        stitch = path(
            "M24 25V39", stroke="#f8f1de", stroke_width=1, stroke_dasharray="1.6 1.2", fill="none"
        )
        return cubic + stitch

    def ball(self, cx):
        body = circ(24, 24, 14, fill=self.RED)
        strands = "".join(
            path(d, fill="none", stroke="#e8837a", stroke_width=1.1)
            for d in (
                "M12 20Q24 28 36 18",
                "M11 27Q24 36 37 26",
                "M15 14Q22 22 30 12",
                "M14 33Q26 38 34 31",
            )
        )
        tail = path(
            "M34 32C40 34 42 38 38 41",
            fill="none",
            stroke=self.RED,
            stroke_width=1.6,
            stroke_linecap="round",
        )
        return body + strands + tail + circ(18, 16, 2.6, fill="#fff", opacity=0.25)
