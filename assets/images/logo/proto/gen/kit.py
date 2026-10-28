"""SVG effects and pixel text for the icon concepts: filters, clips, gradients, sparkles.

Rebuilt from the design pages: every icon of the 33 pages regenerates byte for byte.
"""

from core import n, poly, rect, text

FONT_3X5 = {
    "0": ("XXX", "X.X", "X.X", "X.X", "XXX"),
    "1": (".X.", "XX.", ".X.", ".X.", "XXX"),
    "2": ("XXX", "..X", "XXX", "X..", "XXX"),
    "3": ("XXX", "..X", "XXX", "..X", "XXX"),
    "4": ("X.X", "X.X", "XXX", "..X", "..X"),
    "5": ("XXX", "X..", "XXX", "..X", "XXX"),
    "6": ("XXX", "X..", "XXX", "X.X", "XXX"),
    "7": ("XXX", "..X", ".X.", ".X.", ".X."),
    "8": ("XXX", "X.X", "XXX", "X.X", "XXX"),
    "9": ("XXX", "X.X", "XXX", "..X", "XXX"),
}


def _def(cx, markup, hint):
    """Add a <defs> entry with a fresh id (the @ in markup) and return its url(#id)."""
    ident = cx.new_id(hint)
    cx.add(markup.replace("@", ident))
    return f"url(#{ident})"


def blur(cx, std):
    """Gaussian blur filter, as the filter attribute value."""
    return _def(
        cx,
        '<filter id="@" x="-60%" y="-60%" width="220%" height="220%">'
        f'<feGaussianBlur stdDeviation="{n(std)}"/></filter>',
        "b",
    )


def clip(cx, shape):
    """Clip path from a shape, as the clip-path attribute value."""
    return _def(cx, f'<clipPath id="@">{shape}</clipPath>', "c")


def linear(cx, stops, x1=0, y1=0, x2=1, y2=1):
    """Linear gradient over the bounding box; stops are (offset, colour) pairs."""
    body = "".join(f'<stop offset="{n(o)}" stop-color="{c}"/>' for o, c in stops)
    return _def(
        cx,
        f'<linearGradient id="@" x1="{n(x1)}" y1="{n(y1)}" x2="{n(x2)}" y2="{n(y2)}">'
        f"{body}</linearGradient>",
        "g",
    )


def sparkle(x, y, r, fill, **kw):
    """Four-pointed star."""
    pts = [
        (x, y - r), (x + r * 0.28, y - r * 0.28), (x + r, y), (x + r * 0.28, y + r * 0.28),
        (x, y + r), (x - r * 0.28, y + r * 0.28), (x - r, y), (x - r * 0.28, y - r * 0.28),
    ]  # fmt: skip
    return poly(pts, fill=fill, **kw)


def wobble(pts, rng, amp):
    """Shake points by up to amp in each direction (a hand-drawn line)."""
    return [(x + rng.uniform(-amp, amp), y + rng.uniform(-amp, amp)) for x, y in pts]


def pix_text(x, y, s, size, colour):
    """Digits in a 3 x 5 pixel font (one column apart), centred on (x, y); one rect per run."""
    x0, y0 = x - (4 * len(s) - 1) * size / 2, y - 5 * size / 2
    out = ""
    for k, ch in enumerate(s):
        for j, row in enumerate(FONT_3X5[ch]):
            i = 0
            while i < 3:
                if row[i] != "X":
                    i += 1
                    continue
                end = i
                while end < 3 and row[end] == "X":
                    end += 1
                out += rect(x0 + (4 * k + i) * size, y0 + j * size, (end - i) * size, size, fill=colour)
                i = end
    return out
