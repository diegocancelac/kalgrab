import { readFrameSessions } from '@/lib/frame-scan';

// Never registered: the background runs it with executeScript in the scanned document when a
// download starts, so the session it returns is the player's current one.
export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  main() {
    return readFrameSessions((window as { KalturaPlayer?: unknown }).KalturaPlayer, location.href);
  },
});
