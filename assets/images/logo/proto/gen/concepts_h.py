"""Icon concepts 52-56: critters with faces, rebus puzzles, pointillism, concept sketches, boho."""

import math
import random

from core import circ, ell, group, line, n, path, poly, rect, register, text
from kit import clip, linear, sparkle
from kit2 import Concept, hatch, iso_cube, pent, sphere, tetra


@register
class Critters(Concept):
    """Everything has a face: worm, cheese, arrow, number, log, ring snake, mole, house, die."""

    key = "52-critters"
    title = "Critters"
    font = "'Sniglet','Comic Sans MS',sans-serif"
    pal = {"card": "#ffeec4"}
    INK, GREEN, GREEN_D, RED = "#3a2a24", "#8cc64f", "#5ea03a", "#ef4d3f"
    YEL, ORG, CREAM, BLUSH, BROWN = "#ffd45e", "#ff9a3c", "#fff7e3", "#ff8f8f", "#a8744a"

    def draw(self, kind, cx):
        plate = rect(3, 3, 42, 42, 12, fill=self.CREAM, stroke="#e7d3a8", stroke_width=1)
        grass = path("M3 37Q14 33 25 36T45 35V45H3Z", fill="#bfe08a")
        ground = group(grass, clip_path=clip(cx, rect(3, 3, 42, 42, 12)))
        return plate + ground + getattr(self, kind)(cx)

    def face(self, x, y, s=1.0, mouth="smile"):
        out = ""
        for dx in (-3.1, 3.1):
            out += ell(
                x + dx * s,
                y,
                1.9 * s,
                2.3 * s,
                fill="#ffffff",
                stroke=self.INK,
                stroke_width=0.7 * s,
            )
            out += circ(x + dx * s + 0.3 * s, y + 0.3 * s, 0.95 * s, fill=self.INK)
        for dx in (-5.3, 5.3):
            out += ell(x + dx * s, y + 3.4 * s, 1.5 * s, 1 * s, fill=self.BLUSH, opacity=0.7)
        x0, x1, y0 = n(x - 2.4 * s), n(x + 2.4 * s), n(y + 3.6 * s)
        if mouth == "open":
            return out + path(f"M{x0} {y0}Q{n(x)} {n(y + 8.6 * s)} {x1} {y0}Z", fill=self.INK)
        curve = f"M{x0} {y0}Q{n(x)} {n(y + 6.6 * s)} {x1} {y0}"
        return out + path(
            curve, fill="none", stroke=self.INK, stroke_width=0.9 * s, stroke_linecap="round"
        )

    def feet(self, *xs, y=40.5):
        return "".join(
            ell(x, y, 3.2, 1.8, fill=self.BROWN, stroke=self.INK, stroke_width=0.9) for x in xs
        )

    def std(self, cx):
        body = "M10 37C22 41 36 33 28 27C22 22 12 24 17 15"
        under = path(body, fill="none", stroke=self.INK, stroke_width=10.6, stroke_linecap="round")
        skin = path(body, fill="none", stroke=self.GREEN, stroke_width=8.2, stroke_linecap="round")
        rings = path(
            body, fill="none", stroke=self.GREEN_D, stroke_width=8.2, stroke_dasharray="1 4.4"
        )
        head = circ(17, 14, 6.6, fill=self.GREEN, stroke=self.INK, stroke_width=1.2)
        feelers = line([(13.5, 9.5), (11, 4.5)], stroke=self.INK, stroke_width=1) + line(
            [(20.5, 9.5), (23, 4.5)], stroke=self.INK, stroke_width=1
        )
        feelers += circ(11, 4, 1.3, fill=self.RED, stroke=self.INK, stroke_width=0.7) + circ(
            23, 4, 1.3, fill=self.RED, stroke=self.INK, stroke_width=0.7
        )
        return under + skin + rings + head + feelers + self.face(17, 14, 0.85)

    def cut(self, cx):
        block = rect(9, 15, 30, 23, 6, fill=self.YEL, stroke=self.INK, stroke_width=1.3)
        holes = (
            ell(31, 20, 2.8, 2.2, fill="#f0b33a")
            + ell(14, 33, 2.4, 1.9, fill="#f0b33a")
            + ell(34.5, 33, 2, 1.6, fill="#f0b33a")
        )
        return block + holes + self.face(22, 24.5, 0.9, "open") + self.feet(16, 32)

    def arr(self, cx):
        body = poly(
            [(8, 17), (26, 17), (26, 9), (41, 24), (26, 39), (26, 31), (8, 31)],
            fill=self.RED,
            stroke=self.INK,
            stroke_width=1.3,
            stroke_linejoin="round",
        )
        legs = line(
            [(13, 31), (13, 37)], stroke=self.INK, stroke_width=1.4, stroke_linecap="round"
        ) + line([(20, 31), (20, 37)], stroke=self.INK, stroke_width=1.4, stroke_linecap="round")
        return legs + self.feet(13, 20, y=38) + body + self.face(16.5, 21.5, 0.78)

    def exact(self, cx):
        body = rect(10, 8, 28, 31, 11, fill=self.YEL, stroke=self.INK, stroke_width=1.3)
        digit = text(24, 31.5, "7", 15, font_weight=800, font_family=self.font, fill=self.INK)
        return self.feet(17, 31) + body + self.face(24, 16.5, 0.85) + digit

    def wrap(self, cx):
        log = rect(8, 20, 32, 14, 3, fill=self.BROWN, stroke=self.INK, stroke_width=1.2) + ell(
            40, 27, 3, 7, fill="#c99467", stroke=self.INK, stroke_width=1.2
        )
        bands = "".join(
            poly(
                [(x, 19), (x + 4.4, 19), (x + 7.4, 35), (x + 3, 35)],
                fill=self.GREEN,
                stroke=self.INK,
                stroke_width=0.9,
                stroke_linejoin="round",
            )
            for x in (14, 21.5, 29)
        )
        tail = path(
            "M33 35Q38 41 43 36",
            fill="none",
            stroke=self.INK,
            stroke_width=5.4,
            stroke_linecap="round",
        ) + path(
            "M33 35Q38 41 43 36",
            fill="none",
            stroke=self.GREEN,
            stroke_width=3.4,
            stroke_linecap="round",
        )
        head = circ(11, 15, 6, fill=self.GREEN, stroke=self.INK, stroke_width=1.2)
        return log + tail + bands + head + self.face(11, 14.5, 0.78)

    def loop(self, cx):
        ring = circ(24, 26, 12, fill="none", stroke=self.INK, stroke_width=10.6) + circ(
            24, 26, 12, fill="none", stroke=self.GREEN, stroke_width=8.2
        )
        ring += circ(
            24, 26, 12, fill="none", stroke=self.GREEN_D, stroke_width=8.2, stroke_dasharray="1 5"
        )
        hx, hy = 24 + 12 * math.cos(math.radians(-50)), 26 + 12 * math.sin(math.radians(-50))
        head = circ(hx, hy, 6.4, fill=self.GREEN, stroke=self.INK, stroke_width=1.2)
        tip = circ(33.5, 20, 2.2, fill=self.GREEN_D, stroke=self.INK, stroke_width=0.8)
        return ring + tip + head + self.face(hx, hy - 0.5, 0.78)

    def tele(self, cx):
        mounds = path("M2 41Q11 22 20 41Z", fill="#8a6a52", stroke=self.INK, stroke_width=1)
        mounds += path("M28 41Q37 30 46 41Z", fill="#8a6a52", stroke=self.INK, stroke_width=1)
        mole = circ(11, 26.5, 7.4, fill="#7d6a62", stroke=self.INK, stroke_width=1.2)
        mole += circ(8.2, 25, 1.4, fill="#ffffff") + circ(13.8, 25, 1.4, fill="#ffffff")
        mole += circ(8.2, 25.2, 0.65, fill=self.INK) + circ(13.8, 25.2, 0.65, fill=self.INK)
        mole += ell(11, 29.2, 2.9, 2, fill="#ff9aa8", stroke=self.INK, stroke_width=0.8)
        mole += ell(5.2, 31, 1.8, 1.2, fill="#ffd9c4", stroke=self.INK, stroke_width=0.7)
        mole += ell(16.8, 31, 1.8, 1.2, fill="#ffd9c4", stroke=self.INK, stroke_width=0.7)
        hole = ell(37, 38.2, 5.4, 1.8, fill=self.INK)
        hand = circ(37, 34.6, 2.4, fill="#7d6a62", stroke=self.INK, stroke_width=0.9)
        hand += line([(35.4, 32.8), (34.8, 31)], stroke=self.INK, stroke_width=0.9)
        hand += line([(38.6, 32.8), (39.2, 31)], stroke=self.INK, stroke_width=0.9)
        burrow = path(
            "M14 43Q25 47 34 43",
            fill="none",
            stroke="#6e5238",
            stroke_width=1.6,
            stroke_dasharray="2 2.2",
            stroke_linecap="round",
        )
        return burrow + mounds + hole + hand + mole

    def pent(self, cx):
        walls = rect(10, 22, 28, 17, 2, fill="#ffe0b8", stroke=self.INK, stroke_width=1.3)
        roof = poly(
            [(6, 24), (24, 8), (42, 24)],
            fill=self.RED,
            stroke=self.INK,
            stroke_width=1.3,
            stroke_linejoin="round",
        )
        chimney = rect(31, 9.5, 4.2, 7, fill="#c94a3c", stroke=self.INK, stroke_width=1)
        eyes = ""
        for x in (17.5, 30.5):
            eyes += circ(x, 28.6, 3.3, fill="#ffffff", stroke=self.INK, stroke_width=0.9) + circ(
                x + 0.4, 28.9, 1.4, fill=self.INK
            )
        door = path("M19.5 34.5Q24 41.5 28.5 34.5Z", fill=self.INK)
        return (
            chimney
            + walls
            + roof
            + eyes
            + door
            + ell(13.5, 33.4, 1.6, 1, fill=self.BLUSH, opacity=0.8)
            + ell(34.5, 33.4, 1.6, 1, fill=self.BLUSH, opacity=0.8)
        )

    def tetra(self, cx):
        body = poly(
            [(24, 8), (42, 38), (6, 38)],
            fill=self.ORG,
            stroke=self.INK,
            stroke_width=1.3,
            stroke_linejoin="round",
        )
        shade = poly([(24, 8), (42, 38), (24, 38)], fill="#e8741a", opacity=0.55)
        return self.feet(15, 33, y=40) + body + shade + self.face(24, 26.5, 0.9, "open")

    def cube(self, cx):
        body = iso_cube(24, 24, 12.5, "#cfe9ff", "#6bb6f0", "#4a8fd0", stroke=self.INK, sw=1.3)
        face = group(self.face(0, 0, 0.72), transform="translate(18.6 27.4) matrix(1 0.5 0 1 0 0)")
        return self.feet(16, 31, y=41) + body + face

    def ball(self, cx):
        body = sphere(cx, 24, 25, 12.5, "#ffd08a", "#ff8a3c", rim=self.INK, spot=False)
        arms = line(
            [(11.5, 26), (6, 30)], stroke=self.INK, stroke_width=1.5, stroke_linecap="round"
        ) + line([(36.5, 26), (42, 30)], stroke=self.INK, stroke_width=1.5, stroke_linecap="round")
        return (
            self.feet(18, 30, y=39.5)
            + arms
            + body
            + self.face(24, 23.5, 0.9)
            + circ(17.5, 17, 2, fill="#ffffff", opacity=0.6)
        )


