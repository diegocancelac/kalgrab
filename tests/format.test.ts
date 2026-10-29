import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, qualityLabel } from '../lib/format';

describe('formatBytes', () => {
  it('picks the unit and keeps one decimal below 10', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(980)).toBe('980 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(3_134_464)).toBe('3.0 MB');
    expect(formatBytes(6_249_472)).toBe('6.0 MB');
    expect(formatBytes(15 * 1024 ** 2)).toBe('15 MB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
  });

  it('moves to the next unit instead of showing 1024', () => {
    expect(formatBytes(1024 ** 2 - 1)).toBe('1.0 MB');
    expect(formatBytes(1024 ** 3 - 1)).toBe('1.0 GB');
  });

  it('rounds to a whole number from 9.95 up', () => {
    expect(formatBytes(9.94 * 1024 ** 2)).toBe('9.9 MB');
    expect(formatBytes(9.96 * 1024 ** 2)).toBe('10 MB');
  });
});

describe('formatDuration', () => {
  it('shows minutes and seconds, and hours when there are any', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(132.6)).toBe('2:12');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('qualityLabel', () => {
  it('shows the height and the size', () => {
    expect(
      qualityLabel({ id: 'a', width: 1280, height: 720, bitrate: 378, sizeBytes: 6_249_472 }),
    ).toBe('720p · 6.0 MB');
    expect(qualityLabel({ id: 'a', width: 1280, height: 720, bitrate: 378 })).toBe('720p');
  });

  it('falls back to the bitrate when the height is unknown', () => {
    expect(qualityLabel({ id: 'a', width: 0, height: 0, bitrate: 128 })).toBe('128 kbps');
    expect(qualityLabel({ id: 'a', width: 0, height: 0, bitrate: 0 })).toBe('Unknown quality');
  });
});
