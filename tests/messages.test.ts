/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL,
  LIMITS,
  isFetchFailedMessage,
  isMainMessage,
  isVideosMessage,
} from '../lib/messages';
import { parsePlaybackContext } from '../lib/kaltura/playback-context';

const fixture: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
    'utf8',
  ),
);

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const CAPTION_URL =
  'https://cdnapisec.kaltura.com/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_cap00001';

// A message as the MAIN-world script would build it, as a deep copy tests can edit.
function videosMessage(edit?: (video: Json, message: Json) => void): Json {
  const info = parsePlaybackContext(fixture);
  const video = structuredClone({
    ...info,
    captions: [{ label: 'English', languageCode: 'en', isDefault: true, url: CAPTION_URL }],
  }) as Json;
  const message: Json = { channel: CHANNEL, type: 'videos', videos: [video] };
  edit?.(video, message);
  return message;
}

const fetchFailed = (origin = 'https://cdnapisec.kaltura.com'): Json => ({
  channel: CHANNEL,
  type: 'fetch-failed',
  origin,
});

describe('valid messages', () => {
  it('accepts a listing built from the sample response', () => {
    expect(isVideosMessage(videosMessage())).toBe(true);
    expect(isMainMessage(videosMessage())).toBe(true);
  });

  it('accepts a listing with no videos and one with a protected video', () => {
    expect(isVideosMessage(videosMessage((_video, message) => (message['videos'] = [])))).toBe(
      true,
    );
    const protectedVideo = parsePlaybackContext(
      (() => {
        const response = structuredClone(fixture) as Json[];
        (response[1] as Json)['sources'][0].drm = [{ scheme: 'widevine' }];
        return response;
      })(),
    );
    expect(isVideosMessage({ channel: CHANNEL, type: 'videos', videos: [protectedVideo] })).toBe(
      true,
    );
  });

  it('accepts a blocked video and optional fields left out', () => {
    const message = videosMessage((video) => {
      delete video['progressive'];
      delete video['hls'];
      video['captions'] = [{ label: 'x', isDefault: false, url: CAPTION_URL }];
      video['blocked'] = { reason: 'Only available on campus.' };
      video['flavors'] = [{ id: '1_a', width: 0, height: 0, bitrate: 0 }];
      video['captions'] = [];
    });
    expect(isVideosMessage(message)).toBe(true);
  });

  it('accepts a fetch-failed message', () => {
    expect(isFetchFailedMessage(fetchFailed())).toBe(true);
    expect(isMainMessage(fetchFailed('http://localhost:8080'))).toBe(true);
  });
});

describe('foreign messages are ignored', () => {
  const foreign: unknown[] = [
    undefined,
    null,
    'kalgrab',
    42,
    [],
    [videosMessage()],
    {},
    { type: 'videos', videos: [] },
    { channel: 'other', type: 'videos', videos: [] },
    { channel: 'KALGRAB', type: 'videos', videos: [] },
    { channel: CHANNEL },
    { channel: CHANNEL, type: 'unknown' },
    { channel: CHANNEL, type: 'Videos', videos: [] },
    { channel: CHANNEL, type: 42, videos: [] },
    { channel: CHANNEL, type: ['videos'], videos: [] },
    { source: 'react-devtools-content-script', payload: {} },
  ];

  it.each(foreign.map((value, i) => [i, value]))('rejects sample %i', (_i, value) => {
    expect(isMainMessage(value)).toBe(false);
    expect(isVideosMessage(value)).toBe(false);
    expect(isFetchFailedMessage(value)).toBe(false);
  });

  it('rejects objects that are not plain data', () => {
    class Forged {
      channel = CHANNEL;
      type = 'videos';
      videos = [];
    }
    expect(isMainMessage(new Forged())).toBe(false);
    expect(isMainMessage(Object.create({ channel: CHANNEL, type: 'videos', videos: [] }))).toBe(
      false,
    );
    expect(isMainMessage(new Map())).toBe(false);
  });

  it('does not run on inherited properties', () => {
    const inherited = Object.create(null);
    inherited.channel = CHANNEL;
    inherited.type = 'videos';
    expect(isMainMessage(inherited)).toBe(false);
  });
});

