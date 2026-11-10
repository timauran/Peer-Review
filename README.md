# RASLO Peer Review Management System

Google Apps Script (container-bound to the RASLO tracking spreadsheet) that manages the radiology peer-review workflow for RA-SLO:

- **Case intake** — paste freeform text or scan labeled Gmail messages; Gemini extracts patient, MRN, study type, physician, narrative, and rating. MMC import/export is also supported.
- **Review routing** — sends primary and secondary review request emails to radiologists, tracked by a permanent Case ID (`PR-YYYYMMDD-XXXX`) embedded in every subject line.
- **Reply capture** — a 30-minute trigger (or manual menu action) scans Gmail threads, extracts the fresh reply text, appends it to the case's Discussion column, and advances the case status.
- **BOD workflow** — generates a Board of Directors summary Google Doc for cases pending a vote; completed cases are archived.

## Files

| File | Purpose |
|---|---|
| `Code.js` | Entire system (v8.5) |
| `HIPAA.md` | PHI data flows, safeguards, and required owner actions |
| `appsscript.json` | Apps Script manifest (V8 runtime) |
| `.clasp.json` | clasp binding to the Apps Script project |

## Deploying

```bash
clasp push
```

## IDs

| What | ID |
|---|---|
| Apps Script project (container-bound) | `1xff8ILyGnzpbqj4PnmgFe6mzIf4O4JyJ2EoQ4GjsMjCgd6Fvv1un5mjs` |
| Tracking spreadsheet | `1UzWdq8wnh3N4wqVFqT3y-REYv82h3TAtlhlYzSTHKf8` |
| EmailHub library (dependency) | `1sKT8KV-5rbw-5n8ZwGjukKCgJ0ZRfupm-0mVJGSLF1d6v94hGB2tW5-Q` (development mode, v1) |

## Sharing with other editors — read this first

The script is container-bound, so sharing the spreadsheet shares the code. **But the project depends on the EmailHub library**, and Apps Script resolves library dependencies when the project loads, before any function runs. An editor who cannot read the EmailHub script gets:

```
Library with identifier EmailHub is missing (perhaps it was deleted, or you don't have read access?)
```

and *nothing* in the project loads for them — no `onOpen`, so no Peer Review menu. The `typeof EmailHub` fallback in `checkForRepliesAuto_` does not cover this case; it only covers the library entry being removed from the manifest.

**To give someone the menu:** share the EmailHub Apps Script project with them as **Viewer** (open it at `https://script.google.com/d/1sKT8KV-5rbw-5n8ZwGjukKCgJ0ZRfupm-0mVJGSLF1d6v94hGB2tW5-Q/edit` → Share). Sharing a Google Group that contains all reviewers is the easiest way to keep this in sync with spreadsheet access. This exposes only the hub's code, not its data.

Other things every editor should expect:

- **Menu actions run as the clicking user.** Review emails go out from their Gmail, reply scanning reads their inbox, and the first click prompts a one-time authorization. Users outside ra-slo.com will see "Google hasn't verified this app" and must choose **Advanced → Go to RASLO Peer Review (unsafe)**.
- **The 30-minute reply trigger runs as whoever installed it** (normally the owner), so it keeps working regardless of other editors' library access.
- Simple triggers like `onOpen` only fire for a signed-in account that is an explicit editor. Anonymous link access and viewer access never show the menu.

## v8.5.1 — Vertex AI endpoint fix (2026-11-10)

Pasting a case failed with a Vertex AI 404 for `gemini-3.8-flash` in `us-west1`. Current Gemini models are served only from the `us`/`eu` multi-region endpoints (`aiplatform.us.rep.googleapis.com`), not single regions. The script now builds multi-region URLs, defaults to location `us` and model `gemini-3.8-flash`, and tests the settings with a no-PHI prompt before saving them. `gemini-2.5-pro`, the old default, was retired Oct 20, 2026.

## v8.5 — HIPAA technical safeguards (2026-11-09)

See [HIPAA.md](HIPAA.md) for the full picture, including the owner actions that code can't do.

