/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlannedUrlWithSession, planProgressiveDownload } from '../lib/download/progressive';
import { parsePlaybackContext, withKs, type VideoInfo } from '../lib/kaltura/playback-context';

// Never a real session.
const FAKE_KS = 'ZmFrZS1rcy1mb3ItdGVzdHMtb25seS0wMDAwMDAwMDAwMDA=';
const ORIGINS = ['https://cdnapisec.kaltura.com'];

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

describe('isPlannedUrlWithSession', () => {
  const planned = planProgressiveDownload(sample(), '1_flav0480').url;
  const signed = (url = planned) => withKs(url, FAKE_KS, ORIGINS);
  const withReferrer = (url: string, value = 'aHR0cHM6Ly9rYWYuZXhhbXBsZS5lZHUv') => {
    const target = new URL(url);
    target.searchParams.set('referrer', value);
    return target.href;
  };

  it('accepts the planned URL with the session, with or without a referrer', () => {
    expect(isPlannedUrlWithSession(signed(), planned)).toBe(true);
    expect(isPlannedUrlWithSession(withReferrer(signed()), planned)).toBe(true);
  });

  it('keeps the query the source already had', () => {
    const plannedWithQuery = `${planned}?clientTag=html5`;
    const received = withReferrer(signed(plannedWithQuery));
    expect(isPlannedUrlWithSession(received, plannedWithQuery)).toBe(true);
    expect(isPlannedUrlWithSession(withReferrer(signed()), plannedWithQuery)).toBe(false);
  });

  it('rejects a URL without a session', () => {
    expect(isPlannedUrlWithSession(planned, planned)).toBe(false);
    expect(isPlannedUrlWithSession(planned.replace('/name/', '/ks/name/'), planned)).toBe(false);
  });

  it('rejects anything else that differs from the plan', () => {
    const other = (from: string, to: string) => signed().replace(from, to);
    const cases: [string, string][] = [
      ['another flavor', other('1_flav0480', '1_flav0720')],
      ['another entry', other('1_abcd1234', '1_other000')],
      ['another delivery profile', other('/9001/', '/9002/')],
      ['another file name', other('/a.mp4', '/b.mp4')],
      ['plain http', other('https://', 'http://')],
      ['another host', other('cdnapisec.kaltura.com', 'evil.example.com')],
      ['another port', other('kaltura.com/', 'kaltura.com:8443/')],
      ['credentials', other('https://', 'https://user:pw@')],
      ['a fragment', `${signed()}#x`],
      ['an extra parameter', `${signed()}?next=https://evil.example.com`],
      ['an extra path pair', other('/name/', '/extra/1/name/')],
      ['a second session pair', other('/name/', `/ks/${FAKE_KS}/name/`)],
      ['not a URL', 'not a url'],
      ['empty', ''],
    ];
    for (const [name, url] of cases) {
      expect(isPlannedUrlWithSession(url, planned), name).toBe(false);
    }
  });

  it('rejects a session that is not inside the playManifest parameters', () => {
    const outside = planned.replace('/p/1234567/', `/ks/${FAKE_KS}/p/1234567/`);
    expect(isPlannedUrlWithSession(outside, planned)).toBe(false);
  });
});
