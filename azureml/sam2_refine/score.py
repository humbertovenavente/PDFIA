import base64
import io
import os
from typing import Any, Dict, List, Optional

import numpy as np
from PIL import Image

import requests

try:
    import cv2
except Exception:
    cv2 = None

import torch

# SAM2 from official repo (installed via pip/git)
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

_predictor: Optional[SAM2ImagePredictor] = None


def _decode_image_base64(image_b64: str) -> Image.Image:
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    raw = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _download_file(url: str, dest_path: str) -> None:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)


def _get_checkpoint_path() -> str:
    # Prefer explicit local checkpoint
    explicit = (os.getenv("SAM2_CHECKPOINT_PATH") or "").strip()
    if explicit and os.path.exists(explicit):
        return explicit

    # Optional mount from Azure ML model dir
    model_dir = (os.getenv("AZUREML_MODEL_DIR") or "").strip()
    if model_dir and os.path.isdir(model_dir):
        for root, _, files in os.walk(model_dir):
            for f in files:
                if f.lower().endswith(".pt"):
                    return os.path.join(root, f)

    # Otherwise download to /tmp
    url = (os.getenv("SAM2_CHECKPOINT_URL") or "").strip() or (
        "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt"
    )
    dest = os.path.join("/tmp", "sam2", os.path.basename(url))
    if not os.path.exists(dest):
        _download_file(url, dest)
    return dest


def init() -> None:
    global _predictor

    model_cfg = (os.getenv("SAM2_MODEL_CFG") or "").strip() or "configs/sam2.1/sam2.1_hiera_l.yaml"
    ckpt = _get_checkpoint_path()

    model = build_sam2(model_cfg, ckpt)
    _predictor = SAM2ImagePredictor(model)


def _mask_to_polygon(mask: np.ndarray, max_points: int = 120) -> Optional[List[List[int]]]:
    if cv2 is None:
        return None

    if mask.dtype != np.uint8:
        mask = (mask > 0).astype(np.uint8) * 255

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    cnt = max(contours, key=cv2.contourArea)
    if cnt is None or len(cnt) < 3:
        return None

    epsilon = 0.002 * cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, epsilon, True)
    pts = approx.reshape(-1, 2).tolist()

    if len(pts) > max_points:
        step = max(1, len(pts) // max_points)
        pts = pts[::step]

    return [[int(x), int(y)] for x, y in pts]


def _bbox_from_mask(mask: np.ndarray) -> Optional[Dict[str, int]]:
    ys, xs = np.where(mask > 0)
    if xs.size == 0 or ys.size == 0:
        return None
    x1 = int(xs.min())
    y1 = int(ys.min())
    x2 = int(xs.max())
    y2 = int(ys.max())
    return {"x": x1, "y": y1, "width": max(1, x2 - x1), "height": max(1, y2 - y1)}


def run(raw_data: Any) -> Dict[str, Any]:
    global _predictor
    if _predictor is None:
        init()

    if isinstance(raw_data, (bytes, bytearray)):
        raw_data = raw_data.decode("utf-8")

    if isinstance(raw_data, str):
        import json

        data = json.loads(raw_data)
    else:
        data = raw_data

    task = (data.get("task") or "segment_refine").strip()
    if task != "segment_refine":
        return {"error": "Unsupported task", "task": task}

    image_b64 = data.get("image_base64") or data.get("image")
    if not image_b64:
        return {"error": "No image_base64 provided"}

    point = data.get("point")
    bbox = data.get("bbox")

    img = _decode_image_base64(image_b64)
    np_img = np.array(img)

    # Set image
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
        _predictor.set_image(np_img)

        point_coords = None
        point_labels = None
        box_xyxy = None

        if isinstance(point, dict) and point.get("x") is not None and point.get("y") is not None:
            point_coords = np.array([[float(point["x"]), float(point["y"]) ]], dtype=np.float32)
            point_labels = np.array([1], dtype=np.int32)

        if isinstance(bbox, dict) and all(k in bbox for k in ("x", "y", "width", "height")):
            x1 = float(bbox["x"])
            y1 = float(bbox["y"])
            x2 = x1 + float(bbox["width"])
            y2 = y1 + float(bbox["height"])
            box_xyxy = np.array([x1, y1, x2, y2], dtype=np.float32)

        if point_coords is None and box_xyxy is None:
            return {"error": "Provide point{x,y} or bbox{x,y,width,height}"}

        masks, scores, _ = _predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box_xyxy,
            multimask_output=True,
            normalize_coords=False,
        )

    # Choose best mask by score
    if masks is None or len(masks) == 0:
        return {"regions": [], "count": 0}

    best_idx = int(np.argmax(scores)) if scores is not None and len(scores) > 0 else 0
    best_mask = masks[best_idx]
    best_score = float(scores[best_idx]) if scores is not None and len(scores) > best_idx else 0.0

    # Convert to uint8 mask for contour
    mask_u8 = (best_mask > 0).astype(np.uint8) * 255
    poly = _mask_to_polygon(mask_u8)
    bbox2 = _bbox_from_mask(mask_u8)

    h, w = np_img.shape[:2]

    region = {
        "id": "sam2_0",
        "confidence": best_score * 100.0,
        "type": "mask",
        "is_visual": True,
        "polygon": poly,
    }
    if bbox2:
        region.update(bbox2)

    return {"regions": [region], "count": 1, "image_size": {"width": w, "height": h}}
