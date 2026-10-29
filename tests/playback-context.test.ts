/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KalturaApiError,
  buildPlaybackContextRequest,
  flavorUrl,
  withKs,
  parsePlaybackContext,
} from '../lib/kaltura/playback-context';

// Never a real session. Tests assert with toEqual/toContain; no snapshots, so the value
// is not written to disk.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';

const fixture: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
    'utf8',
  ),
);

const input = {
  serviceUrl: 'https://cdnapisec.kaltura.com',
  partnerId: 1234567,
  ks: FAKE_KS,
  entryId: '1_abcd1234',
};

describe('buildPlaybackContextRequest', () => {
  it('targets the multirequest endpoint of the service URL', () => {
    expect(buildPlaybackContextRequest(input).url).toBe(
      'https://cdnapisec.kaltura.com/api_v3/service/multirequest',
    );
  });

  it('tolerates a trailing slash and keeps a path prefix', () => {
    const { url } = buildPlaybackContextRequest({
      ...input,
      serviceUrl: 'https://kaltura.example.edu/proxy//',
    });
    expect(url).toBe('https://kaltura.example.edu/proxy/api_v3/service/multirequest');
  });

  it('does not repeat /api_v3 when serviceUrl already ends in it', () => {
    for (const serviceUrl of [
      'https://www.kaltura.com/api_v3',
      'https://www.kaltura.com/api_v3/',
      'https://www.kaltura.com/api_v3//',
    ]) {
      expect(buildPlaybackContextRequest({ ...input, serviceUrl }).url, serviceUrl).toBe(
        'https://www.kaltura.com/api_v3/service/multirequest',
      );
    }
    const { url } = buildPlaybackContextRequest({
      ...input,
      serviceUrl: 'https://kaltura.example.edu/proxy/api_v3/',
    });
    expect(url).toBe('https://kaltura.example.edu/proxy/api_v3/service/multirequest');
  });

  it('only strips a whole /api_v3 segment', () => {
    const { url } = buildPlaybackContextRequest({
      ...input,
      serviceUrl: 'https://kaltura.example.edu/my_api_v3',
    });
    expect(url).toBe('https://kaltura.example.edu/my_api_v3/api_v3/service/multirequest');
  });

  it('asks for baseEntry.list and then getPlaybackContext with all flavors', () => {
    const body = JSON.parse(buildPlaybackContextRequest(input).body);
    expect(body['1']).toMatchObject({
      service: 'baseEntry',
      action: 'list',
      filter: { redirectFromEntryId: '1_abcd1234' },
    });
    expect(body['2']).toMatchObject({
      service: 'baseEntry',
      action: 'getPlaybackContext',
      entryId: '{1:result:objects:0:id}',
      contextDataParams: { objectType: 'KalturaContextDataParams', flavorTags: 'all' },
    });
  });

  it('sends the session at the top level and in each request', () => {
    const body = JSON.parse(buildPlaybackContextRequest(input).body);
    expect(body.ks).toBe(FAKE_KS);
    expect(body['1'].ks).toBe(FAKE_KS);
    expect(body['2'].ks).toBe(FAKE_KS);
    expect(body.partnerId).toBe(1234567);
    expect(body.format).toBe(1);
  });

  it('is meant to be sent as application/json', () => {
    expect(buildPlaybackContextRequest(input).headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('rejects a bad service URL, a missing ks or a missing entry id', () => {
    expect(() => buildPlaybackContextRequest({ ...input, serviceUrl: 'not a url' })).toThrow();
    expect(() =>
      buildPlaybackContextRequest({ ...input, serviceUrl: 'ftp://x.example.com' }),
    ).toThrow();
    expect(() => buildPlaybackContextRequest({ ...input, ks: '' })).toThrow();
    expect(() => buildPlaybackContextRequest({ ...input, entryId: '' })).toThrow();
  });
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// A deep copy of the sample response, edited by the test.
function sample(edit?: (response: Json[], context: Json) => void): unknown {
  const response = structuredClone(fixture) as Json[];
  edit?.(response, response[1] as Json);
  return response;
}

function errorOf(fn: () => unknown): KalturaApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof KalturaApiError) return error;
    throw error;
  }
  throw new Error('expected KalturaApiError');
}

const apiException = (code: string, message: string) => ({
  objectType: 'KalturaAPIException',
  code,
  message,
  args: {},
});

describe('parsePlaybackContext', () => {
  it('parses the sample response', () => {
    const info = parsePlaybackContext(fixture);
    expect(info).toMatchObject({
      entryId: '1_abcd1234',
      title: 'Sample lecture',
      durationSeconds: 132,
      isProtected: false,
    });
    expect(info.blocked).toBeUndefined();
    expect(info.flavors).toEqual([
      {
        id: '1_flav0360',
        width: 640,
        height: 360,
        bitrate: 190,
        sizeBytes: 3061 * 1024,
        fileExt: 'mp4',
      },
      {
        id: '1_flav0480',
        width: 854,
        height: 480,
        bitrate: 234,
        sizeBytes: 3778 * 1024,
        fileExt: 'mp4',
      },
      {
        id: '1_flav0720',
        width: 1280,
        height: 720,
        bitrate: 378,
        sizeBytes: 6103 * 1024,
        fileExt: 'mp4',
      },
    ]);
  });

  it('picks the first https "url" source and the first https "applehttp" source', () => {
    const info = parsePlaybackContext(fixture);
    expect(info.progressive?.url).toBe(
      'https://cdnapisec.kaltura.com/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234/flavorIds/1_flav0360,1_flav0480,1_flav0720/deliveryProfileId/9001/protocol/https/format/url/name/a.mp4',
    );
    expect(info.progressive?.flavorIds).toEqual(['1_flav0360', '1_flav0480', '1_flav0720']);
    expect(info.hls?.url).toMatch(/\/deliveryProfileId\/9004\/.*\/format\/applehttp\//);
  });

  it('ignores http "url" sources even when they come first', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        const http = context.sources.find((s: Json) => s.deliveryProfileId === 72);
        const https = context.sources.find((s: Json) => s.deliveryProfileId === 92);
        context.sources = [
          http,
          https,
          ...context.sources.filter((s: Json) => s !== http && s !== https),
        ];
      }),
    );
    expect(info.progressive?.url).toContain('/deliveryProfileId/92/');
  });

  it('has no progressive source when none is served over https', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        context.sources = context.sources.filter(
          (s: Json) => s.format !== 'url' || s.url.startsWith('http://'),
        );
      }),
    );
    expect(info.progressive).toBeUndefined();
    expect(info.hls).toBeDefined();
  });

  it('ignores formats other than url and applehttp', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        context.sources = context.sources.filter(
          (s: Json) => s.format !== 'url' && s.format !== 'applehttp',
        );
      }),
    );
    expect(info.progressive).toBeUndefined();
    expect(info.hls).toBeUndefined();
    expect(info.isProtected).toBe(false);
  });

  it('skips flavors that are not ready and leaves sizeBytes out when the size is unknown', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        context.flavorAssets[0].status = 4;
        delete context.flavorAssets[1].size;
      }),
    );
    expect(info.flavors.map((f) => f.id)).toEqual(['1_flav0480', '1_flav0720']);
    expect(info.flavors[0]?.sizeBytes).toBeUndefined();
  });

  it('falls back to msDuration and to the entry id as title', () => {
    const info = parsePlaybackContext(
      sample((response) => {
        const entry = response[0]?.['objects'][0];
        delete entry.duration;
        delete entry.name;
        entry.msDuration = 90500;
      }),
    );
    expect(info.durationSeconds).toBe(90.5);
    expect(info.title).toBe('1_abcd1234');
  });

  it('treats negative, fractional or non-finite flavor numbers as unknown', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        Object.assign(context.flavorAssets[0], { width: -640, height: 360.5, bitrate: NaN });
        Object.assign(context.flavorAssets[1], { size: 3778.5 });
        Object.assign(context.flavorAssets[2], { size: -1, width: Infinity });
      }),
    );
    expect(info.flavors[0]).toMatchObject({ width: 0, height: 0, bitrate: 0 });
    expect(info.flavors[1]?.sizeBytes).toBeUndefined();
    expect(info.flavors[2]?.sizeBytes).toBeUndefined();
    expect(info.flavors[2]?.width).toBe(0);
  });

  it('treats a negative duration as unknown', () => {
    const info = parsePlaybackContext(
      sample((response) => {
        const entry = response[0]?.['objects'][0];
        entry.duration = -5;
        entry.msDuration = -5000;
      }),
    );
    expect(info.durationSeconds).toBe(0);
  });

  describe('protection', () => {
    const widevine = [
      { scheme: 'widevine.WidevineCencDrmProfile', licenseURL: 'https://license.example.com' },
    ];

    it('is protected when a source we would download has DRM', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.sources.find((s: Json) => s.format === 'applehttp').drm = widevine;
        }),
      );
      expect(info.isProtected).toBe(true);
      expect(info.progressive).toBeUndefined();
      expect(info.hls).toBeUndefined();
    });

    it('is protected when only a format we ignore has DRM', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.sources.find((s: Json) => s.format === 'mpegdash').drm = widevine;
        }),
      );
      expect(info.isProtected).toBe(true);
      expect(info.progressive).toBeUndefined();
    });

    it('treats an unexpected drm value as protected', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.sources[0].drm = 'unknown';
        }),
      );
      expect(info.isProtected).toBe(true);
    });

    it('is not protected when drm is missing', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          for (const source of context.sources) delete source.drm;
        }),
      );
      expect(info.isProtected).toBe(false);
      expect(info.progressive).toBeDefined();
    });
  });

  describe('access control', () => {
    it('is blocked by a BLOCK action and exposes the message', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.actions = [{ type: '1', objectType: 'KalturaAccessControlBlockAction' }];
          context.messages = [
            { message: 'This video is only available on campus.', code: 'IP_BLOCK' },
            { message: 'This video is only available on campus.', code: 'IP_BLOCK' },
          ];
        }),
      );
      expect(info.blocked).toEqual({ reason: 'This video is only available on campus.' });
      expect(info.isProtected).toBe(false);
      expect(info.progressive).toBeUndefined();
      expect(info.hls).toBeUndefined();
    });

    it('accepts the action type as a number and falls back to a generic reason', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.actions = [{ type: 1 }];
        }),
      );
      expect(info.blocked?.reason).toMatch(/blocked/i);
    });

    it('treats a PREVIEW action as not downloadable', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.actions = [
            { type: '2', objectType: 'KalturaAccessControlPreviewAction', limit: 30 },
          ];
        }),
      );
      expect(info.blocked?.reason).toMatch(/preview/i);
      expect(info.progressive).toBeUndefined();
    });

    it('ignores actions that do not restrict playback', () => {
      const info = parsePlaybackContext(
        sample((_response, context) => {
          context.actions = [{ type: '3', objectType: 'KalturaAccessControlLimitFlavorsAction' }];
        }),
      );
      expect(info.blocked).toBeUndefined();
      expect(info.progressive).toBeDefined();
    });
  });

  describe('API errors', () => {
    it('throws the code and message of an exception in the array', () => {
      const error = errorOf(() =>
        parsePlaybackContext(
          sample((response) => {
            response[1] = apiException('ENTRY_ID_NOT_FOUND', 'Entry id "1_abcd1234" not found');
          }),
        ),
      );
      expect(error.code).toBe('ENTRY_ID_NOT_FOUND');
      expect(error.message).toBe('Entry id "1_abcd1234" not found');
    });

    it('throws the first exception when several requests fail', () => {
      const error = errorOf(() =>
        parsePlaybackContext([
          apiException('INVALID_KS', 'first'),
          apiException('OTHER', 'second'),
        ]),
      );
      expect(error.code).toBe('INVALID_KS');
    });

    it('throws a top-level exception', () => {
      const error = errorOf(() =>
        parsePlaybackContext(apiException('SERVICE_FORBIDDEN', 'Forbidden')),
      );
      expect(error.code).toBe('SERVICE_FORBIDDEN');
    });

    it('never puts the ks in the message', () => {
      const error = errorOf(() =>
        parsePlaybackContext([
          apiException('INVALID_KS', `Invalid KS "${FAKE_KS}". Error "-1,INVALID_STR"`),
        ]),
      );
      expect(error.code).toBe('INVALID_KS');
      expect(error.message).not.toContain(FAKE_KS);
      expect(error.message).not.toContain(FAKE_KS.slice(0, 20));
      expect(error.message).toBe('Invalid KS "[redacted]". Error "-1,INVALID_STR"');
    });

    it('redacts any token that starts with djJ8, however short', () => {
      const error = errorOf(() =>
        parsePlaybackContext([
          apiException('INVALID_KS', 'Invalid KS "djJ8ZmFrZQ" for partner 1234567'),
        ]),
      );
      expect(error.message).toBe('Invalid KS "[redacted]" for partner 1234567');
    });

    it('only redacts djJ8 at the start of a token', () => {
      const error = errorOf(() =>
        parsePlaybackContext([apiException('X', 'Entry 1_djJ8abcd is hidden')]),
      );
      expect(error.message).toBe('Entry 1_djJ8abcd is hidden');
    });

    it('falls back to the code when the message is missing', () => {
      const error = errorOf(() =>
        parsePlaybackContext({ objectType: 'KalturaAPIException', code: 'INTERNAL_SERVER_ERROR' }),
      );
      expect(error.message).toBe('INTERNAL_SERVER_ERROR');
    });

    it('reports an entry that the list did not return', () => {
      const error = errorOf(() =>
        parsePlaybackContext(
          sample((response) => {
            response[0] = {
              totalCount: 0,
              objects: [],
              objectType: 'KalturaBaseEntryListResponse',
            };
          }),
        ),
      );
      expect(error.code).toBe('ENTRY_ID_NOT_FOUND');
    });

    it('rejects responses that are not a multirequest result', () => {
      expect(() => parsePlaybackContext('<html></html>')).toThrow(/unexpected response/i);
      expect(() => parsePlaybackContext([])).toThrow(/no playback context/i);
    });
  });

  it('returns nothing that looks like a ks', () => {
    const serialized = JSON.stringify(parsePlaybackContext(fixture));
    expect(serialized).not.toMatch(/\/ks\/|[?&]ks=/);
  });

  it('drops a ks that the API echoes in a source URL', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        const source = context.sources.find((s: Json) => s.format === 'url');
        source.url = source.url.replace('/playManifest/', `/playManifest/ks/${FAKE_KS}/`);
        const hls = context.sources.find((s: Json) => s.format === 'applehttp');
        hls.url = `${hls.url}?ks=${FAKE_KS}`;
      }),
    );
    expect(JSON.stringify(info)).not.toContain(FAKE_KS);
    expect(info.progressive?.url).toContain('/playManifest/entryId/');
    expect(info.hls?.url).toMatch(/a\.m3u8$/);
  });
});