describe('malformed messages', () => {
  const broken: [string, (video: Json, message: Json) => void][] = [
    ['videos is not an array', (_v, m) => (m['videos'] = {})],
    ['videos has a non-object', (_v, m) => (m['videos'] = [1])],
    [
      'videos has a hole',
      (_v, m) => {
        const list = new Array(2);
        list[1] = videosMessage()['videos'][0];
        m['videos'] = list;
      },
    ],
    ['missing entryId', (v) => delete v['entryId']],
    ['entryId not a string', (v) => (v['entryId'] = 12)],
    ['entryId with a slash', (v) => (v['entryId'] = '1_a/../b')],
    ['entryId empty', (v) => (v['entryId'] = '')],
    ['title not a string', (v) => (v['title'] = { toString: 'x' })],
    ['durationSeconds NaN', (v) => (v['durationSeconds'] = NaN)],
    ['durationSeconds Infinity', (v) => (v['durationSeconds'] = Infinity)],
    ['durationSeconds negative', (v) => (v['durationSeconds'] = -1)],
    ['durationSeconds a string', (v) => (v['durationSeconds'] = '132')],
    ['isProtected a string', (v) => (v['isProtected'] = 'false')],
    ['flavors not an array', (v) => (v['flavors'] = 'x')],
    ['flavor without id', (v) => delete v['flavors'][0].id],
    ['flavor width negative', (v) => (v['flavors'][0].width = -640)],
    ['flavor bitrate a string', (v) => (v['flavors'][0].bitrate = '378')],
    ['flavor sizeBytes absurd', (v) => (v['flavors'][0].sizeBytes = 1e30)],
    ['flavor fileExt with a dot', (v) => (v['flavors'][0].fileExt = '.exe')],
    ['caption without url', (v) => delete v['captions'][0].url],
    ['caption isDefault a number', (v) => (v['captions'][0].isDefault = 1)],
    ['caption languageCode not a string', (v) => (v['captions'][0].languageCode = ['en'])],
    ['blocked without reason', (v) => (v['blocked'] = {})],
    ['blocked reason empty', (v) => (v['blocked'] = { reason: '' })],
    ['blocked a string', (v) => (v['blocked'] = 'yes')],
    ['source without flavorIds', (v) => delete v['progressive'].flavorIds],
    ['source flavorIds not strings', (v) => (v['progressive'].flavorIds = [1, 2])],
    ['source flavorId with a comma', (v) => (v['progressive'].flavorIds = ['1_a,1_b'])],
    ['optional field set to undefined', (v) => (v['hls'] = undefined)],
    ['optional field set to null', (v) => (v['progressive'] = null)],
  ];

  it.each(broken)('rejects: %s', (_name, edit) => {
    expect(isVideosMessage(videosMessage(edit))).toBe(false);
  });

  describe('numbers', () => {
    const counts: [string, (v: Json, n: unknown) => void][] = [
      ['flavor width', (v, n) => (v['flavors'][0].width = n)],
      ['flavor height', (v, n) => (v['flavors'][0].height = n)],
      ['flavor bitrate', (v, n) => (v['flavors'][0].bitrate = n)],
      ['flavor sizeBytes', (v, n) => (v['flavors'][0].sizeBytes = n)],
    ];
    const duration: [string, (v: Json, n: unknown) => void] = [
      'durationSeconds',
      (v, n) => (v['durationSeconds'] = n),
    ];
    const notANumber = [NaN, Infinity, -Infinity, -1, -0.5, '1', null, true, 10n];

    for (const [name, set] of [...counts, duration]) {
      it.each(notANumber.map((n) => [String(n), n]))(`rejects ${name}: %s`, (_label, n) => {
        expect(isVideosMessage(videosMessage((v) => set(v, n)))).toBe(false);
      });

      it(`accepts ${name}: 0`, () => {
        expect(isVideosMessage(videosMessage((v) => set(v, 0)))).toBe(true);
      });
    }

    it.each(counts)('rejects a fractional %s', (_name, set) => {
      expect(isVideosMessage(videosMessage((v) => set(v, 640.5)))).toBe(false);
    });

    it('accepts a fractional durationSeconds', () => {
      expect(isVideosMessage(videosMessage((v) => (v['durationSeconds'] = 90.5)))).toBe(true);
    });
  });

  it('rejects a message with missing required fields', () => {
    expect(isMainMessage({ channel: CHANNEL, type: 'videos' })).toBe(false);
    expect(isMainMessage({ channel: CHANNEL, type: 'fetch-failed' })).toBe(false);
  });

  it('rejects fields that are not part of the shape, at every level', () => {
    expect(isVideosMessage({ ...videosMessage(), extra: 1 })).toBe(false);
    expect(isVideosMessage(videosMessage((v) => (v['extra'] = 1)))).toBe(false);
    expect(isVideosMessage(videosMessage((v) => (v['flavors'][0].extra = 1)))).toBe(false);
    expect(isVideosMessage(videosMessage((v) => (v['captions'][0].extra = 1)))).toBe(false);
    expect(isVideosMessage(videosMessage((v) => (v['progressive'].extra = 1)))).toBe(false);
    expect(isVideosMessage(videosMessage((v) => (v['blocked'] = { reason: 'x', extra: 1 })))).toBe(
      false,
    );
    expect(isFetchFailedMessage({ ...fetchFailed(), extra: 1 })).toBe(false);
  });

  it('rejects a __proto__ key', () => {
    const message = JSON.parse(
      `{"channel":"${CHANNEL}","type":"fetch-failed","origin":"https://a.example.com","__proto__":{"x":1}}`,
    );
    expect(isMainMessage(message)).toBe(false);
  });

  it('rejects fetch-failed origins that are not plain http(s) origins', () => {
    for (const origin of [
      'https://cdnapisec.kaltura.com/',
      'https://cdnapisec.kaltura.com/api_v3',
      'https://user:pw@cdnapisec.kaltura.com',
      'ftp://cdnapisec.kaltura.com',
      'javascript:alert(1)',
      'cdnapisec.kaltura.com',
      '',
      42,
    ]) {
      expect(isFetchFailedMessage({ ...fetchFailed(), origin }), String(origin)).toBe(false);
    }
  });
});

