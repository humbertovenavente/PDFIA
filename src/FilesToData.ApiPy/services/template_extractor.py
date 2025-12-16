"""
Template-based data extraction service.
Extracts data from documents based on detected template type.
"""
import json
import re
from typing import Any, Dict, List, Optional

from .template_definitions import (
    TEMPLATE_DEFINITIONS,
    detect_template_type,
    get_template_definition,
    get_all_field_patterns
)


def build_extraction_prompt(template_type: str, masked_text: str) -> str:
    """
    Build a comprehensive extraction prompt based on the detected template type.
    """
    template_def = get_template_definition(template_type)
    template_name = template_def.get("name", "Document")
    sections = template_def.get("sections", {})
    
    # Build JSON schema from template definition
    schema = {"template_type": template_type}
    
    for section_key, section_def in sections.items():
        if section_def.get("is_table"):
            # Table section
            columns = section_def.get("columns", {})
            if columns:
                row_schema = {}
                for col_key, col_patterns in columns.items():
                    if col_key == "sizes" and isinstance(col_patterns, dict):
                        row_schema["sizes"] = {size_key: "value" for size_key in col_patterns.keys()}
                    else:
                        row_schema[col_key] = "value"
                schema[section_key] = [row_schema]
            else:
                schema[section_key] = [{"column1": "value", "column2": "value"}]
        elif section_def.get("is_list"):
            schema[section_key] = ["item1", "item2", "..."]
        elif section_def.get("is_text"):
            schema[section_key] = "text content"
        elif "fields" in section_def:
            schema[section_key] = {
                field_key: "value" for field_key in section_def["fields"].keys()
            }
    
    # Build field hints from patterns
    field_hints = []
    for section_key, section_def in sections.items():
        section_title = section_def.get("title", section_key)
        if "fields" in section_def:
            for field_key, patterns in section_def["fields"].items():
                if isinstance(patterns, list):
                    field_hints.append(f"- {section_key}.{field_key}: Look for labels like {', '.join(patterns[:3])}")
    
    prompt = f'''You are a JSON extraction service specialized in extracting data from "{template_name}" documents.

TASK: Extract ALL data from the document into a structured JSON format.

TEMPLATE TYPE DETECTED: {template_type}

JSON SCHEMA TO FOLLOW:
```json
{json.dumps(schema, indent=2, ensure_ascii=False)}
```

FIELD HINTS (labels to look for):
{chr(10).join(field_hints[:30])}

CRITICAL RULES:
1. Extract EVERY piece of data - do not skip any information
2. For tables, extract ALL rows including subtotals and grand totals
3. For size columns, map to the correct size key (xxs, xs, s, m, l, xl, xxl, xxxl, 1x, 2x, 3x, 4x)
4. Use null for truly missing values, but try to find the data first
5. Preserve original text exactly as written (including Korean, Spanish, etc.)
6. For quantity/measurement tables, extract every single row
7. Look for data in merged cells and multi-line cells
8. Extract notes, comments, and special instructions
9. Output ONLY valid JSON, no explanations

DOCUMENT TEXT:
{masked_text}

OUTPUT ONLY THE JSON:'''

    return prompt


