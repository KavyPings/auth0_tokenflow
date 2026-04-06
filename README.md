# TokenFlow OS

**Capability-based execution runtime for AI agents** — preventing credential misuse and over-permissioned access via tokenized execution, modeled on the Google Vertex AI "Double Agent" incident.

## What This Project Does

TokenFlow OS is a security testbench and execution platform that demonstrates how capability tokens prevent the exact class of AI security failure exposed by the Vertex AI incident. Every agent action is restricted by a single-use capability token. Cross-service access is blocked. Credentials never leave the vault.

## The Incident: Google Vertex AI "Double Agent" (April 2026)

A flaw in Google Cloud's AI system allowed agents to act as "double agents":
- Attackers extracted **service-account credentials** from the agent runtime
- The AI gained **unauthorized access to internal systems** and customer data
- The agent had **broad standing permissions** — no per-action scoping
- There was **no kill switch** — the agent continued operating until manual intervention
- **Key insight**: The AI did not hack the system; it misused credentials it was already given

## How TokenFlow Prevents This

| Failure Mode | Vertex Impact | TokenFlow Defense |
|---|---|---|
| Credentials in runtime | Agent extracts keys | Vault proxy — agent never sees secrets |
| Over-permissioned agent | Access any service | Per-action token scoping |
| Cross-service movement | GCS → source control → DB | Service scope enforcement |
| No audit trail | Breach undetected hours | Immutable audit + WebSocket alerts |
| No kill switch | Agent continues unimpeded | Kill switch revokes all tokens |
| Credential replay | Stolen cred reused | Burn-after-use + nonce |
| No human review | Agent fully autonomous | Step-up auth + review gates |

## Architecture

```
+────────────────────────────────────────────────────────────────+
│        Mission Control UI (React + Tailwind)                    │
│  landing | dashboard | chain | testbench | upload | security    │
+──────────────────────────┬─────────────────────────────────────+
                           │ REST + WebSocket
                           ▼
+────────────────────────────────────────────────────────────────+
│              TokenFlow API (Node + Express)                      │
│  /api/tokens       mint / consume / revoke / audit / chain      │
│  /api/workflows    start / resume / revoke / kill               │
│  /api/testbench    run scenario / run suite / results           │
│  /api/workflows    upload / templates / schema                  │
│  /api/vault        credentials / status                         │
│  /api/dashboard    operational overview                         │
+───────────┬──────────────┬──────────────┬──────────────────────+
            │              │              │
            ▼              ▼              ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │Policy Engine │ │Workflow Runner│ │ SQLite DB    │
  │scope checks  │ │step execution│ │tokens/audits │
  │service gates │ │replay detect │ │test results  │
  └──────┬───────┘ └──────┬───────┘ └──────────────┘
         │                │
         ▼                ▼
  ┌────────────────────────────────────────────┐
  │  Auth0 Token Vault (credential boundary)   │
  │  Secrets stored here, never in agent       │
  └────────────────────────────────────────────┘
```

## Features

### Capability Token Engine
- **Mint → Activate → Burn** lifecycle for every action
- Single-use tokens with TTL expiry
- Nonce-based replay prevention
- Flagging and revocation

### Policy Engine
- Cross-service isolation enforcement
- Scope escalation detection
- Step ordering validation
- Workflow definition validation (for uploads)

### Credential Vault
- Credentials stored via Auth0 Token Vault (RFC 8693 token exchange)
- Agent never sees raw secrets — vault proxy executes on behalf
- Mock mode for local development

### Workflow Runner
- Executes token-gated workflows step by step
- Supports malicious step injection detection
- Kill switch, pause/resume, human review gates
- Deterministic mode for testing

### Security Testbench
7 pre-built attack/control scenarios with 12 invariant assertions:
1. Normal safe workflow
2. Double Agent credential exfiltration
3. Cross-service lateral movement
4. Replay / token reuse attack
5. Scope escalation attempt
6. Kill switch engagement
7. Human review intervention

**12 assertions verified per scenario:**
- One token = one action
- Burned tokens cannot be reused
- Expired tokens cannot be consumed
- Action matches token scope
- Service matches token context
- Resource scope not exceeded
- Unauthorized steps blocked
- Cross-service movement blocked
- Kill switch stops execution
- Pause/resume/revoke works
- Secrets not exposed in payloads
- Audit log is complete

### Workflow Upload
- JSON-based workflow definitions
- Client-side and server-side validation
- Preview before execution
- Starter templates
- Path traversal protection
- Action/verb consistency enforcement

## Dashboard Pages

| Page | Purpose |
|---|---|
| **Home (Landing)** | Explains the incident, how TokenFlow works, product guide |
| **Dashboard** | Operational overview: workflows, tokens, review queue |
| **Token Chain** | Live token lifecycle visualization with CLI terminal |
| **Security** | Human review panel for flagged violations |
| **Testbench** | Run attack scenarios, verify invariants |
| **Upload** | Upload custom workflow definitions |
| **Incident** | Side-by-side architecture comparison |
| **Launch** | Select and start scenarios |
| **Audit** | Immutable event timeline |
| **Vault** | Credential registry (names only, never values) |