describe('protected and blocked videos', () => {
  const offers: [string, (v: Json) => void][] = [
    ['a progressive source', (v) => (v['progressive'] = { url: CAPTION_URL, flavorIds: ['1_a'] })],
    ['an hls source', (v) => (v['hls'] = { url: CAPTION_URL, flavorIds: ['1_a'] })],
    ['a caption', (v) => (v['captions'] = [{ label: 'x', isDefault: false, url: CAPTION_URL }])],
  ];

  const restrictions: [string, (v: Json) => void][] = [
    ['protected', (v) => (v['isProtected'] = true)],
    ['blocked', (v) => (v['blocked'] = { reason: 'Only available on campus.' })],
  ];

  for (const [restriction, restrict] of restrictions) {
    it(`accepts a ${restriction} video that offers nothing`, () => {
      const message = videosMessage((v) => {
        restrict(v);
        delete v['progressive'];
        delete v['hls'];
        v['captions'] = [];
      });
      expect(isVideosMessage(message)).toBe(true);
    });

    it.each(offers)(`rejects a ${restriction} video that offers %s`, (_name, offer) => {
      const message = videosMessage((v) => {
        restrict(v);
        delete v['progressive'];
        delete v['hls'];
        v['captions'] = [];
        offer(v);
      });
      expect(isVideosMessage(message)).toBe(false);
    });
  }

  it('rejects the sample video marked as protected without removing its sources', () => {
    expect(isVideosMessage(videosMessage((v) => (v['isProtected'] = true)))).toBe(false);
  });
});

describe('URLs', () => {
  const urlSlots: [string, (video: Json, url: string) => void][] = [
    ['progressive url', (v, url) => (v['progressive'].url = url)],
    ['hls url', (v, url) => (v['hls'].url = url)],
    ['caption url', (v, url) => (v['captions'][0].url = url)],
  ];

  const badUrls = [
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'ftp://cdnapisec.kaltura.com/a.mp4',
    'blob:https://example.com/uuid',
    '//cdnapisec.kaltura.com/a.mp4',
    '/relative/a.mp4',
    'not a url',
    'https://',
    'https://user:pw@cdnapisec.kaltura.com/a.mp4',
    '',
  ];

  for (const [slot, set] of urlSlots) {
    it.each(badUrls)(`rejects ${slot}: %s`, (url) => {
      expect(isVideosMessage(videosMessage((v) => set(v, url)))).toBe(false);
    });

    it(`rejects a non-string ${slot}`, () => {
      expect(isVideosMessage(videosMessage((v) => set(v, 42 as unknown as string)))).toBe(false);
    });
  }

  it('accepts http and https', () => {
    for (const url of [
      'http://cdnapi.kaltura.com/a.mp4',
      'https://video.example.edu:8443/a.m3u8',
    ]) {
      expect(isVideosMessage(videosMessage((v) => (v['progressive'].url = url)))).toBe(true);
    }
  });
});

