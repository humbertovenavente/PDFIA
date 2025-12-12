import json
import re
from typing import Any, Dict, Tuple


class MaskingService:
    def __init__(self) -> None:
        self._counters: Dict[str, int] = {}
        self._patterns = {
            "EMAIL": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
            "PHONE": re.compile(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}"),
            "CREDIT_CARD": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
            "ID_NUMBER": re.compile(r"\b(?:RFC|CURP|SSN|DNI|NIF|NIE)[\s:]*[A-Z0-9]{8,18}\b", re.IGNORECASE),
        }

    def _next_token(self, t: str) -> str:
        self._counters[t] = self._counters.get(t, 0) + 1
        return f"[{t}_{self._counters[t]}]"

    def mask_text(self, text: str) -> Tuple[str, Dict[str, Dict[str, str]]]:
        self._counters.clear()
        entities = []

        for t, rx in self._patterns.items():
            for m in rx.finditer(text):
                entities.append((m.start(), m.end(), t, m.group(0)))

        entities.sort(key=lambda e: e[0], reverse=True)

        masking_map: Dict[str, Dict[str, str]] = {}
        masked = text

        for start, end, t, original in entities:
            token = self._next_token(t)
            masked = masked[:start] + token + masked[end:]
            masking_map[token] = {"original": original, "type": t}

        return masked, masking_map

    def unmask_data(self, data: Any, masking_map: Dict[str, Dict[str, str]]) -> Any:
        def _walk(value: Any) -> Any:
            if value is None:
                return None

            if isinstance(value, str):
                out = value
                for token, info in masking_map.items():
                    out = out.replace(token, info.get("original") or token)
                return out

            if isinstance(value, list):
                return [_walk(v) for v in value]

            if isinstance(value, dict):
                return {k: _walk(v) for k, v in value.items()}

            return value

        return _walk(data)


masking_service = MaskingService()
