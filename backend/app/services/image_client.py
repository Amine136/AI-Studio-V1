import urllib.parse
import os
import uuid
import base64
import httpx
import time
from pathlib import Path

from google import genai
from google.genai import types

BASE_DIR = Path(__file__).resolve().parent.parent.parent
IMAGES_DIR = BASE_DIR / "generated_images"
IMAGES_DIR.mkdir(exist_ok=True)

# --- CONFIG ---
# In production, put this in your .env file!
CLOUDFLARE_API_URL = "https://mute-fog-5d03.ounimed019.workers.dev"
CLOUDFLARE_AUTH_TOKEN = "12547854" 

# Maps display labels like "21:9 (Ultrawide)" to clean API ratios
def _parse_aspect_ratio(raw: str) -> str:
    """Extract clean aspect ratio from display label."""
    if not raw:
        return "1:1"
    # Strip description in parentheses: "16:9 (Cinematic / YouTube)" -> "16:9"
    clean = raw.split("(")[0].strip()
    # Validate format
    if ":" in clean:
        return clean
    return "1:1"


def generate_image_url(provider: str, model_id: str, prompt: str, model_type: str = "", image_config: dict = None) -> str:
    if image_config is None:
        image_config = {}
    
    if provider == "google":
        if model_type == "imagen":
            return _generate_via_imagen(model_id, prompt, image_config)
        else:
            return _generate_via_nanobanana(model_id, prompt, image_config)
    elif provider == "cloudflare":
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
        print(f"image prompt: {prompt}")
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


# ---------------------------------------------------------
# Google Nanobanana (Gemini image generation via generate_content)
# ---------------------------------------------------------

def _generate_via_nanobanana(model_id: str, prompt: str, image_config: dict = None) -> str:
    """
    Uses Gemini models that support image generation through generate_content.
    Models: gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview
    """
    if image_config is None:
        image_config = {}

    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", ""))
    filename = f"{uuid.uuid4()}.png"
    save_path = IMAGES_DIR / filename

    print(f"🍌 Nanobanana: Generating '{prompt[:40]}...' with {model_id} | aspect={aspect_ratio}")

    # Nanobanana models accept aspect ratio as part of the text prompt
    aspect_prompt = f"{prompt}. Aspect ratio: {aspect_ratio}."

    try:
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            return "Error: No GOOGLE_API_KEY configured"

        client = genai.Client(api_key=api_key)

        response = client.models.generate_content(
            model=model_id,
            contents=[aspect_prompt],
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE", "TEXT"],
            ),
        )

        # Extract image from response parts
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.mime_type.startswith("image/"):
                image_bytes = part.inline_data.data
                with open(save_path, "wb") as f:
                    f.write(image_bytes)

                print(f"✅ Nanobanana saved to: {save_path}")
                return f"http://127.0.0.1:8000/images/{filename}"

        return "Error: No image data in Gemini response"

    except Exception as e:
        print(f"❌ Nanobanana Generation Failed: {e}")
        return f"Error: {str(e)}"


# ---------------------------------------------------------
# Google Imagen (dedicated image generation via generate_images)
# ---------------------------------------------------------

# Imagen API only supports these aspect ratios
IMAGEN_VALID_RATIOS = {"1:1", "3:4", "4:3", "9:16", "16:9"}

def _generate_via_imagen(model_id: str, prompt: str, image_config: dict = None) -> str:
    """
    Uses Imagen models with the dedicated generate_images API.
    Models: imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001, imagen-4.0-generate-001
    """
    if image_config is None:
        image_config = {}

    aspect_ratio = _parse_aspect_ratio(image_config.get("aspect_ratio", ""))
    
    # Imagen API only supports specific ratios — fallback to closest match
    if aspect_ratio not in IMAGEN_VALID_RATIOS:
        print(f"⚠️ Imagen: '{aspect_ratio}' not supported, falling back to '16:9'")
        aspect_ratio = "16:9"

    filename = f"{uuid.uuid4()}.png"
    save_path = IMAGES_DIR / filename

    print(f"🖼️ Imagen: Generating '{prompt[:40]}...' with {model_id} | aspect={aspect_ratio}")

    try:
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            return "Error: No GOOGLE_API_KEY configured"

        client = genai.Client(api_key=api_key)

        response = client.models.generate_images(
            model=model_id,
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio=aspect_ratio,
            ),
        )

        # Save the first generated image
        if response.generated_images and len(response.generated_images) > 0:
            image_data = response.generated_images[0].image.image_bytes
            with open(save_path, "wb") as f:
                f.write(image_data)

            print(f"✅ Imagen saved to: {save_path}")
            return f"http://127.0.0.1:8000/images/{filename}"

        return "Error: No images returned from Imagen API"

    except Exception as e:
        print(f"❌ Imagen Generation Failed: {e}")
        return f"Error: {str(e)}"