import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'app/entitlement');

const sourceFiles = readdirSync(DIR).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
);

describe('entitlement core purity', () => {
  it('has source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles)('%s imports only from within the core', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const external = imports.filter((i) => !i.startsWith('./'));
    expect(external).toEqual([]);
  });

  it.each(sourceFiles)('%s does not reference browser or node globals', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8');
    const forbidden = ['window.', 'document.', 'process.', 'globalThis.', 'require('];
    const found = forbidden.filter((token) => src.includes(token));
    expect(found).toEqual([]);
  });
});
