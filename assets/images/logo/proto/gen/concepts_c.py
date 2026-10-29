"""Icon concepts 22-28: bouncing balls, doodles, transit signs, zen ink, riso overprint, wood, aurora."""

import math
import random

from core import (
    Style,
    circ,
    ell,
    group,
    line,
    path,
    poly,
    rect,
    register,
    star_pts,
    text,
)
from kit import blur, clip, linear, sparkle, wobble
from kit2 import (
    Concept,
    arc_d,
    arrow_poly,
    dots,
    iso_cube,
    pent,
    sine,
    sphere,
    spiral,
    tetra,
)


@register
class Bounce(Concept):
    """Bouncing physics: balls, trajectories and ground shadows."""

    key = "22-bounce"
    title = "Bounce"
    font = "'Baloo 2',Nunito,sans-serif"
    pal = {"card": "#dbe6ff"}
    R, A, S = "#2342c4", "#ffb020", "#8fa8ff"

    def draw(self, kind, cx):
        plate = rect(3, 3, 42, 42, 13, fill="#f4f7ff", stroke="#c7d6ff", stroke_width=1)
        return (
            plate
            + line([(8, 38), (40, 38)], stroke="#c7d6ff", stroke_width=1.4, stroke_linecap="round")
            + getattr(self, kind)(cx)
        )

    def orb(self, x, y, r, colour, ground=38):
        k = max(0.4, 1 - (ground - y) / 60)
        return (
            ell(x, ground, r * k * 1.1, r * 0.28, fill=self.R, opacity=0.18)
            + circ(x, y, r, fill=colour)
            + circ(x - r * 0.35, y - r * 0.4, r * 0.25, fill="#fff", opacity=0.75)
        )

    def arc(self, d, **kw):
        return path(
            d,
            fill="none",
            stroke=self.R,
            stroke_width=1.3,
            stroke_dasharray="0.1 3",
            stroke_linecap="round",
            **kw,
        )

    def std(self, cx):
        return self.arc("M6 38Q12 12 18 38Q24 12 30 38Q36 12 42 38") + self.orb(24, 20, 5, self.A)

    def cut(self, cx):
        return (
            ell(24, 38, 6, 2, fill="#17297f")
            + rect(5, 36.6, 14, 2.8, fill="#f4f7ff")
            + rect(29, 36.6, 14, 2.8, fill="#f4f7ff")
            + line([(8, 38), (18, 38)], stroke="#c7d6ff", stroke_width=1.4)
            + line([(30, 38), (40, 38)], stroke="#c7d6ff", stroke_width=1.4)
            + self.orb(24, 20, 5.5, self.R, 38)
            + line([(24, 8), (24, 11)], stroke=self.S, stroke_width=1.4, stroke_linecap="round")
        )

    def arr(self, cx):
        return (
            self.orb(18, 30, 6, self.A)
            + path(
                "M14 22Q26 6 38 18",
                fill="none",
                stroke=self.R,
                stroke_width=2.4,
                stroke_linecap="round",
            )
            + poly([(41, 21), (34, 21), (37, 14)], fill=self.R)
        )

    def exact(self, cx):
        return (
            ell(24, 38, 10, 2.2, fill=self.R, opacity=0.18)
            + circ(24, 23, 13, fill=self.A)
            + circ(24, 23, 7, fill="#fff")
            + text(24, 23.5, "7", 11, font_weight=800, font_family=self.font, fill=self.R)
        )

    def wrap(self, cx):
        area = clip(cx, rect(4, 4, 40, 40, 11))
        halves = group(circ(2, 24, 9, fill=self.A) + circ(46, 24, 9, fill=self.A), clip_path=area)
        return (
            halves
            + line(
                [(14, 24), (34, 24)],
                stroke=self.R,
                stroke_width=1.6,
                stroke_dasharray="0.1 3.4",
                stroke_linecap="round",
            )
            + poly([(34, 20), (38, 24), (34, 28)], fill=self.R)
        )

    def loop(self, cx):
        d = "M6 34H14C28 34 30 12 22 12C14 12 16 34 30 34H42"
        return self.arc(d) + self.orb(22, 12, 4.6, self.A, 38)

    def tele(self, cx):
        def pipe(x, y):
            return rect(x - 6, y, 12, 14, 2, fill=self.R) + ell(x, y, 6, 2.4, fill="#17297f")

        return (
            pipe(12, 24)
            + pipe(36, 24)
            + self.arc("M12 20Q24 -2 36 20")
            + self.orb(30, 9, 4, self.A, 38)
        )

    def pent(self, cx):
        pts = [
            (24 + 15 * math.cos(math.radians(a)), 36 + 5 * math.sin(math.radians(a)))
            for a in range(-90, 270, 72)
        ]
        return poly(
            pts, fill=self.R, stroke=self.R, stroke_width=3, stroke_linejoin="round"
        ) + self.orb(24, 18, 6, self.A, 36)

    def tetra(self, cx):
        return ell(24, 40, 12, 2.4, fill=self.R, opacity=0.18) + tetra(
            24, 22, 0.95, "#8fa8ff", "#5b7cf5", self.R
        )

    def cube(self, cx):
        motion = "".join(
            line([(x, 6), (x, 10)], stroke=self.S, stroke_width=1.4, stroke_linecap="round")
            for x in (15, 24, 33)
        )
        return (
            motion
            + ell(24, 40, 11, 2.2, fill=self.R, opacity=0.18)
            + iso_cube(24, 25, 13, "#8fa8ff", "#5b7cf5", self.R)
        )

    def ball(self, cx):
        return self.orb(24, 22, 15, self.R, 40)


