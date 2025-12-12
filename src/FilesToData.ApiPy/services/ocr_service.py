import os
import base64
import io
from typing import Optional

import requests
from pypdf import PdfReader


class OcrService:
    def __init__(self) -> None:
        self._deepseek_api_key = (os.getenv("DEEPSEEK_OCR_API_KEY") or "").strip() or None
        self._deepseek_endpoint = (os.getenv("DEEPSEEK_OCR_ENDPOINT") or "").strip() or "https://api.deepseek.com/v1/ocr"

    def extract_text(self, file_bytes: bytes, file_name: str) -> str:
        ext = (os.path.splitext(file_name)[1] or "").lower().lstrip(".")

        if ext == "pdf":
            return self._extract_from_pdf(file_bytes)

        if ext in {"jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp"}:
            return self._extract_from_image(file_bytes)

        return self._extract_from_image(file_bytes)

    def _extract_from_pdf(self, pdf_bytes: bytes) -> str:
        local = self._try_extract_pdf_text_layer(pdf_bytes)
        if local:
            return local

        if self._deepseek_api_key:
            return self._call_deepseek_ocr(pdf_bytes, "application/pdf")

        return "[PDF contains no extractable text layer. Configure DEEPSEEK_OCR_API_KEY for OCR.]"

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
        if self._deepseek_api_key:
            return self._call_deepseek_ocr(image_bytes, "image/png")
        return "[OCR extraction requires DEEPSEEK_OCR_API_KEY configuration]"

    def _call_deepseek_ocr(self, content: bytes, content_type: str) -> str:
        try:
            base64_content = base64.b64encode(content).decode("utf-8")
            payload = {
                "file": base64_content,
                "content_type": content_type,
                "language": "auto",
                "output_format": "text",
            }
            headers = {"Authorization": f"Bearer {self._deepseek_api_key}"}
            resp = requests.post(self._deepseek_endpoint, json=payload, headers=headers, timeout=60)
            if resp.status_code // 100 != 2:
                return "[OCR error or unauthorized - using placeholder text]"
            data = resp.json() if resp.content else {}
            return data.get("text") or ""
        except Exception:
            return "[OCR API network error - using placeholder text]"


ocr_service = OcrService()
