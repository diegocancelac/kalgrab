// The background side of a scan: turns what scan.content.ts returned in each frame into the
// ks-free listing the popup shows.

import { fetchVideo } from './kaltura/fetch-video';
import type { VideoInfo } from './kaltura/playback-context';
import { isMainMessage, type MainMessage } from './messages';

/** One frame's part of executeScript's result. */
export interface FrameResult {
  frameId: number;
  documentId?: string;
  result?: unknown;
}

/** What the popup gets for a frame. Never carries a ks. */
export interface FrameVideos {
  frameId: number;
  /** Pins a later download to the document that was scanned. */
  documentId: string;
  videos: VideoInfo[];
  failedOrigins: string[];
}

// A frame returns one videos message and a few fetch-failed ones, or one sessions message.
const MAX_MESSAGES = 20;

function readResult(result: unknown): MainMessage[] | null {
  if (!Array.isArray(result) || result.length > MAX_MESSAGES) return null;
  return result.every(isMainMessage) ? result : null;
}

async function collectFrame(
  frameId: number,
  documentId: string,
  messages: MainMessage[],
  fetchApi: typeof fetch,
): Promise<FrameVideos> {
  const frame: FrameVideos = { frameId, documentId, videos: [], failedOrigins: [] };
  const failed = new Set<string>();
  for (const message of messages) {
    if (message.type === 'videos') {
      frame.videos.push(...message.videos);
    } else if (message.type === 'fetch-failed') {
      failed.add(message.origin);
    } else {
      // The page's fetch was not native: the requests go out from here, without its Referer.
      const results = await Promise.all(message.sessions.map((s) => fetchVideo(s, fetchApi)));
      for (const result of results) {
        if (result && 'video' in result) frame.videos.push(result.video);
        else if (result) failed.add(result.failedOrigin);
      }
    }
  }
  frame.failedOrigins = [...failed];
  return frame;
}

/**
 * The listing of every frame that returned something. Results are page data: a frame whose
 * result is not exactly a list of valid messages is left out whole.
 */
export async function collectScan(
  results: readonly FrameResult[],
  fetchApi: typeof fetch,
): Promise<FrameVideos[]> {
  const frames = await Promise.all(
    results.map(({ frameId, documentId, result }) => {
      const messages = readResult(result);
      if (!documentId || !messages) return null;
      return collectFrame(frameId, documentId, messages, fetchApi);
    }),
  );
  return frames
    .filter((f): f is FrameVideos => !!f && (f.videos.length > 0 || f.failedOrigins.length > 0))
    .sort((a, b) => a.frameId - b.frameId);
}
