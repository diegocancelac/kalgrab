/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPopupRequest, type Sender } from '../lib/extension-messages';
import { parsePlaybackContext } from '../lib/kaltura/playback-context';

const ID = 'kalgrabextensionid';
const popup: Sender = { id: ID };

describe('readPopupRequest', () => {
  it('reads a scan request from the popup', () => {
    expect(readPopupRequest({ type: 'scan', tabId: 4 }, popup, ID)).toEqual({
      type: 'scan',
      tabId: 4,
    });
  });

  it('drops fields it does not know', () => {
    expect(readPopupRequest({ type: 'scan', tabId: 4, frameId: 2 }, popup, ID)).toEqual({
      type: 'scan',
      tabId: 4,
    });
  });

  it('refuses requests from a tab or another extension', () => {
    const request = { type: 'scan', tabId: 4 };
    expect(readPopupRequest(request, { id: ID, tab: { id: 4 } }, ID)).toBe(null);
    expect(readPopupRequest(request, { id: 'another-extension' }, ID)).toBe(null);
    expect(readPopupRequest(request, {}, ID)).toBe(null);
  });

  it('refuses malformed requests', () => {
    const malformed = [
      null,
      'scan',
      { type: 'scan' },
      { type: 'scan', tabId: '4' },
      { type: 'scan', tabId: -1 },
      { type: 'scan', tabId: 1.5 },
      { type: 'download', tabId: 4 },
    ];
    for (const value of malformed) {
      expect(readPopupRequest(value, popup, ID)).toBe(null);
    }
  });
});

describe('readPopupRequest: download', () => {
  const video = parsePlaybackContext(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, 'fixtures', 'getPlaybackContext.multirequest.json'),
        'utf8',
      ),
    ),
  );
  const download = {
    type: 'download',
    tabId: 4,
    documentId: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
    video,
    flavorId: '1_flav0360',
  };

  it('reads a download request from the popup', () => {
    expect(readPopupRequest(download, popup, ID)).toEqual(download);
  });

  it('refuses it from a tab', () => {
    expect(readPopupRequest(download, { id: ID, tab: { id: 4 } }, ID)).toBe(null);
  });

  it('checks the video again, like a listing from the page', () => {
    const videos = [
      { ...video, title: 'Lecture djJ8ZmFrZS1rcy1mb3ItdGVzdHM' },
      { ...video, isProtected: true },
      { ...video, extra: 1 },
      { ...video, progressive: { url: 'javascript:alert(1)', flavorIds: ['1_flav0360'] } },
      null,
    ];
    for (const value of videos) {
      expect(readPopupRequest({ ...download, video: value }, popup, ID)).toBe(null);
    }
  });

  it('refuses malformed ids', () => {
    const malformed = [
      { ...download, tabId: -1 },
      { ...download, documentId: '' },
      { ...download, documentId: 'a/b' },
      { ...download, documentId: 'a'.repeat(129) },
      { ...download, flavorId: '' },
      { ...download, flavorId: '1_a,1_b' },
      { ...download, flavorId: 'a'.repeat(65) },
    ];
    for (const value of malformed) {
      expect(readPopupRequest(value, popup, ID), JSON.stringify(value).slice(0, 80)).toBe(null);
    }
  });
});
