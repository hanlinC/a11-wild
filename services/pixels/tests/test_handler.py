"""Tests for the Lambda handler: a store in memory, synthetic pictures, no network."""
import importlib.util
import io
import json
import os
import unittest

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("handler", os.path.join(HERE, "handler.py"))
handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler)

STAGE = (232, 60, 40)


class MemoryStore:
    def __init__(self):
        self.files = {}

    def add(self, key, picture, fmt="PNG"):
        body = io.BytesIO()
        picture.save(body, format=fmt)
        self.files[key] = body.getvalue()

    def get(self, key, path):
        with open(path, "wb") as file:
            file.write(self.files[key])

    def put(self, key, path, content_type):
        with open(path, "rb") as file:
            self.files[key] = file.read()

    def put_json(self, key, value):
        self.files[key] = json.dumps(value).encode()

    def picture(self, key):
        return Image.open(io.BytesIO(self.files[key]))


def packshot(width=200, height=400):
    """A dark blue pack, 100 x 300, on a white backdrop."""
    a = np.full((height, width, 3), 255, np.uint8)
    a[50:350, 50:150] = (20, 40, 160)
    return Image.fromarray(a)


def render(pack_w, pack_h, size=(1024, 1280)):
    """A pack of the given size standing on a plain stage."""
    a = np.empty((size[1], size[0], 3), np.uint8)
    a[:] = STAGE
    x0, y0 = (size[0] - pack_w) // 2, 1100 - pack_h
    a[y0:1100, x0:x0 + pack_w] = (20, 40, 160)
    return Image.fromarray(a)


def bottle(shift):
    """A dark bottle on a light stage: a 200 px body with an 80 px cap, the cap `shift` px off centre."""
    a = np.full((1280, 1024, 3), 235, np.uint8)
    a[500:1000, 412:612] = 40
    a[400:500, 472 + shift:552 + shift] = 40
    return Image.fromarray(a)


