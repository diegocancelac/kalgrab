import type { Flavor } from './kaltura/playback-context';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1024-based, one decimal below 10: "980 B", "3.0 MB", "1.2 GB", "15 GB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (unit < UNITS.length - 1 && Number(value.toFixed(value < 10 ? 1 : 0)) >= 1024) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 9.95 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

/** "0:42", "12:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "720p · 6.0 MB", or the bitrate when the height is unknown. */
export function qualityLabel(flavor: Flavor): string {
  const quality = flavor.height
    ? `${flavor.height}p`
    : flavor.bitrate
      ? `${flavor.bitrate} kbps`
      : 'Unknown quality';
  return flavor.sizeBytes ? `${quality} · ${formatBytes(flavor.sizeBytes)}` : quality;
}
