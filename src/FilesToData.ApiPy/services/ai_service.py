import base64
import json
import os
import re
from typing import Any, Dict, Optional

import requests


def _null_if_empty(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = s.strip()
    return s or None


def _extract_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()

    if not text:
        raise ValueError("Claude response did not contain valid JSON")

    # Strip fenced code blocks if present.
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if fence_match:
        text = (fence_match.group(1) or "").strip()

    # Try direct JSON parse first.
    candidates: list[str] = [text]

    obj_start = text.find("{")
    obj_end = text.rfind("}")
    if obj_start >= 0 and obj_end > obj_start:
        candidates.append(text[obj_start : obj_end + 1])

    arr_start = text.find("[")
    arr_end = text.rfind("]")
    if arr_start >= 0 and arr_end > arr_start:
        candidates.append(text[arr_start : arr_end + 1])

    last_error: Optional[Exception] = None
    for c in candidates:
        try:
            parsed = json.loads(c)
            if isinstance(parsed, dict):
                return parsed
            # If the model returned a list, wrap it.
            return {"items": parsed}
        except Exception as ex:
            last_error = ex

    raise ValueError(f"Claude response did not contain valid JSON: {last_error}")


class AiService:
    def __init__(self) -> None:
        self._api_key = _null_if_empty(os.getenv("CLAUDE_API_KEY"))
        self._model = _null_if_empty(os.getenv("CLAUDE_MODEL")) or "claude-3-sonnet-20240229"
        self._timeout = int((_null_if_empty(os.getenv("CLAUDE_TIMEOUT_SECONDS")) or "300"))

    def _call_messages_api(self, max_tokens: int, content: list[dict]) -> str:
        if not self._api_key:
            raise RuntimeError("CLAUDE_API_KEY is not configured")

        payload = {
            "model": self._model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "messages": [{"role": "user", "content": content}],
        }

        headers = {
            "x-api-key": self._api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json=payload,
            timeout=self._timeout,
        )

        if resp.status_code // 100 != 2:
            raise RuntimeError(f"Claude API error: {resp.status_code} - {resp.text}")

        data = resp.json()
        for item in data.get("content", []):
            if item.get("type") == "text":
                return item.get("text") or ""

        return json.dumps(data)

    def _parse_or_repair_json(self, response_text: str, schema_hint: str) -> Dict[str, Any]:
        try:
            return _extract_json(response_text)
        except Exception:
            repair_prompt = (
                "You previously returned INVALID JSON. Your task is to FIX it. "
                "Return ONLY valid JSON and nothing else. "
                "Do not add commentary.\n\n"
                "JSON schema (high level):\n"
                + schema_hint
                + "\n\n"
                "INVALID OUTPUT TO FIX:\n"
                + (response_text or "")
            )
            repaired = self._call_messages_api(
                max_tokens=4096,
                content=[{"type": "text", "text": repair_prompt}],
            )
            return _extract_json(repaired)

    def _extract_section(self, section_name: str, schema: str, masked_text: str) -> Dict[str, Any]:
        """Extract a single section from the document."""
        prompt = f'''You are a JSON extraction service. Extract ONLY the "{section_name}" section.
Return ONLY valid JSON matching this schema:

{schema}

RULES:
- Extract ALL rows if it's a table.
- Use null for missing values.
- Output ONLY JSON, no explanations.

DOCUMENT TEXT:
{masked_text}'''

        response_text = self._call_messages_api(
            max_tokens=4096,
            content=[{"type": "text", "text": prompt}],
        )
        return _extract_json(response_text)

    def extract_document_data(self, masked_text: str) -> Dict[str, Any]:
        """Extract document data by calling Claude once per section (async-friendly)."""
        import concurrent.futures

        sections = {
            "product_overview": '''{
  "product_name": "e.g. RTW UT BABY LONG SLEEVE TEE",
  "product_id": "e.g. PID-0L853L",
  "status": "e.g. PRODUCTION",
  "brand": "e.g. Universal Thread",
  "department": "e.g. 13: UNIVERSAL THREAD",
  "division": "e.g. 6: READY-TO-WEAR",
  "class": null,
  "primary_material": "e.g. FAB-L5RG8",
  "secondary_material": null,
  "vendor_style_number": null,
  "additional_product_details": null,
  "system_tags": "e.g. New",
  "tags": null,
  "workspace_name": null,
  "workspace_id": "e.g. WRK-E0XP",
  "design_cycle": "e.g. C4 2025",
  "set_dates": null
}''',
            "table_of_contents": '''[
  {"section": "OVERVIEW", "page_title": "product name"},
  {"section": "BILL OF MATERIALS", "page_title": "1 bill of materials"},
  {"section": "MEASUREMENTS", "page_title": "2 measurements"}
]''',
            "bom_product_materials": '''[
  {
    "row": 1,
    "section": "BODY",
    "use": "SELF",
    "material_type": "FABRIC",
    "connected_material_asset": "FAB-XXXXX",
    "additional_material_details": "description",
    "origin": null,
    "certifications": null,
    "yield_consumption": null,
    "weight": null,
    "size": null,
    "supplier": null,
    "facility_laundry": null,
    "bom_code": "BOM-XXXXX",
    "bom_name": "BOM C4",
    "bom_status": "ACCEPTED",
    "bom_updated_on": null,
    "bom_updated_by": null
  }
]''',
            "bom_product_impressions_wide": '''[
  {
    "row": 1,
    "use": "MAIN LABEL",
    "connected_material_asset": "IMP-XXXXX",
    "additional_material_details": "description",
    "heather_gray": "value or null",
    "navy": "value or null"
  }
]''',
            "measurements_plus_wide": '''[
  {
    "section": "BODY",
    "point_of_measure_name": "full name",
    "pom_name": "CHEST WIDTH",
    "pom_id": "POM-XXXXX",
    "pom_code": "A16S.R",
    "special_instructions": null,
    "uom": "IN",
    "tolerance_plus": "0.5",
    "tolerance_minus": "0.5",
    "xx_large": "value",
    "1x": "value",
    "2x": "value",
    "3x": "value",
    "4x": "value"
  }
]''',
            "measurements_regular_wide": '''[
  {
    "section": "BODY",
    "point_of_measure_name": "full name",
    "pom_name": "CHEST WIDTH",
    "pom_id": "POM-XXXXX",
    "pom_code": "A16S.R",
    "special_instructions": null,
    "uom": "IN",
    "tolerance_plus": "0.5",
    "tolerance_minus": "0.5",
    "xx_small": "value",
    "x_small": "value",
    "small": "value",
    "medium": "value",
    "large": "value",
    "x_large": "value"
  }
]''',
            "product_details_construction": '''[
  {
    "section": "CONSTRUCTION",
    "category": "STITCHING",
    "subcategory": "SEAM TYPE",
    "detail": "detail text",
    "special_instructions": null,
    "product_details_id": "PDTL-XXXXX",
    "status": "IN PROGRESS",
    "updated_on": null,
    "updated_by": null
  }
]''',
        }

        result: Dict[str, Any] = {"template_type": "product_factura"}

        def extract_one(name: str) -> tuple[str, Any]:
            try:
                data = self._extract_section(name, sections[name], masked_text)
                # If the response is wrapped (e.g. {"items": [...]}), unwrap it
                if isinstance(data, dict):
                    if name in data:
                        return (name, data[name])
                    if "items" in data and isinstance(data["items"], list):
                        return (name, data["items"])
                return (name, data)
            except Exception as ex:
                return (name, {"error": str(ex)})

        # Run extractions in parallel (ThreadPoolExecutor)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(extract_one, name): name for name in sections}
            for future in concurrent.futures.as_completed(futures):
                name, data = future.result()
                result[name] = data

        return result

    def analyze_design_image(self, image_bytes: bytes, file_name: str) -> Dict[str, Any]:
        ext = os.path.splitext(file_name)[1].lower()
        media_type = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }.get(ext, "image/png")

        base64_data = base64.b64encode(image_bytes).decode("utf-8")

        prompt = (
            "You are a JSON analysis service. Return ONLY valid JSON. "
            "Analyze the image and return a structured design analysis. "
            "If unsure, use nulls."
        )

        response_text = self._call_messages_api(
            max_tokens=900,
            content=[
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": base64_data}},
                {"type": "text", "text": prompt},
            ],
        )

        return _extract_json(response_text)


ai_service = AiService()
