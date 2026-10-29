// Messages between the extension's own contexts: bridge → background, popup → background and
// background → bridge. The sender decides what is accepted: frame messages only from a
// content script in a tab, requests only from an extension page. Page data is validated again
// with the guards in messages.ts.

import { isMainMessage, type MainMessage } from './messages';

/** The frame's document has nothing detected: it just started or is going away. */
export interface FrameResetMessage {
  type: 'frame-reset';
}

/** A message from the frame's MAIN-world script that the bridge already validated. */
export interface PageMessage {
  type: 'page-message';
  message: MainMessage;
}

/** Sent before the popup asks for host access, so the tab can be injected once it is granted. */
export interface AccessRequestedMessage {
  type: 'access-requested';
  tabId: number;
}

export interface DownloadMessage {
  type: 'download';
  tabId: number;
  frameId: number;
  entryId: string;
  flavorId: string;
}

export type DownloadResult = { ok: true } | { ok: false; error: string };

/** Background → bridge: ask the MAIN-world script for the flavor URL with the session. */
export interface DownloadUrlRequest {
  type: 'download-url';
  entryId: string;
  flavorId: string;
}

/** Bridge → background, in reply to DownloadUrlRequest. `url` carries the ks: never log it. */
export interface DownloadUrlReply {
  url?: string;
}

export type FrameMessage = FrameResetMessage | PageMessage;
export type ExtensionPageMessage = AccessRequestedMessage | DownloadMessage;

/** Who sent a runtime message, as runtime.MessageSender describes it. */
export interface Sender {
  id?: string;
  tab?: { id?: number };
  frameId?: number;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isShortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

/** A frame message from one of this extension's content scripts, with the frame it came from. */
export function readFrameMessage(
  value: unknown,
  sender: Sender,
  extensionId: string,
): { tabId: number; frameId: number; message: FrameMessage } | null {
  const tabId = sender.tab?.id;
  if (sender.id !== extensionId || !isId(tabId) || !isId(sender.frameId)) return null;
  if (!isRecord(value)) return null;
  const at = { tabId, frameId: sender.frameId };
  if (value['type'] === 'frame-reset') return { ...at, message: { type: 'frame-reset' } };
  if (value['type'] === 'page-message' && isMainMessage(value['message'])) {
    return { ...at, message: { type: 'page-message', message: value['message'] } };
  }
  return null;
}

/** A request from an extension page (the popup); content scripts cannot send these. */
export function readExtensionPageMessage(
  value: unknown,
  sender: Sender,
  extensionId: string,
): ExtensionPageMessage | null {
  if (sender.id !== extensionId || sender.tab || !isRecord(value)) return null;
  if (value['type'] === 'access-requested' && isId(value['tabId'])) {
    return { type: 'access-requested', tabId: value['tabId'] };
  }
  if (
    value['type'] === 'download' &&
    isId(value['tabId']) &&
    isId(value['frameId']) &&
    isShortString(value['entryId']) &&
    isShortString(value['flavorId'])
  ) {
    return {
      type: 'download',
      tabId: value['tabId'],
      frameId: value['frameId'],
      entryId: value['entryId'],
      flavorId: value['flavorId'],
    };
  }
  return null;
}
