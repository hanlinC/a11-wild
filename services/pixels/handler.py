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
import sys
import tempfile
import types

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import cap_check  # noqa: E402
import food_crop  # noqa: E402
import pack_check  # noqa: E402
import photo_finish  # noqa: E402
import product_lock  # noqa: E402

# A picture over this many pixels is refused before it is decoded (a final is 1536 x 1920, under 3 million).
Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_BYTES = 12_000_000
FORMATS = ["JPEG", "PNG", "WEBP"]


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

    def pack(self):
        """The packshot, its silhouette mask and the product's box in it.

        A packshot with its own transparency gives the mask; any other needs a plain backdrop, which `cutout` removes.
        """
        path = self.fetch("packKey")
        mask_path = os.path.join(self.folder, "mask.png")
        with Image.open(path, formats=FORMATS) as picture:
            alpha = np.asarray(picture.convert("RGBA").getchannel("A")) if "A" in picture.getbands() or "transparency" in picture.info else None
        if alpha is not None and alpha.min() <= 128:
            Image.fromarray(alpha, "L").save(mask_path)
        else:
            options = self.input.get("cutout") or {}
            run(product_lock.cutout, types.SimpleNamespace(
                packshot=path, out=mask_path,
                dark_max=int(options.get("darkMax", 48)), light_sat=float(options.get("lightSat", 0.17)), light_min=int(options.get("lightMin", 150)),
                open=int(options.get("open", 3)), smooth=float(options.get("smooth", 0)), erode=int(options.get("erode", 1)),
                edges=str(options.get("edges", "top,bottom,left,right")),
            ))
        if self.input.get("box") is not None:
            box = numbers(self.input["box"], 4, "box")
        else:
            ys, xs = np.where(np.asarray(Image.open(mask_path)) > 128)
            if len(xs) == 0:
                raise Refused("No product was found in the pack photo.")
            box = f"{xs.min()},{ys.min()},{xs.max() + 1},{ys.max() + 1}"
        return path, mask_path, box

    def plan(self):
        plan = self.input.get("plan")
        if not isinstance(plan, dict):
            raise Refused("The job has no layout plan.")
        if any(isinstance(product, dict) and ("photo" in product or "alpha" in product) for product in plan.get("products") or []):
            raise Refused("A plan product cannot name its own file here: every product is the pack photo.")
        path = os.path.join(self.folder, "plan.json")
        with open(path, "w") as file:
            json.dump(plan, file)
        return path

    def out(self, ext="jpg"):
        return os.path.join(self.folder, f"out.{ext}")


def skeleton(job):
    pack, mask, box = job.pack()
    out = job.out()
    if job.input.get("plan") is not None:
        _, line = run(product_lock.layout, types.SimpleNamespace(packshot=pack, box=box, alpha=mask, plan=job.plan(), out=out))
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


TOOLS = {
    "skeleton": skeleton,
    "reprint": reprint,
    "swap": swap,
    "pack_check": check_pack,
    "cap_check": check_cap,
    "photo_finish": finish,
    "food_crop": crop_food,
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
