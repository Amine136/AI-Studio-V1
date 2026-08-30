"""Tests for the in-process Google cert cache used by Firebase auth."""

from __future__ import annotations

import http.client as http_client
import json
import threading

import pytest

from app.services.google_certs_cache import (
    _CACHEABLE_URLS,
    _DEFAULT_TTL_SECONDS,
    _MAX_TTL_SECONDS,
    _MIN_TTL_SECONDS,
    CachingTransportRequest,
)

CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509"
    "/securetoken@system.gserviceaccount.com"
)


class FakeResponse:
    def __init__(self, status=http_client.OK, data=b"{}", headers=None):
        self.status = status
        self.data = data
        self.headers = headers if headers is not None else {}


class FakeTransport:
    """Records every call so we can assert on fetch counts."""

    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])
        self.default = FakeResponse(
            data=json.dumps({"kid1": "cert1"}).encode("utf-8"),
            headers={"cache-control": "public, max-age=3600"},
        )

    def __call__(self, url, method="GET", *args, **kwargs):
        self.calls.append((url, method))
        if self._responses:
            nxt = self._responses.pop(0)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        return self.default


def test_second_call_is_served_from_cache():
    transport = FakeTransport()
    req = CachingTransportRequest(transport)

    first = req(CERTS_URL)
    second = req(CERTS_URL)

    assert len(transport.calls) == 1, "second call should not hit the network"
    assert first.data == second.data
    assert json.loads(second.data.decode("utf-8")) == {"kid1": "cert1"}


def test_both_google_cert_urls_are_cacheable():
    for url in _CACHEABLE_URLS:
        transport = FakeTransport()
        req = CachingTransportRequest(transport)
        req(url)
        req(url)
        assert len(transport.calls) == 1, f"{url} was not cached"


def test_unknown_urls_are_passed_through_uncached():
    transport = FakeTransport()
    req = CachingTransportRequest(transport)

    req("https://example.com/other")
    req("https://example.com/other")

    assert len(transport.calls) == 2


def test_non_get_methods_are_not_cached():
    transport = FakeTransport()
    req = CachingTransportRequest(transport)

    req(CERTS_URL, method="POST")
    req(CERTS_URL, method="POST")

    assert len(transport.calls) == 2


def test_invalidate_forces_a_refetch():
    transport = FakeTransport()
    req = CachingTransportRequest(transport)

    req(CERTS_URL)
    req.invalidate()
    req(CERTS_URL)

    assert len(transport.calls) == 2


def test_expiry_triggers_a_refetch(monkeypatch):
    transport = FakeTransport()
    req = CachingTransportRequest(transport)

    clock = {"now": 1000.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )

    req(CERTS_URL)
    assert len(transport.calls) == 1

    # Still inside the advertised 3600s max-age.
    clock["now"] += 3599
    req(CERTS_URL)
    assert len(transport.calls) == 1

    # Past it.
    clock["now"] += 2
    req(CERTS_URL)
    assert len(transport.calls) == 2


@pytest.mark.parametrize(
    "cache_control,expected_ttl",
    [
        ("public, max-age=3600", 3600),
        ("max-age=60", _MIN_TTL_SECONDS),          # clamped up
        ("max-age=999999", _MAX_TTL_SECONDS),      # clamped down
        ("no-store", _DEFAULT_TTL_SECONDS),        # refuses caching -> default
        ("no-cache", _DEFAULT_TTL_SECONDS),
        ("garbage", _DEFAULT_TTL_SECONDS),
        ("max-age=abc", _DEFAULT_TTL_SECONDS),
        (None, _DEFAULT_TTL_SECONDS),              # header absent
    ],
)
def test_ttl_derived_from_cache_control(monkeypatch, cache_control, expected_ttl):
    headers = {} if cache_control is None else {"cache-control": cache_control}
    transport = FakeTransport(
        responses=[FakeResponse(data=b'{"k":"v"}', headers=headers)]
    )
    req = CachingTransportRequest(transport)

    clock = {"now": 500.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )

    req(CERTS_URL)
    entry_expiry = req.stats()["entries"][CERTS_URL]["expires_in"]
    assert entry_expiry == pytest.approx(expected_ttl, abs=1.0)


def test_stale_entry_served_when_refresh_raises(monkeypatch):
    good = FakeResponse(
        data=json.dumps({"kid1": "cert1"}).encode("utf-8"),
        headers={"cache-control": "max-age=3600"},
    )
    transport = FakeTransport(responses=[good, ConnectionError("network down")])
    req = CachingTransportRequest(transport)

    clock = {"now": 0.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )

    req(CERTS_URL)
    clock["now"] += 4000  # expired, inside the stale grace window

    served = req(CERTS_URL)
    assert json.loads(served.data.decode("utf-8")) == {"kid1": "cert1"}
    assert len(transport.calls) == 2


def test_error_propagates_when_no_cached_copy_exists():
    transport = FakeTransport(responses=[ConnectionError("network down")])
    req = CachingTransportRequest(transport)

    with pytest.raises(ConnectionError):
        req(CERTS_URL)


def test_stale_entry_served_on_upstream_5xx(monkeypatch):
    good = FakeResponse(
        data=json.dumps({"kid1": "cert1"}).encode("utf-8"),
        headers={"cache-control": "max-age=3600"},
    )
    transport = FakeTransport(responses=[good, FakeResponse(status=503, data=b"")])
    req = CachingTransportRequest(transport)

    clock = {"now": 0.0}
    monkeypatch.setattr(
        "app.services.google_certs_cache.time.monotonic", lambda: clock["now"]
    )

    req(CERTS_URL)
    clock["now"] += 4000
    served = req(CERTS_URL)

    assert json.loads(served.data.decode("utf-8")) == {"kid1": "cert1"}


def test_non_200_is_not_cached_on_a_cold_cache():
    transport = FakeTransport(
        responses=[FakeResponse(status=500, data=b""), FakeResponse(status=500, data=b"")]
    )
    req = CachingTransportRequest(transport)

    req(CERTS_URL)
    req(CERTS_URL)

    assert len(transport.calls) == 2, "failed responses must not be cached"


def test_concurrent_cold_start_fetches_once():
    """A burst of parallel requests on a cold cache must collapse to one fetch."""
    barrier = threading.Barrier(8)

    class SlowTransport(FakeTransport):
        def __call__(self, url, method="GET", *args, **kwargs):
            # Hold the fetch open so every thread is definitely in flight.
            import time as _time

            _time.sleep(0.05)
            return super().__call__(url, method=method, *args, **kwargs)

    transport = SlowTransport()
    req = CachingTransportRequest(transport)

    def worker():
        barrier.wait()
        req(CERTS_URL)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(transport.calls) == 1


def test_stats_reports_hits_and_misses():
    transport = FakeTransport()
    req = CachingTransportRequest(transport)

    req(CERTS_URL)
    req(CERTS_URL)
    req(CERTS_URL)

    stats = req.stats()
    assert stats["misses"] == 1
    assert stats["hits"] == 2
    assert CERTS_URL in stats["entries"]
