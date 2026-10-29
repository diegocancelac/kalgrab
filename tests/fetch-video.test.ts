/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchVideo } from '../lib/kaltura/fetch-video';
import type { PlayerSession } from '../lib/kaltura/player-v7';

// Never a real session or account: the same fake values as the fixtures.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
    'utf8',
  ),
) as Json[];

const session: PlayerSession = {
  partnerId: 1234567,
  serviceUrl: 'https://www.kaltura.com/api_v3',
  allowedOrigins: ['https://www.kaltura.com/api_v3', 'https://cdnapisec.kaltura.com'],
  ks: FAKE_KS,
  entryId: '1_abcd1234',
};

function sample(edit?: (entry: Json, context: Json) => void): Response {
  const response = structuredClone(fixture);
  edit?.(response[0]?.['objects'][0], response[1] as Json);
  return new Response(JSON.stringify(response));
}

const answering = (response: () => Promise<Response>) => (async () => response()) as typeof fetch;

describe('fetchVideo', () => {
  it('posts the multirequest to the service URL and lists the entry', async () => {
    const requests: [string, RequestInit][] = [];
    const fetchApi = (async (url: string, init: RequestInit) => {
      requests.push([url, init]);
      return sample();
    }) as typeof fetch;

    const result = await fetchVideo(session, fetchApi);

    expect(result && 'video' in result && result.video.entryId).toBe('1_abcd1234');
    expect(requests).toHaveLength(1);
    const [url, init] = requests[0] ?? [];
    expect(url).toBe('https://www.kaltura.com/api_v3/service/multirequest');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body)).ks).toBe(FAKE_KS);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('names the API origin when the request fails', async () => {
    const result = await fetchVideo(
      session,
      answering(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(result).toEqual({ failedOrigin: 'https://www.kaltura.com' });
  });

  it('gives up after the timeout and names the API origin', async () => {
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('', 'AbortError')));
      })) as typeof fetch;
    expect(await fetchVideo(session, hanging, 10)).toEqual({
      failedOrigin: 'https://www.kaltura.com',
    });
  });

  it('gives up on a body that never ends', async () => {
    const stalled = ((_url: string, init: RequestInit) =>
      Promise.resolve({
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'AbortError')),
            );
          }),
      })) as unknown as typeof fetch;
    expect(await fetchVideo(session, stalled, 10)).toEqual({
      failedOrigin: 'https://www.kaltura.com',
    });
  });

  it('leaves out an entry the API refuses or an answer that is not JSON', async () => {
    const error = { objectType: 'KalturaAPIException', code: 'INVALID_KS', message: 'Invalid KS' };
    const answers = [
      () => Promise.resolve(new Response(JSON.stringify(error))),
      () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })),
    ];
    for (const answer of answers) {
      expect(await fetchVideo(session, answering(answer))).toBe(null);
    }
  });

  it('lists a video without the captions a listing would refuse', async () => {
    const response = sample((_entry, context) => {
      context['playbackCaptions'] = [
        {
          label: 'English',
          languageCode: 'en',
          isDefault: true,
          webVttUrl: `https://cdnapisec.kaltura.com/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_cap00001/ks/${FAKE_KS}`,
        },
      ];
    });
    const result = await fetchVideo(
      session,
      answering(async () => response),
    );
    expect(result && 'video' in result && result.video.captions).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(FAKE_KS);
  });

  it('leaves out a video that cannot be listed at all', async () => {
    const response = sample((entry) => (entry['name'] = 'a'.repeat(2000)));
    expect(
      await fetchVideo(
        session,
        answering(async () => response),
      ),
    ).toBe(null);
  });
});
