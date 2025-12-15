import os
import base64
import io
from typing import Optional, List, Dict, Any
from pypdf import PdfReader

# Optional imports for image OCR
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

try:
    import pytesseract
    from PIL import Image
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False


class OcrService:
    def __init__(self) -> None:
        # Optional: set Tesseract path if needed (Windows)
        tesseract_path = os.getenv("TESSERACT_PATH", "").strip()
        if tesseract_path and HAS_TESSERACT:
            pytesseract.pytesseract.tesseract_cmd = tesseract_path

    def extract_text(self, file_bytes: bytes, file_name: str) -> str:
        ext = (os.path.splitext(file_name)[1] or "").lower().lstrip(".")

        if ext == "pdf":
            return self._extract_from_pdf(file_bytes)

        if ext in {"jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp"}:
            return self._extract_from_image(file_bytes)

        return self._extract_from_image(file_bytes)

    def _extract_from_pdf(self, pdf_bytes: bytes) -> str:
        """Extract text from PDF: text layer + OCR on embedded images."""
        parts = []
        
        # 1. Extract text layer
        text_layer = self._try_extract_pdf_text_layer(pdf_bytes)
        if text_layer:
            parts.append(text_layer)
        
        # 2. Extract and OCR images from PDF
        image_texts = self._extract_images_from_pdf(pdf_bytes)
        if image_texts:
            parts.append("\n--- TEXTO EXTRAÍDO DE IMÁGENES (OCR) ---\n")
            parts.extend(image_texts)
        
        if parts:
            return "\n".join(parts).strip()

        return "[PDF contains no extractable text layer. Configure TESSERACT_PATH for OCR.]"

    def _try_extract_pdf_text_layer(self, pdf_bytes: bytes) -> Optional[str]:
        try:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            parts = []
            for i, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                parts.append(f"--- PAGE {i} ---\n{text}\n")
            result = "\n".join(parts).strip()
            return result or None
        except Exception:
            return None

    def _extract_from_image(self, image_bytes: bytes) -> str:
        """Extract text from image using Tesseract."""
        # Try Tesseract first (local, free)
        if HAS_TESSERACT:
            text = self._ocr_with_tesseract(image_bytes)
            if text and text.strip():
                return text

        return "[OCR extraction requires Tesseract configuration]"

    def _ocr_with_tesseract(self, image_bytes: bytes) -> str:
        """Run OCR on image bytes using Tesseract."""
        if not HAS_TESSERACT:
            return ""
        try:
            image = Image.open(io.BytesIO(image_bytes))
            # Convert to RGB if necessary (handles RGBA, P mode, etc.)
            if image.mode not in ('RGB', 'L'):
                image = image.convert('RGB')
            # Run Tesseract with Spanish + English
            text = pytesseract.image_to_string(image, lang='spa+eng')
            return text.strip()
        except Exception as e:
            return f"[Tesseract OCR error: {str(e)}]"

    def _extract_images_from_pdf(self, pdf_bytes: bytes) -> List[str]:
        """Extract embedded images from PDF and run OCR on each."""
        if not HAS_PYMUPDF:
            return []
        
        results = []
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            for page_num, page in enumerate(doc, start=1):
                image_list = page.get_images(full=True)
                for img_index, img_info in enumerate(image_list, start=1):
                    try:
                        xref = img_info[0]
                        base_image = doc.extract_image(xref)
                        if not base_image:
                            continue
                        
                        image_bytes = base_image.get("image")
                        if not image_bytes:
                            continue
                        
                        # Skip very small images (likely icons/decorations)
                        width = base_image.get("width", 0)
                        height = base_image.get("height", 0)
                        if width < 50 or height < 50:
                            continue
                        
                        # Run OCR on the image
                        ocr_text = self._extract_from_image(image_bytes)
                        if ocr_text and ocr_text.strip() and not ocr_text.startswith("["):
                            results.append(f"[Imagen página {page_num}, #{img_index} ({width}x{height})]:\n{ocr_text}")
                    except Exception:
                        continue
            doc.close()
        except Exception:
            pass
        
        return results

    def extract_text_with_images(self, file_bytes: bytes, file_name: str) -> Dict[str, Any]:
        """Extract text and return structured data including image info."""
        ext = (os.path.splitext(file_name)[1] or "").lower().lstrip(".")
        
        result = {
            "text": "",
            "images_extracted": [],
            "ocr_method": "none"
        }
        
        if ext == "pdf":
            # Get text layer
            text_layer = self._try_extract_pdf_text_layer(file_bytes)
            if text_layer:
                result["text"] = text_layer
                result["ocr_method"] = "pdf_text_layer"
            
            # Extract images and OCR them
            image_results = self._extract_images_with_details(file_bytes)
            result["images_extracted"] = image_results
            
            # Append image OCR text to main text
            if image_results:
                image_texts = [img["ocr_text"] for img in image_results if img.get("ocr_text")]
                if image_texts:
                    if result["text"]:
                        result["text"] += "\n\n--- TEXTO DE IMÁGENES (OCR) ---\n"
                    result["text"] += "\n".join(image_texts)
                    if result["ocr_method"] == "pdf_text_layer":
                        result["ocr_method"] = "pdf_text_layer+image_ocr"
                    else:
                        result["ocr_method"] = "image_ocr"
        else:
            # Single image file
            ocr_text = self._extract_from_image(file_bytes)
            result["text"] = ocr_text
            result["ocr_method"] = "tesseract" if HAS_TESSERACT else "none"
            result["images_extracted"] = [{
                "page": 1,
                "index": 1,
                "ocr_text": ocr_text
            }]
        
        return result

    def _extract_images_with_details(self, pdf_bytes: bytes) -> List[Dict[str, Any]]:
        """Extract images from PDF with metadata."""
        if not HAS_PYMUPDF:
            return []
        
        results = []
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            for page_num, page in enumerate(doc, start=1):
                image_list = page.get_images(full=True)
                for img_index, img_info in enumerate(image_list, start=1):
                    try:
                        xref = img_info[0]
                        base_image = doc.extract_image(xref)
                        if not base_image:
                            continue
                        
                        image_bytes = base_image.get("image")
                        if not image_bytes:
                            continue
                        
                        width = base_image.get("width", 0)
                        height = base_image.get("height", 0)
                        
                        # Skip very small images
                        if width < 50 or height < 50:
                            continue
                        
                        ocr_text = ""
                        if HAS_TESSERACT:
                            ocr_text = self._extract_from_image(image_bytes)
                            if ocr_text.startswith("["):
                                ocr_text = ""  # Error message, ignore
                        
                        # Convert image to base64 for frontend display
                        img_format = base_image.get("ext", "png")
                        mime_type = f"image/{img_format}" if img_format != "unknown" else "image/png"
                        img_base64 = base64.b64encode(image_bytes).decode("utf-8")
                        
                        results.append({
                            "page": page_num,
                            "index": img_index,
                            "width": width,
                            "height": height,
                            "format": img_format,
                            "ocr_text": ocr_text.strip() if ocr_text else "",
                            "data_url": f"data:{mime_type};base64,{img_base64}"
                        })
                    except Exception:
                        continue
            doc.close()
        except Exception:
            pass
        
        return results

ocr_service = OcrService()
