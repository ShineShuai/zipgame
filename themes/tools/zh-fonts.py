#!/usr/bin/env python3
"""Makes the Chinese brand-name fonts of the themes: themes/<id>/fonts/zh.woff2, a font of the two glyphs of the game's name.

    python3 themes/tools/zh-fonts.py [--specimen FILE.html] [id ...]

The Chinese name of zigzag is 之折 (BRAND_ZH). Two glyphs are all a theme needs a Chinese font for: the rest of the Chinese UI uses the
system's fonts. So every theme ships its own face of those two glyphs (about 2 KB), cut from Noto Sans / Serif CJK SC (SIL OFL 1.1) in the
weight that matches the theme's Latin face, and, for a few looks the Noto family does not have, restyled: round (rounded terminals),
pixel (a 24x24 grid), hand (rounded, wobbling like a marker), stencil (condensed, with the bridges of a stencil cut open).

A theme picks its face by `zhFace` in themes/tools/proto-meta.json: "<family>-<weight>" (sans-700, serif-600, mono-700) or a restyle
("round-700": rounded from sans 700). The importer (import-proto.mjs) turns that into the font entry of theme.json; this script writes the file.
Needs: fontTools, numpy, opencv-python, Pillow, a `brotli` module (pip) and the Noto CJK .ttc files (Debian: fonts-noto-cjk).
Set NOTO_DIR for another folder of them. The result is committed: CI never runs this.
"""
import io
import json
import os
import sys

import cv2
import numpy as np
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTCollection, TTFont, newTable
from PIL import Image, ImageDraw, ImageFont

BRAND_ZH = '之折'
HERE = os.path.dirname(os.path.abspath(__file__))
THEMES = os.path.dirname(HERE)
NOTO = os.environ.get('NOTO_DIR', '/usr/share/fonts/opentype/noto')
WEIGHT_FILE = {
    'sans': {100: 'Thin', 300: 'Light', 350: 'DemiLight', 400: 'Regular', 500: 'Medium', 700: 'Bold', 900: 'Black'},
    'serif': {200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 900: 'Black'},
    'mono': {400: 'Regular', 700: 'Bold'},
}
NOTO_NAME = {'sans': 'Noto Sans CJK SC', 'serif': 'Noto Serif CJK SC', 'mono': 'Noto Sans Mono CJK SC'}
RESTYLE = {
    # style: (label of the family, kernel as a share of the em for the rounding, other)
    'round': 'Zigzag Round', 'pixel': 'Zigzag Pixel', 'hand': 'Zigzag Hand', 'stencil': 'Zigzag Stencil',
}
S = 2000     # raster size of one em while restyling
UPM = 1000


def noto_face(family, weight):
    """(path, index) of the Noto CJK SC face; the SC face is the third of a .ttc, a mono one the eighth of the regular and bold files."""
    name = WEIGHT_FILE[family][weight]
    kind = 'Serif' if family == 'serif' else 'Sans'
    path = f'{NOTO}/Noto{kind}CJK-{name}.ttc'
    return path, 7 if family == 'mono' else 2


def load_noto(family, weight):
    path, index = noto_face(family, weight)
    return TTCollection(path).fonts[index]


def subset(font, text):
    """The font with only the glyphs of `text` (CFF outlines kept)."""
    from fontTools import subset as sub
    opt = sub.Options()
    opt.layout_features = []
    opt.hinting = False
    opt.notdef_outline = True
    opt.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opt.drop_tables += ['DSIG', 'vhea', 'vmtx', 'VORG', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'MATH', 'JSTF']
    s = sub.Subsetter(opt)
    s.populate(text=text)
    s.subset(font)
    return font


def rename(font, family, note):
    """The modified fonts do not keep the name they came from (the OFL asks for it)."""
    names = font['name']
    for rec in list(names.names):
        if rec.nameID in (1, 4, 6, 16, 17):
            names.removeNames(nameID=rec.nameID)
    for pid, eid, lid in ((3, 1, 0x409),):   # Windows names only: the Mac encoding has no room for the two glyphs of the note
        names.setName(family, 1, pid, eid, lid)
        names.setName('Regular', 2, pid, eid, lid)
        names.setName(family, 4, pid, eid, lid)
        names.setName(family.replace(' ', '') + '-Regular', 6, pid, eid, lid)
        names.setName(note, 10, pid, eid, lid)


