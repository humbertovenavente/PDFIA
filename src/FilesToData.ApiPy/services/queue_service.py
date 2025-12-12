import json
import os
from typing import Any, Dict

from azure.core.exceptions import ResourceExistsError
from azure.storage.queue import QueueClient

try:
    from azure.storage.queue import TextBase64EncodePolicy
except Exception:  # pragma: no cover
    TextBase64EncodePolicy = None


class QueueService:
    def __init__(self) -> None:
        raw = os.getenv("AzureWebJobsStorage") or "UseDevelopmentStorage=true"
        self._connection_string = self._normalize_connection_string(raw)

    @staticmethod
    def _normalize_connection_string(value: str) -> str:
        v = (value or "").strip()
        if v.lower() == "usedevelopmentstorage=true":
            # Azurite default devstore account.
            return (
                "DefaultEndpointsProtocol=http;"
                "AccountName=devstoreaccount1;"
                "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;"
                "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
                "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;"
                "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;"
            )

        return v

    def enqueue(self, queue_name: str, message: Dict[str, Any]) -> str:
        client_kwargs: Dict[str, Any] = {}
        if TextBase64EncodePolicy is not None:
            client_kwargs["message_encode_policy"] = TextBase64EncodePolicy()

        queue_client = QueueClient.from_connection_string(self._connection_string, queue_name, **client_kwargs)
        try:
            queue_client.create_queue()
        except ResourceExistsError:
            pass

        message_json = json.dumps(message, ensure_ascii=False)
        receipt = queue_client.send_message(message_json)
        return receipt.id


queue_service = QueueService()
