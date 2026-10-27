import { describe, expect, it } from 'vitest';
import { toFilename } from '../lib/filename';

describe('toFilename', () => {
  it('keeps a plain title and appends the extension', () => {
    expect(toFilename('Sample lecture', 'mp4')).toBe('Sample lecture.mp4');
  });

  it('accepts an extension with a leading dot', () => {
    expect(toFilename('Sample lecture', '.srt')).toBe('Sample lecture.srt');
  });

  it('replaces characters that are invalid in file names', () => {
    expect(toFilename('Intro: part 1/2 <draft> "v2"?', 'mp4')).toBe(
      'Intro_ part 1_2 _draft_ _v2_.mp4',
    );
  });

  it('never lets a title escape into a path', () => {
    const name = toFilename('..\\..\\evil/../name', 'mp4');
    expect(name).not.toMatch(/[\\/]/);
    expect(name.startsWith('.')).toBe(false);
  });

  it('replaces control characters', () => {
    expect(toFilename('a\u0000b\nc\td', 'mp4')).toBe('a_b c d.mp4');
  });

  it('collapses whitespace and trims the ends', () => {
    expect(toFilename('  Week   3 \n lecture  ', 'mp4')).toBe('Week 3 lecture.mp4');
  });

  it('strips leading dots and trailing dots or spaces', () => {
    expect(toFilename('...hidden. . ', 'mp4')).toBe('hidden.mp4');
  });

  it('prefixes Windows reserved device names', () => {
    expect(toFilename('CON', 'mp4')).toBe('_CON.mp4');
    expect(toFilename('lpt1', 'mp4')).toBe('_lpt1.mp4');
    expect(toFilename('nul.backup', 'mp4')).toBe('_nul.backup.mp4');
  });

  it('does not touch names that merely start with a reserved word', () => {
    expect(toFilename('Console basics', 'mp4')).toBe('Console basics.mp4');
  });

  it('falls back when nothing usable is left', () => {
    expect(toFilename('', 'mp4')).toBe('video.mp4');
    expect(toFilename(' . .. ', 'mp4')).toBe('video.mp4');
  });

  it('keeps non-ASCII titles', () => {
    expect(toFilename('Cálculo diferencial — 講義 1', 'mp4')).toBe(
      'Cálculo diferencial — 講義 1.mp4',
    );
  });

  it('truncates long titles without splitting surrogate pairs', () => {
    const name = toFilename('😀'.repeat(300), 'mp4');
    expect([...name]).toHaveLength(120 + '.mp4'.length);
    expect(() => encodeURIComponent(name)).not.toThrow();
  });

  it('sanitizes the extension too', () => {
    expect(toFilename('clip', 'm p/4')).toBe('clip.mp4');
    expect(toFilename('clip', '')).toBe('clip');
  });
});
