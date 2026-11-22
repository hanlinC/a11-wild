"""The pixel tools as one AWS Lambda function.

The API sends one job: a tool name, the keys of the pictures it reads (the API looked them up; an agent never types a
key), the key the new picture goes to, and the key of the result. The function reads and writes the picture store and
nothing else: it has no table, no provider key and calls no other service. It always writes a result, so a job that
failed says why.

  event  = {"jobId", "batchId", "tool", "input": {...}, "resultKey", "outKey"?}
  result = {"ok": true, "tool", "line", "passed"?, "imageKey"?, "type"?} or {"ok": false, "tool", "error"}
"""
import contextlib
import io
import json
import os
import re
import sys
import tempfile
import types

import numpy as np
from PIL import Image, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import box_print  # noqa: E402
import cap_check  # noqa: E402
import food_crop  # noqa: E402
import food_grade  # noqa: E402
import headline  # noqa: E402
import pack_check  # noqa: E402
import photo_finish  # noqa: E402
import product_lock  # noqa: E402

# A picture over this many pixels is refused before it is decoded (a final is 1536 x 1920, under 3 million).
Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_BYTES = 12_000_000
FORMATS = ["JPEG", "PNG", "WEBP"]
# A font file: TrueType, OpenType, WOFF or WOFF2, told by its first bytes.
FONT_MAGIC = (b"\x00\x01\x00\x00", b"true", b"OTTO", b"wOFF", b"wOF2")
MAX_FONT_BYTES = 5_000_000


class Refused(Exception):
    """The job cannot run as asked. The message goes back to the agent."""


def read_prefix_ok(key):
    return isinstance(key, str) and ".." not in key and key.startswith(("brands/", "products/", "batches/"))


class S3Store:
    def __init__(self, bucket):
        import boto3

        self.bucket = bucket
        self.s3 = boto3.client("s3")

    def get(self, key, path):
        head = self.s3.head_object(Bucket=self.bucket, Key=key)
        if head["ContentLength"] > MAX_BYTES:
            raise Refused("A picture is over 12 MB.")
        self.s3.download_file(self.bucket, key, path)

    def put(self, key, path, content_type):
        self.s3.upload_file(path, self.bucket, key, ExtraArgs={"ContentType": content_type})

    def put_json(self, key, value):
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=json.dumps(value).encode(), ContentType="application/json")


def run(fn, *args):
    """Runs one tool. Gives (what it returned, what it printed); a sys.exit with words is a refusal."""
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = fn(*args)
    except SystemExit as stop:
        if isinstance(stop.code, str):
            raise Refused(stop.code) from None
        code = stop.code
    return code, out.getvalue().strip()


def four_by_five(path, what):
    with Image.open(path, formats=FORMATS) as picture:
        width, height = picture.size
    if abs(width * 5 - height * 4) > 4:
        raise Refused(f"{what} is {width} x {height}: the studio makes 4:5 pictures only.")
    return width, height


def numbers(value, count, name, whole=True):
    ok = isinstance(value, list) and len(value) == count and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)
    if not ok or (whole and any(int(v) != v for v in value)):
        raise Refused(f"{name} needs {count} {'whole ' if whole else ''}numbers.")
    return ",".join(str(int(v)) if whole else repr(float(v)) for v in value)


def colour(value, name):
    text = str(value).lstrip("#")
    if len(text) != 6 or any(c not in "0123456789abcdefABCDEF" for c in text):
        raise Refused(f"{name} needs a colour as RRGGBB.")
    return text