@register
class Rebus(Concept):
    """Picture-and-letter puzzles: each type name as a rebus, with the answer line left blank."""

    key = "53-rebus"
    title = "Rebus"
    font = "'Bitter','Georgia',serif"
    pal = {"card": "#e9e2cc"}
    PAPER, INK, RED, BLUE, YEL, GREEN = (
        "#f9f4e4",
        "#1a1a1a",
        "#d7263d",
        "#1b6ca8",
        "#ffd166",
        "#2a9d6f",
    )

    def draw(self, kind, cx):
        plate = rect(3, 3, 42, 42, 3, fill=self.PAPER, stroke=self.INK, stroke_width=1.8)
        blank = line(
            [(10, 39), (38, 39)], stroke=self.INK, stroke_width=1.2, stroke_dasharray="3 2.2"
        )
        return plate + blank + getattr(self, kind)(cx)

    def plus(self, x, y, s=3.2):
        return line([(x - s, y), (x + s, y)], stroke=self.INK, stroke_width=1.8) + line(
            [(x, y - s), (x, y + s)], stroke=self.INK, stroke_width=1.8
        )

    def word(self, x, y, label, size=11):
        return text(x, y, label, size, font_weight=800, font_family=self.font, fill=self.INK)

    def stroke(self, markup_d, colour=None, w=1.5, fill="none"):
        return path(
            markup_d,
            fill=fill,
            stroke=colour or self.INK,
            stroke_width=w,
            stroke_linecap="round",
            stroke_linejoin="round",
        )

    def std(self, cx):
        flag = line([(17, 33), (17, 9)], stroke=self.INK, stroke_width=2, stroke_linecap="round")
        flag += poly(
            [(17, 9), (37, 15), (17, 22)],
            fill=self.RED,
            stroke=self.INK,
            stroke_width=1.5,
            stroke_linejoin="round",
        )
        return flag + ell(17, 33.5, 5, 1.6, fill=self.INK)

    def cut(self, cx):
        blades = line(
            [(15, 21), (6, 13.5)], stroke=self.INK, stroke_width=1.8, stroke_linecap="round"
        )
        blades += line(
            [(15, 21), (6, 28.5)], stroke=self.INK, stroke_width=1.8, stroke_linecap="round"
        )
        grips = circ(17.6, 16.8, 2.9, fill="none", stroke=self.RED, stroke_width=1.8)
        grips += circ(17.6, 25.2, 2.9, fill="none", stroke=self.RED, stroke_width=1.8)
        return blades + grips + self.plus(24, 21, 2.4) + self.word(34.5, 21, "OUT", 7.8)

    def arr(self, cx):
        hull = self.stroke("M17 23H31L29 28H19Z", fill=self.YEL, w=1.5)
        oar = self.stroke("M20 16L29 27", w=1.6) + poly(
            [(27.6, 25.6), (31.4, 28.6), (29, 30)], fill=self.BLUE, stroke=self.INK, stroke_width=1
        )
        return (
            self.word(7, 21, "A", 10)
            + self.plus(13, 21, 2)
            + hull
            + oar
            + self.plus(35, 21, 2)
            + self.word(41, 21, "S", 10)
        )

    def exact(self, cx):
        clap = rect(25, 17, 16, 13, 1.2, fill="#ffffff", stroke=self.INK, stroke_width=1.5) + rect(
            25, 11.5, 16, 6, 1, fill=self.INK
        )
        stripes = "".join(
            line([(x, 17.5), (x + 3, 12)], stroke="#ffffff", stroke_width=1.4)
            for x in (28, 33, 38)
        )
        return (
            self.word(11, 22, "X", 17)
            + self.plus(18.6, 22, 2.8)
            + clap
            + stripes
            + line([(28, 23.5), (38, 23.5)], stroke=self.INK, stroke_width=1)
            + line([(28, 26.5), (35, 26.5)], stroke=self.INK, stroke_width=1)
        )

    def wrap(self, cx):
        gift = rect(7, 19, 14, 12, 1, fill=self.RED, stroke=self.INK, stroke_width=1.5) + rect(
            12.8, 19, 2.6, 12, fill=self.YEL
        )
        bow = self.stroke("M14 19C9 12 6 17 14 19C22 17 19 12 14 19", w=1.6, fill=self.YEL)
        ring = circ(35, 22, 7.5, fill="none", stroke=self.BLUE, stroke_width=2.4) + poly(
            [(41.5, 19), (44, 25), (38.5, 24.5)], fill=self.BLUE
        )
        return gift + bow + self.plus(24.5, 24, 2.6) + ring

    def loop(self, cx):
        lasso = ell(24, 19, 10.5, 7.5, fill="none", stroke="#a8744a", stroke_width=3.2)
        tail = self.stroke("M17 25Q14 31 19 34T20 38", colour="#a8744a", w=3.2) + self.stroke(
            "M17 25Q14 31 19 34T20 38", colour=self.INK, w=0.9
        )
        knot = circ(17.5, 24.5, 3, fill="#a8744a", stroke=self.INK, stroke_width=1)
        return lasso + tail + knot

    def tele(self, cx):
        tv = (
            rect(6, 17, 16, 12, 2.5, fill="#cfe9ff", stroke=self.INK, stroke_width=1.6)
            + line([(10, 17), (14, 11)], stroke=self.INK, stroke_width=1.4)
            + line([(18, 17), (14, 11)], stroke=self.INK, stroke_width=1.4)
        )
        anchor = self.stroke(
            "M35 12V30M30.5 17H39.5M28.5 25C29 31 33 32 35 30C37 32 41 31 41.5 25", w=1.9
        )
        anchor += circ(35, 11, 2, fill="none", stroke=self.INK, stroke_width=1.6)
        return tv + self.plus(25.5, 23, 2.4) + anchor

    def pent(self, cx):
        pen = poly(
            [(6, 29), (9, 22), (25, 12), (27, 15), (11, 25)],
            fill=self.BLUE,
            stroke=self.INK,
            stroke_width=1.4,
            stroke_linejoin="round",
        ) + poly([(6, 29), (9, 22), (11, 25)], fill=self.YEL, stroke=self.INK, stroke_width=1.2)
        tag = poly(
            [(29, 15), (40, 15), (43, 19), (43, 29), (29, 29)],
            fill=self.YEL,
            stroke=self.INK,
            stroke_width=1.5,
            stroke_linejoin="round",
        )
        return (
            pen
            + self.plus(27, 22, 2.2)
            + tag
            + circ(33, 19, 1.4, fill=self.PAPER, stroke=self.INK, stroke_width=1)
            + line([(33, 24), (39, 24)], stroke=self.INK, stroke_width=1.2)
        )

    def tetra(self, cx):
        fish = ell(13, 21, 8, 5, fill="#ff8a3c", stroke=self.INK, stroke_width=1.5) + poly(
            [(20, 21), (26.5, 15.5), (26.5, 26.5)],
            fill="#ff8a3c",
            stroke=self.INK,
            stroke_width=1.5,
            stroke_linejoin="round",
        )
        fish += circ(9, 19.8, 1.2, fill=self.INK) + line(
            [(12.5, 17.5), (15, 24.5)], stroke=self.BLUE, stroke_width=2
        )
        return fish + self.plus(31.5, 21, 2.4) + self.word(39, 22, "4", 18)

    def cube(self, cx):
        return self.word(12, 22, "Q", 19) + self.plus(24, 22, 3) + self.word(36, 22, "B", 19)

    def ball(self, cx):
        body = circ(24, 21, 12, fill=self.BLUE, stroke=self.INK, stroke_width=1.6)
        holes = "".join(
            circ(x, y, 1.6, fill=self.INK) for x, y in ((20, 14.5), (25.5, 14), (22.5, 19.5))
        )
        return body + holes + ell(18.5, 25, 2.4, 1.4, fill="#ffffff", opacity=0.55)


