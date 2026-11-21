"""Tests for the pixel tools: synthetic pictures only, no real photo and no network.

Ported from a11-adgen scripts/test_scripts.py. Run: python3 -m unittest discover -s services/pixels/tests
"""
import contextlib
import importlib.util
import io
import os
import re
import shutil
import sys
import tempfile
import types
import unittest

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


product_lock = load("product_lock")
photo_finish = load("photo_finish")
pack_check = load("pack_check")
cap_check = load("cap_check")


def exit_message(fn, *args):
    """The message of the sys.exit that fn raises."""
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            fn(*args)
        except SystemExit as e:
            return str(e.code)
    raise AssertionError("no sys.exit")


class Tmp(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.dir.cleanup()

    def save(self, name, arr):
        path = os.path.join(self.dir.name, name)
        Image.fromarray(arr.astype("uint8")).save(path)
        return path


class ProductLock(Tmp):
    def setUp(self):
        super().setUp()
        self.pack = self.save("pack.png", np.full((100, 80, 3), 128))

    def args(self, box):
        return types.SimpleNamespace(packshot=self.pack, scene=self.pack, size="400,500", box=box)

    def test_skeleton_refuses_a_box_past_the_edge(self):
        # P4: x1 90 is past the 80 px width.
        self.assertIn("is outside the packshot (80x100)", exit_message(product_lock.skeleton, self.args("10,10,90,50")))

    def test_skeleton_refuses_a_box_with_no_height(self):
        # P4: y1 = y0 divided by zero.
        self.assertIn("not x0<x1, y0<y1", exit_message(product_lock.skeleton, self.args("10,40,50,40")))

    def test_swap_refuses_a_box_past_the_edge(self):
        self.assertIn("is outside the packshot (80x100)", exit_message(product_lock.swap, self.args("10,10,50,120")))

    def test_a_box_inside_the_packshot_passes(self):
        product_lock.check_box((0, 0, 80, 100), (80, 100))

    def test_a_packshot_in_another_format_is_refused(self):
        # Only JPEG, PNG and WEBP open; a GIF named .png is still refused.
        path = os.path.join(self.dir.name, "fake.png")
        Image.fromarray(np.full((100, 80, 3), 128, np.uint8)).save(path, format="GIF")
        a = self.args("10,10,50,50")
        a.packshot = path
        with self.assertRaises(Image.UnidentifiedImageError):
            product_lock.skeleton(a)


class LayoutReprint(Tmp):
    """layout places products from a plan; reprint fits the packshot face back onto a render made from it."""

    def setUp(self):
        super().setUp()
        a = np.full((260, 160, 3), 245, np.uint8)        # pale backdrop
        a[20:240, 30:130] = 232                           # the carton (box 30,20,130,240)
        for y in (80, 120, 160):                          # the print: dark bars and a red badge on the face
            a[y:y + 12, 45:115] = 25
        a[200:225, 50:90] = (200, 40, 40)
        self.pack = self.save("pack.png", a)
        self.box, self.face = "30,20,130,240", "34,40,126,236"

    def plan(self, **over):
        import json
        plan = {"size": [400, 500], "bg": "#B4A08C",
                "shapes": [{"rect": [0, 0.8, 1, 1], "fill": "#8C6440"}],
                "products": [{"cx": 0.28, "base": 0.8, "height": 0.4, "side": "up", "rot": -0.5},
                             {"cx": 0.70, "base": 0.8, "height": 0.4, "side": "R", "rot": 1.0}]}
        plan.update(over)
        path = os.path.join(self.dir.name, f"plan{len(os.listdir(self.dir.name))}.json")
        with open(path, "w") as f:
            json.dump(plan, f)
        return path

    def ns(self, **kw):
        base = dict(packshot=self.pack, box=self.box, alpha=None, plan=self.plan(), out=os.path.join(self.dir.name, "out.png"))
        base.update(kw)
        return types.SimpleNamespace(**base)

    def rp(self, render, **kw):
        a = dict(face=self.face, render=render, debug=None, min_score=0.8, search_scale=0.08, search_rot=1.5, search_px=70, light_px=14)
        a.update(kw)
        return self.ns(out=os.path.join(self.dir.name, "rp.png"), **a)

    def test_layout_places_each_product_with_its_side(self):
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("L")).astype(int)
        self.assertGreater(sk[272:282, 100:120].mean() - sk[100:150, 15:45].mean(), 50, "the upright carton's pale paper over the backdrop")
        self.assertLess(sk[300:400, 90:140].min(), 60, "the upright carton's dark print bars")
        self.assertGreater(sk[440:460, 10:20].mean(), 80)
        self.assertLess(abs(int(sk[480, 5]) - 0x6a), 25, "the floor shape under the products")

    def test_layout_composes_each_product_from_its_own_photo(self):
        # Owner, 18-11-2026: real slice photos of each flavour, cut out and composed, not model-drawn food.
        red = np.full((120, 100, 3), 255, np.uint8); red[20:100, 20:80] = (200, 30, 40)
        blue = np.full((120, 100, 3), 255, np.uint8); blue[30:90, 10:90] = (40, 50, 190)
        self.save("red.png", red); self.save("blue.png", blue)
        for name, arr in (("red", red), ("blue", blue)):
            m = np.where(arr.min(axis=2) < 250, 255, 0)
            self.save(f"m_{name}.png", m)
        plan = self.plan(products=[
            {"cx": 0.3, "base": 0.8, "height": 0.4, "photo": "red.png", "alpha": "m_red.png"},
            {"cx": 0.75, "base": 0.8, "height": 0.3, "photo": "blue.png", "alpha": "m_blue.png", "blur": 2}])
        with contextlib.redirect_stdout(io.StringIO()) as log:
            product_lock.layout(self.ns(packshot=None, box=None, plan=plan))
        self.assertIn("2 products on 400x500", log.getvalue())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(int)
        self.assertGreater(sk[300, 120, 0] - sk[300, 120, 2], 100, "the red item at its place")
        self.assertGreater(sk[340, 300, 2] - sk[340, 300, 0], 100, "the blue item at its place")
        self.assertLess(abs(sk[40, 200] - (0xB4, 0xA0, 0x8C)).max(), 3, "the backdrop shows no white photo backdrop")
        self.assertAlmostEqual(int((sk[:, 120, 0] - sk[:, 120, 2] > 100).sum()), 200, delta=4)  # height 0.4 of 500 px, true shape
        # bad plans stop with clear messages
        bad = self.plan(products=[{"cx": 0.3, "base": 0.8, "height": 0.4, "alpha": "m_red.png"}])
        self.assertIn("go with its own photo", exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=bad)))
        mixed = self.plan(products=[{"cx": 0.3, "base": 0.8, "height": 0.4}])
        self.assertIn("a photo for every product", exit_message(product_lock.layout, self.ns(packshot=None, box=None, plan=mixed)))
        self.assertIn("their own photos", exit_message(product_lock.reprint, self.rp(self.pack, plan=plan)))

    def test_layout_blurs_an_item_with_a_soft_edge_at_its_place(self):
        # Review of #113: the blur ran inside the piece's own border, so the soft edge stopped in a hard straight line.
        red = np.full((120, 100, 3), 255, np.uint8); red[10:110, 10:90] = (200, 30, 40)
        self.save("red.png", red); self.save("m_red.png", np.where(red.min(axis=2) < 250, 255, 0))
        rows = {}
        for blur in (0, 20):
            item = {"cx": 0.5, "base": 0.8, "height": 0.4, "photo": "red.png", "alpha": "m_red.png", "blur": blur}
            with contextlib.redirect_stdout(io.StringIO()):
                product_lock.layout(self.ns(packshot=None, box=None, plan=self.plan(bg="#2040C0", shapes=[], products=[item])))
            sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(int)
            rows[blur] = sk[300, :, 0] - sk[300, :, 2]   # red over the backdrop's own red-blue
        bg = rows[20][5]
        self.assertLess(np.abs(np.diff(rows[20])).max(), 25, "the blurred edge has no hard step")
        sharp, soft = np.nonzero(rows[0] - bg > 60)[0], np.nonzero(rows[20] - bg > 60)[0]
        self.assertAlmostEqual((sharp.min() + sharp.max()) / 2, (soft.min() + soft.max()) / 2, delta=1.5)  # the blur does not move it

    def test_reprint_restores_smeared_print_under_the_render_light(self):
        import cv2
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(np.float32)
        light = np.linspace(0.75, 1.0, sk.shape[1])[None, :, None]   # a window light across the picture
        ideal = sk * light
        render = ideal.copy()
        smear = cv2.GaussianBlur(render, (0, 0), 4)                  # the model smears the print; the carton edges stay
        for (y0, y1, x0, x1) in ((230, 380, 85, 140), (320, 385, 190, 380)):
            render[y0:y1, x0:x1] = smear[y0:y1, x0:x1]
        rpath = self.save("render.png", render.clip(0, 255))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            product_lock.reprint(self.rp(rpath))
        self.assertIn("real print on 2 of 2 products", out.getvalue())
        got = np.asarray(Image.open(os.path.join(self.dir.name, "rp.png")).convert("RGB")).astype(np.float32)
        for (y0, y1, x0, x1) in ((230, 380, 85, 140), (320, 385, 190, 380)):
            before = np.abs(render[y0:y1, x0:x1] - ideal[y0:y1, x0:x1]).mean()
            after = np.abs(got[y0:y1, x0:x1] - ideal[y0:y1, x0:x1]).mean()
            self.assertLess(after, before * 0.5, f"print in {(y0, y1, x0, x1)} is not restored: {before:.1f} -> {after:.1f}")
        np.testing.assert_allclose(got[10:60, 10:390], render[10:60, 10:390], atol=2)  # away from the products nothing changes

    def test_reprint_keeps_a_coloured_pack_its_own_colour(self):
        # A kraft-brown pouch under neutral light: the render's colour holds the pack's own brown, so it must not tint the print twice.
        a = np.asarray(Image.open(self.pack).convert("RGB")).copy()
        a[20:240, 30:130][np.all(a[20:240, 30:130] == 232, axis=2)] = (182, 124, 68)
        a[100:140, 60:100][np.all(a[100:140, 60:100] == (182, 124, 68), axis=2)] = 250   # a white badge on the kraft face
        self.pack = self.save("kraft.png", a)
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns())
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB")).astype(np.float32)
        ideal = sk * 0.85
        rpath = self.save("render.png", ideal.clip(0, 255))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            product_lock.reprint(self.rp(rpath))
        self.assertIn("real print on 2 of 2 products", out.getvalue())
        got = np.asarray(Image.open(os.path.join(self.dir.name, "rp.png")).convert("RGB")).astype(np.float32)
        y0, y1, x0, x1 = 300, 380, 70, 100                                      # plain kraft on the upright pouch
        ratio = got[y0:y1, x0:x1].mean(axis=(0, 1)) / ideal[y0:y1, x0:x1].mean(axis=(0, 1))
        self.assertLess(ratio.max() - ratio.min(), 0.06, f"the print took a colour cast: {ratio.round(3)}")
        badge = (ideal.min(axis=2) > 200) & (ideal.max(axis=2) - ideal.min(axis=2) < 4)   # the white badge, neutral in the render
        self.assertGreater(int(badge.sum()), 200, "the fixture shows the white badge")
        rgb = got[badge].mean(axis=0)
        self.assertLess(rgb.max() - rgb.min(), 6, f"the white badge turned yellow: {rgb.round(1)}")

    def test_layout_leaves_no_dark_ring_on_a_soft_edge(self):
        # The piece was pasted with its own alpha as the mask, so the alpha applied twice: a soft edge came out darker
        # than both the item and the backdrop (a white item on a white backdrop showed a grey ring, 255 down to 223).
        white = np.full((120, 100, 3), 255, np.uint8)
        mask = np.zeros((120, 100), np.uint8); mask[10:110, 10:90] = 255
        self.save("white.png", white); self.save("m_white.png", mask)
        for blur in (0, 6):
            item = {"cx": 0.5, "base": 0.8, "height": 0.4, "rot": 7, "photo": "white.png", "alpha": "m_white.png", "blur": blur}
            with contextlib.redirect_stdout(io.StringIO()):
                product_lock.layout(self.ns(packshot=None, box=None, plan=self.plan(bg="#FFFFFF", shapes=[], products=[item])))
            sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("RGB"))
            self.assertGreaterEqual(int(sk.min()), 250, f"blur {blur}: a white item on a white backdrop stays white")

    def test_layout_lets_a_product_bleed_off_the_edge(self):
        # A lying carton cut by the left and top frame edges (the playbook asks for a box end past the edge).
        plan = self.plan(products=[{"cx": 0.02, "base": 0.1, "height": 0.4, "side": "R"}])
        with contextlib.redirect_stdout(io.StringIO()):
            product_lock.layout(self.ns(plan=plan))
        sk = np.asarray(Image.open(os.path.join(self.dir.name, "out.png")).convert("L"))
        self.assertGreater(int(sk[20, 25]), 200, "the carton's pale face shows at the top-left corner")

    def test_reprint_leaves_a_product_that_does_not_fit(self):
        flat = self.save("flat.png", np.full((500, 400, 3), 128))
        self.assertIn("no product fitted", exit_message(product_lock.reprint, self.rp(flat)))

    def test_bad_inputs_are_refused(self):
        self.assertIn("--face", exit_message(product_lock.reprint, self.rp(self.pack, face="0,0,50,50")))
        self.assertIn("same shape", exit_message(product_lock.reprint, self.rp(self.save("wide.png", np.full((300, 600, 3), 128)))))
        self.assertIn("side must be one of", exit_message(product_lock.layout, self.ns(plan=self.plan(products=[{"cx": 0.5, "base": 0.9, "height": 0.4, "side": "flat"}]))))
        self.assertIn("height must be a number", exit_message(product_lock.layout, self.ns(plan=self.plan(products=[{"cx": 0.5, "base": 0.9, "height": "big"}]))))
        self.assertIn("non-empty \"products\"", exit_message(product_lock.layout, self.ns(plan=self.plan(products=[]))))
        self.assertIn("rect must be", exit_message(product_lock.layout, self.ns(plan=self.plan(shapes=[{"rect": [0.5, 0, 0.2, 1]}]))))
        self.assertIn("--min-score", exit_message(product_lock.reprint, self.rp(self.pack, min_score=1.5)))
        self.assertIn("--search-scale", exit_message(product_lock.reprint, self.rp(self.pack, search_scale=float("nan"))))
        self.assertIn("--search-scale", exit_message(product_lock.reprint, self.rp(self.pack, search_scale=1.2)))
        self.assertIn("--search-rot", exit_message(product_lock.reprint, self.rp(self.pack, search_rot=-1)))
        self.assertIn("--search-px", exit_message(product_lock.reprint, self.rp(self.pack, search_px=-5)))
        self.assertIn("--light-px", exit_message(product_lock.reprint, self.rp(self.pack, light_px=0)))