describe('captions', () => {
  const VTT =
    'https://cdnapisec.kaltura.com/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_cap00001';

  const withCaptions = (captions: Json[]) =>
    parsePlaybackContext(
      sample((_response, context) => {
        context.playbackCaptions = captions;
      }),
    );

  it('is empty for the sample response', () => {
    expect(parsePlaybackContext(fixture).captions).toEqual([]);
  });

  it('lists tracks by webVttUrl, not by the original file url', () => {
    const info = withCaptions([
      {
        label: 'English',
        language: 'English',
        languageCode: 'en',
        format: '2',
        isDefault: true,
        url: 'https://cdnapisec.kaltura.com/serve/original.dfxp',
        webVttUrl: `${VTT}/version/1`,
      },
      { language: 'Spanish', languageCode: 'es', webVttUrl: `${VTT}2/version/1` },
    ]);
    expect(info.captions).toEqual([
      { label: 'English', languageCode: 'en', isDefault: true, url: `${VTT}/version/1` },
      { label: 'Spanish', languageCode: 'es', isDefault: false, url: `${VTT}2/version/1` },
    ]);
  });

  it('keeps webVttUrl exactly as the API gives it, segmentIndex included', () => {
    const urls = [
      `${VTT}/segmentDuration/900/segmentIndex/3/version/1`,
      `${VTT}?segmentIndex=3&format=vtt`,
      `${VTT}/version/1?a=b%20c`,
      `${VTT}/segmentIndex/{segmentIndex}`,
    ];
    const info = withCaptions(urls.map((webVttUrl) => ({ label: 'x', webVttUrl })));
    expect(info.captions.map((c) => c.url)).toEqual(urls);
  });

  it('skips tracks without a usable webVttUrl', () => {
    const info = withCaptions([
      { label: 'No VTT', url: 'https://cdnapisec.kaltura.com/serve/a.srt' },
      { label: 'Bad', webVttUrl: 'javascript:alert(1)' },
      { label: 'Garbage', webVttUrl: 42 },
      { label: 'Good', webVttUrl: VTT },
    ]);
    expect(info.captions.map((c) => c.label)).toEqual(['Good']);
  });

  it('labels a track from language, language code or a default', () => {
    const info = withCaptions([
      { language: 'French', webVttUrl: `${VTT}1` },
      { languageCode: 'de', webVttUrl: `${VTT}2` },
      { webVttUrl: `${VTT}3` },
    ]);
    expect(info.captions.map((c) => c.label)).toEqual(['French', 'de', 'Captions']);
  });

  it('offers no captions when the video is protected', () => {
    const info = parsePlaybackContext(
      sample((_response, context) => {
        context.playbackCaptions = [{ label: 'English', webVttUrl: VTT }];
        context.sources[0].drm = [{ scheme: 'widevine' }];
      }),
    );
    expect(info.captions).toEqual([]);
  });
});

