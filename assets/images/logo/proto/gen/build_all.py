"""Generate every variant sheet and patch the prototype pages.

Usage: build_all.py ASSETS [OUT [WOOD_HTML WOOD_SVG]]
ASSETS is the assets folder (it holds design/ and images/logo/proto/). Without OUT the files are
rewritten in place; with OUT (a scratch folder, it is replaced) ASSETS stays untouched. A tree that
still has the old Users/vs/Downloads/assets prefix works as well. Styles without a page are skipped,
and so is 27-wood when wood.py is not there. The wood files default to the ones in ASSETS; pass the
newer mini-board wood files when ASSETS still has the generic ones.
"""

import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import core
import concepts_a  # noqa: F401  (registers the icon concepts)
import concepts_b  # noqa: F401
import concepts_c  # noqa: F401
import concepts_d  # noqa: F401
import concepts_e  # noqa: F401
try:
    import wood
except ImportError:  # 27-wood is optional
    wood = None

PROTO = "images/logo/proto"
DESIGN = "design"
LEGACY = "Users/vs/Downloads/assets"
LABELS = dict(core.VARIANTS)
ORDER = [kind for kind, _ in core.VARIANTS]


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def write(path, text):
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def icon_items(style, suffix):
    return {kind: core.icon_svg(style, kind, 48, suffix) for kind in ORDER}


def with_size(svg, size):
    return re.sub(r'width="\d+" height="\d+"', f'width="{size}" height="{size}"', svg, count=1)


def first_size(block, default=48):
    match = re.search(r'<svg [^>]*width="(\d+)"', block)
    return int(match.group(1)) if match else default


def patch_grid(html, opener, item_re, make_item, suffix, style, label, icons=None):
    """Replace a run of items; returns (html, replaced?)."""
    pattern = re.compile(
        r'(<div class="%s"[^>]*>)((?:\s*%s)+)(\s*</div>)' % (opener, item_re), re.S
    )
    match = pattern.search(html)
    if not match:
        return html, False
    size = first_size(match.group(2))
    icons = icons or icon_items(style, suffix)
    items = "".join(
        make_item(i, kind, with_size(icons[kind], size)) for i, kind in enumerate(ORDER)
    )
    return html[: match.start(2)] + items + html[match.end(2) :], True


def vi_item(i, kind, svg):
    return f'<div class="vi">{svg}<span>{LABELS[kind]}</span></div>'


def vq_item(i, kind, svg):
    cls = "vq o" if i == 0 else "vq"
    return f'<div class="{cls}">{svg}<span>{LABELS[kind]}</span></div>'


def widen(html, selector):
    """Five to six columns for a grid selector like .vg."""
    pattern = re.compile(r"(\.%s\{[^}]*?grid-template-columns:repeat\()5(,1fr\))" % selector)
    return pattern.sub(r"\g<1>6\g<2>", html, count=1)


def wood_icons(sheet_text):
    icons = {}
    for match in re.finditer(
        r'<g id="v-([a-z]+)" transform="[^"]+"><title>[^<]*</title>(.*?)</g>', sheet_text, re.S
    ):
        icons[match.group(1)] = (
            f'<svg viewBox="0 0 48 48" width="54" height="54" aria-hidden="true">'
            f"{match.group(2)}</svg>"
        )
    return icons


def patch_bento17(html, style):
    run = re.compile(
        r'(?:<div class="tl(?: w)?" style="[^"]*"><svg .*?</svg><span>[^<]+</span></div>)+', re.S
    )
    match = run.search(html)
    if not match:
        raise SystemExit("17: tiles not found")
    size = first_size(match.group(0))
    tiles = []
    for kind in ORDER:
        colour = style.COLOURS[kind]
        ink = "#1f2a30" if colour == "#e8a920" else "#fbf8f1"
        svg = with_size(core.icon_svg(style, kind, 48, "t"), size)
        tiles.append(
            f'<div class="tl" style="background:{colour};color:{ink}">{svg}'
            f"<span>{LABELS[kind]}</span></div>"
        )
    html = html[: match.start()] + "".join(tiles) + html[match.end() :]
    html = html.replace(
        "grid-template-rows:124px 124px 90px 90px 90px 54px 60px",
        "grid-template-rows:124px 124px 80px 80px 80px 80px 60px",
    )
    return html


