/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readPopupRequest,
  respond,
  type PopupResponse,
  type Sender,
} from '../lib/extension-messages';
import { parsePlaybackContext } from '../lib/kaltura/playback-context';

const ID = 'kalgrabextensionid';
const popup: Sender = { id: ID };

const refused = (error: string) => ({ ok: false, error }) as const;

describe('readPopupRequest', () => {
  it('reads a scan request from the popup', () => {
    expect(readPopupRequest({ type: 'scan', tabId: 4 }, popup, ID)).toEqual({
      ok: true,
      request: { type: 'scan', tabId: 4 },
    });
  });

  it('drops fields it does not know', () => {
    expect(readPopupRequest({ type: 'scan', tabId: 4, frameId: 2 }, popup, ID)).toEqual({
      ok: true,
      request: { type: 'scan', tabId: 4 },
    });
  });

  it('refuses requests from a tab or another extension, and says why', () => {
    const request = { type: 'scan', tabId: 4 };
    expect(readPopupRequest(request, { id: ID, tab: { id: 4 } }, ID)).toEqual(
      refused('Kalgrab only answers its popup, not a page open in a tab.'),
    );
    for (const sender of [{ id: 'another-extension' }, {}]) {
      expect(readPopupRequest(request, sender, ID)).toEqual(
        refused('Kalgrab only answers its own pages.'),
      );
    }
  });

  it('refuses malformed requests, and says why', () => {
    const malformed: [unknown, string][] = [
      [null, 'Unknown request.'],
      ['scan', 'Unknown request.'],
      [{ type: 'ping' }, 'Unknown request.'],
      [{ type: 'scan' }, 'The scan request has no valid tab id.'],
      [{ type: 'scan', tabId: '4' }, 'The scan request has no valid tab id.'],
      [{ type: 'scan', tabId: -1 }, 'The scan request has no valid tab id.'],
      [{ type: 'scan', tabId: 1.5 }, 'The scan request has no valid tab id.'],
      [{ type: 'download', tabId: 4 }, 'The download request has no valid document id.'],
    ];
    for (const [value, error] of malformed) {
      expect(readPopupRequest(value, popup, ID), JSON.stringify(value)).toEqual(refused(error));
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
    expect(readPopupRequest(download, popup, ID)).toEqual({ ok: true, request: download });
  });

  it('refuses it from a tab', () => {
    expect(readPopupRequest(download, { id: ID, tab: { id: 4 } }, ID)).toEqual(
      refused('Kalgrab only answers its popup, not a page open in a tab.'),
    );
  });

  it('checks the video again, like a listing from the page, and never quotes it', () => {
    const videos = [
      { ...video, title: 'Lecture djJ8ZmFrZS1rcy1mb3ItdGVzdHM' },
      { ...video, isProtected: true },
      { ...video, extra: 1 },
      { ...video, progressive: { url: 'javascript:alert(1)', flavorIds: ['1_flav0360'] } },
      null,
    ];
    for (const value of videos) {
      expect(readPopupRequest({ ...download, video: value }, popup, ID)).toEqual(
        refused('The download request has no valid video.'),
      );
    }
  });

  it('refuses malformed ids', () => {
    const malformed: [unknown, string][] = [
      [{ ...download, tabId: -1 }, 'tab id'],
      [{ ...download, documentId: '' }, 'document id'],
      [{ ...download, documentId: 'a/b' }, 'document id'],
      [{ ...download, documentId: 'a'.repeat(129) }, 'document id'],
      [{ ...download, flavorId: '' }, 'flavor id'],
      [{ ...download, flavorId: '1_a,1_b' }, 'flavor id'],
      [{ ...download, flavorId: 'a'.repeat(65) }, 'flavor id'],
    ];
    for (const [value, field] of malformed) {
      expect(readPopupRequest(value, popup, ID), JSON.stringify(value).slice(0, 80)).toEqual(
        refused(`The download request has no valid ${field}.`),
      );
    }
  });
});

describe('respond', () => {
  const unexpected = refused('Kalgrab failed unexpectedly. Reopen it and try again.');

  function answer(work: () => Promise<PopupResponse>) {
    return new Promise<{ kept: unknown; response: PopupResponse }>((resolve) => {
      const kept = respond(work, (response) => resolve({ kept, response }));
    });
  }

  it('keeps the channel open and passes the response on', async () => {
    expect(await answer(async () => ({ ok: true, frames: [] }))).toEqual({
      kept: true,
      response: { ok: true, frames: [] },
    });
    expect(await answer(async () => refused('Unknown request.'))).toEqual({
      kept: true,
      response: refused('Unknown request.'),
    });
  });

  it('answers with an error when the work rejects or throws', async () => {
    expect((await answer(() => Promise.reject(new Error('https://x/ks/secret')))).response).toEqual(
      unexpected,
    );
    const throws = () => {
      throw new Error('boom');
    };
    expect((await answer(throws)).response).toEqual(unexpected);
  });
});
