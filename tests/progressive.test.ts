/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planProgressiveDownload, signedDownloadUrl } from '../lib/download/progressive';
import { parsePlaybackContext, type VideoInfo } from '../lib/kaltura/playback-context';
import type { PlayerSession } from '../lib/kaltura/player-v7';
import { CHANNEL, VERSION, type SessionsMessage } from '../lib/messages';

// Never real sessions: fake values only.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const OTHER_KS = 'b3RoZXItZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDA=';
const PAGE = 'https://kaf.example.edu/browseandembed/index/media/entryid/1_abcd1234';

const sample = (): VideoInfo =>
  parsePlaybackContext(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
        'utf8',
      ),
    ),
  );

const MANIFEST =
  'https://cdnapisec.kaltura.com/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234';

describe('planProgressiveDownload', () => {
  it('names the file after the title and narrows the source to one flavor', () => {
    expect(planProgressiveDownload(sample(), '1_flav0720')).toEqual({
      filename: 'Sample lecture.mp4',
      url: `${MANIFEST}/flavorIds/1_flav0720/deliveryProfileId/9001/protocol/https/format/url/name/a.mp4`,
    });
  });

  it('uses the flavor extension, and mp4 when it is unknown', () => {
    const video = sample();
    const [first, second] = video.flavors;
    if (!first || !second) throw new Error('the sample has three flavors');
    first.fileExt = 'mov';
    delete second.fileExt;
    expect(planProgressiveDownload(video, '1_flav0360').filename).toBe('Sample lecture.mov');
    expect(planProgressiveDownload(video, '1_flav0480').filename).toBe('Sample lecture.mp4');
  });

  it('sanitizes the title', () => {
    const video = { ...sample(), title: 'Week 1: intro/overview?' };
    expect(planProgressiveDownload(video, '1_flav0360').filename).toBe(
      'Week 1_ intro_overview_.mp4',
    );
  });

  it('refuses protected and blocked videos even if they list a source', () => {
    expect(() => planProgressiveDownload({ ...sample(), isProtected: true }, '1_flav0360')).toThrow(
      'This video is protected.',
    );
    expect(() =>
      planProgressiveDownload(
        { ...sample(), blocked: { reason: 'Only available on campus.' } },
        '1_flav0360',
      ),
    ).toThrow('Only available on campus.');
  });

  it('refuses a video without a progressive source or a flavor it does not serve', () => {
    const noProgressive = sample();
    delete noProgressive.progressive;
    expect(() => planProgressiveDownload(noProgressive, '1_flav0360')).toThrow(/no MP4/);
    expect(() => planProgressiveDownload(sample(), '1_other')).toThrow(/not available/);
  });
});

describe('signedDownloadUrl', () => {
  const plan = planProgressiveDownload(sample(), '1_flav0360');

  const session = (entryId: string, ks = FAKE_KS): PlayerSession => ({
    partnerId: 1234567,
    serviceUrl: 'https://www.kaltura.com/api_v3',
    allowedOrigins: ['https://www.kaltura.com/api_v3', 'https://cdnapisec.kaltura.com'],
    ks,
    entryId,
  });
  const frame = (...sessions: PlayerSession[]): SessionsMessage => ({
    channel: CHANNEL,
    version: VERSION,
    type: 'sessions',
    pageUrl: PAGE,
    sessions,
  });

  it('adds the page as referrer and the session of the player that shows the entry', () => {
    const url = new URL(
      signedDownloadUrl(
        plan,
        '1_abcd1234',
        frame(session('1_other', OTHER_KS), session('1_abcd1234')),
      ),
    );
    expect(url.origin).toBe('https://cdnapisec.kaltura.com');
    expect(url.pathname).toBe(
      `/p/1234567/sp/1234567/playManifest/entryId/1_abcd1234/flavorIds/1_flav0360/deliveryProfileId/9001/protocol/https/format/url/ks/${FAKE_KS}/name/a.mp4`,
    );
    expect([...url.searchParams.keys()]).toEqual(['referrer']);
    expect(atob(url.searchParams.get('referrer') ?? '')).toBe(PAGE);
  });

  it('uses the only player of the frame when the API redirected the entry', () => {
    const url = signedDownloadUrl(plan, '1_redirected', frame(session('1_abcd1234', OTHER_KS)));
    expect(new URL(url).pathname).toContain(`/ks/${OTHER_KS}/`);
  });

  it('refuses to guess between several players', () => {
    const several = frame(session('1_a', FAKE_KS), session('1_b', OTHER_KS));
    expect(() => signedDownloadUrl(plan, '1_abcd1234', several)).toThrow(/Reopen Kalgrab/);
  });

  it('never sends the ks off the player origins', () => {
    const offOrigin = {
      ...plan,
      url: plan.url.replace('cdnapisec.kaltura.com', 'cdn.example.com'),
    };
    expect(() => signedDownloadUrl(offOrigin, '1_abcd1234', frame(session('1_abcd1234')))).toThrow(
      /not one of the player's origins/,
    );
  });

  it('keeps the URL and the ks out of its error messages', () => {
    const cases: [ReturnType<typeof frame>, typeof plan][] = [
      [frame(session('1_a'), session('1_b')), plan],
      [
        frame(session('1_abcd1234')),
        { ...plan, url: plan.url.replace('cdnapisec.kaltura.com', 'cdn.example.com') },
      ],
    ];
    for (const [sessions, planned] of cases) {
      try {
        signedDownloadUrl(planned, '1_abcd1234', sessions);
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(FAKE_KS);
        expect(message).not.toContain('playManifest');
      }
    }
  });
});
