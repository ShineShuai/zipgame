"""Icon concepts 49-51: alpine slalom, Roman floor mosaic, magma and basalt."""

import math

from core import circ, ell, group, line, n, path, poly, rect, register, text
from kit import blur, clip, linear, sparkle
from kit2 import Concept, iso_cube, pent, sphere, tetra


@register
class Slalom(Concept):
    """Race day on a piste: gates, ski tracks, bib, goggles, gondola, rink, chalet, ice cube."""

    key = "49-slalom"
    title = "Slalom"
    font = "'Oswald','Arial Narrow',sans-serif"
    pal = {"card": "#e3edf7"}
    SNOW, MIST, ICE, ICE_D = "#ffffff", "#eaf3fb", "#bcd9f0", "#7fb0d9"
    NAVY, NAVY2, BLUE, RED, ORANGE = "#12315a", "#1d4a82", "#1f6fd1", "#e63b2e", "#ff8a1f"
    TRACK = "#5b94c9"

    def draw(self, kind, cx):
        sky = linear(cx, [(0, "#ffffff"), (1, "#d7e8f7")], 0, 0, 0, 1)
        plate = rect(3, 3, 42, 42, 9, fill=sky, stroke=self.ICE, stroke_width=0.9)
        return plate + getattr(self, kind)(cx)

    def inside(self, cx, markup):
        return group(markup, clip_path=clip(cx, rect(3, 3, 42, 42, 9)))

    def gate(self, x, top, bottom, colour, flip=1):
        pole = line(
            [(x, top), (x, bottom)], stroke=self.NAVY, stroke_width=1.3, stroke_linecap="round"
        )
        flag = poly([(x, top), (x + 7 * flip, top + 2.6), (x, top + 5.2)], fill=colour)
        return pole + flag

    def tracks(self, d, width=0.9, gap=1.1):
        out = ""
        for dx in (-gap, gap):
            out += path(
                d,
                fill="none",
                stroke=self.TRACK,
                stroke_width=width,
                stroke_linecap="round",
                transform=f"translate({n(dx)} 0)",
            )
        return out

    def std(self, cx):
        slope = path("M3 37C14 31 30 38 45 29V45H3Z", fill=self.MIST)
        run = "M10 41C25 39 29 31 23 26C17 21 22 15 36 9.5"
        gates = self.gate(14, 22, 33, self.RED) + self.gate(32, 15, 26, self.BLUE, -1)
        return self.inside(cx, slope) + self.tracks(run) + gates

    def cut(self, cx):
        sheet = rect(
            7,
            8,
            34,
            32,
            6,
            fill=linear(cx, [(0, "#eef7fe"), (1, "#c7e1f5")]),
            stroke=self.ICE_D,
            stroke_width=0.8,
        )
        holes = ""
        for x, y in ((17, 18), (31, 18), (17, 30), (31, 30)):
            holes += ell(x, y + 0.7, 5.6, 3.8, fill="#ffffff") + ell(
                x, y, 5.1, 3.4, fill="#0f3a68"
            )
            holes += ell(x + 0.5, y + 0.4, 3.3, 1.9, fill="#1f62a8")
        cracks = path(
            "M8 26L14 24L18 25M30 24L36 25L40 22M22 38L24 33",
            fill="none",
            stroke="#ffffff",
            stroke_width=0.8,
            stroke_linecap="round",
        )
        return sheet + holes + cracks

    def arr(self, cx):
        pole = rect(23, 28, 2.4, 13, fill=self.NAVY)
        board = rect(10, 8, 28, 22, 4, fill=self.BLUE, stroke=self.NAVY, stroke_width=1.2)
        inner = rect(12.5, 10.5, 23, 17, 2.5, fill="none", stroke="#ffffff", stroke_width=0.9)
        chevrons = "".join(
            line(
                [(17, y), (24, y + 6), (31, y)],
                stroke="#ffffff",
                stroke_width=2.4,
                stroke_linecap="round",
                stroke_linejoin="round",
            )
            for y in (12.5, 18)
        )
        return ell(24, 41.5, 13, 2.4, fill="#d3e5f5") + pole + board + inner + chevrons

    def exact(self, cx):
        strings = path("M15 11V6.5M33 11V6.5", fill="none", stroke=self.NAVY, stroke_width=1.1)
        bib = rect(9, 10, 30, 29, 3, fill=self.ORANGE, stroke="#c55f0a", stroke_width=0.8)
        pins = "".join(
            circ(x, y, 1.1, fill="#ffffff")
            for x, y in ((12.5, 13.5), (35.5, 13.5), (12.5, 35.5), (35.5, 35.5))
        )
        digit = text(24, 25, "7", 21, font_weight=700, font_family=self.font, fill=self.NAVY)
        return strings + bib + pins + digit

    def wrap(self, cx):
        strap = rect(3, 21, 42, 7, fill=self.NAVY2) + line(
            [(3, 24.5), (45, 24.5)], stroke="#ffffff", stroke_width=0.8, stroke_dasharray="3 2"
        )
        lens = rect(
            9,
            14,
            30,
            20,
            9,
            fill=linear(cx, [(0, "#ffd27a"), (1, "#ff5a3a")], 0, 0, 1, 1),
            stroke=self.NAVY,
            stroke_width=2.2,
        )
        shine = path(
            "M13 22C14 18 18 16.5 22 16.5",
            fill="none",
            stroke="#ffffff",
            stroke_width=1.6,
            stroke_linecap="round",
            opacity=0.8,
        )
        return strap + lens + shine

    def loop(self, cx):
        outer = rect(6, 11, 36, 26, 13, fill=self.ICE, stroke=self.NAVY, stroke_width=2.2)
        lane = rect(
            10,
            15,
            28,
            18,
            9,
            fill="none",
            stroke="#ffffff",
            stroke_width=1,
            stroke_dasharray="2.2 1.6",
        )
        infield = rect(15, 19, 18, 10, 5, fill=self.SNOW, stroke=self.NAVY, stroke_width=1.4)
        skater = circ(24, 13, 2.5, fill=self.RED, stroke=self.NAVY, stroke_width=0.8)
        return outer + lane + infield + skater

    def tele(self, cx):
        pylons = poly([(5, 41), (9, 21), (13, 41)], fill=self.NAVY) + poly(
            [(35, 41), (39, 11), (43, 41)], fill=self.NAVY
        )
        cable = path("M9 21Q24 21 39 11", fill="none", stroke=self.NAVY, stroke_width=1.2)
        hanger = line([(24, 18), (24, 23)], stroke=self.NAVY, stroke_width=1)
        cabin = rect(19, 23, 10, 8, 2.2, fill=self.RED, stroke=self.NAVY, stroke_width=0.9) + rect(
            21, 25, 6, 3, 1, fill="#ffffff"
        )
        return ell(24, 42, 20, 2, fill="#d3e5f5") + pylons + cable + hanger + cabin

    def pent(self, cx):
        wall = rect(10, 23, 28, 16, fill="#e9c999", stroke="#a9763f", stroke_width=0.8)
        roof = poly(
            [(5, 25), (24, 7), (43, 25)],
            fill=self.RED,
            stroke="#a8261b",
            stroke_width=0.8,
            stroke_linejoin="round",
        )
        cap = poly(
            [(24, 7), (32.5, 15.2), (28.8, 15.2), (24, 11.4), (19.2, 15.2), (15.5, 15.2)],
            fill=self.SNOW,
        )
        door = rect(21, 29, 6, 10, 1, fill=self.NAVY)
        windows = rect(12.5, 27, 5.5, 5.5, fill="#ffd27a") + rect(30, 27, 5.5, 5.5, fill="#ffd27a")
        return wall + roof + cap + door + windows

    def tetra(self, cx):
        peak = tetra(24, 24.5, 0.88, "#ffffff", "#8dbbe2", "#3f74ad", stroke="#2b5d96", sw=0.5)
        return ell(24, 40.5, 15, 2, fill="#cfe2f3") + peak

    def cube(self, cx):
        body = iso_cube(24, 24.5, 12.5, "#eaf6ff", "#a8d2f0", "#78b3e0", stroke="#5b94c9", sw=0.6)
        glint = line(
            [(15.5, 20), (15.5, 29)],
            stroke="#ffffff",
            stroke_width=1.2,
            stroke_linecap="round",
            opacity=0.8,
        )
        return ell(24, 42, 14, 2, fill="#cfe2f3") + body + glint + sparkle(32, 14, 3.6, "#ffffff")

    def ball(self, cx):
        shadow = ell(24, 40.5, 13, 2.4, fill="#cfe2f3")
        ball = sphere(cx, 24, 25, 14, "#ffffff", "#9cc3e6", rim="#8fb6da")
        specks = "".join(
            circ(x, y, 0.8, fill="#8fb6da", opacity=0.7)
            for x, y in ((18, 30), (27, 33), (31, 26), (22, 36), (14, 26), (33, 33))
        )
        return shadow + ball + specks + sparkle(35.5, 12, 3.2, "#ffffff")


