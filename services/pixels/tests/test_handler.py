"""Tests for the Lambda handler: a store in memory, synthetic pictures, no network."""
import importlib.util
import io
import json
import os
import unittest

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("handler", os.path.join(HERE, "handler.py"))
handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler)
headline = handler.headline

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


FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def stage(size=(1024, 1280), tone=(236, 226, 205)):
    a = np.empty((size[1], size[0], 3), np.uint8)
    a[:] = tone
    return Image.fromarray(a)


@unittest.skipUnless(os.path.isfile(FONT), "needs DejaVu Sans (on the Ubuntu CI runner)")
class Words(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.store.add("batches/b1/drafts/d1.png", stage())
        with open(FONT, "rb") as file:
            self.store.files["brands/br1/fonts/dejavu-700.ttf"] = file.read()
        logo = np.zeros((60, 240, 4), np.uint8)
        logo[10:50, 10:230] = (20, 20, 20, 255)
        self.store.add("brands/br1/logo.png", Image.fromarray(logo, "RGBA"))

    def job(self, **input):
        event = {"jobId": "j1", "batchId": "b1", "tool": "headline", "input": input, "resultKey": "jobs/b1/j1.json", "outKey": "batches/b1/typesets/j1.jpg"}
        return handler.work(event, self.store)

    def words(self, **more):
        return self.job(**{"renderKey": "batches/b1/drafts/d1.png", "fontKey": "brands/br1/fonts/dejavu-700.ttf", "headline": "Ten flavours, | one cake.", "subline": "Every slice differs.", "area": [0.08, 0.2, 0.92, 0.5], "case": "upper", **more})

    def test_the_words_and_the_logo_are_set_on_the_picture(self):
        answer = self.words(logoKey="brands/br1/logo.png", logoWidth=0.2, logoTop=0.05)
        self.assertTrue(answer["ok"], answer)
        picture = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)
        dark = picture.sum(axis=2) < 200
        self.assertTrue(dark[int(0.2 * 1280):int(0.5 * 1280)].any())  # the words
        self.assertTrue(dark[int(0.05 * 1280):int(0.12 * 1280)].any())  # the logo
        self.assertFalse(dark[int(0.6 * 1280):].any())  # nothing below the area
        self.assertIn("headline", answer["line"])

    def test_a_logo_on_a_plain_backdrop_loses_the_backdrop_and_takes_one_colour(self):
        flat = np.full((60, 240, 3), 255, np.uint8)
        flat[10:50, 10:230] = (20, 20, 20)
        self.store.add("brands/br1/flat.jpg", Image.fromarray(flat), fmt="JPEG")
        self.store.add("batches/b1/drafts/d1.png", stage(tone=(30, 30, 40)))
        answer = self.words(logoKey="brands/br1/flat.jpg", logoColour="FFFFFF", colour="FFFFFF", logoWidth=0.2, logoTop=0.05)
        self.assertTrue(answer["ok"], answer)
        band = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)[int(0.05 * 1280):int(0.09 * 1280)]
        light = band.sum(axis=2) > 600
        self.assertTrue(light.any())  # the logo's ink, now light
        self.assertLess(light.mean(), 0.2)  # and no white box round it

    def test_words_that_run_over_a_sharp_edge_are_refused(self):
        split = np.asarray(stage()).copy()
        split[:, 512:] = (20, 20, 20)
        self.store.add("batches/b1/drafts/d1.png", Image.fromarray(split))
        answer = self.words()
        self.assertFalse(answer["ok"])
        self.assertIn("one tone", answer["error"])

    def test_a_file_that_is_no_font_is_refused(self):
        self.store.files["brands/br1/fonts/bad.ttf"] = b"<html>not a font</html>"
        answer = self.words(fontKey="brands/br1/fonts/bad.ttf")
        self.assertEqual(answer["error"], "The font file is not a TrueType, OpenType, WOFF or WOFF2 font.")
        answer = self.words(fontKey="brands/br1/logo.png")
        self.assertEqual(answer["error"], "The job names no font file.")

    def test_a_subline_of_two_lines_leaves_no_word_alone_on_the_last(self):
        # Found live (22-11-2026): "Free delivery when you take / three."
        draw = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        font = ImageFont.truetype(FONT, 40)
        words = "Free delivery when you take three.".split()
        greedy = headline.wrap(draw, words, font, draw.textlength("Free delivery when you take", font=font) + 2)
        self.assertEqual(greedy, ["Free delivery when you take", "three."])
        self.assertEqual(headline.even(draw, words, font, greedy), ["Free delivery when", "you take three."])
        # A break the writer forced stays, and so does one line.
        forced = "Free delivery | when you take three.".split()
        self.assertEqual(headline.even(draw, forced, font, ["Free delivery", "when you take three."]), ["Free delivery", "when you take three."])
        self.assertEqual(headline.even(draw, words[:2], font, ["Free delivery"]), ["Free delivery"])

    def test_a_refusal_names_the_fields_of_the_tool_not_the_flags_of_the_script(self):
        # Found live (22-11-2026): "... is under --min-logo-gap 3%", a flag that a client of the studio cannot set.
        answer = self.words(logoKey="brands/br1/logo.png", logoWidth=0.2, logoTop=0.15)
        self.assertFalse(answer["ok"])
        self.assertIn("under the least gap 3%", answer["error"])
        self.assertNotIn("--", answer["error"])
        self.assertNotIn("--", self.words(productTop=0.5, minHead=0.4)["error"])

    def test_the_words_must_fit_and_be_given(self):
        self.assertIn("do not fit", self.words(area=[0.4, 0.4, 0.45, 0.42])["error"])
        self.assertIn("headline needs words", self.words(headline=" ")["error"])
        self.assertIn("align is one of", self.words(align="justify")["error"])


