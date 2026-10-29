// The MAIN-world side of detection: finds Player v7 instances, asks the Kaltura API for their
// sources with the page's native fetch, and posts ks-free listings to the bridge. The ks stays
// in the sessions kept here; it only leaves inside a download URL, on a MessagePort.

import {
  buildPlaybackContextRequest,
  flavorUrl,
  parsePlaybackContext,
  withKs,
  withReferrer,
  type VideoInfo,
} from './kaltura/playback-context';
import { readPlayerSessions, type PlayerSession } from './kaltura/player-v7';
import {
  CHANNEL,
  LIMITS,
  VERSION,
  isDownloadRequestMessage,
  isVideosMessage,
  type DownloadUrlPortMessage,
  type MainMessage,
} from './messages';

export interface PlayerScriptEnv {
  /** window.KalturaPlayer, read on every check: the player library loads after this script. */
  kalturaPlayer(): unknown;
  /** The frame's location.href, sent as the referrer of downloads. */
  pageUrl(): string;
  /** The page's fetch as captured at startup, or null when it was not the native one. */
  fetch: typeof fetch | null;
  post(message: MainMessage): void;
}

export interface PlayerScript {
  /** Looks for players and fetches entries not seen yet. Resolves once those fetches end. */
  check(): Promise<void>;
  /** Posts everything again, for a page restored from the back/forward cache. */
  republish(): void;
  /** The answer to a download request, or null when the message is not one. */
  answerDownloadRequest(data: unknown): DownloadUrlPortMessage | null;
}

const header = { channel: CHANNEL, version: VERSION } as const;

// A single video the bridge would refuse drops the whole listing, so each one is checked on
// its own. Captions are the likeliest part to fail (a URL that looks like it carries a
// session); the video is still listed without them.
function listable(video: VideoInfo): VideoInfo | null {
  for (const candidate of [video, { ...video, captions: [] }]) {
    if (isVideosMessage({ ...header, type: 'videos', videos: [candidate] })) return candidate;
  }
  return null;
}

export function createPlayerScript(env: PlayerScriptEnv): PlayerScript {
  // Keyed by the entry id the player has. The listed entryId can differ: the API follows
  // entry redirects.
  let sessions = new Map<string, PlayerSession>();
  const videos = new Map<string, VideoInfo>();
  // Entries already fetched, listed or not; they are not fetched again while they stay loaded.
  const settled = new Set<string>();
  const failedOrigins = new Set<string>();
  let needsReload = false;

  const postVideos = () =>
    env.post({ ...header, type: 'videos', videos: [...videos.values()].slice(0, LIMITS.videos) });

  function postFetchFailed(origin: string) {
    env.post({ ...header, type: 'fetch-failed', origin });
  }

  async function load(session: PlayerSession, fetchApi: typeof fetch): Promise<void> {
    const request = buildPlaybackContextRequest(session);
    let response: Response;
    try {
      response = await fetchApi(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });
    } catch {
      const { origin } = new URL(request.url);
      if (!failedOrigins.has(origin)) {
        failedOrigins.add(origin);
        postFetchFailed(origin);
      }
      return;
    }
    // API errors (an expired ks, a deleted entry) and unreadable answers leave the entry out.
    const video = parsePlaybackContext(await response.json());
    if (!sessions.has(session.entryId)) return;
    const shown = listable(video);
    if (!shown) return;
    videos.set(session.entryId, shown);
    postVideos();
  }

  async function check(): Promise<void> {
    sessions = new Map(readPlayerSessions(env.kalturaPlayer()).map((s) => [s.entryId, s]));

    let removed = false;
    for (const entryId of videos.keys()) {
      if (!sessions.has(entryId)) {
        videos.delete(entryId);
        removed = true;
      }
    }
    for (const entryId of settled) {
      if (!sessions.has(entryId)) settled.delete(entryId);
    }
    if (removed) postVideos();
    if (!sessions.size) return;

    if (!env.fetch) {
      if (!needsReload) {
        needsReload = true;
        env.post({ ...header, type: 'needs-reload' });
      }
      return;
    }
    const loads: Promise<void>[] = [];
    for (const session of sessions.values()) {
      if (settled.has(session.entryId)) continue;
      settled.add(session.entryId);
      loads.push(load(session, env.fetch).catch(() => undefined));
    }
    await Promise.all(loads);
  }

  function republish(): void {
    if (videos.size) postVideos();
    failedOrigins.forEach(postFetchFailed);
    if (needsReload) env.post({ ...header, type: 'needs-reload' });
  }

  function answerDownloadRequest(data: unknown): DownloadUrlPortMessage | null {
    if (!isDownloadRequestMessage(data)) return null;
    for (const [entryId, video] of videos) {
      const session = sessions.get(entryId);
      if (video.entryId !== data.entryId || !session || !video.progressive) continue;
      try {
        const url = withReferrer(flavorUrl(video.progressive, data.flavorId), env.pageUrl());
        return { url: withKs(url, session.ks, session.allowedOrigins) };
      } catch {
        return {};
      }
    }
    return {};
  }

  return { check, republish, answerDownloadRequest };
}
