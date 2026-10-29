// Messages that the MAIN-world script posts to the isolated-world bridge. The page shares
// that world and can post anything on the same channel, so the bridge treats every message
// as untrusted: the guards below accept only the exact shapes defined here, with bounded
// sizes, and ignore everything else.

import type { Caption, Flavor, VideoInfo, VideoSource } from './kaltura/playback-context';

export const CHANNEL = 'kalgrab';
// After an update the scripts are injected again, and a MAIN-world script from the previous
// version may still be running in the page. Bump this whenever a message shape changes.
export const VERSION = 1;

export const LIMITS = {
  videos: 50,
  flavors: 50,
  flavorIds: 50,
  captions: 100,
  id: 64,
  title: 1000,
  label: 200,
  languageCode: 35,
  fileExt: 10,
  reason: 1000,
  url: 4096,
} as const;

// Upper bounds for numbers; far above anything real, only there to reject nonsense.
const MAX_DIMENSION = 100_000;
const MAX_BITRATE_KBPS = 1_000_000;
const MAX_SIZE_BYTES = 2 ** 42;
const MAX_DURATION_SECONDS = 30 * 24 * 3600;

/** The list of videos detected in a frame. Never carries a ks. */
export interface VideosMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: 'videos';
  videos: VideoInfo[];
}

/** A request to a Kaltura origin failed, typically because host access was not granted. */
export interface FetchFailedMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: 'fetch-failed';
  origin: string;
}

/**
 * The frame has a player, but the page replaced fetch before the script ran (it was injected
 * into an open page), so nothing is requested until the page is reloaded.
 */
export interface NeedsReloadMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: 'needs-reload';
}

export type MainMessage = VideosMessage | FetchFailedMessage | NeedsReloadMessage;

/**
 * ISOLATED → MAIN: asks for the URL of a flavor with the session. It travels with a
 * MessagePort, and the answer (DownloadUrlPortMessage) goes back on that port only, so the
 * page's own `message` listeners never see the URL.
 */
export interface DownloadRequestMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: 'download-request';
  entryId: string;
  flavorId: string;
}

/** MAIN → ISOLATED on the request's port. `url` carries the ks; empty when there is none. */
export interface DownloadUrlPortMessage {
  url?: string;
}

type Json = Record<string, unknown>;

// A listing never carries a session. A v2 ks always starts with "djJ8" (base64 of "v2|"), and
// Kaltura URLs carry it as a "/ks/<value>" path pair or a "ks" parameter, possibly
// percent-encoded. Any string field that shows either is rejected, not cleaned.
const V2_KS = /(?<![A-Za-z0-9_-])djJ8/;
const KS_IN_URL = /[/?&#;]ks(?:[=/&#;]|$)/i;

function decodeOnce(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function carriesKs(text: string, url: boolean): boolean {
  if (V2_KS.test(text)) return true;
  if (!url) return false;
  const once = decodeOnce(text);
  const twice = decodeOnce(once);
  return [text, once, twice].some((variant) => V2_KS.test(variant) || KS_IN_URL.test(variant));
}

// Messages cross postMessage, which clones them into plain objects.
function isPlainObject(value: unknown): value is Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Every required key present and no key outside required + optional.
function hasShape(value: Json, required: readonly string[], optional: readonly string[] = []) {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

function isList<T>(value: unknown, max: number, guard: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value) || value.length > max) return false;
  for (let i = 0; i < value.length; i++) {
    if (!guard(value[i])) return false;
  }
  return true;
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max && !carriesKs(value, false);
}

function isIdentifier(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    !carriesKs(value, false)
  );
}

function isNumberUpTo(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function isCountUpTo(value: unknown, max: number): value is number {
  return Number.isInteger(value) && isNumberUpTo(value, max);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > LIMITS.url) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      !carriesKs(value, true)
    );
  } catch {
    return false;
  }
}

function isFlavor(value: unknown): value is Flavor {
  return (
    isPlainObject(value) &&
    hasShape(value, ['id', 'width', 'height', 'bitrate'], ['sizeBytes', 'fileExt']) &&
    isIdentifier(value['id'], LIMITS.id) &&
    isCountUpTo(value['width'], MAX_DIMENSION) &&
    isCountUpTo(value['height'], MAX_DIMENSION) &&
    isCountUpTo(value['bitrate'], MAX_BITRATE_KBPS) &&
    (!('sizeBytes' in value) || isCountUpTo(value['sizeBytes'], MAX_SIZE_BYTES)) &&
    (!('fileExt' in value) ||
      (isText(value['fileExt'], LIMITS.fileExt) && /^[A-Za-z0-9]+$/.test(value['fileExt'])))
  );
}

