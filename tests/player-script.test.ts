/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlannedUrlWithSession, planProgressiveDownload } from '../lib/download/progressive';
import { CHANNEL, VERSION, isMainMessage, type MainMessage } from '../lib/messages';
import { createPlayerScript } from '../lib/player-script';

// Never a real session or account: the same fake values as the fixtures.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const OTHER_KS = 'b3RoZXItZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDA=';
const PAGE = 'https://kaf.example.edu/browseandembed/index/media/entryid/1_abcd1234';
const API = 'https://www.kaltura.com/api_v3/service/multirequest';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
    'utf8',
  ),
) as Json[];

// The sample response, for the entry the request asked for.
function sampleFor(body: string, edit?: (entry: Json, context: Json) => void): Json[] {
  const response = structuredClone(fixture);
  const entry = response[0]?.['objects'][0];
  entry.id = JSON.parse(body)['1'].filter.redirectFromEntryId;
  edit?.(entry, response[1] as Json);
  return response;
}

function player(entryId = '1_abcd1234', ks = FAKE_KS) {
  return {
    config: {
      provider: {
        partnerId: 1234567,
        ks,
        env: {
          serviceUrl: 'https://www.kaltura.com/api_v3',
          cdnUrl: 'https://cdnapisec.kaltura.com',
        },
      },
      sources: { id: entryId },
    },
  };
}

interface Setup {
  native?: boolean;
  respond?: (body: string) => Promise<Response>;
}

function setup({ native = true, respond }: Setup = {}) {
  const posted: MainMessage[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  let players: Record<string, unknown> | undefined;
  const fetchApi = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const body = String(init?.body);
    return respond ? respond(body) : new Response(JSON.stringify(sampleFor(body)));
  };
  const script = createPlayerScript({
    kalturaPlayer: () => players && { getPlayers: () => players },
    pageUrl: () => PAGE,
    fetch: native ? (fetchApi as typeof fetch) : null,
    post: (message) => posted.push(structuredClone(message)),
  });
  return {
    script,
    posted,
    requests,
    load: (...list: ReturnType<typeof player>[]) => {
      players = Object.fromEntries(list.map((p, i) => [`kplayer${i}`, p]));
    },
    unload: () => (players = {}),
  };
}

const listedIds = (message: MainMessage | undefined) =>
  message?.type === 'videos' ? message.videos.map((v) => v.entryId) : null;

describe('detection', () => {
  it('does nothing before the player library loads', async () => {
    const { script, posted, requests } = setup();
    await script.check();
    expect(requests).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('lists the entry of a player from one request with the captured fetch', async () => {
    const { script, posted, requests, load } = setup();
    load(player());
    await script.check();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(API);
    expect(requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init.body)).ks).toBe(FAKE_KS);

    expect(posted).toHaveLength(1);
    expect(isMainMessage(posted[0])).toBe(true);
    expect(listedIds(posted[0])).toEqual(['1_abcd1234']);
    expect(JSON.stringify(posted)).not.toContain(FAKE_KS);
  });

  it('does not request an entry again while it stays loaded', async () => {
    const { script, posted, requests, load } = setup();
    load(player());
    await script.check();
    await script.check();
    expect(requests).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it('replaces the listing when the player loads another entry', async () => {
    const { script, posted, load } = setup();
    load(player('1_abcd1234'));
    await script.check();
    load(player('1_efgh5678'));
    await script.check();
    expect(posted.map(listedIds)).toEqual([['1_abcd1234'], [], ['1_efgh5678']]);
  });

  it('lists every player of the frame, and an empty list when they go away', async () => {
    const { script, posted, load, unload } = setup();
    load(player('1_abcd1234'), player('1_efgh5678'));
    await script.check();
    expect(listedIds(posted.at(-1))).toEqual(['1_abcd1234', '1_efgh5678']);
    unload();
    await script.check();
    expect(listedIds(posted.at(-1))).toEqual([]);
  });

  it('requests an entry again when it is loaded again later', async () => {
    const { script, requests, load } = setup();
    for (const id of ['1_abcd1234', '1_efgh5678', '1_abcd1234']) {
      load(player(id));
      await script.check();
    }
    expect(requests).toHaveLength(3);
  });

  it('drops an answer that arrives after the player moved on', async () => {
    let release = () => {};
    const respond = (body: string) =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(JSON.stringify(sampleFor(body))));
      });
    const { script, posted, load, unload } = setup({ respond });
    load(player());
    const pending = script.check();
    unload();
    await script.check();
    release();
    await pending;
    expect(posted).toEqual([]);
  });
});

