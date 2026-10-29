// HLS playlist parsing (RFC 8216). Pure: callers fetch the text and pass the playlist URL.

export type M3u8ErrorCode = 'invalid' | 'live' | 'fmp4' | 'byterange';

export class M3u8Error extends Error {
  readonly code: M3u8ErrorCode;

  constructor(code: M3u8ErrorCode, message: string) {
    super(message);
    this.name = 'M3u8Error';
    this.code = code;
  }
}

export interface Variant {
  url: string;
  bandwidth?: number;
  resolution?: { width: number; height: number };
  frameRate?: number;
  codecs?: string;
  /** Group id of the alternative audio renditions, when the audio is not muxed in. */
  audio?: string;
  /** The AUDIO renditions of that group; empty if the master never declares it. */
  audioRenditions?: Rendition[];
}

/** An EXT-X-MEDIA entry: an alternative audio, video or subtitle track. */
export interface Rendition {
  type: 'AUDIO' | 'VIDEO' | 'SUBTITLES' | 'CLOSED-CAPTIONS';
  groupId: string;
  name: string;
  language?: string;
  default: boolean;
  autoselect: boolean;
  /** Absent when the track is muxed into the variant streams. */
  url?: string;
}

export interface Segment {
  url: string;
  duration: number;
}

export interface MasterPlaylist {
  kind: 'master';
  variants: Variant[];
  renditions: Rendition[];
  isProtected: boolean;
}

export interface MediaPlaylist {
  kind: 'media';
  segments: Segment[];
  mediaSequence: number;
  isProtected: boolean;
}

export type Playlist = MasterPlaylist | MediaPlaylist;

type Entry = { type: 'tag'; name: string; value: string } | { type: 'uri'; value: string };

// A quoted value may contain commas (CODECS="avc1.x,mp4a.y"), so quotes are matched first.
const ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const RESOLUTION = /^(\d+)x(\d+)$/;
const RENDITION_TYPES = new Set(['AUDIO', 'VIDEO', 'SUBTITLES', 'CLOSED-CAPTIONS']);

/** Parses an attribute list such as `BANDWIDTH=1,CODECS="a,b"`. Quotes are stripped from values. */
export function parseAttributes(list: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of list.matchAll(ATTRIBUTE)) {
    const key = match[1];
    const raw = match[2];
    if (key === undefined || raw === undefined) continue;
    attributes[key] = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  }
  return attributes;
}

function tokenize(text: string): Entry[] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const entries: Entry[] = [];
  for (const rawLine of source.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT')) {
      const colon = line.indexOf(':');
      entries.push(
        colon < 0
          ? { type: 'tag', name: line.slice(1), value: '' }
          : { type: 'tag', name: line.slice(1, colon), value: line.slice(colon + 1) },
      );
    } else if (!line.startsWith('#')) {
      entries.push({ type: 'uri', value: line });
    }
  }

  const first = entries.shift();
  if (first?.type !== 'tag' || first.name !== 'EXTM3U') {
    throw new M3u8Error('invalid', 'Not an HLS playlist: missing #EXTM3U header.');
  }
  return entries;
}

// Absolute URIs are kept verbatim; new URL() would normalize them.
function resolveUri(uri: string, baseUrl: string): string {
  return HAS_SCHEME.test(uri) ? uri : new URL(uri, baseUrl).href;
}

// A missing METHOD counts as protected: only an explicit NONE is clear.
function hasEncryption(entries: Entry[]): boolean {
  return entries.some(
    (entry) =>
      entry.type === 'tag' &&
      (entry.name === 'EXT-X-KEY' || entry.name === 'EXT-X-SESSION-KEY') &&
      parseAttributes(entry.value)['METHOD'] !== 'NONE',
  );
}

// EXT-X-MEDIA entries missing TYPE, GROUP-ID or NAME, or with an unknown TYPE, are skipped.
function parseRendition(value: string, baseUrl: string): Rendition | null {
  const attributes = parseAttributes(value);
  const type = attributes['TYPE'];
  const groupId = attributes['GROUP-ID'];
  const name = attributes['NAME'];
  if (
    type === undefined ||
    !RENDITION_TYPES.has(type) ||
    groupId === undefined ||
    name === undefined
  ) {
    return null;
  }

  const rendition: Rendition = {
    type: type as Rendition['type'],
    groupId,
    name,
    default: attributes['DEFAULT'] === 'YES',
    autoselect: attributes['AUTOSELECT'] === 'YES',
  };
  if (attributes['LANGUAGE'] !== undefined) rendition.language = attributes['LANGUAGE'];
  if (attributes['URI']) rendition.url = resolveUri(attributes['URI'], baseUrl);
  return rendition;
}

