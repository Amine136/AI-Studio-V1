"""Shared image downscaling for every generation path (smart content creation
/generate, plain chat, packs).

Phone photos are routinely 10-16 MP; base64-encoding them overflows the AKM
gateway body limit (Fastify, default 1 MiB bodyLimit -> HTTP 413 "Request body
is too large"). Shrinking here keeps requests small (also cheaper + faster) - the
image models never need more than ~1.5K px. base64 inflates ~1.33x, so a ~700 KB
raw budget -> ~933 KB base64 stays under 1 MiB even with the JSON envelope. The
budget is SPLIT across the images in a request (per-image cap = total / N) so 2-3
references combined still fit, because the 413 is on the whole body, not per
image. Transparency is preserved (alpha -> PNG). Best-effort: any failure returns
the original bytes/mime so a quirk never blocks a generation that would work.
"""
from __future__ import annotations

PROVIDER_IMAGE_MAX_DIM = 1536
PROVIDER_TOTAL_IMAGE_BUDGET = 700_000
PROVIDER_MIN_IMAGE_BUDGET = 120_000


def per_image_output_cap(image_count: int) -> int:
    """The per-image byte ceiling so N images together fit the request budget."""
    n = max(1, int(image_count or 1))
    return max(PROVIDER_MIN_IMAGE_BUDGET, PROVIDER_TOTAL_IMAGE_BUDGET // n)


def downscale_image_for_provider(
    image_bytes: bytes,
    mime_type: str,
    *,
    max_dim: int = PROVIDER_IMAGE_MAX_DIM,
    output_cap: int = PROVIDER_TOTAL_IMAGE_BUDGET,
) -> tuple[bytes, str]:
    """Shrink an oversized upload so its encoded bytes fit the AKM body limit.

    Small in-spec images pass through byte-for-byte; larger ones are resized
    (longest side <= ``max_dim``) and re-encoded, then iteratively reduced
    (quality, then dimension) until under ``output_cap``.
    """
    try:
        import io

        from PIL import Image  # lazy: only needed for oversized uploads

        with Image.open(io.BytesIO(image_bytes)) as opened:
            width, height = opened.size
            if len(image_bytes) <= output_cap and max(width, height) <= max_dim:
                return image_bytes, mime_type
            has_alpha = opened.mode in ("RGBA", "LA") or (opened.mode == "P" and "transparency" in opened.info)
            base = opened.convert("RGBA" if has_alpha else "RGB")

        dim = min(max_dim, max(width, height))
        result = image_bytes
        result_mime = mime_type
        for attempt in range(7):
            scale = min(1.0, dim / float(max(width, height) or 1))
            frame = base if scale >= 1.0 else base.resize(
                (max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS
            )
            out = io.BytesIO()
            if has_alpha:
                frame.save(out, format="PNG", optimize=True)
                result_mime = "image/png"
            else:
                quality = max(55, 85 - attempt * 6)
                frame.save(out, format="JPEG", quality=quality, optimize=True)
                result_mime = "image/jpeg"
            result = out.getvalue()
            if len(result) <= output_cap or dim <= 384:
                break
            dim = int(dim * 0.8)
        return result, result_mime
    except Exception:
        return image_bytes, mime_type