class Job:
    def __init__(self, store, event, folder):
        self.store, self.event, self.folder = store, event, folder
        self.input = event.get("input") or {}
        self.count = 0

    def fetch(self, name):
        key = self.input.get(name)
        if not read_prefix_ok(key):
            raise Refused(f"The job names no picture for {name}.")
        self.count += 1
        path = os.path.join(self.folder, f"in{self.count}{os.path.splitext(key)[1].lower() or '.jpg'}")
        self.store.get(key, path)
        with Image.open(path, formats=FORMATS) as picture:  # refuses any other file type, and a picture that is too large
            picture.load()
        return path

    def font(self, name):
        """A font file of the brand. It is opened here once, so a file that is no font is refused before a tool reads it."""
        key = self.input.get(name)
        if not read_prefix_ok(key) or "/fonts/" not in key:
            raise Refused("The job names no font file.")
        self.count += 1
        path = os.path.join(self.folder, f"font{self.count}{os.path.splitext(key)[1].lower()}")
        self.store.get(key, path)
        with open(path, "rb") as file:
            head = file.read(4)
        if os.path.getsize(path) > MAX_FONT_BYTES or not head.startswith(FONT_MAGIC):
            raise Refused("The font file is not a TrueType, OpenType, WOFF or WOFF2 font.")
        try:
            ImageFont.truetype(path, 40)
        except OSError:
            raise Refused("The font file cannot be read.") from None
        return path

    def cut(self, path, options=None, box=None):
        """The silhouette mask of a real photo, and the product's box in it.

        A photo with its own transparency gives the mask; any other needs a plain backdrop, which `cutout` removes.
        """
        self.count += 1
        mask_path = os.path.join(self.folder, f"mask{self.count}.png")
        with Image.open(path, formats=FORMATS) as picture:
            alpha = np.asarray(picture.convert("RGBA").getchannel("A")) if "A" in picture.getbands() or "transparency" in picture.info else None
        if alpha is not None and alpha.min() <= 128:
            Image.fromarray(alpha, "L").save(mask_path)
        else:
            options = options or {}
            run(product_lock.cutout, types.SimpleNamespace(
                packshot=path, out=mask_path,
                dark_max=int(options.get("darkMax", 48)), light_sat=float(options.get("lightSat", 0.17)), light_min=int(options.get("lightMin", 150)),
                open=int(options.get("open", 3)), smooth=float(options.get("smooth", 0)), erode=int(options.get("erode", 1)),
                edges=str(options.get("edges", "top,bottom,left,right")),
            ))
        if box is not None:
            box = numbers(box, 4, "box")
        else:
            ys, xs = np.where(np.asarray(Image.open(mask_path)) > 128)
            if len(xs) == 0:
                raise Refused("No product was found in the photo.")
            box = f"{xs.min()},{ys.min()},{xs.max() + 1},{ys.max() + 1}"
        return mask_path, box

    def pack(self):
        """The packshot, its silhouette mask and the product's box in it."""
        path = self.fetch("packKey")
        mask_path, box = self.cut(path, self.input.get("cutout"), self.input.get("box"))
        return path, mask_path, box

    def plan(self, pack=None, mask=None):
        """The layout plan as a file. A product of the plan is the pack photo, or another real photo of the product that the API named
        (`photoKey`: a cake slice of each flavour, a real prop); never a file an agent typed. With `vary`, each pack of a row gets its
        own arrangement of the real food, so the row does not show the same kernels again and again."""
        plan = self.input.get("plan")
        if not isinstance(plan, dict):
            raise Refused("The job has no layout plan.")
        products = plan.get("products") or []
        if any(isinstance(product, dict) and ("photo" in product or "alpha" in product) for product in products):
            raise Refused("A plan product cannot name its own file here: it is the pack photo, or a saved photo of the product by its name.")
        plan = {**plan, "products": [dict(product) if isinstance(product, dict) else product for product in products]}
        own = [product for product in plan["products"] if isinstance(product, dict) and "photoKey" in product]
        if len(own) > 12:
            raise Refused("A plan takes 12 products with their own photo or fewer.")
        fetched = {}
        for product in own:
            key = product.pop("photoKey")
            if key not in fetched:
                self.input["_photo"] = key
                photo = self.fetch("_photo")
                fetched[key] = (photo, *self.cut(photo, product.get("cutout")))
            photo, alpha, box = fetched[key]
            product.pop("cutout", None)
            product.update(photo=os.path.basename(photo), alpha=os.path.basename(alpha))
            product.setdefault("box", [int(v) for v in box.split(",")])
        vary = self.input.get("vary")
        rest = [product for product in plan["products"] if isinstance(product, dict) and "photo" not in product]
        if vary is not None and pack is not None and len(rest) > 1:
            if not isinstance(vary, dict) or not isinstance(vary.get("regions"), list) or not 1 <= len(vary["regions"]) <= 6:
                raise Refused("vary needs 1 to 6 food regions of the pack photo.")
            prefix = os.path.join(self.folder, "vary")
            run(product_lock.vary_food, types.SimpleNamespace(
                packshot=pack, region=[numbers(region, 4, "region") for region in vary["regions"]], count=len(rest), seed=int(vary.get("seed", 7)), extra_src=None,
                edge=int(vary.get("edge", 34)), overlap=int(vary.get("overlap", 18)), feather=int(vary.get("feather", 7)),
                strip_min=int(vary.get("stripMin", 90)), strip_max=int(vary.get("stripMax", 125)), out_prefix=prefix,
            ))
            for number, product in enumerate(rest, start=1):  # copy 1 is the photo unchanged
                product.update(photo=f"vary{number}.jpg", alpha=os.path.basename(mask))
        path = os.path.join(self.folder, "plan.json")
        with open(path, "w") as file:
            json.dump(plan, file)
        return path

    def out(self, ext="jpg"):
        return os.path.join(self.folder, f"out.{ext}")