class PhotoFinish(Tmp):
    def grey(self, v, size=(96, 128)):
        return Image.fromarray(np.full((size[1], size[0], 3), v, np.uint8))

    def test_strength_zero_changes_nothing(self):
        rng = np.random.default_rng(3)
        img = Image.fromarray(rng.integers(0, 256, (64, 48, 3), dtype=np.uint8))
        out = np.asarray(photo_finish.finish(img, strength=0, seed=1)).astype(int)
        self.assertLessEqual(int(np.abs(out - np.asarray(img).astype(int)).max()), 1)

    def test_the_same_seed_gives_the_same_grain(self):
        img = self.grey(128)
        a = np.asarray(photo_finish.finish(img, seed=7))
        b = np.asarray(photo_finish.finish(img, seed=7))
        c = np.asarray(photo_finish.finish(img, seed=8))
        self.assertTrue((a == b).all())
        self.assertFalse((a == c).all())

    def test_grain_is_stronger_in_the_midtones_than_in_deep_shadow(self):
        only_grain = ("tone", "soften", "halation", "lens")
        mid = np.asarray(photo_finish.finish(self.grey(128), skip=only_grain, seed=1).convert("L")).astype(float)
        dark = np.asarray(photo_finish.finish(self.grey(8), skip=only_grain, seed=1).convert("L")).astype(float)
        self.assertGreater(mid.std(), 0.5)
        self.assertGreater(mid.std(), dark.std() * 1.8)

    def test_tone_keeps_white_below_clipping_and_lifts_black(self):
        tone_only = ("soften", "halation", "lens", "grain")
        white = np.asarray(photo_finish.finish(self.grey(255), skip=tone_only))
        black = np.asarray(photo_finish.finish(self.grey(0), skip=tone_only))
        self.assertLess(int(white.max()), 252)
        self.assertGreater(int(black.min()), 1)
        grey = np.asarray(photo_finish.finish(self.grey(100), skip=tone_only)).astype(int)
        self.assertLessEqual(int(np.ptp(grey, axis=2).max()), 1)  # a grey stays grey

    def test_vignette_darkens_the_corners_not_the_centre(self):
        out = np.asarray(photo_finish.finish(self.grey(180, (200, 250)), skip=("tone", "soften", "halation", "grain")).convert("L")).astype(int)
        self.assertLess(out[2, 2], out[125, 100] - 5)
        self.assertGreaterEqual(out[125, 100], 179)

    def test_a_sharp_box_is_not_softened(self):
        a = np.full((128, 96, 3), 230, np.uint8)
        a[:, 47:49] = 20  # a thin dark line top to bottom
        img = Image.fromarray(a)
        steps = ("tone", "halation", "lens", "grain")
        big = {"soften_px": 24, "soften_mix": 1}  # sizes scale with the width: make the blur visible on a 96 px picture
        soft = np.asarray(photo_finish.finish(img, skip=steps, params=big).convert("L")).astype(int)
        kept = np.asarray(photo_finish.finish(img, skip=steps, sharp_boxes=[(0.3, 0.3, 0.7, 0.7)], params=big).convert("L")).astype(int)
        self.assertGreater(soft[64, 48], kept[64, 48] + 10)  # the line got lighter (softer) without the box
        self.assertLessEqual(abs(kept[64, 48] - 20), 2)

    def test_the_command_writes_a_jpeg_of_the_same_size(self):
        src = self.save("in.png", np.full((80, 64, 3), 150))
        out = os.path.join(self.dir.name, "out.jpg")
        with contextlib.redirect_stdout(io.StringIO()) as buf:
            photo_finish.main(["--in", src, "--out", out, "--seed", "1", "--sharp", "0.3,0.0,0.7,0.2"])
        with Image.open(out) as written:
            self.assertEqual(written.format, "JPEG")
            self.assertEqual(written.size, (64, 80))
        self.assertIn("sharp 1", buf.getvalue())

    def test_bad_input_stops_with_a_clear_message(self):
        out = os.path.join(self.dir.name, "o.jpg")
        self.assertIn("no picture at", exit_message(photo_finish.main, ["--in", "/no/such.jpg", "--out", out]))
        src = self.save("in.png", np.full((8, 8, 3), 150))
        self.assertIn("--sharp needs", exit_message(photo_finish.main, ["--in", src, "--out", out, "--sharp", "0.5,0.5,0.2,0.9"]))
        self.assertIn("--strength must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--strength", "3"]))
        self.assertIn("--grain-amp must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--grain-amp", "nan"]))
        self.assertIn("--soften-px must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--soften-px", "-1"]))
        self.assertIn("black < shoulder < white", exit_message(photo_finish.main, ["--in", src, "--out", out, "--shoulder", "0.99"]))
        self.assertIn("--halation-thr must be", exit_message(photo_finish.main, ["--in", src, "--out", out, "--halation-thr", "1"]))

    def test_chroma_grain_keeps_luma(self):
        img = self.grey(128, (64, 64))
        skip = ("tone", "soften", "halation", "lens")
        mono = photo_finish.finish(img, skip=skip, seed=3, params={"grain_amp": 0.05, "grain_chroma": 0})
        colour = photo_finish.finish(img, skip=skip, seed=3, params={"grain_amp": 0.05, "grain_chroma": 1})
        m, c = (np.asarray(x, np.float32) / 255 for x in (mono, colour))
        self.assertGreater(float(np.abs(c - m).max()), 5 / 255)  # the colour grain is there
        self.assertLess(float(np.abs(photo_finish.luma(c) - photo_finish.luma(m)).max()), 1.5 / 255)  # and it keeps luma

    def test_keep_holds_the_brand_colour(self):
        # Owner, 18-11-2026: the tone step turned the brand yellow olive. --keep holds it exact in tone and halation.
        yellow = Image.fromarray(np.full((64, 64, 3), (255, 210, 0), np.uint8))
        skip = ("soften", "lens", "grain")
        plain = np.asarray(photo_finish.finish(yellow, skip=skip)).astype(int)
        kept = np.asarray(photo_finish.finish(yellow, skip=skip, keep=[photo_finish.hex_rgb("#FFD200")])).astype(int)
        self.assertGreater(int(np.abs(plain - (255, 210, 0)).max()), 15)  # the shift the owner saw
        self.assertLessEqual(int(np.abs(kept - (255, 210, 0)).max()), 1)
        grey = Image.fromarray(np.full((64, 64, 3), 250, np.uint8))  # far from the colour: the normal finish
        self.assertTrue(np.array_equal(np.asarray(photo_finish.finish(grey, skip=skip)),
                                       np.asarray(photo_finish.finish(grey, skip=skip, keep=[(1.0, 0.82, 0.0)]))))
        src = self.save("y.png", np.full((64, 64, 3), (255, 210, 0)))
        out = os.path.join(self.dir.name, "o.png")
        self.assertIn("--keep needs", exit_message(photo_finish.main, ["--in", src, "--out", out, "--keep", "yellow"]))
        with contextlib.redirect_stdout(io.StringIO()) as log:
            photo_finish.main(["--in", src, "--out", out, "--keep", "FFD200", "--no-grain"])
        self.assertIn("keep FFD200", log.getvalue())


