import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import azure.functions as func

from services.ai_service import ai_service
from services.masking_service import masking_service
from services.ocr_service import ocr_service
from services.queue_service import queue_service
from services.supabase_service import supabase

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _cors_headers() -> Dict[str, str]:
    origin = (os.getenv("CORS_ALLOWED_ORIGIN") or "").strip() or "*"
    headers = {
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,ngrok-skip-browser-warning",
        "Access-Control-Max-Age": "86400",
    }
    if origin.strip() == "*":
        headers["Access-Control-Allow-Origin"] = "*"
    else:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return headers


def _cors_preflight() -> func.HttpResponse:
    return func.HttpResponse(status_code=204, headers=_cors_headers())


def _json_response(payload: Any, status_code: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload, ensure_ascii=False),
        status_code=status_code,
        mimetype="application/json",
        headers=_cors_headers(),
    )


def _bad_request(message: str) -> func.HttpResponse:
    return _json_response({"error": message}, status_code=400)


def _not_found(message: str) -> func.HttpResponse:
    return _json_response({"error": message}, status_code=404)


def _parse_uuid(value: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(value)
    except Exception:
        return None


def _parse_multipart_file(req: func.HttpRequest) -> Tuple[Optional[bytes], Optional[str]]:
    # Prefer built-in parsing when available.
    try:
        files = getattr(req, "files", None)
        if files:
            file_obj = files.get("file")
            if file_obj is not None:
                filename = getattr(file_obj, "filename", None) or getattr(file_obj, "name", None)
                data = file_obj.read() if hasattr(file_obj, "read") else None
                if data is not None and filename:
                    return data, filename
    except Exception:
        pass

    content_type = req.headers.get("content-type") or req.headers.get("Content-Type")
    if not content_type or "multipart/form-data" not in content_type:
        return None, None

    body = req.get_body() or b""

    # Parse multipart using standard library email parser.
    # We construct a pseudo-message with Content-Type so email can split parts.
    from email.parser import BytesParser
    from email.policy import default

    pseudo = (f"Content-Type: {content_type}\r\n\r\n").encode("utf-8") + body
    msg = BytesParser(policy=default).parsebytes(pseudo)

    if not msg.is_multipart():
        return None, None

    for part in msg.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue

        params = part.get_params(header="content-disposition") or []
        name = None
        for k, v in params:
            if k == "name":
                name = v
                break

        if name != "file":
            continue

        filename = part.get_filename()
        data = part.get_payload(decode=True)
        if not filename or data is None:
            return None, None

        return data, filename

    return None, None


@app.route(route="health", methods=["GET", "OPTIONS"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _cors_preflight()
    return _json_response({"status": "healthy", "version": "2.7.0"})


@app.route(route="jobs", methods=["GET", "POST", "OPTIONS"])
def jobs_handler(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _cors_preflight()

    # POST: create a new job
    if req.method == "POST":
        mode = (req.params.get("mode") or "DOCUMENT").upper().strip()
        if mode not in ("DOCUMENT", "DESIGN"):
            return _bad_request("Invalid mode. Must be 'DOCUMENT' or 'DESIGN'")

        file_bytes, file_name = _parse_multipart_file(req)
        if not file_bytes or not file_name:
            return _bad_request("No file provided")

        job_id = uuid.uuid4()
        file_path = f"uploads/{job_id}/{file_name}"

        supabase.upload_file(file_path, file_bytes)

        now = _utc_now_iso()
        job = {
            "id": str(job_id),
            "mode": mode,
            "file_path": file_path,
            "file_name": file_name,
            "status": "PENDING",
            "error_message": None,
            "created_at": now,
            "updated_at": now,
            "results": None,
        }

        supabase.create_job(job)

        queue_name = "document-jobs" if mode == "DOCUMENT" else "design-jobs"
        queue_service.enqueue(queue_name, {"job_id": str(job_id)})

        return _json_response(
            {
                "job_id": str(job_id),
                "mode": mode,
                "status": "PENDING",
                "file_name": file_name,
                "created_at": job["created_at"],
            },
            status_code=201,
        )

    # GET: list jobs
    status = (req.params.get("status") or "").upper().strip() or None
    mode = (req.params.get("mode") or "").upper().strip() or None

    try:
        limit = int(req.params.get("limit") or 50)
    except Exception:
        limit = 50

    try:
        offset = int(req.params.get("offset") or 0)
    except Exception:
        offset = 0

    jobs = supabase.list_jobs(status=status, mode=mode, limit=limit, offset=offset)
    return _json_response({"jobs": jobs, "count": len(jobs)})


@app.route(route="jobs/{jobId}", methods=["GET", "OPTIONS"])
def get_job(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _cors_preflight()
    job_id_str = req.route_params.get("jobId")
    if not job_id_str:
        return _bad_request("Invalid job ID")

    job_id = _parse_uuid(job_id_str)
    if not job_id:
        return _bad_request("Invalid job ID")

    job = supabase.get_job(str(job_id))
    if job is None:
        return _not_found("Job not found")

    results = supabase.get_results(str(job_id))
    job_with_results = dict(job)
    job_with_results["results"] = results

    return _json_response(job_with_results)


@app.route(route="jobs/{jobId}/results", methods=["PUT", "OPTIONS"])
def update_job_results(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _cors_preflight()
    job_id_str = req.route_params.get("jobId")
    if not job_id_str:
        return _bad_request("Invalid job ID")

    job_id = _parse_uuid(job_id_str)
    if not job_id:
        return _bad_request("Invalid job ID")

    job = supabase.get_job(str(job_id))
    if job is None:
        return _not_found("Job not found")

    try:
        body = req.get_json()
    except Exception:
        body = {}

    data = body.get("data") if isinstance(body, dict) else None
    if data is None:
        return _bad_request("'data' field is required")

    supabase.upsert_results(str(job_id), data)

    return _json_response({"message": "Results updated successfully", "job_id": str(job_id)})


@app.route(route="ocr/roi", methods=["POST", "OPTIONS"])
def ocr_roi_handler(req: func.HttpRequest) -> func.HttpResponse:
    """
    OCR with Region of Interest (ROI).
    
    Accepts multipart form data with:
    - file: Image file (JPEG, PNG, etc.)
    - x: Left coordinate of ROI
    - y: Top coordinate of ROI  
    - width: Width of ROI
    - height: Height of ROI
    - use_claude: (optional) "true" to use Claude Vision, otherwise Tesseract
    
    Or JSON body with:
    - image_base64: Base64 encoded image
    - x, y, width, height: ROI coordinates
    - use_claude: (optional) boolean
    """
    if req.method == "OPTIONS":
        return _cors_preflight()

    try:
        image_bytes: Optional[bytes] = None
        x = y = width = height = 0
        use_claude = False

        content_type = req.headers.get("content-type", "").lower()

        if "multipart/form-data" in content_type:
            # Parse multipart form
            file_bytes, file_name = _parse_multipart_file(req)
            if not file_bytes:
                return _bad_request("No image file provided")
            image_bytes = file_bytes

            # Get ROI params from form fields or query params
            try:
                x = int(req.params.get("x") or req.form.get("x") or 0)
                y = int(req.params.get("y") or req.form.get("y") or 0)
                width = int(req.params.get("width") or req.form.get("width") or 0)
                height = int(req.params.get("height") or req.form.get("height") or 0)
            except (ValueError, TypeError):
                return _bad_request("Invalid ROI coordinates. Must be integers.")

            use_claude_str = (req.params.get("use_claude") or req.form.get("use_claude") or "").lower()
            use_claude = use_claude_str in ("true", "1", "yes")

        elif "application/json" in content_type:
            # Parse JSON body
            try:
                body = req.get_json()
            except Exception:
                return _bad_request("Invalid JSON body")

            image_b64 = body.get("image_base64") or body.get("image")
            if not image_b64:
                return _bad_request("No image_base64 provided in JSON body")

            # Remove data URL prefix if present
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]

            try:
                import base64
                image_bytes = base64.b64decode(image_b64)
            except Exception:
                return _bad_request("Invalid base64 image data")

            try:
                x = int(body.get("x", 0))
                y = int(body.get("y", 0))
                width = int(body.get("width", 0))
                height = int(body.get("height", 0))
            except (ValueError, TypeError):
                return _bad_request("Invalid ROI coordinates. Must be integers.")

            use_claude = body.get("use_claude", False) is True

        else:
            return _bad_request("Content-Type must be multipart/form-data or application/json")

        if not image_bytes:
            return _bad_request("No image data provided")

        if width <= 0 or height <= 0:
            return _bad_request("ROI width and height must be positive integers")

        # Perform OCR on ROI
        result = ocr_service.ocr_region(
            image_bytes=image_bytes,
            x=x,
            y=y,
            width=width,
            height=height,
            use_claude=use_claude,
        )

        if result.get("error"):
            return _json_response({"error": result["error"], "roi": result["roi"]}, status_code=400)

        return _json_response(result)

    except Exception as ex:
        logger.exception("Error in OCR ROI handler")
        return _json_response({"error": str(ex)}, status_code=500)


@app.route(route="ocr/roi/batch", methods=["POST", "OPTIONS"])
def ocr_roi_batch_handler(req: func.HttpRequest) -> func.HttpResponse:
    """
    OCR multiple regions from a single image.
    
    JSON body:
    - image_base64: Base64 encoded image
    - regions: Array of {x, y, width, height, name?}
    - use_claude: (optional) boolean
    """
    if req.method == "OPTIONS":
        return _cors_preflight()

    try:
        try:
            body = req.get_json()
        except Exception:
            return _bad_request("Invalid JSON body")

        image_b64 = body.get("image_base64") or body.get("image")
        if not image_b64:
            return _bad_request("No image_base64 provided")

        # Remove data URL prefix if present
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        try:
            import base64
            image_bytes = base64.b64decode(image_b64)
        except Exception:
            return _bad_request("Invalid base64 image data")

        regions = body.get("regions", [])
        if not isinstance(regions, list) or len(regions) == 0:
            return _bad_request("'regions' must be a non-empty array")

        use_claude = body.get("use_claude", False) is True

        results = ocr_service.ocr_multiple_regions(
            image_bytes=image_bytes,
            regions=regions,
            use_claude=use_claude,
        )

        return _json_response({"results": results, "count": len(results)})

    except Exception as ex:
        logger.exception("Error in OCR ROI batch handler")
        return _json_response({"error": str(ex)}, status_code=500)


@app.route(route="ocr/full", methods=["POST", "OPTIONS"])
def ocr_full_handler(req: func.HttpRequest) -> func.HttpResponse:
    """
    OCR full image (no ROI cropping).
    
    Accepts multipart form data with:
    - file: Image file
    - use_claude: (optional) "true" to use Claude Vision
    
    Or JSON body with:
    - image_base64: Base64 encoded image
    - use_claude: (optional) boolean
    """
    if req.method == "OPTIONS":
        return _cors_preflight()

    try:
        image_bytes: Optional[bytes] = None
        use_claude = False

        content_type = req.headers.get("content-type", "").lower()

        if "multipart/form-data" in content_type:
            file_bytes, file_name = _parse_multipart_file(req)
            if not file_bytes:
                return _bad_request("No image file provided")
            image_bytes = file_bytes
            use_claude_str = (req.params.get("use_claude") or "").lower()
            use_claude = use_claude_str in ("true", "1", "yes")

        elif "application/json" in content_type:
            try:
                body = req.get_json()
            except Exception:
                return _bad_request("Invalid JSON body")

            image_b64 = body.get("image_base64") or body.get("image")
            if not image_b64:
                return _bad_request("No image_base64 provided")

            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]

            try:
                import base64
                image_bytes = base64.b64decode(image_b64)
            except Exception:
                return _bad_request("Invalid base64 image data")

            use_claude = body.get("use_claude", False) is True

        else:
            return _bad_request("Content-Type must be multipart/form-data or application/json")

        if not image_bytes:
            return _bad_request("No image data provided")

        # Get image dimensions
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes))
        img_width, img_height = img.size

        # OCR full image (ROI = entire image)
        result = ocr_service.ocr_region(
            image_bytes=image_bytes,
            x=0,
            y=0,
            width=img_width,
            height=img_height,
            use_claude=use_claude,
        )

        # Don't include full cropped image in response (it's the same as input)
        result.pop("cropped_image", None)
        result["image_size"] = {"width": img_width, "height": img_height}

        if result.get("error"):
            return _json_response({"error": result["error"]}, status_code=400)

        return _json_response(result)

    except Exception as ex:
        logger.exception("Error in OCR full handler")
        return _json_response({"error": str(ex)}, status_code=500)


@app.route(route="ocr/detect-regions", methods=["POST", "OPTIONS"])
def ocr_detect_regions_handler(req: func.HttpRequest) -> func.HttpResponse:
    """
    Auto-detect text AND visual regions in an image.
    Returns bounding boxes for text blocks, shapes, boxes, and illustrations.
    
    JSON body:
    - image_base64: Base64 encoded image
    - detect_visual: (optional) boolean, default True - also detect visual regions
    """
    if req.method == "OPTIONS":
        return _cors_preflight()

    try:
        try:
            body = req.get_json()
        except Exception:
            return _bad_request("Invalid JSON body")

        image_b64 = body.get("image_base64") or body.get("image")
        if not image_b64:
            return _bad_request("No image_base64 provided")

        # Remove data URL prefix if present
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]

        try:
            import base64
            image_bytes = base64.b64decode(image_b64)
        except Exception:
            return _bad_request("Invalid base64 image data")

        detect_visual = body.get("detect_visual", True)
        
        if detect_visual:
            # Detect both text and visual regions
            result = ocr_service.detect_all_regions(image_bytes)
        else:
            # Only detect text regions (legacy behavior)
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(image_bytes))
            img_width, img_height = img.size
            regions = ocr_service.detect_text_regions(image_bytes)
            result = {
                "regions": regions,
                "count": len(regions),
                "text_count": len(regions),
                "visual_count": 0,
                "image_size": {"width": img_width, "height": img_height}
            }

        return _json_response(result)

    except Exception as ex:
        logger.exception("Error in OCR detect regions handler")
        return _json_response({"error": str(ex)}, status_code=500)


