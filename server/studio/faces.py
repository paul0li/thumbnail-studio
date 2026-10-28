"""Faces: where they are in the layers, and putting the originals back onto an
image model's result (ADR 0010).

The image model reframes: people come back moved and rescaled, so pasting a
face at its old place would show it twice. Each face is registered instead:
features inside the face in the scene that went to the model are matched
against the result, a similarity transform (move, scale, a little rotation) is
fitted with RANSAC, and the original face is warped by it, its colour matched
to the result's light, and pasted inside a feathered ellipse.

A face that cannot be registered confidently is not pasted approximately: the
whole result is rejected, because an unrestored face is exactly what the
improvement must never ship.

Face boxes come from the layers, not from looking at the composed scene: each
person's cutout is searched for faces, and the boxes are mapped through the
layer's placement in the design document. A face hidden under another layer
is not protected (there is nothing of it to protect), and is reported as such.

The detector is YuNet (MIT, vendored in `models/`), through OpenCV.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

CANVAS = (1280, 720)
MODEL = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"

# A face shorter than this on the canvas is too small to matter at feed size
# and too small to register.
MIN_FACE_HEIGHT = 36
# A face with less than this much of its box visible is under another layer.
MIN_VISIBLE = 0.6
# Detection score for a face in a cutout (a photo of a real person).
CUTOUT_SCORE = 0.7

# Registration: what "confidently" means. Measured on real engine outputs,
# where good registrations have dozens of inliers and a moved face is never
# scaled by more than about 15 %.
MIN_MATCHES = 12
MIN_INLIERS = 10
MIN_INLIER_RATIO = 0.3
SCALE_RANGE = (0.6, 1.6)
# Structural agreement between the warped original face and what the model
# drew there (correlation of gradients inside the face).
MIN_AGREEMENT = 0.35
COLOUR_STRENGTH = 0.8


@dataclass(frozen=True)
class Box:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

    def grow(self, left: float, top: float, right: float, bottom: float) -> Box:
        """Grows by fractions of the box's own size on each side."""
        w, h = self.width, self.height
        return Box(self.x0 - w * left, self.y0 - h * top, self.x1 + w * right, self.y1 + h * bottom)

    def clip(self, width: int, height: int) -> Box:
        return Box(
            max(0.0, self.x0),
            max(0.0, self.y0),
            min(float(width), self.x1),
            min(float(height), self.y1),
        )

    def iou(self, other: Box) -> float:
        inter = Box(
            max(self.x0, other.x0),
            max(self.y0, other.y0),
            min(self.x1, other.x1),
            min(self.y1, other.y1),
        )
        if inter.width <= 0 or inter.height <= 0:
            return 0.0
        return inter.area / (self.area + other.area - inter.area)

    def overlap(self, other: Box) -> float:
        """The share of this box covered by `other`."""
        inter = Box(
            max(self.x0, other.x0),
            max(self.y0, other.y0),
            min(self.x1, other.x1),
            min(self.y1, other.y1),
        )
        if inter.width <= 0 or inter.height <= 0 or self.area == 0:
            return 0.0
        return inter.area / self.area

    def transformed(self, matrix: np.ndarray) -> Box:
        corners = np.array(
            [
                [self.x0, self.y0, 1],
                [self.x1, self.y0, 1],
                [self.x0, self.y1, 1],
                [self.x1, self.y1, 1],
            ]
        )
        points = corners @ matrix.T
        return Box(points[:, 0].min(), points[:, 1].min(), points[:, 0].max(), points[:, 1].max())

    def as_list(self) -> list[int]:
        return [round(self.x0), round(self.y0), round(self.x1), round(self.y1)]


@dataclass(frozen=True)
class Detection:
    box: Box
    score: float


# --- Detection ---------------------------------------------------------------

# `detect(bgr, min_score)`; replaced in tests, where there are no real faces.
Detector = Callable[[np.ndarray, float], list[Detection]]


@cache
def _detector() -> cv2.FaceDetectorYN:
    return cv2.FaceDetectorYN.create(str(MODEL), "", (320, 320), 0.5, 0.3, 5000)


def detect(bgr: np.ndarray, min_score: float = 0.5) -> list[Detection]:
    """Faces in an image, any size. Detection runs at most 1280 px wide (YuNet
    finds faces of every size at that scale) and boxes come back in the
    image's own pixels."""
    height, width = bgr.shape[:2]
    factor = min(1.0, 1280 / max(width, height))
    image = bgr
    if factor < 1:
        image = cv2.resize(
            bgr, (round(width * factor), round(height * factor)), interpolation=cv2.INTER_AREA
        )
    detector = _detector()
    detector.setInputSize((image.shape[1], image.shape[0]))
    detector.setScoreThreshold(min_score)
    _, faces = detector.detect(image)
    if faces is None:
        return []
    found = []
    for row in faces:
        x, y, w, h = (float(v) / factor for v in row[:4])
        found.append(Detection(Box(x, y, x + w, y + h), float(row[14])))
    return found


