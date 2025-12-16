import os
import base64
import io
from typing import Optional, List, Dict, Any, Tuple
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

# OpenCV for visual region detection
try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False


class OcrService:
    def __init__(self) -> None:
        # Optional: set Tesseract path if needed (Windows)
        tesseract_path = os.getenv("TESSERACT_PATH", "").strip()
        if tesseract_path and HAS_TESSERACT:
            pytesseract.pytesseract.tesseract_cmd = tesseract_path

    def _refine_bbox_to_content(self, gray_img, x: int, y: int, w: int, h: int, img_width: int, img_height: int) -> Tuple[int, int, int, int]:
        if not HAS_OPENCV:
            return x, y, w, h

        x = max(0, min(int(x), img_width - 1))
        y = max(0, min(int(y), img_height - 1))
        w = max(1, min(int(w), img_width - x))
        h = max(1, min(int(h), img_height - y))

        roi = gray_img[y:y + h, x:x + w]
        if roi is None or roi.size == 0:
            return x, y, w, h

        roi_h, roi_w = roi.shape[:2]
        if roi_w < 10 or roi_h < 10:
            return x, y, w, h

        try:
            roi_blur = cv2.GaussianBlur(roi, (3, 3), 0)
            edges = cv2.Canny(roi_blur, 30, 120)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            edges = cv2.dilate(edges, kernel, iterations=1)

            ys, xs = np.where(edges > 0)
            if xs.size < max(20, int(roi.size * 0.0008)):
                inv = 255 - roi_blur
                _, thr = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                thr = cv2.morphologyEx(thr, cv2.MORPH_OPEN, kernel, iterations=1)
                ys, xs = np.where(thr > 0)
                if xs.size < max(20, int(roi.size * 0.0008)):
                    return x, y, w, h

            x1 = int(xs.min())
            y1 = int(ys.min())
            x2 = int(xs.max())
            y2 = int(ys.max())

            pad = max(3, int(min(roi_w, roi_h) * 0.02))
            rx1 = max(0, x + x1 - pad)
            ry1 = max(0, y + y1 - pad)
            rx2 = min(img_width, x + x2 + pad)
            ry2 = min(img_height, y + y2 + pad)

            rw = max(1, rx2 - rx1)
            rh = max(1, ry2 - ry1)

            if rw < w * 0.15 or rh < h * 0.15:
                return x, y, w, h

            return rx1, ry1, rw, rh
        except Exception:
            return x, y, w, h

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

    def detect_text_regions(self, image_bytes: bytes) -> List[Dict[str, Any]]:
        """
        Detect text regions in an image using Tesseract.
        Returns list of bounding boxes with text content.
        """
        if not HAS_TESSERACT:
            return []
        
        regions = []
        try:
            image = Image.open(io.BytesIO(image_bytes))
            if image.mode not in ('RGB', 'L'):
                image = image.convert('RGB')
            
            # Get bounding box data from Tesseract
            data = pytesseract.image_to_data(image, lang='spa+eng', output_type=pytesseract.Output.DICT)
            
            # Group words into blocks/paragraphs
            n_boxes = len(data['text'])
            current_block = None
            blocks = {}
            
            for i in range(n_boxes):
                text = data['text'][i].strip()
                conf = int(data['conf'][i]) if data['conf'][i] != '-1' else 0
                
                if text and conf > 30:  # Filter low confidence
                    block_num = data['block_num'][i]
                    x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                    
                    if block_num not in blocks:
                        blocks[block_num] = {
                            'x': x, 'y': y, 
                            'x2': x + w, 'y2': y + h,
                            'texts': [],
                            'conf_sum': 0,
                            'conf_count': 0
                        }
                    
                    block = blocks[block_num]
                    block['x'] = min(block['x'], x)
                    block['y'] = min(block['y'], y)
                    block['x2'] = max(block['x2'], x + w)
                    block['y2'] = max(block['y2'], y + h)
                    block['texts'].append(text)
                    block['conf_sum'] += conf
                    block['conf_count'] += 1
            
            # Convert blocks to regions
            for block_num, block in blocks.items():
                if block['texts']:
                    width = block['x2'] - block['x']
                    height = block['y2'] - block['y']
                    
                    # Skip very small regions
                    if width < 20 or height < 10:
                        continue
                    
                    # Add padding
                    padding = 5
                    x = max(0, block['x'] - padding)
                    y = max(0, block['y'] - padding)
                    w = width + padding * 2
                    h = height + padding * 2
                    
                    avg_conf = block['conf_sum'] / block['conf_count'] if block['conf_count'] > 0 else 0
                    
                    regions.append({
                        'id': f'region_{block_num}',
                        'x': x,
                        'y': y,
                        'width': w,
                        'height': h,
                        'area': w * h,
                        'text': ' '.join(block['texts']),
                        'confidence': round(avg_conf, 1),
                        'block_num': block_num
                    })
            
            # Sort by position (top to bottom, left to right)
            regions.sort(key=lambda r: (r['y'], r['x']))
            
        except Exception as e:
            print(f"Error detecting text regions: {e}")
        
        return regions

    def detect_visual_regions(self, image_bytes: bytes, min_area: int = 500) -> List[Dict[str, Any]]:
        """
        Detect visual regions (shapes, boxes, illustrations) using multiple OpenCV methods.
        Much more robust detection that works on any type of image.
        """
        if not HAS_OPENCV:
            return []
        
        regions = []
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return []
            
            img_height, img_width = img.shape[:2]
            img_area = img_height * img_width
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Adaptive min_area based on image size (0.5% of image area minimum)
            adaptive_min_area = max(min_area, int(img_area * 0.005))
            
            # METHOD 1: Multi-scale edge detection with Canny
            for canny_low, canny_high in [(30, 100), (50, 150), (100, 200)]:
                edges = cv2.Canny(gray, canny_low, canny_high)
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
                edges = cv2.dilate(edges, kernel, iterations=2)
                edges = cv2.erode(edges, kernel, iterations=1)
                
                contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                
                for contour in contours:
                    area = cv2.contourArea(contour)
                    if area < adaptive_min_area * 0.5:
                        continue
                    
                    x, y, w, h = cv2.boundingRect(contour)
                    if w < 20 or h < 20:
                        continue
                    if w > img_width * 0.98 and h > img_height * 0.98:
                        continue
                    
                    # Refine bounding box to foreground content
                    rx, ry, rw, rh = self._refine_bbox_to_content(gray, x, y, w, h, img_width, img_height)
                    self._add_region_if_unique(regions, rx, ry, rw, rh, rw * rh, 'shape', 70.0, img_width, img_height)
            
            # METHOD 2: Adaptive thresholding for varied lighting
            adaptive_thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                                     cv2.THRESH_BINARY_INV, 11, 2)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            adaptive_thresh = cv2.morphologyEx(adaptive_thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
            
            contours, _ = cv2.findContours(adaptive_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                area = cv2.contourArea(contour)
                if area < adaptive_min_area:
                    continue
                x, y, w, h = cv2.boundingRect(contour)
                if w < 25 or h < 25:
                    continue
                if w > img_width * 0.98 and h > img_height * 0.98:
                    continue
                rx, ry, rw, rh = self._refine_bbox_to_content(gray, x, y, w, h, img_width, img_height)
                self._add_region_if_unique(regions, rx, ry, rw, rh, rw * rh, 'shape', 65.0, img_width, img_height)
            
            # METHOD 3: Otsu thresholding
            _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
            otsu = cv2.morphologyEx(otsu, cv2.MORPH_CLOSE, kernel, iterations=2)
            
            contours, _ = cv2.findContours(otsu, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                area = cv2.contourArea(contour)
                if area < adaptive_min_area:
                    continue
                x, y, w, h = cv2.boundingRect(contour)
                if w < 25 or h < 25:
                    continue
                if w > img_width * 0.98 and h > img_height * 0.98:
                    continue
                rx, ry, rw, rh = self._refine_bbox_to_content(gray, x, y, w, h, img_width, img_height)
                self._add_region_if_unique(regions, rx, ry, rw, rh, rw * rh, 'illustration', 60.0, img_width, img_height)
            
            # METHOD 4: Color-based segmentation (for colored regions)
            if len(img.shape) == 3:
                hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
                # Detect saturated colors (non-grayscale areas)
                saturation = hsv[:, :, 1]
                _, sat_mask = cv2.threshold(saturation, 50, 255, cv2.THRESH_BINARY)
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
                sat_mask = cv2.morphologyEx(sat_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
                
                contours, _ = cv2.findContours(sat_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                for contour in contours:
                    area = cv2.contourArea(contour)
                    if area < adaptive_min_area * 0.3:
                        continue
                    x, y, w, h = cv2.boundingRect(contour)
                    if w < 15 or h < 15:
                        continue
                    if w > img_width * 0.98 and h > img_height * 0.98:
                        continue
                    rx, ry, rw, rh = self._refine_bbox_to_content(gray, x, y, w, h, img_width, img_height)
                    self._add_region_if_unique(regions, rx, ry, rw, rh, rw * rh, 'colored', 75.0, img_width, img_height)
            
            # METHOD 5: Grid-based detection (divide image into quadrants/sections)
            # This ensures we always have some regions even if other methods fail
            if len(regions) < 3:
                grid_regions = self._create_grid_regions(img_width, img_height)
                for gr in grid_regions:
                    self._add_region_if_unique(regions, gr['x'], gr['y'], gr['width'], gr['height'], 
                                               gr['area'], 'section', 35.0, img_width, img_height, iou_threshold=0.85)
            
            # METHOD 6: Detect rectangles/boxes specifically
            for thresh_val in [127, 200, 230]:
                _, binary = cv2.threshold(gray, thresh_val, 255, cv2.THRESH_BINARY)
                contours, _ = cv2.findContours(binary, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
                
                for contour in contours:
                    peri = cv2.arcLength(contour, True)
                    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
                    
                    if len(approx) == 4:  # Rectangle
                        x, y, w, h = cv2.boundingRect(approx)
                        area = w * h
                        if area < adaptive_min_area * 0.3:
                            continue
                        if w < 20 or h < 20:
                            continue
                        if w > img_width * 0.98 and h > img_height * 0.98:
                            continue
                        rx, ry, rw, rh = self._refine_bbox_to_content(gray, x, y, w, h, img_width, img_height)
                        self._add_region_if_unique(regions, rx, ry, rw, rh, rw * rh, 'box', 80.0, img_width, img_height)
            
            # Classify regions by aspect ratio
            for region in regions:
                w, h = region['width'], region['height']
                aspect_ratio = w / h if h > 0 else 1
                if region['type'] not in ['box', 'colored', 'section']:
                    if 0.8 < aspect_ratio < 1.25:
                        region['type'] = 'box'
                    elif aspect_ratio > 2.5 or aspect_ratio < 0.4:
                        region['type'] = 'banner'

            # If we already have enough real detections, drop grid fallback regions
            non_section = [r for r in regions if r.get('type') != 'section']
            if len(non_section) >= 3:
                regions = non_section
            
            # Sort by area (largest first) then position
            regions.sort(key=lambda r: (-r['area'], r['y'], r['x']))
            
            # Limit to top 20 regions to avoid overwhelming the UI
            regions = regions[:20]
            
        except Exception as e:
            print(f"Error detecting visual regions: {e}")
            import traceback
            traceback.print_exc()
        
        return regions

    def _add_region_if_unique(self, regions: List[Dict], x: int, y: int, w: int, h: int, 
                               area: float, region_type: str, confidence: float,
                               img_width: int, img_height: int, iou_threshold: float = 0.4) -> bool:
        """Add a region only if it doesn't significantly overlap with existing regions."""
        # Check for duplicates
        for existing in regions:
            iou = self._calculate_iou(
                (x, y, w, h),
                (existing['x'], existing['y'], existing['width'], existing['height'])
            )
            if iou > iou_threshold:
                # Keep the one with higher confidence or larger area
                if confidence > existing['confidence'] or area > existing['area']:
                    existing['x'] = x
                    existing['y'] = y
                    existing['width'] = w
                    existing['height'] = h
                    existing['area'] = area
                    existing['confidence'] = confidence
                    existing['type'] = region_type
                return False
        
        regions.append({
            'id': f'region_{len(regions)}',
            'x': int(x),
            'y': int(y),
            'width': int(w),
            'height': int(h),
            'area': int(area),
            'type': region_type,
            'confidence': confidence,
            'is_visual': True
        })
        return True

    def _create_grid_regions(self, img_width: int, img_height: int) -> List[Dict]:
        """Create grid-based regions as fallback."""
        regions = []
        
        # Full image (with margin)
        margin = 10
        regions.append({
            'x': margin, 'y': margin,
            'width': img_width - margin * 2,
            'height': img_height - margin * 2,
            'area': (img_width - margin * 2) * (img_height - margin * 2)
        })
        
        # Quadrants
        half_w, half_h = img_width // 2, img_height // 2
        quadrants = [
            (0, 0, half_w, half_h),           # Top-left
            (half_w, 0, half_w, half_h),      # Top-right
            (0, half_h, half_w, half_h),      # Bottom-left
            (half_w, half_h, half_w, half_h), # Bottom-right
        ]
        for x, y, w, h in quadrants:
            regions.append({'x': x + 5, 'y': y + 5, 'width': w - 10, 'height': h - 10, 'area': (w-10) * (h-10)})
        
        # Center region
        center_w, center_h = img_width // 2, img_height // 2
        regions.append({
            'x': img_width // 4, 'y': img_height // 4,
            'width': center_w, 'height': center_h,
            'area': center_w * center_h
        })
        
        return regions

    def detect_all_regions(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Detect both text and visual regions, merge and deduplicate.
        Returns combined list with region types.
        """
        text_regions = self.detect_text_regions(image_bytes)
        visual_regions = self.detect_visual_regions(image_bytes)
        
        # Mark text regions
        for r in text_regions:
            r['type'] = 'text'
            r['is_visual'] = False
        
        # Combine and deduplicate
        all_regions = []
        
        # Add text regions first
        for tr in text_regions:
            all_regions.append(tr)
        
        # Add visual regions, checking for overlap with text (keep both unless nearly identical)
        for vr in visual_regions:
            is_duplicate = False
            for existing in all_regions:
                iou = self._calculate_iou(
                    (vr['x'], vr['y'], vr['width'], vr['height']),
                    (existing['x'], existing['y'], existing['width'], existing['height'])
                )

                if iou > 0.90:
                    is_duplicate = True
                    break

                ex_area = existing.get('area') or (existing.get('width', 0) * existing.get('height', 0))
                if ex_area > 0:
                    x1 = max(vr['x'], existing['x'])
                    y1 = max(vr['y'], existing['y'])
                    x2 = min(vr['x'] + vr['width'], existing['x'] + existing['width'])
                    y2 = min(vr['y'] + vr['height'], existing['y'] + existing['height'])
                    if x2 > x1 and y2 > y1:
                        inter_area = (x2 - x1) * (y2 - y1)
                        if inter_area / float(ex_area) > 0.65 and existing.get('type') == 'text':
                            vr['type'] = 'mixed'
            
            if not is_duplicate:
                all_regions.append(vr)
        
        # Sort by position (top to bottom, left to right)
        all_regions.sort(key=lambda r: (r['y'], r['x']))
        
        # Assign sequential IDs
        for i, r in enumerate(all_regions):
            r['id'] = f'region_{i}'
        
        # Get image dimensions
        img_width, img_height = 0, 0
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img_width, img_height = img.size
        except:
            pass
        
        return {
            'regions': all_regions,
            'count': len(all_regions),
            'text_count': len([r for r in all_regions if r.get('type') == 'text']),
            'visual_count': len([r for r in all_regions if r.get('is_visual')]),
            'image_size': {'width': img_width, 'height': img_height}
        }

    def _calculate_iou(self, box1: Tuple[int, int, int, int], box2: Tuple[int, int, int, int]) -> float:
        """Calculate Intersection over Union for two bounding boxes (x, y, w, h)."""
        x1, y1, w1, h1 = box1
        x2, y2, w2, h2 = box2
        
        # Calculate intersection
        xi1 = max(x1, x2)
        yi1 = max(y1, y2)
        xi2 = min(x1 + w1, x2 + w2)
        yi2 = min(y1 + h1, y2 + h2)
        
        if xi2 <= xi1 or yi2 <= yi1:
            return 0.0
        
        inter_area = (xi2 - xi1) * (yi2 - yi1)
        
        # Calculate union
        box1_area = w1 * h1
        box2_area = w2 * h2
        union_area = box1_area + box2_area - inter_area
        
        if union_area == 0:
            return 0.0
        
        return inter_area / union_area

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

    def ocr_region(
        self,
        image_bytes: bytes,
        x: int,
        y: int,
        width: int,
        height: int,
        use_claude: bool = False,
    ) -> Dict[str, Any]:
        """
        Extract text from a specific region (ROI) of an image.
        
        Args:
            image_bytes: Raw image bytes (JPEG, PNG, etc.)
            x: Left coordinate of the ROI
            y: Top coordinate of the ROI
            width: Width of the ROI
            height: Height of the ROI
            use_claude: If True, use Claude Vision for OCR; otherwise use Tesseract
            
        Returns:
            Dict with 'text', 'roi', 'method', and optionally 'cropped_image' (base64)
        """
        result: Dict[str, Any] = {
            "text": "",
            "roi": {"x": x, "y": y, "width": width, "height": height},
            "method": "none",
            "error": None,
            "cropped_image": None,
        }
        
        try:
            # Open and validate image
            image = Image.open(io.BytesIO(image_bytes))
            orig_width, orig_height = image.size
            
            # Validate ROI bounds
            if x < 0 or y < 0:
                result["error"] = "ROI coordinates must be non-negative"
                return result
            
            if x + width > orig_width or y + height > orig_height:
                result["error"] = f"ROI exceeds image bounds ({orig_width}x{orig_height})"
                return result
            
            if width <= 0 or height <= 0:
                result["error"] = "ROI width and height must be positive"
                return result
            
            # Crop the image to ROI
            cropped = image.crop((x, y, x + width, y + height))
            
            # Convert to RGB if necessary
            if cropped.mode not in ('RGB', 'L'):
                cropped = cropped.convert('RGB')
            
            # Save cropped image to bytes
            cropped_buffer = io.BytesIO()
            img_format = "PNG"
            cropped.save(cropped_buffer, format=img_format)
            cropped_bytes = cropped_buffer.getvalue()
            
            # Include cropped image as base64 for verification
            cropped_b64 = base64.b64encode(cropped_bytes).decode("utf-8")
            result["cropped_image"] = f"data:image/png;base64,{cropped_b64}"
            
            # Perform OCR
            if use_claude:
                # Use Claude Vision for OCR
                ocr_text = self._ocr_with_claude(cropped_bytes)
                result["method"] = "claude_vision"
            else:
                # Use Tesseract
                if HAS_TESSERACT:
                    ocr_text = self._ocr_with_tesseract(cropped_bytes)
                    result["method"] = "tesseract"
                else:
                    result["error"] = "Tesseract not available. Set use_claude=true or install Tesseract."
                    return result
            
            result["text"] = ocr_text.strip() if ocr_text else ""
            
        except Exception as e:
            result["error"] = str(e)
        
        return result

    def _ocr_with_claude(self, image_bytes: bytes) -> str:
        """Use Claude Vision API for OCR on image bytes."""
        import requests
        
        api_key = os.getenv("CLAUDE_API_KEY", "").strip()
        if not api_key:
            return "[Claude API key not configured]"
        
        model = os.getenv("CLAUDE_MODEL", "claude-3-sonnet-20240229").strip()
        
        # Detect image format
        img_b64 = base64.b64encode(image_bytes).decode("utf-8")
        
        # Determine media type
        media_type = "image/png"
        if image_bytes[:2] == b'\xff\xd8':
            media_type = "image/jpeg"
        elif image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
            media_type = "image/png"
        elif image_bytes[:4] == b'GIF8':
            media_type = "image/gif"
        elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
            media_type = "image/webp"
        
        payload = {
            "model": model,
            "max_tokens": 4096,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": img_b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "Extract ALL text visible in this image. "
                                "This may be a clothing label, tag, document, or product photo. "
                                "Return ONLY the extracted text, preserving the original layout as much as possible. "
                                "Include all numbers, codes, sizes, care instructions, and any other text. "
                                "If there are multiple text areas, separate them with newlines. "
                                "Do not add any commentary or explanations."
                            ),
                        },
                    ],
                }
            ],
        }
        
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        
        try:
            resp = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=60,
            )
            
            if resp.status_code != 200:
                return f"[Claude API error: {resp.status_code}]"
            
            data = resp.json()
            for item in data.get("content", []):
                if item.get("type") == "text":
                    return item.get("text", "")
            
            return ""
        except Exception as e:
            return f"[Claude OCR error: {str(e)}]"

    def ocr_multiple_regions(
        self,
        image_bytes: bytes,
        regions: List[Dict[str, int]],
        use_claude: bool = False,
    ) -> List[Dict[str, Any]]:
        """
        Extract text from multiple ROIs in a single image.
        
        Args:
            image_bytes: Raw image bytes
            regions: List of dicts with 'x', 'y', 'width', 'height' keys
            use_claude: If True, use Claude Vision for OCR
            
        Returns:
            List of OCR results for each region
        """
        results = []
        for i, region in enumerate(regions):
            roi_result = self.ocr_region(
                image_bytes,
                x=region.get("x", 0),
                y=region.get("y", 0),
                width=region.get("width", 100),
                height=region.get("height", 100),
                use_claude=use_claude,
            )
            roi_result["region_index"] = i
            roi_result["region_name"] = region.get("name", f"region_{i}")
            results.append(roi_result)
        
        return results


ocr_service = OcrService()