def build_comprehensive_extraction_prompt(masked_text: str) -> str:
    """
    Build a comprehensive prompt that extracts all possible data regardless of template type.
    This is used when we want to capture everything.
    """
    all_patterns = get_all_field_patterns()
    
    # Create a comprehensive schema
    schema = {
        "template_type": "auto_detected",
        "document_title": "string",
        "header": {
            "contact": None,
            "date": None,
            "revised_date": None,
            "requested_by": None,
            "work_plant": None,
            "author": None
        },
        "order_info": {
            "file": None,
            "buyer": None,
            "style": None,
            "product": None,
            "season": None,
            "qty": None,
            "ship_date": None,
            "delivery": None,
            "po": None,
            "cm_cost": None
        },
        "fabric_info": {
            "yarn": None,
            "fabric": None,
            "fabric2": None,
            "width": None,
            "width2": None,
            "weight": None,
            "rib": None,
            "yield_total": None,
            "body_width": None
        },
        "order_procedure": "text describing the production process",
        "quantity_lines": [
            {
                "style": None,
                "po": None,
                "xfty": None,
                "color_name": None,
                "color_code": None,
                "sizes": {
                    "xxs": None, "xs": None, "s": None, "m": None,
                    "l": None, "xl": None, "xxl": None, "xxxl": None,
                    "1x": None, "2x": None, "3x": None, "4x": None
                },
                "delivery_date": None,
                "total": None,
                "type": "normal|subtotal|grandtotal"
            }
        ],
        "cutting_detail_notes": ["note1", "note2"],
        "sewing_detail_notes": ["note1", "note2"],
        "measurement_rows": [
            {
                "name": "measurement point name",
                "tolerance": "+/- value",
                "xxs": None, "xs": None, "s": None, "m": None,
                "l": None, "xl": None, "xxl": None, "xxxl": None
            }
        ],
        "labels_info": {
            "folding_size": None,
            "hangtag": None,
            "pieces_per_box": None,
            "additional_notes": []
        },
        "trim_packing_notes": ["note1", "note2"],
        "yield_info": {
            "body": None,
            "rib": None,
            "unit": "YD/DZ or similar"
        },
        "important_notes": ["any important notes or instructions"],
        "additional_tables": [
            {
                "table_name": "name if identifiable",
                "headers": ["col1", "col2"],
                "rows": [["val1", "val2"]]
            }
        ]
    }
    
    prompt = f'''You are a comprehensive JSON extraction service for garment manufacturing documents.

TASK: Extract ABSOLUTELY ALL data from this document. Do not miss any information.

COMPREHENSIVE JSON SCHEMA:
```json
{json.dumps(schema, indent=2, ensure_ascii=False)}
```

COMMON LABELS TO LOOK FOR (in English, Spanish, Korean):
- Order Info: FILE, BUYER, STYLE, PO, QTY, DELIVERY, SEASON, COST
- Fabric Info: FABRIC/TELA/원단, YARN/HILAZA/사종, WIDTH/ANCHO/폭, WEIGHT/PESO/중량, RIB/부속
- Sizes: XXS, XS, S, M, L, XL, XXL, XXXL, 1X, 2X, 3X, 4X, or numeric like 2/3, 4/5, 6/7, etc.
- Sections: CORTE/CUTTING, COSTURA/SEWING, MEDIDAS/MEASUREMENTS, ETIQUETAS/LABELS

CRITICAL EXTRACTION RULES:
1. Extract EVERY table completely - all rows, all columns
2. Extract EVERY note, instruction, and comment
3. For quantity tables: capture style, PO, color, ALL size quantities, totals
4. For measurement tables: capture measurement name, tolerance, ALL size values
5. Preserve exact text including Korean (한글), Spanish, and special characters
6. If a table has subtotals or grand totals, mark them with type: "subtotal" or "grandtotal"
7. Extract process/procedure text (e.g., "CORTE - COSTURA - EMPAQUE")
8. Capture any images descriptions or references
9. Extract yield/consumption data if present
10. Include any additional tables not covered by the main schema in "additional_tables"

OUTPUT ONLY VALID JSON - NO EXPLANATIONS:

DOCUMENT TEXT:
{masked_text}'''

    return prompt


def normalize_size_key(size_label: str) -> Optional[str]:
    """Normalize size labels to standard keys."""
    size_label = str(size_label).upper().strip()
    
    mappings = {
        "XXS": "xxs", "2/3": "xxs", "(2/3)": "xxs",
        "XS": "xs", "4/5": "xs", "(4/5)": "xs",
        "S": "s", "6/7": "s", "(6/7)": "s", "SMALL": "s",
        "M": "m", "8/9": "m", "(8/9)": "m", "MEDIUM": "m",
        "L": "l", "10/11": "l", "(10/11)": "l", "LARGE": "l",
        "XL": "xl", "12/13": "xl", "(12/13)": "xl", "X-LARGE": "xl",
        "XXL": "xxl", "14/15": "xxl", "(14/15)": "xxl", "XX-LARGE": "xxl",
        "XXXL": "xxxl", "16": "xxxl", "(16)": "xxxl",
        "1X": "1x", "2X": "2x", "3X": "3x", "4X": "4x"
    }
    
    for pattern, key in mappings.items():
        if pattern in size_label:
            return key
    
    return None


