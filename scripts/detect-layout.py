#!/usr/bin/env python3
"""Refine a fixed OMG layout from icon-content evidence without a runtime web dependency."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import cv2
    import numpy as np
except ImportError as error:
    raise SystemExit(
        "Missing dependencies. Run: py -3 -m pip install -r requirements-layout.txt"
    ) from error


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class Detection:
    rect: Rect
    score: float
    seed_score: float
    seed_iou: float
    method: str
    accepted: bool


SCALES = (0.92, 0.96, 1.00, 1.04, 1.08)
MATCH_CROP_RATIO = 0.76


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Use icon content and local Canny evidence to refine a saved OMG layout JSON."
    )
    parser.add_argument("--image", type=Path, required=True, help="2560x1440 PNG screenshot")
    parser.add_argument("--seed", type=Path, required=True, help="Existing omg-layout-2560x1440.json")
    parser.add_argument("--output", type=Path, required=True, help="Refined layout JSON output")
    parser.add_argument("--debug", type=Path, help="Annotated PNG output")
    parser.add_argument("--edges", type=Path, help="Canny edge PNG output")
    parser.add_argument("--report", type=Path, help="Per-slot confidence JSON output")
    parser.add_argument("--method", choices=("canny", "lab", "hybrid", "bright-dark"), default="hybrid", help="Candidate scoring method")
    parser.add_argument("--max-shift", type=int, default=12, help="Maximum x/y correction from each seed rect")
    parser.add_argument("--min-score", type=float, default=0.035, help="Minimum method score to accept")
    parser.add_argument("--min-iou", type=float, default=0.78, help="Minimum IoU agreement with the hand-tuned seed")
    return parser.parse_args()


def load_seed(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("version") != 1 or payload.get("width") != 2560 or payload.get("height") != 1440:
        raise ValueError("Seed layout must be a version 1, 2560x1440 layout file")
    slots = payload.get("slots")
    if not isinstance(slots, list) or len(slots) != 60:
        raise ValueError("Seed layout must contain exactly 60 slots")
    return payload, slots


def to_rect(raw: dict[str, Any]) -> Rect:
    rect = raw.get("rect")
    if not isinstance(rect, dict):
        raise ValueError("Each seed slot must contain a rect")
    values = (rect.get("x"), rect.get("y"), rect.get("width"), rect.get("height"))
    if not all(isinstance(value, (int, float)) for value in values):
        raise ValueError("Each seed rect must contain numeric x, y, width, and height")
    return Rect(*(round(value) for value in values))


def canny_edges(image: np.ndarray) -> np.ndarray:
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    denoised = cv2.GaussianBlur(grayscale, (5, 5), 1.1)
    return cv2.Canny(denoised, 55, 145, apertureSize=3, L2gradient=True)


def lab_channels(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    chroma = np.hypot(lab[:, :, 1] - 128, lab[:, :, 2] - 128)
    threshold = max(16.0, float(np.percentile(chroma, 62)))
    return (chroma >= threshold).astype(np.uint8), lab[:, :, 0] / 255.0


def integral_image(edges: np.ndarray) -> np.ndarray:
    return cv2.integral((edges > 0).astype(np.float32))


def value_integral(values: np.ndarray) -> np.ndarray:
    return cv2.integral(values.astype(np.float32))


def rectangle_sum(integral: np.ndarray, x: int, y: int, width: int, height: int) -> float:
    x1 = max(0, x)
    y1 = max(0, y)
    x2 = min(integral.shape[1] - 1, x + width)
    y2 = min(integral.shape[0] - 1, y + height)
    if x2 <= x1 or y2 <= y1:
        return 0
    return float(integral[y2, x2] - integral[y1, x2] - integral[y2, x1] + integral[y1, x1])


def density(integral: np.ndarray, x: int, y: int, width: int, height: int) -> float:
    if width <= 0 or height <= 0:
        return 0.0
    return rectangle_sum(integral, x, y, width, height) / (width * height)


def match_crop(rect: Rect) -> Rect:
    inset_x = round(rect.width * (1 - MATCH_CROP_RATIO) / 2)
    inset_y = round(rect.height * (1 - MATCH_CROP_RATIO) / 2)
    return Rect(
        rect.x + inset_x,
        rect.y + inset_y,
        round(rect.width * MATCH_CROP_RATIO),
        round(rect.height * MATCH_CROP_RATIO),
    )


def edge_density(edge_integral: np.ndarray, crop: Rect) -> float:
    band = 3
    top = density(edge_integral, crop.x, crop.y - band, crop.width, band * 2 + 1)
    bottom = density(edge_integral, crop.x, crop.y + crop.height - band, crop.width, band * 2 + 1)
    left = density(edge_integral, crop.x - band, crop.y, band * 2 + 1, crop.height)
    right = density(edge_integral, crop.x + crop.width - band, crop.y, band * 2 + 1, crop.height)
    return (top + bottom + left + right) / 4


def ring_density(content_integral: np.ndarray, outer: Rect, inner: Rect) -> float:
    outer_pixels = rectangle_sum(content_integral, outer.x, outer.y, outer.width, outer.height)
    inner_pixels = rectangle_sum(content_integral, inner.x, inner.y, inner.width, inner.height)
    ring_area = outer.width * outer.height - inner.width * inner.height
    return max(0, outer_pixels - inner_pixels) / max(1, ring_area)


def score_rect(method: str, edge_integral: np.ndarray, content_integral: np.ndarray, light_integral: np.ndarray, rect: Rect, image_width: int, image_height: int) -> float:
    if rect.x < 3 or rect.y < 3 or rect.x + rect.width >= image_width - 3 or rect.y + rect.height >= image_height - 3:
        return -1.0
    crop = match_crop(rect)
    canny_score = edge_density(edge_integral, crop)
    lab_score = density(content_integral, crop.x, crop.y, crop.width, crop.height) - ring_density(content_integral, rect, crop) * 0.25
    bright_dark_score = (density(light_integral, crop.x, crop.y, crop.width, crop.height) - ring_density(light_integral, rect, crop)) * 0.72 + lab_score * 0.28
    if method == "canny":
        return canny_score
    if method == "lab":
        return lab_score
    if method == "bright-dark":
        return bright_dark_score
    return lab_score * 0.82 + canny_score * 0.18


def candidates(seed: Rect, max_shift: int) -> list[Rect]:
    values: list[Rect] = []
    for x_shift in range(-max_shift, max_shift + 1, 4):
        for y_shift in range(-max_shift, max_shift + 1, 4):
            for scale in SCALES:
                values.append(
                    Rect(
                        seed.x + x_shift,
                        seed.y + y_shift,
                        max(32, round(seed.width * scale)),
                        max(32, round(seed.height * scale)),
                    )
                )
    return values


def refine_candidate(method: str, best: Rect, edge_integral: np.ndarray, content_integral: np.ndarray, light_integral: np.ndarray, image_width: int, image_height: int) -> tuple[Rect, float]:
    best_score = score_rect(method, edge_integral, content_integral, light_integral, best, image_width, image_height)
    base = best
    for x_shift in range(-4, 5):
        for y_shift in range(-4, 5):
            for width_delta in range(-4, 5, 2):
                for height_delta in range(-4, 5, 2):
                    candidate = Rect(base.x + x_shift, base.y + y_shift, base.width + width_delta, base.height + height_delta)
                    score = score_rect(method, edge_integral, content_integral, light_integral, candidate, image_width, image_height)
                    if score > best_score:
                        best, best_score = candidate, score
    return best, best_score


def is_plausible(seed: Rect, candidate: Rect) -> bool:
    width_scale = candidate.width / seed.width
    height_scale = candidate.height / seed.height
    aspect_change = (candidate.width / candidate.height) / (seed.width / seed.height)
    return 0.65 <= width_scale <= 1.40 and 0.65 <= height_scale <= 1.40 and 0.78 <= aspect_change <= 1.28


def iou(left: Rect, right: Rect) -> float:
    x1 = max(left.x, right.x)
    y1 = max(left.y, right.y)
    x2 = min(left.x + left.width, right.x + right.width)
    y2 = min(left.y + left.height, right.y + right.height)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = left.width * left.height + right.width * right.height - intersection
    return intersection / union if union else 0.0


def detect_rect(method: str, seed: Rect, edge_integral: np.ndarray, content_integral: np.ndarray, light_integral: np.ndarray, image_width: int, image_height: int, max_shift: int, min_score: float, min_iou: float) -> Detection:
    seed_score = score_rect(method, edge_integral, content_integral, light_integral, seed, image_width, image_height)
    best = seed
    best_score = seed_score
    for candidate in candidates(seed, max_shift):
        if not is_plausible(seed, candidate):
            continue
        score = score_rect(method, edge_integral, content_integral, light_integral, candidate, image_width, image_height)
        if score > best_score:
            best, best_score = candidate, score
    best, best_score = refine_candidate(method, best, edge_integral, content_integral, light_integral, image_width, image_height)
    seed_iou = iou(seed, best)
    # Agreement is reported for comparison only. The automatic candidate is always emitted.
    accepted = is_plausible(seed, best) and seed_iou >= min_iou and best_score >= min_score and best_score > seed_score
    return Detection(best, best_score, seed_score, seed_iou, method, accepted)


def draw_debug(image: np.ndarray, slots: list[dict[str, Any]], detections: list[Detection]) -> np.ndarray:
    canvas = image.copy()
    for index, (slot, detection) in enumerate(zip(slots, detections), start=1):
        seed_crop = match_crop(to_rect(slot))
        candidate_crop = match_crop(detection.rect)
        cv2.rectangle(canvas, (seed_crop.x, seed_crop.y), (seed_crop.x + seed_crop.width, seed_crop.y + seed_crop.height), (255, 255, 0), 2)
        cv2.rectangle(canvas, (candidate_crop.x, candidate_crop.y), (candidate_crop.x + candidate_crop.width, candidate_crop.y + candidate_crop.height), (255, 0, 255), 2)
        cv2.putText(canvas, f"{index}:{detection.seed_iou:.2f}", (candidate_crop.x, max(18, candidate_crop.y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (255, 0, 255), 1, cv2.LINE_AA)
    return canvas


def main() -> None:
    args = parse_args()
    image = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to read image: {args.image}")
    image_height, image_width = image.shape[:2]
    if (image_width, image_height) != (2560, 1440):
        raise ValueError(f"Expected a 2560x1440 image, received {image_width}x{image_height}")

    seed_payload, slots = load_seed(args.seed)
    edges = canny_edges(image)
    edge_integral = integral_image(edges)
    content, lightness = lab_channels(image)
    content_integral = integral_image(content)
    light_integral = value_integral(lightness)
    detections = [detect_rect(args.method, to_rect(slot), edge_integral, content_integral, light_integral, image_width, image_height, args.max_shift, args.min_score, args.min_iou) for slot in slots]

    output_slots = []
    for slot, detection in zip(slots, detections):
        output_slots.append({**slot, "rect": detection.rect.__dict__})
    output = {**seed_payload, "slots": output_slots}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

    report_path = args.report or args.output.with_suffix(".report.json")
    report = {
        "image": str(args.image),
        "method": args.method,
        "highAgreement": sum(item.accepted for item in detections),
        "total": len(detections),
        "slots": [
            {
                "index": index,
                "category": slot["category"],
                "highAgreement": detection.accepted,
                "score": round(detection.score, 5),
                "seedScore": round(detection.seed_score, 5),
                "seedIou": round(detection.seed_iou, 5),
                "method": detection.method,
                "rect": detection.rect.__dict__,
                "matchCrop": match_crop(detection.rect).__dict__,
            }
            for index, (slot, detection) in enumerate(zip(slots, detections))
        ],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    if args.debug:
        args.debug.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.debug), draw_debug(image, slots, detections))
    if args.edges:
        args.edges.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.edges), edges)
    print(f"High agreement: {report['highAgreement']}/{report['total']} {args.method} candidates")
    print(f"Layout: {args.output}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Layout detection failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
