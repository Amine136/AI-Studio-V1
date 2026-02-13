# 🚀 NovaNode AI Studio

A premium, AI-powered creative studio for generating high-engagement social media content. **NovaNode AI Studio** uses advanced LLMs and image generation models to transform simple ideas into polished assets with a professional workflow.
*

## ✨ Key Features

- **3-Step Intelligent Workflow**: 
  1. **Analyze**: AI extracts intent, platform, and artistic settings from your idea.
  2. **Review**: Fine-tune obligatory settings and explore hidden AI suggestions.
  3. **Generate**: Production-ready captions and images delivered in seconds.
- **Premium UI/UX**: Modern dark-themed design with Glassmorphism, smooth micro-animations, and a responsive layout.
- **Hidden Params System**: Backend-only AI summarization and language detection for higher-quality generation prompts.
- **Multi-Model Support**: Easily switch between Google Gemini, OpenAI, and OpenRouter providers.
- **Privacy First**: Raw user ideas are summarized and optimized locally on the backend before being sent to generation APIs.

## 🛠️ Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Axios.
- **Backend**: FastAPI, LangGraph for orchestration, Pydantic for schema enforcement.
- **AI Providers**: Google (Gemini), OpenAI (DALL-E), OpenRouter.

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- Node.js 20+
- API Keys for Google/OpenAI/OpenRouter

### Backend Setup
1. Navigate to `backend/`.
2. Create a `.env` file with your API keys.
3. Install dependencies: `pip install -r requirements.txt`.
4. Run the server: `python main.py` (Default: `http://127.0.0.1:8000`).

### Frontend Setup
1. Navigate to `frontend/`.
2. Install dependencies: `npm install`.
3. Run the development server: `npm run dev` (Default: `http://127.0.0.1:3000`).

## 📁 Repository Structure

```text
├── backend/                # FastAPI logic and LangGraph workflow
│   ├── app/
│   │   ├── core/           # Schema and state management
│   │   ├── graph/          # Workflow nodes and plugin system
│   │   ├── services/       # LLM and Image client implementations
│   │   └── data/           # Configs and prompt templates
├── frontend/               # Next.js application
│   ├── src/
│   │   ├── app/            # App router, layout and styles
│   │   ├── components/     # Reusable UI components
│   │   └── services/       # API client
```

## 📜 License
© 2026 NovaNode. All rights reserved.