@register
class Mosaic(Concept):
    """Roman floor mosaic: meander, lost tesserae, numerals, wreath, dolphin, rosette, blocks."""

    key = "50-mosaic"
    title = "Roman Mosaic"
    font = "'Philosopher','Trebuchet MS',sans-serif"
    pal = {"card": "#b5532e"}
    TERRA, TERRA_D, OCHRE, CREAM = "#c0603a", "#8f3f22", "#dba43d", "#f1e6cc"
    INDIGO, SAGE, BLACK = "#23396b", "#6f8a5a", "#1d1a17"

    def draw(self, kind, cx):
        ident = cx.new_id("m")
        cx.add(
            f'<pattern id="{ident}" width="3.2" height="3.2" patternUnits="userSpaceOnUse">'
            '<path d="M0 0H3.2M0 0V3.2" fill="none" stroke="#4a3a22" stroke-width="0.5"'
            ' stroke-opacity="0.38"/></pattern>'
        )
        plate = rect(3, 3, 42, 42, 2.5, fill=self.CREAM, stroke="#8a7650", stroke_width=1)
        grout = rect(3, 3, 42, 42, 2.5, fill=f"url(#{ident})")
        return plate + getattr(self, kind)(cx) + grout

    def inside(self, cx, markup):
        return group(markup, clip_path=clip(cx, rect(3, 3, 42, 42, 2.5)))

    def meander(self, y0, y1, x0, x1, unit, colour, width):
        """A Greek-key band: hooked units that share their walls."""
        d = ""
        x = x0
        h = y1 - y0
        while x < x1:
            d += f"M{n(x)} {n(y1)}V{n(y0)}H{n(x + unit)}V{n(y1)}"
            d += f"H{n(x + unit * 0.36)}V{n(y0 + h * 0.36)}H{n(x + unit * 0.64)}"
            x += unit
        return path(d, fill="none", stroke=colour, stroke_width=width, stroke_linejoin="miter")

    def std(self, cx):
        spiral = path(
            "M9 39V9H39V33H17V17H31V27H23",
            fill="none",
            stroke=self.INDIGO,
            stroke_width=3.2,
            stroke_linejoin="miter",
        )
        return (
            rect(6, 6, 36, 36, fill="none", stroke=self.TERRA, stroke_width=1.4)
            + spiral
            + circ(25, 25, 2.2, fill=self.OCHRE)
        )

    def cut(self, cx):
        out = ""
        for r in range(4):
            for c in range(4):
                if (c, r) in {(1, 1), (2, 1), (1, 2), (2, 2)}:
                    continue
                colour = (self.TERRA, self.OCHRE, self.INDIGO)[(r + c) % 3]
                out += rect(7 + 8.5 * c, 7 + 8.5 * r, 8.5, 8.5, fill=colour)
        void = poly(
            [
                (15.5, 15.5),
                (24, 14.5),
                (32.5, 15.5),
                (33.5, 24),
                (32.5, 32.5),
                (24, 33.5),
                (15.5, 32.5),
                (14.5, 24),
            ],
            fill=self.BLACK,
        )
        return (
            out
            + void
            + path("M17 17L21 19M30 30L27 27", fill="none", stroke="#4a3d33", stroke_width=1.2)
        )

    def arr(self, cx):
        field = rect(6, 6, 36, 36, 1.5, fill=self.TERRA)
        arrow = poly(
            [(11, 19), (25, 19), (25, 12), (38, 24), (25, 36), (25, 29), (11, 29)],
            fill=self.OCHRE,
            stroke=self.INDIGO,
            stroke_width=1.6,
            stroke_linejoin="miter",
        )
        return field + arrow

    def exact(self, cx):
        slab = rect(6, 8, 36, 32, 1.5, fill=self.CREAM, stroke=self.TERRA, stroke_width=2.4)
        v = poly(
            [(9, 15), (14.5, 15), (17.5, 28), (20.5, 15), (26, 15), (20.2, 34), (14.8, 34)],
            fill=self.INDIGO,
        )
        bars = rect(29, 15, 4.6, 19, fill=self.INDIGO) + rect(36.4, 15, 4.6, 19, fill=self.INDIGO)
        return slab + v + bars

    def wrap(self, cx):
        band = rect(3, 14, 42, 20, fill="#e8d9b4")
        rails = rect(3, 11, 42, 2.6, fill=self.TERRA) + rect(3, 34.4, 42, 2.6, fill=self.TERRA)
        key = self.meander(17, 31, 3, 45, 14, self.INDIGO, 3)
        return self.inside(cx, band + rails + key)

    def loop(self, cx):
        leaves = ""
        for k in range(16):
            a = 360 * k / 16
            x, y = 24 + 14 * math.cos(math.radians(a)), 24 + 14 * math.sin(math.radians(a))
            colour = self.SAGE if k % 2 == 0 else "#4f6a3d"
            leaves += ell(
                x, y, 4.6, 2, fill=colour, transform=f"rotate({n(a + 90)} {n(x)} {n(y)})"
            )
        berries = "".join(
            circ(
                24 + 14 * math.cos(math.radians(a)),
                24 + 14 * math.sin(math.radians(a)),
                1.5,
                fill=self.TERRA,
            )
            for a in range(11, 360, 45)
        )
        return circ(24, 24, 15, fill="none", stroke="#8b7a54", stroke_width=0.8) + leaves + berries

    def tele(self, cx):
        p0, p1, p2 = (9, 34), (22, 1), (38, 33)

        def at(t):
            x = (1 - t) ** 2 * p0[0] + 2 * t * (1 - t) * p1[0] + t * t * p2[0]
            y = (1 - t) ** 2 * p0[1] + 2 * t * (1 - t) * p1[1] + t * t * p2[1]
            dx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
            dy = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
            size = math.hypot(dx, dy)
            return x, y, dx / size, dy / size

        top, bottom, mid = [], [], []
        for i in range(25):
            x, y, tx, ty = at(i / 24)
            nx, ny = ty, -tx
            w = 0.7 + 3.9 * math.exp(-((((i / 24) - 0.62) / 0.27) ** 2))
            top.append((x + nx * w, y + ny * w))
            bottom.append((x - nx * w, y - ny * w))
            mid.append((x, y))
        body = poly(top + bottom[::-1], fill=self.TERRA_D)
        belly = poly(bottom[4:22] + mid[21:3:-1], fill=self.OCHRE)
        x0, y0, tx0, ty0 = at(0)
        nx0, ny0 = ty0, -tx0
        fluke = poly(
            [
                (x0 + nx0 * 0.7, y0 + ny0 * 0.7),
                (x0 + nx0 * 5.4 - tx0 * 2.6, y0 + ny0 * 5.4 - ty0 * 2.6),
                (x0 - tx0 * 0.8, y0 - ty0 * 0.8),
                (x0 - nx0 * 5.4 - tx0 * 2.6, y0 - ny0 * 5.4 - ty0 * 2.6),
                (x0 - nx0 * 0.7, y0 - ny0 * 0.7),
            ],
            fill=self.TERRA_D,
        )
        x1, y1, tx1, ty1 = at(1)
        nx1, ny1 = ty1, -tx1
        beak = poly(
            [top[-1], (x1 + tx1 * 5, y1 + ty1 * 5), bottom[-1]],
            fill=self.TERRA_D,
        )
        a, b = top[10], top[15]
        _, _, tx, ty = at(0.45)
        fin = poly([a, (b[0] + ty * 5.5 - 1.5, b[1] - tx * 5.5), b], fill=self.TERRA_D)
        ex, ey, _, _ = at(0.9)
        eye = circ(ex + nx1 * 1.4, ey + ny1 * 1.4, 0.9, fill=self.CREAM)
        waves = path(
            "M4 41Q9.500 35 15 41T26 41T37 41T48 41",
            fill="none",
            stroke=self.INDIGO,
            stroke_width=2.4,
            stroke_linecap="round",
        )
        splash = path(
            "M5 37Q9 30 13 37M33 37Q37 30 41 37",
            fill="none",
            stroke="#4f78b0",
            stroke_width=1.5,
            stroke_linecap="round",
        )
        return self.inside(cx, waves + splash + fluke + body + belly + fin + beak + eye)

    def pent(self, cx):
        petals = ""
        for k in range(5):
            a = -90 + 72 * k
            x, y = 24 + 9 * math.cos(math.radians(a)), 25 + 9 * math.sin(math.radians(a))
            colour = self.TERRA if k % 2 == 0 else self.OCHRE
            petals += ell(
                x,
                y,
                7.2,
                4,
                fill=colour,
                stroke=self.TERRA_D,
                stroke_width=0.6,
                transform=f"rotate({n(a)} {n(x)} {n(y)})",
            )
        core = poly(
            pent(24, 25, 5.6),
            fill=self.INDIGO,
            stroke=self.CREAM,
            stroke_width=0.9,
            stroke_linejoin="round",
        )
        return petals + core

    def tetra(self, cx):
        return tetra(24, 25, 0.88, "#e9b95a", self.TERRA, self.TERRA_D, stroke="#5a2a14", sw=0.6)

    def cube(self, cx):
        return iso_cube(
            24, 24.5, 12.5, self.CREAM, self.TERRA, self.INDIGO, stroke="#4a3a22", sw=0.7
        )

    def ball(self, cx):
        body = sphere(cx, 24, 24, 15, "#f3c46a", "#8f3f22", rim="#5a2a14")
        return ell(24, 41, 12, 1.8, fill="#4a3a22", opacity=0.3) + body


