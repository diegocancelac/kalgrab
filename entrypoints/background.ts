import { browser } from 'wxt/browser';
import { trace, withoutUrls } from '@/lib/debug';
import {
  fetchSrt,
  planCaptionDownload,
  signedCaptionUrl,
  srtDataUrl,
  type CaptionDownload,
} from '@/lib/download/captions';
import {
  planProgressiveDownload,
  signedDownloadUrl,
  type ProgressiveDownload,
} from '@/lib/download/progressive';
import { waitForSaveAs } from '@/lib/download/save-as';
import {
  readPopupRequest,
  respond,
  type CaptionsRequest,
  type DownloadRequest,
  type DownloadResponse,
  type PopupResponse,
  type ScanResponse,
} from '@/lib/extension-messages';
import { isSessionsMessage, type SessionsMessage } from '@/lib/messages';
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

// The player's sessions as they are now, from the same document the scan listed. They carry
// the ks: they stay in the caller.
async function readSessions(
  tabId: number,
  documentId: string,
): Promise<{ frame: SessionsMessage } | { error: DownloadResponse }> {
  let results;
  try {
    results = await browser.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      files: ['/content-scripts/session.js'],
      world: 'MAIN',
    });
  } catch (error) {
    trace('sessions: executeScript failed', () => withoutUrls(error));
    return { error: fail('The page has changed. Reopen Kalgrab and try again.') };
  }
  const frame = results[0]?.result;
  if (!isSessionsMessage(frame)) {
    trace('sessions: the session script returned no valid sessions', () => ({
      frames: results.length,
      returned: frame === null ? 'null' : typeof frame,
    }));
    return { error: fail('The player is no longer on the page. Reopen Kalgrab and try again.') };
  }
  return { frame };
}

// The signed URL carries the ks. It only goes from here to save(): it is never logged, stored
// or put in an error message.
async function download(request: DownloadRequest): Promise<DownloadResponse> {
  const { tabId, documentId, video, flavorId } = request;
  let plan: ProgressiveDownload;
  try {
    plan = planProgressiveDownload(video, flavorId);
  } catch (error) {
    return fail(messageOf(error, 'This video cannot be downloaded.'));
  }

  const sessions = await readSessions(tabId, documentId);
  if ('error' in sessions) return sessions.error;
  const { frame } = sessions;

  let url: string;
  try {
    url = signedDownloadUrl(plan, video.entryId, frame);
  } catch (error) {
    return fail(messageOf(error, 'Kalgrab could not build the download link.'));
  }
  return save(url, plan.filename);
}

// The signed track URL carries the ks: it goes to the Kaltura origin it came from and nowhere
// else. The SRT saved from it does not carry it.
async function downloadCaptions(request: CaptionsRequest): Promise<DownloadResponse> {
  const { tabId, documentId, video, captionIndex } = request;
  let plan: CaptionDownload;
  try {
    plan = planCaptionDownload(video, captionIndex);
  } catch (error) {
    return fail(messageOf(error, 'These captions cannot be downloaded.'));
  }

  const sessions = await readSessions(tabId, documentId);
  if ('error' in sessions) return sessions.error;

  let srt: string;
  try {
    srt = await fetchSrt(signedCaptionUrl(plan, video.entryId, sessions.frame), fetch);
  } catch (error) {
    return fail(messageOf(error, 'Kalgrab could not get the captions.'));
  }
  return save(srtDataUrl(srt), plan.filename);
}

// Opens Chrome's Save As dialog with the name filled in and waits for the user's answer. The
// URL may carry the ks: it goes to downloads.download and nowhere else.
async function save(url: string, filename: string): Promise<DownloadResponse> {
  let id: number;
  try {
    id = await browser.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: true,
    });
  } catch (error) {
    trace('save: downloads.download failed', () => withoutUrls(error));
    return fail('Chrome could not start the download.');
  }
  const result = await waitForSaveAs(browser.downloads, id);
  trace(`save: ${result}`);
  if (result === 'failed') return fail('Chrome could not save the file.');
  return result === 'cancelled' ? { ok: true, cancelled: true } : { ok: true };
}

export default defineBackground(() => {
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
          if (request.type === 'scan') return await scan(request.tabId);
          if (request.type === 'download') return await download(request);
          return await downloadCaptions(request);
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
