"""
Template definitions for different document types.
Each template defines:
- Detection patterns (to identify the template type)
- Sections with their headers and fields
- Export configuration
"""

TEMPLATE_DEFINITIONS = {
    # =========================================================================
    # SEWING WORKSHEET - J.CREW STYLE (Standard 8 sections)
    # =========================================================================
    "sewing_worksheet_jcrew": {
        "name": "Sewing Worksheet (J.Crew Style)",
        "detection_patterns": [
            "ORDEN DE TRABAJO DE COSTURA",
            "SEWING WORKSHEET",
            "봉제 작업지시서"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "contact": ["CONTACTO", "CONTACT", "담당자"],
                    "document_date": ["FECHA", "DATE"],
                    "revised_date": ["REVISED", "REV"],
                    "requested_by": ["SOLICITADO POR", "REQUESTED BY"],
                    "work_plant": ["PLANTA DE TRABAJO", "WORK PLANT"],
                    "work_plant_address": ["ADDRESS", "DIRECCION"]
                }
            },
            "order_info": {
                "title": "1. INFO. DEL ORDEN/ ORDER INFO./오더 정보",
                "fields": {
                    "file": ["#FILE", "FILE NO", "FILE #"],
                    "buyer": ["CLIENTE", "BUYER", "바이어"],
                    "style": ["STYLE #", "# ESTILO", "STYLE NO"],
                    "product": ["PRODUCTO", "PRODUCT", "제품"],
                    "season": ["TEMPORADA", "SEASON"],
                    "qty": ["CANTIDAD", "QTY", "수량"],
                    "ship_date": ["ENTREGA", "SHIPDATE", "납기", "DELIVERY"],
                    "cm_cost": ["COSTO", "CM", "공임"],
                    "po": ["PO #", "PO NO"]
                }
            },
            "fabric_info": {
                "title": "2. INFO. DE TELA/ FABRIC INFO/ 원자재 정보",
                "fields": {
                    "yarn": ["HILAZA", "YARN", "사종"],
                    "fabric": ["TELA 1", "FABRIC", "원단", "BODY"],
                    "width": ["ANCHO", "WIDTH", "폭"],
                    "weight": ["PESO", "WEIGHT", "중량"],
                    "fabric2": ["TELA 2", "FABRIC2", "원단2"],
                    "width2": ["ANCHO 2", "WIDTH 2"],
                    "rib": ["RIB", "부속"],
                    "yield_total": ["CONSUMO", "YIELD", "요척"]
                }
            },
            "order_procedure": {
                "title": "3. PROCESO DEL ORDEN/ ORDER PROCEDURE/오더 공정 순서",
                "is_text": True,
                "patterns": ["CORTE", "COSTURA", "EMPAQUE", "WASH", "PLANCHA", "SERIGRAFIA"]
            },
            "quantity_lines": {
                "title": "4. CANTIDAD POR ESTILO, COLOR & PO/ QTY PER STYLE, COLOR & PO/재단 정보",
                "is_table": True,
                "columns": {
                    "style": ["S#", "STYLE#", "STYLE NO"],
                    "po": ["PO#", "PO NO"],
                    "xfty": ["XFTY", "X-FTY"],
                    "color_name": ["COLOR", "COLOR NAME"],
                    "color_code": ["COLOR CODE", "EDI COLORWAY"],
                    "sizes": {
                        "xxs": ["XXS", "2/3"],
                        "xs": ["XS", "4/5"],
                        "s": ["S", "6/7"],
                        "m": ["M", "8/9"],
                        "l": ["L", "10/11"],
                        "xl": ["XL", "12/13"],
                        "xxl": ["XXL", "14/15"],
                        "xxxl": ["XXXL", "16"]
                    },
                    "total": ["TOTAL", "TTL"]
                }
            },
            "cutting_detail_notes": {
                "title": "5. DETALLES DE CORTE/ CUTTING DETAIL/재단 작업 디테일",
                "is_list": True
            },
            "sewing_detail_notes": {
                "title": "6. DETALLES DE OPERACION/ SEWING DETAIL/봉제 작업 디테일",
                "is_list": True
            },
            "measurement_rows": {
                "title": "7. ESPECIFICACION DE MEDIDAS/ MEASUREMENT SPECIFICATION/치수",
                "is_table": True,
                "columns": {
                    "name": ["PUNTOS DE MEDIDA", "MEASUREMENT POINTS", "POM"],
                    "tolerance": ["TOL", "TOLERANCE", "-/+"],
                    "sizes": {
                        "xxs": ["XXS", "2/3"],
                        "xs": ["XS", "4/5"],
                        "s": ["S", "6/7"],
                        "m": ["M", "8/9"],
                        "l": ["L", "10/11"],
                        "xl": ["XL", "12/13"],
                        "xxl": ["XXL", "14/15"],
                        "xxxl": ["XXXL", "16"]
                    }
                }
            },
            "labels_info": {
                "title": "8. DETALLES DE ETIQUETAS Y ACABADO/ TRIM & PACKING DETAILS/부자재 및 완성 디테일",
                "fields": {
                    "folding_size": ["FOLDING SIZE", "TAMANO DE FOLDING"],
                    "hangtag": ["HANGTAG"],
                    "pieces_per_box": ["PIECES PER BOX", "PCS/BOX"]
                }
            }
        }
    },
    
    # =========================================================================
    # KOREAN/SPANISH HYBRID STYLE
    # =========================================================================
    "sewing_worksheet_korean": {
        "name": "Sewing Worksheet (Korean Style)",
        "detection_patterns": [
            "봉제 작업 지시서/Orden de Trabajo",
            "정작지",
            "가작지"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "author": ["작성자"],
                    "date": ["DATE", "FECHA"],
                    "revision": ["REV", "REVISED"]
                }
            },
            "order_info": {
                "title": "오더 정보/ Informacion del orden/ Order Information",
                "fields": {
                    "file": ["FILE NO", "# FILE"],
                    "buyer": ["BUYER", "바이어"],
                    "style": ["STYLE NO", "STYLE #"],
                    "po": ["PO NO", "PO #"],
                    "weight": ["WEIGHT"],
                    "qty": ["Q'TY", "수량", "Cantidad", "Qty"],
                    "delivery": ["DELIVERY", "납기"]
                }
            },
            "fabric_info": {
                "title": "원자재정보/ Informacion de Tela/ Fabric Information",
                "fields": {
                    "body1": ["BODY 1", "원단"],
                    "body2": ["BODY 2"],
                    "rib": ["RIB", "부속"],
                    "body_width": ["BODY 원단 폭", "원단 폭"],
                    "rib_width": ["Rib 원단 폭"],
                    "item": ["ITEM", "제품"]
                }
            },
            "trim_fabric": {
                "title": "부속/Tela sec/Trim Fabric",
                "is_list": True
            },
            "quantity_table": {
                "title": "스타일, 색상, PO 별 수량/ Cantidad por estilo, color & PO/ Q'ty per",
                "is_table": True,
                "columns": {
                    "po": ["PO #", "PO NO"],
                    "style": ["STYLE#", "STYLE NO"],
                    "colorway": ["EDI COLORWAY", "COLOR"],
                    "color_body": ["COLOR DEL CUERPO"],
                    "heat_transfer": ["HEAT TRANSFER"],
                    "sizes": {
                        "xs": ["XS"],
                        "s": ["S"],
                        "m": ["M"],
                        "l": ["L"],
                        "xl": ["XL"],
                        "xxl": ["XXL"]
                    },
                    "delivery_date": ["DELIVERY DATE"],
                    "total": ["TOTAL"]
                }
            },
            "yield_info": {
                "title": "요척",
                "fields": {
                    "body": ["BODY"],
                    "rib": ["RIB"]
                }
            },
            "production_process": {
                "title": "PROCESO DE PRODUCCION",
                "is_text": True
            },
            "measurements": {
                "title": "치수/ Especificacion de medidas/ Measurement Specification",
                "is_table": True
            },
            "trim_info": {
                "title": "TRIM INFORMATION",
                "is_list": True
            },
            "important_notes": {
                "title": "IMPORTANT INFORMATION",
                "is_list": True
            }
        }
    },
    
    # =========================================================================
    # TARGET STYLE
    # =========================================================================
    "sewing_worksheet_target": {
        "name": "Sewing Worksheet (Target Style)",
        "detection_patterns": [
            "ORDEN DE TRABAJO (봉제 작업지시서): TARGET",
            "TARGET MEN'S",
            "TARGET WOMEN'S"
        ],
        "sections": {
            "header": {
                "title": "ORDEN DE TRABAJO",
                "fields": {
                    "brand": ["TARGET MEN'S", "TARGET WOMEN'S"],
                    "file": ["FILE #", "F#"],
                    "style": ["STYLE #", "S#"],
                    "date": ["DATE", "FECHA"]
                }
            },
            "order_quantity": {
                "title": "CANTIDAD DE ORDEN",
                "is_table": True,
                "columns": {
                    "po": ["PO"],
                    "color": ["COLOR"],
                    "sizes": {
                        "xs": ["XS"],
                        "s": ["S"],
                        "m": ["M"],
                        "l": ["L"],
                        "xl": ["XL"],
                        "xxl": ["XXL"],
                        "1x": ["1X"],
                        "2x": ["2X"],
                        "3x": ["3X"],
                        "4x": ["4X"]
                    },
                    "total": ["TOTAL", "TTL"]
                }
            },
            "cutting": {
                "title": "CORTE / 재단",
                "is_list": True
            },
            "sewing": {
                "title": "COSTURA / 봉제",
                "is_list": True
            },
            "process": {
                "title": "PROCESO",
                "is_text": True
            }
        }
    },
    
    # =========================================================================
    # EXPRESS STYLE
    # =========================================================================
    "sewing_worksheet_express": {
        "name": "Sewing Worksheet (Express Style)",
        "detection_patterns": [
            "EXPRESS FILE",
            "봉제 정작업 지시서"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "file": ["FILE #", "FILE"],
                    "style": ["S#", "STYLE"],
                    "date": ["DATE"]
                }
            },
            "order_info": {
                "title": "Order Information",
                "fields": {
                    "buyer": ["BUYER"],
                    "qty": ["QTY", "QUANTITY"],
                    "delivery": ["DELIVERY"]
                }
            },
            "fabric_info": {
                "title": "Fabric Information",
                "fields": {
                    "fabric": ["FABRIC", "TELA"],
                    "weight": ["WEIGHT"],
                    "width": ["WIDTH"]
                }
            },
            "quantity_table": {
                "title": "Quantity Table",
                "is_table": True
            },
            "measurements": {
                "title": "Measurements",
                "is_table": True
            }
        }
    },
    
    # =========================================================================
    # A&F STYLE
    # =========================================================================
    "sewing_worksheet_af": {
        "name": "Sewing Worksheet (A&F Style)",
        "detection_patterns": [
            "A&F F#",
            "ABERCROMBIE"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "file": ["F#", "FILE"],
                    "style": ["S#", "STYLE"]
                }
            },
            "order_info": {
                "title": "Order Info",
                "is_table": True
            },
            "quantity_table": {
                "title": "Quantity",
                "is_table": True
            },
            "measurements": {
                "title": "Measurements",
                "is_table": True
            }
        }
    },
    
    # =========================================================================
    # URBAN OUTFITTERS STYLE
    # =========================================================================
    "sewing_worksheet_urban": {
        "name": "Sewing Worksheet (Urban Outfitters Style)",
        "detection_patterns": [
            "URBAN OUTFITTERS",
            "MODAS WIZ"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "file": ["F#", "FILE"],
                    "style": ["S#", "STYLE"]
                }
            },
            "important_info": {
                "title": "IMPORTANT INFORMATION",
                "is_list": True
            },
            "process": {
                "title": "PROCESO",
                "is_text": True,
                "patterns": ["CORTE", "COSTURA", "WASHING", "SILICONE", "PIGMENT"]
            }
        }
    },
    
    # =========================================================================
    # KONTOOR/WRANGLER STYLE
    # =========================================================================
    "sewing_worksheet_kontoor": {
        "name": "Sewing Worksheet (Kontoor Style)",
        "detection_patterns": [
            "KONTOOR",
            "WESTERN MAINLINE",
            "WRANGLER"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "file": ["F#", "FILE"],
                    "style": ["STYLE"]
                }
            },
            "order_info": {
                "title": "Order Info",
                "is_table": True
            },
            "quantity_table": {
                "title": "Quantity",
                "is_table": True
            }
        }
    },
    
    # =========================================================================
    # LUCKY BRAND STYLE
    # =========================================================================
    "sewing_worksheet_lucky": {
        "name": "Sewing Worksheet (Lucky Brand Style)",
        "detection_patterns": [
            "LUCKY BRAND",
            "ORDEN DE TRABAJO"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "file": ["F#", "FILE"],
                    "style": ["STYLE"],
                    "date": ["DATE"]
                }
            },
            "order_info": {
                "title": "Order Info",
                "is_table": True
            },
            "quantity_table": {
                "title": "Quantity",
                "is_table": True
            },
            "measurements": {
                "title": "Measurements",
                "is_table": True
            }
        }
    },
    
    # =========================================================================
    # VINEYARD VINES STYLE
    # =========================================================================
    "sewing_worksheet_vineyard": {
        "name": "Sewing Worksheet (Vineyard Vines Style)",
        "detection_patterns": [
            "VINEYARD VINES"
        ],
        "sections": {
            "header": {
                "title": "Header",
                "fields": {
                    "file": ["FILE"],
                    "style": ["STYLE"]
                }
            },
            "order_info": {
                "title": "오더 정보/ Informacion del orden/ Order Information",
                "is_table": True
            },
            "fabric_info": {
                "title": "원자재정보/ Informacion de Tela/ Fabric Information",
                "is_table": True
            },
            "trim_fabric": {
                "title": "부속/Tela sec/Trim Fabric",
                "is_table": True
            },
            "quantity_table": {
                "title": "스타일, 색상, PO 별 수량",
                "is_table": True
            },
            "measurements": {
                "title": "치수/ Especificacion de medidas",
                "is_table": True
            },
            "notes": {
                "title": "Notes",
                "is_list": True
            }
        }
    },
    
    # =========================================================================
    # PRODUCT SPEC / TECH PACK (PDF style)
    # =========================================================================
    "product_spec": {
        "name": "Product Specification / Tech Pack",
        "detection_patterns": [
            "PRODUCT SPEC",
            "TECH PACK",
            "ProductSpec",
            "PID-"
        ],
        "sections": {
            "product_overview": {
                "title": "Product Overview",
                "fields": {
                    "product_name": ["PRODUCT NAME", "STYLE NAME"],
                    "product_id": ["PRODUCT ID", "PID", "STYLE ID"],
                    "status": ["STATUS"],
                    "brand": ["BRAND"],
                    "department": ["DEPARTMENT"],
                    "division": ["DIVISION"],
                    "class": ["CLASS"],
                    "primary_material": ["PRIMARY MATERIAL"],
                    "secondary_material": ["SECONDARY MATERIAL"],
                    "vendor_style_number": ["VENDOR STYLE", "VENDOR #"],
                    "workspace_id": ["WORKSPACE ID"],
                    "design_cycle": ["DESIGN CYCLE"]
                }
            },
            "table_of_contents": {
                "title": "Table of Contents",
                "is_table": True
            },
            "bom_product_materials": {
                "title": "Bill of Materials - Product Materials",
                "is_table": True,
                "columns": {
                    "section": ["SECTION"],
                    "use": ["USE"],
                    "material_type": ["TYPE", "MATERIAL TYPE"],
                    "connected_material_asset": ["MATERIAL ASSET", "MATERIAL ID"],
                    "additional_material_details": ["DETAILS"],
                    "supplier": ["SUPPLIER"],
                    "bom_code": ["BOM CODE"],
                    "bom_status": ["STATUS"]
                }
            },
            "bom_product_impressions": {
                "title": "Bill of Materials - Product Impressions",
                "is_table": True
            },
            "measurements_regular": {
                "title": "Measurements - Regular Sizes",
                "is_table": True,
                "columns": {
                    "section": ["SECTION"],
                    "pom_name": ["POM NAME", "POINT OF MEASURE"],
                    "pom_id": ["POM ID"],
                    "uom": ["UOM", "UNIT"],
                    "tolerance_plus": ["TOL+", "TOLERANCE +"],
                    "tolerance_minus": ["TOL-", "TOLERANCE -"],
                    "sizes": {
                        "xxs": ["XXS"],
                        "xs": ["XS"],
                        "s": ["S"],
                        "m": ["M"],
                        "l": ["L"],
                        "xl": ["XL"]
                    }
                }
            },
            "measurements_plus": {
                "title": "Measurements - Plus Sizes",
                "is_table": True,
                "columns": {
                    "section": ["SECTION"],
                    "pom_name": ["POM NAME"],
                    "sizes": {
                        "xxl": ["XXL"],
                        "1x": ["1X"],
                        "2x": ["2X"],
                        "3x": ["3X"],
                        "4x": ["4X"]
                    }
                }
            },
            "product_details_construction": {
                "title": "Product Details - Construction",
                "is_table": True
            }
        }
    }
}


