// Loads the repo-root .env before integration tests, like the API does at startup.
import { config } from 'dotenv';
import { join } from 'node:path';
import { findRepoRoot } from '../src/config/repo-root';

config({ path: join(findRepoRoot(), '.env'), quiet: true });
