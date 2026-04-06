# Vibecraft Backend

A FastAPI + LangGraph backend that orchestrates multi-step content generation while delegating all model/provider calls to **ApiKeyManager**.

## 🚀 Features

- **🎨 AI Image Generation** - Generate visuals via ApiKeyManager-managed providers
- **✍️ Caption Generation** - Generate text via ApiKeyManager-managed providers
- **🔄 LangGraph Workflows** - Multi-step AI orchestration with human-in-the-loop review
- **🔌 Plugin Architecture** - Easily extensible for new output types (video, audio, etc.)
- **📖 Auto-generated API Docs** - Swagger UI at `/docs`

## 📁 Project Structure

```
backend/
├── app/
│   ├── main.py              # FastAPI app & endpoints
│   ├── config.py            # Settings & environment config
│   ├── core/
│   │   ├── schema.py        # Pydantic models
│   │   └── state.py         # LangGraph state definitions
│   ├── graph/
│   │   ├── workflow.py      # LangGraph workflow definition
│   │   ├── nodes.py         # Workflow step implementations
│   │   └── plugins.py       # Output type plugins (caption, image)
│   ├── services/
│   │   ├── llm_client.py    # Text generation wrapper over ApiKeyManager
│   │   └── image_client.py  # Image generation wrapper over ApiKeyManager
│   └── data/
│       ├── field_options.json   # UI dropdown options
│       ├── model_catalog.json   # Available AI models
│       └── prompts/             # Prompt templates
├── generated_images/        # Output directory for images
├── requirements.txt
├── Dockerfile
└── .env
```

## 🛠️ Setup

### 1. Clone & Install

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

Create a `.env` file:

```env
APIKEYMANAGER_BASE_URL=http://127.0.0.1:3000
APIKEYMANAGER_TOKEN=your_apikeymanager_token
APIKEYMANAGER_TIMEOUT=120

# Optional: Override intent-analysis models
SYSTEM_LLM_MODEL=gemini-3.1-flash-lite-preview
FALLBACK_LLM_MODEL=gemini-3-flash-preview
```

### 3. Run the Server

```bash
uvicorn app.main:app --reload --port 8000
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/config` | Get available options & models |
| POST | `/generate` | Generate content (images, captions) |
| GET | `/images/{filename}` | Serve generated images |

### API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🔄 Workflow

The generation workflow uses LangGraph with 6 steps:

```
1. INGEST      → Parse user input
2. ASSIGN      → Select AI models
3. ANALYZE     → Extract intent with LLM
4. PREPARE UI  → Build review schema
   ↓
   [User Review] → User approves/modifies settings
   ↓
5. BUILD PLAN  → Create generation requests
6. EXECUTE     → Run AI generation
7. DELIVER     → Format response
```


## Notes

This backend no longer calls provider SDKs directly. Provider authorization,
key rotation, and model access are handled by ApiKeyManager.
