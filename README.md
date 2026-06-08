# 🚀 Vibecraft

A premium, AI-powered creative studio for generating high-engagement social media content and stunning imagery. **Vibecraft** uses advanced LLMs and image generation models to transform simple ideas into polished assets with a professional workflow.

## ✨ Key Features

- **Intelligent Workflow**: 
  1. **Analyze**: AI extracts intent, platform, and artistic settings from your idea.
  2. **Review**: Fine-tune obligatory settings and explore hidden AI suggestions.
  3. **Generate**: Production-ready captions and images delivered in seconds.
- **Premium UI/UX**: Modern dark-themed design with Glassmorphism, smooth micro-animations, HSL-tailored colors, and a highly responsive layout.
- **Credit & Authentication System**: Google OAuth integration via Firebase, with secure credit packages and Meta Pixel/Google Analytics 4 tracking.
- **Multi-Model Support**: Easily switch between Google Gemini, OpenAI, Anthropic, Mistral, and Groq providers via the robust Admin Panel.
- **Automated CI/CD**: Full GitHub Actions pipeline for zero-downtime deployments to both Staging and Production VPS environments.

## 🛠️ Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Axios.
- **Backend**: FastAPI, LangGraph for orchestration, Pydantic for schema enforcement.
- **Database / Auth**: PostgreSQL (Local VPS), Firebase Authentication.
- **Deployment**: Google Compute Engine, PM2, GitHub Actions.

## 🚀 Environment Architecture

Vibecraft operates on a strict staging-first validation flow.

- **Staging Environment**: `testvibecraft.ouni.space`
- **Production Environment**: `vibecraft.ouni.space`
- **Admin Panel**: `adminvibecraft.ouni.space`

The **ApiKeyManager** service runs independently, syncing catalog availability across staging and production via secure webhooks.

## 💻 Getting Started

### Prerequisites
- Python 3.10+
- Node.js 20+
- Environment variables configured (Postgres, Firebase, API Keys)

### Backend Setup
1. Navigate to `backend/`.
2. Create a `.env` file with your credentials.
3. Install dependencies: `pip install -r requirements.txt`.
4. Run the server: `python main.py`

### Frontend Setup
1. Navigate to `frontend/`.
2. Install dependencies: `npm install`.
3. Run the development server: `npm run dev`

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
│   │   └── lib/            # Utilities and external link handling
```

## 📜 License
© 2026 Vibecraft. All rights reserved.
