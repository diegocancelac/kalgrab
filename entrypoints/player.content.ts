import { VERSION } from '@/lib/messages';
import { createPlayerScript } from '@/lib/player-script';

const CHECK_INTERVAL_MS = 2000;

// No `matches` here: WXT would add them to host_permissions. The background
// registers this script with scripting.registerContentScripts once the user
// grants host access.
export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  allFrames: true,
  matchOriginAsFallback: true,
  runAt: 'document_start',
  main() {
    // Taken before page scripts run, so the requests that carry the ks and the port that
    // returns download URLs never go through a page wrapper (e.g. New Relic). Injected into
    // a page that is already open, fetch may be wrapped by then: it is not used at all.
    const pageFetch = window.fetch;
    const fetchIsNative = Function.prototype.toString.call(pageFetch).includes('[native code]');
    const postMessage = window.postMessage.bind(window);
    const portPostMessage = MessagePort.prototype.postMessage;
    const portClose = MessagePort.prototype.close;

    // The registered script and executeScript can both reach the same document.
    const mark = Symbol.for(`kalgrab.player.v${VERSION}`);
    if (mark in window) return;
    Object.defineProperty(window, mark, { value: true });

    const script = createPlayerScript({
      kalturaPlayer: () => (window as { KalturaPlayer?: unknown }).KalturaPlayer,
      pageUrl: () => location.href,
      fetch: fetchIsNative ? pageFetch.bind(window) : null,
      // The same window; "*" because sandboxed frames have an opaque origin. Never a ks.
      post: (message) => postMessage(message, '*'),
    });

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const reply = script.answerDownloadRequest(event.data);
      const port = event.ports[0];
      if (!reply || !port) return;
      portPostMessage.call(port, reply);
      portClose.call(port);
    });

    // Restored from the back/forward cache: the bridge reset this frame on pagehide.
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) script.republish();
    });

    void script.check();
    setInterval(() => void script.check(), CHECK_INTERVAL_MS);
  },
});