# --- Faces in the layers -----------------------------------------------------


@dataclass(frozen=True)
class Placement:
    """A person layer as the canvas draws it: the photo stretched to
    `width` x `height`, centred on (`x`, `y`), scaled, maybe mirrored."""

    layer_id: str
    image: Image.Image
    x: float
    y: float
    scale: float
    width: float
    height: float
    flip_x: bool

    def to_canvas(self, px: float, py: float) -> tuple[float, float]:
        """A point in the photo's own pixels, on the canvas."""
        u = px * self.width / self.image.width - self.width / 2
        v = py * self.height / self.image.height - self.height / 2
        if self.flip_x:
            u = -u
        return (self.x + u * self.scale, self.y + v * self.scale)

    def box_to_canvas(self, box: Box) -> Box:
        ax, ay = self.to_canvas(box.x0, box.y0)
        bx, by = self.to_canvas(box.x1, box.y1)
        return Box(min(ax, bx), min(ay, by), max(ax, bx), max(ay, by))

    def alpha_on_canvas(self) -> np.ndarray:
        """This layer's coverage of the canvas, 0..1."""
        w = max(1, round(self.width * self.scale))
        h = max(1, round(self.height * self.scale))
        alpha = self.image.convert("RGBA").getchannel("A").resize((w, h), Image.Resampling.BILINEAR)
        if self.flip_x:
            alpha = alpha.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        canvas = Image.new("L", CANVAS, 0)
        canvas.paste(alpha, (round(self.x - w / 2), round(self.y - h / 2)))
        return np.asarray(canvas, dtype=np.float32) / 255


@dataclass(frozen=True)
class SceneFace:
    layer_id: str
    # The detector's box, on the canvas.
    box: Box
    # How much of it is not under a layer above and is on the canvas.
    visible: float

    @property
    def protected(self) -> bool:
        return self.visible >= MIN_VISIBLE and self.box.height >= MIN_FACE_HEIGHT

    def as_json(self) -> dict:
        return {
            "layer": self.layer_id,
            "box": self.box.as_list(),
            "visible": round(self.visible, 2),
            "protected": self.protected,
        }


def _on_grey(image: Image.Image) -> np.ndarray:
    """A cutout on mid grey, as OpenCV's BGR. The detector never saw
    transparency; grey is the least surprising background for it."""
    rgba = image.convert("RGBA")
    base = Image.new("RGBA", rgba.size, (128, 128, 128, 255))
    base.alpha_composite(rgba)
    return cv2.cvtColor(np.asarray(base.convert("RGB")), cv2.COLOR_RGB2BGR)


def faces_in_layers(people: list[Placement], detector: Detector | None = None) -> list[SceneFace]:
    """Every face in the people's cutouts, on the canvas, with how visible it
    is. `people` are in drawing order: a later one covers an earlier one."""
    detector = detector or detect
    coverage = [p.alpha_on_canvas() for p in people]
    found: list[SceneFace] = []
    for i, person in enumerate(people):
        above = np.zeros(CANVAS[::-1], np.float32)
        for later in coverage[i + 1 :]:
            above = np.maximum(above, later)
        for detection in detector(_on_grey(person.image), CUTOUT_SCORE):
            box = person.box_to_canvas(detection.box)
            found.append(SceneFace(person.layer_id, box, _visible(box, above)))
    return found


def _visible(box: Box, above: np.ndarray) -> float:
    if box.area == 0:
        return 0.0
    on = box.clip(*CANVAS)
    if on.width <= 0 or on.height <= 0:
        return 0.0
    x0, y0, x1, y1 = (round(v) for v in (on.x0, on.y0, on.x1, on.y1))
    covered = float(above[y0:y1, x0:x1].sum()) if x1 > x0 and y1 > y0 else 0.0
    return max(0.0, (on.area - covered) / box.area)


# --- Restoring ---------------------------------------------------------------


class FaceNotRestored(Exception):
    def __init__(self, face: SceneFace, reason: str) -> None:
        super().__init__(f"{face.layer_id} {face.box.as_list()}: {reason}")
        self.face = face
        self.reason = reason


