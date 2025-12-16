import base64
import io
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

try:
    import cv2
except Exception:
    cv2 = None

try:
    from ultralytics import YOLO
except Exception:
    YOLO = None

_model = None


def _decode_image_base64(image_b64: str) -> Image.Image:
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    raw = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def _find_model_path() -> Optional[str]:
    explicit = (os.getenv("MODEL_PATH") or "").strip()
    if explicit and os.path.exists(explicit):
        return explicit

    model_dir = (os.getenv("AZUREML_MODEL_DIR") or "").strip()
    if model_dir and os.path.isdir(model_dir):
        for root, _, files in os.walk(model_dir):
            for f in files:
                if f.lower().endswith(".pt"):
                    return os.path.join(root, f)

    return None


def init() -> None:
    global _model
    if YOLO is None:
        raise RuntimeError("ultralytics is not installed in the inference environment")

    model_path = _find_model_path() or (os.getenv("YOLO_WEIGHTS") or "yolov8l-seg.pt")
    _model = YOLO(model_path)


def _mask_to_polygon(mask: np.ndarray, max_points: int = 80) -> Optional[List[List[int]]]:
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

    epsilon = 0.003 * cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, epsilon, True)
    pts = approx.reshape(-1, 2).tolist()

    if len(pts) > max_points:
        step = max(1, len(pts) // max_points)
        pts = pts[::step]

    return [[int(x), int(y)] for x, y in pts]


def run(raw_data: Any) -> Dict[str, Any]:
    if _model is None:
        init()

    if isinstance(raw_data, (bytes, bytearray)):
        raw_data = raw_data.decode("utf-8")

    if isinstance(raw_data, str):
        import json

        data = json.loads(raw_data)
    else:
        data = raw_data

    task = (data.get("task") or "segment_auto").strip()
    if task != "segment_auto":
        return {"error": "Unsupported task", "task": task}

    image_b64 = data.get("image_base64") or data.get("image")
    if not image_b64:
        return {"error": "No image_base64 provided"}

    max_masks = int(data.get("max_masks") or 20)
    conf = float(data.get("conf") or 0.25)

    img = _decode_image_base64(image_b64)
    np_img = np.array(img)

    results = _model.predict(np_img, conf=conf, verbose=False)
    if not results:
        return {"regions": [], "count": 0}

    r0 = results[0]
    regions: List[Dict[str, Any]] = []

    masks = getattr(r0, "masks", None)
    boxes = getattr(r0, "boxes", None)

    if masks is None or boxes is None:
        return {"regions": [], "count": 0}

    xyxy = boxes.xyxy.detach().cpu().numpy() if hasattr(boxes, "xyxy") else None
    confs = boxes.conf.detach().cpu().numpy() if hasattr(boxes, "conf") else None

    mask_data = masks.data.detach().cpu().numpy() if hasattr(masks, "data") else None
    if xyxy is None or confs is None or mask_data is None:
        return {"regions": [], "count": 0}

    h, w = np_img.shape[:2]

    for i in range(min(len(xyxy), len(mask_data))):
        x1, y1, x2, y2 = xyxy[i]
        x1, y1, x2, y2 = int(max(0, x1)), int(max(0, y1)), int(min(w, x2)), int(min(h, y2))
        bw = max(1, x2 - x1)
        bh = max(1, y2 - y1)

        poly = _mask_to_polygon((mask_data[i] > 0.5).astype(np.uint8) * 255)
        regions.append(
            {
                "id": f"yolo_{i}",
                "x": x1,
                "y": y1,
                "width": bw,
                "height": bh,
                "confidence": float(confs[i]) * 100.0,
                "type": "garment",
                "is_visual": True,
                "polygon": poly,
            }
        )

    regions.sort(key=lambda rr: rr["confidence"], reverse=True)
    regions = regions[:max_masks]

    return {"regions": regions, "count": len(regions), "image_size": {"width": w, "height": h}}
