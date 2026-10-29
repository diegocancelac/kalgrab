// Kaltura playback context: request building and response parsing. Pure: the caller does the
// fetch. Only buildPlaybackContextRequest and buildProgressiveUrl ever see the ks; whatever
// parsePlaybackContext returns is ks-free.

export interface PlaybackContextRequestInput {
  serviceUrl: string;
  partnerId: number;
  ks: string;
  entryId: string;
}

/**
 * The multirequest the player sends, as a JSON POST: baseEntry.list resolves the entry
 * (following redirects), and getPlaybackContext asks for every flavor ("all") of the entry
 * it found. The ks goes at the top level and in each request, like the player does.
 * The result is a two-element array, in that order.
 */
export function buildPlaybackContextRequest(input: PlaybackContextRequestInput): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  let base: URL;
  try {
    base = new URL(input.serviceUrl);
  } catch {
    throw new Error('serviceUrl is not a valid URL.');
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error('serviceUrl must be an http(s) URL.');
  }
  if (!input.ks) throw new Error('A ks is required.');
  if (!input.entryId) throw new Error('An entryId is required.');

  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/api_v3/service/multirequest`;
  const body = {
    format: 1,
    ks: input.ks,
    partnerId: input.partnerId,
    '1': {
      service: 'baseEntry',
      action: 'list',
      ks: input.ks,
      filter: { redirectFromEntryId: input.entryId },
    },
    '2': {
      service: 'baseEntry',
      action: 'getPlaybackContext',
      ks: input.ks,
      entryId: '{1:result:objects:0:id}',
      contextDataParams: { objectType: 'KalturaContextDataParams', flavorTags: 'all' },
    },
  };
  return {
    url,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** A KalturaAPIException from the server. `message` is safe to show: it never carries a ks. */
export class KalturaApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'KalturaApiError';
    this.code = code;
  }
}

export interface Flavor {
  id: string;
  width: number;
  height: number;
  /** In kbps. */
  bitrate: number;
  sizeBytes?: number;
  fileExt?: string;
}

export interface Caption {
  label: string;
  languageCode?: string;
  isDefault: boolean;
  /** WebVTT for the whole track. */
  url: string;
}

export interface VideoSource {
  url: string;
  flavorIds: string[];
}

export interface VideoInfo {
  entryId: string;
  title: string;
  durationSeconds: number;
  /** Every ready flavor. A source can only serve the ones in its own `flavorIds`. */
  flavors: Flavor[];
  /** Empty when the video is protected or blocked. */
  captions: Caption[];
  /** DRM on any source. */
  isProtected: boolean;
  /** An access-control rule forbids (or limits to a preview) playing the video. */
  blocked?: { reason: string };
  /** Only set when the video is neither protected nor blocked. */
  progressive?: VideoSource;
  hls?: VideoSource;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asRecords = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : []);

// Kaltura puts the ks inside some error messages (INVALID_KS quotes the whole session).
// parsePlaybackContext does not know the ks, so any long token made of ks characters is cut.
function redactKs(text: string): string {
  return text.replace(/[A-Za-z0-9_=-]{32,}/g, '[redacted]');
}

function throwIfApiException(value: unknown): void {
  if (!isRecord(value) || value['objectType'] !== 'KalturaAPIException') return;
  const code = asString(value['code']) ?? 'UNKNOWN_ERROR';
  const message = redactKs(asString(value['message']) ?? code);
  throw new KalturaApiError(code, message);
}

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

// Kaltura URL parameters are path segments ("/name/value") or, less often, query params.
function withoutParams(url: URL, names: string[]): string {
  const parts = url.pathname.split('/');
  for (const name of names) {
    const at = parts.indexOf(name);
    if (at >= 0) parts.splice(at, 2);
  }
  url.pathname = parts.join('/');
  for (const name of names) {
    if (url.searchParams.has(name)) url.searchParams.delete(name);
  }
  return url.href;
}

function parseFlavors(assets: Json[]): Flavor[] {
  const READY = 2;
  const flavors: Flavor[] = [];
  for (const asset of assets) {
    const id = asString(asset['id']);
    if (!id || asset['status'] !== READY) continue;
    const flavor: Flavor = {
      id,
      width: asNumber(asset['width']) ?? 0,
      height: asNumber(asset['height']) ?? 0,
      bitrate: asNumber(asset['bitrate']) ?? 0,
    };
    // `size` is in KB.
    const size = asNumber(asset['size']);
    if (size) flavor.sizeBytes = size * 1024;
    const fileExt = asString(asset['fileExt']);
    if (fileExt) flavor.fileExt = fileExt;
    flavors.push(flavor);
  }
  return flavors;
}

// Only webVttUrl is used: Kaltura serves WebVTT even when the asset was uploaded as SRT or
// DFXP, and that is what vttToSrt expects. The URL may address one segment of the track
// (a segmentIndex parameter); dropping it asks for the whole file.
function parseCaptions(items: Json[]): Caption[] {
  const captions: Caption[] = [];
  for (const item of items) {
    const url = parseHttpUrl(item['webVttUrl']);
    if (!url) continue;
    const languageCode = asString(item['languageCode']);
    const caption: Caption = {
      label: asString(item['label']) || asString(item['language']) || languageCode || 'Captions',
      isDefault: item['isDefault'] === true,
      url: withoutParams(url, ['ks', 'segmentIndex']),
    };
    if (languageCode) caption.languageCode = languageCode;
    captions.push(caption);
  }
  return captions;
}

// Fails closed: anything but a missing value or an empty list counts as DRM.
function hasDrm(source: Json): boolean {
  const drm = source['drm'];
  if (drm === undefined || drm === null) return false;
  return !(Array.isArray(drm) && drm.length === 0);
}

// The first source of the given format served over https, in API order.
function pickSource(sources: Json[], format: string): VideoSource | undefined {
  for (const source of sources) {
    if (source['format'] !== format) continue;
    const url = parseHttpUrl(source['url']);
    if (url?.protocol !== 'https:') continue;
    const flavorIds = (asString(source['flavorIds']) ?? '').split(',').filter(Boolean);
    return { url: withoutParams(url, ['ks']), flavorIds };
  }
  return undefined;
}

// KalturaRuleActionType: BLOCK = 1, PREVIEW = 2.
function accessRestriction(context: Json): { reason: string } | undefined {
  const kinds = asRecords(context['actions']).flatMap((action) => {
    const type = String(action['type']);
    const objectType = action['objectType'];
    if (type === '1' || type === 'BLOCK' || objectType === 'KalturaAccessControlBlockAction') {
      return ['block'];
    }
    if (type === '2' || type === 'PREVIEW' || objectType === 'KalturaAccessControlPreviewAction') {
      return ['preview'];
    }
    return [];
  });
  if (!kinds.length) return undefined;

  const messages = asRecords(context['messages'])
    .map((m) => asString(m['message']))
    .filter((m): m is string => !!m);
  if (messages.length) return { reason: redactKs([...new Set(messages)].join(' ')) };
  return {
    reason: kinds.includes('block')
      ? 'Access to this video is blocked by an access-control rule.'
      : 'Only a preview of this video is available.',
  };
}

/**
 * Turns the multirequest response into a ks-free VideoInfo. Throws KalturaApiError when any
 * element of the response is a KalturaAPIException, or when the entry does not exist.
 */
export function parsePlaybackContext(json: unknown): VideoInfo {
  throwIfApiException(json);
  if (!Array.isArray(json)) throw new Error('Unexpected response from the Kaltura API.');
  json.forEach(throwIfApiException);

  const list = json.find((r) => isRecord(r) && r['objectType'] === 'KalturaBaseEntryListResponse');
  const context = json.find((r) => isRecord(r) && r['objectType'] === 'KalturaPlaybackContext');
  if (!isRecord(context)) throw new Error('The response has no playback context.');

  const entry = isRecord(list) ? asRecords(list['objects'])[0] : undefined;
  const entryId = asString(entry?.['id']);
  if (!entry || !entryId) {
    throw new KalturaApiError('ENTRY_ID_NOT_FOUND', 'The entry was not found.');
  }

  const sources = asRecords(context['sources']);
  const isProtected = sources.some(hasDrm);
  const blocked = accessRestriction(context);
  const downloadable = !isProtected && !blocked;

  const info: VideoInfo = {
    entryId,
    title: asString(entry['name']) ?? entryId,
    durationSeconds: asNumber(entry['duration']) ?? (asNumber(entry['msDuration']) ?? 0) / 1000,
    flavors: parseFlavors(asRecords(context['flavorAssets'])),
    captions: downloadable ? parseCaptions(asRecords(context['playbackCaptions'])) : [],
    isProtected,
  };
  if (blocked) info.blocked = blocked;
  if (downloadable) {
    const progressive = pickSource(sources, 'url');
    const hls = pickSource(sources, 'applehttp');
    if (progressive) info.progressive = progressive;
    if (hls) info.hls = hls;
  }
  return info;
}

/**
 * Download URL of a single flavor of a progressive source. This is the only place that
 * puts the ks in a URL: it goes in the path as Kaltura's own playManifest URLs carry it
 * ("/ks/<value>"). The result must never be logged or stored; the downloads API call that
 * uses it should erase it from the browser history afterwards.
 */
export function buildProgressiveUrl(source: VideoSource, flavorId: string, ks: string): string {
  if (!ks) throw new Error('A ks is required.');
  if (!source.flavorIds.includes(flavorId)) {
    throw new Error(`Flavor ${flavorId} is not served by this source.`);
  }

  const url = new URL(source.url);
  const parts = url.pathname.split('/');
  const at = parts.indexOf('flavorIds');
  if (at < 0 || at + 1 >= parts.length) {
    throw new Error('The source URL has no flavorIds segment.');
  }
  // "=" is ks padding and is valid in a path; everything else unsafe gets escaped.
  const ksSegment = encodeURIComponent(ks).replace(/%3D/g, '=');
  parts.splice(at, 2, 'ks', ksSegment, 'flavorIds', flavorId);
  url.pathname = parts.join('/');
  return url.href;
}
