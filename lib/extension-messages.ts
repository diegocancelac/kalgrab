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

export type DownloadResponse = { ok: true } | { ok: false; error: string };

export type PopupRequest = ScanRequest | DownloadRequest;

/** Who sent a runtime message, as runtime.MessageSender describes it. */
export interface Sender {
  id?: string;
  tab?: unknown;
}

const isId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isToken = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value);

export function readPopupRequest(
  value: unknown,
  sender: Sender,
  extensionId: string,
): PopupRequest | null {
  if (sender.id !== extensionId || sender.tab !== undefined) return null;
  if (typeof value !== 'object' || value === null) return null;
  const request = value as Record<string, unknown>;
  if (request['type'] === 'scan' && isId(request['tabId'])) {
    return { type: 'scan', tabId: request['tabId'] };
  }
  // The video comes back from the popup as the scan listed it; it is checked again anyway.
  if (
    request['type'] === 'download' &&
    isId(request['tabId']) &&
    isToken(request['documentId'], 128) &&
    isVideoInfo(request['video']) &&
    isToken(request['flavorId'], 64)
  ) {
    return {
      type: 'download',
      tabId: request['tabId'],
      documentId: request['documentId'],
      video: request['video'],
      flavorId: request['flavorId'],
    };
  }
  return null;
}