## Run Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update Auth0 values as needed. For local development, `USE_AUTH0=false` runs in mock mode.

### 3. Run the full stack

```bash
npm run dev
```

- API: `http://localhost:8000`
- Frontend: `http://localhost:5173`

### 4. Production build

```bash
npm run build
npm run start
```

## Testing

### Run the security testbench

```bash
node --test server/src/tests/testbench.test.js
```

### Run from the UI

1. Open the app → navigate to **Testbench**
2. Click **Run All 7 Scenarios**
3. Inspect pass/fail results with expected vs actual comparisons

## Workflow Upload Schema

```json
{
  "name": "My Workflow",
  "description": "Optional description",
  "steps": [
    {
      "action": "READ_OBJECT",
      "service": "gcs",
      "resource": "data/input.json",
      "actionVerb": "read"
    },
    {
      "action": "CALL_INTERNAL_API",
      "service": "internal-api",
      "resource": "api/process",
      "actionVerb": "invoke"
    },
    {
      "action": "WRITE_OBJECT",
      "service": "gcs",
      "resource": "output/result.json",
      "actionVerb": "write"
    }
  ]
}
```

**Allowed actions:** `READ_OBJECT`, `CALL_INTERNAL_API`, `WRITE_OBJECT`
**Allowed services:** `gcs`, `internal-api`
**Prohibited services:** `source-control`, `internal-repo`

## Sample Scenarios

| Scenario | Type | What Happens |
|---|---|---|
| Normal Cloud Processing | Safe | All steps complete, tokens burn cleanly |
| Double Agent | Attack | Agent diverts to source-control → BLOCKED |
| Lateral Movement | Attack | Cross-service pivot → BLOCKED |
| Replay Attack | Attack | Burned token reuse → REJECTED |
| Scope Escalation | Attack | Read token used for write → BLOCKED |
| Kill Switch | Control | Workflow halted mid-execution |
| Human Review | Control | Paused at WRITE_OBJECT for approval |

## Assumptions & Limitations

- **Mock mode**: In local dev (`USE_AUTH0=false`), vault credentials are simulated. Real Auth0 Token Vault requires configuration.
- **SQLite**: Uses SQLite for portability. Production deployments should consider PostgreSQL.
- **In-memory execution**: Workflows run in-process with `setTimeout` delays. Not suitable for long-running production workflows.
- **No persistent auth**: The dashboard doesn't require login in dev mode. Auth0 middleware is wired but permissive when `USE_AUTH0=false`.
- **Deterministic tests**: Testbench uses fast mode (100ms delays). Timing-sensitive assertions may behave differently under load.

## Deployment

### Option A — Full-Stack on Render (Recommended)

Render runs the Express backend which serves the built React frontend and handles WebSocket connections. This is the simplest path.

1. **Push to GitHub**
2. **Create a Web Service on Render**:
   - Connect your GitHub repo
   - Render auto-detects `render.yaml` — verify the settings
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
3. **Set environment variables** in the Render dashboard:
   - All Auth0 vars (`AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, etc.)
   - `FRONTEND_ORIGIN` → your Render URL (e.g. `https://tokenflow-os.onrender.com`)
   - `NODE_ENV` → `production`
   - `USE_AUTH0` → `true` or `false`
4. Deploy — Render builds the Vite frontend, then starts Express which serves it.

### Option B — Frontend on Vercel + Backend on Render

Use this if you want Vercel's CDN for the frontend while running the backend on Render.

**Backend (Render)** — same as Option A above.

**Frontend (Vercel)**:
1. Import the repo into Vercel
2. Vercel auto-detects `vercel.json`
3. Set these environment variables in Vercel's dashboard:
   - `VITE_API_BASE_URL` → your Render backend URL (e.g. `https://tokenflow-os.onrender.com`)
   - `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_AUTH0_SCOPE`
4. Set `FRONTEND_ORIGIN` on Render to include your Vercel URL for CORS:
   - e.g. `https://tokenflow-os.vercel.app`
5. Update Auth0 allowed callback/logout URLs to include both Render and Vercel domains.

### Environment Variables Reference

| Variable | Where | Description |
|---|---|---|
| `PORT` | Render | Server port (Render uses 10000) |
| `NODE_ENV` | Render | `production` |
| `DATABASE_URL` | Render | `./tokenflow.db` (SQLite, ephemeral on free tier) |
| `FRONTEND_ORIGIN` | Render | Comma-separated allowed CORS origins |
| `AUTH0_DOMAIN` | Render | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | Render | Auth0 API audience |
| `AUTH0_CLIENT_ID` | Render | Auth0 app client ID |
| `AUTH0_CLIENT_SECRET` | Render | Auth0 app client secret |
| `USE_AUTH0` | Render | `true` for live auth, `false` for mock |
| `VITE_API_BASE_URL` | Vercel | Backend URL (only for split deploy) |
| `VITE_AUTH0_DOMAIN` | Vercel | Auth0 tenant domain |
| `VITE_AUTH0_CLIENT_ID` | Vercel | Auth0 app client ID |

> **Note on SQLite**: Render's free tier uses ephemeral storage — the database resets on redeploy. For persistent data, upgrade to a paid Render plan with a persistent disk, or migrate to PostgreSQL.

