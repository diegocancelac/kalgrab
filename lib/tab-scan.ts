// The background side of a scan: turns what scan.content.ts returned in each frame into the
// ks-free listing the popup shows.

import { fetchVideo } from './kaltura/fetch-video';
import type { VideoInfo } from './kaltura/playback-context';
import { trace } from './debug';
import { isMainMessage, videoInfoProblems, type MainMessage } from './messages';

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

const MESSAGE_TYPES = ['videos', 'fetch-failed', 'sessions'];

/**
 * For the development traces: what a frame returned and, when it is refused, which message
 * failed and why. It reads page data, so it only ever names known types and fields.
 */
export function describeResult(result: unknown): { returned: unknown; refused?: string[] } {
  if (result === undefined || result === null) return { returned: 'nothing' };
  if (!Array.isArray(result)) return { returned: 'not a list', refused: ['not a list'] };
  const items: unknown[] = result;
  const types = items.map((item) => {
    const type = (item as { type?: unknown } | null)?.type;
    return typeof type === 'string' && MESSAGE_TYPES.includes(type) ? type : 'unknown';
  });
  const returned = items.map((item, i) => {
    const videos = (item as { videos?: unknown } | null)?.videos;
    const sessions = (item as { sessions?: unknown } | null)?.sessions;
    if (types[i] === 'videos' && Array.isArray(videos)) return `videos(${videos.length})`;
    if (types[i] === 'sessions' && Array.isArray(sessions)) return `sessions(${sessions.length})`;
    return types[i];
  });
  if (items.length > MAX_MESSAGES) return { returned, refused: ['too many messages'] };
  const refused = items.flatMap((item, i) => {
    if (isMainMessage(item)) return [];
    const videos = (item as { videos?: unknown } | null)?.videos;
    if (types[i] !== 'videos' || !Array.isArray(videos)) return [`${types[i]} #${i}`];
    const list: unknown[] = videos;
    const invalid = list.flatMap((video, v) => {
      const problems = videoInfoProblems(video);
      return problems.length ? [`video #${v}: ${problems.join(', ')}`] : [];
    });
    return [`videos #${i}${invalid.length ? ` (${invalid.join('; ')})` : ''}`];
  });
  return refused.length ? { returned, refused } : { returned };
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
      trace(`frame ${frameId}: fetch is not native, the background requests the entries`);
      const results = await Promise.all(message.sessions.map((s) => fetchVideo(s, fetchApi)));
      for (const result of results) {
        if (result && 'video' in result) frame.videos.push(result.video);
        else if (result) failed.add(result.failedOrigin);
      }
      trace(`frame ${frameId}: background requests done`, () => ({
        videos: results.filter((r) => r && 'video' in r).length,
        failed: results.filter((r) => r && 'failedOrigin' in r).length,
        notListed: results.filter((r) => !r).length,
      }));
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
      trace(`frame ${frameId}`, () => {
        const { returned, refused = [] } = describeResult(result);
        if (!documentId) refused.push('no document id');
        const list = Array.isArray(returned) ? `[${returned.join(', ')}]` : String(returned);
        return refused.length
          ? `returned ${list}, refused: ${refused.join('; ')}`
          : `returned ${list}`;
      });
      if (!documentId || !messages) return null;
      return collectFrame(frameId, documentId, messages, fetchApi);
    }),
  );
  return frames
    .filter((f): f is FrameVideos => !!f && (f.videos.length > 0 || f.failedOrigins.length > 0))
    .sort((a, b) => a.frameId - b.frameId);
}
