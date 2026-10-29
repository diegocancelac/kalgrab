/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  M3u8Error,
  parseAttributes,
  parsePlaylist,
  type MasterPlaylist,
  type MediaPlaylist,
} from '../lib/hls/m3u8';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const BASE = 'https://cdn.example.com/hls/entry/index.m3u8';

function media(text: string, base = BASE): MediaPlaylist {
  const playlist = parsePlaylist(text, base);
  if (playlist.kind !== 'media') throw new Error('expected a media playlist');
  return playlist;
}

function master(text: string, base = BASE): MasterPlaylist {
  const playlist = parsePlaylist(text, base);
  if (playlist.kind !== 'master') throw new Error('expected a master playlist');
  return playlist;
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof M3u8Error) return error.code;
    throw error;
  }
  return undefined;
}

describe('parseAttributes', () => {
  it('splits unquoted and quoted values', () => {
    expect(parseAttributes('BANDWIDTH=221349,RESOLUTION=640x360,NAME="low"')).toEqual({
      BANDWIDTH: '221349',
      RESOLUTION: '640x360',
      NAME: 'low',
    });
  });

  it('keeps commas inside quotes', () => {
    expect(parseAttributes('CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud"')).toEqual({
      CODECS: 'avc1.64001f,mp4a.40.2',
      AUDIO: 'aud',
    });
  });
});

describe('master playlist', () => {
  it('parses the sample master', () => {
    const playlist = master(
      fixture('master.m3u8'),
      'https://cfvod.kaltura.com/hls/p/1234567/index.m3u8',
    );
    expect(playlist.isProtected).toBe(false);
    expect(playlist.variants.map((v) => [v.bandwidth, v.resolution, v.frameRate])).toEqual([
      [221349, { width: 640, height: 360 }, 30],
      [267385, { width: 854, height: 480 }, 30],
      [418046, { width: 1280, height: 720 }, 30],
    ]);
    expect(playlist.variants[2]?.url).toMatch(/\/flavorId\/1_flav0720\/name\/a\.mp4\/index\.m3u8$/);
    expect(playlist.variants[0]?.codecs).toBeUndefined();
    expect(playlist.variants[0]?.audio).toBeUndefined();
  });

  it('reads CODECS with a comma and the AUDIO group', () => {
    const playlist = master(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,FRAME-RATE=29.97,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud1"',
        'v720.m3u8',
      ].join('\n'),
    );
    expect(playlist.variants).toEqual([
      {
        url: 'https://cdn.example.com/hls/entry/v720.m3u8',
        bandwidth: 800000,
        resolution: { width: 1280, height: 720 },
        frameRate: 29.97,
        codecs: 'avc1.64001f,mp4a.40.2',
        audio: 'aud1',
      },
    ]);
  });

  it('resolves relative URIs and keeps absolute ones untouched', () => {
    const playlist = master(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=1',
        '../other/low.m3u8?x=1',
        '#EXT-X-STREAM-INF:BANDWIDTH=2',
        '/root/mid.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=3',
        'https://other.example.org',
      ].join('\n'),
    );
    expect(playlist.variants.map((v) => v.url)).toEqual([
      'https://cdn.example.com/hls/other/low.m3u8?x=1',
      'https://cdn.example.com/root/mid.m3u8',
      'https://other.example.org',
    ]);
  });

  it('rejects a variant without BANDWIDTH', () => {
    const text = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\nlow.m3u8\n';
    expect(errorCode(() => parsePlaylist(text, BASE))).toBe('invalid');
  });

  it('is protected with a SESSION-KEY other than NONE', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="https://keys.example.com/k"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1',
      'low.m3u8',
    ].join('\n');
    expect(master(text).isProtected).toBe(true);
  });

  it('is not protected with SESSION-KEY METHOD=NONE', () => {
    const text = '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=NONE\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8';
    expect(master(text).isProtected).toBe(false);
  });
});