describe('failures', () => {
  it('names the origin once when the request fails, and does not retry', async () => {
    const { script, posted, requests, load } = setup({
      respond: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    load(player('1_abcd1234'), player('1_efgh5678'));
    await script.check();
    await script.check();
    expect(requests).toHaveLength(2);
    expect(posted).toEqual([
      {
        channel: CHANNEL,
        version: VERSION,
        type: 'fetch-failed',
        origin: 'https://www.kaltura.com',
      },
    ]);
  });

  it('leaves out an entry the API refuses, without retrying it', async () => {
    const error = { objectType: 'KalturaAPIException', code: 'INVALID_KS', message: 'Invalid KS' };
    const { script, posted, requests, load } = setup({
      respond: async () => new Response(JSON.stringify(error)),
    });
    load(player());
    await script.check();
    await script.check();
    expect(requests).toHaveLength(1);
    expect(posted).toEqual([]);
  });

  it('leaves out an answer that is not JSON', async () => {
    const { script, posted, load } = setup({
      respond: async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    });
    load(player());
    await script.check();
    expect(posted).toEqual([]);
  });

  it('lists a video without the captions the bridge would refuse', async () => {
    const respond = async (body: string) =>
      new Response(
        JSON.stringify(
          sampleFor(body, (_entry, context) => {
            context['playbackCaptions'] = [
              {
                label: 'English',
                languageCode: 'en',
                isDefault: true,
                webVttUrl: `https://cdnapisec.kaltura.com/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_cap00001/ks/${FAKE_KS}`,
              },
            ];
          }),
        ),
      );
    const { script, posted, load } = setup({ respond });
    load(player());
    await script.check();
    expect(listedIds(posted[0])).toEqual(['1_abcd1234']);
    expect(posted[0]?.type === 'videos' && posted[0].videos[0]?.captions).toEqual([]);
    expect(JSON.stringify(posted)).not.toContain(FAKE_KS);
  });

  it('leaves out a video the bridge would refuse anyway', async () => {
    const respond = async (body: string) =>
      new Response(JSON.stringify(sampleFor(body, (entry) => (entry['name'] = 'a'.repeat(2000)))));
    const { script, posted, load } = setup({ respond });
    load(player());
    await script.check();
    expect(posted).toEqual([]);
  });
});

describe('when fetch was replaced by the page', () => {
  it('requests nothing and asks for a reload once a player shows up, only once', async () => {
    const { script, posted, requests, load } = setup({ native: false });
    await script.check();
    expect(posted).toEqual([]);
    load(player());
    await script.check();
    await script.check();
    expect(requests).toEqual([]);
    expect(posted).toEqual([{ channel: CHANNEL, version: VERSION, type: 'needs-reload' }]);
  });
});

describe('republish', () => {
  it('posts the listing, failed origins and reload request again', async () => {
    const listed = setup();
    listed.load(player());
    await listed.script.check();
    listed.script.republish();
    expect(listed.posted.map(listedIds)).toEqual([['1_abcd1234'], ['1_abcd1234']]);

    const failed = setup({ respond: () => Promise.reject(new TypeError('Failed to fetch')) });
    failed.load(player());
    await failed.script.check();
    failed.script.republish();
    expect(failed.posted.map((m) => m.type)).toEqual(['fetch-failed', 'fetch-failed']);

    const reload = setup({ native: false });
    reload.load(player());
    await reload.script.check();
    reload.script.republish();
    expect(reload.posted.map((m) => m.type)).toEqual(['needs-reload', 'needs-reload']);
  });

  it('posts nothing for a frame without players', async () => {
    const { script, posted } = setup();
    await script.check();
    script.republish();
    expect(posted).toEqual([]);
  });
});

describe('download requests', () => {
  const request = (entryId = '1_abcd1234', flavorId = '1_flav0480') => ({
    channel: CHANNEL,
    version: VERSION,
    type: 'download-request',
    entryId,
    flavorId,
  });

  async function listed(respond?: Setup['respond']) {
    const env = setup({ respond });
    env.load(player());
    await env.script.check();
    const message = env.posted[0];
    if (message?.type !== 'videos' || !message.videos[0]) throw new Error('nothing listed');
    return { ...env, video: message.videos[0] };
  }

  it('answers with the planned flavor URL plus the session and the page as referrer', async () => {
    const { script, video } = await listed();
    const { url } = script.answerDownloadRequest(request()) ?? {};
    if (!url) throw new Error('no url');

    expect(isPlannedUrlWithSession(url, planProgressiveDownload(video, '1_flav0480').url)).toBe(
      true,
    );
    const parsed = new URL(url);
    expect(parsed.pathname).toContain('/flavorIds/1_flav0480/');
    expect(parsed.pathname).toContain(`/ks/${FAKE_KS}/`);
    expect(atob(parsed.searchParams.get('referrer') ?? '')).toBe(PAGE);
  });

  it('uses the ks the player has now', async () => {
    const { script, load } = await listed();
    load(player('1_abcd1234', OTHER_KS));
    await script.check();
    expect(script.answerDownloadRequest(request())?.url).toContain(`/ks/${OTHER_KS}/`);
  });

  it('finds an entry the API redirected by the id it was listed with', async () => {
    const respond = async (body: string) =>
      new Response(JSON.stringify(sampleFor(body, (entry) => (entry['id'] = '1_redirect'))));
    const { script, video } = await listed(respond);
    expect(video.entryId).toBe('1_redirect');
    expect(script.answerDownloadRequest(request('1_redirect'))?.url).toContain('/ks/');
  });

  it('answers without a URL for entries, flavors or videos it cannot serve', async () => {
    const { script } = await listed();
    expect(script.answerDownloadRequest(request('1_unknown'))).toEqual({});
    expect(script.answerDownloadRequest(request('1_abcd1234', '1_other'))).toEqual({});

    const drm = async (body: string) =>
      new Response(
        JSON.stringify(
          sampleFor(body, (_entry, context) => {
            context['sources'][0].drm = [{ scheme: 'widevine' }];
          }),
        ),
      );
    const protectedVideo = await listed(drm);
    expect(protectedVideo.video.isProtected).toBe(true);
    expect(protectedVideo.script.answerDownloadRequest(request())).toEqual({});
  });

  it('answers without a URL when the source is not on the player origins', async () => {
    const respond = async (body: string) => {
      const text = JSON.stringify(sampleFor(body));
      return new Response(text.replaceAll('cdnapisec.kaltura.com', 'cdn.example.com'));
    };
    const { script } = await listed(respond);
    expect(script.answerDownloadRequest(request())).toEqual({});
  });

  it('ignores anything that is not a valid download request', async () => {
    const { script } = await listed();
    const invalid = [
      undefined,
      'download-request',
      { ...request(), version: VERSION + 1 },
      { ...request(), channel: 'other' },
      { ...request(), extra: 1 },
      { ...request(), entryId: '1_a/../b' },
      { ...request(), flavorId: '' },
      { type: 'download-request', entryId: '1_abcd1234', flavorId: '1_flav0480' },
    ];
    for (const value of invalid) {
      expect(script.answerDownloadRequest(value)).toBe(null);
    }
  });
});
