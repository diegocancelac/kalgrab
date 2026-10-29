import { browser } from 'wxt/browser';
import { eraseFinishedDownloads } from '@/lib/download/history';
import { readPopupRequest, type ScanResponse } from '@/lib/extension-messages';
import { collectScan } from '@/lib/tab-scan';

async function scan(tabId: number): Promise<ScanResponse> {
  let results;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['/content-scripts/scan.js'],
      world: 'MAIN',
    });
  } catch {
    // chrome:// pages, the Web Store, or no host access for the top frame.
    return { ok: false, error: 'Kalgrab cannot run on this page.' };
  }
  return { ok: true, frames: await collectScan(results, fetch) };
}

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

  browser.runtime.onMessage.addListener((value, sender, sendResponse) => {
    const request = readPopupRequest(value, sender, browser.runtime.id);
    if (request?.type !== 'scan') return;
    scan(request.tabId).then(sendResponse, () =>
      sendResponse({ ok: false, error: 'The scan failed.' } satisfies ScanResponse),
    );
    return true;
  });
});