@dataclass(frozen=True)
class Registration:
    face: SceneFace
    # 2x3: scene coordinates to result coordinates.
    matrix: np.ndarray
    matches: int
    inliers: int
    agreement: float

    @property
    def scale(self) -> float:
        return float(math.hypot(self.matrix[0, 0], self.matrix[0, 1]))

    @property
    def box_in_result(self) -> Box:
        return self.face.box.transformed(self.matrix)

    def as_json(self) -> dict:
        dx, dy = self.matrix[0, 2], self.matrix[1, 2]
        return {
            **self.face.as_json(),
            "in_result": self.box_in_result.as_list(),
            "matches": self.matches,
            "inliers": self.inliers,
            "scale": round(self.scale, 3),
            "shift": [round(float(dx)), round(float(dy))],
            "agreement": round(self.agreement, 2),
        }


@dataclass
class Restored:
    image: np.ndarray
    registrations: list[Registration] = field(default_factory=list)


def _restore_region(face: SceneFace) -> Box:
    """What gets pasted: the detector's box (brows to chin) grown to take in
    the forehead, the hair line and a little of the jaw."""
    return face.box.grow(0.18, 0.45, 0.18, 0.12)


def _feature_region(face: SceneFace) -> Box:
    """Where features are looked for: the face and its surroundings (hair,
    glasses, collar), which register more robustly than skin alone."""
    return face.box.grow(0.45, 0.6, 0.45, 0.35)


def _ellipse(box: Box, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, np.float32)
    cx, cy = box.centre
    cv2.ellipse(
        mask,
        (round(cx), round(cy)),
        (max(1, round(box.width * 0.48)), max(1, round(box.height * 0.5))),
        0,
        0,
        360,
        1.0,
        -1,
    )
    return mask