def short(v):
    """A number as short as SVG allows: no leading zero, no trailing zeros."""
    text_ = f"{v:g}"
    return text_.replace("0.", ".") if text_.startswith(("0.", "-0.")) else text_


def pair(dx, dy):
    b = short(dy)
    return short(dx) + ("" if b.startswith("-") else " ") + b


def shape_disc(cx, cy, r):
    return lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shape_box(x0, y0, x1, y1):
    return lambda x, y: x0 <= x <= x1 and y0 <= y <= y1


def shape_poly(pts):
    def inside(x, y):
        hit = False
        j = len(pts) - 1
        for i, (xi, yi) in enumerate(pts):
            xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
        return hit

    return inside


def shape_near(pts, width):
    def inside(x, y):
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
            if (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= width * width:
                return True
        return False

    return inside


def ramp(colours, f, density=1.0):
    """A colour per dot from a list, by f(x, y) in 0..1, with noise so the colours mix."""

    def pick(x, y, rng):
        if density < 1 and rng.random() > density * 0.6:
            return None
        t = min(1, max(0, f(x, y))) * (len(colours) - 1) + rng.uniform(-0.55, 0.55)
        return colours[max(0, min(len(colours) - 1, round(t)))]

    return pick


def lit(cx, cy, r):
    """Light on a ball from the top left: 0 (lit) to 1 (shadow)."""

    def f(x, y):
        nx, ny = (x - cx) / r, (y - cy) / r
        nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
        return 1 - max(0.0, nx * -0.5 + ny * -0.6 + nz * 0.62) / 1.0

    return f


@register
class Pointillism(Concept):
    """Dots of pure colour, set side by side: light in warm dots, shade in cool ones."""

    key = "54-pointillism"
    title = "Pointillism"
    font = "'Spectral','Georgia',serif"
    pal = {"card": "#efe6d0"}
    PAPER = "#fbf6ea"
    PALE = ("#f3d9d0", "#d8e6ef", "#f3e8c0", "#e1ecd3")
    SKY = ("#bfdcef", "#9fc6e6", "#d9d3ee")
    GRASS = ("#cfe6a0", "#8cc063", "#5ba04a", "#3f7f4a")
    SUN = ("#fff3b8", "#ffd966", "#ffb347", "#ff8a3c")
    SHADE = ("#c7b6e8", "#8f7fd0", "#4f5fb8", "#2f4a9a")
    RED = ("#ffb09a", "#ef6a4a", "#d8402f", "#9d2a3c")

    def draw(self, kind, cx):
        return self.render(getattr(self, kind)(cx), sum(map(ord, kind)) * 7 + 3)

    def render(self, layers, seed):
        rng = random.Random(seed)
        step, groups = 3.1, {}
        y, row = 5.4, 0
        while y < 43:
            x = 5.4 + (step / 2 if row % 2 else 0)
            while x < 43:
                px, py = (
                    round((x + rng.uniform(-0.4, 0.4)) * 2) / 2,
                    round((y + rng.uniform(-0.4, 0.4)) * 2) / 2,
                )
                colour = None
                for inside, pick in layers:
                    if inside(px, py):
                        colour = pick(px, py, rng)
                if colour is None and rng.random() < 0.1:
                    colour = rng.choice(self.PALE)
                if colour:
                    groups.setdefault(colour, []).append((px, py))
                x += step
            y += step * 0.87
            row += 1
        plate = rect(3, 3, 42, 42, 6, fill=self.PAPER, stroke="#d9cdb4", stroke_width=0.9)
        out = ""
        for colour, pts in groups.items():
            d, px, py = "", 0.0, 0.0
            for i, (x, y) in enumerate(pts):
                d += f"M{short(x)} {short(y)}h0" if i == 0 else "m" + pair(x - px, y - py) + "h0"
                px, py = x, y
            out += path(d, fill="none", stroke=colour, stroke_width=2.6, stroke_linecap="round")
        return plate + out

    def std(self, cx):
        trail = [(8, 38), (20, 33), (13, 26), (30, 20), (24, 12), (38, 9)]
        return [
            (shape_box(0, 0, 48, 24), ramp(self.SKY, lambda x, y: y / 24, 0.55)),
            (shape_box(0, 24, 48, 48), ramp(self.GRASS, lambda x, y: (y - 24) / 24, 0.85)),
            (shape_near(trail, 2.7), ramp(self.SHADE[2:], lambda x, y: 0.4)),
        ]

    def cut(self, cx):
        layers = [
            (
                shape_box(6, 6, 42, 42),
                ramp(self.GRASS, lambda x, y: 0.25 + 0.5 * ((x + y) % 11) / 11, 0.9),
            )
        ]
        for x, y, r in ((16, 17, 6.2), (32, 21, 5.2), (22, 33, 6.2)):
            layers.append(
                (
                    shape_disc(x, y, r),
                    ramp(
                        self.SKY[:2] + self.SHADE[1:2],
                        lambda a, b, y=y, r=r: (b - y + r) / (2 * r),
                    ),
                )
            )
        return layers

    def arr(self, cx):
        pts = [(9, 19), (26, 19), (26, 11), (40, 24), (26, 37), (26, 29), (9, 29)]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SHADE[::-1][:3], lambda x, y: 0.1 + y / 90, 0.6)),
            (shape_poly(pts), ramp(self.RED[:3] + self.SUN[2:], lambda x, y: (x - 9) / 31)),
        ]

    def exact(self, cx):
        seven = [(11, 10), (37, 10), (37, 16), (26, 39), (19, 39), (30, 16), (11, 16)]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SKY, lambda x, y: x / 48, 0.35)),
            (shape_poly(seven), ramp(self.SUN[1:] + self.RED[1:2], lambda x, y: (y - 10) / 29)),
        ]

    def wrap(self, cx):
        band = [(1 + i, 24 + 6 * math.sin(i / 5.0)) for i in range(0, 48, 3)]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SKY, lambda x, y: y / 48, 0.4)),
            (
                shape_near(band, 5.6),
                ramp(self.RED[::-1][:3] + self.SUN[2:], lambda x, y: (x - 2) / 44),
            ),
        ]

    def loop(self, cx):
        def ring(x, y):
            return 8.5 <= math.hypot(x - 24, y - 24) <= 15.5

        return [
            (shape_box(0, 0, 48, 48), ramp(self.GRASS[:2], lambda x, y: y / 48, 0.35)),
            (ring, ramp(self.SHADE, lambda x, y: (x + y - 20) / 40)),
            (shape_disc(24, 24, 6.5), ramp(self.SUN, lambda x, y: (y - 18) / 12)),
        ]

    def tele(self, cx):
        arc = [(14 + 20 * t / 8, 30 - 22 * math.sin(math.pi * t / 8) * 0.8) for t in range(9)]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SKY, lambda x, y: y / 48, 0.4)),
            (shape_near(arc, 1.6), ramp(self.SUN[1:], lambda x, y: 0.5)),
            (shape_disc(14, 33, 7.2), ramp(self.SHADE[::-1], lambda x, y: (y - 26) / 14)),
            (shape_disc(35, 33, 7.2), ramp(self.RED[::-1], lambda x, y: (y - 26) / 14)),
        ]

    def pent(self, cx):
        pts = [
            (
                24 + 16 * math.cos(math.radians(-90 + 72 * k)),
                25 + 16 * math.sin(math.radians(-90 + 72 * k)),
            )
            for k in range(5)
        ]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SKY[:2], lambda x, y: x / 48, 0.35)),
            (shape_poly(pts), ramp(self.RED[::-1], lambda x, y: math.hypot(x - 24, y - 25) / 16)),
            (shape_disc(24, 25, 4.5), ramp(self.SUN, lambda x, y: 0.2)),
        ]

    def tetra(self, cx):
        left, right = [(24, 8), (6, 37), (26, 34)], [(24, 8), (42, 37), (26, 34)]
        base = [(6, 37), (26, 34), (42, 37), (24, 43)]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SKY, lambda x, y: y / 48, 0.35)),
            (shape_poly(base), ramp(self.SHADE[1:], lambda x, y: 0.5)),
            (shape_poly(left), ramp(self.SUN, lambda x, y: (y - 8) / 28)),
            (shape_poly(right), ramp(self.SHADE, lambda x, y: (y - 8) / 28)),
        ]

    def cube(self, cx):
        top = [(24, 8), (38, 16), (24, 24), (10, 16)]
        left = [(10, 16), (24, 24), (24, 40), (10, 32)]
        right = [(24, 24), (38, 16), (38, 32), (24, 40)]
        return [
            (shape_box(0, 0, 48, 48), ramp(self.SKY[:2], lambda x, y: y / 48, 0.35)),
            (shape_poly(top), ramp(self.SUN[:3], lambda x, y: (y - 8) / 16)),
            (shape_poly(left), ramp(self.RED[1:], lambda x, y: (y - 16) / 24)),
            (shape_poly(right), ramp(self.SHADE, lambda x, y: (y - 16) / 24)),
        ]

    def ball(self, cx):
        def shadow(x, y):
            return ((x - 27) / 14) ** 2 + ((y - 39.5) / 3.2) ** 2 <= 1

        return [
            (shape_box(0, 0, 48, 48), ramp(self.GRASS[:3], lambda x, y: y / 60, 0.3)),
            (shadow, ramp(self.SHADE[1:], lambda x, y: 0.4)),
            (
                shape_disc(23, 22, 13.5),
                ramp(self.SUN[:2] + self.RED[1:3] + self.SHADE[1:], lit(23, 22, 13.5)),
            ),
        ]


