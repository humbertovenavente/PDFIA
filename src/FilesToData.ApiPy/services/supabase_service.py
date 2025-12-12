import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class SupabaseService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._results: Dict[str, Any] = {}
        self._masking_logs: Dict[str, List[Dict[str, Any]]] = {}
        self._files: Dict[str, bytes] = {}

    # Jobs
    def create_job(self, job: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            self._jobs[job["id"]] = job
        return job

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(
        self,
        status: Optional[str] = None,
        mode: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        with self._lock:
            jobs = list(self._jobs.values())

        if status:
            jobs = [j for j in jobs if str(j.get("status", "")).upper() == status.upper()]
        if mode:
            jobs = [j for j in jobs if str(j.get("mode", "")).upper() == mode.upper()]

        jobs.sort(key=lambda j: j.get("created_at") or "", reverse=True)
        return jobs[offset : offset + limit]

    def update_job_status(self, job_id: str, status: str, error_message: Optional[str] = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job["status"] = status
            job["error_message"] = error_message
            job["updated_at"] = _utc_now_iso()
            self._jobs[job_id] = job

    # Results
    def get_results(self, job_id: str) -> Any:
        with self._lock:
            return self._results.get(job_id)

    def upsert_results(self, job_id: str, data: Any) -> None:
        with self._lock:
            self._results[job_id] = data

    # Masking logs
    def create_masking_log(self, log: Dict[str, Any]) -> None:
        job_id = str(log.get("job_id"))
        with self._lock:
            self._masking_logs.setdefault(job_id, []).append(log)

    def get_masking_logs(self, job_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self._masking_logs.get(job_id, []))

    # Storage
    def upload_file(self, file_path: str, content: bytes) -> None:
        with self._lock:
            self._files[file_path] = content

    def download_file(self, file_path: str) -> bytes:
        with self._lock:
            if file_path not in self._files:
                raise FileNotFoundError(f"File not found in in-memory storage: {file_path}")
            return self._files[file_path]


supabase = SupabaseService()
