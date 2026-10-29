import { browser } from 'wxt/browser';
import { eraseFinishedDownloads } from '@/lib/download/history';
import {
  planProgressiveDownload,
  signedDownloadUrl,
  type ProgressiveDownload,
} from '@/lib/download/progressive';
import {
  readPopupRequest,
  respond,
  type DownloadRequest,
  type DownloadResponse,
  type ScanResponse,
} from '@/lib/extension-messages';
import { isSessionsMessage } from '@/lib/messages';
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

const fail = (error: string): DownloadResponse => ({ ok: false, error });
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

// The signed URL carries the ks. It stays in this function: it is never logged, stored or
// put in an error message.
async function download(request: DownloadRequest): Promise<DownloadResponse> {
  const { tabId, documentId, video, flavorId } = request;
  let plan: ProgressiveDownload;
  try {
    plan = planProgressiveDownload(video, flavorId);
  } catch (error) {
    return fail(messageOf(error, 'This video cannot be downloaded.'));
  }

  // The player's session as it is now, from the same document the scan listed.
  let results;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      files: ['/content-scripts/session.js'],
      world: 'MAIN',
    });
  } catch {
    return fail('The page has changed. Reopen Kalgrab and try again.');
  }
  const frame = results[0]?.result;
  if (!isSessionsMessage(frame)) {
    return fail('The player is no longer on the page. Reopen Kalgrab and try again.');
  }

  let url: string;
  try {
    url = signedDownloadUrl(plan, video.entryId, frame);
  } catch (error) {
    return fail(messageOf(error, 'Kalgrab could not build the download link.'));
  }
  try {
    await browser.downloads.download({
      url,
      filename: plan.filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  } catch {
    return fail('Chrome could not start the download.');
  }
  return { ok: true };
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

  // Every message gets an answer, a refused one included.
  browser.runtime.onMessage.addListener((value, sender, sendResponse) =>
    respond(async () => {
      const read = readPopupRequest(value, sender, browser.runtime.id);
      if (!read.ok) return read;
      const { request } = read;
      return request.type === 'scan' ? scan(request.tabId) : download(request);
    }, sendResponse),
  );
});
