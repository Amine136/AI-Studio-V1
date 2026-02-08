from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal
from app.core.state import ContentSpec
from app.config import settings

OutputType = Literal["caption", "image"]

@dataclass
class OutputPlugin:
    """Base class for output generators."""
    name: OutputType
    required_fields: List[str] = field(default_factory=list)
    optional_fields: List[str] = field(default_factory=list)

    def get_valid_options(self, key: str) -> List[str]:
        """Retrieves valid options for a field from the JSON config."""
        return settings.field_options.get(self.name, {}).get(key, [])

    def build_requests(self, spec: ContentSpec) -> List[Dict[str, Any]]:
        raise NotImplementedError

# ==========================================
#        Concrete Plugins
# ==========================================

class CaptionPlugin(OutputPlugin):
    def __init__(self):
        config_keys = list(settings.field_options.get("caption", {}).keys())
        super().__init__(
            name="caption",
            required_fields=["platform", "brand_voice", "language", "goal"],
            optional_fields=[k for k in config_keys if k not in ["platform", "brand_voice", "language", "goal"]]
        )

    def build_requests(self, spec: ContentSpec) -> List[Dict[str, Any]]:
        # 1. Build Constraints String
        constraint_lines = []
        for key in settings.field_options.get("caption", {}).keys():
            if val := spec.get(key):
                label = key.replace("_", " ").title()
                constraint_lines.append(f"- {label}: {val}")
        
        constraints_str = "\n".join(constraint_lines)

        # 2. Load & Format Prompt
        template = settings.prompts.get("caption_gen", "Idea: {user_text}. Return JSON.")
        
        full_prompt = template.format(
            user_text=spec.get('user_text', ''),
            constraints=constraints_str
        )

        return [{
            "output_key": "caption",
            "type": "llm",
            "prompt": full_prompt
        }]


class ImagePlugin(OutputPlugin):
    def __init__(self):
        config_keys = list(settings.field_options.get("image", {}).keys())
        super().__init__(
            name="image",
            required_fields=["aspect_ratio", "medium", "main_subject"],
            optional_fields=[k for k in config_keys if k not in ["aspect_ratio", "medium", "main_subject"]]
        )

    def build_requests(self, spec: ContentSpec) -> List[Dict[str, Any]]:
        controls = []
        image_config = settings.field_options.get("image", {})
        
        for key in image_config.keys():
            if key == "aspect_ratio": continue 
            if val := spec.get(key):
                controls.append(val)

        technical_prefix = ", ".join(controls)
        subject = spec.get('main_subject') or spec.get('user_text')
        
        # 1. Load & Format Template
        template = settings.prompts.get("image_gen", "{technical_prefix}. {subject}.")
        
        # Simple cleanup if prefix is empty to avoid leading dots
        full_prompt = template.format(
            technical_prefix=technical_prefix,
            subject=subject
        )
        
        # Clean double dots if technical_prefix was empty
        if full_prompt.startswith(". "): 
            full_prompt = full_prompt[2:]

        return [{
            "output_key": "image",
            "type": "image",
            "prompt": full_prompt,
            "metadata": {
                "aspect_ratio": spec.get("aspect_ratio", "16:9"),
                "params_used": controls
            }
        }]

# Singleton Registry
PLUGIN_REGISTRY: Dict[OutputType, OutputPlugin] = {
    "caption": CaptionPlugin(),
    "image": ImagePlugin(),
}