class Repairs(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.store.add("products/p/pack.png", packshot())

    def job(self, tool, **input):
        event = {"jobId": "j1", "batchId": "b1", "tool": tool, "input": input, "resultKey": "jobs/b1/j1.json", "outKey": "batches/b1/pixels/j1.jpg"}
        return handler.work(event, self.store)

    def test_a_plan_product_takes_another_real_photo_of_the_product(self):
        slice_ = np.full((300, 300, 3), 255, np.uint8)
        slice_[60:240, 40:260] = (200, 150, 40)
        self.store.add("products/p/food.png", Image.fromarray(slice_))
        plan = {"size": [1024, 1280], "bg": "#E83C28", "products": [{"cx": 0.3, "base": 0.8, "height": 0.3}, {"cx": 0.7, "base": 0.8, "height": 0.2, "photoKey": "products/p/food.png"}]}
        answer = self.job("skeleton", packKey="products/p/pack.png", plan=plan)
        self.assertTrue(answer["ok"], answer)
        picture = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)
        blue = picture[..., 2] > 120
        yellow = (picture[..., 0] > 170) & (picture[..., 1] > 120) & (picture[..., 2] < 90)
        self.assertTrue(blue[:, :512].any() and not blue[:, 512:].any())
        self.assertTrue(yellow[:, 512:].any() and not yellow[:, :512].any())

    def test_a_plan_photo_outside_the_picture_folders_is_not_read(self):
        self.store.files["jobs/b1/other.json"] = b"{}"
        plan = {"products": [{"cx": 0.5, "base": 0.8, "height": 0.3, "photoKey": "jobs/b1/other.json"}]}
        self.assertFalse(self.job("skeleton", packKey="products/p/pack.png", plan=plan)["ok"])

    def test_a_row_of_packs_gets_food_that_differs_from_pack_to_pack(self):
        rng = np.random.default_rng(3)
        jar = np.full((400, 400, 3), 255, np.uint8)
        jar[50:350, 50:350] = (20, 40, 160)
        jar[120:220, 60:340] = rng.integers(80, 220, (100, 280, 3))  # the food window
        self.store.add("products/p/jar.png", Image.fromarray(jar))
        plan = {"size": [1024, 1280], "bg": "#E83C28", "products": [{"cx": 0.3, "base": 0.8, "height": 0.3}, {"cx": 0.7, "base": 0.8, "height": 0.3}]}
        answer = self.job("skeleton", packKey="products/p/jar.png", plan=plan, vary={"regions": [[60, 120, 340, 220]], "seed": 5})
        self.assertTrue(answer["ok"], answer)
        picture = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)
        left, right = picture[:, :512], picture[:, 512:]
        self.assertGreater(np.abs(left - right).mean(), 1.0)  # not the same kernels twice
        self.assertFalse(self.job("skeleton", packKey="products/p/jar.png", plan=plan, vary={"regions": []})["ok"])

    def test_food_grade_moves_the_food_toward_the_real_close_up(self):
        rng = np.random.default_rng(1)
        pale = np.full((1280, 1024, 3), 235, np.uint8)
        pale[400:800, 300:700] = np.clip(rng.normal((200, 170, 120), 12, (400, 400, 3)), 0, 255)
        golden = np.clip(rng.normal((205, 140, 50), 14, (300, 300, 3)), 0, 255).astype(np.uint8)
        self.store.add("batches/b1/drafts/d1.png", Image.fromarray(pale))
        self.store.add("products/p/food.png", Image.fromarray(golden))
        answer = self.job("food_grade", renderKey="batches/b1/drafts/d1.png", foodKey="products/p/food.png", refBox=[20, 20, 280, 280], regions=[[300, 400, 700, 800]])
        self.assertTrue(answer["ok"], answer)
        after = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)
        self.assertLess(after[450:750, 350:650, 2].mean(), 110)  # less blue: warmer
        self.assertTrue(np.abs(after[:300] - 235).max() <= 3)  # the backdrop stays
        self.assertIn("never pushed past", self.job("food_grade", renderKey="batches/b1/drafts/d1.png", foodKey="products/p/food.png", refBox=[20, 20, 280, 280], regions=[[300, 400, 700, 800]], strength=1.6)["error"])

    def test_relight_shades_the_side_away_from_the_light(self):
        self.store.add("batches/b1/drafts/d1.png", render(200, 600))
        answer = self.job("relight", renderKey="batches/b1/drafts/d1.png", box=[412, 612, 500, 1100], light="left", floor=[232, 60, 40])
        self.assertTrue(answer["ok"], answer)
        after = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)
        self.assertGreater(after[800, 440].sum(), after[800, 590].sum())
        self.assertIn("left or right", self.job("relight", renderKey="batches/b1/drafts/d1.png", box=[412, 612, 500, 1100], light="up")["error"])

    def test_box_print_refuses_a_typeset_block_and_a_render_without_the_printed_face(self):
        self.store.add("batches/b1/finals/f1.png", stage())
        typeset = self.job("box_print", packKey="products/p/pack.png", renderKey="batches/b1/finals/f1.png", face=[50, 50, 150, 350], blocks=[{"box": [60, 100, 140, 130], "typeset": {"text": "X"}}])
        self.assertIn("Leave typeset out", typeset["error"])
        plain = self.job("box_print", packKey="products/p/pack.png", renderKey="batches/b1/finals/f1.png", face=[50, 50, 150, 350], blocks=[{"box": [60, 100, 140, 130]}])
        self.assertFalse(plain["ok"])
        self.assertRegex(plain["error"], "features|matches")

    def test_an_open_pack_keeps_the_real_photo_below_the_cut(self):
        square = np.full((400, 400, 3), 255, np.uint8)
        square[100:380, 120:280] = (20, 40, 160)
        square[60:100, 150:250] = (200, 30, 30)  # the cap
        self.store.add("products/p/square.png", Image.fromarray(square))
        padded = self.job("pack_pad", packKey="products/p/square.png")
        self.assertTrue(padded["ok"], padded)
        pad = self.store.picture(padded["imageKey"]).convert("RGB")
        self.assertEqual(pad.size, (400, 500))
        self.store.add("batches/b1/pack_pads/pad.png", pad)
        edit = np.asarray(pad).copy()
        edit[110:150, 150:250] = (180, 180, 190)  # the model took the cap off: an open neck
        edit[300:] = 0  # and spoiled the label below
        self.store.add("batches/b1/drafts/edit.png", Image.fromarray(edit))
        answer = self.job("pack_open", paddedKey="batches/b1/pack_pads/pad.png", renderKey="batches/b1/drafts/edit.png", realFrom=200, strip=[130, 139])
        self.assertTrue(answer["ok"], answer)
        opened = np.asarray(self.store.picture(answer["imageKey"]).convert("RGB")).astype(int)
        self.assertTrue(np.abs(opened[320:420, 130:270] - np.asarray(pad).astype(int)[320:420, 130:270]).max() <= 12)  # the real label, not the model's
        self.assertIn("realFrom", self.job("pack_open", paddedKey="batches/b1/pack_pads/pad.png", renderKey="batches/b1/drafts/edit.png", strip=[130, 139])["error"])


if __name__ == "__main__":
    unittest.main()
