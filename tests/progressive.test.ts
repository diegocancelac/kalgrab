/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planProgressiveDownload } from '../lib/download/progressive';
import { parsePlaybackContext, type VideoInfo } from '../lib/kaltura/playback-context';

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