function isCaption(value: unknown): value is Caption {
  return (
    isPlainObject(value) &&
    hasShape(value, ['label', 'isDefault', 'url'], ['languageCode']) &&
    isText(value['label'], LIMITS.label) &&
    typeof value['isDefault'] === 'boolean' &&
    isHttpUrl(value['url']) &&
    (!('languageCode' in value) || isIdentifier(value['languageCode'], LIMITS.languageCode))
  );
}

function isVideoSource(value: unknown): value is VideoSource {
  return (
    isPlainObject(value) &&
    hasShape(value, ['url', 'flavorIds']) &&
    isHttpUrl(value['url']) &&
    isList(value['flavorIds'], LIMITS.flavorIds, (id): id is string => isIdentifier(id, LIMITS.id))
  );
}

function isBlocked(value: unknown): value is { reason: string } {
  return (
    isPlainObject(value) &&
    hasShape(value, ['reason']) &&
    isText(value['reason'], LIMITS.reason) &&
    value['reason'].length > 0
  );
}

function isVideoInfo(value: unknown): value is VideoInfo {
  return (
    isPlainObject(value) &&
    hasShape(
      value,
      ['entryId', 'title', 'durationSeconds', 'flavors', 'captions', 'isProtected'],
      ['blocked', 'progressive', 'hls'],
    ) &&
    isIdentifier(value['entryId'], LIMITS.id) &&
    isText(value['title'], LIMITS.title) &&
    isNumberUpTo(value['durationSeconds'], MAX_DURATION_SECONDS) &&
    isList(value['flavors'], LIMITS.flavors, isFlavor) &&
    isList(value['captions'], LIMITS.captions, isCaption) &&
    typeof value['isProtected'] === 'boolean' &&
    (!('blocked' in value) || isBlocked(value['blocked'])) &&
    (!('progressive' in value) || isVideoSource(value['progressive'])) &&
    (!('hls' in value) || isVideoSource(value['hls'])) &&
    offersNothingWhenRestricted(value)
  );
}

// A protected or blocked video is listed so the popup can say why, but a message that
// also offers it for download is not one the MAIN script would send.
function offersNothingWhenRestricted(video: Json): boolean {
  if (video['isProtected'] !== true && !('blocked' in video)) return true;
  return (
    !('progressive' in video) && !('hls' in video) && (video['captions'] as unknown[]).length === 0
  );
}

export function isVideosMessage(value: unknown): value is VideosMessage {
  return (
    isPlainObject(value) &&
    hasShape(value, ['channel', 'version', 'type', 'videos']) &&
    value['channel'] === CHANNEL &&
    value['version'] === VERSION &&
    value['type'] === 'videos' &&
    isList(value['videos'], LIMITS.videos, isVideoInfo)
  );
}

export function isFetchFailedMessage(value: unknown): value is FetchFailedMessage {
  if (!isPlainObject(value) || !hasShape(value, ['channel', 'version', 'type', 'origin'])) {
    return false;
  }
  return (
    value['channel'] === CHANNEL &&
    value['version'] === VERSION &&
    value['type'] === 'fetch-failed' &&
    isHttpUrl(value['origin']) &&
    new URL(value['origin']).origin === value['origin']
  );
}

export function isNeedsReloadMessage(value: unknown): value is NeedsReloadMessage {
  return (
    isPlainObject(value) &&
    hasShape(value, ['channel', 'version', 'type']) &&
    value['channel'] === CHANNEL &&
    value['version'] === VERSION &&
    value['type'] === 'needs-reload'
  );
}

/** True for a message this extension's MAIN-world script could have sent; false for anything else. */
export function isMainMessage(value: unknown): value is MainMessage {
  return isVideosMessage(value) || isFetchFailedMessage(value) || isNeedsReloadMessage(value);
}

/** The page can post this too: the MAIN script checks it like any other message. */
export function isDownloadRequestMessage(value: unknown): value is DownloadRequestMessage {
  return (
    isPlainObject(value) &&
    hasShape(value, ['channel', 'version', 'type', 'entryId', 'flavorId']) &&
    value['channel'] === CHANNEL &&
    value['version'] === VERSION &&
    value['type'] === 'download-request' &&
    isIdentifier(value['entryId'], LIMITS.id) &&
    isIdentifier(value['flavorId'], LIMITS.id)
  );
}
