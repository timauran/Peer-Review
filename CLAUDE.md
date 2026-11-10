# Peer Review — project notes for Claude

RASLO radiology peer-review system. Single-file Google Apps Script, container-bound to a Google Sheet. See README.md for the feature overview and version history.

## IDs and deployment

- Apps Script project: `1xff8ILyGnzpbqj4PnmgFe6mzIf4O4JyJ2EoQ4GjsMjCgd6Fvv1un5mjs` (in `.clasp.json`, `rootDir: "."`)
- Spreadsheet: `1UzWdq8wnh3N4wqVFqT3y-REYv82h3TAtlhlYzSTHKf8` (also `CONFIG.SPREADSHEET_ID` in Code.js)
- EmailHub library: `1sKT8KV-5rbw-5n8ZwGjukKCgJ0ZRfupm-0mVJGSLF1d6v94hGB2tW5-Q`, dev mode, declared in `appsscript.json`. Its `runJob` path needs only the `spreadsheets` scope.
- Vertex AI: project/region/model live in Script Properties (`VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_MODEL`), set from the Setup menu. Not in the repo. Live project is `gen-lang-client-0424753179` ("PR Peer Review", ra-slo.com org). Use location `us`: current Gemini models are only on the `us`/`eu` multi-region endpoints (`aiplatform.us.rep.googleapis.com`), and single regions return 404. `global` is refused for PHI. Check model IDs and retirement dates at docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions. gcloud on this machine is signed in as the owner and can probe endpoints with a non-PHI prompt.
- Deploy with `clasp push` from the repo root. There is no separate web-app deployment; everything runs from the sheet's menu plus one time-driven trigger (`checkForRepliesAuto_`, every 30 min).
- GitHub: `timauran/Peer-Review`, branch `main`, public.

## Conventions

- **Columns are appended, never inserted.** `CONFIG.RASLO_COLS` is 1-based; Case ID is 14, Organ System is 15. New columns go at the end and `setupSystem` adds the header to existing sheets via `ensureHeader_`. This avoids shifting live data.
- **All spreadsheet access goes through `getSS_()`**, never `SpreadsheetApp.getActiveSpreadsheet()` directly, so trigger and standalone contexts work.
- **Reference sheet column F ("Systems") is user-maintained.** `setupReferenceSheet_` rebuilds only A–E and seeds F only when empty. Do not reintroduce `sheet.clear()` there.
- **Case ID is the sole key matching Gmail replies to rows.** `generateCaseId_` checks uniqueness against RASLO + Archive.
- **Cross-sheet matching uses the normalizers** `normalizeNameKey_` / `normalizeDateKey_` / `normalizeMrnKey_` (date-type and name-format drift between sheets broke raw string matching before).
- **Gemini output is snapped to sheet lists** (`fuzzyMatchRadiologist`, `matchOrganSystem_`); unmatched values are kept and flagged, not dropped.
- **HIPAA rules (v8.5, see HIPAA.md). Do not regress these:**
  - Gemini calls go only to Vertex AI (`callGemini_`, regional aiplatform endpoint, OAuth bearer). Never reintroduce `generativelanguage.googleapis.com` or API keys.
  - All email containing PHI goes through `sendPhiEmail_` (domain allowlist). `GmailApp.sendEmail` must appear only there.
  - Subject lines carry the Case ID only, never patient name.
  - `debugLog_`/`debugError_` messages never include patient name, MRN, narrative, email subjects/bodies, or model output. Log Case IDs, counts, lengths, status codes, recipient addresses.
  - `appsscript.json` has explicit `oauthScopes`. Adding a service means adding its scope, and that forces every user to re-authorize.
- Library dependencies affect every user at load time. Anyone who edits the sheet needs Viewer access to any library in `appsscript.json`, or the menu disappears for them. Avoid adding more libraries.
- Version header comment at the top of Code.js lists changes per version; bump it with each functional change.
- Commit messages: write them to a file in the scratchpad and use `git commit -F`; PowerShell here-strings mangle quotes.

## Testing

No Apps Script test harness in the repo. Tests are throwaway Node scripts in the session scratchpad: load all of Code.js with `vm.runInContext` under stubbed Apps Script globals (`Session`, `Utilities`, `PropertiesService`, `ScriptApp`, `UrlFetchApp`, `GmailApp`), then call the real functions. The v8.5 HIPAA tests also scan the source statically (no patient var in subjects, one `GmailApp.sendEmail`, no PHI variable in log calls). Always run `node --check Code.js` before `clasp push`.