class Handler(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.store.add("products/p/pack.png", packshot())

    def job(self, tool, **input):
        event = {"jobId": "j1", "batchId": "b1", "tool": tool, "input": input, "resultKey": "jobs/b1/j1.json", "outKey": "batches/b1/pixels/j1.jpg"}
        answer = handler.work(event, self.store)
        self.assertEqual(json.loads(self.store.files["jobs/b1/j1.json"]), answer)  # a result is always written
        return answer

    def test_a_skeleton_holds_the_real_pack_at_its_real_proportions(self):
        answer = self.job("skeleton", packKey="products/p/pack.png", bg="#E83C28", height=0.5)
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["imageKey"], "batches/b1/pixels/j1.jpg")
        box = answer["box"]
        self.assertTrue(abs(box[0] - 50) <= 2 and abs(box[1] - 50) <= 2 and abs(box[2] - 150) <= 2 and abs(box[3] - 350) <= 2, box)
        picture = self.store.picture(answer["imageKey"]).convert("RGB")
        self.assertEqual(picture.size, (1024, 1280))
        blue = np.asarray(picture)[..., 2] > 120
        ys, xs = np.where(blue)
        self.assertAlmostEqual((ys.max() - ys.min()) / (xs.max() - xs.min()), 3.0, delta=0.08)
        self.assertNotIn("/tmp", answer["line"])

    def test_a_packshot_with_its_own_transparency_needs_no_backdrop(self):
        rgba = packshot().convert("RGBA")
        alpha = np.zeros((400, 200), np.uint8)
        alpha[50:350, 50:150] = 255
        rgba.putalpha(Image.fromarray(alpha))
        self.store.add("products/p/cut.png", rgba)
        answer = self.job("skeleton", packKey="products/p/cut.png", bg="#E83C28", height=0.4)
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(answer["box"], [50, 50, 150, 350])

    def test_a_skeleton_from_a_plan_places_each_pack(self):
        plan = {"size": [1024, 1280], "bg": "#E83C28", "products": [{"cx": 0.3, "base": 0.8, "height": 0.3}, {"cx": 0.7, "base": 0.8, "height": 0.3}]}
        answer = self.job("skeleton", packKey="products/p/pack.png", plan=plan)
        self.assertTrue(answer["ok"], answer)
        blue = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB"))[..., 2] > 120
        self.assertTrue(blue[:, :512].any() and blue[:, 512:].any())

    def test_a_plan_cannot_name_a_file(self):
        plan = {"products": [{"cx": 0.5, "base": 0.8, "height": 0.3, "photo": "/etc/passwd"}]}
        answer = self.job("skeleton", packKey="products/p/pack.png", plan=plan)
        self.assertFalse(answer["ok"])
        self.assertIn("cannot name its own file", answer["error"])

    def test_pack_check_passes_the_real_proportions_and_fails_a_squat_pack(self):
        self.store.add("batches/b1/drafts/good.png", render(150, 450))
        self.store.add("batches/b1/drafts/squat.png", render(170, 450))
        good = self.job("pack_check", packKey="products/p/pack.png", renderKey="batches/b1/drafts/good.png", at=[512, 900], bg="E83C28")
        self.assertTrue(good["ok"] and good["passed"], good)
        squat = self.job("pack_check", packKey="products/p/pack.png", renderKey="batches/b1/drafts/squat.png", at=[512, 900], bg="E83C28")
        self.assertTrue(squat["ok"], squat)
        self.assertFalse(squat["passed"])
        self.assertIn("FAIL", squat["line"])
        self.assertNotIn("imageKey", squat)

    def test_pack_check_measures_a_pack_that_stands_on_something_inside_a_box(self):
        on_plinth = np.asarray(render(150, 450)).copy()
        on_plinth[1100:1250, 300:724] = (120, 110, 100)  # a plinth under the pack
        self.store.add("batches/b1/drafts/plinth.png", Image.fromarray(on_plinth))
        args = dict(packKey="products/p/pack.png", renderKey="batches/b1/drafts/plinth.png", at=[512, 900], bg="E83C28")
        self.assertFalse(self.job("pack_check", **args)["passed"])  # the plinth is taken as pack
        boxed = self.job("pack_check", **args, around=[300, 600, 724, 1100])
        self.assertTrue(boxed["ok"] and boxed["passed"], boxed)
        outside = self.job("pack_check", **args, around=[600, 600, 724, 1100])
        self.assertIn("box must lie inside the picture and hold the point", outside["error"])

    def test_cap_check_fails_a_cap_that_sits_off_centre(self):
        self.store.add("batches/b1/finals/centred.png", bottle(0))
        self.store.add("batches/b1/finals/shifted.png", bottle(6))
        centred = self.job("cap_check", renderKey="batches/b1/finals/centred.png", box=[300, 380, 724, 1000], split=500)
        self.assertTrue(centred["ok"] and centred["passed"], centred)
        shifted = self.job("cap_check", renderKey="batches/b1/finals/shifted.png", box=[300, 380, 724, 1000], split=500)
        self.assertTrue(shifted["ok"], shifted)
        self.assertFalse(shifted["passed"])
        self.assertIn("right of the body centre", shifted["line"])

    def test_photo_finish_gives_the_same_picture_for_the_same_seed(self):
        self.store.add("batches/b1/finals/f.png", render(150, 450))
        first = self.job("photo_finish", renderKey="batches/b1/finals/f.png", seed=7, sharp=[[0.4, 0.5, 0.6, 0.86]], keep=["E83C28"])
        self.assertTrue(first["ok"], first)
        one = self.store.files[first["imageKey"]]
        self.job("photo_finish", renderKey="batches/b1/finals/f.png", seed=7, sharp=[[0.4, 0.5, 0.6, 0.86]], keep=["E83C28"])
        self.assertEqual(one, self.store.files[first["imageKey"]])
        self.job("photo_finish", renderKey="batches/b1/finals/f.png", seed=8)
        self.assertNotEqual(one, self.store.files[first["imageKey"]])
        self.assertEqual(self.store.picture(first["imageKey"]).size, (1024, 1280))

    def test_photo_finish_needs_a_seed(self):
        self.store.add("batches/b1/finals/f.png", render(150, 450))
        self.assertIn("seed", self.job("photo_finish", renderKey="batches/b1/finals/f.png")["error"])

    def test_a_picture_that_is_not_4_to_5_is_refused(self):
        self.store.add("batches/b1/finals/wide.png", render(150, 450, size=(1280, 1280)))
        answer = self.job("photo_finish", renderKey="batches/b1/finals/wide.png", seed=1)
        self.assertFalse(answer["ok"])
        self.assertIn("4:5 pictures only", answer["error"])

    def test_food_crop_puts_the_render_food_beside_the_brand_photo(self):
        self.store.add("batches/b1/drafts/d.png", render(150, 450))
        self.store.add("brands/b/products/p/food.jpg", Image.new("RGB", (600, 400), (200, 150, 40)), "JPEG")
        answer = self.job("food_crop", renderKey="batches/b1/drafts/d.png", foodKey="brands/b/products/p/food.jpg", box=[400, 600, 656, 856])
        self.assertTrue(answer["ok"], answer)
        sheet = self.store.picture(answer["imageKey"])
        self.assertEqual(sheet.size, (768 + 16 + 1152, 768))

    def test_a_key_outside_the_picture_folders_is_not_read(self):
        self.store.files["jobs/b1/other.json"] = b"{}"
        answer = self.job("cap_check", renderKey="jobs/b1/other.json", box=[0, 0, 100, 100], split=50)
        self.assertFalse(answer["ok"])
        answer = self.job("cap_check", renderKey="batches/../jobs/b1/other.json", box=[0, 0, 100, 100], split=50)
        self.assertFalse(answer["ok"])

    def test_a_file_that_is_no_picture_fails_with_a_plain_line(self):
        self.store.files["batches/b1/drafts/bad.png"] = b"<svg onload=alert(1)>"
        answer = self.job("cap_check", renderKey="batches/b1/drafts/bad.png", box=[0, 0, 100, 100], split=50)
        self.assertEqual(answer, {"ok": False, "tool": "cap_check", "error": "The tool could not read or work on that picture."})

    def test_an_unknown_tool_is_refused(self):
        self.assertIn("no pixel tool", self.job("rm_rf")["error"])

    def test_a_picture_is_written_only_inside_its_batch(self):
        event = {"jobId": "j1", "batchId": "b1", "tool": "skeleton", "input": {"packKey": "products/p/pack.png", "bg": "#E83C28"}, "resultKey": "jobs/b1/j1.json", "outKey": "batches/b2/pixels/j1.jpg"}
        self.assertFalse(handler.work(event, self.store)["ok"])
        self.assertNotIn("batches/b2/pixels/j1.jpg", self.store.files)

    def test_a_job_with_no_place_for_its_result_does_not_run(self):
        with self.assertRaises(ValueError):
            handler.work({"tool": "skeleton", "resultKey": "batches/b1/x.json"}, self.store)


if __name__ == "__main__":
    unittest.main()