def patch_bento32(html, style):
    run = re.compile(
        r'(?:<div class="vt(?: s)?"><small>\d+</small><svg .*?</svg><span>[^<]+</span></div>)+',
        re.S,
    )
    match = run.search(html)
    size = first_size(match.group(0))
    tiles = []
    for i, kind in enumerate(ORDER):
        cls = "vt s" if i == 0 else "vt"
        svg = with_size(core.icon_svg(style, kind, 48, "t"), size)
        tiles.append(
            f'<div class="{cls}"><small>{i + 1:02d}</small>{svg}<span>{LABELS[kind]}</span></div>'
        )
    html = html[: match.start()] + "".join(tiles) + html[match.end() :]
    html = widen(html, "sv")
    return html.replace(
        "<span>Puzzle types</span><span>10</span>", "<span>Puzzle types</span><span>12</span>"
    )


def patch_bento33(html, style):
    run = re.compile(
        r'(?:<div class="ak" style="[^"]*"><svg .*?</svg><span>[^<]+</span></div>)+', re.S
    )
    match = run.search(html)
    size = first_size(match.group(0))
    cycle = [
        ("#5f7a2a", "#fbf4e4"),
        ("#e2a42b", "#4a2f20"),
        ("#1f6f78", "#fbf4e4"),
        ("#c2410c", "#fbf4e4"),
        ("#4a2f20", "#fbf4e4"),
    ]
    tiles = []
    for i, kind in enumerate(ORDER):
        bg, fg = cycle[i % 5]
        svg = with_size(core.icon_svg(style, kind, 48, "t"), size)
        tiles.append(
            f'<div class="ak" style="background:{bg};color:{fg}">'
            f"{svg}<span>{LABELS[kind]}</span></div>"
        )
    html = html[: match.start()] + "".join(tiles) + html[match.end() :]
    return widen(html, "av")


def patch_page(html, key, style, icons=None):
    html, done = patch_grid(
        html, "vg", r'<div class="vi">.*?</div>', vi_item, "g", style, key, icons
    )
    if not done:
        raise SystemExit(f"{key}: .vg not found")
    html = widen(html, "vg")
    html, has_picker = patch_grid(
        html, "vp", r'<div class="vq(?: o)?">.*?</div>', vq_item, "p", style, key
    )
    if has_picker:
        html = widen(html, "vp")
    if key == "17-bauhaus-bento":
        html = patch_bento17(html, style)
    elif key == "32-modular":
        html = patch_bento32(html, style)
    elif key == "33-atomic":
        html = patch_bento33(html, style)
    return html


def main(src, out=None, wood_html=None, wood_svg=None):
    if os.path.isdir(f"{src}/{LEGACY}"):
        src = f"{src}/{LEGACY}"
    if out and os.path.abspath(out) != os.path.abspath(src):
        if os.path.exists(out):
            shutil.rmtree(out)
        shutil.copytree(src, out)
    else:
        out = src
    keys = sorted(core.REGISTRY)
    for key in keys:
        style = core.REGISTRY[key]()
        page = f"{out}/{DESIGN}/zigzag-{key}.html"
        sheet = f"{out}/{PROTO}/{key}-variants.svg"
        if not os.path.exists(page):
            print("skip", key, "(no page)")
            continue
        html_source = read(page)
        icons = None
        if key == "27-wood":
            html_source = read(wood_html or page)
            original = read(wood_svg or sheet)

            def make_group(kind, label, pos, style=style):
                defs, body = core.scene(style, kind, f"27{kind}")
                return f'<g id="v-{kind}" transform="{pos}"><title>{label}</title>{body}</g>'

            sheet_text = wood.wood_sheet(original, make_group)
            write(sheet, sheet_text)
            icons = wood_icons(sheet_text)
        else:
            write(sheet, core.sheet_svg(style))
        write(page, patch_page(html_source, key, style, icons))
        if hasattr(style, "ALTS"):
            write(f"{out}/{PROTO}/{key}-teleport-alts.svg", core.alts_svg(style))
        print("ok", key)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(*sys.argv[1:5])
