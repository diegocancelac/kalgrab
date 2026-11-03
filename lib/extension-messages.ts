// Requests from the popup to the background. Only an extension page (no tab) of this
// extension may send them; content scripts never send runtime messages here.

import type { VideoInfo } from './kaltura/playback-context';
import { isVideoInfo } from './messages';
import type { FrameVideos } from './tab-scan';

export interface ScanRequest {
  type: 'scan';
  tabId: number;
}

export type ScanResponse = { ok: true; frames: FrameVideos[] } | { ok: false; error: string };

/** Downloads one flavor of a video listed by a scan, from the document it was found in. */
export interface DownloadRequest {
  type: 'download';
  tabId: number;
  documentId: string;
  video: VideoInfo;
  flavorId: string;
}

/** `cancelled` when the user closed the Save As dialog: not an error. */
export type DownloadResponse = { ok: true; cancelled?: true } | { ok: false; error: string };

export type PopupRequest = ScanRequest | DownloadRequest;

export type PopupResponse = ScanResponse | DownloadResponse;

/** Who sent a runtime message, as runtime.MessageSender describes it. */
export interface Sender {
  id?: string;
  tab?: unknown;
}

export type ReadRequest = { ok: true; request: PopupRequest } | { ok: false; error: string };

const isId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isToken = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);

const refuse = (error: string): ReadRequest => ({ ok: false, error });

/** The request, or why it is refused. The reasons never quote the request. */
export function readPopupRequest(value: unknown, sender: Sender, extensionId: string): ReadRequest {
  if (sender.id !== extensionId) return refuse('Kalgrab only answers its own pages.');
  if (sender.tab !== undefined) {
    return refuse('Kalgrab only answers its popup, not a page open in a tab.');
  }
  if (typeof value !== 'object' || value === null) return refuse('Unknown request.');
  const request = value as Record<string, unknown>;

  if (request['type'] === 'scan') {
    if (!isId(request['tabId'])) return refuse('The scan request has no valid tab id.');
    return { ok: true, request: { type: 'scan', tabId: request['tabId'] } };
  }
  if (request['type'] === 'download') {
    const { tabId, documentId, video, flavorId } = request;
    if (!isId(tabId)) return refuse('The download request has no valid tab id.');
    if (!isToken(documentId, 128)) return refuse('The download request has no valid document id.');
    // The video comes back from the popup as the scan listed it; it is checked again anyway.
    if (!isVideoInfo(video)) return refuse('The download request has no valid video.');
    if (!isToken(flavorId, 64)) return refuse('The download request has no valid flavor id.');
    return { ok: true, request: { type: 'download', tabId, documentId, video, flavorId } };
  }
  return refuse('Unknown request.');
}

/**
 * Runs `work` and passes its response to sendResponse, or an error response if it throws or
 * rejects, so the popup never gets undefined. Returns true, which tells Chrome the response
 * comes later; a listener that returns a Promise instead is not supported by every Chromium
 * version, sendResponse is.
 */
export function respond(
  work: () => Promise<PopupResponse>,
  sendResponse: (response: PopupResponse) => void,
): true {
  void Promise.resolve()
    .then(work)
    .catch((): PopupResponse => ({
      ok: false,
      error: 'Kalgrab failed unexpectedly. Reopen it and try again.',
    }))
    .then(sendResponse);
  return true;
}
