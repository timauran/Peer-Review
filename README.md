# RASLO Peer Review Management System

Google Apps Script (container-bound to the RASLO tracking spreadsheet) that manages the radiology peer-review workflow for RA-SLO:

- **Case intake** — paste freeform text or scan labeled Gmail messages; Gemini extracts patient, MRN, study type, physician, narrative, and rating. MMC import/export is also supported.
- **Review routing** — sends primary and secondary review request emails to radiologists, tracked by a permanent Case ID (`PR-YYYYMMDD-XXXX`) embedded in every subject line.
- **Reply capture** — a 30-minute trigger (or manual menu action) scans Gmail threads, extracts the fresh reply text, appends it to the case's Discussion column, and advances the case status.
- **BOD workflow** — generates a Board of Directors summary Google Doc for cases pending a vote; completed cases are archived.

## Files

| File | Purpose |
|---|---|
| `Code.js` | Entire system (v8.2) |
| `appsscript.json` | Apps Script manifest (V8 runtime) |
| `.clasp.json` | clasp binding to the Apps Script project |

## Deploying

```bash
clasp push
```

## v8.2 fixes (2026-08-07 review)

1. **Trigger-safe spreadsheet access** — every `SpreadsheetApp.getActiveSpreadsheet()` call now goes through `getSS_()`, which falls back to `openById(CONFIG.SPREADSHEET_ID)`. The auto-reply trigger and debug logging can no longer fail for lack of an active spreadsheet context.
2. **Gmail label lifecycle actually implemented** — after a reply is captured, the thread is moved from `PeerReview` to `PeerReview/Processed` as the in-app documentation always claimed. Previously the swap never happened, and the "Re-scan Processed Threads" menu action searched a label that nothing ever applied.
3. **Template fill no longer corrupted by `$`** — `fillTemplate_` used string replacement, so `$&`, `$'`, etc. in a narrative would mangle the outgoing email. Now uses a function replacement.
4. **Case ID uniqueness enforced** — `generateCaseId_` verifies the ID against the live and archive sheets before use. The Case ID is the sole key matching email replies to patient rows, so a random collision would have cross-wired two cases' replies. The ineffective `Utilities.sleep(50)` "uniqueness" delays were removed (they also slowed imports).
5. **No more send-then-crash duplicate emails** — the `_ThreadTracker` sheet is auto-created at every call site. Previously, if setup had not been run, the email sent and then the code crashed before updating status, inviting a duplicate send.
6. **Consistent reply dedup** — the re-scan path now uses the same sender+date key as the main checker, so it cannot double-append a reply that was extracted slightly differently (plain vs HTML).
7. **Dialog HTML escaping** — patient/case data is escaped before being placed into the secondary-review dialog's HTML.
8. **Correct HTML entity decode order** — `&amp;` decodes last, preventing double-decoding.
9. **Missing-sheet guard** in the manual reply checker.