describe('media playlist', () => {
  it('parses the sample flavor playlist', () => {
    const playlist = media(
      fixture('flavor-720p.m3u8'),
      'https://cfvod.kaltura.com/hls/p/1234567/index.m3u8',
    );
    expect(playlist.isProtected).toBe(false);
    expect(playlist.mediaSequence).toBe(1);
    expect(playlist.segments).toHaveLength(17);
    expect(playlist.segments[0]).toEqual({
      url: 'https://cfvod.kaltura.com/hls/p/1234567/sp/123456700/serveFlavor/entryId/1_abcd1234/v/1/ev/4/flavorId/1_flav0720/name/a.mp4/seg-1-v1-a1.ts',
      duration: 2,
    });
    const total = playlist.segments.reduce((sum, s) => sum + s.duration, 0);
    expect(total).toBeCloseTo(132.168, 3);
  });

  it('resolves relative segment URIs against the playlist URL', () => {
    const playlist = media(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA-SEQUENCE:7',
        '#EXTINF:4.5,',
        'seg-1.ts',
        '#EXTINF:3,title',
        '../seg-2.ts',
        '#EXTINF:3,',
        'https://segments.example.org/seg-3.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
    );
    expect(playlist.mediaSequence).toBe(7);
    expect(playlist.segments).toEqual([
      { url: 'https://cdn.example.com/hls/entry/seg-1.ts', duration: 4.5 },
      { url: 'https://cdn.example.com/hls/seg-2.ts', duration: 3 },
      { url: 'https://segments.example.org/seg-3.ts', duration: 3 },
    ]);
  });

  it('defaults the media sequence to 0', () => {
    expect(media('#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST').mediaSequence).toBe(0);
  });

  it('tolerates CRLF, BOM, blank lines, comments and unknown tags', () => {
    const text =
      '﻿#EXTM3U\r\n\r\n# a comment\r\n#EXT-X-FUTURE-TAG:FOO=BAR\r\n#EXTINF:2,\r\n\r\na.ts\r\n#EXT-X-DISCONTINUITY\r\n#EXT-X-ENDLIST\r\n';
    expect(media(text).segments).toEqual([
      { url: 'https://cdn.example.com/hls/entry/a.ts', duration: 2 },
    ]);
  });

  it('rejects text that is not a playlist', () => {
    expect(errorCode(() => parsePlaylist('<html></html>', BASE))).toBe('invalid');
  });

  it('rejects an invalid EXTINF duration', () => {
    expect(
      errorCode(() => parsePlaylist('#EXTM3U\n#EXTINF:abc,\na.ts\n#EXT-X-ENDLIST', BASE)),
    ).toBe('invalid');
  });

  it('rejects a playlist without segments', () => {
    expect(errorCode(() => parsePlaylist('#EXTM3U\n#EXT-X-ENDLIST', BASE))).toBe('invalid');
  });

  describe('protection', () => {
    const withKey = (key: string) => `#EXTM3U\n${key}\n#EXTINF:2,\na.ts\n#EXT-X-ENDLIST`;

    it('flags AES-128', () => {
      const text = withKey('#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example.com/k",IV=0x01');
      expect(media(text).isProtected).toBe(true);
    });

    it('flags SAMPLE-AES', () => {
      const text = withKey(
        '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key",KEYFORMAT="com.apple.streamingkeydelivery"',
      );
      expect(media(text).isProtected).toBe(true);
    });

    it('flags a key without METHOD', () => {
      expect(media(withKey('#EXT-X-KEY:URI="https://keys.example.com/k"')).isProtected).toBe(true);
    });

    it('does not flag METHOD=NONE', () => {
      expect(media(withKey('#EXT-X-KEY:METHOD=NONE')).isProtected).toBe(false);
    });

    it('is reported as data even when the playlist is also live', () => {
      const text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2,\na.ts';
      expect(media(text).isProtected).toBe(true);
    });
  });

  describe('unsupported playlists', () => {
    it('rejects live streams', () => {
      const text = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:100\n#EXTINF:2,\na.ts\n#EXTINF:2,\nb.ts';
      expect(errorCode(() => parsePlaylist(text, BASE))).toBe('live');
      expect(() => parsePlaylist(text, BASE)).toThrow(/live streams not supported/i);
    });

    it('rejects EXT-X-MAP (fMP4)', () => {
      const text = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\na.m4s\n#EXT-X-ENDLIST';
      expect(errorCode(() => parsePlaylist(text, BASE))).toBe('fmp4');
    });

    it('rejects EXT-X-BYTERANGE', () => {
      const text = '#EXTM3U\n#EXTINF:2,\n#EXT-X-BYTERANGE:1000@0\na.ts\n#EXT-X-ENDLIST';
      expect(errorCode(() => parsePlaylist(text, BASE))).toBe('byterange');
    });
  });
});