def skeleton(job):
    out = job.out()
    if job.input.get("packKey") is None:
        # A product with no pack (a cake, a dish): every item of the plan is a saved real photo of the product.
        plan = job.input.get("plan")
        products = plan.get("products") if isinstance(plan, dict) else None
        if not products or any(not isinstance(product, dict) or "photoKey" not in product for product in products):
            raise Refused("With no pack photo, each item of the plan names a saved real photo of the product.")
        _, line = run(product_lock.layout, types.SimpleNamespace(packshot=None, box=None, alpha=None, plan=job.plan(), out=out))
        four_by_five(out, "The skeleton")
        return {"line": line}, out
    pack, mask, box = job.pack()
    if job.input.get("plan") is not None:
        _, line = run(product_lock.layout, types.SimpleNamespace(packshot=pack, box=box, alpha=mask, plan=job.plan(pack, mask), out=out))
    else:
        size = job.input.get("size", [1024, 1280])
        _, line = run(product_lock.skeleton, types.SimpleNamespace(
            packshot=pack, box=box, alpha=mask, size=numbers(size, 2, "size"), bg="#" + colour(job.input.get("bg"), "bg"),
            jar_height=float(job.input.get("height", 0.5)), cx=float(job.input.get("cx", 0.5)), base=float(job.input.get("base", 0.9)),
            count=int(job.input.get("count", 1)), gap=float(job.input.get("gap", 0.18)), out=out,
        ))
    four_by_five(out, "The skeleton")
    return {"line": line, "box": [int(v) for v in box.split(",")]}, out


def reprint(job):
    pack, mask, box = job.pack()
    render = job.fetch("renderKey")
    four_by_five(render, "The render")
    out = job.out()
    _, line = run(product_lock.reprint, types.SimpleNamespace(
        packshot=pack, box=box, alpha=mask, face=numbers(job.input.get("face"), 4, "face"), plan=job.plan(), render=render, out=out, debug=None,
        min_score=float(job.input.get("minScore", 0.8)), search_scale=0.08, search_rot=1.5, search_px=70, light_px=14,
    ))
    return {"line": line}, out


