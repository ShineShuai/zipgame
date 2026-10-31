"""Icon concepts 45-48: circuit board, papercut dioramas, op art, celadon and monochrome glazes."""

import math

from core import circ, ell, group, line, n, path, poly, rect, register, text
from kit import blur, clip, linear
from kit2 import Concept, hatch, iso_cube, pent, sine, spiral, sphere, tetra


def shade(colour, amount):
    """Mix a #rrggbb colour with white (amount > 0) or black (amount < 0)."""
    target = 255 if amount > 0 else 0
    parts = [int(colour[i : i + 2], 16) for i in (1, 3, 5)]
    mixed = [round(p + (target - p) * abs(amount)) for p in parts]
    return "#" + "".join(f"{v:02x}" for v in mixed)


def ring_path(x, y, r):
    """A full circle as path data (for even-odd holes)."""
    return (
        f"M{n(x - r)} {n(y)}a{n(r)} {n(r)} 0 1 0 {n(2 * r)} 0a{n(r)} {n(r)} 0 1 0 {n(-2 * r)} 0Z"
    )


@register
class Circuit(Concept):
    """Printed circuit board: resistor, vias, diode, test point, edge pads, ball grid, SMD chip."""

    key = "45-circuit"
    title = "Circuit Board"
    font = "'Chakra Petch','Share Tech Mono',monospace"
    pal = {"card": "#0b6a45"}
    MASK, MASK_D, EDGE = "#0f7a4e", "#0b5f3e", "#073f2a"
    CU, CU_HI = "#e8743b", "#f6a56b"
    AU, AU_D = "#f0c350", "#a87a1f"
    SILK, DRILL, BLK = "#f5f2e7", "#06261a", "#1b1f1d"
    TOP, BOTTOM = "#ff7a45", "#62b6ff"  # the two layers of a CAD board

    def plate(self):
        holes = "".join(
            circ(x, y, 1.9, fill=self.AU) + circ(x, y, 0.9, fill=self.DRILL)
            for x, y in ((7, 7), (41, 7), (7, 41), (41, 41))
        )
        return rect(3, 3, 42, 42, 5, fill=self.MASK, stroke=self.EDGE, stroke_width=1) + holes

    def pad(self, x, y, r=2.8, drill=0.0):
        out = circ(x, y, r, fill=self.AU, stroke=self.AU_D, stroke_width=0.6)
        return out + (circ(x, y, drill, fill=self.DRILL) if drill else "")

    def draw(self, kind, cx):
        return self.plate() + getattr(self, kind)(cx)

    def std(self, cx):
        zig = [(15, 24), (18, 17.5), (22, 30.5), (26, 17.5), (30, 30.5), (33, 24)]
        trace = line(
            [(10, 24), (15, 24)] + zig[1:] + [(38, 24)],
            stroke=self.CU,
            stroke_width=2.8,
            stroke_linejoin="miter",
        )
        label = text(24, 39.5, "R1", 4.8, font_weight=700, font_family=self.font, fill=self.SILK)
        return trace + self.pad(10, 24, 3.4, 1.2) + self.pad(38, 24, 3.4, 1.2) + label

    def cut(self, cx):
        pads = "".join(
            self.pad(12 + 8 * c, 12 + 8 * r, 2.4, 0.9)
            for r in range(4)
            for c in range(4)
            if (c, r) not in {(1, 1), (2, 1), (1, 2), (2, 2)}
        )
        slot = rect(16, 16, 16, 16, 3, fill=self.DRILL, stroke=self.AU, stroke_width=0.9)
        return pads + slot

    def arr(self, cx):
        trace = line([(9, 24), (39, 24)], stroke=self.CU, stroke_width=2.6)
        diode = poly([(17, 15.5), (17, 32.5), (30, 24)], fill=self.SILK) + rect(
            30.5, 15.5, 2.6, 17, fill=self.SILK
        )
        return trace + diode + self.pad(9, 24, 2.6, 0.9) + self.pad(39, 24, 2.6, 0.9)

    def exact(self, cx):
        pad = circ(24, 25, 10.5, fill=self.AU, stroke=self.AU_D, stroke_width=1)
        ring = circ(24, 25, 8, fill="none", stroke=self.AU_D, stroke_width=0.6)
        label = text(24, 11, "TP", 4.6, font_weight=700, font_family=self.font, fill=self.SILK)
        return (
            pad
            + ring
            + label
            + text(24, 25.5, "7", 13, font_weight=700, font_family=self.font, fill=self.DRILL)
        )

    def wrap(self, cx):
        first = line(
            [(30, 10), (30, 24), (14, 24), (5, 24)],
            stroke=self.CU,
            stroke_width=2.8,
            stroke_linejoin="miter",
        )
        second = line(
            [(43, 24), (34, 24), (34, 38), (18, 38)],
            stroke=self.CU,
            stroke_width=2.8,
            stroke_linejoin="miter",
        )
        return (
            first
            + second
            + self.pad(5, 24, 3.2, 1.1)
            + self.pad(43, 24, 3.2, 1.1)
            + self.pad(30, 10, 2.4)
        )

    def loop(self, cx):
        ring = circ(24, 24, 13, fill="none", stroke=self.CU, stroke_width=3)
        court = circ(
            24, 24, 8, fill="none", stroke=self.SILK, stroke_width=0.8, stroke_dasharray="1.6 1.4"
        )
        arrow = poly([(34, 22), (40, 24), (34, 26)], fill=self.SILK)
        return ring + court + arrow + self.pad(24, 11, 3, 1)

    def tele(self, cx):
        a, b = (14, 32), (34, 16)
        traces = line([(5, 32), a], stroke=self.CU, stroke_width=2.6) + line(
            [b, (43, 16)], stroke=self.CU, stroke_width=2.6
        )
        jump = path(
            "M14 32Q16 14 34 16",
            fill="none",
            stroke=self.SILK,
            stroke_width=1.2,
            stroke_dasharray="1.3 1.9",
            stroke_linecap="round",
        )
        tags = text(
            14, 40.5, "L1", 4.4, font_weight=700, font_family=self.font, fill=self.SILK
        ) + text(34, 8.5, "L4", 4.4, font_weight=700, font_family=self.font, fill=self.SILK)
        return traces + jump + self.pad(*a, 4.4, 1.9) + self.pad(*b, 4.4, 1.9) + tags

    def pent(self, cx):
        pts = pent(24, 25, 15)
        pour = poly(
            pts, fill=self.CU, stroke=self.CU_HI, stroke_width=0.8, stroke_linejoin="round"
        )
        pour += poly(pts, fill=hatch(cx, self.CU_HI, 3.2, 0.9, 45), opacity=0.75)
        spokes = "".join(
            line(
                [
                    (24, 25),
                    (24 + 8 * math.cos(math.radians(a)), 25 + 8 * math.sin(math.radians(a))),
                ],
                stroke=self.MASK,
                stroke_width=1.5,
            )
            for a in (-90, -18, 54, 126, 198)
        )
        return pour + spokes + self.pad(24, 25, 4.2, 1.7)

    def tetra(self, cx):
        base = ell(24, 40, 14, 2.2, fill=self.DRILL, opacity=0.4)
        return base + tetra(
            24, 24.5, 0.82, "#eef2f3", "#b9c4c8", "#838f95", stroke="#5d686d", sw=0.5
        )

    def cube(self, cx):
        base = poly(
            [(24, 16.5), (38, 25), (24, 33.5), (10, 25)],
            fill=self.AU,
            stroke=self.AU_D,
            stroke_width=0.7,
        )
        chip = iso_cube(24, 21, 10, "#3a403d", "#232826", "#121514")
        mark = circ(21.2, 14.4, 1.1, fill=self.SILK, opacity=0.9)
        return base + chip + mark

    def ball(self, cx):
        pad = ell(24, 33.5, 14, 5.5, fill=self.AU, stroke=self.AU_D, stroke_width=0.8)
        shadow = ell(24, 32.5, 8, 2.6, fill=self.DRILL, opacity=0.35)
        return pad + shadow + sphere(cx, 24, 22, 10.5, "#ffffff", "#7f8c92", rim="#6b777c")


