/**
 * Side-effect module that loads .env.local (then .env) into process.env.
 *
 * This MUST be imported before any module that reads process.env at load time
 * (e.g. server/auth/tokens.ts). ES modules evaluate imports in order, depth-first,
 * so importing this FIRST in the entry point guarantees the environment is
 * populated before the rest of the app is constructed. Values already present in
 * the OS environment win over the files.
 */

import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env.local', '.env'] });