def glyph_bitmap(path, index, char):
    """The glyph as a numpy array (S x S, 0..255, ink = 255), the em box with the baseline at 0.88 of the height (the CJK convention)."""
    font = ImageFont.truetype(path, S, index=index)
    img = Image.new('L', (S, S), 0)
    ImageDraw.Draw(img).text((0, int(S * 0.88)), char, font=font, fill=255, anchor='ls')
    return np.array(img)


def morph(img, radius, mode):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    return cv2.morphologyEx(img, mode, k)


def wobble(contour, seed, amp):
    """Moves the points of a contour a little along smooth noise: a marker that was not held by a ruler."""
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.28, 4)
    out = []
    for x, y in contour:
        dx = amp * (np.sin(y / 170 + ph[0]) + 0.6 * np.sin(y / 61 + ph[1]))
        dy = amp * (np.sin(x / 150 + ph[2]) + 0.6 * np.sin(x / 57 + ph[3]))
        out.append((x + dx, y + dy))
    return out


def restyle(img, style, seed, weight=700, grid=20):
    """The bitmap of a glyph in the given restyle -> a list of contours (lists of (x, y) in raster pixels, y down) and their holes' flags."""
    if style == 'round':
        img = (img > 127).astype(np.uint8) * 255
        r = int(0.095 * weight)                 # the radius follows the stroke: 700 -> 66 px of 2000, a pill-shaped terminal
        img = morph(img, r, cv2.MORPH_OPEN)
        img = morph(img, r // 2, cv2.MORPH_CLOSE)
        img = cv2.GaussianBlur(img, (0, 0), 8)
    elif style == 'hand':
        img = (img > 127).astype(np.uint8) * 255
        r = int(0.08 * weight)
        img = morph(img, r, cv2.MORPH_OPEN)
        img = morph(img, r // 2, cv2.MORPH_CLOSE)
        img = cv2.GaussianBlur(img, (0, 0), 9)
    elif style == 'pixel':
        small = cv2.resize(img, (grid, grid), interpolation=cv2.INTER_AREA)
        img = cv2.resize((small > 88).astype(np.uint8) * 255, (S, S), interpolation=cv2.INTER_NEAREST)
    elif style == 'stencil':
        x0 = int(S * 0.075)       # condensed to 85 % of the width, centred
        w = int(S * 0.85)
        img = cv2.resize(img, (w, S), interpolation=cv2.INTER_AREA)
        img = np.pad(img, ((0, 0), (x0, S - w - x0)))
        for y in (0.405, 0.665):  # the bridges: horizontal cuts across the whole glyph
            img[int(S * y):int(S * y) + 34, :] = 0
    img = cv2.GaussianBlur(img, (0, 0), 1.2) if style not in ('pixel',) else img
    binary = (img > 127).astype(np.uint8)
    contours, hier = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    for i, c in enumerate(contours):
        eps = 0.9 if style != 'pixel' else 0.5
        poly = cv2.approxPolyDP(c, eps, True)[:, 0, :].astype(float).tolist()
        if len(poly) < 3:
            continue
        if style == 'hand':
            poly = wobble([(x, y) for x, y in cv2.approxPolyDP(c, 2.5, True)[:, 0, :]], seed + i, 20)
        hole = hier[0][i][3] >= 0
        out.append((poly, hole))
    return out


def polygon_glyph(contours):
    """A TrueType glyph from contours: outer ones clockwise, holes counter-clockwise (y up)."""
    pen = TTGlyphPen(None)
    k = UPM / S
    for poly, hole in contours:
        pts = [(round(x * k), round((0.88 * S - y) * k)) for x, y in poly]
        area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
        clockwise = area < 0
        if clockwise == hole:
            pts.reverse()
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()
    return pen.glyph()


def restyled_font(base, style, text, weight=700, grid=20):
    """A TrueType font with the glyphs of `text` redrawn in `style` from the bitmap of the Noto face `base` = (path, index)."""
    path, index = base
    source = TTFont(path, fontNumber=index)
    cmap = source.getBestCmap()
    order = ['.notdef'] + [f'uni{ord(c):04X}' for c in text]
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (UPM // 2, 0)}
    for n, ch in enumerate(text):
        if ord(ch) not in cmap:
            raise SystemExit(f'{path}: no glyph for {ch}')
        glyphs[f'uni{ord(ch):04X}'] = polygon_glyph(restyle(glyph_bitmap(path, index, ch), style, 11 + n * 7, weight, grid))
        metrics[f'uni{ord(ch):04X}'] = (UPM, 0)
    font = TTFont()
    font.setGlyphOrder(order)
    font['head'] = newTable('head')
    head = font['head']
    head.tableVersion, head.fontRevision, head.checkSumAdjustment, head.magicNumber = 1.0, 1.0, 0, 0x5F0F3CF5
    head.flags, head.unitsPerEm, head.created, head.modified = 3, UPM, 3600000000, 3600000000
    head.xMin = head.yMin = head.xMax = head.yMax = 0
    head.macStyle, head.lowestRecPPEM, head.fontDirectionHint, head.indexToLocFormat, head.glyphDataFormat = 0, 8, 2, 0, 0
    font['hhea'] = newTable('hhea')
    hhea = font['hhea']
    hhea.tableVersion, hhea.ascent, hhea.descent, hhea.lineGap = 0x00010000, 880, -120, 0
    hhea.advanceWidthMax, hhea.minLeftSideBearing, hhea.minRightSideBearing, hhea.xMaxExtent = UPM, 0, 0, UPM
    hhea.caretSlopeRise, hhea.caretSlopeRun, hhea.caretOffset = 1, 0, 0
    hhea.reserved0 = hhea.reserved1 = hhea.reserved2 = hhea.reserved3 = 0
    hhea.metricDataFormat, hhea.numberOfHMetrics = 0, len(order)
    hhea.xAvgCharWidth = UPM
    font['maxp'] = newTable('maxp')
    font['maxp'].tableVersion = 0x00010000
    for k in ('maxZones', 'maxTwilightPoints', 'maxStorage', 'maxFunctionDefs', 'maxInstructionDefs', 'maxStackElements', 'maxSizeOfInstructions'):
        setattr(font['maxp'], k, 0)
    font['maxp'].maxZones = 1
    for k in ('maxPoints', 'maxContours', 'maxCompositePoints', 'maxCompositeContours', 'maxComponentElements', 'maxComponentDepth'):
        setattr(font['maxp'], k, 0)
    font['maxp'].numGlyphs = len(order)
    font['glyf'] = newTable('glyf')
    font['glyf'].glyphs = glyphs
    font['glyf'].glyphOrder = order
    font['loca'] = newTable('loca')
    font['hmtx'] = newTable('hmtx')
    font['hmtx'].metrics = metrics
    font['cmap'] = newTable('cmap')
    cm = newTable('cmap')
    cm.tableVersion = 0
    from fontTools.ttLib.tables._c_m_a_p import cmap_format_4
    sub = cmap_format_4(4)
    sub.platformID, sub.platEncID, sub.language = 3, 1, 0
    sub.cmap = {ord(c): f'uni{ord(c):04X}' for c in text}
    cm.tables = [sub]
    font['cmap'] = cm
    font['name'] = newTable('name')
    font['name'].names = []
    for rec in source['name'].names:       # the licence travels with the glyphs: copyright, licence text, licence URL
        if rec.nameID in (0, 13, 14):
            font['name'].setName(rec.toUnicode(), rec.nameID, rec.platformID, rec.platEncID, rec.langID)
    font['post'] = newTable('post')
    font['post'].formatType = 3.0
    font['post'].italicAngle = font['post'].underlinePosition = font['post'].underlineThickness = 0
    font['post'].isFixedPitch = font['post'].minMemType42 = font['post'].maxMemType42 = 0
    font['post'].minMemType1 = font['post'].maxMemType1 = 0
    os2 = newTable('OS/2')
    os2.version, os2.xAvgCharWidth, os2.usWeightClass, os2.usWidthClass, os2.fsType = 4, UPM, 400, 5, 0
    for k in ('ySubscriptXSize', 'ySubscriptYSize', 'ySubscriptXOffset', 'ySubscriptYOffset', 'ySuperscriptXSize', 'ySuperscriptYSize', 'ySuperscriptXOffset',
              'ySuperscriptYOffset', 'yStrikeoutSize', 'yStrikeoutPosition', 'sFamilyClass', 'fsSelection', 'usFirstCharIndex', 'usLastCharIndex',
              'sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent', 'ulUnicodeRange1', 'ulUnicodeRange2',
              'ulUnicodeRange3', 'ulUnicodeRange4', 'ulCodePageRange1', 'ulCodePageRange2', 'sxHeight', 'sCapHeight', 'usDefaultChar', 'usBreakChar', 'usMaxContext'):
        setattr(os2, k, 0)
    os2.sTypoAscender, os2.sTypoDescender, os2.usWinAscent, os2.usWinDescent = 880, -120, 880, 120
    os2.usFirstCharIndex, os2.usLastCharIndex, os2.fsSelection, os2.usBreakChar = ord(min(text)), ord(max(text)), 0x40, 32
    os2.achVendID = 'ZGZG'
    os2.panose = __import__('fontTools.ttLib.tables.O_S_2f_2', fromlist=['Panose']).Panose()
    font['OS/2'] = os2
    return font


def parse(spec):
    """'sans-700' -> ('sans', 700, None); 'round-700' -> ('sans', 700, 'round'); 'serif-600' -> ('serif', 600, None)."""
    kind, weight = spec.rsplit('-', 1)
    if kind in RESTYLE:
        return 'sans', int(weight), kind
    return kind, int(weight), None


def build(spec, text=BRAND_ZH):
    """(woff2 bytes, family name, weight) of the face `spec` for `text`."""
    family, weight, style = parse(spec)
    if weight not in WEIGHT_FILE[family]:
        raise SystemExit(f'{spec}: {family} has the weights {sorted(WEIGHT_FILE[family])}')
    if style:
        font = restyled_font(noto_face(family, weight), style, text, weight, 24)
        rename(font, RESTYLE[style], f'{BRAND_ZH} cut from {NOTO_NAME[family]} {WEIGHT_FILE[family][weight]} (SIL OFL 1.1) and restyled')
        name = RESTYLE[style]
    else:
        font = subset(load_noto(family, weight), text)
        name = NOTO_NAME[family].replace(' CJK SC', ' SC')
        rename(font, name, f'{BRAND_ZH} subset of {NOTO_NAME[family]} {WEIGHT_FILE[family][weight]} (SIL OFL 1.1)')
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue(), name, weight


def main(argv):
    meta = json.load(open(f'{HERE}/proto-meta.json'))
    args = list(argv)
    specimen = None
    if '--specimen' in args:
        at = args.index('--specimen')
        specimen = args[at + 1]
        del args[at:at + 2]
    todo = args or [k for k, v in meta.items() if isinstance(v, dict) and v.get('zhFace')]
    cells = []
    for tid in todo:
        spec = meta[tid]['zhFace']
        data, name, weight = build(spec)
        d = f'{THEMES}/{tid}/fonts'
        os.makedirs(d, exist_ok=True)
        with open(f'{d}/zh.woff2', 'wb') as fh:
            fh.write(data)
        print(f'{tid}: {spec} -> {name} {weight}, {len(data)} bytes')
        cells.append((tid, spec, name, data))
    if specimen:
        import base64
        css = ''.join(f'@font-face{{font-family:"f{i}";src:url(data:font/woff2;base64,{base64.b64encode(d).decode()})}}' for i, (_, _, _, d) in enumerate(cells))
        rows = ''.join(f'<div class=c><b style="font-family:f{i}">{BRAND_ZH}</b><i style="font-family:f{i}">{BRAND_ZH}</i><span>{t} · {s}</span></div>' for i, (t, s, _, _) in enumerate(cells))
        open(specimen, 'w').write(f'<meta charset=utf-8><style>{css}body{{font:13px sans-serif;margin:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}'
                                  f'.c{{border:1px solid #ccc;padding:8px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}}b{{font-size:64px;font-weight:400}}'
                                  f'i{{font-size:26px;font-style:normal;font-weight:400}}span{{width:100%;color:#666}}</style>{rows}')


if __name__ == '__main__':
    main(sys.argv[1:])
