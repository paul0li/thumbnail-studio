"""Faces from the layers, registration and the added-face check, on
synthetic pictures (there are no real faces in the repository)."""

import cv2
import numpy as np
import pytest
from PIL import Image

from studio import faces

from .conftest import texture


def placement(image, x=640, y=360, scale=1.0, flip=False, layer_id="p"):
    return faces.Placement(layer_id, image, x, y, scale, image.width, image.height, flip)


def test_a_point_in_the_photo_lands_where_the_canvas_draws_it():
    photo = Image.new("RGBA", (200, 100))
    p = placement(photo, x=500, y=300, scale=2.0)
    assert p.to_canvas(0, 0) == (300, 200)
    assert p.to_canvas(200, 100) == (700, 400)
    mirrored = placement(photo, x=500, y=300, scale=2.0, flip=True)
    assert mirrored.to_canvas(0, 0) == (700, 200)
    box = mirrored.box_to_canvas(faces.Box(0, 0, 50, 50))
    assert box.as_list() == [600, 200, 700, 300]


def test_the_photo_may_be_drawn_at_another_size_than_its_file():
    photo = Image.new("RGBA", (400, 200))
    p = faces.Placement("p", photo, 640, 360, 1.0, 200, 100, False)
    assert p.to_canvas(400, 200) == (740, 410)


def test_a_face_under_a_later_layer_is_not_protected():
    under = Image.new("RGBA", (200, 200), (200, 100, 100, 255))
    cover = Image.new("RGBA", (200, 200), (10, 10, 10, 255))

    def detector(bgr, score):
        return [faces.Detection(faces.Box(50, 50, 150, 150), 0.9)]

    found = faces.faces_in_layers(
        [placement(under, layer_id="under"), placement(cover, x=660, layer_id="cover")],
        detector,
    )
    by_layer = {f.layer_id: f for f in found}
    assert by_layer["under"].visible < 0.2
    assert not by_layer["under"].protected
    assert by_layer["cover"].visible == pytest.approx(1.0)
    assert by_layer["cover"].protected


def test_a_face_off_the_canvas_is_not_protected():
    photo = Image.new("RGBA", (200, 200), (200, 100, 100, 255))
    found = faces.faces_in_layers(
        [placement(photo, x=1330)],
        lambda bgr, s: [faces.Detection(faces.Box(50, 50, 150, 150), 0.9)],
    )
    assert found[0].visible < faces.MIN_VISIBLE


def bgr(image):
    return cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)


def shifted(image, dx, dy, scale):
    matrix = np.float32([[scale, 0, dx], [0, scale, dy]])
    return cv2.warpAffine(bgr(image), matrix, image.size, borderMode=cv2.BORDER_REFLECT)


FACE = faces.SceneFace("p", faces.Box(500, 250, 640, 420), 1.0)


def whole(scene):
    """The scene as one person layer covering the canvas."""
    return [placement(scene)]


def test_registration_finds_how_the_engine_moved_and_scaled_a_face():
    scene = texture((1280, 720), seed=5)
    result = shifted(scene, 40, -20, 1.08)
    reg = faces.register(bgr(scene), result, FACE)
    assert reg.scale == pytest.approx(1.08, abs=0.01)
    moved = reg.box_in_result
    assert moved.x0 == pytest.approx(500 * 1.08 + 40, abs=2)
    assert moved.y0 == pytest.approx(250 * 1.08 - 20, abs=2)


def test_a_face_that_is_not_in_the_result_is_not_restored():
    scene = texture((1280, 720), seed=5)
    other = bgr(texture((1280, 720), seed=6))
    with pytest.raises(faces.FaceNotRestored):
        faces.restore(bgr(scene), other, [FACE], whole(scene))


def test_restoring_puts_the_original_face_back_where_it_went():
    scene = texture((1280, 720), seed=5)
    result = shifted(scene, 40, -20, 1.08)
    # The engine smeared the face: blur it where it went.
    region = (slice(250, 450), slice(560, 720))
    result[region] = cv2.GaussianBlur(result[region], (0, 0), 6)
    expected = shifted(scene, 40, -20, 1.08)
    restored = faces.restore(bgr(scene), result, [FACE], whole(scene))
    inner = (slice(300, 400), slice(600, 680))
    sharpness = [cv2.Laplacian(img[inner], cv2.CV_64F).var() for img in (result, restored.image)]
    # The detail is back (its colour is matched to the blurred light, so the
    # pixels are not the original's exactly).
    assert sharpness[1] > 5 * sharpness[0]
    before = np.abs(result[inner].astype(float) - expected[inner]).mean()
    after = np.abs(restored.image[inner].astype(float) - expected[inner]).mean()
    assert after < before * 0.75
    # Far from the face, the result is untouched.
    far = (slice(600, 700), slice(50, 200))
    assert np.array_equal(restored.image[far], result[far])


def test_what_sits_over_the_head_in_the_scene_is_not_pasted_back():
    # The person's layer stops above the head; the scene has the plain title
    # there, which the engine moved away.
    person = texture((1280, 720), seed=5).convert("RGBA")
    person.paste((0, 0, 0, 0), (0, 0, 1280, 230))
    background = texture((1280, 720), seed=7)
    clean = background.copy()
    clean.paste(person, (0, 0), person)
    scene = clean.copy()
    scene.paste((255, 255, 255), (520, 180, 620, 225))
    result = shifted(clean, 40, -20, 1.08)
    restored = faces.restore(bgr(scene), result, [FACE], [placement(person)])
    assert restored.registrations
    # Where the old title would land, the result is untouched.
    above = (slice(180, 220), slice(600, 690))
    assert np.array_equal(restored.image[above], result[above])


def test_hidden_faces_are_not_registered():
    scene = texture((1280, 720), seed=5)
    other = bgr(texture((1280, 720), seed=6))
    hidden = faces.SceneFace("p", FACE.box, 0.2)
    assert faces.restore(bgr(scene), other, [hidden], whole(scene)).registrations == []


def test_a_large_new_face_is_extra_and_a_known_or_small_one_is_not():
    scene = bgr(texture((1280, 720), seed=5))
    result = shifted(texture((1280, 720), seed=5), 40, -20, 1.08)
    reg = faces.register(scene, result, FACE)
    in_scene = faces.Detection(faces.Box(100, 100, 220, 260), 0.9)
    seen = {"scene": [in_scene], "result": []}

    def detector(image, score):
        which = "scene" if image is scene else "result"
        return [d for d in seen[which] if d.score >= score]

    seen["result"] = [
        # The restored face, where it went.
        faces.Detection(reg.box_in_result, 0.95),
        # The background face that was already in the scene, moved like the people.
        faces.Detection(in_scene.box.transformed(reg.matrix), 0.9),
        # A small illustrated face.
        faces.Detection(faces.Box(900, 100, 950, 160), 0.95),
    ]
    assert faces.extra_faces(scene, result, [FACE], [reg], detector) == []
    new = faces.Detection(faces.Box(900, 300, 1040, 480), 0.92)
    seen["result"].append(new)
    (extra,) = faces.extra_faces(scene, result, [FACE], [reg], detector)
    assert extra.box == new.box
