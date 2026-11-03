# Security policy

## Supported versions

Only the latest release gets fixes.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and click
**Report a vulnerability**. Do not open a public issue.

Include the Kalgrab version, the browser and version, and the steps to reproduce. Do not
include real session tokens (`ks`), cookies, HAR files or URLs from your institution;
describe the page structure instead.

Relevant reports include, for example:

- a `ks` sent to an origin other than the player's own Kaltura origins, logged, stored or
  exposed to a page;
- a page being able to make Kalgrab download a file or open a URL it did not list;
- Kalgrab running on a page before its icon is clicked.

Kalgrab does not bypass DRM or encryption, and requests to add that are out of scope.