def swap(job):
    pack, mask, box = job.pack()
    scene = job.fetch("renderKey")
    four_by_five(scene, "The picture")
    out = job.out()
    lower = bool(job.input.get("lowerOnly"))
    _, line = run(product_lock.swap, types.SimpleNamespace(
        packshot=pack, box=box, alpha=None if lower else mask, scene=scene, old=numbers(job.input.get("old"), 4, "old"),
        scale=job.input.get("scale"), cx=job.input.get("cx"), lower_only=lower, band_top=job.input.get("bandTop"), out=out,
    ))
    return {"line": line}, out


def measured(code, line):
    """A check script returns 0 for a pass and 1 for a fail. Anything else is no measurement."""
    if code not in (0, 1):
        raise Refused("The check could not measure that picture.")
    return {"line": line, "passed": code == 0}, None


def check_pack(job):
    _, mask, _ = job.pack()
    render = job.fetch("renderKey")
    four_by_five(render, "The render")
    at = numbers(job.input.get("at"), 2, "at")
    if job.input.get("around") is not None:
        # A pack that stands on something: measure inside a box that ends at its base, so the thing below is not taken as pack.
        x0, y0, x1, y1 = (int(v) for v in numbers(job.input["around"], 4, "box").split(","))
        x, y = (int(v) for v in at.split(","))
        with Image.open(render) as picture:
            if not (0 <= x0 < x1 <= picture.width and 0 <= y0 < y1 <= picture.height and x0 <= x < x1 and y0 <= y < y1):
                raise Refused("box must lie inside the picture and hold the point `at`.")
            render = os.path.join(job.folder, "boxed.png")
            picture.convert("RGB").crop((x0, y0, x1, y1)).save(render)
        at = f"{x - x0},{y - y0}"
    argv = ["--render", render, "--at", at, "--bg", colour(job.input.get("bg"), "bg"), "--packshot", mask]
    argv += ["--tolerance", repr(float(job.input.get("tolerance", 0.02)))]
    if job.input.get("sideways"):
        argv.append("--sideways")
    if job.input.get("tilted"):
        argv.append("--tilted")
    return measured(*run(pack_check.main, argv))


def check_cap(job):
    render = job.fetch("renderKey")
    four_by_five(render, "The render")
    split = job.input.get("split")
    if not isinstance(split, int) or isinstance(split, bool):
        raise Refused("split needs a whole number.")
    argv = ["--render", render, "--box", numbers(job.input.get("box"), 4, "box"), "--split", str(split)]
    argv += ["--tolerance", repr(float(job.input.get("tolerance", 0.01)))]
    return measured(*run(cap_check.main, argv))


def finish(job):
    source = job.fetch("renderKey")
    four_by_five(source, "The picture")
    seed = job.input.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise Refused("seed needs a whole number, so the same picture gets the same grain.")
    out = job.out()
    argv = ["--in", source, "--out", out, "--seed", str(seed), "--strength", repr(float(job.input.get("strength", 1.0)))]
    for box in job.input.get("sharp") or []:
        argv += ["--sharp", numbers(box, 4, "sharp", whole=False)]
    for value in job.input.get("keep") or []:
        argv += ["--keep", colour(value, "keep")]
    code, line = run(photo_finish.main, argv)
    if code not in (0, None):
        raise Refused(line or "The finish did not run.")
    return {"line": line}, out


def crop_food(job):
    render = job.fetch("renderKey")
    four_by_five(render, "The render")
    food = job.fetch("foodKey")
    out = job.out()
    box = [int(v) for v in numbers(job.input.get("box"), 4, "box").split(",")]
    line, _ = run(food_crop.side_by_side, render, box, food, out)
    return {"line": line}, out


