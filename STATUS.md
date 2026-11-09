# STATUS

_Last updated 2026-11-09_

## This session

- v8.5: HIPAA technical safeguards. Gemini moved from AI Studio (no BAA) to Vertex AI. PHI email limited to approved domains. Case-ID-only subject lines. Minimum-necessary reminders and BOD doc. PHI removed from logs. Audit trail with acting user and recipients. Bulk-send confirmation. Explicit OAuth scopes.
- Wrote HIPAA.md: data-flow table, what the code enforces, owner actions.
- Verified with Node tests (allowlist edge cases, Vertex call shape, no PHI in any Gemini failure path, static source checks, reply-parsing regression). All pass.

## Complete

- v8.2–v8.5 live on the Apps Script project and on GitHub `main`.

## Remaining / open (owner actions; details in HIPAA.md)

1. **Re-authorize** as the trigger owner (open sheet, run any menu item). The 30-min reply trigger fails until this is done.
2. **Confirm the Workspace BAA** is accepted in the Admin console.
3. **Vertex AI:** pick a Cloud project under the Google Cloud BAA, confirm with Google that "Generative AI on Agent Platform" covers Vertex `generateContent`, enable the API, grant Vertex AI User, then run Setup → Configure Vertex AI (HIPAA). Gemini intake is OFF until then.
4. **Revoke the old AI Studio API key** in AI Studio / Cloud console.
5. **Privacy officer review** of pre-v8.5 PHI sent to AI Studio (possible impermissible disclosure).
6. **Remove the non-RASLO editor** from the spreadsheet unless covered by a BAA.
7. Run Setup → Initial Setup, then Setup → Redact PHI from Pre-v8.5 Log Entries.
8. Consider making the GitHub repo private.
- Still open from earlier: Organ System backfill menu item (optional); moving Organ System next to Study Type (optional).

## Open questions

- Should any non-ra-slo.com domains (e.g. hospital partners with BAAs) be on the approved email list?
- Does the BOD need patient name/MRN in its summary? Currently off (`CONFIG.BOD_INCLUDE_IDENTIFIERS`).

## Next step to resume from

Ask the user whether owner actions 1–3 are done. If Vertex calls fail, read the `_DebugLog` row from `callGemini_` (HTTP code + API status) and check the project/role/API setup, or link the Apps Script project to the Cloud project.
