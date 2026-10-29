/// <reference types="node" />
// Fails when a production manifest asks for host access at install. Host access is only
// ever requested from the popup, through optional_host_permissions.
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

if ('host_permissions' in manifest) {
  console.error(`${path} declares host_permissions; production builds must not.`);
  process.exit(1);
}
console.log(`${path}: no host_permissions.`);