describe('size limits', () => {
  const at = (n: number, fill = 'a') => fill.repeat(n);

  it('accepts values exactly at the limits and rejects one more', () => {
    const cases: [string, (v: Json, n: number) => void, number][] = [
      ['title', (v, n) => (v['title'] = at(n)), LIMITS.title],
      ['entryId', (v, n) => (v['entryId'] = at(n)), LIMITS.id],
      ['caption label', (v, n) => (v['captions'][0].label = at(n)), LIMITS.label],
      ['languageCode', (v, n) => (v['captions'][0].languageCode = at(n)), LIMITS.languageCode],
      ['fileExt', (v, n) => (v['flavors'][0].fileExt = at(n)), LIMITS.fileExt],
      ['blocked reason', (v, n) => (v['blocked'] = { reason: at(n) }), LIMITS.reason],
      [
        'url',
        (v, n) => (v['progressive'].url = `https://cdnapisec.kaltura.com/${at(n - 30, 'p')}`),
        LIMITS.url,
      ],
    ];
    for (const [name, set, limit] of cases) {
      // A blocked video may not carry sources or captions, so only the string is under test.
      const atLimit = videosMessage((v) => {
        set(v, limit);
        if (name === 'blocked reason') {
          delete v['progressive'];
          delete v['hls'];
          v['captions'] = [];
        }
      });
      const over = videosMessage((v) => {
        set(v, limit + 1);
        if (name === 'blocked reason') {
          delete v['progressive'];
          delete v['hls'];
          v['captions'] = [];
        }
      });
      expect(isVideosMessage(atLimit), `${name} at the limit`).toBe(true);
      expect(isVideosMessage(over), `${name} over the limit`).toBe(false);
    }
  });

  it('limits the number of videos', () => {
    const one = videosMessage()['videos'][0];
    expect(
      isVideosMessage({ channel: CHANNEL, type: 'videos', videos: Array(LIMITS.videos).fill(one) }),
    ).toBe(true);
    expect(
      isVideosMessage({
        channel: CHANNEL,
        type: 'videos',
        videos: Array(LIMITS.videos + 1).fill(one),
      }),
    ).toBe(false);
  });

  it('limits flavors, captions and flavor ids per video', () => {
    const flavor = { id: '1_a', width: 1, height: 1, bitrate: 1 };
    const caption = { label: 'x', isDefault: false, url: CAPTION_URL };
    const lists: [string, (v: Json, n: number) => void, number][] = [
      ['flavors', (v, n) => (v['flavors'] = Array(n).fill(flavor)), LIMITS.flavors],
      ['captions', (v, n) => (v['captions'] = Array(n).fill(caption)), LIMITS.captions],
      [
        'flavorIds',
        (v, n) => (v['progressive'].flavorIds = Array(n).fill('1_a')),
        LIMITS.flavorIds,
      ],
    ];
    for (const [name, set, limit] of lists) {
      expect(isVideosMessage(videosMessage((v) => set(v, limit))), `${name} at the limit`).toBe(
        true,
      );
      expect(isVideosMessage(videosMessage((v) => set(v, limit + 1))), `${name} over`).toBe(false);
    }
  });

  it('rejects absurd numbers', () => {
    expect(isVideosMessage(videosMessage((v) => (v['durationSeconds'] = 1e9)))).toBe(false);
    expect(isVideosMessage(videosMessage((v) => (v['flavors'][0].width = 1e9)))).toBe(false);
  });
});

// Never a real session; nothing here is snapshotted.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const FAKE_V2_KS = 'djJ8ZmFrZS1rcy1mb3ItdGVzdHM';