def detect_template_type(text: str) -> str:
    """
    Detect the template type based on text content.
    Returns the template key or 'unknown'.
    """
    text_upper = text.upper()
    
    # Check each template's detection patterns
    for template_key, template_def in TEMPLATE_DEFINITIONS.items():
        for pattern in template_def.get("detection_patterns", []):
            if pattern.upper() in text_upper:
                return template_key
    
    # Default fallback
    if any(x in text_upper for x in ["SEWING", "COSTURA", "봉제"]):
        return "sewing_worksheet_jcrew"
    
    return "unknown"


def get_template_definition(template_type: str) -> dict:
    """Get the template definition for a given type."""
    return TEMPLATE_DEFINITIONS.get(template_type, TEMPLATE_DEFINITIONS.get("sewing_worksheet_jcrew", {}))


def get_all_field_patterns() -> dict:
    """
    Get all field patterns from all templates for comprehensive extraction.
    Returns a dict mapping field names to all possible patterns.
    """
    all_patterns = {}
    
    for template_def in TEMPLATE_DEFINITIONS.values():
        for section_key, section_def in template_def.get("sections", {}).items():
            if "fields" in section_def:
                for field_key, patterns in section_def["fields"].items():
                    full_key = f"{section_key}.{field_key}"
                    if full_key not in all_patterns:
                        all_patterns[full_key] = set()
                    if isinstance(patterns, list):
                        all_patterns[full_key].update(patterns)
    
    return {k: list(v) for k, v in all_patterns.items()}