def _match_colour(face: np.ndarray, reference: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Per-channel mean and spread in Lab, measured inside the mask, moved
    most of the way towards the result's: the face takes the new light."""
    a = cv2.cvtColor(face, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(reference, cv2.COLOR_BGR2LAB).astype(np.float32)
    inside = mask > 0.5
    if inside.sum() < 16:
        return face
    for c in range(3):
        ma, sa = a[..., c][inside].mean(), a[..., c][inside].std() + 1e-3
        mb, sb = b[..., c][inside].mean(), b[..., c][inside].std() + 1e-3
        moved = (a[..., c] - ma) * (sb / sa) + mb
        a[..., c] = a[..., c] * (1 - COLOUR_STRENGTH) + moved * COLOUR_STRENGTH
    return cv2.cvtColor(np.clip(a, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def _gradients(gray: np.ndarray) -> np.ndarray:
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.GaussianBlur(cv2.magnitude(gx, gy), (0, 0), 2)


def _agreement(a: np.ndarray, b: np.ndarray, mask: np.ndarray) -> float:
    """Correlation of the gradients of two images inside a mask: about 1 when
    they show the same face in the same place, about 0 when not."""
    inside = mask > 0.5
    if inside.sum() < 64:
        return 0.0
    ga = _gradients(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY))[inside]
    gb = _gradients(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY))[inside]
    ga, gb = ga - ga.mean(), gb - gb.mean()
    denominator = float(np.sqrt((ga * ga).sum() * (gb * gb).sum()))
    return float((ga * gb).sum() / denominator) if denominator > 0 else 0.0


def register(
    scene: np.ndarray,
    result: np.ndarray,
    face: SceneFace,
    result_features: tuple | None = None,
) -> Registration:
    """Where `face` from the scene went in the result. Raises FaceNotRestored
    when that cannot be said confidently."""
    height, width = scene.shape[:2]
    sift = cv2.SIFT_create(4000)
    if result_features is None:
        result_features = sift.detectAndCompute(cv2.cvtColor(result, cv2.COLOR_BGR2GRAY), None)
    result_points, result_descriptors = result_features
    region = _feature_region(face).clip(width, height)
    mask = np.zeros((height, width), np.uint8)
    mask[round(region.y0) : round(region.y1), round(region.x0) : round(region.x1)] = 255
    points, descriptors = sift.detectAndCompute(cv2.cvtColor(scene, cv2.COLOR_BGR2GRAY), mask)
    if descriptors is None or result_descriptors is None or len(points) < 2:
        raise FaceNotRestored(face, "no features")
    pairs = [
        m
        for m, n in (
            p for p in cv2.BFMatcher().knnMatch(descriptors, result_descriptors, k=2) if len(p) == 2
        )
        if m.distance < 0.75 * n.distance
    ]
    if len(pairs) < MIN_MATCHES:
        raise FaceNotRestored(face, f"{len(pairs)} matches")
    source = np.float32([points[m.queryIdx].pt for m in pairs])
    target = np.float32([result_points[m.trainIdx].pt for m in pairs])
    matrix, inliers = cv2.estimateAffinePartial2D(
        source, target, method=cv2.RANSAC, ransacReprojThreshold=4
    )
    if matrix is None or inliers is None:
        raise FaceNotRestored(face, "no transform")
    count = int(inliers.sum())
    if count < MIN_INLIERS or count / len(pairs) < MIN_INLIER_RATIO:
        raise FaceNotRestored(face, f"{count}/{len(pairs)} inliers")
    scale = float(math.hypot(matrix[0, 0], matrix[0, 1]))
    if not SCALE_RANGE[0] <= scale <= SCALE_RANGE[1]:
        raise FaceNotRestored(face, f"scale {scale:.2f}")
    moved = face.box.transformed(matrix)
    cx, cy = moved.centre
    if not (0 <= cx <= width and 0 <= cy <= height):
        raise FaceNotRestored(face, "moved off the canvas")
    warped = cv2.warpAffine(scene, matrix, (width, height), flags=cv2.INTER_LINEAR)
    agreement = _agreement(warped, result, _ellipse(moved, (height, width)))
    if agreement < MIN_AGREEMENT:
        raise FaceNotRestored(face, f"agreement {agreement:.2f}")
    return Registration(face, matrix, len(pairs), count, agreement)


def restore(scene: np.ndarray, result: np.ndarray, faces: list[SceneFace]) -> Restored:
    """`result` with every protected face of `scene` put back. Both are BGR,
    the same size. Raises FaceNotRestored on the first face that cannot be."""
    if scene.shape != result.shape:
        raise ValueError("scene and result must be the same size")
    height, width = scene.shape[:2]
    sift = cv2.SIFT_create(4000)
    result_features = sift.detectAndCompute(cv2.cvtColor(result, cv2.COLOR_BGR2GRAY), None)
    out = result.astype(np.float32)
    registrations = []
    for face in faces:
        if not face.protected:
            continue
        reg = register(scene, result, face, result_features)
        registrations.append(reg)
        original = cv2.warpAffine(scene, reg.matrix, (width, height), flags=cv2.INTER_LANCZOS4)
        region = _restore_region(face)
        mask = cv2.warpAffine(_ellipse(region, (height, width)), reg.matrix, (width, height))
        feather = max(2.0, 0.08 * region.height * reg.scale)
        mask = cv2.GaussianBlur(mask, (0, 0), feather)
        original = _match_colour(original, result, mask)
        out = out * (1 - mask[..., None]) + original.astype(np.float32) * mask[..., None]
    return Restored(np.clip(out, 0, 255).astype(np.uint8), registrations)


# --- Faces that were not there ----------------------------------------------

# A face in the result counts as a person only if the detector is sure and it
# is about as large as the people's faces: the background's illustrated faces
# are mostly smaller, and the ones that are large were already in the scene.
EXTRA_SCORE = 0.8
EXTRA_MIN_RELATIVE_HEIGHT = 0.6  # of the median height of the people's faces
EXPLAINED_IOU = 0.25


@dataclass(frozen=True)
class ExtraFace:
    box: Box
    score: float

    def as_json(self) -> dict:
        return {"box": self.box.as_list(), "score": round(self.score, 2)}


def extra_faces(
    scene: np.ndarray,
    result: np.ndarray,
    faces: list[SceneFace],
    registrations: list[Registration],
    detector: Detector | None = None,
) -> list[ExtraFace]:
    """Faces in the result that are neither a restored face, nor a face of a
    person in the layers (protected or hidden), nor a face the detector also
    finds in the scene, allowing for the model having moved things as much
    as it moved the people."""
    detector = detector or detect
    restored = [r.box_in_result for r in registrations]
    reference = [r.face.box.height * r.scale for r in registrations] or [
        f.box.height for f in faces if f.box.height >= MIN_FACE_HEIGHT
    ]
    if not reference:
        reference = [MIN_FACE_HEIGHT / EXTRA_MIN_RELATIVE_HEIGHT]
    min_height = max(MIN_FACE_HEIGHT, EXTRA_MIN_RELATIVE_HEIGHT * float(np.median(reference)))
    moves = [np.eye(2, 3)] + [r.matrix for r in registrations]
    known = [d.box for d in detector(scene, 0.5)] + [f.box for f in faces]
    candidates = [known_box.transformed(m) for known_box in known for m in moves]
    extra = []
    for detection in detector(result, EXTRA_SCORE):
        box = detection.box
        if box.height < min_height:
            continue
        if any(box.iou(r) >= EXPLAINED_IOU or box.overlap(r) >= 0.5 for r in restored):
            continue
        if any(box.iou(c) >= EXPLAINED_IOU for c in candidates):
            continue
        extra.append(ExtraFace(box, detection.score))
    return extra