describe('flavorUrl', () => {
  const source = parsePlaybackContext(fixture).progressive;
  if (!source) throw new Error('the sample has no progressive source');

  it('narrows the flavorIds list to one flavor and changes nothing else', () => {
    expect(flavorUrl(source, '1_flav0720')).toBe(
      'https://cdnapisec.kaltura.com/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234/flavorIds/1_flav0720/deliveryProfileId/9001/protocol/https/format/url/name/a.mp4',
    );
  });

  it('rejects a flavor the source does not serve', () => {
    expect(() => flavorUrl(source, '1_other')).toThrow(/1_other/);
  });

  it('rejects a source URL without a flavorIds segment', () => {
    const bad = {
      url: 'https://cdnapisec.kaltura.com/p/1/playManifest/entryId/x',
      flavorIds: ['1_a'],
    };
    expect(() => flavorUrl(bad, '1_a')).toThrow(/flavorIds/);
  });
});

describe('withKs', () => {
  const KALTURA = ['https://cdnapisec.kaltura.com'];
  const add = (url: string, ks: string, origins: readonly string[] = KALTURA) =>
    withKs(url, ks, origins);
  const HOST = 'https://cdnapisec.kaltura.com/p/1234567/sp/1234567';

  // After "playManifest" the path is key/value pairs plus an optional lone file name.
  function pairsOf(url: string): [string, string][] {
    const parts = new URL(url).pathname.split('/');
    const rest = parts.slice(parts.indexOf('playManifest') + 1);
    if (rest.length % 2 === 1) rest.pop();
    return Array.from({ length: rest.length / 2 }, (_, i) => [
      rest[2 * i] ?? '',
      rest[2 * i + 1] ?? '',
    ]);
  }

  describe('playManifest URLs', () => {
    it('inserts ks/<value> before the file name of an HLS URL', () => {
      expect(
        add(
          `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_flav0360,1_flav0480/a.m3u8`,
          FAKE_KS,
        ),
      ).toBe(
        `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_flav0360,1_flav0480/ks/${FAKE_KS}/a.m3u8`,
      );
    });

    it('keeps name/a.mp4 as the last pair of a progressive URL', () => {
      const url = `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_flav0720/deliveryProfileId/9001/protocol/https/format/url/name/a.mp4`;
      expect(add(url, FAKE_KS)).toBe(
        `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_flav0720/deliveryProfileId/9001/protocol/https/format/url/ks/${FAKE_KS}/name/a.mp4`,
      );
    });

    it('keeps every key/value pair aligned, with and without a file name', () => {
      const urls = [
        `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_a/a.m3u8`,
        `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_a/format/applehttp/a.m3u8`,
        `${HOST}/playManifest/entryId/1_abcd1234/flavorIds/1_a/name/a.mp4`,
        `${HOST}/playManifest/entryId/1_abcd1234`,
      ];
      for (const url of urls) {
        const before = pairsOf(url);
        const after = pairsOf(add(url, FAKE_KS));
        expect(after).toHaveLength(before.length + 1);
        expect(after.filter(([key]) => key === 'ks')).toEqual([['ks', FAKE_KS]]);
        expect(after.filter(([key]) => key !== 'ks')).toEqual(before);
        expect(add(url, FAKE_KS).endsWith(url.split('/').slice(-1)[0] ?? '')).toBe(true);
      }
    });

    it('works on the URLs of the sample response, one flavor at a time', () => {
      const { progressive, hls } = parsePlaybackContext(fixture);
      if (!progressive || !hls) throw new Error('the sample has no sources');
      const mp4 = add(flavorUrl(progressive, '1_flav0360'), FAKE_KS);
      expect(mp4).toContain(
        `/flavorIds/1_flav0360/deliveryProfileId/9001/protocol/https/format/url/ks/${FAKE_KS}/name/a.mp4`,
      );
      expect(add(hls.url, FAKE_KS)).toContain(`/format/applehttp/ks/${FAKE_KS}/a.m3u8`);
    });

    it('keeps "=" padding readable and escapes what would break the path', () => {
      const url = add(`${HOST}/playManifest/entryId/x/flavorIds/1_a/a.m3u8`, 'ab=/c d');
      expect(url).toContain('/ks/ab=%2Fc%20d/a.m3u8');
    });

    it('rejects a playManifest URL without parameters', () => {
      expect(() => add(`${HOST}/playManifest`, FAKE_KS)).toThrow(/no parameters/);
    });
  });

  describe('api_v3 URLs', () => {
    const CAPTION =
      'https://cdnapisec.kaltura.com/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_cap00001/segmentIndex/-1';

    it('adds ?ks= when there is no query', () => {
      expect(add(CAPTION, FAKE_KS)).toBe(`${CAPTION}?ks=${encodeURIComponent(FAKE_KS)}`);
    });

    it('appends &ks= after an existing query, which stays byte for byte', () => {
      const url = `${CAPTION}?a=b%20c&d=e`;
      expect(add(url, FAKE_KS)).toBe(`${url}&ks=${encodeURIComponent(FAKE_KS)}`);
    });

    it('replaces a ks that the URL already has', () => {
      const result = new URL(add(`${CAPTION}?ks=old&a=b`, FAKE_KS));
      expect(result.searchParams.getAll('ks')).toEqual([FAKE_KS]);
      expect(result.searchParams.get('a')).toBe('b');
    });

    it('also matches a bare /api_v3 path', () => {
      expect(add('https://cdnapisec.kaltura.com/api_v3', 'k')).toContain('?ks=k');
    });
  });

  describe('rejections', () => {
    it('refuses URLs it does not know how to place a ks in', () => {
      expect(() => add('https://cdnapisec.kaltura.com/video.mp4', FAKE_KS)).toThrow(/unknown kind/);
      expect(() =>
        add('https://cdnapisec.kaltura.com/p/1/thumbnail/entry_id/x', FAKE_KS),
      ).toThrow();
    });

    it('refuses invalid or non-http(s) URLs and a missing ks', () => {
      expect(() => add('not a url', FAKE_KS)).toThrow(/valid URL/);
      expect(() => add('javascript:alert(1)', FAKE_KS)).toThrow(/http/);
      expect(() => add(`${'https://x.example.com/api_v3'}`, '')).toThrow(/ks is required/);
    });

    it('never puts the ks in an error message', () => {
      for (const url of [
        'https://example.com/video.mp4',
        'not a url',
        'ftp://x.example.com/api_v3',
      ]) {
        const attempt = () => add(url, FAKE_KS);
        expect(attempt).toThrow();
        expect(attempt).not.toThrow(FAKE_KS);
      }
    });
  });

  describe('origins', () => {
    const MANIFEST = '/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234/flavorIds/1_a/a.m3u8';
    const CAPTION =
      '/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_c';

    it('works with a self-hosted Kaltura whose origin is listed', () => {
      const origins = ['https://video.example.edu'];
      expect(withKs(`https://video.example.edu${MANIFEST}`, FAKE_KS, origins)).toBe(
        `https://video.example.edu${MANIFEST.replace('/a.m3u8', `/ks/${FAKE_KS}/a.m3u8`)}`,
      );
      expect(withKs(`https://video.example.edu${CAPTION}`, FAKE_KS, origins)).toBe(
        `https://video.example.edu${CAPTION}?ks=${encodeURIComponent(FAKE_KS)}`,
      );
    });

    it('does not trust kaltura.com by name when it is not listed', () => {
      const origins = ['https://video.example.edu'];
      expect(() => withKs(`https://cdnapisec.kaltura.com${MANIFEST}`, FAKE_KS, origins)).toThrow(
        /not one of the player's origins/,
      );
    });

    it('accepts any of several origins (serviceUrl and cdnUrl)', () => {
      const origins = ['https://api.example.edu', 'https://cdn.example.edu:8443'];
      expect(withKs(`https://api.example.edu${CAPTION}`, 'k', origins)).toContain('?ks=k');
      expect(withKs(`https://cdn.example.edu:8443${MANIFEST}`, 'k', origins)).toContain('/ks/k/');
    });

    it('reduces listed URLs to their origin', () => {
      const origins = ['https://video.example.edu/some/prefix/', 'https://cdn.example.edu?x=1'];
      expect(withKs(`https://video.example.edu${MANIFEST}`, 'k', origins)).toContain('/ks/k/');
      expect(withKs(`https://cdn.example.edu${MANIFEST}`, 'k', origins)).toContain('/ks/k/');
    });

    it('rejects look-alike hosts, other ports and other schemes', () => {
      const origins = ['https://cdnapisec.kaltura.com'];
      const lookAlikes = [
        'https://cdnapisec.kaltura.com.evil.example',
        'https://evil.example/https://cdnapisec.kaltura.com',
        'https://cdnapisec.kaltura.com@evil.example',
        'https://xcdnapisec.kaltura.com',
        'https://kaltura.com',
        'https://cdnapisec.kaltura.com:8443',
        'http://cdnapisec.kaltura.com',
      ];
      for (const base of lookAlikes) {
        const attempt = () => withKs(`${base}${MANIFEST}`, FAKE_KS, origins);
        expect(attempt, base).toThrow(/not one of the player's origins/);
        expect(attempt, base).not.toThrow(FAKE_KS);
        expect(() => withKs(`${base}${CAPTION}`, FAKE_KS, origins), base).toThrow();
      }
    });

    it('rejects everything when the list is empty or has no usable entry', () => {
      const url = `https://cdnapisec.kaltura.com${MANIFEST}`;
      expect(() => withKs(url, FAKE_KS, [])).toThrow(/player's origins/);
      expect(() => withKs(url, FAKE_KS, ['not a url', 'ftp://cdnapisec.kaltura.com', ''])).toThrow(
        /player's origins/,
      );
    });

    it('still requires a Kaltura URL shape on a listed origin', () => {
      expect(() =>
        withKs('https://video.example.edu/files/lecture.mp4', FAKE_KS, [
          'https://video.example.edu',
        ]),
      ).toThrow(/unknown kind/);
    });

    it('names the rejected origin but not the ks', () => {
      expect(() =>
        withKs(`https://evil.example${MANIFEST}`, FAKE_KS, ['https://video.example.edu']),
      ).toThrow('https://evil.example');
    });
  });
});