@register
class Sketch(Concept):
    """Concept sketches on tracing paper: pencil lines, hatching, one red marker for the route."""

    key = "55-sketch"
    title = "Concept Sketch"
    font = "'Architects Daughter','Comic Sans MS',cursive"
    pal = {"card": "#e4e2d8"}
    VELLUM, PENCIL, GREY1, GREY2 = "#f4f2e8", "#34343a", "#d7d6d0", "#a3a3a0"
    MARK, BLUE = "#ff5a36", "#2a9fd0"

    def draw(self, kind, cx):
        self.rng = random.Random(sum(map(ord, kind)) * 11 + 5)
        plate = rect(3, 3, 42, 42, 2, fill=self.VELLUM, stroke=self.GREY2, stroke_width=0.8)
        tape = poly([(2, 8), (9, 2), (13, 5), (5, 11)], fill="#e8dfae", opacity=0.85) + poly(
            [(46, 40), (39, 46), (35, 43), (43, 37)], fill="#e8dfae", opacity=0.85
        )
        return plate + getattr(self, kind)(cx) + tape

    def pencil(self, pts, closed=False, over=1.1, amp=0.4, w=0.9, colour=None, opacity=0.95):
        segs = list(zip(pts, pts[1:] + (pts[:1] if closed else [])))
        d = ""
        for (ax, ay), (bx, by) in segs:
            size = math.hypot(bx - ax, by - ay) or 1
            ux, uy = (bx - ax) / size, (by - ay) / size
            j = self.rng.uniform(-amp, amp)
            mx, my = (ax + bx) / 2 - uy * j, (ay + by) / 2 + ux * j
            d += f"M{n(ax - ux * over)} {n(ay - uy * over)}"
            d += f"Q{n(mx)} {n(my)} {n(bx + ux * over)} {n(by + uy * over)}"
        return path(
            d,
            fill="none",
            stroke=colour or self.PENCIL,
            stroke_width=w,
            stroke_linecap="round",
            opacity=opacity,
        )

    def marker(self, d, colour=None, w=2.2):
        colour = colour or self.MARK
        return path(
            d,
            fill="none",
            stroke=colour,
            stroke_width=w,
            stroke_linecap="round",
            stroke_linejoin="round",
            opacity=0.92,
        )

    def bubble(self, x, y, label, r=4.6):
        return circ(x, y, r, fill=self.VELLUM, stroke=self.MARK, stroke_width=1.6) + text(
            x, y + 0.2, label, 6.4, font_family=self.font, fill=self.PENCIL
        )

    def std(self, cx):
        plan = (
            self.pencil([(8, 10), (40, 10), (40, 38), (8, 38)], closed=True, w=1.1)
            + self.pencil([(8, 24), (24, 24)])
            + self.pencil([(24, 10), (24, 24)])
            + self.pencil([(30, 38), (30, 26), (40, 26)])
        )
        route = self.marker("M13 30C20 32 20 17 29 18C35 19 33 31 36 33")
        return plan + route + self.bubble(13, 30, "1") + self.bubble(36, 33, "2")

    def cut(self, cx):
        box = self.pencil([(9, 9), (39, 9), (39, 39), (9, 39)], closed=True, w=1.1) + self.pencil(
            [(17, 17), (31, 17), (31, 31), (17, 31)], closed=True, w=1
        )
        void = self.pencil([(17, 17), (31, 31)], w=1) + self.pencil([(31, 17), (17, 31)], w=1)
        fill = poly([(17, 17), (31, 17), (31, 31), (17, 31)], fill=self.MARK, opacity=0.18)
        return (
            box + fill + void + text(35, 13.5, "void", 4.6, font_family=self.font, fill=self.MARK)
        )

    def arr(self, cx):
        outline = self.pencil(
            [(7, 12), (41, 12), (41, 36), (7, 36)], closed=True, w=0.9, opacity=0.6
        )
        flow = ""
        for y in (17.5, 24, 30.5):
            flow += self.marker(f"M10 {y}H33") + poly(
                [(33, y - 3), (39, y), (33, y + 3)], fill=self.MARK
            )
        return outline + flow

    def exact(self, cx):
        callout = circ(17, 21, 8.6, fill=self.MARK, opacity=0.2) + circ(
            17, 21, 8.6, fill="none", stroke=self.MARK, stroke_width=1.8
        )
        lead = self.pencil([(24, 25), (33, 33)]) + self.pencil(
            [(30, 31), (41, 31), (41, 40), (27, 40)], w=0.8
        )
        return (
            callout
            + text(17, 21.4, "7", 13, font_family=self.font, fill=self.PENCIL)
            + lead
            + self.pencil([(30, 35), (38, 35)], w=0.7, opacity=0.6)
        )

    def wrap(self, cx):
        drum = (
            ell(24, 14, 13, 4.6, fill="none", stroke=self.PENCIL, stroke_width=1)
            + path("M11 14V34", fill="none", stroke=self.PENCIL, stroke_width=1)
            + path("M37 14V34", fill="none", stroke=self.PENCIL, stroke_width=1)
        )
        drum += path("M11 34A13 4.6 0 0 0 37 34", fill="none", stroke=self.PENCIL, stroke_width=1)
        band = self.marker("M11 21C18 28 30 22 37 29", w=2.6) + self.marker(
            "M11 28C18 35 30 29 37 36", w=2.6
        )
        return drum + band + self.pencil([(11, 40.5), (37, 40.5)], w=0.7, opacity=0.7)

    def loop(self, cx):
        rings = ""
        for r, dx in ((15, 0), (15.6, 0.5), (8.5, 0)):
            rings += ell(
                24 + dx,
                25,
                r,
                r * 0.92,
                fill="none",
                stroke=self.PENCIL,
                stroke_width=0.9,
                opacity=0.85,
            )
        ring = self.marker("M24 11.5A12 11 0 1 1 23.9 11.5", w=2.4)
        return rings + ring + poly([(24, 8), (30, 11.5), (24, 15)], fill=self.MARK)

    def tele(self, cx):
        floors = self.pencil([(6, 17), (42, 17)], w=1.4) + self.pencil([(6, 36), (42, 36)], w=1.4)
        floors += poly([(6, 17), (42, 17), (42, 19), (6, 19)], fill=self.GREY1) + poly(
            [(6, 36), (42, 36), (42, 38), (6, 38)], fill=self.GREY1
        )
        shaft = self.pencil([(20, 17), (20, 38), (30, 38), (30, 17)], w=0.9)
        car = rect(
            22, 27, 6, 7, 0.6, fill=self.MARK, opacity=0.35, stroke=self.MARK, stroke_width=1.3
        )
        return (
            floors
            + shaft
            + car
            + self.marker("M25 25V20", w=2)
            + poly([(22, 21), (25, 15.5), (28, 21)], fill=self.MARK)
        )

    def pent(self, cx):
        pts = pent(24, 25, 15)
        walls = poly(pts, fill=hatch(cx, self.PENCIL, 2.4, 0.7, 45), opacity=0.55)
        inner = pent(24, 25, 11.2)
        return (
            walls
            + self.pencil(pts, closed=True, w=1.1)
            + self.pencil(inner, closed=True, w=0.9)
            + circ(24, 25, 1.4, fill=self.MARK)
            + self.pencil([(6, 42), (42, 42)], w=0.7, opacity=0.7)
        )

    def tetra(self, cx):
        a, b, c, d = (24, 8), (8, 33), (24, 40), (40, 30)
        shade = poly([a, c, d], fill=hatch(cx, self.PENCIL, 2, 0.7, 60), opacity=0.5)
        return (
            shade
            + self.pencil([a, b, c, a, d, c], w=1.1)
            + self.pencil([b, d], w=0.7, colour=self.GREY2)
            + self.pencil([(24, 8), (24, 46)], w=0.6, colour=self.GREY2, opacity=0.8)
        )

    def cube(self, cx):
        top, ul, ur, c, ll, lr, b = (
            (24, 7),
            (10, 15),
            (38, 15),
            (24, 23),
            (10, 31),
            (38, 31),
            (24, 39),
        )
        shade = poly([ur, c, b, lr], fill=hatch(cx, self.PENCIL, 2.2, 0.8, 90), opacity=0.55)
        faces = (
            self.pencil([top, ur, lr, b, ll, ul, top], w=1.1)
            + self.pencil([ul, c, ur], w=1.1)
            + self.pencil([c, b], w=1.1)
        )
        construct = self.pencil(
            [(2, 11), (10, 15)], w=0.6, colour=self.GREY2, over=3
        ) + self.pencil([(46, 11), (38, 15)], w=0.6, colour=self.GREY2, over=3)
        return shade + faces + construct + self.marker("M10 15L24 7L38 15", w=1.6)

    def ball(self, cx):
        r = 14
        arcs = ""
        for dy in (-8, -3.5, 1, 5.5, 9.5):
            w = math.sqrt(max(1, r * r - dy * dy))
            arcs += path(
                f"M{n(24 - w)} {n(23 + dy)}Q24 {n(23 + dy + 4)} {n(24 + w)} {n(23 + dy)}",
                fill="none",
                stroke=self.PENCIL,
                stroke_width=0.6,
                opacity=0.5,
            )
        shade = path("M32 11A14 14 0 0 1 24 37A13 13 0 0 0 32 11Z", fill=self.PENCIL, opacity=0.35)
        shadow = ell(27, 40, 12, 2.2, fill=hatch(cx, self.PENCIL, 1.8, 0.7, 20), opacity=0.7)
        return (
            shadow
            + ell(24, 23, 14, 14, fill="none", stroke=self.PENCIL, stroke_width=1.1)
            + arcs
            + shade
            + self.marker("M13 18C16 12 21 10 26 10", w=1.8)
        )


