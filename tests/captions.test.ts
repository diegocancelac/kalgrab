/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vttToSrt } from '../lib/captions';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'captions.vtt'), 'utf8');

describe('vttToSrt', () => {
  it('converts the sample file', () => {
    expect(vttToSrt(fixture)).toBe(
      [
        '1',
        '00:00:01,000 --> 00:00:03,500',
        'Welcome to the sample lecture.',
        '',
        '2',
        '00:00:04,000 --> 00:00:06,250',
        'Today we cover <i>two</i> topics:',
        '<b>vectors</b> & matrices.',
        '',
        '3',
        '01:02:03,004 --> 01:02:05,000',
        'Second line with a karaoke tag.',
        '',
        '4',
        '00:00:07,000 --> 00:00:08,000',
        'Short timestamp without hours.',
        '',
      ].join('\n'),
    );
  });

  it('renumbers cues and ignores the original identifiers', () => {
    const srt = vttToSrt(
      'WEBVTT\n\nintro\n00:00:01.000 --> 00:00:02.000\na\n\n9\n00:00:03.000 --> 00:00:04.000\nb\n',
    );
    expect(srt.split('\n\n').map((cue) => cue.split('\n')[0])).toEqual(['1', '2']);
  });

  it('accepts CRLF and CR line endings', () => {
    const lf = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nline 1\nline 2\n';
    expect(vttToSrt(lf.replace(/\n/g, '\r\n'))).toBe(vttToSrt(lf));
    expect(vttToSrt(lf.replace(/\n/g, '\r'))).toBe(vttToSrt(lf));
  });

  it('accepts a leading BOM', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\ntext\n';
    expect(vttToSrt(String.fromCharCode(0xfeff) + vtt)).toBe(vttToSrt(vtt));
  });

  it.each([
    'X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000',
    'X-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000',
  ])('ignores the HLS timestamp map header (%s)', (header) => {
    const vtt = `WEBVTT\n${header}\n\n00:00:01.000 --> 00:00:02.000\ntext\n`;
    expect(vttToSrt(vtt)).toBe('1\n00:00:01,000 --> 00:00:02,000\ntext\n');
  });

  it('ignores the timestamp map next to other header lines and a title', () => {
    const vtt = [
      'WEBVTT - sample',
      'Kind: captions',
      'X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000',
      'Language: en',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'text',
    ].join('\n');
    expect(vttToSrt(vtt)).toBe('1\n00:00:01,000 --> 00:00:02,000\ntext\n');
  });

  it('ignores NOTE, STYLE and REGION blocks between cues', () => {
    const vtt = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:02.000',
      'first',
      '',
      'NOTE a comment on the same line',
      '',
      'NOTE',
      'a comment',
      'on several lines',
      '',
      'STYLE',
      '::cue { color: red }',
      '',
      'REGION',
      'id:r1',
      'width:40%',
      '',
      '00:00:03.000 --> 00:00:04.000',
      'second',
      '',
      'NOTE trailing comment',
    ].join('\n');
    expect(vttToSrt(vtt)).toBe(
      '1\n00:00:01,000 --> 00:00:02,000\nfirst\n\n2\n00:00:03,000 --> 00:00:04,000\nsecond\n',
    );
  });

  it('does not mistake a cue identifier that starts with NOTE for a comment', () => {
    const vtt = 'WEBVTT\n\nNOTES-1\n00:00:01.000 --> 00:00:02.000\ntext\n';
    expect(vttToSrt(vtt)).toBe('1\n00:00:01,000 --> 00:00:02,000\ntext\n');
  });

  it('converts timestamps without hours', () => {
    const vtt = 'WEBVTT\n\n00:07.000 --> 59:59.999\ntext\n';
    expect(vttToSrt(vtt)).toBe('1\n00:00:07,000 --> 00:59:59,999\ntext\n');
  });

  it('pads short millisecond fields', () => {
    expect(vttToSrt('WEBVTT\n\n00:00:01.5 --> 00:00:02.25\ntext\n')).toContain(
      '00:00:01,500 --> 00:00:02,250',
    );
  });

  it('keeps hours beyond two digits', () => {
    expect(vttToSrt('WEBVTT\n\n100:00:00.000 --> 100:00:01.000\ntext\n')).toContain(
      '100:00:00,000 --> 100:00:01,000',
    );
  });

  it('decodes entities once', () => {
    const srt = vttToSrt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n&amp;lt; &lt;b&gt; a&nbsp;b\n');
    expect(srt).toContain('&lt; <b> a b');
  });

  it('removes voice, class and ruby tags but keeps their text', () => {
    const srt = vttToSrt(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Ana>hi</v> <c.big>there</c> <ruby>x<rt>y</rt></ruby>\n',
    );
    expect(srt).toContain('hi there xy');
  });

  it('skips cues with an invalid timing line or no text', () => {
    const vtt = [
      'WEBVTT',
      '',
      'bad --> worse',
      'ignored',
      '',
      '00:00:01.000 --> 00:00:02.000',
      '<c></c>',
      '',
      '00:00:03.000 --> 00:00:04.000',
      'kept',
    ].join('\n');
    expect(vttToSrt(vtt)).toBe('1\n00:00:03,000 --> 00:00:04,000\nkept\n');
  });

  it('returns an empty string when there are no cues', () => {
    expect(vttToSrt('')).toBe('');
    expect(vttToSrt('WEBVTT\n')).toBe('');
    expect(vttToSrt('not a caption file')).toBe('');
  });
});
