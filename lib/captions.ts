// Kaltura serves captions as WebVTT (playbackCaptions[].webVttUrl); the popup offers SRT.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  lrm: String.fromCharCode(0x200e),
  rlm: String.fromCharCode(0x200f),
};

const TIMING_LINE = /^\s*(\S+)\s+-->\s+(\S+)(?:\s.*)?$/;
const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;
const IGNORED_BLOCK = /^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/;

function toSrtTimestamp(value: string): string | null {
  const match = TIMESTAMP.exec(value);
  if (!match) return null;
  const [, hours = '0', minutes = '0', seconds = '0', millis = '0'] = match;
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds},${millis.padEnd(3, '0')}`;
}

// SRT players understand <i>, <b> and <u>; every other WebVTT tag (voices, classes,
// karaoke timestamps) is dropped. Entities are decoded last, in one pass, so
// "&amp;lt;" ends up as "&lt;".
function cleanCueText(lines: string[]): string {
  return lines
    .map((line) =>
      line
        .replace(/<(\/?)([a-z0-9]*)[^>]*>/gi, (_tag, slash: string, name: string) =>
          /^[ibu]$/i.test(name) ? `<${slash}${name.toLowerCase()}>` : '',
        )
        .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_entity, name: string) => ENTITIES[name] ?? '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

/** Converts WebVTT text to SRT. Cues that cannot be parsed or have no text are skipped. */
export function vttToSrt(vtt: string): string {
  const source = vtt.charCodeAt(0) === 0xfeff ? vtt.slice(1) : vtt;
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n(?:[ \t]*\n)+/);

  const cues: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const first = lines[0] ?? '';
    if (first.startsWith('WEBVTT') || IGNORED_BLOCK.test(first)) continue;

    // A cue is an optional identifier line followed by the timing line.
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1) continue;
    const timing = TIMING_LINE.exec(lines[timingIndex] ?? '');
    const start = toSrtTimestamp(timing?.[1] ?? '');
    const end = toSrtTimestamp(timing?.[2] ?? '');
    if (!start || !end) continue;

    const text = cleanCueText(lines.slice(timingIndex + 1));
    if (!text) continue;
    cues.push(`${cues.length + 1}\n${start} --> ${end}\n${text}`);
  }

  return cues.length ? `${cues.join('\n\n')}\n` : '';
}
