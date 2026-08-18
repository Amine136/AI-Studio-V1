import os
import boto3
from botocore.config import Config

R2_S3_ENDPOINT = os.getenv("R2_S3_ENDPOINT", "https://7d4afa7795d8e35f6bc191e1727db897.r2.cloudflarestorage.com")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "f7e44a1393b6847c71d61bd76c75c4f7")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "422e4693b08acec2d50bb80f05dd8f73007f4be7d1dd8b7c75a46d368fa07cdd")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "vibecraft-media")
R2_PUBLIC_URL = os.getenv("R2_PUBLIC_URL", "https://pub-64bf9ef2292c49f0a2053981c85e16d9.r2.dev")


def get_r2_client():
    if not (R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_S3_ENDPOINT):
        return None
    try:
        return boto3.client(
            "s3",
            endpoint_url=R2_S3_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
    except Exception as exc:
        print(f"⚠️ R2 client initialization error: {exc}")
        return None


def upload_to_r2(file_bytes: bytes, key: str, mime_type: str = "application/octet-stream") -> str | None:
    client = get_r2_client()
    if not client:
        return None
    try:
        client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=file_bytes,
            ContentType=mime_type,
        )
        return f"{R2_PUBLIC_URL.rstrip('/')}/{key.lstrip('/')}"
    except Exception as exc:
        print(f"⚠️ R2 upload warning for {key}: {exc}")
        return None


def download_from_r2(key: str) -> bytes | None:
    """Return an object from R2 without exposing its public URL.

    The application serves user files through authenticated API routes. Keeping
    this read server-side preserves that ownership check when Cloud Run's local
    filesystem has been discarded after an instance restart.
    """
    client = get_r2_client()
    if not client:
        return None
    try:
        response = client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
        return response["Body"].read()
    except Exception as exc:
        print(f"⚠️ R2 download warning for {key}: {exc}")
        return None


def delete_from_r2(key: str) -> bool:
    """Delete an object from Cloudflare R2 bucket."""
    client = get_r2_client()
    if not client:
        return False
    try:
        client.delete_object(Bucket=R2_BUCKET_NAME, Key=key)
        return True
    except Exception as exc:
        print(f"⚠️ R2 delete warning for {key}: {exc}")
        return False

