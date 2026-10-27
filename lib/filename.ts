const MAX_BASE_LENGTH = 120;
const FALLBACK = 'video';

// Characters Windows rejects, plus path separators on every OS. Control chars
// are covered by the \u0000-\u001f range.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]+/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeTitle(title: string): string {
  let base = title
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(INVALID_CHARS, '_')
    .trim()
    // Leading dots would create hidden files, trailing dots and spaces are
    // stripped silently by Windows.
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');

  // Spread by code point so the cut never splits a surrogate pair.
  const chars = [...base];
  if (chars.length > MAX_BASE_LENGTH) {
    base = chars.slice(0, MAX_BASE_LENGTH).join('').trimEnd();
  }

  // "CON.mp4" is reserved too, the check applies to the part before the first dot.
  if (!base || WINDOWS_RESERVED.test(base.split('.')[0] ?? '')) {
    return base ? `_${base}` : FALLBACK;
  }
  return base;
}

/** Builds a download filename that is valid on Windows, macOS and Linux. */
export function toFilename(title: string, extension: string): string {
  const ext = extension.replace(/^\.+/, '').replace(/[^a-z0-9]/gi, '');
  const base = sanitizeTitle(title);
  return ext ? `${base}.${ext}` : base;
}
