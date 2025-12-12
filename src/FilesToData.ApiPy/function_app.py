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
    origin = os.getenv("CORS_ALLOWED_ORIGIN") or "http://localhost:3000"
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    }


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
        extracted_text = ocr_service.extract_text(file_bytes, job.get("file_name") or "document.pdf")

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