@register
class Papercut(Concept):
    """Layered paper dioramas: hills, punched windows, folded tag, rings, pyramid, die, lantern."""

    key = "46-papercut"
    title = "Papercut"
    font = "'Poppins','Trebuchet MS',sans-serif"
    pal = {"card": "#fde6d8"}
    CREAM, PEACH, CORAL, ROSE = "#fff6ee", "#ffc2a6", "#ff6f59", "#e0517a"
    PLUM, INDIGO, GOLD, INK = "#8a3f84", "#3b2f78", "#ffc65a", "#2a2358"
    SHADOW = "#4a1f5c"

    def layer(self, cx, build, fill, dy=-1.1, dx=0.0, soft=None):
        """One sheet of paper: its shadow on the sheet behind, then the sheet."""
        soft = soft or self.soft
        shadow = build(
            fill=self.SHADOW, opacity=0.3, filter=soft, transform=f"translate({n(dx)} {n(dy)})"
        )
        return shadow + build(fill=fill)

    def draw(self, kind, cx):
        self.soft = blur(cx, 0.55)
        card = rect(3, 4.2, 42, 42, 7, fill=self.SHADOW, opacity=0.22, filter=self.soft)
        card += rect(3, 3, 42, 42, 7, fill=self.CREAM)
        return card + getattr(self, kind)(cx)

    def inner(self, cx):
        return clip(cx, rect(3, 3, 42, 42, 7))

    def std(self, cx):
        sun = self.layer(cx, lambda **k: circ(33, 15, 5.2, **k), self.GOLD)
        hills = [
            ("M3 31C11 21 19 23 26 29S39 27 45 23V45H3Z", self.CORAL),
            ("M3 37C10 31 18 33 24 38S37 35 45 32V45H3Z", self.ROSE),
            ("M3 43C12 38 22 41 30 42S40 39 45 40V45H3Z", self.PLUM),
        ]
        out = "".join(
            self.layer(cx, lambda d=d, **k: path(d, **k), fill, dy=-1.4) for d, fill in hills
        )
        return group(sun + out, clip_path=self.inner(cx))

    def cut(self, cx):
        back = rect(7, 7, 34, 34, 3, fill=self.INDIGO)
        star = circ(31, 17, 1.7, fill=self.GOLD) + circ(16, 31, 1.7, fill=self.GOLD)
        holes = "".join(ring_path(x, y, 5.2) for x, y in ((16, 17), (32, 17), (16, 31), (32, 31)))

        def sheet(**k):
            return path("M7 7H41V41H7Z" + holes, fill_rule="evenodd", **k)

        return back + star + self.layer(cx, sheet, self.CORAL, dy=1.2)

    def arr(self, cx):
        def arrow(scale, **k):
            pts = [(10, 17), (26, 17), (26, 9.5), (40, 24), (26, 38.5), (26, 31), (10, 31)]
            return poly([(24 + (x - 24) * scale, 24 + (y - 24) * scale) for x, y in pts], **k)

        out = ""
        for scale, fill in ((1.0, self.PLUM), (0.74, self.ROSE), (0.48, self.CORAL)):
            out += self.layer(cx, lambda s=scale, **k: arrow(s, **k), fill, dy=1.2, dx=-0.6)
        return out

    def exact(self, cx):
        def tag(**k):
            return poly([(15, 8), (33, 8), (38, 13), (38, 40), (10, 40), (10, 13)], **k)

        def digit(**k):
            return text(24, 29, "7", 21, font_weight=700, font_family=self.font, **k)

        hole = circ(24, 14, 2.3, fill=self.CREAM) + path(
            "M24 14C28 6 33 5 33 9", fill="none", stroke=self.GOLD, stroke_width=1.1
        )
        return (
            self.layer(cx, tag, self.ROSE, dy=1.1)
            + hole
            + self.layer(cx, digit, self.CREAM, dy=0.9)
        )

    def ribbon(self, d, **k):
        """A paper strip along d; the layer helper hands it the paper colour as fill."""
        colour = k.pop("fill")
        return path(
            d,
            fill="none",
            stroke=colour,
            stroke_width=5.4,
            stroke_linecap="butt",
            stroke_linejoin="round",
            **k,
        )

    def wrap(self, cx):
        out = self.layer(
            cx, lambda **k: self.ribbon("M3 20H28Q33 20 33 15V9", **k), self.CORAL, 1.2
        )
        out += self.layer(
            cx, lambda **k: self.ribbon("M45 29H20Q15 29 15 34V40", **k), self.PLUM, 1.2
        )
        return (
            out
            + poly([(3, 15.5), (3, 24.5), (-1, 20)], fill=self.GOLD)
            + poly([(45, 24.5), (45, 33.5), (49, 29)], fill=self.GOLD)
        )

    def loop(self, cx):
        out = ""
        for r, fill in ((16, self.PLUM), (12.6, self.ROSE), (9.2, self.CORAL)):
            out += self.layer(cx, lambda r=r, **k: circ(24, 24, r, **k), fill, dy=-1.1)
        return (
            out
            + circ(24, 24, 5.4, fill=self.CREAM)
            + circ(24, 24, 5.4, fill="none", stroke=self.SHADOW, stroke_width=0.6, opacity=0.35)
        )

    def tele(self, cx):
        out = path(
            "M14 31Q20 13 34 17",
            fill="none",
            stroke=self.CORAL,
            stroke_width=1.8,
            stroke_dasharray="2.2 2.4",
        )
        for x, y in ((14, 31), (34, 17)):
            for r, fill in ((7.6, self.INDIGO), (5.4, self.PLUM)):
                out += self.layer(cx, lambda x=x, y=y, r=r, **k: circ(x, y, r, **k), fill, dy=-0.9)
            out += self.layer(cx, lambda x=x, y=y, **k: circ(x, y, 2.6, **k), self.GOLD, dy=-0.6)
        return out

    def pent(self, cx):
        out = ""
        for i, (r, fill) in enumerate(
            ((16, self.PLUM), (12.4, self.ROSE), (8.8, self.CORAL), (5, self.GOLD))
        ):
            pts = [
                (
                    24 + r * math.cos(math.radians(-90 + 36 * i + 72 * k)),
                    25 + r * math.sin(math.radians(-90 + 36 * i + 72 * k)),
                )
                for k in range(5)
            ]
            out += self.layer(
                cx, lambda pts=pts, **k: poly(pts, stroke_linejoin="round", **k), fill, dy=-1
            )
        return out

    def tetra(self, cx):
        shadow = ell(24, 40, 14, 2.4, fill=self.SHADOW, opacity=0.28, filter=self.soft)
        return shadow + tetra(24, 24.5, 0.82, "#ffb59e", self.ROSE, self.PLUM)

    def cube(self, cx):
        body = iso_cube(24, 25, 11.5, "#fff0e4", "#ff8f78", "#c9456f")
        pip = ell(24, 19.6, 3.2, 1.8, fill=self.CORAL)
        side = circ(18.6, 29.6, 1.5, fill=self.CREAM) + circ(29.6, 28.6, 1.5, fill=self.CREAM)
        return (
            ell(24, 40.5, 14, 2.2, fill=self.SHADOW, opacity=0.25, filter=self.soft)
            + body
            + pip
            + side
        )

    def ball(self, cx):
        body = circ(24, 25, 14, fill=self.ROSE)
        area = clip(cx, circ(24, 25, 14))
        ribs = group(
            "".join(
                ell(24, 25, rx, 14, fill="none", stroke=self.CREAM, stroke_width=0.9, opacity=0.75)
                for rx in (4.6, 9.4)
            )
            + circ(24, 25, 14, fill="none", stroke="#b8345f", stroke_width=1.2),
            clip_path=area,
        )
        caps = rect(18.5, 8.4, 11, 3.4, 1.4, fill=self.GOLD) + rect(
            18.5, 38.2, 11, 3.4, 1.4, fill=self.GOLD
        )
        tassel = line(
            [(24, 41.6), (24, 45)], stroke=self.CORAL, stroke_width=1.4, stroke_linecap="round"
        )
        return body + ribs + caps + tassel + circ(19, 19, 3.4, fill="#ffffff", opacity=0.22)


