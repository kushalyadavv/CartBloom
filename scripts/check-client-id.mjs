/**
 * Fail the build if App Bridge would ship unconfigured.
 *
 * This exists because the failure it catches is invisible locally. A dev
 * session supplies the client id through the environment, so the app works on
 * a laptop no matter what the bundle contains; the placeholder only surfaces in
 * production, as an app that cannot mint session tokens, and usually as a
 * rejected automated check during App Store review.
 *
 * Run after `npm run build`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_DIR = 'build';

const toml = readFileSync('shopify.app.toml', 'utf8');
const clientId = toml.match(/^client_id\s*=\s*"([^"]+)"/m)?.[1];

if (!clientId) {
  console.error('FAIL: no client_id in shopify.app.toml.');
  process.exit(1);
}

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let foundClientId = false;
const leaked = [];

for (const path of files(BUILD_DIR)) {
  // Source maps legitimately contain the pre-substitution source, so a
  // placeholder there is not a defect.
  if (path.endsWith('.map')) continue;

  const content = readFileSync(path, 'utf8');
  if (content.includes(clientId)) foundClientId = true;
  if (content.includes('__SHOPIFY_API_KEY__')) leaked.push(path);
}

if (leaked.length > 0) {
  console.error(
    `FAIL: the __SHOPIFY_API_KEY__ placeholder survived the build in:\n  ${leaked.join('\n  ')}\n` +
      'Vite did not substitute it, so App Bridge will initialise without a key.'
  );
  process.exit(1);
}

if (!foundClientId) {
  console.error(
    `FAIL: client id ${clientId} appears nowhere in ${BUILD_DIR}/.\n` +
      'The App Bridge meta tag is missing or is being filled at runtime instead ' +
      'of at build time.'
  );
  process.exit(1);
}

console.log(`OK: client id ${clientId} is baked into the build.`);
