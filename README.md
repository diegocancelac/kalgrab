# Kalgrab

Chromium extension (Manifest V3) that downloads videos from Kaltura players, including
players embedded in cross-origin iframes such as Kaltura KAF inside an LMS.

Status: early development. The extension builds, but detection and downloads are not
implemented yet.

## How it works

- A content script in the page's main world reads the Kaltura player (Player v7 or the
  legacy v2 `kWidget`) and asks the Kaltura API it already uses for the available sources.
- Downloads use the progressive MP4 source when available, otherwise HLS segments
  remuxed to MP4 in an offscreen document.
- Videos with DRM or encrypted HLS streams are not downloaded.
- The Kaltura session token (`ks`) is only sent to the Kaltura service it came from. It is
  never logged or stored.

## Permissions

| Permission           | Why                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `*://*/*` (optional) | Read the player inside iframes whose domain is not known in advance, which `activeTab` does not cover. Requested from the popup on first use; can be revoked from Chrome's settings. |
| `scripting`          | Run the detection script in the current tab when the icon is clicked.                                                                                                                |
| `downloads`          | Save videos.                                                                                                                                                                         |

No host access is requested at install time, and nothing runs on a page until the
Kalgrab icon is clicked.

## Install

Download the zip from the latest release, unzip it, open `chrome://extensions`, enable
Developer mode and choose "Load unpacked".

## Development

Requires Node.js 24 and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm dev        # Chromium with the extension loaded and hot reload
pnpm lint
pnpm typecheck
pnpm test
pnpm build      # output in .output/chrome-mv3
pnpm build:dev  # output in .output/chrome-mv3-dev, with traces in the service worker console
pnpm zip
```

The traces in `pnpm dev` and `pnpm build:dev` builds follow each scan and download step
(frames, message types, validation, response) without session tokens or URLs. Production
builds leave them out.

Development builds also declare `*://*/*` in `host_permissions`, so they have site access
from install. Production builds only list it as optional; `pnpm check:manifest` (run in
CI) fails if the production manifest declares `host_permissions`.

Releases are built by CI when a `v*` tag matching the `package.json` version is pushed.

Test fixtures in `tests/fixtures` are sanitized captures. Never commit HAR files, tokens,
cookies or real user or course data.

## Responsible use

Kalgrab is meant for personal use, such as watching course recordings offline. You are
responsible for complying with copyright law, the content owner's terms and your
institution's policies. Do not redistribute content you do not have rights to. Kalgrab does
not and will not bypass DRM or encryption.

## License

[MIT](LICENSE)