@register
class Doodle(Concept):
    """Notebook marginalia: scribbles, punch holes, tally marks, spiral binding, pencils."""

    key = "23-doodle"
    title = "Doodle Notebook"
    font = "'Patrick Hand','Comic Sans MS',cursive"
    pal = {"card": "#fbfdff"}
    PEN, PINK, YEL, BLUE = "#1d2b53", "#ff5d8f", "#ffe066", "#2b59ff"

    def draw(self, kind, cx):
        self.rng = random.Random(cx.uid)
        grid = "".join(f"M4 {y}H44" for y in range(10, 44, 6)) + "".join(
            f"M{x} 4V44" for x in range(10, 44, 6)
        )
        plate = rect(4, 4, 40, 40, fill="#fff", stroke=self.PEN, stroke_width=1.2) + path(
            grid, stroke="#cfe0ff", stroke_width=0.5, fill="none"
        )
        return plate + getattr(self, kind)(cx)

    def pen(self, pts, colour=None, w=1.4, amp=0.3, **kw):
        return line(
            wobble(pts, self.rng, amp),
            stroke=colour or self.PEN,
            stroke_width=w,
            stroke_linecap="round",
            stroke_linejoin="round",
            **kw,
        )

    def std(self, cx):
        zig = self.pen([(8, 34), (16, 14), (24, 34), (32, 14), (40, 34)], self.PINK, 3.2)
        return zig + sparkle(37, 11, 4, self.YEL, stroke=self.PEN, stroke_width=0.9)

    def cut(self, cx):
        sheet = self.pen([(12, 8), (36, 8), (36, 40), (12, 40), (12, 8)], None, 1.2)
        holes = "".join(circ(17, y, 2.2, fill="#1d2b53") for y in (14, 24, 34))
        torn = self.pen([(36, 14), (33, 17), (36, 20), (33, 23)], None, 1.1)
        return sheet + holes + torn

    def arr(self, cx):
        shaft = path(
            "M9 34C16 14 28 12 38 18",
            fill="none",
            stroke=self.PEN,
            stroke_width=2,
            stroke_linecap="round",
        )
        return shaft + self.pen([(30, 12), (38, 18), (31, 24)], None, 2)

    def exact(self, cx):
        out = ""
        for i, x in enumerate((9, 14, 19, 24)):
            out += self.pen([(x, 12), (x, 34)], None, 1.8)
        out += self.pen([(6, 30), (27, 16)], self.PINK, 1.8)
        out += self.pen([(33, 12), (33, 34)], None, 1.8) + self.pen(
            [(39, 12), (39, 34)], None, 1.8
        )
        return out

    def wrap(self, cx):
        body = ell(24, 13, 11, 4, fill="#fff", stroke=self.PEN, stroke_width=1.3) + path(
            "M13 13V33A11 4 0 0 0 35 33V13", fill="#fff", stroke=self.PEN, stroke_width=1.3
        )
        band = path(
            "M13 27A11 4 0 0 0 35 22",
            fill="none",
            stroke=self.PINK,
            stroke_width=2.4,
            stroke_linecap="round",
        )
        return body + band + poly([(35, 17), (38, 24), (31, 22)], fill=self.PINK)

    def loop(self, cx):
        out = ""
        for x in (11, 20, 29, 38):
            out += path(
                f"M{x} 9C{x - 5} 9 {x - 5} 17 {x} 17C{x + 5} 17 {x + 5} 9 {x} 9",
                fill="none",
                stroke=self.PEN,
                stroke_width=1.4,
            )
        return (
            out
            + self.pen([(8, 14), (40, 14)], None, 0.0)
            + rect(8, 20, 32, 20, fill="#fff", stroke=self.PEN, stroke_width=1.2)
            + "".join(self.pen([(12, y), (36, y)], "#cfe0ff", 1) for y in (26, 31, 36))
        )

    def tele(self, cx):
        return (
            self.pen(spiral(24, 24, 1, 14, 3), self.BLUE, 2)
            + sparkle(37, 11, 3.4, self.YEL, stroke=self.PEN, stroke_width=0.8)
            + sparkle(11, 37, 3, self.YEL, stroke=self.PEN, stroke_width=0.8)
        )

    def pent(self, cx):
        pts = pent(24, 25, 15)
        star = [pts[0], pts[2], pts[4], pts[1], pts[3], pts[0]]
        return self.pen(pts + [pts[0]], None, 1.8) + self.pen(star, self.PINK, 1.2)

    def tetra(self, cx):
        return (
            self.pen([(24, 8), (8, 38), (40, 38), (24, 8)], None, 1.8)
            + self.pen([(24, 8), (24, 28), (8, 38)], None, 1.2)
            + self.pen([(24, 28), (40, 38)], None, 1.2)
            + poly([(24, 8), (8, 38), (24, 28)], fill=self.YEL, opacity=0.5)
        )

    def cube(self, cx):
        return (
            rect(9, 17, 20, 20, fill="none", stroke=self.PEN, stroke_width=1.6)
            + self.pen([(17, 9), (37, 9), (37, 29), (29, 37)], None, 1.6)
            + self.pen([(9, 17), (17, 9)], None, 1.6)
            + self.pen([(29, 17), (37, 9)], None, 1.6)
            + rect(9, 17, 20, 20, fill=self.BLUE, opacity=0.15)
        )

    def ball(self, cx):
        return (
            circ(24, 24, 15, fill="#fff", stroke=self.PEN, stroke_width=1.6)
            + path("M9 24A15 5 0 0 0 39 24", fill="none", stroke=self.PEN, stroke_width=1.1)
            + path("M24 9A5 15 0 0 0 24 39", fill="none", stroke=self.PEN, stroke_width=1.1)
            + circ(24, 24, 15, fill=self.PINK, opacity=0.12)
            + self.pen([(14, 14), (18, 11)], "#ffffff", 2)
        )


