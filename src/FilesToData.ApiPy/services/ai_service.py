import base64
import json
import os
import re
import time
from typing import Any, Dict, Optional

import requests

from .template_definitions import detect_template_type, get_template_definition
from .template_extractor import (
    build_comprehensive_extraction_prompt,
    build_extraction_prompt,
    post_process_extraction,
    wrap_in_pages_structure
)


def _null_if_empty(s: Optional[str]) -> Optional[str]:
    if s is None:
        return None
    s = s.strip()
    return s or None


def _extract_json(text: str) -> Any:
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
            return parsed
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

        last_error: Optional[str] = None
        for attempt in range(6):
            resp = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=self._timeout,
            )

            if resp.status_code // 100 == 2:
                data = resp.json()
                for item in data.get("content", []):
                    if item.get("type") == "text":
                        return item.get("text") or ""
                return json.dumps(data)

            last_error = f"Claude API error: {resp.status_code} - {resp.text}"
            if resp.status_code != 429:
                break

            retry_after = resp.headers.get("retry-after") or resp.headers.get("Retry-After")
            try:
                wait_seconds = float(retry_after) if retry_after else 0.0
            except Exception:
                wait_seconds = 0.0

            if wait_seconds <= 0:
                wait_seconds = min(30.0, 1.5 * (2 ** attempt))

            time.sleep(wait_seconds)

        raise RuntimeError(last_error or "Claude API error")

    def _parse_or_repair_json(self, response_text: str, schema_hint: str) -> Dict[str, Any]:
        try:
            parsed = _extract_json(response_text)
            if isinstance(parsed, dict):
                return parsed
            return {"items": parsed}
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
            parsed = _extract_json(repaired)
            if isinstance(parsed, dict):
                return parsed
            return {"items": parsed}

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

    def extract_document_data(self, masked_text: str, forced_template_type: Optional[str] = None) -> Dict[str, Any]:
        """
        Extract document data using PARALLEL extraction by sections.
        This is faster and respects the 4096 token limit per request.
        """
        import concurrent.futures
        
        # Detect template type from the text (unless forced)
        template_type = (forced_template_type or "").strip() or None
        if not template_type:
            template_type = detect_template_type(masked_text)
        
        has_toc_hint = ("table of contents" in (masked_text or "").lower()) or ("tables of contents" in (masked_text or "").lower())

        # Define sections to extract in parallel - each with its own schema
        sections = {
            "header_and_order": {
                "schema": '''{
  "header": {
    "contact": "담당자/contact name",
    "document_date": "date",
    "revised_date": "revision date if any",
    "requested_by": "solicitado por",
    "work_plant": "planta de trabajo",
    "author": "작성자"
  },
  "order_info": {
    "file": "FILE # or FILE NO",
    "buyer": "BUYER/CLIENTE/바이어",
    "style": "STYLE # or STYLE NO",
    "product": "PRODUCT/PRODUCTO/제품",
    "season": "SEASON/TEMPORADA",
    "qty": "QTY/CANTIDAD/수량",
    "ship_date": "SHIPDATE/ENTREGA/납기/DELIVERY",
    "po": "PO # or PO NO",
    "cm_cost": "CM/COSTO/공임"
  }
}''',
                "instruction": "Extract header information (contact, date, work plant) and order information (file, buyer, style, product, season, qty, delivery, PO, cost)."
            },
            "fabric_and_yield": {
                "schema": '''{
  "fabric_info": {
    "yarn": "YARN/HILAZA/사종",
    "fabric": "FABRIC/TELA/원단/BODY",
    "width": "WIDTH/ANCHO/폭",
    "weight": "WEIGHT/PESO/중량",
    "fabric2": "FABRIC2/TELA2/원단2",
    "width2": "WIDTH2",
    "rib": "RIB/부속",
    "yield_total": "YIELD/CONSUMO/요척"
  },
  "yield_info": {
    "body": "BODY yield value",
    "rib": "RIB yield value",
    "unit": "YD/DZ or similar"
  },
  "order_procedure": "production process text like CORTE - COSTURA - EMPAQUE"
}''',
                "instruction": "Extract fabric information (yarn, fabric, width, weight, rib) and yield/consumption data. Also extract the order procedure/production process text."
            },
            "quantity_lines": {
                "schema": '''[
  {
    "style": "style number",
    "po": "PO number",
    "xfty": "XFTY value",
    "color_name": "color name",
    "color_code": "color code/EDI colorway",
    "sizes": {
      "xxs": "XXS or 2/3 value",
      "xs": "XS or 4/5 value",
      "s": "S or 6/7 value",
      "m": "M or 8/9 value",
      "l": "L or 10/11 value",
      "xl": "XL or 12/13 value",
      "xxl": "XXL or 14/15 value",
      "xxxl": "XXXL or 16 value",
      "1x": "1X value",
      "2x": "2X value",
      "3x": "3X value",
      "4x": "4X value"
    },
    "delivery_date": "delivery date if present",
    "total": "total quantity",
    "type": "normal or subtotal or grandtotal"
  }
]''',
                "instruction": "Extract ALL quantity/order lines from the table. Include every row with style, PO, color, ALL size quantities, and totals. Mark subtotal and grandtotal rows with type field."
            },
            "measurements": {
                "schema": '''[
  {
    "name": "measurement point name/PUNTOS DE MEDIDA",
    "tolerance": "tolerance value (+/-)",
    "xxs": "XXS or 2/3 value",
    "xs": "XS or 4/5 value",
    "s": "S or 6/7 value",
    "m": "M or 8/9 value",
    "l": "L or 10/11 value",
    "xl": "XL or 12/13 value",
    "xxl": "XXL or 14/15 value",
    "xxxl": "XXXL or 16 value"
  }
]''',
                "instruction": "Extract ALL measurement rows from the measurement specification table. Include measurement point name, tolerance, and ALL size values."
            },
            "notes_and_details": {
                "schema": '''{
  "cutting_detail_notes": ["list of cutting/corte notes"],
  "sewing_detail_notes": ["list of sewing/costura notes"],
  "trim_packing_notes": ["list of trim/packing/acabado notes"],
  "important_notes": ["list of important notes/instructions"],
  "labels_info": {
    "folding_size": "folding size",
    "hangtag": "hangtag info",
    "pieces_per_box": "pieces per box"
  }
}''',
                "instruction": "Extract ALL notes: cutting details, sewing details, trim/packing notes, important information, and labels/etiquetas info."
            },
            "product_overview": {
                "schema": '''{
  "product_overview": {
    "product_name": "product name/style name",
    "product_id": "PID or product ID",
    "status": "status like PRODUCTION",
    "brand": "brand name",
    "department": "department",
    "division": "division",
    "primary_material": "primary material code",
    "vendor_style_number": "vendor style #",
    "workspace_id": "workspace ID",
    "design_cycle": "design cycle like C4 2025"
  }
}''',
                "instruction": "Extract product overview information if present (product name, ID, brand, department, materials, etc.). This is for Tech Pack/Product Spec documents."
            },
            "bom_materials": {
                "schema": '''[
  {
    "section": "BODY or section name",
    "use": "SELF or use type",
    "material_type": "FABRIC or type",
    "material_id": "material asset ID",
    "material_details": "description",
    "supplier": "supplier name",
    "bom_code": "BOM code",
    "bom_status": "status"
  }
]''',
                "instruction": "Extract Bill of Materials (BOM) - product materials table if present. Include all rows with section, use, material type, ID, details, supplier."
            },
            "additional_tables": {
                "schema": '''[
  {
    "table_name": "name of the table",
    "headers": ["column1", "column2", "column3"],
    "rows": [["value1", "value2", "value3"]]
  }
]''',
                "instruction": "Extract ANY OTHER tables not covered by the main sections. Include table name, headers, and all data rows. This captures miscellaneous data tables."
            }
        }

        if template_type in ("product_spec", "target_brands_inc") or has_toc_hint:
            sections["table_of_contents"] = {
                "schema": '''[
  {
    "section": "section name (e.g. OVERVIEW, BILL OF MATERIALS, MEASUREMENTS)",
    "page": "page number as integer",
    "title": "title text for that section",
    "raw": "original line text (optional)"
  }
]''',
                "instruction": "Extract the Table(s) of Contents. Parse each row into {section, page, title}. If the row doesn't split cleanly, put the full row into raw and best-effort section/page/title."
            }
        
        def _split_pages(text: str) -> list[str]:
            parts = re.split(r"---\s*PAGE\s*\d+\s*---", text or "")
            return [p.strip() for p in parts if p and p.strip()]

        def _pick_text_for_section(section_name: str) -> str:
            pages = _split_pages(masked_text)
            if not pages:
                return masked_text

            if section_name == "table_of_contents":
                if len(pages) >= 2:
                    return pages[1][:20000]
                return masked_text[:20000]

            keywords_by_section: dict[str, list[str]] = {
                "header_and_order": ["product number", "spec name", "product name", "buyer", "style", "season", "date"],
                "fabric_and_yield": ["fabric", "fabrication", "yarn", "width", "weight", "rib", "yield", "consumo", "ancho", "peso"],
                "quantity_lines": ["qty", "quantity", "po", "color", "total", "size"],
                "measurements": ["measurement", "tolerance", "pom", "xxs", "xs", "xl", "size"],
                "notes_and_details": ["note", "notes", "sewing", "cutting", "important", "instruction"],
                "product_overview": ["product summary", "product number", "spec name", "product name", "status", "brand", "department"],
                "bom_materials": ["bill of materials", "material", "supplier", "fabrication", "bom"],
                "additional_tables": ["section:", "table", "material", "supplier", "placement", "quantity"],
                "table_of_contents": ["table of contents", "tables of contents", "section", "page", "title", "overview"],
            }

            keywords = [k.lower() for k in keywords_by_section.get(section_name, [])]
            selected: list[str] = []
            for p in pages:
                pl = p.lower()
                if any(k in pl for k in keywords):
                    selected.append(p)

            if not selected:
                selected = pages[:2]
            else:
                selected = selected[:4]

            out = "\n\n".join(selected)
            return out[:20000]

        def _heuristic_parse_table_of_contents(text: str) -> list[dict[str, Any]]:
            lines = (text or "").splitlines()
            start_idx: Optional[int] = None
            for i, ln in enumerate(lines):
                low = (ln or "").strip().lower()
                if "table of contents" in low or "tables of contents" in low:
                    start_idx = i
                    break
            if start_idx is None:
                for i, ln in enumerate(lines):
                    low = (ln or "").strip().lower()
                    if low.startswith("section") and "page" in low and "title" in low:
                        start_idx = i
                        break
            if start_idx is None:
                return []

            window = lines[start_idx : start_idx + 80]
            out: list[dict[str, Any]] = []
            # Drop obvious header lines; keep order to parse pairs.
            cleaned: list[str] = []
            for ln in window:
                raw = (ln or "").strip()
                if not raw:
                    continue
                low = raw.lower()
                if ("section" in low and "title" in low) or ("table of contents" in low) or ("tables of contents" in low):
                    continue
                if low.startswith("generated on"):
                    break
                if re.match(r"^page\s+\d+\s+of\s+\d+", low):
                    break
                cleaned.append(raw)

            i = 0
            while i < len(cleaned):
                raw = cleaned[i]
                low = raw.lower()

                # Pattern: SECTION 2 title (same line)
                m = re.match(r"^\s*([A-Z][A-Z0-9\s/&\-\.]{2,}?)\s+(\d{1,3})\s+(.+?)\s*$", raw)
                if m:
                    section = (m.group(1) or "").strip() or None
                    page_str = (m.group(2) or "").strip()
                    title = (m.group(3) or "").strip() or None
                    try:
                        page = int(page_str)
                    except Exception:
                        page = None
                    out.append({"section": section, "page": page, "title": title, "raw": raw})
                    i += 1
                    continue

                # Pattern: SECTION title (same line, no page)
                m3 = re.match(r"^\s*([A-Z][A-Z0-9\s/&\-\.]{2,}?)\s+(.+?)\s*$", raw)
                if m3 and m3.group(1) and m3.group(2) and len(m3.group(1).strip()) >= 3:
                    # Only accept if the first chunk looks like an all-caps section.
                    if m3.group(1).strip().upper() == m3.group(1).strip():
                        section = (m3.group(1) or "").strip() or None
                        title = (m3.group(2) or "").strip() or None
                        out.append({"section": section, "page": None, "title": title, "raw": raw})
                        i += 1
                        continue

                # Pair-line format: SECTION on its own line, then "2 measurements" on next.
                section = raw.strip() or None
                j = i + 1
                while j < len(cleaned) and not (cleaned[j] or "").strip():
                    j += 1
                if j >= len(cleaned):
                    break
                nxt = (cleaned[j] or "").strip()
                m4 = re.match(r"^(\d{1,3})\s+(.+?)\s*$", nxt)
                if m4:
                    try:
                        page = int(m4.group(1))
                    except Exception:
                        page = None
                    title = (m4.group(2) or "").strip() or None
                    out.append({"section": section, "page": page, "title": title, "raw": f"{raw} | {nxt}"})
                    i = j + 1
                    continue

                # Pair-line format but no page extracted.
                out.append({"section": section, "page": None, "title": nxt or None, "raw": f"{raw} | {nxt}"})
                i = j + 1

            return out

        result: Dict[str, Any] = {"template_type": template_type}
        
        def extract_section(name: str, config: dict) -> tuple:
            """Extract a single section from the document."""
            try:
                section_text = _pick_text_for_section(name)
                prompt = f'''You are a JSON extraction service for garment manufacturing documents.

TASK: Extract ONLY the "{name}" section data.

RETURN THIS JSON STRUCTURE:
{config["schema"]}

INSTRUCTION: {config["instruction"]}

RULES:
- Extract ALL data for this section - do not skip any rows or values
- Use null for truly missing values
- Preserve original text (Korean, Spanish, etc.)
- Output ONLY valid JSON, no explanations

DOCUMENT TEXT:
{section_text}'''
                
                response_text = self._call_messages_api(
                    max_tokens=4096,
                    content=[{"type": "text", "text": prompt}],
                )
                schema_hint = config.get("schema") or ""
                try:
                    data = _extract_json(response_text)
                except Exception:
                    data = self._parse_or_repair_json(response_text, schema_hint)

                if isinstance(data, dict) and isinstance(data.get("items"), list) and schema_hint.strip().startswith("["):
                    data = data.get("items")
                return (name, data, None)
            except Exception as ex:
                return (name, None, str(ex))
        
        max_workers_env = _null_if_empty(os.getenv("CLAUDE_MAX_WORKERS"))
        try:
            max_workers = int(max_workers_env) if max_workers_env else 2
        except Exception:
            max_workers = 2

        max_workers = max(1, min(max_workers, len(sections)))

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(extract_section, name, config): name 
                for name, config in sections.items()
            }
            for future in concurrent.futures.as_completed(futures):
                name, data, error = future.result()
                if error:
                    result[f"_{name}_error"] = error
                elif data is not None:
                    # Merge the extracted data into result
                    if isinstance(data, dict):
                        for key, value in data.items():
                            if value is not None:
                                result[key] = value
                    elif isinstance(data, list):
                        # For list results - map section name to result key
                        list_mappings = {
                            "quantity_lines": "quantity_lines",
                            "measurements": "measurement_rows",
                            "bom_materials": "bom_product_materials",
                            "additional_tables": "additional_tables",
                            "table_of_contents": "table_of_contents"
                        }
                        result_key = list_mappings.get(name, name)
                        result[result_key] = data

        if template_type in ("product_spec", "target_brands_inc") or has_toc_hint:
            toc_val = result.get("table_of_contents")
            if not isinstance(toc_val, list):
                toc_val = []

            parsed = _heuristic_parse_table_of_contents(masked_text)
            if parsed:
                def _max_page(rows: list[dict[str, Any]]) -> int:
                    m = 0
                    for r in rows:
                        p = r.get("page")
                        if isinstance(p, int) and p > m:
                            m = p
                    return m

                def _non_null_pages(rows: list[dict[str, Any]]) -> int:
                    c = 0
                    for r in rows:
                        if r.get("page") is not None:
                            c += 1
                    return c

                # Prefer heuristic when it yields small page numbers typical of a TOC block
                # like "1 bill of materials", "2 measurements", etc.
                parsed_max = _max_page(parsed)
                toc_max = _max_page(toc_val) if isinstance(toc_val, list) else 0
                parsed_pages = _non_null_pages(parsed)
                toc_pages = _non_null_pages(toc_val) if isinstance(toc_val, list) else 0

                if len(toc_val) == 0:
                    result["table_of_contents"] = parsed
                elif parsed_max and parsed_max <= 10 and (parsed_pages >= toc_pages or toc_max > parsed_max):
                    result["table_of_contents"] = parsed
            else:
                if len(toc_val) == 0:
                    result["table_of_contents"] = []

        # Post-process to normalize the data
        result = post_process_extraction(result)
        
        # Store raw text for reference (truncated)
        result["raw_text"] = masked_text[:3000] if len(masked_text) > 3000 else masked_text
        
        # Wrap in pages structure for frontend compatibility
        wrapped = wrap_in_pages_structure(result)
        
        return wrapped
    
    def extract_document_data_legacy(self, masked_text: str) -> Dict[str, Any]:
        """Legacy extraction method for product_factura type documents."""
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
            "You are a JSON analysis service. Return ONLY valid JSON and nothing else.\n"
            "Language: English.\n"
            "Task: Analyze the garment design image and return a high-quality, detailed, actionable design review.\n\n"
            "Return JSON matching EXACTLY this schema (keys must match):\n"
            "{\n"
            "  \"garment_type\": \"string or null\",\n"
            "  \"style\": \"string or null\",\n"
            "  \"current_color\": \"string or null\",\n"
            "  \"apparent_material\": \"string or null\",\n"
            "  \"image_quality\": \"string or null\",\n"
            "  \"analysis_confidence\": \"string or null\",\n"
            "  \"overall_summary\": \"string or null\",\n"
            "  \"notes\": \"string or null\",\n"
            "  \"suggested_changes\": [\n"
            "    {\n"
            "      \"change\": \"string\",\n"
            "      \"impact\": \"High|Medium|Low|null\",\n"
            "      \"priority\": \"P0|P1|P2|P3|null\"\n"
            "    }\n"
            "  ],\n"
            "  \"detected_text\": [\n"
            "    {\n"
            "      \"text\": \"string\",\n"
            "      \"location\": \"string or null\"\n"
            "    }\n"
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "- Be specific and practical.\n"
            "- Use null when unknown.\n"
            "- suggested_changes and detected_text must be arrays (use [] if none).\n"
            "- Output ONLY JSON (no markdown, no commentary)."
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
