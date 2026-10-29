// One pass over a frame, run in the page's MAIN world when the popup opens. What it returns
// goes back to the background as the result of executeScript.

import { fetchVideo } from './kaltura/fetch-video';
import type { VideoInfo } from './kaltura/playback-context';
import { readPlayerSessions } from './kaltura/player-v7';
import { CHANNEL, LIMITS, VERSION, type MainMessage } from './messages';

export interface FrameScanEnv {
  /** window.KalturaPlayer. */
  kalturaPlayer: unknown;
  /** The frame's location.href. */
  pageUrl: string;
  /** The page's fetch, or null when it is not the native one. */
  fetch: typeof fetch | null;
}

const header = { channel: CHANNEL, version: VERSION } as const;

/**
 * Lists the entries of the frame's players. The requests go out with the page's own fetch,
 * so they carry its Referer as the player's do. When that fetch is not native (a page
 * wrapper would see the request, which carries the ks), the sessions are returned instead
 * and the background makes the requests.
 */
export async function scanFrame(env: FrameScanEnv): Promise<MainMessage[]> {
  const byEntry = new Map(readPlayerSessions(env.kalturaPlayer).map((s) => [s.entryId, s]));
  const sessions = [...byEntry.values()].slice(0, LIMITS.sessions);
  if (!sessions.length) return [];
  if (!env.fetch) return [{ ...header, type: 'sessions', pageUrl: env.pageUrl, sessions }];

  const fetchApi = env.fetch;
  const results = await Promise.all(sessions.map((session) => fetchVideo(session, fetchApi)));
  const videos: VideoInfo[] = [];
  const failedOrigins = new Set<string>();
  for (const result of results) {
    if (result && 'video' in result) videos.push(result.video);
    else if (result) failedOrigins.add(result.failedOrigin);
  }
  return [
    { ...header, type: 'videos', videos: videos.slice(0, LIMITS.videos) },
    ...[...failedOrigins].map((origin) => ({ ...header, type: 'fetch-failed' as const, origin })),
  ];
}