@register
class Magma(Concept):
    """Basalt and lava: glowing cracks, vents, caldera, basalt columns, bombs, obsidian shards."""

    key = "51-magma"
    title = "Magma"
    font = "'Big Shoulders Display','Arial Narrow',sans-serif"
    pal = {"card": "#17110f"}
    ROCK, ROCK2, ROCK3 = "#2a2321", "#1a1514", "#3d322d"
    LAVA, EMBER, HOT, RED = "#ff5a1a", "#ffb23a", "#fff0a6", "#b3200f"

    def draw(self, kind, cx):
        floor = linear(cx, [(0, "#2b2220"), (1, "#14100e")], 0, 0, 1, 1)
        plate = rect(3, 3, 42, 42, 6, fill=floor, stroke="#0b0807", stroke_width=1)
        self.glow = blur(cx, 1.3)
        return plate + getattr(self, kind)(cx)

    def molten(self, pts, width=2.2, closed=False):
        """A glowing line: a wide soft halo, the ember core and a hot centre."""
        halo = line(
            pts,
            stroke=self.LAVA,
            stroke_width=width * 2.6,
            stroke_linejoin="round",
            stroke_linecap="round",
            opacity=0.75,
            filter=self.glow,
        )
        core = line(
            pts,
            stroke=self.EMBER,
            stroke_width=width,
            stroke_linejoin="round",
            stroke_linecap="round",
        )
        heart = line(
            pts,
            stroke=self.HOT,
            stroke_width=width * 0.38,
            stroke_linejoin="round",
            stroke_linecap="round",
        )
        return halo + core + heart

    def std(self, cx):
        pts = [(8, 12), (38, 14), (35, 25), (10, 23), (13, 35), (40, 36)]
        return self.molten(pts, 2.4)

    def cut(self, cx):
        out = ""
        for x, y in ((17, 17), (31, 17), (17, 31), (31, 31)):
            out += circ(x, y, 7.5, fill=self.LAVA, opacity=0.5, filter=self.glow)
            out += (
                circ(x, y, 5.6, fill="#0b0807")
                + circ(x, y, 3.9, fill=self.LAVA)
                + circ(x + 0.3, y + 0.3, 2, fill=self.EMBER)
                + circ(x + 0.5, y + 0.5, 0.9, fill=self.HOT)
            )
        return out

    def arr(self, cx):
        out = ""
        for y, colour in ((10, self.RED), (20, self.LAVA), (30, self.EMBER)):
            pts = [(12, y), (24, y + 9), (36, y)]
            out += line(
                pts,
                stroke=colour,
                stroke_width=6.4,
                stroke_linejoin="miter",
                opacity=0.55,
                filter=self.glow,
            )
            out += line(pts, stroke=colour, stroke_width=3.8, stroke_linejoin="miter")
        return out

    def exact(self, cx):
        slab = rect(9, 9, 30, 30, 3, fill=self.ROCK3, stroke="#0b0807", stroke_width=1.2) + rect(
            11, 11, 26, 26, 2, fill="none", stroke="#55453d", stroke_width=0.8
        )
        glow = text(
            24,
            25,
            "7",
            23,
            font_weight=800,
            font_family=self.font,
            fill=self.LAVA,
            filter=self.glow,
        )
        return (
            slab
            + glow
            + text(24, 25, "7", 23, font_weight=800, font_family=self.font, fill=self.EMBER)
        )

    def wrap(self, cx):
        faces = (
            rect(13, 12, 7, 27, fill="#4a3d37")
            + rect(20, 12, 8, 27, fill=self.ROCK)
            + rect(28, 12, 7, 27, fill="#16110f")
        )
        top = poly(
            [(13, 12), (20, 8), (28, 8), (35, 12), (28, 16), (20, 16)],
            fill="#5a4a42",
            stroke="#0b0807",
            stroke_width=0.8,
            stroke_linejoin="round",
        )
        band = path(
            "M13 27Q24 33 35 27",
            fill="none",
            stroke=self.LAVA,
            stroke_width=5,
            opacity=0.7,
            filter=self.glow,
        )
        band += path(
            "M13 27Q24 33 35 27", fill="none", stroke=self.EMBER, stroke_width=2.4
        ) + path("M13 27Q24 33 35 27", fill="none", stroke=self.HOT, stroke_width=0.9)
        return faces + top + band

    def loop(self, cx):
        rim = circ(24, 24, 16.5, fill="#3d322d", stroke="#0b0807", stroke_width=1)
        lake = circ(
            24,
            24,
            11.5,
            fill="none",
            stroke=self.LAVA,
            stroke_width=6.5,
            opacity=0.7,
            filter=self.glow,
        )
        ring = circ(24, 24, 11.5, fill="none", stroke=self.EMBER, stroke_width=3.2) + circ(
            24, 24, 11.5, fill="none", stroke=self.HOT, stroke_width=1.1
        )
        crater = circ(24, 24, 7, fill="#0f0b0a")
        return rim + lake + ring + crater

    def tele(self, cx):
        cones = poly(
            [(4, 41), (10, 31), (16, 31), (22, 41)],
            fill=self.ROCK3,
            stroke="#0b0807",
            stroke_width=0.8,
        )
        cones += poly(
            [(26, 41), (32, 33), (38, 33), (44, 41)],
            fill=self.ROCK3,
            stroke="#0b0807",
            stroke_width=0.8,
        )
        vents = ell(13, 31, 3.4, 1.2, fill=self.LAVA, filter=self.glow) + ell(
            35, 33, 3.4, 1.2, fill=self.LAVA, filter=self.glow
        )
        arc = path(
            "M13 30Q24 4 35 32",
            fill="none",
            stroke=self.LAVA,
            stroke_width=3,
            stroke_dasharray="0.1 4.2",
            stroke_linecap="round",
            opacity=0.8,
            filter=self.glow,
        )
        arc += path(
            "M13 30Q24 4 35 32",
            fill="none",
            stroke=self.EMBER,
            stroke_width=1.8,
            stroke_dasharray="0.1 4.2",
            stroke_linecap="round",
        )
        bomb = (
            circ(24, 14.5, 3.6, fill=self.LAVA, filter=self.glow)
            + circ(24, 14.5, 2.6, fill=self.EMBER)
            + circ(24, 14.5, 1.1, fill=self.HOT)
        )
        return cones + vents + arc + bomb

    def pent(self, cx):
        pts = pent(24, 25, 16.5)
        top = poly(
            pts,
            fill=self.ROCK3,
            stroke=self.LAVA,
            stroke_width=3,
            stroke_linejoin="round",
            opacity=0.6,
            filter=self.glow,
        )
        top += poly(
            pts, fill=self.ROCK3, stroke=self.EMBER, stroke_width=1.3, stroke_linejoin="round"
        )
        inner = poly(
            pent(24, 25, 9.5),
            fill=self.ROCK,
            stroke="#0b0807",
            stroke_width=0.8,
            stroke_linejoin="round",
        )
        cracks = path(
            "M24 25L24 9M24 25L40 20M24 25L33 41M24 25L15 41M24 25L8 20",
            fill="none",
            stroke=self.LAVA,
            stroke_width=0.9,
            stroke_linecap="round",
            opacity=0.85,
        )
        return top + inner + cracks + circ(24, 25, 2.2, fill=self.EMBER)

    def tetra(self, cx):
        shard = tetra(24, 24.5, 0.88, "#3b312c", "#1c1614", "#0d0a09", stroke=self.EMBER, sw=0.9)
        edge = line(
            [(24, 10.5), (25, 28.5)],
            stroke=self.LAVA,
            stroke_width=3,
            opacity=0.6,
            filter=self.glow,
        )
        return edge + shard + line([(24, 10.5), (25, 28.5)], stroke=self.HOT, stroke_width=0.7)

    def cube(self, cx):
        body = iso_cube(24, 24.5, 12.5, "#4a3d37", "#2a2321", "#14100e", stroke="#0b0807", sw=0.8)
        seams = (
            line([(24, 24.5), (24, 37)], stroke=self.LAVA, stroke_width=1.1)
            + line([(24, 24.5), (13.2, 18.5)], stroke=self.LAVA, stroke_width=1.1)
            + line([(24, 24.5), (34.8, 18.5)], stroke=self.LAVA, stroke_width=1.1)
        )
        crack = line(
            [(17, 14.5), (21, 17), (19.5, 19.8), (24, 21.5)], stroke=self.EMBER, stroke_width=0.9
        )
        return (
            seams
            + body
            + line([(24, 24.5), (24, 37)], stroke=self.EMBER, stroke_width=0.9)
            + line([(24, 24.5), (13.2, 18.5)], stroke=self.EMBER, stroke_width=0.9)
            + line([(24, 24.5), (34.8, 18.5)], stroke=self.EMBER, stroke_width=0.9)
            + crack
        )

    def ball(self, cx):
        halo = circ(24, 24, 18, fill=self.LAVA, opacity=0.5, filter=self.glow)
        core = sphere(cx, 24, 24, 14, self.HOT, self.RED, spot=False)
        area = clip(cx, circ(24, 24, 14))
        crust = group(
            poly([(12, 15), (22, 11), (27, 17), (20, 22), (13, 21)], fill="#1a1412")
            + poly([(27, 26), (37, 22), (38, 32), (30, 37), (25, 33)], fill="#1a1412")
            + poly([(10, 30), (17, 28), (19, 36), (13, 38)], fill="#1a1412"),
            clip_path=area,
        )
        return (
            halo + core + crust + circ(24, 24, 14, fill="none", stroke="#0b0807", stroke_width=0.8)
        )
