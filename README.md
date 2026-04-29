# GoPhish Analyzer

Web-based dashboard for analyzing GoPhish phishing campaign results. Supports live GoPhish API integration and CSV report imports.

## Quick Start (Docker)

```bash
docker build -t gophish-analyzer:latest .

docker run -d \
  --name gophish-analyzer \
  --restart unless-stopped \
  -p 51337:3000 \
  -v gophish-analyzer-data:/app/data \
  -e CLIENT_NAME="PT Example Corp" \
  -e AUTH_USER=admin \
  -e AUTH_PASS=secret \
  -e GOPHISH_API_KEY=your_api_key \
  -e GOPHISH_SERVER_URL=https://172.17.0.1:3333 \
  gophish-analyzer:latest
```

Access: `http://your-server:51337`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLIENT_NAME` | *(empty)* | Client name shown in navbar |
| `AUTH_USER` | `admin` | Dashboard login username |
| `AUTH_PASS` | `secret` | Dashboard login password |
| `GOPHISH_API_KEY` | *(empty)* | GoPhish REST API key |
| `GOPHISH_SERVER_URL` | *(empty)* | GoPhish admin URL (e.g. `https://172.17.0.1:3333`) |
| `IPINFO_TOKEN` | *(empty)* | IPinfo.io token for IP geolocation |
| `PORT` | `3000` | Internal server port |

## Features

- **Dashboard** — Phishing funnel stats, per-scenario charts, summary tables
- **GoPhish Live** — Real-time campaign timeline via GoPhish API
- **CSV Reports** — Import and analyze CSV exports from GoPhish
- **Authentication** — Cookie-based login with env var credentials
- **Export** — XLSX export per project
- **Shareable Links** — Public read-only dashboard links

## Architecture

Each Docker instance = 1 client engagement. Projects within represent assessment phases (Pre-Phishing, Post-Phishing, etc.).

```
Docker Instance (CLIENT_NAME="PT ABL")
├── Project: Pre-Phishing
│   ├── Dashboard (stats overview)
│   ├── GoPhish Live (API timeline)
│   └── CSV Reports (imported scenarios)
└── Project: Post-Phishing
    ├── Dashboard
    ├── GoPhish Live
    └── CSV Reports
```

## Local Development

```bash
npm install
cp .env.example .env
node server.js
```
