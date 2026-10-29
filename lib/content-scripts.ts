import { browser, type Browser } from 'wxt/browser';

// The bridge goes first so it is already listening when the player script posts.
const SCRIPTS = [
  { id: 'bridge', file: '/content-scripts/bridge.js', world: 'ISOLATED' },
  { id: 'player', file: '/content-scripts/player.js', world: 'MAIN' },
] as const;

const HOST_PATTERN = /^(\*|https?):\/\/[^/]+/;

/**
 * The content scripts to register for the granted host patterns: every frame, from
 * document_start, including about:blank and srcdoc frames of a granted origin.
 */
export function contentScriptRegistrations(
  origins: readonly string[],
): Browser.scripting.RegisteredContentScript[] {
  // matchOriginAsFallback only accepts patterns whose path is "/*".
  const matches = [
    ...new Set(
      origins.flatMap((origin) => HOST_PATTERN.exec(origin)?.[0] ?? []).map((host) => `${host}/*`),
    ),
  ];
  if (!matches.length) return [];
  return SCRIPTS.map(({ id, file, world }) => ({
    id,
    js: [file],
    world,
    matches,
    allFrames: true,
    matchOriginAsFallback: true,
    runAt: 'document_start',
  }));
}

async function sync(): Promise<void> {
  const ids = SCRIPTS.map((script) => script.id);
  const registered = await browser.scripting.getRegisteredContentScripts({ ids });
  if (registered.length) {
    await browser.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    });
  }
  const { origins = [] } = await browser.permissions.getAll();
  const scripts = contentScriptRegistrations(origins);
  if (scripts.length) await browser.scripting.registerContentScripts(scripts);
}

let syncing = Promise.resolve();

/**
 * Registers the content scripts for exactly the hosts granted right now. Calls are
 * serialized: permission events and startup can overlap, and two registrations with the
 * same ids would fail.
 */
export function syncContentScripts(): Promise<void> {
  syncing = syncing.then(sync, sync);
  return syncing;
}

/** Runs both scripts in a tab that was already open when access was granted. */
export async function injectIntoTab(tabId: number): Promise<void> {
  for (const { file, world } of SCRIPTS) {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [file],
      world,
      injectImmediately: true,
    });
  }
}