@register
class Metro(Concept):
    """Transit signage: line strips, closed stations, direction signs, route bullets."""

    key = "24-metro"
    title = "Metro Line"
    font = "Barlow,'DIN Alternate',Arial,sans-serif"
    pal = {"card": "#fafafa"}
    RED, BLUE, AMB, GRN, PUR = "#e3262f", "#0072ce", "#ffb000", "#00a651", "#8a4fbf"
    INK = "#1a1a1a"

    def draw(self, kind, cx):
        plate = rect(3.5, 3.5, 41, 41, 8, fill="#ffffff", stroke="#d2d2d2", stroke_width=1)
        return plate + getattr(self, kind)(cx)

    def stn(self, x, y, r=3.2):
        return circ(x, y, r, fill="#fff", stroke=self.INK, stroke_width=1.6)

    def ln(self, pts, colour, w=4):
        return line(
            pts, stroke=colour, stroke_width=w, stroke_linecap="round", stroke_linejoin="round"
        )

    def std(self, cx):
        return self.ln([(8, 24), (40, 24)], self.RED) + "".join(
            self.stn(x, 24) for x in (10, 19, 28, 38)
        )

    def cut(self, cx):
        return (
            self.ln([(8, 24), (40, 24)], self.BLUE)
            + self.stn(10, 24)
            + self.stn(38, 24)
            + circ(24, 24, 5.4, fill="#fff", stroke=self.RED, stroke_width=1.6)
            + line([(20.5, 20.5), (27.5, 27.5)], stroke=self.RED, stroke_width=2)
            + line([(27.5, 20.5), (20.5, 27.5)], stroke=self.RED, stroke_width=2)
        )

    def arr(self, cx):
        return rect(6, 13, 36, 22, 3, fill=self.INK) + arrow_poly(
            12, 24, 36, 24, w=4.4, head=9, hw=12, fill="#fff"
        )

    def exact(self, cx):
        return circ(24, 24, 15, fill=self.GRN) + text(
            24, 24.5, "7", 21, font_weight=800, font_family=self.font, fill="#fff"
        )

    def wrap(self, cx):
        def chev(x):
            return line(
                [(x - 2.4, 19.5), (x + 1.2, 24), (x - 2.4, 28.5)],
                stroke="#fff",
                stroke_width=2,
                stroke_linecap="round",
                stroke_linejoin="round",
            )

        return self.ln([(5, 24), (43, 24)], self.PUR, 5) + chev(13) + chev(35) + self.stn(24, 24)

    def loop(self, cx):
        ring = circ(24, 24, 13, fill="none", stroke=self.RED, stroke_width=4.4)
        stns = "".join(
            self.stn(24 + 13 * math.cos(math.radians(a)), 24 + 13 * math.sin(math.radians(a)), 2.8)
            for a in (-90, 0, 90, 180)
        )
        return ring + stns + poly([(24, 4), (31, 8), (24, 12)], fill=self.INK)

    def tele(self, cx):
        return (
            self.ln([(6, 14), (20, 14)], self.BLUE)
            + self.ln([(28, 34), (42, 34)], self.AMB)
            + line(
                [(20, 14), (28, 34)],
                stroke=self.INK,
                stroke_width=1.6,
                stroke_dasharray="0.1 2.4",
                stroke_linecap="round",
            )
            + self.stn(20, 14)
            + self.stn(28, 34)
        )

    def pent(self, cx):
        return poly(
            pent(24, 25, 17),
            fill=self.AMB,
            stroke=self.AMB,
            stroke_width=2,
            stroke_linejoin="round",
        ) + text(24, 26, "P", 16, font_weight=800, font_family=self.font, fill=self.INK)

    def tetra(self, cx):
        return poly(
            [(24, 8), (41, 38), (7, 38)],
            fill=self.PUR,
            stroke=self.PUR,
            stroke_width=3,
            stroke_linejoin="round",
        ) + text(24, 29, "T", 15, font_weight=800, font_family=self.font, fill="#fff")

    def cube(self, cx):
        return iso_cube(24, 25, 16, self.GRN, self.BLUE, self.INK, stroke="#fff", sw=1) + text(
            24, 18, "C", 8, font_weight=800, font_family=self.font, fill="#fff"
        )

    def ball(self, cx):
        return circ(24, 24, 16, fill=self.BLUE) + text(
            24, 24.5, "M", 22, font_weight=800, font_family=self.font, fill="#fff"
        )


