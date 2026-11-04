// Import this FIRST in a test file. It points the app at a private, empty
// database, key file and photo folder, so a test never touches real data.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const dir = mkdtempSync(join(tmpdir(), 'dk-test-'));
process.env.DK_DB = join(dir, 'kaizen.db');
process.env.DK_KEYFILE = join(dir, 'keystore.key');
process.env.DK_SECRETS = join(dir, 'no-secrets.json');
process.env.DK_PHOTOS = join(dir, 'photos');
process.env.DK_WEB_PORT = '0';
for (const k of ['DK_SMTP_HOST', 'DK_MQTT_USER', 'DK_DASH_PASS', 'DK_BASE_URL']) delete process.env[k];