def logo_png(job, path):
    """The brand logo as a PNG with a clear backdrop, which the type tool needs. A logo on a plain backdrop loses that backdrop;
    `logoColour` gives a one-colour version (a light logo for a dark picture)."""
    with Image.open(path, formats=FORMATS) as picture:
        logo = picture.convert("RGBA")
    pixels = np.asarray(logo).astype(float)
    if pixels[..., 3].min() > 128:  # no clear part: the backdrop is the colour of the corners
        corners = np.array([pixels[0, 0, :3], pixels[0, -1, :3], pixels[-1, 0, :3], pixels[-1, -1, :3]])
        if np.abs(corners - corners.mean(axis=0)).max() > 12:
            raise Refused("The saved logo has no clear backdrop and no plain one. Save a logo with a transparent or plain backdrop.")
        distance = np.sqrt(((pixels[..., :3] - corners.mean(axis=0)) ** 2).sum(axis=2))
        pixels[..., 3] = np.clip((distance - 18) / 60, 0, 1) * 255
    if job.input.get("logoColour") is not None:
        fill = colour(job.input["logoColour"], "logoColour")
        pixels[..., :3] = [int(fill[i:i + 2], 16) for i in (0, 2, 4)]
    out = os.path.join(job.folder, "logo.png")
    Image.fromarray(pixels.astype(np.uint8), "RGBA").save(out)
    return out


def fraction(value, name, low=0.0, high=1.0):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not low <= value <= high:
        raise Refused(f"{name} needs a number from {low} to {high}.")
    return repr(float(value))


def words(value, name, limit, needed=False):
    if not isinstance(value, str) or len(value) > limit or (needed and not value.strip()):
        raise Refused(f"{name} needs {'words' if needed else 'text'} of {limit} characters or fewer.")
    return value


# The script names its own command-line flags. A client of the studio sets the tool's fields, and two limits it cannot set at all.
TYPE_FIELDS = {
    "--min-logo-gap": "the least gap",
    "--min-margin": "the least margin",
    "--min-clear": "the least clear space",
    "--min-head": "minHead",
    "--product-top": "productTop",
    "--logo-width": "logoWidth",
    "--logo-top": "logoTop",
    "--logo-x": "logoX",
    "--footnote-align": "footnoteAlign",
    "--footnote-y": "footnoteY",
    "--accent-color": "accentColour",
    "--sub-ratio": "subRatio",
    "--color": "colour",
}


def tool_words(line):
    """A refusal of the headline script, in the words of the tool's fields."""
    for flag, field in TYPE_FIELDS.items():
        line = line.replace(flag, field)
    return re.sub(r"--([a-z]+)", r"\1", line)


def set_type(job):
    """The approved words and the real logo, set in the brand's own font. The words come from the API, which read them from the
    owner's approval: an agent cannot type them here."""
    source = job.fetch("renderKey")
    four_by_five(source, "The picture")
    out = job.out()
    given = job.input
    argv = ["--in", source, "--out", out, "--font", job.font("fontKey")]
    if given.get("subFontKey") is not None:
        argv += ["--sub-font", job.font("subFontKey")]
    argv += ["--headline", words(given.get("headline"), "headline", 200, needed=True), "--subline", words(given.get("subline", ""), "subline", 200)]
    argv += ["--area", numbers(given.get("area"), 4, "area", whole=False), "--color", colour(given.get("colour", "000000"), "colour")]
    for flag, name, choices in (("--align", "align", ("left", "right", "center")), ("--case", "case", ("asis", "upper")), ("--sub-case", "subCase", ("asis", "upper")), ("--footnote-align", "footnoteAlign", ("left", "right"))):
        if given.get(name) is not None:
            if given[name] not in choices:
                raise Refused(f"{name} is one of: {', '.join(choices)}.")
            argv += [flag, given[name]]
    for flag, name, low, high in (
        ("--wght", "weight", 100, 1000), ("--sub-wght", "subWeight", 100, 1000), ("--sub-ratio", "subRatio", 0.2, 1), ("--gap", "gap", 0, 2), ("--leading", "leading", 0.8, 2),
        ("--min-head", "minHead", 0, 0.5), ("--product-top", "productTop", 0.01, 1), ("--min-clear", "minClear", 0.03, 0.5), ("--logo-width", "logoWidth", 0.02, 1),
        ("--logo-top", "logoTop", 0, 0.9), ("--logo-x", "logoX", 0, 1), ("--footnote-size", "footnoteSize", 0.008, 0.05), ("--footnote-y", "footnoteY", 0.5, 0.99),
    ):
        if given.get(name) is not None:
            argv += [flag, fraction(given[name], name, low, high)]
    if given.get("accent"):
        argv += ["--accent", words(given["accent"], "accent", 120), "--accent-color", colour(given.get("accentColour"), "accentColour")]
    if given.get("footnote"):
        argv += ["--footnote", words(given["footnote"], "footnote", 200)]
    if given.get("logoKey") is not None:
        argv += ["--logo", logo_png(job, job.fetch("logoKey"))]
    try:
        code, line = run(headline.main, argv)
    except Refused as stop:
        raise Refused(tool_words(str(stop))) from None
    if code not in (0, None):
        raise Refused(line or "The words were not set.")
    return {"line": line}, out


