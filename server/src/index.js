import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db/database.js';
import { initWebSocket } from './websocket/wsServer.js';
import tokenRoutes from './routes/tokenRoutes.js';
import workflowRoutes from './routes/workflowRoutes.js';
import vaultRoutes from './routes/vaultRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import testbenchRoutes from './routes/testbenchRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_DIST_PATH = resolve(__dirname, '..', '..', 'client', 'dist');

const app = express();
const PORT = process.env.PORT || 5000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Always include the Vercel frontend as an allowed origin.
// FRONTEND_ORIGIN on Render can be set to add more (comma-separated).
const HARDCODED_ORIGINS = [
  'https://auth0-tokenflow-server-6yvo.vercel.app',
  'https://auth0-tokenflow-server-git-master-kavypings-projects.vercel.app',
];
const FRONTEND_ORIGINS = [
  ...HARDCODED_ORIGINS,
  ...(process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (health checks, server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    if (FRONTEND_ORIGINS.includes(origin)) return callback(null, true);
    // Allow all origins in production as a final fallback
    if (IS_PRODUCTION) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));


// Trust proxy headers on Render / Vercel
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'TokenFlow OS',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    auth0: process.env.USE_AUTH0 === 'true' ? 'connected' : 'mock',
  });
});

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/workflows', uploadRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/testbench', testbenchRoutes);

if (existsSync(CLIENT_DIST_PATH)) {
  app.use(express.static(CLIENT_DIST_PATH));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(resolve(CLIENT_DIST_PATH, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TokenFlow OS</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #020617 0%, #111827 100%);
        color: #e2e8f0;
        font-family: ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(820px, calc(100vw - 48px));
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(2, 6, 23, 0.9);
        padding: 32px;
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.55);
      }
      h1 { margin: 0 0 16px; font-size: 48px; }
      p { color: #94a3b8; line-height: 1.7; }
      code { color: #67e8f9; }
    </style>
  </head>
  <body>
    <main>
      <h1>TokenFlow OS backend is live.</h1>
      <p>The React mission-control frontend has not been built yet in this environment.</p>
      <p>Run <code>npm run build</code> for a production bundle or <code>npm run dev</code> for the full local stack.</p>
    </main>
  </body>
</html>`);
  });
}

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

const server = createServer(app);

getDb();
initWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==================================================');
  console.log(`  TokenFlow OS v2.0`);
  console.log(`  Environment: ${IS_PRODUCTION ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log(`  Listening on 0.0.0.0:${PORT}`);
  console.log(`  WebSocket on ws://0.0.0.0:${PORT}/ws`);
  console.log(`  Auth0: ${process.env.USE_AUTH0 === 'true' ? 'LIVE' : 'MOCK MODE'}`);
  console.log('==================================================');
  console.log('');
});

process.on('SIGTERM', () => {
  console.log('[SERVER] SIGTERM received, shutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SERVER] SIGINT received, shutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
});
