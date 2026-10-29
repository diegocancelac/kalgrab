import { browser } from 'wxt/browser';
import { trace, withoutUrls } from '@/lib/debug';
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
  type PopupResponse,
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
  } catch (error) {
    // chrome:// pages, the Web Store, or no host access for the top frame.
    trace('scan: executeScript failed', () => withoutUrls(error));
    return { ok: false, error: 'Kalgrab cannot run on this page.' };
  }
  trace(`scan: injected into ${results.length} frames`, () => results.map((r) => r.frameId));
  return { ok: true, frames: await collectScan(results, fetch) };
}

const fail = (error: string): DownloadResponse => ({ ok: false, error });
const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

// What a response says, for the development traces, without titles or ids.
function summarize(response: PopupResponse): string {
  if (!response.ok) return `error: ${response.error}`;
  if (!('frames' in response)) return 'ok';
  const frames = response.frames.map(
    (f) =>
      `frame ${f.frameId}: ${f.videos.length} videos, ${f.failedOrigins.length} failed origins`,
  );
  return `ok, ${frames.length} frames with videos${frames.length ? ` (${frames.join('; ')})` : ''}`;
}

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
  } catch (error) {
    trace('download: executeScript failed', () => withoutUrls(error));
    return fail('The page has changed. Reopen Kalgrab and try again.');
  }
  const frame = results[0]?.result;
  if (!isSessionsMessage(frame)) {
    trace('download: the session script returned no valid sessions', () => ({
      frames: results.length,
      returned: frame === null ? 'null' : typeof frame,
    }));
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
  } catch (error) {
    trace('download: downloads.download failed', () => withoutUrls(error));
    return fail('Chrome could not start the download.');
  }
  trace('download: started');
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
    respond(
      async () => {
        const read = readPopupRequest(value, sender, browser.runtime.id);
        if (!read.ok) {
          trace('request refused', () => read.error);
          return read;
        }
        const { request } = read;
        trace(`request: ${request.type}`);
        try {
          return await (request.type === 'scan' ? scan(request.tabId) : download(request));
        } catch (error) {
          trace(`request: ${request.type} failed`, () => withoutUrls(error));
          throw error;
        }
      },
      (response) => {
        trace('response', () => summarize(response));
        sendResponse(response);
      },
    ),
  );
});
