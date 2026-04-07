module.exports = {
  apps: [
    {
      name: "ai-studio-backend",
      cwd: "/home/ouni/AI-Studio-V1/backend",
      script: "/home/ouni/AI-Studio-V1/backend/.venv/bin/gunicorn",
      args: [
        "-k", "uvicorn.workers.UvicornWorker",
        "-w", "4",
        "-b", "127.0.0.1:8010",
        "app.main:app",
      ],
      interpreter: "none",
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      env: {
        PYTHONUNBUFFERED: "1",
      },
    },
  ],
};
