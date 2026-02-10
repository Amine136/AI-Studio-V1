import re
import logging

logger = logging.getLogger("studio.security")

# Patterns that indicate prompt injection attempts
INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"ignore\s+(all\s+)?above",
    r"disregard\s+(all\s+)?previous",
    r"forget\s+(all\s+)?(your\s+)?instructions",
    r"you\s+are\s+now\s+a",
    r"act\s+as\s+(a\s+)?different",
    r"new\s+instructions?:",
    r"system\s*prompt:",
    r"<\s*system\s*>",
    r"\[\s*system\s*\]",
    r"ADMIN\s*OVERRIDE",
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in INJECTION_PATTERNS]


def sanitize_user_text(text: str) -> str:
    """
    Sanitizes user input before it reaches LLM prompts.
    - Strips injection patterns
    - Limits special characters
    - Returns cleaned text
    """
    cleaned = text

    for pattern in COMPILED_PATTERNS:
        if pattern.search(cleaned):
            logger.warning(f"⚠️ Prompt injection attempt detected: '{pattern.pattern}'")
            cleaned = pattern.sub("", cleaned)

    # Remove excessive whitespace left after stripping
    cleaned = re.sub(r'\s{3,}', '  ', cleaned).strip()

    return cleaned
