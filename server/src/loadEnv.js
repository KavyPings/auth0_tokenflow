import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load root .env first, then server-level .env (override: false means
// existing env vars — e.g. from Render/Vercel dashboard — always win).
const rootEnv = resolve(__dirname, '..', '..', '.env');
const serverEnv = resolve(__dirname, '..', '.env');

if (existsSync(rootEnv)) dotenv.config({ path: rootEnv });
if (existsSync(serverEnv)) dotenv.config({ path: serverEnv, override: false });

