# STATUS

_Last updated 2026-11-10_

## Latest session (2026-11-10)

- User configured Vertex AI (project gen-lang-client-0424753179, us-west1, gemini-3.8-flash); pasting a case gave a 404.
- Cause: current Gemini models are only on the `us`/`eu` multi-region endpoints. Verified with gcloud using a non-PHI prompt: `us` + gemini-3.8-flash returns 200; single regions return 404.
- v8.5.1: multi-region endpoint support, defaults `us` / `gemini-3.8-flash`, test call before saving config, clearer 404 hint. Pushed to Apps Script and GitHub.
- Verified the project is in the ra-slo.com org with billing and the Vertex AI API enabled.
- **User action:** re-run Setup → Configure Vertex AI (HIPAA) and enter `us` as the location. The stored value is still `us-west1`.

## Previous session (2026-11-09)

- v8.5: HIPAA technical safeguards. Gemini moved from AI Studio (no BAA) to Vertex AI. PHI email limited to approved domains. Case-ID-only subject lines. Minimum-necessary reminders and BOD doc. PHI removed from logs. Audit trail with acting user and recipients. Bulk-send confirmation. Explicit OAuth scopes.
- Wrote HIPAA.md: data-flow table, what the code enforces, owner actions.
- Verified with Node tests (allowlist edge cases, Vertex call shape, no PHI in any Gemini failure path, static source checks, reply-parsing regression). All pass.

## Complete

- v8.2–v8.5 live on the Apps Script project and on GitHub `main`.

## Remaining / open (owner actions; details in HIPAA.md)

1. **Re-authorize** as the trigger owner (open sheet, run any menu item). The 30-min reply trigger fails until this is done.
2. **Confirm the Workspace BAA** is accepted in the Admin console.
3. **Vertex AI:** API enabled and project chosen (gen-lang-client-0424753179). Still to do: re-run Configure Vertex AI with location `us`; confirm the billing account is under the Google Cloud BAA and that "Generative AI on Agent Platform" covers Vertex `generateContent`; grant Vertex AI User to other Gemini users.
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

Ask whether re-running Configure Vertex AI with location `us` passed its connection test and whether a pasted test case now parses. If not, read the `_DebugLog` rows from `testVertexConfig_` / `callGemini_` (HTTP code + API status), and probe the endpoint with gcloud and a non-PHI prompt.
