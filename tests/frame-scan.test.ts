/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFrame } from '../lib/frame-scan';
import { CHANNEL, VERSION, isMainMessage, type MainMessage } from '../lib/messages';

// Never a real session or account: the same fake values as the fixtures.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const PAGE = 'https://kaf.example.edu/browseandembed/index/media/entryid/1_abcd1234';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
    'utf8',
  ),
) as Json[];

// The sample response, for the entry the request asked for.
function answer(body: string): Response {
  const response = structuredClone(fixture);
  const entry = response[0]?.['objects'][0];
  entry.id = JSON.parse(body)['1'].filter.redirectFromEntryId;
  return new Response(JSON.stringify(response));
}

const player = (entryId = '1_abcd1234') => ({
  config: {
    provider: {
      partnerId: 1234567,
      ks: FAKE_KS,
      env: {
        serviceUrl: 'https://www.kaltura.com/api_v3',
        cdnUrl: 'https://cdnapisec.kaltura.com',
      },
    },
    sources: { id: entryId },
  },
});

const kalturaPlayer = (...players: unknown[]) => ({
  getPlayers: () => Object.fromEntries(players.map((p, i) => [`kplayer${i}`, p])),
});

function recordingFetch(respond: (body: string) => Promise<Response> = async (b) => answer(b)) {
  const bodies: string[] = [];
  const fetchApi = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    return respond(String(init.body));
  }) as typeof fetch;
  return { fetchApi, bodies };
}

const listed = (messages: MainMessage[]) =>
  messages.flatMap((m) => (m.type === 'videos' ? m.videos.map((v) => v.entryId) : []));

describe('scanFrame', () => {
  it('returns nothing for a frame without players', async () => {
    const { fetchApi, bodies } = recordingFetch();
    for (const value of [undefined, {}, kalturaPlayer(), kalturaPlayer({ config: {} })]) {
      expect(await scanFrame({ kalturaPlayer: value, pageUrl: PAGE, fetch: fetchApi })).toEqual([]);
    }
    expect(bodies).toEqual([]);
  });

  it('lists the players entries with the page fetch, without the ks', async () => {
    const { fetchApi, bodies } = recordingFetch();
    const messages = await scanFrame({
      kalturaPlayer: kalturaPlayer(player('1_abcd1234'), player('1_efgh5678')),
      pageUrl: PAGE,
      fetch: fetchApi,
    });
    expect(bodies).toHaveLength(2);
    expect(messages).toHaveLength(1);
    expect(messages.every(isMainMessage)).toBe(true);
    expect(listed(messages)).toEqual(['1_abcd1234', '1_efgh5678']);
    expect(JSON.stringify(messages)).not.toContain(FAKE_KS);
  });

  it('requests an entry once when two players show it', async () => {
    const { fetchApi, bodies } = recordingFetch();
    await scanFrame({
      kalturaPlayer: kalturaPlayer(player(), player()),
      pageUrl: PAGE,
      fetch: fetchApi,
    });
    expect(bodies).toHaveLength(1);
  });

  it('names a failing origin once and lists what did load', async () => {
    const { fetchApi } = recordingFetch(async (body) => {
      if (body.includes('1_efgh5678') || body.includes('1_ijkl9012')) {
        throw new TypeError('Failed to fetch');
      }
      return answer(body);
    });
    const messages = await scanFrame({
      kalturaPlayer: kalturaPlayer(
        player('1_abcd1234'),
        player('1_efgh5678'),
        player('1_ijkl9012'),
      ),
      pageUrl: PAGE,
      fetch: fetchApi,
    });
    expect(messages.every(isMainMessage)).toBe(true);
    expect(listed(messages)).toEqual(['1_abcd1234']);
    expect(messages.filter((m) => m.type === 'fetch-failed')).toEqual([
      {
        channel: CHANNEL,
        version: VERSION,
        type: 'fetch-failed',
        origin: 'https://www.kaltura.com',
      },
    ]);
  });

  it('returns an empty listing when the players have nothing to list', async () => {
    const error = { objectType: 'KalturaAPIException', code: 'INVALID_KS', message: 'Invalid KS' };
    const { fetchApi } = recordingFetch(async () => new Response(JSON.stringify(error)));
    const messages = await scanFrame({
      kalturaPlayer: kalturaPlayer(player()),
      pageUrl: PAGE,
      fetch: fetchApi,
    });
    expect(messages).toEqual([{ channel: CHANNEL, version: VERSION, type: 'videos', videos: [] }]);
  });

  it('returns the sessions instead of requesting anything when fetch is not native', async () => {
    const messages = await scanFrame({
      kalturaPlayer: kalturaPlayer(
        player('1_abcd1234'),
        player('1_efgh5678'),
        player('1_abcd1234'),
      ),
      pageUrl: PAGE,
      fetch: null,
    });
    expect(messages).toHaveLength(1);
    expect(isMainMessage(messages[0])).toBe(true);
    expect(messages[0]).toMatchObject({ type: 'sessions', pageUrl: PAGE });
    expect(
      messages[0]?.type === 'sessions' && messages[0].sessions.map((s) => [s.entryId, s.ks]),
    ).toEqual([
      ['1_abcd1234', FAKE_KS],
      ['1_efgh5678', FAKE_KS],
    ]);
  });
});
