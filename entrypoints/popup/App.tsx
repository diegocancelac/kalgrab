import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type {
  DownloadRequest,
  DownloadResponse,
  ScanRequest,
  ScanResponse,
} from '@/lib/extension-messages';
import { buildListing, type ListedVideo, type Listing } from '@/lib/listing';

const HOST_ACCESS = { origins: ['*://*/*'] };

type State =
  | { step: 'checking' }
  | { step: 'no-access'; denied?: boolean }
  | { step: 'scanning' }
  | { step: 'failed'; message: string }
  | { step: 'listed'; tabId: number; listing: Listing };

const failed = (message: string): State => ({ step: 'failed', message });
const NO_ANSWER = 'Kalgrab did not answer. Reopen it and try again.';

async function scanActiveTab(): Promise<State> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return failed('Kalgrab cannot run on this page.');
  const request: ScanRequest = { type: 'scan', tabId: tab.id };
  const response = (await browser.runtime.sendMessage(request)) as ScanResponse | undefined;
  if (!response) return failed(NO_ANSWER);
  if (!response.ok) return failed(response.error);
  return { step: 'listed', tabId: tab.id, listing: buildListing(response.frames) };
}

export function App() {
  const [state, setState] = useState<State>({ step: 'checking' });

  const scan = () => {
    setState({ step: 'scanning' });
    scanActiveTab().then(setState, () => setState(failed(NO_ANSWER)));
  };

  useEffect(() => {
    browser.permissions.contains(HOST_ACCESS).then(
      (granted) => (granted ? scan() : setState({ step: 'no-access' })),
      () => setState({ step: 'no-access' }),
    );
  }, []);

  // Called straight from the click: Chrome only shows the prompt during a user gesture.
  const allowAccess = () => {
    browser.permissions.request(HOST_ACCESS).then(
      (granted) => (granted ? scan() : setState({ step: 'no-access', denied: true })),
      () => setState({ step: 'no-access', denied: true }),
    );
  };

  return (
    <main>
      <h1>Kalgrab</h1>
      {(state.step === 'checking' || state.step === 'scanning') && (
        <p class="status">Looking for videos…</p>
      )}
      {state.step === 'no-access' && (
        <section class="access">
          <p>
            Kalgrab needs access to websites to read the video player, which is often embedded from
            another domain. It only runs when you click its icon.
          </p>
          <button type="button" onClick={allowAccess}>
            Allow access
          </button>
          {state.denied && <p class="error">Access was not granted.</p>}
          <p class="hint">If this window closes, click the Kalgrab icon again.</p>
        </section>
      )}
      {state.step === 'failed' && <p class="error">{state.message}</p>}
      {state.step === 'listed' && <VideoList tabId={state.tabId} listing={state.listing} />}
    </main>
  );
}

function VideoList({ tabId, listing }: { tabId: number; listing: Listing }) {
  return (
    <>
      {listing.videos.length ? (
        <ul class="videos">
          {listing.videos.map((item) => (
            <VideoItem key={item.key} tabId={tabId} item={item} />
          ))}
        </ul>
      ) : (
        <p class="status">No videos found on this page. If it is still loading, reopen Kalgrab.</p>
      )}
      {listing.unreachableHosts.map((host) => (
        <p key={host} class="error">
          Could not reach {host}.
        </p>
      ))}
    </>
  );
}

type Download =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'started' }
  | { status: 'failed'; message: string };

function VideoItem({ tabId, item }: { tabId: number; item: ListedVideo }) {
  const [flavorId, setFlavorId] = useState(item.qualities[0]?.flavorId ?? '');
  const [download, setDownload] = useState<Download>({ status: 'idle' });

  const start = async () => {
    setDownload({ status: 'starting' });
    const request: DownloadRequest = {
      type: 'download',
      tabId,
      documentId: item.documentId,
      video: item.video,
      flavorId,
    };
    try {
      const response = (await browser.runtime.sendMessage(request)) as DownloadResponse | undefined;
      if (!response) setDownload({ status: 'failed', message: NO_ANSWER });
      else if (!response.ok) setDownload({ status: 'failed', message: response.error });
      else setDownload({ status: 'started' });
    } catch {
      setDownload({ status: 'failed', message: NO_ANSWER });
    }
  };

  return (
    <li>
      <h2 title={item.video.title}>{item.video.title}</h2>
      <p class="meta">{item.duration}</p>
      {item.problem ? (
        <p class="problem">{item.problem}</p>
      ) : (
        <div class="actions">
          <select
            aria-label="Quality"
            value={flavorId}
            onChange={(event) => setFlavorId(event.currentTarget.value)}
          >
            {item.qualities.map((q) => (
              <option key={q.flavorId} value={q.flavorId}>
                {q.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={download.status === 'starting'} onClick={start}>
            Download
          </button>
        </div>
      )}
      {download.status === 'started' && <p class="done">Download started.</p>}
      {download.status === 'failed' && <p class="error">{download.message}</p>}
    </li>
  );
}
