# Twideo

A small, static X/Twitter video downloader. Paste a post link, choose a resolution, and open the original MP4 on `video.twimg.com`.

Twideo is intentionally lightweight: no framework, no build step, no backend, no API key, and no analytics.

## Features

- Accepts `x.com` and `twitter.com` post links, including mobile links, `/i/web/status/` links, query strings, and `/video/1` suffixes
- Also accepts bare numeric post IDs or text containing a post link
- Lists every MP4 resolution X exposes, highest first
- Shows exact dimensions, estimated file size, duration, thumbnail, author, and post text
- Supports posts with multiple videos and GIFs (served as MP4)
- One-click input clearing
- Recent lookups saved locally in the browser
- Responsive dark UI, keyboard-friendly, reduced-motion support

## How it works

1. `lib.js` extracts the post ID from the input.
2. `app.js` requests public metadata directly from the [FxTwitter API](https://docs.fxembed.com/api/introduction):
   `https://api.fxtwitter.com/2/status/{id}`
3. MP4 variants are normalized, deduplicated by dimensions, sorted highest-first, and rendered as direct `video.twimg.com` links.
4. Clicking a resolution opens the raw MP4 in a new tab. Twideo never proxies or hosts the media.

The FxTwitter API allows browser CORS and does not require an account. Its public rate limit is 1000 requests per minute per IP.

## Run locally

There is no build step. Serve the directory with any static file server:

```sh
python3 -m http.server 8000
```

Open <http://localhost:8000>.

Opening `index.html` directly from the filesystem will not work because it uses JavaScript modules.

## Tests

The parser and normalizer have unit tests using Node's built-in test runner. No dependencies need to be installed.

```sh
npm test
```

Requires Node.js 20 or newer.

## Deploy to GitHub Pages

1. Create a GitHub repository and push these files to the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose **Branch: main** and **Folder: / (root)**, then save.
5. The site will be available at `https://<username>.github.io/<repository>/`.

All asset paths are relative, so the site works from a project subpath. `.nojekyll` tells GitHub Pages to serve the files without Jekyll processing. No GitHub Actions workflow is required.

## Project structure

```
index.html          Page structure and templates
styles.css          Dark theme and responsive layout
lib.js              Input parsing, API normalization, formatting
app.js              API requests, DOM rendering, input clearing, recent lookups
tests/lib.test.js   Unit tests for lib.js
favicon.svg         Logo and favicon
package.json        Test script only; no dependencies
.nojekyll           GitHub Pages configuration
```

## Known limitations

- **The video player opens, not a save dialog.** Links point directly to twimg, and browsers play MP4 files inline. The page explains how to save the file from the player. Forcing a download would require a backend or a client-side blob proxy.
- **FxTwitter is a third-party dependency.** If it is unavailable, rate-limited, or changes CORS behavior, lookups fail with an error message. The API call is isolated in `app.js` so it can be replaced later.
- **No `t.co` short-link resolution.** The full `x.com`/`twitter.com` URL is required.
- **Public posts only.** Deleted, protected, and age-restricted posts are not supported.
- **No HLS downloads.** `.m3u8` playlists are hidden; only MP4 variants are listed.
- **Sizes are estimates.** They are calculated from bitrate × duration, not from the actual file size.

## Privacy and legal

Twideo has no backend, cookies, or analytics. Post metadata is fetched directly from FxTwitter in the browser; recent lookup summaries (post ID, handle, and video count) stay in `localStorage`. Media is served directly by twimg when a link is clicked.

Twideo is not affiliated with X Corp. X and Twitter are trademarks of X Corp. Only download content you have the right to save, and respect copyright and X's terms.