describe('a ks smuggled into a listing', () => {
  const urlSlots: [string, (video: Json, url: string) => void][] = [
    ['progressive url', (v, url) => (v['progressive'].url = url)],
    ['hls url', (v, url) => (v['hls'].url = url)],
    ['caption url', (v, url) => (v['captions'][0].url = url)],
  ];

  const base = 'https://cdnapisec.kaltura.com/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234';
  const withKs: [string, string][] = [
    ['path pair', `${base}/flavorIds/1_a/ks/${FAKE_KS}/a.m3u8`],
    ['path pair, upper case', `${base}/flavorIds/1_a/KS/${FAKE_KS}/a.m3u8`],
    ['path key without a value', `${base}/flavorIds/1_a/ks`],
    ['query parameter', `${base}/a.m3u8?ks=${FAKE_KS}`],
    ['query parameter after others', `${base}/a.m3u8?a=1&ks=${FAKE_KS}`],
    ['query parameter, upper case', `${base}/a.m3u8?a=1&KS=${FAKE_KS}`],
    ['query parameter without a value', `${base}/a.m3u8?ks&a=1`],
    ['fragment', `${base}/a.m3u8#ks=${FAKE_KS}`],
    ['semicolon parameter', `${base}/a.m3u8;ks=${FAKE_KS}`],
    ['percent-encoded path pair', `${base}/flavorIds/1_a/%6Bs/${FAKE_KS}/a.m3u8`],
    ['percent-encoded slashes', `${base}/flavorIds/1_a%2Fks%2F${FAKE_KS}/a.m3u8`],
    ['percent-encoded parameter name', `${base}/a.m3u8?%6Bs=${FAKE_KS}`],
    ['double-encoded path pair', `${base}/flavorIds/1_a%252Fks%252F${FAKE_KS}/a.m3u8`],
    ['v2 token in the path', `${base}/x/${FAKE_V2_KS}/a.m3u8`],
    ['v2 token as another parameter', `${base}/a.m3u8?token=${FAKE_V2_KS}`],
    ['v2 token in the fragment', `${base}/a.m3u8#${FAKE_V2_KS}`],
  ];

  for (const [slot, set] of urlSlots) {
    it.each(withKs)(`rejects ${slot} with a ks as: %s`, (_name, url) => {
      expect(isVideosMessage(videosMessage((v) => set(v, url)))).toBe(false);
    });
  }

  it('accepts URLs that merely look similar', () => {
    for (const url of [
      `${base}/flavorIds/1_a/a.m3u8`,
      `${base}/a.m3u8?links=1&pks=2&tasks=3`,
      `${base}/ks-info/a.m3u8`,
      `${base}/tasks/a.m3u8`,
      `${base}/a.m3u8?name=ks`,
      `${base}/a.m3u8?x=1_${FAKE_V2_KS}`,
    ]) {
      expect(isVideosMessage(videosMessage((v) => (v['hls'].url = url))), url).toBe(true);
    }
  });

  it('rejects a v2 token in any text field', () => {
    const edits: [string, (v: Json) => void][] = [
      ['title', (v) => (v['title'] = `Lecture ${FAKE_V2_KS}`)],
      ['title, after a separator', (v) => (v['title'] = `session=${FAKE_V2_KS}`)],
      ['entryId', (v) => (v['entryId'] = FAKE_V2_KS)],
      ['caption label', (v) => (v['captions'][0].label = FAKE_V2_KS)],
      ['languageCode', (v) => (v['captions'][0].languageCode = FAKE_V2_KS)],
      ['flavor id', (v) => (v['flavors'][0].id = FAKE_V2_KS)],
      ['flavorIds', (v) => (v['progressive'].flavorIds = ['1_a', FAKE_V2_KS])],
      [
        'blocked reason',
        (v) => {
          delete v['progressive'];
          delete v['hls'];
          v['captions'] = [];
          v['blocked'] = { reason: `Invalid KS "${FAKE_V2_KS}"` };
        },
      ],
    ];
    for (const [name, edit] of edits) {
      expect(isVideosMessage(videosMessage((v) => edit(v))), name).toBe(false);
    }
  });

  it('does not reject a title only because it is long or hash-like', () => {
    const hash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(isVideosMessage(videosMessage((v) => (v['title'] = `lecture_${hash}`)))).toBe(true);
    expect(isVideosMessage(videosMessage((v) => (v['title'] = 'Notes on ksdjJ8 and 1_djJ8')))).toBe(
      true,
    );
  });

  it('rejects a field named ks at any level', () => {
    for (const name of ['ks', 'KS', 'Ks']) {
      const at: [string, (v: Json, m: Json) => void][] = [
        ['message', (_v, m) => (m[name] = FAKE_KS)],
        ['video', (v) => (v[name] = FAKE_KS)],
        ['flavor', (v) => (v['flavors'][0][name] = FAKE_KS)],
        ['caption', (v) => (v['captions'][0][name] = FAKE_KS)],
        ['source', (v) => (v['progressive'][name] = FAKE_KS)],
        ['blocked', (v) => (v['blocked'] = { reason: 'x', [name]: FAKE_KS })],
        ['nested object', (v) => (v['session'] = { [name]: FAKE_KS })],
      ];
      for (const [where, edit] of at) {
        expect(isVideosMessage(videosMessage(edit)), `${name} in ${where}`).toBe(false);
      }
      expect(isFetchFailedMessage({ ...fetchFailed(), [name]: FAKE_KS })).toBe(false);
    }
  });

  it('rejects a ks in a fetch-failed origin', () => {
    expect(isFetchFailedMessage(fetchFailed(`https://${FAKE_V2_KS}.example.com`))).toBe(false);
    expect(isFetchFailedMessage(fetchFailed(`https://cdnapisec.kaltura.com/ks/${FAKE_KS}`))).toBe(
      false,
    );
  });
});
