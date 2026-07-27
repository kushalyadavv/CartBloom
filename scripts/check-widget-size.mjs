/**
 * Fails the build if the storefront widget exceeds its byte budget.
 *
 * Theme app extensions suggest 10 KB compressed JavaScript. The widget loads on
 * every storefront page view of every merchant who installs CartBloom, so this
 * is a real cost imposed on their customers, not a guideline to drift past.
 *
 * CSS is a separate 100 KB budget and is not checked here — visual richness is
 * nearly free, logic is not. If this fails, the answer is almost never "raise
 * the limit": it is to move work to CSS, drop a dependency, or lazily load a
 * second asset.
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';

const BUNDLE = 'extensions/cartbloom-widget/assets/cartbloom.js';
const BUDGET = 10 * 1024;
/** Warn well before the wall so growth is visible while it is still cheap. */
const WARN_AT = Math.floor(BUDGET * 0.8);

let raw;
try {
  raw = readFileSync(BUNDLE);
} catch {
  console.error(`✗ ${BUNDLE} not found — run "npm run build:widget" first.`);
  process.exit(1);
}

const gz = gzipSync(raw, { level: 9 }).length;
const pct = ((gz / BUDGET) * 100).toFixed(1);

console.log(`widget bundle: ${statSync(BUNDLE).size} bytes raw, ${gz} gzipped`);
console.log(`budget:        ${BUDGET} gzipped — ${pct}% used, ${BUDGET - gz} bytes left`);

if (gz > BUDGET) {
  console.error(`\n✗ OVER BUDGET by ${gz - BUDGET} bytes.`);
  process.exit(1);
}
if (gz > WARN_AT) {
  console.warn(`\n⚠ Over 80% of budget. Address this before adding more.`);
}
console.log('\n✓ within budget');
