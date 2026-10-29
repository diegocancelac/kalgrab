/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlaybackContext } from '../lib/kaltura/playback-context';
import { CHANNEL, VERSION } from '../lib/messages';
import { collectScan, type FrameResult } from '../lib/tab-scan';

// Never a real session or account: the same fake values as the fixtures.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const FAKE_V2_KS = 'djJ8ZmFrZS1rcy1mb3ItdGVzdHM';
const PAGE = 'https://kaf.example.edu/browseandembed/index/media/entryid/1_abcd1234';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
    'utf8',
  ),
) as Json[];

const video = parsePlaybackContext(fixture);
const header = { channel: CHANNEL, version: VERSION } as const;
const videos = (list: unknown[] = [video]) => ({ ...header, type: 'videos', videos: list });
const failed = (origin: string) => ({ ...header, type: 'fetch-failed', origin });
const sessions = (entryIds: string[]) => ({
  ...header,
  type: 'sessions',
  pageUrl: PAGE,
  sessions: entryIds.map((entryId) => ({
    partnerId: 1234567,
    serviceUrl: 'https://www.kaltura.com/api_v3',
    allowedOrigins: ['https://www.kaltura.com/api_v3', 'https://cdnapisec.kaltura.com'],
    ks: FAKE_KS,
    entryId,
  })),
});

const frame = (frameId: number, result: unknown, documentId = `doc${frameId}`): FrameResult => ({
  frameId,
  documentId,
  result,
});

// Answers the sample response for the entry asked for, and records the requests.
function backgroundFetch(fail = false) {
  const bodies: string[] = [];
  const fetchApi = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    if (fail) throw new TypeError('Failed to fetch');
    const response = structuredClone(fixture);
    const entry = response[0]?.['objects'][0];
    entry.id = JSON.parse(String(init.body))['1'].filter.redirectFromEntryId;
    return new Response(JSON.stringify(response));
  }) as typeof fetch;
  return { fetchApi, bodies };
}

describe('collectScan', () => {
  it('collects the videos and failed origins of each frame, in frame order', async () => {
    const { fetchApi, bodies } = backgroundFetch();
    const frames = await collectScan(
      [
        frame(5, [videos(), failed('https://www.kaltura.com')]),
        frame(0, []),
        frame(2, [videos([])]),
        frame(3, [failed('https://www.kaltura.com'), failed('https://www.kaltura.com')]),
      ],
      fetchApi,
    );
    expect(bodies).toEqual([]);
    expect(frames).toEqual([
      { frameId: 3, documentId: 'doc3', videos: [], failedOrigins: ['https://www.kaltura.com'] },
      {
        frameId: 5,
        documentId: 'doc5',
        videos: [video],
        failedOrigins: ['https://www.kaltura.com'],
      },
    ]);
  });

  it('requests the entries itself for a frame that returned sessions, and drops the ks', async () => {
    const { fetchApi, bodies } = backgroundFetch();
    const frames = await collectScan(
      [frame(4, [sessions(['1_abcd1234', '1_efgh5678'])])],
      fetchApi,
    );
    expect(bodies).toHaveLength(2);
    expect(frames[0]?.videos.map((v) => v.entryId)).toEqual(['1_abcd1234', '1_efgh5678']);
    expect(JSON.stringify(frames)).not.toContain(FAKE_KS);
  });

  it('names the origin when its own requests fail', async () => {
    const { fetchApi } = backgroundFetch(true);
    expect(await collectScan([frame(4, [sessions(['1_abcd1234'])])], fetchApi)).toEqual([
      { frameId: 4, documentId: 'doc4', videos: [], failedOrigins: ['https://www.kaltura.com'] },
    ]);
  });

  it('leaves out a whole frame whose result is not exactly a list of valid messages', async () => {
    const { fetchApi, bodies } = backgroundFetch();
    const forged: unknown[] = [
      undefined,
      null,
      'videos',
      videos(),
      { 0: videos(), length: 1 },
      [videos(), null],
      [videos(), { ...failed('https://www.kaltura.com'), extra: 1 }],
      [videos([{ ...video, title: `Lecture ${FAKE_V2_KS}` }])],
      [videos([{ ...video, isProtected: true }])],
      [{ ...videos(), version: VERSION + 1 }],
      [{ ...videos(), channel: 'other' }],
      [{ ...sessions(['1_abcd1234']), pageUrl: 'javascript:alert(1)' }],
      Array(21).fill(videos()),
    ];
    for (const result of forged) {
      expect(await collectScan([frame(1, result)], fetchApi), JSON.stringify(result)).toEqual([]);
    }
    expect(bodies).toEqual([]);
  });

  it('keeps the other frames when one could not be injected or its script threw', async () => {
    // With allFrames, Chrome leaves out the frames it could not inject (sandboxed, error
    // pages, the PDF viewer, other extensions' frames); a frame whose main() threw or whose
    // promise rejected comes back without a usable result.
    const { fetchApi } = backgroundFetch();
    const frames = await collectScan(
      [
        frame(0, []),
        { frameId: 1, documentId: 'doc1' },
        frame(2, undefined),
        frame(3, null),
        { frameId: 4, documentId: 'doc4', error: new Error('Script threw') } as FrameResult,
        frame(6, [videos()]),
      ],
      fetchApi,
    );
    expect(frames).toEqual([
      { frameId: 6, documentId: 'doc6', videos: [video], failedOrigins: [] },
    ]);
  });

  it('leaves out a frame without a document id', async () => {
    const { fetchApi } = backgroundFetch();
    expect(await collectScan([frame(1, [videos()], '')], fetchApi)).toEqual([]);
    expect(await collectScan([{ frameId: 1, result: [videos()] }], fetchApi)).toEqual([]);
  });
});
