import urllib.parse
import os
import uuid
import httpx
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
IMAGES_DIR = BASE_DIR / "generated_images"
IMAGES_DIR.mkdir(exist_ok=True)

# --- CONFIG ---
# In production, put this in your .env file!
CLOUDFLARE_API_URL = "https://mute-fog-5d03.ounimed019.workers.dev"
CLOUDFLARE_AUTH_TOKEN = "12547854" 

def generate_image_url(provider: str, model_id: str, prompt: str) -> str:
    if provider == "cloudflare":
        return _generate_via_cloudflare(model_id, prompt)
    elif provider == "pollinations":
        return _generate_via_pollinations(model_id, prompt)
    elif provider == "openai":
        return _generate_via_openai(model_id, prompt)
    elif provider == "mock":
        return _generate_mock(model_id, prompt)
    else:
        raise ValueError(f"Unknown Image Provider: {provider}")


def _generate_via_cloudflare(model_id: str, prompt: str) -> str:
    """
    Sends POST request to your custom Cloudflare Worker.
    """
    filename = f"{uuid.uuid4()}.jpg"
    save_path = IMAGES_DIR / filename

    print(f"⚡ Cloudflare: Generating '{prompt[:30]}...' with {model_id}")

    try:
        headers = {
            "Authorization": f"Bearer {CLOUDFLARE_AUTH_TOKEN}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model_id,
            "prompt": prompt
        }

        with httpx.Client(timeout=60.0) as client:
            response = client.post(CLOUDFLARE_API_URL, json=payload, headers=headers)
            response.raise_for_status() # Raises error if status != 200
            
            # The worker returns raw image bytes
            with open(save_path, "wb") as f:
                f.write(response.content)

        print(f"✅ Saved to: {save_path}")
        return f"http://127.0.0.1:8000/images/{filename}"

    except Exception as e:
        print(f"❌ Cloudflare Generation Failed: {e}")
        return f"Error: {str(e)}"


def _generate_via_pollinations(model_id: str, prompt: str) -> str:
    # ... (Keep your existing Pollinations logic here) ...
    # Copy the Robust Logic from the previous step
    safe_prompt = urllib.parse.quote(prompt)
    filename = f"{uuid.uuid4()}.jpg"
    save_path = IMAGES_DIR / filename
    
    strategies = [
        {"model": model_id, "params": "&nologo=true"},
        {"model": "flux", "params": "&nologo=true"},
        {"model": "turbo", "params": ""}
    ]

    headers = {"User-Agent": "Mozilla/5.0 (AI Studio V1 bot)"}

    for attempt, strategy in enumerate(strategies):
        current_model = strategy["model"]
        seed = uuid.uuid4().int % 10000
        url = f"https://image.pollinations.ai/prompt/{safe_prompt}?model={current_model}&seed={seed}{strategy['params']}"
        
        try:
            with httpx.Client(timeout=45.0, follow_redirects=True) as client:
                response = client.get(url, headers=headers)
                response.raise_for_status()
                with open(save_path, "wb") as f:
                    f.write(response.content)
            return f"http://127.0.0.1:8000/images/{filename}"
        except Exception as e:
            print(f"⚠️ Attempt {attempt+1} failed: {e}")
            time.sleep(1)
            continue
            
    return f"https://image.pollinations.ai/prompt/{safe_prompt}?model={model_id}"

def _generate_via_openai(model_id: str, prompt: str) -> str:
    return f"https://fake-openai-url.com/{model_id}/{urllib.parse.quote(prompt)[:10]}"

def _generate_mock(model_id: str, prompt: str) -> str:
    return f"https://mock-backend.local/image?model={model_id}&prompt={urllib.parse.quote(prompt)}"