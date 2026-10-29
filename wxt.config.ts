import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: ({ mode }) => ({
    name: 'Kalgrab',
    description: 'Download videos from Kaltura players.',
    permissions: ['scripting', 'downloads'],
    // Granted from the popup on first use. The player usually lives in a
    // cross-origin iframe whose domain is unknown ahead of time, which activeTab
    // does not cover.
    optional_host_permissions: ['*://*/*'],
    // Development builds get it at install, so testing does not depend on the popup's
    // request. Production must never declare it (CI checks the built manifest).
    ...(mode === 'development' && { host_permissions: ['*://*/*'] }),
  }),
  vite: () => ({
    plugins: [preact()],
  }),
});
