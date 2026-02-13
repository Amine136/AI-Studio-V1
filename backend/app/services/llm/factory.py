from typing import Dict, Type
from app.services.llm.base import LLMProvider
from app.services.llm.providers.google import GoogleProvider
from app.services.llm.providers.openai import OpenAIProvider
from app.services.llm.providers.mock import MockProvider
from app.services.llm.providers.openrouter import OpenRouterProvider

class LLMFactory:
    """Registry for LLM Providers."""
    _providers: Dict[str, Type[LLMProvider]] = {}

    @classmethod
    def register(cls, name: str, provider_cls: Type[LLMProvider]):
        cls._providers[name] = provider_cls

    @classmethod
    def get_provider(cls, name: str) -> LLMProvider:
        provider_cls = cls._providers.get(name)
        if not provider_cls:
            # Fallback to Mock if provider unknown
            print(f"⚠️ Unknown provider '{name}', falling back to 'mock'")
            return cls._providers.get("mock", MockProvider)()
            
        return provider_cls()

# Register default providers
LLMFactory.register("google", GoogleProvider)
LLMFactory.register("openai", OpenAIProvider)
LLMFactory.register("openrouter", OpenRouterProvider)
LLMFactory.register("mock", MockProvider)
