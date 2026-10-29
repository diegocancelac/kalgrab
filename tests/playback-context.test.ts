/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KalturaApiError,
  buildPlaybackContextRequest,
  buildProgressiveUrl,
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

  it('asks for the whole file: segmentIndex as a path parameter is dropped', () => {
    const info = withCaptions([
      { label: 'English', webVttUrl: `${VTT}/segmentDuration/900/segmentIndex/3/version/1` },
    ]);
    expect(info.captions[0]?.url).toBe(`${VTT}/segmentDuration/900/version/1`);
  });

  it('asks for the whole file: segmentIndex as a query parameter is dropped', () => {
    const info = withCaptions([
      { label: 'English', webVttUrl: `${VTT}?segmentIndex=3&format=vtt` },
    ]);
    expect(info.captions[0]?.url).toBe(`${VTT}?format=vtt`);
  });

  it('leaves a URL without segmentIndex byte for byte', () => {
    const url = `${VTT}/version/1?a=b%20c`;
    expect(withCaptions([{ label: 'x', webVttUrl: url }]).captions[0]?.url).toBe(url);
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

  it('drops a ks that the API echoes in the URL', () => {
    const info = withCaptions([{ label: 'x', webVttUrl: `${VTT}/ks/${FAKE_KS}/version/1` }]);
    expect(info.captions[0]?.url).toBe(`${VTT}/version/1`);
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

describe('buildProgressiveUrl', () => {
  const source = parsePlaybackContext(fixture).progressive;
  if (!source) throw new Error('the sample has no progressive source');

  it('requests a single flavor and carries the ks as a /ks/<value> path segment', () => {
    expect(buildProgressiveUrl(source, '1_flav0720', FAKE_KS)).toBe(
      `https://cdnapisec.kaltura.com/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234/ks/${FAKE_KS}/flavorIds/1_flav0720/deliveryProfileId/9001/protocol/https/format/url/name/a.mp4`,
    );
  });

  it('only changes the flavor and the ks', () => {
    const url = new URL(buildProgressiveUrl(source, '1_flav0360', FAKE_KS));
    const original = new URL(source.url);
    const strip = (u: URL) =>
      u.pathname.replace(/\/ks\/[^/]+/, '').replace(/flavorIds\/[^/]+/, 'flavorIds/-');
    expect(strip(url)).toBe(strip(original));
    expect(url.origin).toBe(original.origin);
  });

  it('keeps the padding of the ks readable and escapes characters that would break the path', () => {
    const url = buildProgressiveUrl(source, '1_flav0360', 'ab=/c d');
    expect(url).toContain('/ks/ab=%2Fc%20d/flavorIds/');
  });

  it('does not leave the ks in the source it was given', () => {
    buildProgressiveUrl(source, '1_flav0720', FAKE_KS);
    expect(JSON.stringify(source)).not.toContain(FAKE_KS);
  });

  it('rejects a flavor the source does not serve, without echoing the ks', () => {
    const attempt = () => buildProgressiveUrl(source, '1_other', FAKE_KS);
    expect(attempt).toThrow(/1_other/);
    expect(attempt).not.toThrow(FAKE_KS);
  });

  it('rejects a source URL without a flavorIds segment', () => {
    const bad = {
      url: 'https://cdnapisec.kaltura.com/p/1/playManifest/entryId/x',
      flavorIds: ['1_a'],
    };
    expect(() => buildProgressiveUrl(bad, '1_a', FAKE_KS)).toThrow(/flavorIds/);
  });

  it('requires a ks', () => {
    expect(() => buildProgressiveUrl(source, '1_flav0720', '')).toThrow(/ks/);
  });
});
