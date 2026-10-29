import { browser } from 'wxt/browser';
import { eraseFinishedDownloads } from '@/lib/download/history';

export default defineBackground(() => {
  // On every service worker start, which also covers downloads that finished while it was
  // asleep or the browser was closed.
  void eraseFinishedDownloads(browser.downloads, browser.runtime.id);

  browser.downloads.onChanged.addListener((delta) => {
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') {
      void eraseFinishedDownloads(browser.downloads, browser.runtime.id, delta.id);
    }
  });
});
