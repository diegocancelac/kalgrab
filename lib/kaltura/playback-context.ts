// Kaltura playback context: request building and response parsing. Pure: the caller does the
// fetch. Only buildPlaybackContextRequest and withKs ever see the ks; whatever
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
// parsePlaybackContext does not know the ks, so two rules cut it: a v2 session always starts
// with "djJ8" (base64 of "v2|"), whatever its length, and any other long token made of ks
// characters goes too.
function redactKs(text: string): string {
  return text
    .replace(/(?<![A-Za-z0-9_=-])djJ8[A-Za-z0-9_=-]*/g, '[redacted]')
    .replace(/[A-Za-z0-9_=-]{32,}/g, '[redacted]');
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

// A ks the API echoes in a source URL, as a "/ks/<value>" path pair or a ?ks= parameter.
function withoutKs(url: URL): string {
  const parts = url.pathname.split('/');
  const at = parts.indexOf('ks');
  if (at >= 0) parts.splice(at, 2);
  url.pathname = parts.join('/');
  if (url.searchParams.has('ks')) url.searchParams.delete('ks');
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
// DFXP, and that is what vttToSrt expects. The URL is kept exactly as the API gives it (it
// is what the player fetches for the whole track); only withKs adds the session to it.
function parseCaptions(items: Json[]): Caption[] {
  const captions: Caption[] = [];
  for (const item of items) {
    const url = asString(item['webVttUrl']);
    if (!url || !parseHttpUrl(url)) continue;
    const languageCode = asString(item['languageCode']);
    const caption: Caption = {
      label: asString(item['label']) || asString(item['language']) || languageCode || 'Captions',
      isDefault: item['isDefault'] === true,
      url,
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
    return { url: withoutKs(url), flavorIds };
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

/** The source URL narrowed to one flavor. Still ks-free. */
export function flavorUrl(source: VideoSource, flavorId: string): string {
  if (!source.flavorIds.includes(flavorId)) {
    throw new Error(`Flavor ${flavorId} is not served by this source.`);
  }
  const url = new URL(source.url);
  const parts = url.pathname.split('/');
  const at = parts.indexOf('flavorIds');
  if (at < 0 || at + 1 >= parts.length) {
    throw new Error('The source URL has no flavorIds segment.');
  }
  parts[at + 1] = flavorId;
  url.pathname = parts.join('/');
  return url.href;
}

// Accepts origins or full URLs (serviceUrl may carry a path); entries that are not http(s) URLs
// are ignored, so a bad config entry can only shrink the list.
function originsOf(urls: readonly string[]): Set<string> {
  const origins = new Set<string>();
  for (const value of urls) {
    const url = parseHttpUrl(value);
    if (url) origins.add(url.origin);
  }
  return origins;
}

/**
 * Adds the ks to a Kaltura URL. This is the only place that puts it in one, so the result
 * must never be logged or stored; erase it from the downloads history once it is used.
 *
 * - playManifest URLs take it as a "/ks/<value>" path pair. After "playManifest" the path is
 *   key/value pairs, optionally ending in a lone file name (".../flavorIds/<ids>/a.m3u8").
 *   The pair goes before that file name, or before the last pair when the path ends in one
 *   (".../name/a.mp4"), so the pairs stay aligned.
 * - api_v3 endpoints (captions) take it as a "ks" query parameter.
 *
 * The URL must also be on one of `allowedOrigins`, the player's own serviceUrl / cdnUrl, so
 * a URL that merely looks like Kaltura's (or a page-supplied one) never gets the session.
 * Nothing is trusted by host name: a self-hosted Kaltura works as long as its origins are
 * listed. Anything else is rejected.
 */
export function withKs(url: string, ks: string, allowedOrigins: readonly string[]): string {
  if (!ks) throw new Error('A ks is required.');
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error('Cannot add the ks: not a valid URL.');
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('Cannot add the ks: not an http(s) URL.');
  }
  if (!originsOf(allowedOrigins).has(target.origin)) {
    throw new Error(`Cannot add the ks: ${target.origin} is not one of the player's origins.`);
  }

  const parts = target.pathname.split('/');
  const manifest = parts.indexOf('playManifest');
  if (manifest >= 0) {
    const rest = parts.length - manifest - 1;
    if (rest < 1) throw new Error('Cannot add the ks: the playManifest URL has no parameters.');
    // "=" is ks padding and is valid in a path; everything else unsafe gets escaped.
    const value = encodeURIComponent(ks).replace(/%3D/g, '=');
    parts.splice(rest % 2 === 1 ? parts.length - 1 : parts.length - 2, 0, 'ks', value);
    target.pathname = parts.join('/');
  } else if (/\/api_v3(\/|$)/.test(target.pathname)) {
    if (target.searchParams.has('ks')) {
      target.searchParams.set('ks', ks);
    } else {
      const param = `ks=${encodeURIComponent(ks)}`;
      target.search = target.search ? `${target.search}&${param}` : `?${param}`;
    }
  } else {
    throw new Error('Cannot add the ks: unknown kind of Kaltura URL.');
  }
  return target.href;
}