@app.function_name(name="ProcessDocumentJob")
@app.queue_trigger(arg_name="msg", queue_name="document-jobs", connection="Storage")
def process_document_job(msg: func.QueueMessage) -> None:
    raw = msg.get_body().decode("utf-8")

    job_id: Optional[str] = None

    try:
        payload = json.loads(raw)
        job_id = payload.get("job_id")
        if not job_id:
            raise ValueError("Invalid message format")

        supabase.update_job_status(job_id, "PROCESSING")

        job = supabase.get_job(job_id)
        if job is None:
            logger.warning("Job %s not found in SupabaseService. Skipping message.", job_id)
            return

        file_bytes = supabase.download_file(job["file_path"])
        file_name = job.get("file_name") or "document.pdf"
        
        # Extract text and images from document
        extraction_result = ocr_service.extract_text_with_images(file_bytes, file_name)
        extracted_text = extraction_result.get("text", "")
        extracted_images = extraction_result.get("images_extracted", [])

        masked_text, masking_map = masking_service.mask_text(extracted_text)

        for token, info in masking_map.items():
            supabase.create_masking_log(
                {
                    "job_id": job_id,
                    "token": token,
                    "original_value": info["original"],
                    "type": info["type"],
                }
            )

        structured = ai_service.extract_document_data(masked_text)
        unmasked = masking_service.unmask_data(structured, masking_map)
        
        # Add extracted images to results
        if extracted_images:
            unmasked["_extracted_images"] = extracted_images
            unmasked["_ocr_method"] = extraction_result.get("ocr_method", "unknown")

        supabase.upsert_results(job_id, unmasked)
        supabase.update_job_status(job_id, "COMPLETED")

    except Exception as ex:
        logger.exception("Error processing document job")
        if job_id:
            supabase.update_job_status(job_id, "FAILED", str(ex))


@app.function_name(name="ProcessDesignJob")
@app.queue_trigger(arg_name="msg", queue_name="design-jobs", connection="Storage")
def process_design_job(msg: func.QueueMessage) -> None:
    raw = msg.get_body().decode("utf-8")

    job_id: Optional[str] = None

    try:
        payload = json.loads(raw)
        job_id = payload.get("job_id")
        if not job_id:
            raise ValueError("Invalid message format")

        supabase.update_job_status(job_id, "PROCESSING")

        job = supabase.get_job(job_id)
        if job is None:
            logger.warning("Job %s not found in SupabaseService. Skipping message.", job_id)
            return

        image_bytes = supabase.download_file(job["file_path"])
        analysis = ai_service.analyze_design_image(image_bytes, job.get("file_name") or "image.png")

        supabase.upsert_results(job_id, analysis)
        supabase.update_job_status(job_id, "COMPLETED")

    except Exception as ex:
        logger.exception("Error processing design job")
        if job_id:
            supabase.update_job_status(job_id, "FAILED", str(ex))