def grade_food(job):
    """The food in a picture, moved toward the colour of a real close-up of the same food. Only colour moves: texture and shape stay."""
    source = job.fetch("renderKey")
    reference = job.fetch("foodKey")
    regions = job.input.get("regions")
    if not isinstance(regions, list) or not 1 <= len(regions) <= 8:
        raise Refused("regions needs 1 to 8 boxes where the food shows.")
    box = lambda value, name: tuple(int(v) for v in numbers(value, 4, name).split(","))  # noqa: E731
    strength = float(job.input.get("strength", 0.8))
    if not 0 <= strength <= 1:
        raise Refused("strength is from 0 to 1: a food colour is never pushed past the real photo.")
    backdrop = tuple(int(v) for v in numbers(job.input.get("refBg", [245, 230, 210]), 3, "refBg").split(","))
    out = job.out()
    try:
        with Image.open(source, formats=FORMATS) as picture, Image.open(reference, formats=FORMATS) as close_up:
            graded, (before, after) = food_grade.grade(
                picture, [box(region, "region") for region in regions], close_up, box(job.input.get("refBox"), "refBox"), strength,
                ref_bg=backdrop, dist=float(job.input.get("dist", 70)), sat_min=float(job.input.get("satMin", 0.28)),
            )
    except ValueError as error:
        raise Refused(str(error)) from None
    graded.save(out, quality=95)
    return {"line": f"Lab mean of the food {before.round(1).tolist()} -> {after.round(1).tolist()}"}, out


def relight(job):
    scene = job.fetch("renderKey")
    out = job.out()
    given = job.input
    _, line = run(product_lock.relight, types.SimpleNamespace(
        scene=scene, box=numbers(given.get("box"), 4, "box"), light=str(given.get("light")), floor=numbers(given.get("floor", [120, 80, 55]), 3, "floor"),
        shade=float(given.get("shade", 0.30)), edge=float(given.get("edge", 0.12)), bounce=float(given.get("bounce", 0.14)), bounce_zone=float(given.get("bounceZone", 0.22)),
        contact=float(given.get("contact", 0.55)), contact_blur=float(given.get("contactBlur", 9)), out=out,
    ))
    return {"line": line}, out


def print_box(job):
    """The print of a box, put back crisp from the real pack photo at the box's own angle."""
    pack = job.fetch("packKey")
    render = job.fetch("renderKey")
    four_by_five(render, "The picture")
    blocks = job.input.get("blocks")
    if not isinstance(blocks, list) or not 1 <= len(blocks) <= 12 or not all(isinstance(block, dict) for block in blocks):
        raise Refused("blocks needs 1 to 12 print blocks.")
    whole = lambda value, name: [int(v) for v in numbers(value, 4, name).split(",")]  # noqa: E731
    made = []
    for block in blocks:
        if "typeset" in block:
            raise Refused("A block is put back from the pack photo's own ink here. Leave typeset out, and use a larger pack photo when the print is too small to read.")
        entry = {"box": whole(block.get("box"), "A block's box")}
        for name in ("thr", "ink_rel", "xmin", "band"):
            if block.get(name) is not None:
                entry[name] = block[name]
        made.append(entry)
    out = job.out()
    _, line = run(box_print.run, {"packshot": pack, "face": whole(job.input.get("face"), "face"), "blocks": made}, render, out)
    return {"line": line}, out