@register
class OpArt(Concept):
    """Op art: waves, checker holes, chevrons, targets, striped bars, spirals, nested solids."""

    key = "47-opart"
    title = "Op Art"
    font = "'Unbounded','Arial Black',sans-serif"
    pal = {"card": "#ececf4"}
    WH, BK, BL, LM = "#ffffff", "#0b0b0f", "#2b2bff", "#c8ff1a"

    def draw(self, kind, cx):
        self.cut_box = clip(cx, rect(5, 5, 38, 38))
        plate = rect(3, 3, 42, 42, 1.5, fill=self.WH, stroke=self.BK, stroke_width=1.7)
        return plate + getattr(self, kind)(cx)

    def boxed(self, markup):
        return group(markup, clip_path=self.cut_box)

    def std(self, cx):
        waves = ""
        for i in range(5):
            y = 11 + 6.5 * i
            pts = sine(2, y, 46, y, 3.4, cycles=1.5, phase=0.5 * i)
            colour = self.BL if i == 2 else self.BK
            waves += line(pts, stroke=colour, stroke_width=3.1 if i != 2 else 3.6)
        return self.boxed(waves)

    def cut(self, cx):
        cells = "".join(
            rect(5 + 9.5 * c, 5 + 9.5 * r, 9.5, 9.5, fill=self.BK)
            for r in range(4)
            for c in range(4)
            if (r + c) % 2 == 0
        )
        hole = (
            circ(24, 24, 9.5, fill=self.WH, stroke=self.BK, stroke_width=1.7)
            + circ(24, 24, 5, fill=self.BL)
            + circ(24, 24, 1.8, fill=self.LM)
        )
        return self.boxed(cells) + hole

    def arr(self, cx):
        chevrons = "".join(
            line(
                [(x, 9), (x + 14, 24), (x, 39)],
                stroke=self.BK,
                stroke_width=3.4,
                stroke_linejoin="miter",
            )
            for x in (4, 12.5, 21)
        )
        head = poly([(31, 12), (44, 24), (31, 36)], fill=self.BL)
        return self.boxed(chevrons + head)

    def exact(self, cx):
        rings = ""
        for r, fill in ((19, self.BK), (15.5, self.WH), (12, self.BK), (9, self.LM)):
            rings += circ(24, 24, r, fill=fill)
        return self.boxed(rings) + text(
            24, 24.8, "7", 12.5, font_weight=700, font_family=self.font, fill=self.BK
        )

    def wrap(self, cx):
        bars = ""
        for i in range(-7, 8):
            theta = i * math.pi / 15.5
            x = 24 + 22 * math.sin(theta)
            w = 5.2 * math.cos(theta)
            bars += rect(x - w / 2, 5, w, 38, fill=self.BK if i % 2 == 0 else self.BL)
        return self.boxed(bars)

    def loop(self, cx):
        coil = line(
            spiral(24, 24, 2, 18, 3.2, 90),
            stroke=self.BK,
            stroke_width=3.4,
            stroke_linecap="round",
        )
        return self.boxed(circ(24, 24, 19.5, fill=self.LM) + coil) + circ(
            24, 24, 19.5, fill="none", stroke=self.BL, stroke_width=2
        )

    def tele(self, cx):
        out = path(
            "M14 31Q20 12 34 17",
            fill="none",
            stroke=self.BL,
            stroke_width=2,
            stroke_dasharray="2.4 2.4",
        )
        for x, y in ((14, 31), (34, 17)):
            for r, fill in ((8.2, self.BK), (6, self.WH), (3.8, self.BK), (1.6, self.LM)):
                out += circ(x, y, r, fill=fill)
        return self.boxed(out)

    def pent(self, cx):
        out = ""
        for i, r in enumerate((19, 15.4, 11.8, 8.2, 4.6)):
            rot = -90 + 14 * i
            pts = [
                (
                    24 + r * math.cos(math.radians(rot + 72 * k)),
                    25 + r * math.sin(math.radians(rot + 72 * k)),
                )
                for k in range(5)
            ]
            out += poly(
                pts, fill=[self.BK, self.WH, self.BK, self.LM, self.BL][i], stroke_linejoin="miter"
            )
        return self.boxed(out)

    def tetra(self, cx):
        left = hatch(cx, self.BK, 2.8, 1.5, 90)
        right = hatch(cx, self.BL, 2.8, 1.6, 0)
        faces = (
            ("24,9 40,36 25,28.2", right),
            ("22.5,9.8 8,36 23,28.2", left),
            ("9.5,38 38.5,38 24,30.2", self.WH),
        )
        out = ""
        for pts, fill in faces:
            out += poly(
                [tuple(map(float, p.split(","))) for p in pts.split()],
                fill=fill,
                stroke=self.BK,
                stroke_width=1.5,
                stroke_linejoin="round",
            )
        return out

    def cube(self, cx):
        top = self.WH
        left = hatch(cx, self.BK, 3, 1.7, 90)
        right = hatch(cx, self.BL, 3, 1.7, 0)
        return iso_cube(24, 24.5, 13, top, left, right, stroke=self.BK, sw=1.5)

    def ball(self, cx):
        area = clip(cx, circ(24, 24, 17))
        rings = ""
        for i in range(8, -1, -1):
            r = 3 + 2.3 * i
            rings += circ(
                24 - 0.95 * (8 - i),
                24 - 0.95 * (8 - i),
                r,
                fill=self.BK if i % 2 == 0 else self.WH,
            )
        return (
            group(rings, clip_path=area)
            + circ(24, 24, 17, fill="none", stroke=self.BK, stroke_width=1.7)
            + circ(15.5, 15, 2, fill=self.LM)
        )


