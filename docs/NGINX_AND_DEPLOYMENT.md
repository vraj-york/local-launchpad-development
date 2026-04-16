🧩 Nginx setup (UAT & Production)
Nginx is inside the backend container (not separate).
It:
Handles HTTPS (443) with SSL
Routes:
/api → Node backend (5000)
/ → frontend (static SPA via serve)
/iframe-preview/ → Node
Manages project subdomains → proxies to dynamic ports (127.0.0.1:<port>)

👉 UAT and Production are same setup, only env variables differ (domain, DB, secrets).

💻 Local development (ngrok usage)
You don’t need ngrok for normal dev (npm start / dev)
You only need it for testing webhooks (GitHub/Bitbucket)
Case	Need ngrok?
Normal dev	❌ No
Webhook testing	✅ Yes (npm run dev:ngrok)
Production/UAT	❌ No
NGROK_AUTHTOKEN → required locally (in .env, gitignored)
NGROK_URL → auto-set by script (or manual if using CLI)
🔗 Webhook callback URL priority

When registering webhooks, backend picks URL in this order:

NGROK_URL → FRONTEND_URL → VITE_FRONTEND_URL → BASE_URL (many backends only set `VITE_FRONTEND_URL` from repo-root `.env`; that is enough)
🧾 Commit logs
When a webhook push is received:
Logs: [client-link:commit]
Source: scm-webhook or branch-tip-poll