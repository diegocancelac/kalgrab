/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlaybackContext, type VideoInfo } from '../lib/kaltura/playback-context';
import { buildListing } from '../lib/listing';
import type { FrameVideos } from '../lib/tab-scan';

const video = parsePlaybackContext(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
      'utf8',
    ),
  ),
);

const frame = (
  frameId: number,
  videos: VideoInfo[],
  failedOrigins: string[] = [],
): FrameVideos => ({
  frameId,
  documentId: `doc${frameId}`,
  videos,
  failedOrigins,
});

describe('buildListing', () => {
  it('lists the MP4 qualities best first, with their sizes', () => {
    const { videos, unreachableHosts } = buildListing([frame(5, [video])]);
    expect(unreachableHosts).toEqual([]);
    expect(videos).toEqual([
      {
        key: '5:1_abcd1234',
        documentId: 'doc5',
        video,
        duration: '2:12',
        qualities: [
          { flavorId: '1_flav0720', label: '720p · 6.0 MB' },
          { flavorId: '1_flav0480', label: '480p · 3.7 MB' },
          { flavorId: '1_flav0360', label: '360p · 3.0 MB' },
        ],
      },
    ]);
    // The background checks the video again, so it must be the scan's own object.
    expect(videos[0]?.video).toBe(video);
  });

  it('leaves out flavors the MP4 source does not serve', () => {
    const progressive = { url: video.progressive?.url ?? '', flavorIds: ['1_flav0480'] };
    const [listed] = buildListing([frame(1, [{ ...video, progressive }])]).videos;
    expect(listed?.qualities.map((q) => q.flavorId)).toEqual(['1_flav0480']);
  });

  it('says why a video cannot be downloaded', () => {
    const { progressive, hls, captions, ...base } = video;
    expect(progressive && hls && captions).toBeTruthy();
    const cases: [VideoInfo, string][] = [
      [{ ...base, captions: [], isProtected: true }, 'This video is protected.'],
      [
        {
          ...base,
          captions: [],
          blocked: { reason: 'Only a preview of this video is available.' },
        },
        'Only a preview of this video is available.',
      ],
      [{ ...base, captions: [], hls }, 'This video has no MP4 download.'],
      [
        { ...video, progressive: { url: progressive?.url ?? '', flavorIds: ['1_missing'] } },
        'No MP4 quality is available for this video.',
      ],
    ];
    for (const [value, problem] of cases) {
      const [listed] = buildListing([frame(1, [value])]).videos;
      expect(listed?.problem).toBe(problem);
      expect(listed?.qualities).toEqual([]);
    }
  });

  it('lists a video shown by several frames once, and names unreachable hosts once', () => {
    const { videos, unreachableHosts } = buildListing([
      frame(2, [], ['https://www.kaltura.com']),
      frame(4, [video], ['https://www.kaltura.com', 'https://api.kaltura.example:8443']),
      frame(7, [video]),
    ]);
    expect(videos.map((v) => v.key)).toEqual(['4:1_abcd1234']);
    expect(unreachableHosts).toEqual(['www.kaltura.com', 'api.kaltura.example:8443']);
  });
});
