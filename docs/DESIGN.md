# Design

Notes on the decisions behind Kalgrab's architecture. The code is in `entrypoints/` (the
background, the popup and the two page scripts) and `lib/` (everything testable without a
browser).

## Runs only when clicked

Kalgrab registers nothing on pages: no content scripts in the manifest, no `webRequest`, no
polling, no badge and no state kept across navigations. When the popup opens, the
background injects `scan.js` into every frame of the current tab with
`scripting.executeScript`. When a download starts, it injects `session.js` into the one
document that listed the video (`documentIds`), so a page that navigated in between fails
instead of answering for another video.

The cost is that a video is only found if its player is on the page when the icon is
clicked. In return, Kalgrab sees nothing about the pages you visit until you ask it to, and
there is no long-lived code in pages for them to interfere with.

## executeScript results as the only channel

Both page scripts run in the page's main world, because that is where `KalturaPlayer`
lives. What their `main()` returns comes back to the background as the result of
`executeScript`. There is no `postMessage`, `MessagePort`, isolated-world bridge or runtime
message from the page.

An earlier version kept a script in every frame and talked to it through a bridge and
`MessagePort`s. Every message through it could be seen, forged or replayed by the page,
and the bridge had to stay loaded on every site. A return value goes to the one caller
that asked for it, once.

## Everything from the page is untrusted

The page controls its main world, including `KalturaPlayer` and `fetch`. So the background
treats every script result as page data:

- `lib/messages.ts` has guards (`isVideosMessage`, `isFetchFailedMessage`,
  `isSessionsMessage`) that accept only the exact shapes Kalgrab produces, with bounded
  sizes and lengths, and only `http(s)` URLs. A frame whose result is not exactly a list
  of valid messages is ignored whole.
- A listing may not contain anything that looks like a session token: a value starting
  with `djJ8` (base64 of `v2|`), or a `ks` path pair, parameter or fragment in a URL.
- The popup sends back the video it was shown, and the background checks it again before
  using it. Requests are only accepted from the extension's own popup, not from tabs or
  other extensions.
- Kaltura API errors have anything ks-like removed before they reach the popup. Traces in
  development builds strip URLs.

## The ks

The Kaltura session (`ks`) is the player's own, read from `config.provider.ks`.

- The scan asks the Kaltura API for the playback context from inside the page, with the
  page's own `fetch`, as the player does. In that case the ks only goes from the page to
  the player's Kaltura API, and the result that reaches the background has no ks.
- If the page's `fetch` is not native (a wrapper could read the request), the scan returns
  the sessions instead and the background makes the request.
- For a download, `session.js` returns the player's current sessions. The background picks
  the one for the video, builds the signed URL and passes it to `downloads.download` (or,
  for captions, fetches the track with it). All of this happens inside one request
  handler (`download()` or `downloadCaptions()`): the ks is never stored, logged, put in an
  error message or sent to the popup.

The signed download URL ends up in Chrome's download history like any other download.
Anyone who can read that history can also read the browser's cookies, and Kaltura sessions
expire within hours, so Kalgrab does not try to erase it.

## Where the ks may go

`withKs` (`lib/kaltura/playback-context.ts`) is the only function that puts a ks in a URL,
and it only does so for URLs on the player's own `serviceUrl` or `cdnUrl` origins. Nothing
is trusted by host name: a URL that merely looks like Kaltura's, or one supplied by the
page, never gets the session, and a self-hosted Kaltura works as long as the player points
to it. The ks goes in as a `/ks/<value>` path pair on `playManifest` URLs and as a `ks`
parameter on `api_v3` URLs.

## Referrer

Kaltura access control can limit a video to some domains. The player sends the page as a
base64 `referrer` parameter on `playManifest` requests, and a download started by the
extension sends no `Referer` header, so `withReferrer` adds the same parameter with the URL
of the frame that showed the video.

## Protected videos

A video is protected if any of its sources has a non-empty `drm` list. Protected videos and
videos blocked by an access-control rule are listed with the reason and never downloaded.
The HLS parser (for the planned HLS support) reports a playlist as encrypted when it has
an `EXT-X-KEY` or `EXT-X-SESSION-KEY` whose method is not `NONE`. Kalgrab does not bypass DRM or encryption.

## Why access to all sites

The scan has to run in the player's frame, which in an LMS is a cross-origin iframe.
`activeTab` only covers the top-level page. Asking only for the player's site would need
that site to be known before access is granted, and with LTI 1.3 it is not: the iframe
starts on the LMS's own launch URL and reaches the Kaltura site after redirects and a form
submission. `webNavigation` would reveal it, but Chrome presents that permission as "Read
your browsing history". So the optional `*://*/*` is requested from the popup on first
use. The measurements and alternatives are in
[issue #17](https://github.com/diegocancelac/kalgrab/issues/17).
