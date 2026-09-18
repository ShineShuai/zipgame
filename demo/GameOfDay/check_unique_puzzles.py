#!/usr/bin/env python3
# check_unique_puzzles.py
import hashlib, pathlib, sys

PUZZLE_SUFFIXES = {'.txt'}

def parse(path):
    size = None
    cps  = {}     # (r,c) -> value
    walls = set() # (T,r,c)
    for raw in pathlib.Path(path).read_text().splitlines():
        line = raw.split('#', 1)[0].strip()   # strip comments (incl. inline)
        if not line:
            continue
        parts = line.split()
        kw = parts[0]
        if kw == 'size':
            size = int(parts[1])
        elif kw == 'checkpoints':
            for tok in parts[1:]:
                pos, val = tok.split('=')
                r, c = map(int, pos.split(','))
                v = int(val)
                if cps.get((r, c), v) != v:
                    raise ValueError(f"{path}: conflicting checkpoint ({r},{c})")
                cps[(r, c)] = v
        elif kw == 'walls':
            for tok in parts[1:]:
                t, r, c = tok.split(',')
                t = t.upper()
                if t not in ('H', 'V'):
                    raise ValueError(f"{path}: bad wall type {t!r}")
                walls.add((t, int(r), int(c)))
        else:
            raise ValueError(f"{path}: unknown keyword {kw!r}")
    if size is None:
        raise ValueError(f"{path}: missing 'size'")
    return size, cps, walls

def to_ascii(size, cps, walls, cell_width=None):
    if cell_width is None:
        max_len = max((len(str(v)) for v in cps.values()), default=1)
        cell_width = max(3, max_len + 1)
    W = cell_width
    h_walls = {(r, c) for t, r, c in walls if t == 'H'}
    v_walls = {(r, c) for t, r, c in walls if t == 'V'}
    solid = '+' + ('-' * W + '+') * size
    lines = [solid]
    for r in range(size):
        row = '|'
        for c in range(size):
            val = cps.get((r, c))
            row += (str(val) if val is not None else '').center(W)
            row += ('|' if (r, c) in v_walls else ' ') if c < size - 1 else '|'
        lines.append(row)
        if r < size - 1:
            border = '+'
            for c in range(size):
                border += ('-' * W if (r, c) in h_walls else ' ' * W) + '+'
            lines.append(border)
        else:
            lines.append(solid)
    return '\n'.join(lines)

def canonical(path):
    return to_ascii(*parse(path))

def main(folder):
    seen = {}   # sha256 -> (path, ascii)
    n = 0
    for p in sorted(pathlib.Path(folder).rglob('*')):
        if not p.is_file() or p.suffix.lower() not in PUZZLE_SUFFIXES:
            continue
        try:
            art = canonical(p)
        except Exception as e:
            print(f"::warning file={p} :  {e}")
            continue
        h = hashlib.sha256(art.encode()).hexdigest()
        n += 1
        if h in seen:
            other_path, other_art = seen[h]
            print(f"::error file={p}::duplicate of {other_path}")
            print(f"--- {other_path} ---")
            print(other_art)
            print(f"--- {p} ---")
            print(art)
            return 1
        seen[h] = (p, art)
    print(f"OK: {n} distinct puzzles")
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))