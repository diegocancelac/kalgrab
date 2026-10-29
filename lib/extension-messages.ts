// Requests from the popup to the background. Only an extension page (no tab) of this
// extension may send them; content scripts never send runtime messages here.

import type { FrameVideos } from './tab-scan';

export interface ScanRequest {
  type: 'scan';
  tabId: number;
}

export type ScanResponse = { ok: true; frames: FrameVideos[] } | { ok: false; error: string };

export type PopupRequest = ScanRequest;

/** Who sent a runtime message, as runtime.MessageSender describes it. */
export interface Sender {
  id?: string;
  tab?: unknown;
}

const isId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

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
  return null;
}
