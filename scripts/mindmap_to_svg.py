"""Sinh mind map SVG từ file outline thụt lề 2 dấu cách.

Dòng đầu là chủ đề trung tâm (dùng "\\n" để xuống dòng); mỗi cấp con thụt thêm 2 dấu cách.
Hậu tố " [ADV]" trên nhãn được vẽ thành huy hiệu "ADV".

Dùng:  python scripts/mindmap_to_svg.py assets/mindmaps/problem-decomposition.txt
       (ghi ra file .svg cùng tên, cạnh file outline)
"""

import sys
from pathlib import Path
from xml.sax.saxutils import escape

try:
    from PIL import ImageFont
except ImportError:  # vẫn chạy được, chỉ ước lượng độ rộng chữ
    ImageFont = None

FONT_FAMILY = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
FONT_FILES = {
    "regular": ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"],
    "semibold": ["seguisb.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"],
    "bold": ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"],
}
WEIGHTS = {"regular": 400, "semibold": 600, "bold": 700}

# Màu nhánh cấp 1 (đủ đậm để chữ trắng đọc được).
PALETTE = [
    "#E03131", "#E8590C", "#2B8A3E", "#0B7285", "#1864AB",
    "#5F3DC4", "#A61E4D", "#862E9C", "#495057",
]
ROOT_FILL = "#0F172A"

# Kiểu theo cấp: cỡ chữ, độ đậm, padding ngang/dọc, khoảng cách anh em, khoảng cách tới cấp con, nét nối.
LEVELS = {
    0: dict(size=22, weight="bold", px=30, py=18, gap=0, hgap=70, stroke=4.0, radius=16),
    1: dict(size=16, weight="bold", px=16, py=10, gap=28, hgap=46, stroke=3.0, radius=10),
    2: dict(size=13.5, weight="semibold", px=12, py=7, gap=10, hgap=36, stroke=1.8, radius=8),
    3: dict(size=12.5, weight="regular", px=10, py=5, gap=6, hgap=30, stroke=1.2, radius=6),
}
BADGE = dict(size=9.5, weight="bold", px=6, h=16, gap=7)
MARGIN = 40

_font_cache = {}


def text_width(text, size, weight):
    if ImageFont is not None:
        key = (size, weight)
        if key not in _font_cache:
            _font_cache[key] = None
            for name in FONT_FILES[weight]:
                try:
                    _font_cache[key] = ImageFont.truetype(name, round(size * 4))
                    break
                except OSError:
                    continue
        font = _font_cache[key]
        if font is not None:
            return font.getlength(text) / 4
    return len(text) * size * (0.6 if weight != "regular" else 0.55)


