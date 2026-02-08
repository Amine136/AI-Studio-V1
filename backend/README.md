# AI Studio V1 - Backend

A powerful AI-driven content generation API built with **FastAPI** and **LangGraph** for orchestrating multi-step AI workflows.

## 🚀 Features

- **🎨 AI Image Generation** - Generate visuals using Cloudflare Stable Diffusion
- **✍️ Caption Generation** - Create engaging captions with Google Gemini
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
│   │   ├── llm_client.py    # LLM provider integrations
│   │   └── image_client.py  # Image generation integrations
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
GOOGLE_API_KEY=your_gemini_api_key
CLOUDFLARE_ACCOUNT_ID=your_cf_account_id
CLOUDFLARE_API_TOKEN=your_cf_api_token

# Optional: Override default models
SYSTEM_LLM_MODEL=gemini-2.5-flash
FALLBACK_LLM_MODEL=gemini-2.5-flash-lite
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


## 📝 License

Owned by NovaNode TN.