@register
class Zen(Concept):
    """Ink and stone: brush strokes, ensō, raked sand, stepping stones."""

    key = "25-zen"
    title = "Zen Ink"
    font = "'Zen Kaku Gothic New','Hiragino Sans',sans-serif"
    pal = {"card": "#f2f1ee"}
    INK, RED, STONE = "#15130f", "#c9301f", "#57544d"

    def draw(self, kind, cx):
        ident = cx.new_id("f")
        cx.add(
            f'<filter id="{ident}" x="-5%" y="-5%" width="110%" height="110%">'
            '<feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4"/>'
            '<feDisplacementMap in="SourceGraphic" scale="1.7"/></filter>'
        )
        plate = rect(4, 4, 40, 40, fill="#f8f7f3", stroke=self.INK, stroke_width=1.1)
        return plate + group(getattr(self, kind)(cx), filter=f"url(#{ident})")

    def brush(self, d, w=3.4):
        return path(d, fill="none", stroke=self.INK, stroke_width=w, stroke_linecap="round")

    def std(self, cx):
        body = path("M7 32C16 18 26 36 41 16C27 30 18 14 7 32Z", fill=self.INK)
        return body + circ(38, 36, 2.6, fill=self.RED)

    def cut(self, cx):
        rings = "".join(
            circ(24, 24, r, fill="none", stroke=self.STONE, stroke_width=0.7)
            for r in (7, 10.5, 14)
        )
        return rings + ell(24, 24, 4.6, 3.6, fill=self.INK)

    def arr(self, cx):
        return (
            self.brush("M8 32C16 32 24 24 33 24", 3.6)
            + poly([(30, 15), (41, 24), (30, 33)], fill=self.INK)
            + "".join(
                line([(8, y), (22, y - 2)], stroke=self.STONE, stroke_width=0.8) for y in (18, 24)
            )
        )

    def exact(self, cx):
        return (
            self.brush("M9 20H37", 3.2)
            + self.brush("M23 10V32C23 36 28 37 34 34", 3.2)
            + rect(32, 34, 7, 7, 1, fill=self.RED)
        )

    def wrap(self, cx):
        return (
            path(
                "M4 32C10 32 16 28 20 28",
                fill="none",
                stroke=self.INK,
                stroke_width=3.2,
                stroke_linecap="round",
            )
            + path(
                "M28 18C32 18 38 14 44 14",
                fill="none",
                stroke=self.INK,
                stroke_width=3.2,
                stroke_linecap="round",
            )
            + line(
                [(21, 28), (27, 18)],
                stroke=self.RED,
                stroke_width=1.2,
                stroke_dasharray="0.1 2.6",
                stroke_linecap="round",
            )
        )

    def loop(self, cx):
        return path(
            arc_d(24, 24, 14, -40, 270),
            fill="none",
            stroke=self.INK,
            stroke_width=4.4,
            stroke_linecap="round",
        ) + circ(24, 24, 1.8, fill=self.RED)

    def tele(self, cx):
        rip = "".join(
            circ(x, y, r, fill="none", stroke=self.STONE, stroke_width=0.7)
            for x, y, r in ((14, 31, 8), (34, 17, 8), (14, 31, 5), (34, 17, 5))
        )
        return rip + ell(14, 31, 3.6, 2.8, fill=self.INK) + ell(34, 17, 3.6, 2.8, fill=self.INK)

    def pent(self, cx):
        pts = [(24, 10), (37, 20), (33, 36), (15, 37), (10, 21)]
        return poly(
            pts, fill="#8a8780", stroke=self.INK, stroke_width=1.6, stroke_linejoin="round"
        ) + poly([(24, 10), (37, 20), (24, 24), (10, 21)], fill="#b5b2aa")

    def tetra(self, cx):
        return poly(
            [(24, 8), (40, 38), (8, 38)],
            fill="#9d9a92",
            stroke=self.INK,
            stroke_width=1.6,
            stroke_linejoin="round",
        ) + poly([(24, 8), (40, 38), (24, 38)], fill=self.STONE)

    def cube(self, cx):
        return iso_cube(24, 25, 15, "#d9d7d0", "#9d9a92", self.STONE, stroke=self.INK, sw=1.3)

    def ball(self, cx):
        return (
            circ(24, 24, 14, fill="#e9e7e0")
            + circ(24, 24, 14, fill="none", stroke=self.INK, stroke_width=1.4)
            + rect(32, 32, 7, 7, 1, fill=self.RED)
        )


