# HIPAA notes — RASLO Peer Review

_Written for v8.5, 2026-11-09._

Code alone cannot make RASLO HIPAA compliant. Compliance also depends on signed Business Associate Agreements (BAAs), admin console settings, access decisions, and policies. This file covers both parts:

1. The technical safeguards the script now enforces.
2. The actions only an owner or admin can take. **Several of these must happen before the system is used again with real cases.**

## Where PHI goes

| Location | What PHI | Covered by |
|---|---|---|
| Spreadsheet (RASLO Tracking, Archive, MMC sheets, Gemini Input) | Everything | Google Workspace BAA (Google Sheets) |
| Apps Script runtime | Everything, in memory | Google Workspace BAA (Google Apps Script is on Google's covered list) |
| Gmail (review emails, replies, labeled intake emails) | Name, MRN, dates, narrative, discussion | Google Workspace BAA (Gmail), **only while recipients are inside a BAA** |
| BOD summary Google Doc | Narrative, discussion, study details (no name/MRN by default) | Google Workspace BAA (Google Docs) |
| Gemini extraction | Full pasted or emailed case text | **Google Cloud BAA, only via Vertex AI.** See below. |
| EmailHub central log | Counts only, never names; error text withheld for this job (`phi: true`) | No PHI stored |
| GitHub repo `timauran/Peer-Review` | None. Code and radiologist roster only | Must never contain PHI |

Google's HIPAA page lists the covered Workspace services, including Gmail, Google Drive (Docs, Sheets), and Google Apps Script. Third-party add-ons are not covered. EmailHub is RASLO's own library, not a third-party add-on.

## What v8.5 enforces in code

- **Gemini only through Vertex AI.** The script used the Google AI Studio Gemini API (`generativelanguage.googleapis.com`) with an API key. No BAA covers that service, and its terms forbid use in clinical practice. That path is removed. Gemini now calls a regional Vertex AI endpoint in a Cloud project the owner configures, authenticated with the user's OAuth token. Until an owner runs **Setup → Configure Vertex AI (HIPAA)**, the Gemini menu items refuse to run.
- **Recipient domain allowlist.** Every PHI email goes through one function, `sendPhiEmail_`. It refuses any address outside the approved domains (default `ra-slo.com`, editable under **Setup → Set Approved Email Domains**). Consumer mailboxes such as gmail.com are always refused, even if someone adds them to the list.
- **No PHI in subject lines.** Subjects carry only the Case ID. Subjects show up in phone notifications, lock screens, and inbox previews.
- **Minimum necessary reminders.** Reminder emails carry the Case ID and study type, and point back to the original review email. They contain no name, MRN, date, or narrative.
- **No PHI in logs.** The debug log stopped receiving Gemini output, email subjects, and patient summaries. Gemini error messages never echo model output or input text. Older rows can be cleaned with **Setup → Redact PHI from Pre-v8.5 Log Entries**.
- **Audit trail.** Each log row records the acting user. Each send records the recipient address. Status Notes entries end with "(by user@ra-slo.com)".
- **Minimum necessary BOD doc.** The board summary identifies cases by Case ID and omits patient name and MRN. It carries a confidentiality banner. To include identifiers, set `CONFIG.BOD_INCLUDE_IDENTIFIERS` to `true`.
- **Bulk send confirmation.** "Send ALL Entered as Primary" confirms the count before sending.

## Owner actions

### Before using the system again

1. **Re-authorize the script.** v8.5 declares its OAuth scopes explicitly and adds the Cloud scope for Vertex AI. Open the spreadsheet as the account that installed the 30-minute trigger and run any Peer Review menu item. Approve the prompt. Until then, the reply-checking trigger fails, and EmailHub will flag it.
2. **Confirm the Google Workspace BAA is accepted.** In the Admin console, go to Account → Account settings → Legal and compliance. If the HIPAA BAA has not been accepted, nothing in this system may hold PHI.
3. **Set up Vertex AI under the Google Cloud BAA.**
   - Use a Cloud project inside the RASLO organization, under a billing account covered by the Google Cloud BAA.
   - Confirm coverage. Google renamed Vertex AI's generative product, and its HIPAA page now lists it as "Generative AI on Agent Platform". That is very likely the service behind the Vertex `generateContent` endpoint, but Google's page does not say so outright. Get confirmation from your Google Cloud account team before sending PHI.
   - Enable the Vertex AI API in that project.
   - Grant the **Vertex AI User** role to each person who will use the Gemini menu items.
   - Optionally link the Apps Script project to this Cloud project (Apps Script editor → Project Settings → Google Cloud Platform project). Do this if Vertex calls fail with a "project has not enabled the API" error.
   - Run **Setup → Configure Vertex AI (HIPAA)**. Use location `us` and model `gemini-3.8-flash`. Current Gemini models are served only from the `us`/`eu` multi-region endpoints, not from single regions like `us-west1`. The dialog sends a test prompt with no patient data before saving.
   - The configured project is `gen-lang-client-0424753179` ("PR Peer Review"). It sits in the ra-slo.com organization with billing enabled. Confirm that billing account is covered by the Google Cloud BAA.
4. **Revoke the old Gemini API key.** Configuring Vertex AI deletes the key from Script Properties, but the key itself stays valid until revoked. Delete it in Google AI Studio or in the Cloud console's Credentials page.
5. **Review past disclosures with your privacy officer.** Before v8.5, case text including patient names and MRNs went to the AI Studio API, which has no BAA. That may be an impermissible disclosure that needs a documented breach risk assessment. Earlier subject lines also carried patient names, and nothing stopped emails to non-RASLO addresses. The `_DebugLog` sheet and the Gemini Input sheet show roughly when Gemini intake was used.
6. **Remove non-workforce editors.** Only RASLO workforce accounts, or organizations with a signed BAA, may have access to the spreadsheet. A non-RASLO account was shared on the sheet earlier for menu testing. Remove it unless a BAA covers that person.
7. **Check the Radiologists sheet.** Every email there must be a work address on an approved domain. Rows with other addresses are now skipped, and the send dialog lists them.

### Once, after upgrading

- Run **Setup → Initial Setup** to add the "User" column to the log.
- Run **Setup → Redact PHI from Pre-v8.5 Log Entries**. The spreadsheet's version history still holds the old text. It stays inside the BAA-covered file, so it is not a disclosure, but anyone with edit access can view version history.

### Workspace admin settings worth confirming

- 2-Step Verification enforced for everyone with access.
- Drive external sharing restricted for the people who use this file, so the sheet and BOD docs can't be shared outside RASLO.
- Gmail TLS compliance rule requiring TLS for any approved partner domain.
- Google Vault retention rules for the spreadsheet and the Peer Review Gmail labels, matching your records policy.

### Ongoing

- Keep the GitHub repo free of PHI. Never commit sheet exports, logs, or screenshots. Making the repo private is recommended: `gh repo edit timauran/Peer-Review --visibility private --accept-visibility-change-consequences`.
- Review spreadsheet sharing and Vertex AI User role grants periodically.
- Policies, risk analysis, workforce training, and sanctions are organizational requirements and are not covered by this code.

## Residual risks

- **Free text.** Narrative and Discussion are free text and go in review emails as written. Avoid adding identifiers beyond what reviewers need.
- **Reviewer replies.** Replies may quote the original email, which includes PHI. They stay in RASLO Gmail.
- **Gemini Input sheet.** It keeps up to 2,000 characters of each source email or paste for traceability. Clear old rows when they're no longer needed.
- **Sent mail.** Sent review emails remain in the sender's Gmail under Vault retention.
- **BOD documents.** Each one is created in the generating user's My Drive and is not shared by default.

## Configuration reference

| Setting | Where | Default |
|---|---|---|
| `VERTEX_PROJECT_ID` | Script Properties, set via Setup menu | none (Gemini disabled) |
| `VERTEX_LOCATION` | Script Properties | `us` (US multi-region). `global` is refused. |
| `VERTEX_MODEL` | Script Properties | `gemini-3.8-flash` (GA, retirement no sooner than Sep 2027) |
| `PHI_ALLOWED_DOMAINS` | Script Properties, set via Setup menu | `ra-slo.com` |
| `BOD_INCLUDE_IDENTIFIERS` | `CONFIG` in Code.js | `false` |
