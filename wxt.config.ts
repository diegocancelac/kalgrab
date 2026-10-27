import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Kalgrab',
    description: 'Download videos from Kaltura players.',
    permissions: ['scripting', 'downloads', 'offscreen', 'storage', 'webRequest'],
    // Granted from the popup on first use. The player usually lives in a
    // cross-origin iframe whose domain is unknown ahead of time.
    optional_host_permissions: ['*://*/*'],
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