- Gemini extraction moved from the Google AI Studio API, which has no BAA, to Vertex AI under the Google Cloud BAA. It stays off until an owner runs **Setup → Configure Vertex AI (HIPAA)**.
- PHI emails only go to approved domains (default `ra-slo.com`). Consumer mailboxes are always blocked.
- Subject lines carry only the Case ID. Reminders carry no patient details.
- The debug log no longer receives PHI and now records the acting user and each email recipient.
- BOD summaries omit patient name and MRN by default.
- "Send ALL Entered as Primary" now asks for confirmation.
- The manifest declares explicit OAuth scopes, so every user, including the trigger owner, must re-authorize once.

## v8.4 — Organ System tracking (2026-08-07)

Adds an **Organ System** column for more detailed case tracking.

- **Column O (col 15)** on both RASLO Tracking and Archive, appended after Case ID so no existing data shifts — the same convention used when Case ID was added. Run **Setup → Initial Setup** once to add the header to existing sheets (the RASLO sheet's existing rows are untouched).
- **Options come from the Reference sheet, column F, header `Systems`.** Setup seeds a default list there only if the column is empty and never overwrites it — edit that column to change the dropdown. `setupReferenceSheet_` previously called `sheet.clear()`, which would have wiped a user-maintained list; it now rebuilds only columns A–E.
- **Dropdown** uses a warn-only validation on Reference!F2:F200, so new entries in the list are picked up without re-running setup, and a value that isn't on the list shows a warning triangle instead of being rejected.
- **Gemini integration.** The extraction prompt now asks for `organ_system`, constrained to the live Reference list. All three Gemini intake paths (paste dialog, Gmail scan, sheet parse) populate the column. `matchOrganSystem_` normalizes Gemini's answer onto the list — exact match ignoring case/punctuation/`&`-vs-`and`, then whole-word containment (`Chest CT` → `Chest`; whole-word so `Angiography` does not become `GI`), then prefix (`Musculo` → `Musculoskeletal`). An unmatched value is kept on the sheet and flagged rather than dropped.
- **MMC import** leaves the column blank (MMC data has no equivalent field).
- **BOD summary doc** shows Organ System in each case table. Custom email templates may use `{{ORGAN_SYSTEM}}`; the default templates are unchanged so existing cases without a value don't print "(not provided)".

## v8.3 fixes — MMC Export dropping cases (2026-08-07)

Reported symptom: cases with System `MMC` and status `Completed` never appeared on the MMC Export sheet. Three independent causes, all of which failed silently:

1. **The MMC Import sheet was acting as a filter, not an enrichment source.** `exportToMMC` looked up each case in MMC Import and ran `if (!orig) continue;` — so any case without a matching import row was silently discarded. That covers every MMC case entered through the paste dialog or Gmail scan (which never creates an import row), and every case whose import row was cleared when a newer MMC batch was pasted in. The import sheet now only supplies DOB, QM No, and Reminder Email; unmatched cases export with those three fields blank.
2. **Completed cases had been archived out of scope.** `archiveCompletedCases` moves `Completed` rows to the Archive sheet and deletes them from RASLO Tracking, but the export only ever read RASLO Tracking. It now reads both, de-duplicated by Case ID.
3. **The match key could not match across sheets.** The old key was `lowercased-name|formatDateForKey_(date)`, and `formatDateForKey_` returned `yyyy-MM-dd` for real `Date` objects but the raw string for anything else. MMC Import holds pasted dates while Gemini-parsed rows hold text dates, so the two sides produced different keys for the same day. Matching now normalizes dates (`Date`, `2026-03-14`, `3/14/2026`, `3-14-26` all collapse to one key) and names (case, punctuation, and word order ignored, so `Doe, Jane M.` matches `jane m doe`), with fallback matching on MRN and then unique name.

Also fixed: the export now reports which cases went out without enrichment instead of saying nothing, and MMC import duplicate detection uses the same normalized keys **and** checks the Archive — previously, re-importing a batch would re-create cases that had already been completed and archived.

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
