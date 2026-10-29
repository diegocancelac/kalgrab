import { isVideoInfo } from '../messages';
import {
  buildPlaybackContextRequest,
  parsePlaybackContext,
  type VideoInfo,
} from './playback-context';
import type { PlayerSession } from './player-v7';

const TIMEOUT_MS = 15_000;

export type FetchedVideo = { video: VideoInfo } | { failedOrigin: string } | null;

// A video the background would refuse is not worth listing. Captions are the likeliest part
// to fail (a URL that looks like it carries a session); the video is still listed without
// them.
function listable(video: VideoInfo): VideoInfo | null {
  for (const candidate of [video, { ...video, captions: [] }]) {
    if (isVideoInfo(candidate)) return candidate;
  }
  return null;
}

/**
 * Requests the playback context of the session's entry. A network error or a timeout gives
 * the API origin, so the popup can name it; an API error (an expired ks, a deleted entry),
 * an unreadable answer or a video that cannot be listed gives null.
 */
export async function fetchVideo(
  session: PlayerSession,
  fetchApi: typeof fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<FetchedVideo> {
  const request = buildPlaybackContextRequest(session);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let json: unknown;
  try {
    const response = await fetchApi(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    try {
      json = await response.json();
    } catch {
      return controller.signal.aborted ? { failedOrigin: new URL(request.url).origin } : null;
    }
  } catch {
    return { failedOrigin: new URL(request.url).origin };
  } finally {
    clearTimeout(timer);
  }
  let video: VideoInfo;
  try {
    video = parsePlaybackContext(json);
  } catch {
    return null;
  }
  const shown = listable(video);
  return shown ? { video: shown } : null;
}