@register
class Celadon(Concept):
    """Single-glaze porcelain: meiping, pierced jar, pear vase, tenmoku plaque, cong, moon jar."""

    key = "48-celadon"
    title = "Monochrome and Celadon Glazes"
    font = "'Fraunces','Georgia',serif"
    pal = {"card": "#e4eee8"}
    PORCELAIN = "#f6f9f5"
    CEL, CEL_D, CEL_DD = "#a9c9b8", "#6e9d89", "#3f7a68"
    QB, OX, PB, YEL = "#dcebe8", "#9a2f2b", "#5f86c2", "#e7b730"
    PEACH, RUSSET, TEN, LAV = "#e9a79c", "#c9726b", "#2a211e", "#a58ccb"
    IRON, GOLD = "#7b4a2b", "#c79a3f"

    def glaze(self, cx, base, x1=0.0, x2=1.0):
        """Glaze gradient across a piece: light side, body colour, pooled shade."""
        return linear(
            cx, [(0, shade(base, 0.45)), (0.4, base), (1, shade(base, -0.28))], x1, 0, x2, 0.25
        )

    def draw(self, kind, cx):
        wash = linear(cx, [(0, "#fbfdfb"), (1, "#dfe9e2")], 0, 0, 0.3, 1)
        plate = rect(3, 3, 42, 42, 10, fill=wash, stroke="#bfd3c7", stroke_width=0.8)
        return (
            plate + ell(24, 41.3, 13, 1.7, fill="#486a5c", opacity=0.22) + getattr(self, kind)(cx)
        )

    def crackle(self, cx, shape, colour="#2f5a4b"):
        """Fine crackle lines clipped to a shape."""
        lines = (
            "M8 18L16 22L20 17M16 22L18 30L25 27M25 27L30 31L36 26M30 31L31 38"
            "M20 17L26 14L34 18M26 14L28 8M34 18L40 21M12 30L18 30M36 26L41 31M18 30L14 38"
        )
        marks = path(
            lines,
            fill="none",
            stroke=colour,
            stroke_width=0.45,
            opacity=0.5,
            stroke_linecap="round",
            stroke_linejoin="round",
        )
        return group(marks, clip_path=clip(cx, path(shape)))

    def foot(self, y, half):
        return rect(24 - half, y, 2 * half, 1.8, 0.8, fill=self.IRON)

    def std(self, cx):
        d = (
            "M20.8 7.5H27.2C27.2 10.5 26.4 12 26.6 13.6"
            "C31.4 15.2 34.6 18.6 34.6 24.4C34.6 30.4 31.2 35 30.6 40H17.4"
            "C16.8 35 13.4 30.4 13.4 24.4C13.4 18.6 16.6 15.2 21.4 13.6"
            "C21.6 12 20.8 10.5 20.8 7.5Z"
        )
        body = path(d, fill=self.glaze(cx, self.CEL_D))
        shine = path(
            "M17.6 20C16 23 15.6 27 17 31",
            fill="none",
            stroke="#ffffff",
            stroke_width=1.5,
            opacity=0.6,
            stroke_linecap="round",
        )
        lip = ell(24, 7.6, 3.6, 0.9, fill=shade(self.CEL_D, -0.3))
        return body + self.crackle(cx, d) + shine + lip + self.foot(39.8, 6.9)

    def cut(self, cx):
        body = circ(24, 25, 15, fill=self.glaze(cx, "#c5d9d6"))
        holes = ""
        for x, y in (
            (24, 17),
            (17.5, 22),
            (30.5, 22),
            (24, 27),
            (14.5, 29.5),
            (33.5, 29.5),
            (24, 36),
        ):
            holes += circ(x, y, 2.3, fill="#2f4a42") + circ(x, y - 0.5, 1.6, fill="#476a5d")
        rim = ell(24, 10.8, 5.5, 1.5, fill="#9ab6b2")
        return (
            body
            + holes
            + rim
            + path(
                "M13 20C14 16 17 13 21 12",
                fill="none",
                stroke="#ffffff",
                stroke_width=1.4,
                opacity=0.7,
                stroke_linecap="round",
            )
        )

    def arr(self, cx):
        d = (
            "M21 7.5H27C27 11.6 26 14 27.6 17C33.2 20 36.4 25.6 36.4 31"
            "C36.4 37 31.4 40.2 24 40.2C16.6 40.2 11.6 37 11.6 31"
            "C11.6 25.6 14.8 20 20.4 17C22 14 21 11.6 21 7.5Z"
        )
        body = path(d, fill=self.glaze(cx, self.PEACH))
        russet = group(
            ell(29, 32, 5, 3.2, fill=self.RUSSET, opacity=0.45)
            + ell(18, 36, 4, 2, fill=self.RUSSET, opacity=0.4),
            clip_path=clip(cx, path(d)),
        )
        chevrons = "".join(
            line(
                [(18.4, y), (24, y + 4.2), (29.6, y)],
                stroke="#fff6f2",
                stroke_width=1.5,
                opacity=0.85,
                stroke_linecap="round",
                stroke_linejoin="round",
            )
            for y in (24, 29.5)
        )
        return body + russet + chevrons + self.foot(38.6, 6.4)

    def exact(self, cx):
        plaque = rect(9.5, 9.5, 29, 29, 4, fill=self.glaze(cx, "#46352e"))
        streaks = group(
            "".join(
                line([(x, 9.5), (x + 1.5, 38.5)], stroke="#9a6a3c", stroke_width=0.5, opacity=0.55)
                for x in (13, 17.5, 22, 26.5, 31, 35)
            ),
            clip_path=clip(cx, rect(9.5, 9.5, 29, 29, 4)),
        )
        rim = rect(9.5, 9.5, 29, 29, 4, fill="none", stroke=self.GOLD, stroke_width=0.9)
        return (
            plaque
            + streaks
            + rim
            + text(24, 25, "7", 20, font_weight=600, font_family=self.font, fill="#e9c768")
        )

    def wrap(self, cx):
        body = "M12.5 14V37C12.5 40.4 35.5 40.4 35.5 37V14Z"
        pot = path(body, fill=self.glaze(cx, self.YEL))
        mouth = ell(24, 14, 11.5, 3.4, fill=shade(self.YEL, -0.32)) + ell(
            24, 14, 9.2, 2.3, fill="#8a6a1e"
        )
        scroll = group(
            line(
                sine(10, 27, 38, 27, 3.2, cycles=2, steps=24),
                stroke=self.IRON,
                stroke_width=1.3,
                stroke_linecap="round",
            ),
            clip_path=clip(cx, path(body)),
        )
        return (
            pot
            + scroll
            + mouth
            + path(
                "M15.5 18V34",
                fill="none",
                stroke="#ffffff",
                stroke_width=1.4,
                opacity=0.5,
                stroke_linecap="round",
            )
        )

    def loop(self, cx):
        d = ring_path(24, 24, 15.5) + ring_path(24, 24, 5.6)
        disc = path(d, fill=self.glaze(cx, self.LAV), fill_rule="evenodd")
        groove = circ(
            24, 24, 10.6, fill="none", stroke=shade(self.LAV, 0.5), stroke_width=0.8, opacity=0.8
        )
        return (
            disc
            + groove
            + self.crackle(cx, d)
            + path(
                "M12 18C14 14 18 11 22 10.4",
                fill="none",
                stroke="#ffffff",
                stroke_width=1.4,
                opacity=0.65,
                stroke_linecap="round",
            )
        )

    def tele(self, cx):
        d = (
            "M24 6C29 6 31 10 29.6 14C28.6 16.4 27.6 18 29 19.6"
            "C33.6 22.2 35.2 26 35.2 30.2C35.2 37 30 41 24 41"
            "C18 41 12.8 37 12.8 30.2C12.8 26 14.4 22.2 19 19.6"
            "C20.4 18 19.4 16.4 18.4 14C17 10 19 6 24 6Z"
        )
        body = path(d, fill=self.glaze(cx, self.OX))
        shine = path(
            "M17 28C16.4 31 17.4 34 19 36",
            fill="none",
            stroke="#ffd9cf",
            stroke_width=1.5,
            opacity=0.65,
            stroke_linecap="round",
        ) + path(
            "M21.2 9.6C20.2 11 20.2 12.6 20.8 14",
            fill="none",
            stroke="#ffd9cf",
            stroke_width=1.1,
            opacity=0.6,
            stroke_linecap="round",
        )
        waist = line(
            [(20, 19.6), (28, 19.6)], stroke=shade(self.OX, -0.4), stroke_width=0.8, opacity=0.6
        )
        return body + shine + waist + self.foot(39.6, 5.6)

    def pent(self, cx):
        lobes = "".join(
            circ(
                24 + 8.6 * math.cos(math.radians(-90 + 72 * k)),
                25 + 8.6 * math.sin(math.radians(-90 + 72 * k)),
                7.4,
                fill=self.glaze(cx, self.CEL, 0.1, 0.9),
            )
            for k in range(5)
        )
        well = circ(
            24,
            25,
            7.2,
            fill=shade(self.CEL_D, -0.05),
            stroke=shade(self.CEL, 0.5),
            stroke_width=0.8,
        )
        stamens = "".join(
            circ(
                24 + 3 * math.cos(math.radians(-90 + 72 * k)),
                25 + 3 * math.sin(math.radians(-90 + 72 * k)),
                0.9,
                fill=self.GOLD,
            )
            for k in range(5)
        )
        return (
            lobes
            + well
            + stamens
            + circ(24, 25, 1.1, fill=self.IRON)
            + circ(13.5, 13.5, 2.1, fill="#ffffff", opacity=0.45)
        )

    def tetra(self, cx):
        cone = tetra(24, 24.5, 0.84, "#a9c3e6", "#7aa0d4", "#3f64a3", stroke="#2e4c80", sw=0.5)
        shine = line(
            [(22.4, 12.6), (14, 31)],
            stroke="#ffffff",
            stroke_width=1.2,
            opacity=0.5,
            stroke_linecap="round",
        )
        return cone + shine + self.foot(37.6, 11.8)

    def cube(self, cx):
        body = iso_cube(24, 24.5, 11.5, "#d3e6da", "#93bda8", "#5d917c", stroke="#44705f", sw=0.5)
        well = ell(24, 19.4, 5.4, 3.1, fill="#3f7a68", stroke="#e4f1ea", stroke_width=0.8) + ell(
            24, 19.9, 3.2, 1.7, fill="#27493e"
        )
        bands = path(
            "M13 27.4L24 33.6L35 27.4",
            fill="none",
            stroke="#44705f",
            stroke_width=0.6,
            opacity=0.7,
        )
        return body + well + bands

    def ball(self, cx):
        jar = circ(
            24,
            26.4,
            13.4,
            fill=self.glaze(cx, "#eef4f2", 0.05, 0.95),
            stroke="#bcd0cc",
            stroke_width=0.6,
        )
        mouth = ell(24, 12.8, 5.2, 1.6, fill="#c9dad6", stroke="#a9c0ba", stroke_width=0.6) + ell(
            24, 12.9, 3.7, 0.9, fill="#8aa49d"
        )
        shine = path(
            "M15 23C15.6 19.4 18 16.8 21 15.8",
            fill="none",
            stroke="#ffffff",
            stroke_width=1.8,
            opacity=0.9,
            stroke_linecap="round",
        )
        crack = path(
            "M30 21L32.5 25L31 29L34 32",
            fill="none",
            stroke="#6e8f86",
            stroke_width=0.4,
            opacity=0.55,
        )
        return jar + mouth + shine + crack + self.foot(38.7, 5.2)