def mix(hex_color, ratio):
    """Pha màu với trắng; ratio = phần màu gốc giữ lại."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return "#{:02X}{:02X}{:02X}".format(*(round(c * ratio + 255 * (1 - ratio)) for c in (r, g, b)))


def darken(hex_color, ratio):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return "#{:02X}{:02X}{:02X}".format(*(round(c * ratio) for c in (r, g, b)))


class Node:
    def __init__(self, label, depth):
        self.adv = label.endswith("[ADV]")
        label = label[: -len("[ADV]")].rstrip() if self.adv else label
        self.lines = label.split("\\n")
        self.depth = depth
        self.children = []
        self.color = None
        st = LEVELS[min(depth, 3)]
        self.style = st
        line_w = max(text_width(t, st["size"], st["weight"]) for t in self.lines)
        if self.adv:
            line_w += BADGE["gap"] + text_width("ADV", BADGE["size"], BADGE["weight"]) + 2 * BADGE["px"]
        self.w = line_w + 2 * st["px"]
        self.h = len(self.lines) * st["size"] * 1.3 + 2 * st["py"]
        self.x = self.y = 0.0  # tâm node
        self.side = 1


def parse(path):
    lines = [l.rstrip("\n") for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    root = Node(lines[0].strip(), 0)
    stack = [root]
    for raw in lines[1:]:
        depth = (len(raw) - len(raw.lstrip(" "))) // 2
        node = Node(raw.strip(), depth)
        while stack[-1].depth >= depth:
            stack.pop()
        stack[-1].children.append(node)
        stack.append(node)
    return root


def subtree_height(node):
    if not node.children:
        node.sub_h = node.h
    else:
        gap = node.children[0].style["gap"]
        total = sum(subtree_height(c) for c in node.children) + gap * (len(node.children) - 1)
        node.sub_h = max(node.h, total)
    return node.sub_h


def place(node, top, side):
    """Đặt node và con theo chiều dọc bắt đầu từ `top`; x tính theo cạnh node cha."""
    node.side = side
    node.y = top + node.sub_h / 2
    if not node.children:
        return
    gap = node.children[0].style["gap"]
    block = sum(c.sub_h for c in node.children) + gap * (len(node.children) - 1)
    cursor = node.y - block / 2
    for child in node.children:
        child.x = node.x + side * (node.w / 2 + node.style["hgap"] + child.w / 2)
        place(child, cursor, side)
        cursor += child.sub_h + gap


def assign_color(node, color):
    node.color = color
    for c in node.children:
        assign_color(c, color)


def layout(root):
    for c in root.children:
        subtree_height(c)
    branches = root.children
    for i, b in enumerate(branches):
        assign_color(b, PALETTE[i % len(PALETTE)])

    # Chia nhánh sang phải/trái sao cho chiều cao hai bên cân bằng; đọc theo chiều kim đồng hồ.
    total = sum(b.sub_h for b in branches)
    right, acc = [], 0.0
    for b in branches:
        if acc < total / 2 or not right:
            right.append(b)
            acc += b.sub_h
    left = list(reversed(branches[len(right):]))

    for side, group in ((1, right), (-1, left)):
        if not group:
            continue
        gap = LEVELS[1]["gap"]
        block = sum(b.sub_h for b in group) + gap * (len(group) - 1)
        cursor = -block / 2
        for b in group:
            b.x = side * (root.w / 2 + root.style["hgap"] + b.w / 2)
            place(b, cursor, side)
            cursor += b.sub_h + gap


def walk(node):
    yield node
    for c in node.children:
        yield from walk(c)


def edge_path(parent, child):
    side = child.side
    if parent.depth == 0:
        x1, y1 = parent.x + side * parent.w * 0.32, parent.y
    else:
        x1, y1 = parent.x + side * parent.w / 2, parent.y
    x2, y2 = child.x - side * child.w / 2, child.y
    mx = (x1 + x2) / 2
    return f"M{x1:.1f},{y1:.1f} C{mx:.1f},{y1:.1f} {mx:.1f},{y2:.1f} {x2:.1f},{y2:.1f}"


def render_node(n):
    st = n.style
    x0, y0 = n.x - n.w / 2, n.y - n.h / 2
    if n.depth == 0:
        fill, stroke, text_fill, sw = ROOT_FILL, ROOT_FILL, "#FFFFFF", 0
    elif n.depth == 1:
        fill, stroke, text_fill, sw = n.color, darken(n.color, 0.85), "#FFFFFF", 1
    elif n.depth == 2:
        fill, stroke, text_fill, sw = mix(n.color, 0.14), n.color, darken(n.color, 0.7), 1.5
    else:
        fill, stroke, text_fill, sw = "#FFFFFF", mix(n.color, 0.45), "#343A40", 1
    out = [
        f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{n.w:.1f}" height="{n.h:.1f}" rx="{st["radius"]}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'
    ]
    line_h = st["size"] * 1.3
    first_y = n.y - line_h * (len(n.lines) - 1) / 2
    if n.depth == 0:
        tx, anchor = n.x, "middle"
    else:
        tx, anchor = x0 + st["px"], "start"
    for i, line in enumerate(n.lines):
        out.append(
            f'<text x="{tx:.1f}" y="{first_y + i * line_h:.1f}" text-anchor="{anchor}" dominant-baseline="central" '
            f'font-size="{st["size"]}" font-weight="{WEIGHTS[st["weight"]]}" fill="{text_fill}">{escape(line)}</text>'
        )
    if n.adv:
        bw = text_width("ADV", BADGE["size"], BADGE["weight"]) + 2 * BADGE["px"]
        bx = x0 + n.w - st["px"] - bw
        by = n.y - BADGE["h"] / 2
        badge_fill, badge_text = ("#FFFFFF", n.color) if n.depth == 1 else (n.color, "#FFFFFF")
        out.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{bw:.1f}" height="{BADGE["h"]}" rx="8" fill="{badge_fill}"/>')
        out.append(
            f'<text x="{bx + bw / 2:.1f}" y="{n.y:.1f}" text-anchor="middle" dominant-baseline="central" '
            f'font-size="{BADGE["size"]}" font-weight="700" fill="{badge_text}">ADV</text>'
        )
    return out


def legend(has_adv, x, y):
    items = [
        ("Cấp 0 · Chủ đề trung tâm", ROOT_FILL, ROOT_FILL),
        ("Cấp 1 · Nhóm chính", PALETTE[4], PALETTE[4]),
        ("Cấp 2 · Nhóm con", mix(PALETTE[4], 0.14), PALETTE[4]),
        ("Cấp 3 · Chức năng / tương tác", "#FFFFFF", mix(PALETTE[4], 0.45)),
    ]
    out, cx = [], x
    for label, fill, stroke in items:
        out.append(f'<rect x="{cx:.1f}" y="{y - 7:.1f}" width="22" height="14" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.2"/>')
        out.append(f'<text x="{cx + 30:.1f}" y="{y:.1f}" dominant-baseline="central" font-size="12" fill="#495057">{escape(label)}</text>')
        cx += 30 + text_width(label, 12, "regular") + 26
    if has_adv:
        out.append(f'<rect x="{cx:.1f}" y="{y - 8:.1f}" width="34" height="16" rx="8" fill="{PALETTE[4]}"/>')
        out.append(f'<text x="{cx + 17:.1f}" y="{y:.1f}" text-anchor="middle" dominant-baseline="central" font-size="9.5" font-weight="700" fill="#FFFFFF">ADV</text>')
        out.append(f'<text x="{cx + 42:.1f}" y="{y:.1f}" dominant-baseline="central" font-size="12" fill="#495057">Phạm vi nâng cao</text>')
    return out


def build_svg(root):
    layout(root)
    nodes = list(walk(root))
    min_x = min(n.x - n.w / 2 for n in nodes) - MARGIN
    max_x = max(n.x + n.w / 2 for n in nodes) + MARGIN
    min_y = min(n.y - n.h / 2 for n in nodes) - MARGIN
    max_y = max(n.y + n.h / 2 for n in nodes) + MARGIN + 30  # chỗ cho chú giải
    width, height = max_x - min_x, max_y - min_y

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{min_x:.0f} {min_y:.0f} {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}" font-family="{FONT_FAMILY}">',
        f'<rect x="{min_x:.0f}" y="{min_y:.0f}" width="{width:.0f}" height="{height:.0f}" fill="#FFFFFF"/>',
        '<g fill="none" stroke-linecap="round">',
    ]
    for n in nodes:
        for c in n.children:
            color = c.color
            parts.append(f'<path d="{edge_path(n, c)}" stroke="{color if c.depth < 3 else mix(color, 0.6)}" stroke-width="{n.style["stroke"]}"/>')
    parts.append("</g>")
    for n in nodes:
        parts.extend(render_node(n))
    parts.extend(legend(any(n.adv for n in nodes), min_x + MARGIN, max_y - MARGIN / 2 - 6))
    parts.append("</svg>")
    return "\n".join(parts)


def main():
    for arg in sys.argv[1:]:
        src = Path(arg)
        out = src.with_suffix(".svg")
        out.write_text(build_svg(parse(src)), encoding="utf-8")
        print(f"Đã ghi {out}")


if __name__ == "__main__":
    main()
