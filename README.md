# KickMyCard

KickMyCard is a lightweight Chrome/Chromium extension that removes two intrusive overlays observed on [Anime3rb](https://anime3rb.com/).

## What it blocks

- **The complete anti-adblock modal:** detects the Arabic message asking visitors to disable their ad blocker, then hides the outer fixed wrapper including its dark `bg-black/60` backdrop. It does not rely on the randomized Alpine event attribute.
- **The invisible click overlay:** detects the fixed, viewport-sized anchor used to intercept clicks. It recognizes the supplied `hai8g.com` destination and the same full-screen overlay signature if its destination host rotates.

The content script also checks elements added dynamically after the page loads.

## Popup statistics

Open the KickMyCard toolbar button to see the total number of elements hidden, with separate counts for anti-adblock dialogs and full-screen click overlays.

A counter increases only after the extension successfully hides a matching element that was actually active. Anti-adblock dialogs must be rendered in the viewport. Click overlays must pass viewport hit-testing, so transparent anchors are counted when they really intercept pointer input, while covered, off-screen, hidden, inert, or non-interactive elements are not. When an upper overlay is hidden, the extension rescans to catch matching overlays exposed underneath. Counters are stored locally with `chrome.storage.local`, shared across Anime3rb tabs in the same browser profile, and are not sent to an external service.

Version 1.1.1 starts a fresh statistics series because counts from version 1.1.0 could include elements that were already hidden.

## Scope

The extension runs only on `anime3rb.com` and `www.anime3rb.com`. It does not block ordinary ad placements, modify the video player, or remove unrelated dialogs and page content.

## Install (unpacked)

1. Download this repository as a ZIP and extract it, or clone it with Git.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted `KickMyCard` folder.

## Run tests

Node.js 18 or newer is required. No third-party packages are needed.

```sh
npm test
```
