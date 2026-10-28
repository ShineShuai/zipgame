"""Engine for the zigzag variant icons: scenes, base style, sheet and inline builders.

A scene is drawn in the 48 x 48 box of the app icons (variant-icon in apps/play/icons.js):
a 4 x 4 board, origin 6, cell 9.  A Style turns the scene into themed SVG.
"""

import math
import os
import random
import re
from html import escape

ORIGIN = 6.0
UNIT = 9.0
CELLS = 4

# id, short key of the sheet, label
VARIANTS = [
    ("std", "Standard"),
    ("cut", "Cutout"),
    ("arr", "Arrows"),
    ("exact", "Exact"),
    ("wrap", "Wrap-around"),
    ("loop", "Loop"),
    ("tele", "Teleport"),
    ("two", "Two paths"),
    ("pent", "Pentagon"),
    ("tetra", "Tetra"),
    ("cube", "Cube"),
    ("ball", "Ball"),
]


def n(value):
    """Short number: at most 2 decimals, no trailing zeros."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def attrs(**kwargs):
    parts = []
    for key, value in kwargs.items():
        if value is None:
            continue
        name = key.rstrip("_").replace("_", "-")
        if isinstance(value, float):
            value = n(value)
        parts.append(f'{name}="{value}"')
    return " ".join(parts)


def tag(name, inner=None, **kwargs):
    head = f"<{name} {attrs(**kwargs)}".rstrip()
    if inner is None:
        return head + "/>"
    return f"{head}>{inner}</{name}>"


def pts_str(points):
    return " ".join(f"{n(x)},{n(y)}" for x, y in points)


def poly(points, **kwargs):
    return tag("polygon", points=pts_str(points), **kwargs)


def line(points, **kwargs):
    kwargs.setdefault("fill", "none")
    return tag("polyline", points=pts_str(points), **kwargs)


def path(d, **kwargs):
    return tag("path", d=d, **kwargs)


def circ(x, y, r, **kwargs):
    return tag("circle", cx=n(x), cy=n(y), r=n(r), **kwargs)


def ell(x, y, rx, ry, **kwargs):
    return tag("ellipse", cx=n(x), cy=n(y), rx=n(rx), ry=n(ry), **kwargs)


def rect(x, y, w, h, r=0, **kwargs):
    extra = {"rx": n(r)} if r else {}
    return tag("rect", x=n(x), y=n(y), width=n(w), height=n(h), **extra, **kwargs)


def text(x, y, content, size, **kwargs):
    kwargs.setdefault("text_anchor", "middle")
    kwargs.setdefault("dy", ".35em")
    return tag("text", escape(str(content)), x=n(x), y=n(y), font_size=n(size), **kwargs)


def group(inner, **kwargs):
    return tag("g", inner, **kwargs)


def rounded_path(points, radius):
    """Polyline with rounded corners (quadratic bends)."""
    if len(points) < 3:
        return "M" + " L".join(f"{n(x)} {n(y)}" for x, y in points)
    out = [f"M{n(points[0][0])} {n(points[0][1])}"]
    for i in range(1, len(points) - 1):
        px, py = points[i - 1]
        cx, cy = points[i]
        nx, ny = points[i + 1]
        d1 = math.hypot(cx - px, cy - py)
        d2 = math.hypot(nx - cx, ny - cy)
        r1 = min(radius, d1 / 2)
        r2 = min(radius, d2 / 2)
        ax = cx + (px - cx) * r1 / d1
        ay = cy + (py - cy) * r1 / d1
        bx = cx + (nx - cx) * r2 / d2
        by = cy + (ny - cy) * r2 / d2
        out.append(f"L{n(ax)} {n(ay)}Q{n(cx)} {n(cy)} {n(bx)} {n(by)}")
    out.append(f"L{n(points[-1][0])} {n(points[-1][1])}")
    return "".join(out)


def star_pts(cx, cy, outer, inner, spikes=5, rot=-90):
    pts = []
    for i in range(spikes * 2):
        radius = outer if i % 2 == 0 else inner
        angle = math.radians(rot + 180 * i / spikes)
        pts.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return pts


def reg_pts(cx, cy, radius, sides, rot=-90):
    return [
        (
            cx + radius * math.cos(math.radians(rot + 360 * i / sides)),
            cy + radius * math.sin(math.radians(rot + 360 * i / sides)),
        )
        for i in range(sides)
    ]


def centre(index):
    return ORIGIN + UNIT * index + UNIT / 2


def cpt(col, row):
    return (centre(col), centre(row))


def cpts(cells):
    return [cpt(c, r) for c, r in cells]


# ---- scene data (cells are [col, row]) ----------------------------------------------------------
SNAKE = [(0, 0), (3, 0), (3, 1), (0, 1), (0, 2), (3, 2), (3, 3), (0, 3)]
S_SHAPE = [(3 - c, r) for c, r in SNAKE]
LAP = [(0, 0), (3, 0), (3, 3), (0, 3), (0, 1)]
RING = [(0, 0), (3, 0), (3, 1), (1, 1), (1, 2), (3, 2), (3, 3), (0, 3), (0, 0)]
RING_NUMBERS = [((0, 0), 1), ((3, 1), 2), ((1, 2), 3)]
HOLES = [(1, 1), (2, 1), (1, 2), (2, 2)]
# one-way arrows: [col, row, side, (dx, dy)]; the edge sits right ('r') or below ('b') the cell
ARROWS = [(1, 1, "r", (-1, 0)), (1, 1, "b", (0, 1)), (2, 2, "b", (0, -1))]
STEPS = [((0, 0), 1), ((1, 1), 7), ((3, 2), 12), ((0, 3), 16)]
STUB = 3.0
WRAP_OUT = [(2, 0), (2, 1), (0, 1)]
WRAP_IN = [(3, 1), (3, 3)]
PORTAL_A = (1, 0)
PORTAL_B = (2, 2)
RED_ROUTE = [(0, 0), (3, 0), (3, 1), (0, 1)]
BLUE_ROUTE = [(3, 3), (0, 3), (0, 2), (3, 2)]

PENT_TILES = [
    "17.9,7 14.7,10.2 16.3,16.3 22.4,14.7 24,8.6",
    "33.3,7 30.1,10.2 31.7,16.3 37.8,14.7 39.4,8.6",
    "7,14.7 10.2,17.9 16.3,16.3 14.7,10.2 8.6,8.6",
    "22.4,14.7 25.6,17.9 31.7,16.3 30.1,10.2 24,8.6",
    "25.6,17.9 22.4,14.7 16.3,16.3 17.9,22.4 24,24",
    "41,17.9 37.8,14.7 31.7,16.3 33.3,22.4 39.4,24",
    "14.7,25.6 17.9,22.4 16.3,16.3 10.2,17.9 8.6,24",
    "30.1,25.6 33.3,22.4 31.7,16.3 25.6,17.9 24,24",
    "17.9,22.4 14.7,25.6 16.3,31.7 22.4,30.1 24,24",
    "33.3,22.4 30.1,25.6 31.7,31.7 37.8,30.1 39.4,24",
    "7,30.1 10.2,33.3 16.3,31.7 14.7,25.6 8.6,24",
    "22.4,30.1 25.6,33.3 31.7,31.7 30.1,25.6 24,24",
    "25.6,33.3 22.4,30.1 16.3,31.7 17.9,37.8 24,39.4",
    "41,33.3 37.8,30.1 31.7,31.7 33.3,37.8 39.4,39.4",
    "14.7,41 17.9,37.8 16.3,31.7 10.2,33.3 8.6,39.4",
    "30.1,41 33.3,37.8 31.7,31.7 25.6,33.3 24,39.4",
]
PENT_ROUTE = [
    (19.1, 26.8),
    (21.2, 19.1),
    (28.9, 21.2),
    (36.6, 19.1),
    (34.5, 11.4),
    (26.8, 13.5),
    (19.1, 11.4),
    (11.4, 13.5),
    (13.5, 21.2),
    (11.4, 28.9),
    (13.5, 36.6),
    (21.2, 34.5),
    (26.8, 28.9),
    (34.5, 26.8),
    (36.6, 34.5),
    (28.9, 36.6),
]
CUBE_FACES = [
    ("24,10.5 36.5,17.5 24,24.5 11.5,17.5", 0),
    ("11.5,19.5 23,26 23,40 11.5,33", 1),
    ("25,26 36.5,19.5 36.5,33 25,40", 2),
]
CUBE_ROUTE = [(24, 17.5), (17, 28), (23.5, 33), (30.5, 28)]
TETRA_FACES = [
    ("24,9 40,36 25,28.2", 2),
    ("22.5,9.8 8,36 23,28.2", 1),
    ("9.5,38 38.5,38 24,30.2", 0),
]
TETRA_ROUTE = [(20, 24), (16, 32), (24, 34), (32, 32)]
BALL_C = (24.0, 24.0)
BALL_R = 17.5
BALL_PENT = "24,17.5 30.2,22 27.8,29.3 20.2,29.3 17.8,22"
BALL_SPOKES = [
    ((24, 17.5), (24, 8)),
    ((30.2, 22), (39.2, 19)),
    ((27.8, 29.3), (33.3, 36.8)),
    ((20.2, 29.3), (14.7, 36.8)),
    ((17.8, 22), (8.8, 19)),
]
BALL_ROUTE = [(13, 30), (20, 26), (28, 26), (35, 18)]


def parse_pts(text_pts):
    out = []
    for pair in text_pts.split():
        x_text, y_text = pair.split(",")
        out.append((float(x_text), float(y_text)))
    return out


REGISTRY = {}


def register(cls):
    REGISTRY[cls.key] = cls
    return cls


class Ctx:
    """Per-icon state: unique id prefix and the collected defs."""

    def __init__(self, uid, kind=""):
        self.uid = uid
        self.kind = kind
        self.defs = []
        self.count = 0

    def new_id(self, hint="d"):
        self.count += 1
        return f"{self.uid}-{hint}{self.count}"

    def add(self, markup):
        self.defs.append(markup)


class Style:
    """Base look. A prototype overrides attributes and the drawing methods it needs."""

    key = ""
    title = ""
    font = "system-ui,Arial,sans-serif"
    pal = {
        "bg": None,
        "tile": "#e8e8e8",
        "tile_s": "#777777",
        "shade1": "#cccccc",
        "shade2": "#aaaaaa",
        "route": "#d33",
        "route2": "#27c",
        "node": "#fb0",
        "node_s": "#640",
        "ink": "#222",
        "acc": "#27c",
        "paper": "#fff",
    }
    gap = 0.7
    radius = 1.0
    tile_sw = 0.0
    route_w = 2.2
    cap = "round"
    join = "round"
    dot_r = 2.7
    num_r = 4.1
    num_size = 4.6
    num_weight = 700
    M = None  # affine matrix (a, b, c, d, e, f) for the flat board
    solid_xf = None  # optional transform of the solids (they use the raw 48 box)
    pent_w = 0.72  # route width factor on the pentagon board

    def __init__(self):
        self.rng = random.Random(self.key)

    # ---- geometry --------------------------------------------------------------------------
    raw = False  # True while a solid is drawn: its own 48-box coordinates, no board transform

    def T(self, x, y):
        if self.M is None or self.raw:
            return (x, y)
        a, b, c, d, e, f = self.M
        return (a * x + c * y + e, b * x + d * y + f)

    def flat(self, inner):
        """Wrap board-space markup in the board transform."""
        if self.M is None:
            return inner
        a, b, c, d, e, f = self.M
        return group(inner, transform=f"matrix({n(a)} {n(b)} {n(c)} {n(d)} {n(e)} {n(f)})")

    def cell_box(self, col, row, inset=None):
        inset = self.gap if inset is None else inset
        x0 = ORIGIN + UNIT * col + inset
        y0 = ORIGIN + UNIT * row + inset
        side = UNIT - 2 * inset
        return x0, y0, side

    def p(self, key):
        return self.pal[key]

    def kind(self, cx):
        return cx.kind

    # ---- scene hooks (drawn in this order by the scenes) -----------------------------------
    def back(self, cx):
        return ""

    def front(self, cx):
        return ""

    def tile(self, cx, col, row):
        x0, y0, side = self.cell_box(col, row)
        return rect(
            x0,
            y0,
            side,
            side,
            self.radius,
            fill=self.p("tile"),
            stroke=self.p("tile_s") if self.tile_sw else None,
            stroke_width=self.tile_sw or None,
        )

    def tiles(self, cx, holes=()):
        out = []
        for row in range(CELLS):
            for col in range(CELLS):
                if (col, row) in holes:
                    out.append(self.pit(cx, col, row))
                else:
                    out.append(self.tile(cx, col, row))
        return self.flat("".join(out))

    def pit(self, cx, col, row):
        return ""

    def face(self, cx, pts, shade):
        """A polygon face of a solid or a pentagon tile; shade 0 light, 1 mid, 2 dark."""
        fills = [self.p("tile"), self.p("shade1"), self.p("shade2")]
        return poly(
            pts,
            fill=fills[shade],
            stroke=self.p("tile_s"),
            stroke_width=self.tile_sw or 0.8,
            stroke_linejoin="round",
        )

    def path_line(self, cx, pts, which=0):
        colour = self.p("route") if which == 0 else self.p("route2")
        return line(
            pts,
            stroke=colour,
            stroke_width=self.route_w,
            stroke_linecap=self.cap,
            stroke_linejoin=self.join,
        )

    def route(self, cx, cells, which=0, raw=False):
        pts = list(cells) if raw else cpts(cells)
        return self.flat(self.path_line(cx, pts, which))

    def dot(self, cx, x, y, which=0):
        tx, ty = self.T(x, y)
        return circ(
            tx,
            ty,
            self.dot_r,
            fill=self.p("node"),
            stroke=self.p("node_s"),
            stroke_width=0.8,
        )

    def num(self, cx, x, y, label, which=0):
        tx, ty = self.T(x, y)
        return circ(
            tx,
            ty,
            self.num_r,
            fill=self.p("node"),
            stroke=self.p("node_s"),
            stroke_width=0.8,
        ) + text(
            tx,
            ty,
            label,
            self.num_size if len(str(label)) < 2 else self.num_size * 0.9,
            font_weight=self.num_weight,
            font_family=self.font,
            fill=self.p("ink"),
        )

    def arrow(self, cx, x, y, dx, dy):
        tx, ty = self.T(x, y)
        tip = (tx + dx * 3.2, ty + dy * 3.2)
        left = (tx - dx * 2 - dy * 3, ty - dy * 2 + dx * 3)
        right = (tx - dx * 2 + dy * 3, ty - dy * 2 - dx * 3)
        return poly([tip, left, right], fill=self.p("ink"))

    def portal(self, cx, x, y, which):
        tx, ty = self.T(x, y)
        return circ(tx, ty, 3.9, fill="none", stroke=self.p("acc"), stroke_width=1.3) + circ(
            tx,
            ty,
            1.5,
            fill=self.p("acc"),
        )

    def jump(self, cx, a, b):
        ax, ay = self.T(*a)
        bx, by = self.T(*b)
        return path(
            f"M{n(ax)} {n(ay)}Q{n((ax + bx) / 2 + 7)} {n((ay + by) / 2 - 3)} {n(bx)} {n(by)}",
            fill="none",
            stroke=self.p("acc"),
            stroke_width=1.2,
            stroke_dasharray="1.2 1.6",
            stroke_linecap="round",
        )

    def stub(self, cx, x, y, side):
        """End of the route that leaves the board (wrap-around). side: -1 left, 1 right."""
        return ""

    def solid(self, cx, kind):
        self.raw = True
        try:
            body = self.solid_body(cx, kind)
        finally:
            self.raw = False
        if self.solid_xf:
            return group(body, transform=self.solid_xf)
        return body

    def solid_body(self, cx, kind):
        return self.solid_faces(cx, kind) + self.solid_path(cx, kind)

    def solid_faces(self, cx, kind):
        out = []
        if kind == "cube":
            for pts_text, shade in CUBE_FACES:
                out.append(self.face(cx, parse_pts(pts_text), shade))
        elif kind == "tetra":
            for pts_text, shade in TETRA_FACES:
                out.append(self.face(cx, parse_pts(pts_text), shade))
        else:
            out.append(self.ball_body(cx))
        return "".join(out)

    def solid_path(self, cx, kind):
        pts = {"cube": CUBE_ROUTE, "tetra": TETRA_ROUTE}.get(kind, BALL_ROUTE)
        return self.solid_route(cx, pts)

    def ball_body(self, cx):
        x, y = BALL_C
        body = circ(
            x,
            y,
            BALL_R,
            fill=self.p("tile"),
            stroke=self.p("tile_s"),
            stroke_width=self.tile_sw or 0.8,
        )
        spokes = "".join(
            line([a, b], stroke=self.p("tile_s"), stroke_width=0.8, stroke_linecap="round")
            for a, b in BALL_SPOKES
        )
        cap = poly(
            parse_pts(BALL_PENT),
            fill=self.p("shade2"),
            stroke=self.p("tile_s"),
            stroke_width=0.8,
            stroke_linejoin="round",
        )
        return body + spokes + cap

    def solid_route(self, cx, pts):
        return self.path_line(cx, pts) + self.dot_raw(cx, pts[0]) + self.dot_raw(cx, pts[-1])

    def wrap(self, cx, body):
        return body

    def dot_raw(self, cx, pt):
        return self.dot(cx, pt[0], pt[1])


TWO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "two")


def authored(key, uid):
    """The hand-finished Two paths icon of a design: gen/two/<key>.svg, where @ stands for the
    id prefix. Returns (defs, body) like scene(), or None when the design has no such file."""
    path = os.path.join(TWO_DIR, f"{key}.svg")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        markup = handle.read().strip().replace("@", uid)
    found = re.match(r"<defs>(.*?)</defs>(.*)", markup, re.S)
    return (found.group(1), found.group(2)) if found else ("", markup)


def scene(style, kind, uid):
    """Render one variant; returns (defs, body). Two paths is drawn by hand per design (gen/two/)."""
    if kind == "two":
        icon = authored(style.key, uid)
        if icon:
            return icon
    cx = Ctx(uid, kind)
    if hasattr(style, "draw"):
        body = style.draw(kind, cx)
        return "".join(cx.defs), body
    out = [style.back(cx)]
    if kind == "std":
        out.append(style.tiles(cx))
        out.append(style.route(cx, S_SHAPE))
        out.append(style.dot(cx, *cpt(*S_SHAPE[0])))
        out.append(style.dot(cx, *cpt(*S_SHAPE[-1])))
    elif kind == "cut":
        out.append(style.tiles(cx, holes=set(HOLES)))
        out.append(style.route(cx, LAP))
        out.append(style.dot(cx, *cpt(*LAP[0])))
        out.append(style.dot(cx, *cpt(*LAP[-1])))
    elif kind == "arr":
        out.append(style.tiles(cx))
        out.append(style.route(cx, SNAKE))
        out.append(style.dot(cx, *cpt(*SNAKE[0])))
        out.append(style.dot(cx, *cpt(*SNAKE[-1])))
        for col, row, side, (dx, dy) in ARROWS:
            if side == "r":
                x, y = ORIGIN + UNIT * (col + 1), centre(row)
            else:
                x, y = centre(col), ORIGIN + UNIT * (row + 1)
            out.append(style.arrow(cx, x, y, dx, dy))
    elif kind == "exact":
        out.append(style.tiles(cx))
        out.append(style.route(cx, SNAKE))
        for cell, label in STEPS:
            out.append(style.num(cx, *cpt(*cell), label))
    elif kind == "wrap":
        out.append(style.tiles(cx))
        y = centre(1)
        left = ORIGIN - STUB
        right = ORIGIN + UNIT * CELLS + STUB
        first = cpts(WRAP_OUT) + [(left, y)]
        second = [(right, y)] + cpts(WRAP_IN)
        out.append(style.route(cx, first, raw=True))
        out.append(style.route(cx, second, raw=True))
        out.append(style.stub(cx, left, y, -1))
        out.append(style.stub(cx, right, y, 1))
        out.append(style.dot(cx, *cpt(*WRAP_OUT[0])))
        out.append(style.dot(cx, *cpt(*WRAP_IN[-1])))
    elif kind == "loop":
        out.append(style.tiles(cx))
        out.append(style.route(cx, RING))
        for cell, label in RING_NUMBERS:
            out.append(style.num(cx, *cpt(*cell), label))
    elif kind == "tele":
        out.append(style.tiles(cx))
        a = cpt(*PORTAL_A)
        b = cpt(*PORTAL_B)
        out.append(style.route(cx, [(0, 0), PORTAL_A]))
        out.append(style.jump(cx, a, b))
        out.append(style.route(cx, [PORTAL_B, (3, 2), (3, 3)]))
        out.append(style.portal(cx, *a, 0))
        out.append(style.portal(cx, *b, 1))
        out.append(style.dot(cx, *cpt(0, 0)))
        out.append(style.dot(cx, *cpt(3, 3)))
    elif kind == "two":
        out.append(style.tiles(cx))
        for which, cells in enumerate((RED_ROUTE, BLUE_ROUTE)):
            out.append(style.route(cx, cells, which))
            out.append(style.dot(cx, *cpt(*cells[0]), which))
            out.append(style.dot(cx, *cpt(*cells[-1]), which))
    elif kind == "pent":
        out.append(style.pent(cx) if hasattr(style, "pent") else pent_default(style, cx))
    else:
        out.append(style.solid(cx, kind))
    out.append(style.front(cx))
    return "".join(cx.defs), style.wrap(cx, "".join(out))


def pent_default(style, cx):
    faces = []
    for i, pts_text in enumerate(PENT_TILES):
        faces.append(style.face(cx, parse_pts(pts_text), 0))
    out = [style.flat("".join(faces))]
    width = style.route_w
    style.route_w = width * style.pent_w
    out.append(style.route(cx, PENT_ROUTE, raw=True))
    style.route_w = width
    out.append(style.dot(cx, *PENT_ROUTE[0]))
    out.append(style.dot(cx, *PENT_ROUTE[-1]))
    return "".join(out)


def icon_svg(style, kind, size=48, suffix=""):
    uid = f"{style.key[:2]}{kind}{suffix}"
    defs, body = scene(style, kind, uid)
    defs_tag = f"<defs>{defs}</defs>" if defs else ""
    return (
        f'<svg viewBox="0 0 48 48" width="{size}" height="{size}" aria-hidden="true">'
        f"{defs_tag}{body}</svg>"
    )


def sheet_svg(style, cols=6):
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '
        f'{56 * cols} 112" width="{112 * cols}" height="224" role="img">'
        f"<title>zigzag puzzle types, {style.title}</title>"
    ]
    card = style.pal.get("card")
    if card:
        parts.append(rect(0, 0, 56 * cols, 112, id="bg", fill=card))
    for i, (kind, label) in enumerate(VARIANTS):
        col, row = i % cols, i // cols
        defs, body = scene(style, kind, f"{style.key[:2]}{kind}")
        defs_tag = f"<defs>{defs}</defs>" if defs else ""
        parts.append(
            f'<g id="v-{kind}" transform="translate({4 + 56 * col} {4 + 56 * row})">'
            f"<title>{label}</title>{defs_tag}{body}</g>"
        )
    parts.append("</svg>")
    return "".join(parts)


def alts_svg(style):
    """A review sheet with the alternative designs a concept lists in ALTS."""
    items = style.ALTS
    width = 56 * len(items)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 76" width="{width * 2}" '
        f'height="152" role="img"><title>{style.title}: alternatives</title>'
    ]
    card = style.pal.get("card")
    if card:
        parts.append(rect(0, 0, width, 76, id="bg", fill=card))
    for i, (kind, label) in enumerate(items):
        defs, body = scene(style, kind, f"{style.key[:2]}alt{i}")
        defs_tag = f"<defs>{defs}</defs>" if defs else ""
        parts.append(
            f'<g id="alt-{kind}" transform="translate({4 + 56 * i} 4)"><title>{label}</title>'
            f"{defs_tag}{body}</g>"
        )
        parts.append(
            text(
                28 + 56 * i,
                66,
                label,
                5.4,
                font_family="system-ui,Arial,sans-serif",
                fill="#2a1d6e",
            )
        )
    parts.append("</svg>")
    return "".join(parts)
