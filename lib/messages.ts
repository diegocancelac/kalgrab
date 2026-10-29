// Messages the MAIN-world scripts return to the background through executeScript. They are
// built in the page's world, which can tamper with anything there, so the background treats
// them as untrusted: the guards below accept only the exact shapes defined here, with
// bounded sizes, and ignore everything else.

import type { Caption, Flavor, VideoInfo, VideoSource } from './kaltura/playback-context';
import type { PlayerSession } from './kaltura/player-v7';

export const CHANNEL = 'kalgrab';
// Bump whenever a message shape changes.
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
  sessions: 50,
  ks: 8192,
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

/** A request to a Kaltura origin failed (network error or timeout). */
export interface FetchFailedMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: 'fetch-failed';
  origin: string;
}

/**
 * The sessions of the frame's players, for the background to use: to request the playback
 * context when the page's fetch is not native, or to sign a download URL. Carries the ks, so
 * it is never stored, logged or passed on to the popup.
 */
export interface SessionsMessage {
  channel: typeof CHANNEL;
  version: typeof VERSION;
  type: 'sessions';
  /** The frame's location.href, sent to Kaltura as the download referrer. */
  pageUrl: string;
  sessions: PlayerSession[];
}

export type MainMessage = VideosMessage | FetchFailedMessage | SessionsMessage;

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

const REQUIRED_VIDEO_FIELDS = [
  'entryId',
  'title',
  'durationSeconds',
  'flavors',
  'captions',
  'isProtected',
] as const;

const VIDEO_FIELDS: Record<keyof VideoInfo, (value: unknown) => boolean> = {
  entryId: (value) => isIdentifier(value, LIMITS.id),
  title: (value) => isText(value, LIMITS.title),
  durationSeconds: (value) => isNumberUpTo(value, MAX_DURATION_SECONDS),
  flavors: (value) => isList(value, LIMITS.flavors, isFlavor),
  captions: (value) => isList(value, LIMITS.captions, isCaption),
  isProtected: (value) => typeof value === 'boolean',
  blocked: isBlocked,
  progressive: isVideoSource,
  hls: isVideoSource,
};

/**
 * What keeps a value from being a VideoInfo: the names of the fields that are missing or
 * fail their check, never their values. Empty when isVideoInfo accepts it.
 */
export function videoInfoProblems(value: unknown): string[] {
  if (!isPlainObject(value)) return ['not an object'];
  const problems = Object.keys(value).some((key) => !Object.hasOwn(VIDEO_FIELDS, key))
    ? ['unknown fields']
    : [];
  for (const [key, check] of Object.entries(VIDEO_FIELDS)) {
    const present = Object.hasOwn(value, key);
    const required = (REQUIRED_VIDEO_FIELDS as readonly string[]).includes(key);
    if (present ? !check(value[key]) : required) problems.push(key);
  }
  if (!problems.length && !offersNothingWhenRestricted(value)) {
    problems.push('downloadable while protected or blocked');
  }
  return problems;
}

/** One listed video, held to the same rules as inside a videos message. */
export function isVideoInfo(value: unknown): value is VideoInfo {
  return videoInfoProblems(value).length === 0;
}

// A protected or blocked video is listed so the popup can say why, but a message that
// also offers it for download is not one the MAIN script would send.
function offersNothingWhenRestricted(video: Json): boolean {
  if (video['isProtected'] !== true && !Object.hasOwn(video, 'blocked')) return true;
  return (
    !Object.hasOwn(video, 'progressive') &&
    !Object.hasOwn(video, 'hls') &&
    (video['captions'] as unknown[]).length === 0
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

// Unlike a listing, a session is expected to carry a ks: it is checked for shape only.
function isPlayerSession(value: unknown): value is PlayerSession {
  return (
    isPlainObject(value) &&
    hasShape(value, ['partnerId', 'serviceUrl', 'allowedOrigins', 'ks', 'entryId']) &&
    Number.isSafeInteger(value['partnerId']) &&
    (value['partnerId'] as number) > 0 &&
    isHttpUrl(value['serviceUrl']) &&
    isList(value['allowedOrigins'], 2, isHttpUrl) &&
    value['allowedOrigins'].length > 0 &&
    typeof value['ks'] === 'string' &&
    value['ks'].length <= LIMITS.ks &&
    /^[A-Za-z0-9+/=_-]+$/.test(value['ks']) &&
    isIdentifier(value['entryId'], LIMITS.id)
  );
}

// The page URL goes to Kaltura as the referrer, as the player sends it; it is not checked
// for a ks like the listing URLs are.
function isPageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > LIMITS.url) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

export function isSessionsMessage(value: unknown): value is SessionsMessage {
  return (
    isPlainObject(value) &&
    hasShape(value, ['channel', 'version', 'type', 'pageUrl', 'sessions']) &&
    value['channel'] === CHANNEL &&
    value['version'] === VERSION &&
    value['type'] === 'sessions' &&
    isPageUrl(value['pageUrl']) &&
    isList(value['sessions'], LIMITS.sessions, isPlayerSession) &&
    value['sessions'].length > 0
  );
}

/** True for a message this extension's MAIN-world scripts could return; false for anything else. */
export function isMainMessage(value: unknown): value is MainMessage {
  return isVideosMessage(value) || isFetchFailedMessage(value) || isSessionsMessage(value);
}