def pad_pack(job):
    """The pack photo padded to 4:5, for the model to take the cap off at the photo's own camera angle."""
    pack = job.fetch("packKey")
    out = job.out()
    _, line = run(product_lock.pad45, types.SimpleNamespace(packshot=pack, out=out))
    return {"line": line}, out


def open_pack(job):
    """An open product: the model's open neck over the real photo, which stays real from the label's top band down."""
    padded = job.fetch("paddedKey")
    edit = job.fetch("renderKey")
    given = job.input
    real_from = given.get("realFrom")
    if not isinstance(real_from, int) or isinstance(real_from, bool):
        raise Refused("realFrom needs a whole number.")
    out = job.out()
    _, line = run(product_lock.open_source, types.SimpleNamespace(
        padded=padded, edit=edit, real_from=real_from, strip=numbers(given.get("strip"), 2, "strip"), repeat=int(given.get("repeat", 1)),
        neck=numbers(given["neck"], 3, "neck") if given.get("neck") is not None else None, neck_widen=float(given.get("neckWiden", 1.05)),
        cx=float(given["cx"]) if given.get("cx") is not None else None, out=out,
    ))
    return {"line": line}, out


TOOLS = {
    "skeleton": skeleton,
    "reprint": reprint,
    "swap": swap,
    "pack_check": check_pack,
    "cap_check": check_cap,
    "photo_finish": finish,
    "food_crop": crop_food,
    "headline": set_type,
    "food_grade": grade_food,
    "relight": relight,
    "box_print": print_box,
    "pack_pad": pad_pack,
    "pack_open": open_pack,
}


def work(event, store):
    tool = event.get("tool")
    result_key = event.get("resultKey")
    if not isinstance(result_key, str) or not result_key.startswith("jobs/") or ".." in result_key:
        raise ValueError("the job has no result key")
    try:
        if tool not in TOOLS:
            raise Refused(f"There is no pixel tool {tool}.")
        with tempfile.TemporaryDirectory() as folder:
            result, out = TOOLS[tool](Job(store, event, folder))
            result["line"] = result["line"].replace(folder + os.sep, "")
            if out is not None:
                out_key = event.get("outKey")
                if not isinstance(out_key, str) or not out_key.startswith(f"batches/{event.get('batchId')}/") or ".." in out_key:
                    raise ValueError("the job has no key for its picture")
                store.put(out_key, out, "image/jpeg")
                result = {**result, "imageKey": out_key, "type": "image/jpeg"}
        answer = {"ok": True, "tool": tool, **result}
    except Refused as refusal:
        answer = {"ok": False, "tool": tool, "error": str(refusal)[:600]}
    except Exception as error:  # the agent gets a plain line; the log gets the kind of error and never the picture
        print(json.dumps({"level": "error", "event": "pixel_job_failed", "tool": tool, "job": event.get("jobId"), "kind": type(error).__name__}))
        answer = {"ok": False, "tool": tool, "error": "The tool could not read or work on that picture."}
    store.put_json(result_key, answer)
    return answer


_store = None


def handler(event, _context):
    global _store
    if _store is None:
        _store = S3Store(os.environ["PICTURES_BUCKET"])
    answer = work(event, _store)
    print(json.dumps({"level": "info", "event": "pixel_job", "tool": answer.get("tool"), "job": event.get("jobId"), "ok": answer["ok"]}))
    return {"ok": answer["ok"]}
