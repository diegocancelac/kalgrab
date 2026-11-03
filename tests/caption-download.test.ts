/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fetchSrt,
  planCaptionDownload,
  signedCaptionUrl,
  srtDataUrl,
} from '../lib/download/captions';
import { parsePlaybackContext, type VideoInfo } from '../lib/kaltura/playback-context';
import type { PlayerSession } from '../lib/kaltura/player-v7';
import { CHANNEL, VERSION, type SessionsMessage } from '../lib/messages';

// Never real sessions: fake values only.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const VTT =
  'https://cdnapisec.kaltura.com/api_v3/index.php/service/caption_captionasset/action/serveWebVTT/captionAssetId/1_cap00001';

const sample = (): VideoInfo => ({
  ...parsePlaybackContext(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
        'utf8',
      ),
    ),
  ),
  captions: [
    { label: 'English', languageCode: 'en', isDefault: true, url: `${VTT}/version/1` },
    { label: 'Español (auto)', isDefault: false, url: `${VTT}2/version/1` },
  ],
});

const session = (entryId: string): PlayerSession => ({
  partnerId: 1234567,
  serviceUrl: 'https://www.kaltura.com/api_v3',
  allowedOrigins: ['https://www.kaltura.com/api_v3', 'https://cdnapisec.kaltura.com'],
  ks: FAKE_KS,
  entryId,
});
const frame = (...sessions: PlayerSession[]): SessionsMessage => ({
  channel: CHANNEL,
  version: VERSION,
  type: 'sessions',
  pageUrl: 'https://kaf.example.edu/browseandembed/index/media/entryid/1_abcd1234',
  sessions,
});

describe('planCaptionDownload', () => {
  it('names the file after the title and the track language, and keeps the URL as is', () => {
    expect(planCaptionDownload(sample(), 0)).toEqual({
      filename: 'Sample lecture.en.srt',
      url: `${VTT}/version/1`,
    });
    expect(planCaptionDownload(sample(), 1).filename).toBe('Sample lecture.Español-auto.srt');
  });

  it('refuses protected and blocked videos, and tracks that are not listed', () => {
    expect(() => planCaptionDownload({ ...sample(), isProtected: true }, 0)).toThrow(
      'This video is protected.',
    );
    expect(() =>
      planCaptionDownload({ ...sample(), blocked: { reason: 'Only available on campus.' } }, 0),
    ).toThrow('Only available on campus.');
    expect(() => planCaptionDownload(sample(), 2)).toThrow(/no longer listed/);
  });
});

describe('signedCaptionUrl', () => {
  const plan = planCaptionDownload(sample(), 0);

  it('adds the ks of the player that shows the entry as a query parameter', () => {
    const url = new URL(signedCaptionUrl(plan, '1_abcd1234', frame(session('1_abcd1234'))));
    expect(url.origin + url.pathname).toBe(`${VTT}/version/1`);
    expect(url.searchParams.get('ks')).toBe(FAKE_KS);
  });

  it('never sends the ks off the player origins', () => {
    const offOrigin = { ...plan, url: plan.url.replace('cdnapisec.kaltura.com', 'example.com') };
    expect(() => signedCaptionUrl(offOrigin, '1_abcd1234', frame(session('1_abcd1234')))).toThrow(
      /not one of the player's origins/,
    );
  });
});

describe('fetchSrt', () => {
  const signed = `${VTT}/version/1?ks=${FAKE_KS}`;
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHola, ¿qué tal?\n';

  it('fetches the track without cookies and converts it', async () => {
    let init: RequestInit | undefined;
    const fetchApi = (async (_url: string, options?: RequestInit) => {
      init = options;
      return new Response(vtt);
    }) as typeof fetch;
    expect(await fetchSrt(signed, fetchApi)).toBe(
      '1\n00:00:01,000 --> 00:00:02,500\nHola, ¿qué tal?\n',
    );
    expect(init?.credentials).toBe('omit');
  });

  it('names the host, and never the URL or the ks, when the request fails', async () => {
    const failures: [typeof fetch, RegExp][] = [
      [
        (async () => Promise.reject(new TypeError(`Failed to fetch ${signed}`))) as typeof fetch,
        /^Could not reach cdnapisec\.kaltura\.com\.$/,
      ],
      [
        (async () => new Response('', { status: 403 })) as typeof fetch,
        /^cdnapisec\.kaltura\.com did not return the captions\.$/,
      ],
      [(async () => new Response('WEBVTT\n')) as typeof fetch, /^These captions have no text\.$/],
    ];
    for (const [fetchApi, message] of failures) {
      await expect(fetchSrt(signed, fetchApi)).rejects.toThrow(message);
    }
  });

  it('gives up after the timeout', async () => {
    const hanging = ((_url: string, options?: RequestInit) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    await expect(fetchSrt(signed, hanging, 10)).rejects.toThrow(/^Could not reach/);
  });
});

describe('srtDataUrl', () => {
  it('encodes the text as UTF-8 with a BOM', () => {
    const url = srtDataUrl('1\n00:00:01,000 --> 00:00:02,000\nAcción\n');
    const prefix = 'data:application/x-subrip;base64,';
    expect(url.startsWith(prefix)).toBe(true);
    const bytes = Uint8Array.from(atob(url.slice(prefix.length)), (c) => c.charCodeAt(0));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.subarray(3))).toBe(
      '1\n00:00:01,000 --> 00:00:02,000\nAcción\n',
    );
  });

  it('handles tracks longer than one encoding chunk', () => {
    const srt = 'á'.repeat(100_000);
    const url = srtDataUrl(srt);
    const bytes = Uint8Array.from(atob(url.split(',')[1] ?? ''), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(srt);
  });
});
