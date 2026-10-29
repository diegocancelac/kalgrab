// What each frame of a tab has detected, as kept in storage.session. One key per frame, so
// clearing a tab or a frame never touches the others. Nothing here ever holds a ks: it is
// built only from messages that passed the guards in messages.ts.

import type { VideoInfo } from './kaltura/playback-context';
import type { MainMessage } from './messages';

export interface FrameState {
  videos: VideoInfo[];
  /** Kaltura origins a request to failed, so the popup can name them. */
  failedOrigins: string[];
  /** A player is there, but nothing can be requested until the page is reloaded. */
  needsReload: boolean;
}

export interface TabFrame {
  frameId: number;
  state: FrameState;
}

const MAX_FAILED_ORIGINS = 10;
const FRAME_KEY = /^tab:(\d+):frame:(\d+)$/;

export const frameKey = (tabId: number, frameId: number) => `tab:${tabId}:frame:${frameId}`;

export const isTabKey = (key: string, tabId: number) => key.startsWith(`tab:${tabId}:`);

export function applyPageMessage(state: FrameState | undefined, message: MainMessage): FrameState {
  const current = state ?? { videos: [], failedOrigins: [], needsReload: false };
  switch (message.type) {
    case 'videos':
      return { ...current, videos: message.videos };
    case 'fetch-failed': {
      if (current.failedOrigins.includes(message.origin)) return current;
      const failedOrigins = [...current.failedOrigins, message.origin].slice(-MAX_FAILED_ORIGINS);
      return { ...current, failedOrigins };
    }
    case 'needs-reload':
      return { ...current, needsReload: true };
  }
}

/** The frames of one tab out of everything in storage, in frame order. */
export function framesOfTab(items: Record<string, unknown>, tabId: number): TabFrame[] {
  const frames: TabFrame[] = [];
  for (const [key, value] of Object.entries(items)) {
    const match = FRAME_KEY.exec(key);
    if (!match || Number(match[1]) !== tabId) continue;
    frames.push({ frameId: Number(match[2]), state: value as FrameState });
  }
  return frames.sort((a, b) => a.frameId - b.frameId);
}

export function badgeText(frames: readonly TabFrame[]): string {
  const count = frames.reduce((sum, frame) => sum + frame.state.videos.length, 0);
  return count ? String(count) : '';
}