@register
class Boho(Concept):
    """Bohemian: mandala, doily, feather, bead, yarn, flower crown, flying carpet, crystal."""

    key = "56-boho"
    title = "Bohemian"
    font = "'Lora','Georgia',serif"
    pal = {"card": "#ead7bd"}
    CREAM, SAND, TERRA, MUST = "#f8eddc", "#e6cfa8", "#c8674a", "#d9a441"
    SAGE, ROSE, TEAL, PLUM, BROWN = "#8aa07a", "#d99a9a", "#3f7f7a", "#6b3f5a", "#7a5238"

    def draw(self, kind, cx):
        plate = rect(3, 3, 42, 42, 11, fill=self.CREAM, stroke=self.SAND, stroke_width=1.2)
        edge = rect(
            5.6,
            5.6,
            36.8,
            36.8,
            8.5,
            fill="none",
            stroke=self.SAND,
            stroke_width=0.7,
            stroke_dasharray="0.1 2.2",
            stroke_linecap="round",
        )
        return plate + edge + getattr(self, kind)(cx)

    def std(self, cx):
        out = circ(24, 24, 17, fill=self.SAND) + circ(
            24,
            24,
            19,
            fill="none",
            stroke=self.BROWN,
            stroke_width=1.3,
            stroke_dasharray="0.1 3",
            stroke_linecap="round",
        )
        for k in range(12):
            a = 30 * k
            x, y = 24 + 11 * math.cos(math.radians(a)), 24 + 11 * math.sin(math.radians(a))
            out += ell(
                x,
                y,
                2.8,
                6.2,
                fill=self.TERRA if k % 2 else self.MUST,
                transform=f"rotate({a + 90} {n(x)} {n(y)})",
            )
        for k in range(8):
            a = 45 * k + 22
            x, y = 24 + 6.2 * math.cos(math.radians(a)), 24 + 6.2 * math.sin(math.radians(a))
            out += ell(
                x,
                y,
                1.9,
                3.8,
                fill=self.ROSE if k % 2 else self.TEAL,
                transform=f"rotate({a + 90} {n(x)} {n(y)})",
            )
        return out + circ(24, 24, 3.2, fill=self.PLUM) + circ(24, 24, 1.2, fill=self.CREAM)

    def cut(self, cx):
        out = ""
        for k in range(16):
            a = 22.5 * k
            out += circ(
                24 + 16.5 * math.cos(math.radians(a)),
                24 + 16.5 * math.sin(math.radians(a)),
                2.5,
                fill="#fffaf0",
            )
        out += circ(24, 24, 16.5, fill="#fffaf0", stroke=self.SAND, stroke_width=0.8)
        for k in range(8):
            a = 45 * k
            out += circ(
                24 + 10.5 * math.cos(math.radians(a)),
                24 + 10.5 * math.sin(math.radians(a)),
                2.7,
                fill=self.CREAM,
                stroke=self.SAND,
                stroke_width=0.8,
            )
        out += circ(24, 24, 5.2, fill="none", stroke=self.TERRA, stroke_width=1.7) + circ(
            24, 24, 2.2, fill=self.CREAM, stroke=self.SAND, stroke_width=0.8
        )
        out += circ(
            24,
            24,
            7.6,
            fill="none",
            stroke=self.TERRA,
            stroke_width=0.7,
            stroke_dasharray="0.1 2.4",
            stroke_linecap="round",
        )
        return out

    def arr(self, cx):
        grad = linear(cx, [(0, "#e8a9a0"), (0.55, "#d99a9a"), (1, "#3f7f7a")], 0, 1, 1, 0)
        vane = path("M10 39C7 23 18 10 38 8C39 25 29 37 10 39Z", fill=grad)
        out = vane
        for t in (0.15, 0.3, 0.45, 0.6, 0.75):
            x, y = 10 + 28 * t, 39 - 31 * t
            out += line(
                [(x, y), (x + 3.6, y + 4.4)], stroke="#ffffff", stroke_width=0.8, opacity=0.6
            ) + line([(x, y), (x - 4.4, y - 3)], stroke="#ffffff", stroke_width=0.8, opacity=0.5)
        return (
            out
            + line(
                [(8, 42), (36, 11)], stroke=self.BROWN, stroke_width=1.4, stroke_linecap="round"
            )
            + circ(9.5, 41, 1.6, fill=self.MUST)
        )

    def exact(self, cx):
        cord = path(
            "M16 12C18 3 30 3 32 12",
            fill="none",
            stroke=self.TERRA,
            stroke_width=1.5,
            stroke_linecap="round",
        )
        wood = linear(cx, [(0, "#c2916a"), (1, "#7a5238")], 0.1, 0, 0.9, 1)
        bead = circ(24, 22, 11.5, fill=wood, stroke=self.BROWN, stroke_width=0.9) + circ(
            24, 22, 8.8, fill="none", stroke="#e6c9a3", stroke_width=0.6, opacity=0.8
        )
        tassel = "".join(
            line(
                [(24, 34), (24 + dx, 43)],
                stroke=self.TERRA if k % 2 else self.MUST,
                stroke_width=1.4,
                stroke_linecap="round",
            )
            for k, dx in enumerate((-6, -3, 0, 3, 6))
        )
        return (
            cord
            + tassel
            + bead
            + text(24, 22.4, "7", 13, font_weight=700, font_family=self.font, fill="#f8eddc")
        )

    def wrap(self, cx):
        branch = line(
            [(4, 28), (44, 22)], stroke=self.BROWN, stroke_width=3.4, stroke_linecap="round"
        )
        out = ""
        colours = (self.ROSE, self.TEAL, self.MUST, self.ROSE, self.TEAL, self.MUST)
        for k, colour in enumerate(colours):
            x = 12 + 4.6 * k
            y = 27.2 - 0.9 * k
            out += poly(
                [(x, y - 5.4), (x + 3.4, y - 5.4), (x + 1.4, y + 5.8), (x - 2, y + 5.8)],
                fill=colour,
            )
        fringe = "".join(
            line(
                [(41, 22.6), (40.4 + k * 1.8, 38 + k * 0.6)],
                stroke=self.TERRA,
                stroke_width=1.3,
                stroke_linecap="round",
            )
            for k in range(4)
        )
        return branch + out + fringe

    def loop(self, cx):
        out = circ(24, 24, 14, fill="none", stroke=self.SAGE, stroke_width=1.8)
        colours = (self.ROSE, self.MUST, self.TERRA, self.CREAM)
        for k in range(8):
            a = 45 * k
            x, y = 24 + 14 * math.cos(math.radians(a)), 24 + 14 * math.sin(math.radians(a))
            lx, ly = 24 + 14 * math.cos(math.radians(a + 22.5)), 24 + 14 * math.sin(
                math.radians(a + 22.5)
            )
            out += ell(
                lx,
                ly,
                3.4,
                1.5,
                fill=self.SAGE,
                transform=f"rotate({n(a + 22.5 + 90)} {n(lx)} {n(ly)})",
            )
            out += circ(
                x, y, 3.7, fill=colours[k % 4], stroke=self.BROWN, stroke_width=0.6
            ) + circ(x, y, 1.2, fill=self.MUST if k % 4 == 3 else self.PLUM)
        return out

    def tele(self, cx):
        body = rect(9, 17, 30, 15, 1.5, fill=self.TERRA, stroke=self.PLUM, stroke_width=1) + rect(
            11.5, 19.5, 25, 10, 0.8, fill="none", stroke=self.CREAM, stroke_width=0.8
        )
        zig = line(
            [(12, 24.5), (16, 21), (20, 28), (24, 21), (28, 28), (32, 21), (36, 24.5)],
            stroke=self.MUST,
            stroke_width=1.5,
            stroke_linejoin="miter",
        )
        fringe = "".join(
            line([(x, 32), (x, 36)], stroke=self.MUST, stroke_width=1, stroke_linecap="round")
            + line([(x, 17), (x, 13.6)], stroke=self.MUST, stroke_width=1, stroke_linecap="round")
            for x in (11, 15, 19, 23, 27, 31, 35, 38)
        )
        flying = group(body + zig + fringe, transform="rotate(-12 24 24)")
        dashes = line(
            [(5, 38), (14, 40)], stroke=self.SAGE, stroke_width=1.4, stroke_linecap="round"
        ) + line([(34, 41), (43, 39)], stroke=self.SAGE, stroke_width=1.4, stroke_linecap="round")
        return flying + dashes + sparkle(38, 10, 3.6, self.MUST)

    def pent(self, cx):
        pts = pent(24, 25, 16)
        gem = poly(
            pts,
            fill=linear(cx, [(0, "#8fc4bd"), (0.5, "#3f7f7a"), (1, "#d99a9a")], 0, 0, 1, 1),
            stroke=self.PLUM,
            stroke_width=0.9,
            stroke_linejoin="round",
        )
        inner = pent(24, 25, 8)
        facets = "".join(
            line([a, b], stroke="#ffffff", stroke_width=0.8, opacity=0.65)
            for a, b in zip(pts, inner)
        ) + poly(inner, fill="#ffffff", opacity=0.22, stroke="#ffffff", stroke_width=0.8)
        return gem + facets + sparkle(33, 14, 3.2, "#ffffff")

    def tetra(self, cx):
        tent = tetra(24, 26, 0.86, "#f6dcb8", self.TERRA, "#a8452c", stroke=self.PLUM, sw=0.7)
        door = poly([(24, 24), (20, 40), (28, 40)], fill=self.PLUM, opacity=0.85)
        pole = line([(24, 9), (24, 4.5)], stroke=self.BROWN, stroke_width=1.2) + poly(
            [(24, 4.5), (31, 6.5), (24, 8.5)], fill=self.MUST
        )
        bunting = path("M11 24Q24 31 37 24", fill="none", stroke=self.BROWN, stroke_width=0.8)
        for k, colour in enumerate((self.MUST, self.TEAL, self.ROSE, self.MUST)):
            x = 14 + 6.6 * k
            bunting += poly(
                [
                    (x - 1.9, 25.4 + 1.2 * math.sin(k * 0.9)),
                    (x + 1.9, 25.4 + 1.2 * math.sin(k * 0.9)),
                    (x, 29.6),
                ],
                fill=colour,
            )
        return tent + door + pole + bunting

    def cube(self, cx):
        body = iso_cube(24, 24, 12.5, self.MUST, self.TERRA, "#a8452c", stroke=self.PLUM, sw=0.8)
        weave_l = poly(
            [(13.2, 18), (24, 24), (24, 36.5), (13.2, 30.5)],
            fill=hatch(cx, "#f6dcb8", 2.6, 0.7, 0),
            opacity=0.55,
        )
        weave_r = poly(
            [(24, 24), (34.8, 18), (34.8, 30.5), (24, 36.5)],
            fill=hatch(cx, "#f6dcb8", 2.6, 0.7, 90),
            opacity=0.45,
        )
        button = circ(24, 17.8, 1.6, fill=self.PLUM) + ell(
            24, 17.8, 5, 2.6, fill="none", stroke=self.PLUM, stroke_width=0.7
        )
        tassel = line(
            [(34, 31), (36, 38)], stroke=self.ROSE, stroke_width=1.6, stroke_linecap="round"
        ) + line(
            [(36.4, 30), (39.4, 37)], stroke=self.TEAL, stroke_width=1.6, stroke_linecap="round"
        )
        return body + weave_l + weave_r + button + tassel

    def ball(self, cx):
        body = sphere(cx, 24, 24, 13.5, "#f5c5c5", "#c47b7b", rim="#a85f5f", spot=False)
        area = clip(cx, circ(24, 24, 13.5))
        strands = "".join(
            path(d, fill="none", stroke="#ffffff", stroke_width=0.9, opacity=0.5)
            for d in (
                "M9 20Q24 32 40 18",
                "M10 28Q24 40 38 27",
                "M14 12Q30 22 42 30",
                "M8 24Q22 14 36 11",
                "M16 36Q28 22 40 14",
            )
        )
        thread = path(
            "M33 34C42 33 44 40 36 41S26 43 22 42",
            fill="none",
            stroke="#d99a9a",
            stroke_width=1.6,
            stroke_linecap="round",
        )
        return (
            body
            + group(strands, clip_path=area)
            + thread
            + circ(18.5, 17.5, 2.2, fill="#ffffff", opacity=0.45)
        )
