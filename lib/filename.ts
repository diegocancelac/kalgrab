// ext4 and APFS cap a name at 255 bytes; stay well below it.
const MAX_FILENAME_BYTES = 200;
const FALLBACK = 'video';

// Characters Windows rejects, plus path separators on every OS. Control chars
// are covered by the \u0000-\u001f range.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Bidi controls (they can make "invoice\u202Etxt.exe" look like another extension)
// and zero-width characters. U+200C (ZWNJ) is kept, Persian and other scripts
// need it. U+200D is handled separately.
const INVISIBLE_CHARS = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
// A ZWJ is kept only when it joins emoji, so family and profession sequences survive.
const STRAY_ZWJ =
  /(?<![\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F])\u200D|\u200D(?!\p{Extended_Pictographic})/gu;

const encoder = new TextEncoder();
const segmenter = new Intl.Segmenter();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

// Cuts on grapheme cluster boundaries so ZWJ sequences, flags and combining
// marks are never split.
function truncateToBytes(text: string, maxBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const { segment } of segmenter.segment(text)) {
    bytes += byteLength(segment);
    if (bytes > maxBytes) break;
    result += segment;
  }
  return result;
}

function stripEdges(text: string): string {
  // Leading dots would create hidden files, trailing dots and spaces are
  // stripped silently by Windows.
  return text
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
}

function sanitizeTitle(title: string, maxBytes: number): string {
  let base = stripEdges(
    title
      .normalize('NFC')
      .replace(INVISIBLE_CHARS, '')
      .replace(STRAY_ZWJ, '')
      .replace(/\s+/g, ' ')
      .replace(INVALID_CHARS, '_'),
  );

  // "CON.mp4" is reserved too, the check applies to the part before the first dot.
  if (base && WINDOWS_RESERVED.test(base.split('.')[0] ?? '')) {
    base = `_${base}`;
  }

  return stripEdges(truncateToBytes(base, maxBytes)) || FALLBACK;
}

/** Builds a download filename that is valid on Windows, macOS and Linux. */
export function toFilename(title: string, extension: string): string {
  const ext = extension.replace(/^\.+/, '').replace(/[^a-z0-9]/gi, '');
  if (!ext) return sanitizeTitle(title, MAX_FILENAME_BYTES);
  return `${sanitizeTitle(title, MAX_FILENAME_BYTES - ext.length - 1)}.${ext}`;
}
