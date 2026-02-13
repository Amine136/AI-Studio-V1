from abc import ABC, abstractmethod
from typing import Any, Optional

class LLMProvider(ABC):
    """Abstract Base Class for all LLM Providers."""
    
    @abstractmethod
    def generate(self, model_id: str, prompt: str, schema: Optional[Any] = None) -> str:
        """
        Generate text response from the provider.
        
        Args:
            model_id: The specific model identifier (e.g. 'gemini-2.0-flash').
            prompt: The input prompt string.
            schema: Optional Pydantic model for structured output enforcement.
            
        Returns:
            str: The generated text response.
        """
        pass
