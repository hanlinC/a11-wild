"""Food crop: the food of a render beside the brand's own photo of that food, as one picture.

Why (a11-adgen render checklist, D2): fake food shows only next to the real thing. A reader who sees the two side by
side at the same height can say whether the shapes, the colour and the surface are right.

The left half is the box cut from the render; the right half is the brand's photo. Both are scaled to one height.
"""
from PIL import Image

FORMATS = ["JPEG", "PNG", "WEBP"]
HEIGHT = 768
GAP = 16


def side_by_side(render_path, box, food_path, out_path):
    render = Image.open(render_path, formats=FORMATS).convert("RGB")
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= render.width and 0 <= y0 < y1 <= render.height) or x1 - x0 < 32 or y1 - y0 < 32:
        raise SystemExit(f"box {x0},{y0},{x1},{y1} is not inside the {render.width} x {render.height} picture, or is under 32 px")
    food = Image.open(food_path, formats=FORMATS).convert("RGB")
    parts = [fit(render.crop((x0, y0, x1, y1))), fit(food)]
    sheet = Image.new("RGB", (parts[0].width + GAP + parts[1].width, HEIGHT), (255, 255, 255))
    sheet.paste(parts[0], (0, 0))
    sheet.paste(parts[1], (parts[0].width + GAP, 0))
    sheet.save(out_path, quality=92)
    return f"left: the render's food ({x1 - x0} x {y1 - y0} px); right: the brand's photo ({food.width} x {food.height} px)"


def fit(picture):
    return picture.resize((max(1, round(picture.width * HEIGHT / picture.height)), HEIGHT), Image.LANCZOS)
