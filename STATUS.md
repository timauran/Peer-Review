# STATUS

_Last updated 2026-10-12_

## This session

- Diagnosed why the Peer Review menu does not appear for shared editors: the EmailHub library dependency (added 2026-10-03 in commit 1379460) fails to resolve for anyone without read access to that library project, so the whole script fails to load for them. The `typeof EmailHub` fallback cannot cover this.
- Documented the fix (share the EmailHub script as Viewer with every editor) in README.md, corrected the misleading code comment, created CLAUDE.md and this file.

## Complete

- v8.2 robustness fixes, v8.3 MMC export fixes, v8.4 Organ System column — all live on the Apps Script project and on GitHub `main`.
- EmailHub run-reporting for the reply trigger (from the 2026-10-03 session).

## Remaining / open

- **Owner action:** share the EmailHub library (`1sKT8KV-5rbw-5n8ZwGjukKCgJ0ZRfupm-0mVJGSLF1d6v94hGB2tW5-Q`) with the non-RASLO editor(s) as Viewer, then have them reload the sheet. If the menu still fails for them, the next thing to try is pinning the library to a published version (`developmentMode: false` in appsscript.json) rather than dev mode.
- **Owner action (one-time):** run Peer Review → Setup → Initial Setup so the Organ System header, dropdown, and Reference!F seed list exist on the live sheet.
- Optional: "Backfill Organ Systems (Gemini)" menu item to classify existing cases.
- Optional: move Organ System next to Study Type (would need a one-time column migration in setup).

## Next step to resume from

Confirm with the user whether sharing the EmailHub library fixed the editor's menu. If not, switch the dependency to a pinned version and `clasp push`.