@register
class Riso(Concept):
    """Risograph zine: two-ink overprint shapes with misregistration and halftone."""

    key = "26-riso"
    title = "Riso Duo"
    font = "Syne,'Trebuchet MS',sans-serif"
    pal = {"card": "#f5f5f1"}
    PK, BL, YL = "#ff48b0", "#0078bf", "#ffe800"

    def draw(self, kind, cx):
        sun = circ(32, 16, 11, fill=self.YL)
        return rect(3, 3, 42, 42, fill="#f5f5f1") + sun + getattr(self, kind)(cx)

    def mul(self, markup):
        return group(markup, style="mix-blend-mode:multiply")

    def std(self, cx):
        pts = sine(8, 26, 40, 26, 7, 1.5)
        a = line(
            [(x - 1, y - 0.8) for x, y in pts],
            stroke=self.BL,
            stroke_width=5,
            stroke_linecap="round",
            opacity=0.9,
        )
        b = line(pts, stroke=self.PK, stroke_width=5, stroke_linecap="round")
        return a + self.mul(b)

    def cut(self, cx):
        return self.mul(circ(24, 24, 15, fill=self.PK)) + circ(
            24, 24, 8, fill=dots(cx, self.BL, 2.2, 0.7), stroke=self.BL, stroke_width=1
        )

    def arr(self, cx):
        return arrow_poly(
            8, 25, 40, 25, w=9, head=15, hw=21, fill=self.BL, transform="translate(-1 -1)"
        ) + self.mul(arrow_poly(8, 25, 40, 25, w=9, head=15, hw=21, fill=self.PK))

    def exact(self, cx):
        return text(
            23, 25, "7", 34, font_weight=800, font_family=self.font, fill=self.BL
        ) + self.mul(text(25, 26, "7", 34, font_weight=800, font_family=self.font, fill=self.PK))

    def wrap(self, cx):
        area = clip(cx, rect(3, 3, 42, 42))
        return group(
            self.mul(circ(5, 24, 14, fill=self.PK))
            + self.mul(circ(43, 24, 14, fill=self.BL))
            + circ(5, 24, 14, fill=dots(cx, self.BL, 2.2, 0.6)),
            clip_path=area,
        ) + line(
            [(18, 24), (30, 24)],
            stroke="#12306e",
            stroke_width=1.4,
            stroke_dasharray="0.1 3",
            stroke_linecap="round",
        )

    def loop(self, cx):
        return circ(23, 23, 12, fill="none", stroke=self.BL, stroke_width=7) + self.mul(
            circ(25, 25, 12, fill="none", stroke=self.PK, stroke_width=7)
        )

    def tele(self, cx):
        return circ(18, 20, 12, fill=self.PK) + self.mul(circ(30, 28, 12, fill=self.BL))

    def pent(self, cx):
        pts = pent(24, 25, 16)
        return poly(pts, fill=self.BL) + self.mul(
            poly(pent(26, 27, 16), fill=dots(cx, self.PK, 2.2, 0.9))
        )

    def tetra(self, cx):
        return tetra(24, 24, 1.0, "#f5f5f1", self.BL, self.PK, stroke="#12306e", sw=1)

    def cube(self, cx):
        return iso_cube(24, 25, 15, "#f5f5f1", self.PK, self.BL, stroke="#12306e", sw=1)

    def ball(self, cx):
        return circ(24, 24, 15, fill=self.BL) + self.mul(
            circ(26, 26, 15, fill=dots(cx, self.PK, 2.4, 1.0))
        )


