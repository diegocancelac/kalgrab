/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlaybackContext } from '../lib/kaltura/playback-context';
import { CHANNEL, VERSION } from '../lib/messages';
import {
  applyPageMessage,
  badgeText,
  frameKey,
  framesOfTab,
  isTabKey,
  type FrameState,
} from '../lib/tab-state';

const video = parsePlaybackContext(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
      'utf8',
    ),
  ),
);

const header = { channel: CHANNEL, version: VERSION } as const;
const videos = (list = [video]) => ({ ...header, type: 'videos', videos: list }) as const;
const failed = (origin: string) => ({ ...header, type: 'fetch-failed', origin }) as const;

describe('applyPageMessage', () => {
  it('starts an empty frame from its first message', () => {
    expect(applyPageMessage(undefined, videos())).toEqual({
      videos: [video],
      failedOrigins: [],
      needsReload: false,
    });
  });

  it('replaces the videos of the frame and keeps its failed origins', () => {
    const state: FrameState = {
      videos: [video],
      failedOrigins: ['https://a.example.com'],
      needsReload: false,
    };
    expect(applyPageMessage(state, videos([]))).toEqual({
      videos: [],
      failedOrigins: ['https://a.example.com'],
      needsReload: false,
    });
  });

  it('adds a failed origin once and keeps the videos', () => {
    let state = applyPageMessage(undefined, videos());
    state = applyPageMessage(state, failed('https://a.example.com'));
    state = applyPageMessage(state, failed('https://a.example.com'));
    expect(state).toEqual({
      videos: [video],
      failedOrigins: ['https://a.example.com'],
      needsReload: false,
    });
  });

  it('keeps only the latest failed origins', () => {
    let state: FrameState | undefined;
    for (let i = 0; i < 15; i++) {
      state = applyPageMessage(state, failed(`https://h${i}.example.com`));
    }
    expect(state?.failedOrigins).toHaveLength(10);
    expect(state?.failedOrigins.at(-1)).toBe('https://h14.example.com');
  });

  it('marks a frame that needs a reload and keeps what it had', () => {
    let state = applyPageMessage(undefined, failed('https://a.example.com'));
    state = applyPageMessage(state, { ...header, type: 'needs-reload' });
    expect(state).toEqual({
      videos: [],
      failedOrigins: ['https://a.example.com'],
      needsReload: true,
    });
  });
});

describe('frames of a tab', () => {
  const state = (count: number): FrameState => ({
    videos: Array(count).fill(video),
    failedOrigins: [],
    needsReload: false,
  });

  const items = {
    [frameKey(1, 7)]: state(1),
    [frameKey(1, 0)]: state(2),
    [frameKey(12, 0)]: state(5),
    'access-tab': 1,
    'tab:1:other': state(9),
  };

  it('finds only the frames of the tab, in frame order', () => {
    expect(framesOfTab(items, 1).map((f) => f.frameId)).toEqual([0, 7]);
    expect(framesOfTab(items, 12).map((f) => f.frameId)).toEqual([0]);
    expect(framesOfTab(items, 2)).toEqual([]);
  });

  it('tells the keys of a tab from those of a tab with a longer id', () => {
    expect(isTabKey(frameKey(1, 0), 1)).toBe(true);
    expect(isTabKey(frameKey(12, 0), 1)).toBe(false);
    expect(isTabKey('access-tab', 1)).toBe(false);
  });

  it('counts every video of the tab on the badge, and shows nothing for none', () => {
    expect(badgeText(framesOfTab(items, 1))).toBe('3');
    expect(badgeText(framesOfTab(items, 2))).toBe('');
    expect(badgeText([{ frameId: 0, state: state(0) }])).toBe('');
  });
});