function parseMaster(entries: Entry[], baseUrl: string, isProtected: boolean): MasterPlaylist {
  const variants: Variant[] = [];
  const renditions: Rendition[] = [];
  let pending: Record<string, string> | null = null;

  for (const entry of entries) {
    if (entry.type === 'tag') {
      if (entry.name === 'EXT-X-STREAM-INF') pending = parseAttributes(entry.value);
      if (entry.name === 'EXT-X-MEDIA') {
        const rendition = parseRendition(entry.value, baseUrl);
        if (rendition) renditions.push(rendition);
      }
      continue;
    }
    if (!pending) continue;

    const variant: Variant = { url: resolveUri(entry.value, baseUrl) };
    const bandwidth = pending['BANDWIDTH'];
    if (bandwidth !== undefined && /^\d+$/.test(bandwidth)) variant.bandwidth = Number(bandwidth);

    const size = RESOLUTION.exec(pending['RESOLUTION'] ?? '');
    if (size) variant.resolution = { width: Number(size[1]), height: Number(size[2]) };
    const frameRate = Number(pending['FRAME-RATE']);
    if (pending['FRAME-RATE'] !== undefined && Number.isFinite(frameRate)) {
      variant.frameRate = frameRate;
    }
    if (pending['CODECS'] !== undefined) variant.codecs = pending['CODECS'];
    if (pending['AUDIO'] !== undefined) variant.audio = pending['AUDIO'];

    variants.push(variant);
    pending = null;
  }

  for (const variant of variants) {
    if (variant.audio === undefined) continue;
    variant.audioRenditions = renditions.filter(
      (r) => r.type === 'AUDIO' && r.groupId === variant.audio,
    );
  }

  if (!isProtected && !variants.length) {
    throw new M3u8Error('invalid', 'The master playlist has no usable variants.');
  }
  return { kind: 'master', variants, renditions, isProtected };
}

function parseMedia(entries: Entry[], baseUrl: string, isProtected: boolean): MediaPlaylist {
  const segments: Segment[] = [];
  let mediaSequence = 0;
  let pendingDuration: number | null = null;
  let ended = false;
  let hasMap = false;
  let hasByteRange = false;

  for (const entry of entries) {
    if (entry.type === 'uri') {
      if (pendingDuration !== null) {
        segments.push({ url: resolveUri(entry.value, baseUrl), duration: pendingDuration });
        pendingDuration = null;
      }
      continue;
    }

    switch (entry.name) {
      case 'EXTINF': {
        // "<duration>,<title>"; the title is optional.
        const duration = Number.parseFloat(entry.value);
        if (!Number.isFinite(duration)) {
          throw new M3u8Error('invalid', `Invalid EXTINF duration: ${entry.value}`);
        }
        pendingDuration = duration;
        break;
      }
      case 'EXT-X-MEDIA-SEQUENCE': {
        const sequence = Number.parseInt(entry.value, 10);
        if (Number.isFinite(sequence)) mediaSequence = sequence;
        break;
      }
      case 'EXT-X-ENDLIST':
        ended = true;
        break;
      case 'EXT-X-MAP':
        hasMap = true;
        break;
      case 'EXT-X-BYTERANGE':
        hasByteRange = true;
        break;
    }
  }

  // A protected playlist is reported as such even if it is also unsupported, so the
  // caller shows the more useful message.
  if (!isProtected) {
    if (hasMap) {
      throw new M3u8Error('fmp4', 'Fragmented MP4 (EXT-X-MAP) playlists are not supported.');
    }
    if (hasByteRange) {
      throw new M3u8Error('byterange', 'Byte-range (EXT-X-BYTERANGE) playlists are not supported.');
    }
    if (!ended)
      throw new M3u8Error(
        'live',
        'Live streams not supported (the playlist has no #EXT-X-ENDLIST).',
      );
    if (!segments.length) throw new M3u8Error('invalid', 'The playlist has no segments.');
  }

  return { kind: 'media', segments, mediaSequence, isProtected };
}

/**
 * Parses a master or media playlist. `baseUrl` is the URL the playlist was fetched from;
 * relative URIs are resolved against it. Encryption is reported through `isProtected`,
 * not thrown. Throws M3u8Error for malformed, live or unsupported media playlists.
 */
export function parsePlaylist(text: string, baseUrl: string): Playlist {
  const entries = tokenize(text);
  const isProtected = hasEncryption(entries);
  const isMaster = entries.some((e) => e.type === 'tag' && e.name === 'EXT-X-STREAM-INF');
  return isMaster
    ? parseMaster(entries, baseUrl, isProtected)
    : parseMedia(entries, baseUrl, isProtected);
}
