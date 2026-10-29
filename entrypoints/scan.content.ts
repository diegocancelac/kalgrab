import { scanFrame } from '@/lib/frame-scan';

// Never registered: the background runs it with executeScript (MAIN world, all frames) when
// the popup opens, and what main() returns is the result of that call.
export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const pageFetch = window.fetch;
    const isNative = Function.prototype.toString.call(pageFetch).includes('[native code]');
    return scanFrame({
      kalturaPlayer: (window as { KalturaPlayer?: unknown }).KalturaPlayer,
      pageUrl: location.href,
      fetch: isNative ? pageFetch.bind(window) : null,
    });
  },
});
