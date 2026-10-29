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
 * The multirequest the player sends: baseEntry.list resolves the entry (following
 * redirects), and getPlaybackContext asks for every flavor ("all") of the entry it found.
 * The result is a two-element array, in that order.
 */
export function buildPlaybackContextRequest(input: PlaybackContextRequestInput): {
  url: string;
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
      filter: { redirectFromEntryId: input.entryId },
    },
    '2': {
      service: 'baseEntry',
      action: 'getPlaybackContext',
      entryId: '{1:result:objects:0:id}',
      contextDataParams: { objectType: 'KalturaContextDataParams', flavorTags: 'all' },
    },
  };
  return { url, body: JSON.stringify(body) };
}
