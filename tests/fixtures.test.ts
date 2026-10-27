/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fixturesDir = join(import.meta.dirname, 'fixtures');

// Every number with 4+ digits in a fixture must be one of these known fake or
// generic values. An allowlist instead of a blocklist, so the real IDs that
// were replaced never have to appear in the repo.
const allowedNumbers = new Set([
  // partnerId and sub-partner ID
  '1234567',
  '123456700',
  // flavorParamsId
  '1001',
  '1002',
  '1003',
  // non-default deliveryProfileId
  '9001',
  '9002',
  '9003',
  '9004',
  '9005',
  '9006',
  '9007',
  '9008',
  '9009',
  '9010',
  '9011',
  // createdAt / updatedAt
  '1600000000',
  '1700000000',
  // metadata id and metadataProfileId
  '111111111',
  '2222222',
  // thumbnail version (Kaltura's initial value)
  '100001',
  // media properties: flavor sizes in KB, width, msDuration, HLS bandwidths
  '3061',
  '3778',
  '6103',
  '1280',
  '132000',
  '221349',
  '267385',
  '418046',
]);

// Guards against committing a capture that still carries a session or real IDs.
describe('fixtures', () => {
  for (const name of readdirSync(fixturesDir)) {
    const content = readFileSync(join(fixturesDir, name), 'utf8');

    it(`${name} contains no ks`, () => {
      expect(content).not.toMatch(/"ks"\s*:|\/ks\/|[?&]ks=/i);
    });

    it(`${name} contains only known fake numeric values`, () => {
      const unknown = [...new Set(content.match(/\b\d{4,}\b/g) ?? [])].filter(
        (n) => !allowedNumbers.has(n),
      );
      expect(unknown).toEqual([]);
    });
  }
});