class PackCheck(Tmp):
    """Owner, 19-11-2026: the pack must match the real pack in every dimension; the brand's packshot is the guide."""

    def stage(self, h, w, clip=True):
        img = np.zeros((400, 300, 3))
        img[:] = (255, 212, 25)  # the stage colour
        img[300:320, 40:280] = (200, 160, 18)  # its shadow: the same hue, darker
        y0 = 300 - h
        img[y0:300, 150 - w // 2:150 + w // 2] = (120, 80, 50)  # the pack
        img[y0 + 20:y0 + 30, 140:160] = (255, 212, 25)  # yellow print on the pack: a hole in the mask
        if clip:
            img[y0 - 25:y0, 145:155] = (20, 20, 20)  # a clip on the top
        return self.save("r.png", img)

    def packshot(self, h, w):
        a = np.zeros((300, 300))
        a[150 - h // 2:150 + h // 2, 150 - w // 2:150 + w // 2] = 255
        return self.save("p.png", a)

    def check(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as log:
            code = pack_check.main(list(args))
        return code, log.getvalue()

    def test_a_pack_of_the_true_shape_passes_with_a_clip_and_a_shadow(self):
        code, log = self.check("--render", self.stage(214, 200), "--at", "150,200", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)
        self.assertIn("PASS", log)

    def test_a_short_wide_pack_fails(self):
        code, log = self.check("--render", self.stage(180, 210), "--at", "150,250", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 1, log)
        self.assertIn("FAIL", log)

    def test_a_stage_coloured_band_across_the_pack_does_not_split_it(self):
        img = np.zeros((400, 300, 3))
        img[:] = (255, 212, 25)
        img[86:300, 50:250] = (120, 80, 50)  # the pack, 214 x 200
        img[180:186, 50:250] = (255, 212, 25)  # a yellow print band from edge to edge
        code, log = self.check("--render", self.save("band.png", img), "--at", "150,250", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_grey_stage_is_not_measured_as_the_pack(self):
        img = np.full((400, 300, 3), 200.0)
        img[300:320, 40:280] = 150  # its shadow
        img[86:300, 50:250] = (120, 80, 50)
        code, log = self.check("--render", self.save("grey.png", img), "--at", "150,250", "--bg", "C8C8C8", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_near_neutral_stage_is_not_measured_as_the_pack(self):
        img = np.zeros((400, 300, 3))
        img[:] = (200, 175, 165)  # C8AFA5: saturation 0.175, under 0.2 but over 0.15
        img[86:300, 50:250] = (165, 200, 175)  # a muted green pack: the same saturation and brightness, another hue
        code, log = self.check("--render", self.save("warm.png", img), "--at", "150,250", "--bg", "C8AFA5", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_dark_coloured_stage_is_not_measured_as_the_pack(self):
        img = np.zeros((400, 300, 3))
        img[:] = (64, 0, 0)  # a deep red stage, 400000
        img[300:320, 40:280] = (36, 0, 0)  # its shadow: the same hue, darker
        img[86:300, 50:250] = (230, 225, 210)  # a pale pack
        code, log = self.check("--render", self.save("dark.png", img), "--at", "150,250", "--bg", "400000", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_deep_shadow_of_a_bright_stage_is_not_measured_as_the_pack(self):
        img = np.zeros((400, 300, 3))
        img[:] = (255, 212, 25)
        img[86:300, 50:250] = (120, 80, 50)
        img[300:320, 40:260] = (60, 49, 5)  # a deep shadow that touches the pack
        code, log = self.check("--render", self.save("deep.png", img), "--at", "150,250", "--bg", "FFD419", "--packshot", self.packshot(214, 200))
        self.assertEqual(code, 0, log)

    def test_a_pack_on_its_side_passes_with_sideways(self):
        img = np.zeros((400, 400, 3))
        img[:] = (255, 212, 25)
        img[150:250, 50:350] = (120, 80, 50)  # the pack on its side: 100 high, 300 wide
        args = ["--render", self.save("side.png", img), "--at", "200,200", "--bg", "FFD419", "--packshot", self.packshot(300, 100)]
        self.assertEqual(self.check(*args)[0], 1)
        code, log = self.check(*args, "--sideways")
        self.assertEqual(code, 0, log)

    def test_a_point_on_the_stage_and_a_packshot_without_a_cut_out_stop_with_a_clear_message(self):
        r = self.stage(214, 200)
        self.assertIn("not inside the pack", exit_message(pack_check.main, ["--render", r, "--at", "5,5", "--bg", "FFD419", "--packshot", self.packshot(214, 200)]))
        flat = self.save("flat.png", np.full((50, 50, 3), 200))
        self.assertIn("cut-out packshot", exit_message(pack_check.main, ["--render", r, "--at", "150,200", "--bg", "FFD419", "--packshot", flat]))
        self.assertIn("RRGGBB", exit_message(pack_check.main, ["--render", r, "--at", "150,200", "--bg", "yellow", "--packshot", flat]))



class CapCheck(Tmp):
    """Owner, 20-11-2026 (Allies): the high-quality final put the cap 5.5 px right of the body centre (body 234 px,
    cap 183 px, at 1536 px wide); the draft had it centred."""

    STAGE = (160, 175, 244)  # a periwinkle stage, lighter than the bottle

    def bottle(self, shift):
        img = np.full((700, 400, 3), self.STAGE, dtype=float)
        img[100:330, 108 + shift:292 + shift] = (20, 30, 120)  # the cap, 184 px wide
        img[330:650, 83:317] = (25, 35, 130)  # the body, 234 px wide
        img[380:640, 100:118] = (120, 140, 230)  # a soft highlight inside the left edge
        img[400:560, 110:300:12] = 250  # white print: thin lines that reach near both edges
        return self.save("b.png", img)

    def check(self, *args):
        with contextlib.redirect_stdout(io.StringIO()) as log:
            code = cap_check.main(list(args))
        return code, log.getvalue()

    def test_a_centred_cap_passes_with_print_and_highlights_inside(self):
        code, log = self.check("--render", self.bottle(0), "--box", "40,60,360,650", "--split", "330")
        self.assertEqual(code, 0, log)
        self.assertIn("0.0 px", log)

    def test_the_allies_offset_fails(self):
        code, log = self.check("--render", self.bottle(6), "--box", "40,60,360,650", "--split", "330")
        self.assertEqual(code, 1, log)
        self.assertIn("right of the body centre", log)

    def test_a_centred_neck_does_not_hide_a_shifted_cap(self):
        # Devin Review, PR 141: a long centred neck and a short shifted cap of the same width gave one median.
        img = np.full((700, 400, 3), self.STAGE, dtype=float)
        img[100:120, 136:276] = (20, 30, 120)  # the cap, 140 px, 6 px right of the body centre
        img[120:160, 130:270] = (20, 30, 120)  # the neck, 140 px, centred
        img[160:650, 100:300] = (25, 35, 130)  # the body, 200 px
        code, log = self.check("--render", self.save("n.png", img), "--box", "40,60,360,650", "--split", "160")
        self.assertEqual(code, 1, log)
        self.assertIn("6.0 px right", log)

    def test_a_small_width_step_still_parts_the_cap_from_the_neck(self):
        # Devin Review, PR 141: a 4 px step from a 130 px cap to a centred neck must still cut the two apart.
        img = np.full((460, 400, 3), self.STAGE, dtype=float)
        img[20:40, 137:267] = (20, 30, 120)  # the cap, 130 px, 2 px right of the body centre
        img[40:120, 137:263] = (20, 30, 120)  # the neck, 126 px, centred
        img[120:420, 110:290] = (25, 35, 130)  # the body, 180 px
        code, log = self.check("--render", self.save("ws.png", img), "--box", "40,0,360,420", "--split", "120")
        self.assertEqual(code, 1, log)
        self.assertIn("2.0 px right", log)

    def test_the_body_is_below_split_whatever_its_shape(self):
        # Devin Review, PR 141: guessed bodies failed on a tapered body, a tall cap, a tall cap with a collar, a
        # smooth shoulder, a short taper and a short cap over a long shoulder. The body is now the rows below --split,
        # so each shape is measured.
        def taper(img, y0, y1, w0, w1, c=200):
            for i, y in enumerate(range(y0, y1)):
                w = w0 + 2 * round((w1 - w0) / 2 * i / (y1 - y0 - 1))
                img[y, c - w // 2:c + w // 2] = (25, 35, 130)

        def tall_cap(img, s):
            img[20:60, 135 + s:265 + s] = (20, 30, 120)  # a collar, 130 px
            img[60:310, 120 + s:280 + s] = (20, 30, 120)  # the cap, 250 rows, 160 px
            img[310:340, 150 + s:250 + s] = (20, 30, 120)  # the neck, 100 px
            img[340:520, 100:300] = (25, 35, 130)  # the body, 180 rows, 200 px
            return 340, 520

        def tapered_body(img, s):
            img[20:120, 130 + s:270 + s] = (20, 30, 120)  # the cap, 140 px
            img[120:150, 150 + s:250 + s] = (20, 30, 120)  # the neck, 100 px
            taper(img, 150, 360, 180, 220)  # the body, from 180 px to 220 px
            return 150, 360

        def short_taper(img, s):
            img[20:40, 145 + s:255 + s] = (20, 30, 120)  # the cap, 110 px
            img[40:50, 155:245] = (20, 30, 120)  # the neck, 90 px
            taper(img, 50, 130, 100, 200)  # the body, 80 rows, from 100 px to 200 px
            return 50, 130

        def shoulder(img, s):
            img[20:80, 130 + s:270 + s] = (20, 30, 120)  # the top, 140 px
            for i, y in enumerate(range(80, 110)):  # the shoulder, 2 px wider each row, back to the body centre
                w, c = 142 + 2 * i, 200 + s * (29 - i) / 30
                img[y, round(c - w / 2):round(c - w / 2) + w] = (20, 30, 120)
            img[110:350, 100:300] = (25, 35, 130)  # the body, 200 px
            return 80, 350  # --split at the top of the shoulder: the shoulder belongs to the body

        def short_cap_long_shoulder(img, s):
            img[20:40, 130 + s:270 + s] = (20, 30, 120)  # the cap, 20 rows, 140 px
            for i, y in enumerate(range(40, 100)):  # the shoulder, 60 rows, from 141 px to 200 px, back to the centre
                w, c = 141 + i, 200 + s * (59 - i) / 60
                img[y, round(c - w / 2):round(c - w / 2) + w] = (25, 35, 130)
            img[100:400, 100:300] = (25, 35, 130)  # the body, 200 px
            return 40, 400

        for shape in (tall_cap, tapered_body, short_taper, shoulder, short_cap_long_shoulder):
            for s, want in ((0, 0), (6, 1)):
                img = np.full((560, 400, 3), self.STAGE, dtype=float)
                split, bottom = shape(img, s)
                path = self.save(f"{shape.__name__}{s}.png", img)
                code, log = self.check("--render", path, "--box", f"40,0,360,{bottom}", "--split", str(split))
                self.assertEqual(code, want, f"{shape.__name__} {s}: {log}")
                if s:
                    self.assertIn("6.0 px right", log, shape.__name__)

    def test_an_offset_of_exactly_1_percent_passes(self):
        # Devin Review, PR 141: a smoothed width count read a 200 px body as 198 px, so a 2 px offset failed.
        img = np.full((460, 400, 3), self.STAGE, dtype=float)
        img[40:80, 132:272] = (20, 30, 120)  # the cap, 140 px, 2 px right of the body centre
        img[80:380, 100:300] = (25, 35, 130)  # the body, 200 px
        code, log = self.check("--render", self.save("e.png", img), "--box", "40,20,360,380", "--split", "80")
        self.assertEqual(code, 0, log)
        self.assertIn("2.0 px right of the body centre (1.0% of the 200 px body", log)

    def test_a_box_without_a_cap_or_a_split_outside_it_is_refused(self):
        self.assertIn("no cap found", exit_message(
            self.check, "--render", self.bottle(0), "--box", "40,340,360,650", "--split", "345"))
        self.assertIn("not inside the box", exit_message(
            self.check, "--render", self.bottle(0), "--box", "40,60,360,650", "--split", "700"))

if __name__ == "__main__":
    sys.exit(unittest.main())