def post_process_extraction(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Post-process extracted data to normalize and clean it.
    """
    # Ensure required fields exist
    if "template_type" not in data:
        data["template_type"] = "sewing_worksheet"
    
    # Normalize quantity_lines sizes
    if "quantity_lines" in data and isinstance(data["quantity_lines"], list):
        for line in data["quantity_lines"]:
            if isinstance(line, dict) and "sizes" in line:
                sizes = line["sizes"]
                if isinstance(sizes, dict):
                    normalized = {}
                    for key, value in sizes.items():
                        norm_key = normalize_size_key(key)
                        if norm_key:
                            normalized[norm_key] = value
                        else:
                            normalized[key.lower().replace(" ", "_").replace("/", "_")] = value
                    line["sizes"] = normalized
    
    # Normalize measurement_rows sizes
    if "measurement_rows" in data and isinstance(data["measurement_rows"], list):
        for row in data["measurement_rows"]:
            if isinstance(row, dict):
                normalized = {"name": row.get("name"), "tolerance": row.get("tolerance")}
                for key, value in row.items():
                    if key not in ["name", "tolerance"]:
                        norm_key = normalize_size_key(key)
                        if norm_key:
                            normalized[norm_key] = value
                        else:
                            normalized[key] = value
                row.clear()
                row.update(normalized)
    
    # Ensure lists are lists
    list_fields = ["cutting_detail_notes", "sewing_detail_notes", "trim_packing_notes", "important_notes"]
    for field in list_fields:
        if field in data and not isinstance(data[field], list):
            if data[field]:
                data[field] = [data[field]]
            else:
                data[field] = []
    
    return data


def wrap_in_pages_structure(data: Dict[str, Any], page_number: int = 1) -> Dict[str, Any]:
    """
    Wrap extracted data in the pages structure expected by the frontend.
    """
    template_type = data.get("template_type", "sewing_worksheet")

    # Normalize: if extractor returned tables in "items", also expose them as "additional_tables"
    if "items" in data and not data.get("additional_tables"):
        if isinstance(data.get("items"), list):
            data["additional_tables"] = data.get("items")

    # Only wrap into sewing_worksheet for sewing worksheet templates
    is_sewing = any(x in (template_type or "").lower() for x in ("sewing", "worksheet", "orden"))

    if is_sewing:
        sewing_worksheet = {
            "header": data.get("header", {}),
            "order_info": data.get("order_info", {}),
            "fabric_info": data.get("fabric_info", {}),
            "order_procedure": data.get("order_procedure", ""),
            "quantity_lines": data.get("quantity_lines", []),
            "cutting_detail_notes": data.get("cutting_detail_notes", []),
            "sewing_detail_notes": data.get("sewing_detail_notes", []),
            "measurement_rows": data.get("measurement_rows", []),
            "labels_info": data.get("labels_info", {}),
            "trim_packing_notes": data.get("trim_packing_notes", []),
            "yield_info": data.get("yield_info", {}),
            "important_notes": data.get("important_notes", []),
            "additional_tables": data.get("additional_tables", []),
        }

        page_data: Dict[str, Any] = {
            "template_type": "sewing_worksheet",
            "sewing_worksheet": sewing_worksheet,
        }

        return {
            "pages": [
                {
                    "page_number": page_number,
                    "data": page_data,
                    "raw_text": data.get("raw_text", ""),
                }
            ]
        }

    # Non-sewing templates: return data as-is (preserve template_type)
    return {
        "pages": [
            {
                "page_number": page_number,
                "data": data,
                "raw_text": data.get("raw_text", ""),
            }
        ]
    }