@register
class Wood(Style):
    """Wooden game board: maple tiles, a red lacquer route, brass studs. The board scenes of the
    engine (core.scene) with a palette; Two paths takes the studs from its route colours."""

    key = "27-wood"
    title = "Wood"
    font = "'Zilla Slab',Rockwell,serif"
    pal = {
        "bg": None,
        "tile": "#ead7ae",
        "tile_s": "#b99a66",
        "shade1": "#d9c08a",
        "shade2": "#c4a56e",
        "route": "#a4281f",
        "route2": "#2b4a7a",
        "node": "#d4a017",
        "node_s": "#7a5a14",
        "ink": "#2b1d14",
        "acc": "#2b4a7a",
        "paper": "#f4e6cf",
    }
    gap = 0.6
    radius = 0.9
    pent_w = 1.0

    def dot(self, cx, x, y, which=0):
        stud = super().dot(cx, x, y, which)
        if cx.kind == "two":   # a stud in the colour of its route
            return stud.replace(self.p("node"), self.p("route") if which == 0 else self.p("route2"), 1)
        return stud


@register
class Aurora(Concept):
    """Northern sky: light ribbons, moon, shooting star, constellation, halo."""

    key = "28-aurora"
    title = "Aurora Glass"
    font = "'Plus Jakarta Sans','Segoe UI',sans-serif"
    pal = {"card": "#0b1026"}

    def draw(self, kind, cx):
        grad = linear(cx, [(0, "#1a1f5a"), (0.6, "#0e4a66"), (1, "#3a1f58")], 0, 0, 1, 1)
        stars = "".join(
            circ(x, y, r, fill="#fff", opacity=0.8)
            for x, y, r in ((9, 9, 0.7), (38, 8, 0.6), (40, 38, 0.7), (8, 37, 0.6), (24, 6, 0.5))
        )
        plate = rect(3, 3, 42, 42, 12, fill=grad) + stars
        return plate + getattr(self, kind)(cx)

    def ribbon(self, cx, y0, amp, stops, h=9, x0=6, x1=42):
        top = sine(x0, y0, x1, y0, amp, 1, 20)
        bot = sine(x1, y0 + h, x0, y0 + h, amp, 1, 20, phase=0)
        bot = [(x, y) for x, y in reversed(sine(x0, y0 + h, x1, y0 + h, amp, 1, 20))]
        grad = linear(cx, stops, 0, 0, 1, 0)
        return poly(top + bot, fill=grad, opacity=0.9)

    def glow(self, cx, markup, std=1.6):
        return group(markup, filter=blur(cx, std), opacity=0.8) + markup

    def std(self, cx):
        r = self.ribbon(cx, 20, 6, [(0, "#5cffb0"), (0.6, "#22d3ee"), (1, "#a78bfa")], 10)
        return self.glow(cx, r) + r

    def cut(self, cx):
        moon = path("M32 8A17 17 0 1 0 40 30A14 14 0 1 1 32 8Z", fill="#fff4c9")
        return self.glow(cx, moon, 2) + moon

    def arr(self, cx):
        tail = poly([(6, 38), (28, 20), (26, 24)], fill="#8be9f7", opacity=0.7)
        tail2 = poly([(8, 30), (28, 20), (24, 22)], fill="#ffb1d6", opacity=0.6)
        star = poly(star_pts(33, 17, 7, 3, 5), fill="#fff")
        return tail + tail2 + self.glow(cx, star) + star

    def exact(self, cx):
        pts = [(9, 14), (16, 18), (22, 22), (28, 24), (29, 31), (38, 32), (38, 24)]
        link = line(pts, stroke="#8be9f7", stroke_width=0.9, opacity=0.8)
        dots_ = "".join(circ(x, y, 1.8, fill="#fff") for x, y in pts)
        return link + self.glow(cx, dots_, 1.2) + dots_

    def wrap(self, cx):
        globe = circ(24, 30, 13, fill="#0e2a52", stroke="#8be9f7", stroke_width=0.8)
        r = self.ribbon(cx, 14, 4, [(0, "#a78bfa"), (0.5, "#22d3ee"), (1, "#5cffb0")], 6, 4, 44)
        return globe + self.glow(cx, r) + r

    def loop(self, cx):
        halo = ell(
            24,
            24,
            16,
            9,
            fill="none",
            stroke="#5cffb0",
            stroke_width=3,
            transform="rotate(-20 24 24)",
        )
        return self.glow(cx, halo, 2) + halo + sparkle(38, 12, 3.4, "#fff")

    def tele(self, cx):
        sw = line(
            spiral(24, 24, 1, 15, 2.6), stroke="#c4b5fd", stroke_width=2.4, stroke_linecap="round"
        )
        return self.glow(cx, sw, 2) + sw + circ(24, 24, 2.4, fill="#fff")

    def pent(self, cx):
        pts = pent(24, 25, 15)
        facets = "".join(
            line([(24, 25), p], stroke="#fff", stroke_width=0.6, opacity=0.7) for p in pts
        )
        body = poly(
            pts,
            fill="#a78bfa",
            fill_opacity=0.45,
            stroke="#fff",
            stroke_width=1,
            stroke_linejoin="round",
        )
        return self.glow(cx, body, 2) + body + facets

    def tetra(self, cx):
        return tetra(24, 24, 1.0, "#e0fbff", "#8be9f7", "#5ca8d6", stroke="#fff", sw=0.8)

    def cube(self, cx):
        return iso_cube(24, 25, 15, "#e0fbff", "#9be7f5", "#6fb6d9", stroke="#fff", sw=0.9)

    def ball(self, cx):
        return self.glow(cx, circ(24, 24, 14, fill="#fff4c9"), 2.5) + sphere(
            cx, 24, 24, 14, "#fffbe6", "#d9c98a"
        )
