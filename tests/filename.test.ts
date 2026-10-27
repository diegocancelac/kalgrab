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

  it('normalizes to NFC', () => {
    expect(toFilename('Cafe\u0301', 'mp4')).toBe('Café.mp4');
  });

  describe('byte limit', () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const MAX = 200;

    it('leaves a title that fits exactly untouched', () => {
      const title = 'a'.repeat(MAX - '.mp4'.length);
      expect(toFilename(title, 'mp4')).toBe(`${title}.mp4`);
    });

    it('counts the extension and stays within the limit for ASCII', () => {
      const name = toFilename('a'.repeat(500), 'mp4');
      expect(bytes(name)).toBe(MAX);
      expect(name.endsWith('.mp4')).toBe(true);
    });

    it('counts UTF-8 bytes for CJK titles', () => {
      const name = toFilename('講'.repeat(200), 'mp4');
      // 3 bytes per character: 65 fit in 196 bytes
      expect(name).toBe(`${'講'.repeat(65)}.mp4`);
      expect(bytes(name)).toBeLessThanOrEqual(MAX);
    });

    it('counts UTF-8 bytes for emoji and never splits surrogate pairs', () => {
      const name = toFilename('😀'.repeat(300), 'mp4');
      // 4 bytes per emoji: 49 fit in 196 bytes
      expect(name).toBe(`${'😀'.repeat(49)}.mp4`);
      expect(() => encodeURIComponent(name)).not.toThrow();
    });

    it('keeps a reserved-name prefix inside the limit', () => {
      const name = toFilename(`nul.${'a'.repeat(300)}`, 'mp4');
      expect(name.startsWith('_nul.')).toBe(true);
      expect(bytes(name)).toBeLessThanOrEqual(MAX);
    });

    it('does not cut a ZWJ sequence in half', () => {
      const family = '👨\u200D👩\u200D👧';
      // 7 filler bytes leave room for a partial family but not the whole 18-byte cluster
      const title = `${'a'.repeat(196 - 7)}${family}${family}`;
      const name = toFilename(title, 'mp4');
      expect(name).toBe(`${'a'.repeat(196 - 7)}.mp4`);
    });

    it('keeps a whole ZWJ sequence when it fits', () => {
      const family = '👨\u200D👩\u200D👧';
      expect(toFilename(`${family} class`, 'mp4')).toBe(`${family} class.mp4`);
      expect(toFilename('a'.repeat(100) + family + 'b'.repeat(200), 'mp4')).toContain(family);
    });

    it('does not leave a dangling combining mark at the cut', () => {
      // "x" + U+0301 has no precomposed form, so NFC keeps it as two code points
      const name = toFilename(`${'a'.repeat(195)}x\u0301tail`, 'mp4');
      expect(name).toBe(`${'a'.repeat(195)}.mp4`);
      expect(name).not.toContain('\u0301');
    });

    it('keeps a combining mark together with its base when both fit', () => {
      const name = toFilename(`${'a'.repeat(185)}x\u0301tail`, 'mp4');
      expect(name).toBe(`${'a'.repeat(185)}x\u0301tail.mp4`);
    });

    it('strips dots and spaces exposed by the cut', () => {
      const name = toFilename(`${'a'.repeat(195)}. . b`, 'mp4');
      expect(name).toBe(`${'a'.repeat(195)}.mp4`);
    });
  });

  describe('invisible characters', () => {
    it('removes bidi controls from an RTLO title', () => {
      const name = toFilename('invoice\u202Etxt.exe', 'mp4');
      expect(name).toBe('invoicetxt.exe.mp4');
      expect(name).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    });

    it('removes isolates and directional marks', () => {
      expect(toFilename('a\u2066b\u2069c\u200Ed\u200Fe', 'mp4')).toBe('abcde.mp4');
    });

    it('removes zero-width characters and BOMs', () => {
      expect(toFilename('\uFEFFa\u200Bbc', 'mp4')).toBe('abc.mp4');
    });

    it('keeps a ZWNJ, which is part of Persian spelling', () => {
      expect(toFilename('\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', 'mp4')).toBe(
        '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645.mp4',
      );
    });

    it('removes a ZWJ that does not join emoji', () => {
      expect(toFilename('a\u200Db', 'mp4')).toBe('ab.mp4');
      expect(toFilename('\u200D😀', 'mp4')).toBe('😀.mp4');
      expect(toFilename('😀\u200D', 'mp4')).toBe('😀.mp4');
    });

    it('falls back when only invisible characters are left', () => {
      expect(toFilename('\u200B\u202E\uFEFF', 'mp4')).toBe('video.mp4');
    });
  });

  it('sanitizes the extension too', () => {
    expect(toFilename('clip', 'm p/4')).toBe('clip.mp4');
    expect(toFilename('clip', '')).toBe('clip');
  });
});
