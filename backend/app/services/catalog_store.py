import json
import os
import hashlib
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict

from app.config import settings
from app.services.apikeymanager_client import fetch_model_catalog


class CatalogStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._cache: Dict[str, Any] | None = None
        self._last_mtime_ns: int | None = None

    def initialize(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        with self._lock:
            payload = self._load_live_payload_unlocked()
            if payload is None:
                payload = self._bootstrap_payload_unlocked()
                self._write_payload_unlocked(payload)
            self._apply_payload_unlocked(payload)
            return payload["catalog"]

    def get_catalog(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        with self._lock:
            payload = self._load_live_payload_unlocked()
            if payload is None:
                if self._cache is None:
                    payload = self._bootstrap_payload_unlocked()
                    self._write_payload_unlocked(payload)
                    self._apply_payload_unlocked(payload)
                return dict(settings.model_catalog)

            if self._cache is None or self._file_changed_unlocked():
                self._apply_payload_unlocked(payload)
            return dict(settings.model_catalog)

    def get_metadata(self) -> Dict[str, Any]:
        self.get_catalog()
        payload = self._cache or {}
        return {
            "version": payload.get("version") or "bootstrap",
            "updated_at": payload.get("updated_at"),
        }

    def refresh_from_source(self, version: str | None = None) -> Dict[str, Any]:
        catalog = fetch_model_catalog()
        payload = {
            "version": (version or self._version_from_catalog(catalog)).strip() or self._version_from_catalog(catalog),
            "updated_at": self._utc_now(),
            "catalog": catalog,
        }
        with self._lock:
            current_version = ((self._cache or {}).get("version") or "").strip()
            incoming_version = (payload["version"] or "").strip()
            if current_version and incoming_version and incoming_version == current_version:
                return {
                    "updated": False,
                    "version": current_version,
                    "updated_at": (self._cache or {}).get("updated_at"),
                }
            self._write_payload_unlocked(payload)
            self._apply_payload_unlocked(payload)
            return {
                "updated": True,
                "version": payload["version"],
                "updated_at": payload["updated_at"],
            }

    def should_refresh(self, version: str | None) -> bool:
        incoming = (version or "").strip()
        current = (self.get_metadata().get("version") or "").strip()
        return bool(incoming and incoming != current)

    def _bootstrap_payload_unlocked(self) -> Dict[str, Any]:
        catalog = settings._load_json("model_catalog.json")
        return {
            "version": "bootstrap",
            "updated_at": self._utc_now(),
            "catalog": catalog,
        }

    def _load_live_payload_unlocked(self) -> Dict[str, Any] | None:
        path = settings.live_model_catalog_path
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as exc:
            print(f"⚠️ Warning: Failed to load live model catalog cache: {exc}")
            return None

        if not isinstance(payload, dict) or not isinstance(payload.get("catalog"), dict):
            print("⚠️ Warning: Live model catalog cache is invalid, ignoring it")
            return None
        return payload

    def _write_payload_unlocked(self, payload: Dict[str, Any]) -> None:
        path = settings.live_model_catalog_path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=True, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp_path, path)
        self._last_mtime_ns = path.stat().st_mtime_ns

    def _apply_payload_unlocked(self, payload: Dict[str, Any]) -> None:
        settings.model_catalog = payload["catalog"]
        self._cache = payload
        path = settings.live_model_catalog_path
        if path.exists():
            self._last_mtime_ns = path.stat().st_mtime_ns

    def _file_changed_unlocked(self) -> bool:
        path = settings.live_model_catalog_path
        if not path.exists():
            return False
        current_mtime_ns = path.stat().st_mtime_ns
        return self._last_mtime_ns != current_mtime_ns

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _version_from_catalog(catalog: Dict[str, Any]) -> str:
        raw = json.dumps(catalog, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()


catalog_store = CatalogStore()
