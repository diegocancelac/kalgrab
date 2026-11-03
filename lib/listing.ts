// Turns a scan response into what the popup shows: one entry per video, with the MP4
// qualities it can download or the reason it cannot, and the hosts that could not be reached.

import { formatDuration, qualityLabel } from './format';
import type { VideoInfo } from './kaltura/playback-context';
import type { FrameVideos } from './tab-scan';

export interface Quality {
  flavorId: string;
  label: string;
}

export interface ListedVideo {
  /** Stable within one listing. */
  key: string;
  documentId: string;
  /** Exactly as the scan listed it: the background checks it again on download. */
  video: VideoInfo;
  duration: string;
  /** Best first. Empty when `problem` is set. */
  qualities: Quality[];
  problem?: string;
}

export interface Listing {
  videos: ListedVideo[];
  unreachableHosts: string[];
}

function problemOf(video: VideoInfo, qualities: Quality[]): string | undefined {
  if (video.isProtected) return 'This video is protected.';
  if (video.blocked) return video.blocked.reason;
  if (!video.progressive) return 'This video has no MP4 download.';
  if (!qualities.length) return 'No MP4 quality is available for this video.';
  return undefined;
}

function mp4Qualities(video: VideoInfo): Quality[] {
  const ids = video.progressive?.flavorIds ?? [];
  return video.flavors
    .filter((f) => ids.includes(f.id))
    .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
    .map((f) => ({ flavorId: f.id, label: qualityLabel(f) }));
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

/** A video shown by several frames is listed once, from the first frame. */
export function buildListing(frames: readonly FrameVideos[]): Listing {
  const seen = new Set<string>();
  const videos: ListedVideo[] = [];
  for (const frame of frames) {
    for (const video of frame.videos) {
      if (seen.has(video.entryId)) continue;
      seen.add(video.entryId);
      const qualities = mp4Qualities(video);
      const problem = problemOf(video, qualities);
      videos.push({
        key: `${frame.frameId}:${video.entryId}`,
        documentId: frame.documentId,
        video,
        duration: formatDuration(video.durationSeconds),
        qualities: problem ? [] : qualities,
        ...(problem && { problem }),
      });
    }
  }
  const hosts = frames.flatMap((f) => f.failedOrigins.map(hostOf));
  return { videos, unreachableHosts: [...new Set(hosts)] };
}
