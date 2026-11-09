
// ============================================================================
// RASLO PEER REVIEW MANAGEMENT SYSTEM v8.5
// Google Apps Script — Full Codebase
// ============================================================================
// v8.5 CHANGES (from v8.4) — HIPAA TECHNICAL SAFEGUARDS (see HIPAA.md):
//   - SECURITY: Gemini now runs only through Vertex AI (aiplatform, regional
//     endpoint, OAuth bearer token) in a Cloud project under the Google Cloud
//     BAA. The Google AI Studio endpoint + API key path is removed: it has no
//     BAA and its terms forbid clinical use. The old key is deleted from
//     Script Properties when Vertex AI is configured. Extraction is disabled
//     until an owner runs Setup > Configure Vertex AI (HIPAA).
//   - SECURITY: Every PHI email goes through sendPhiEmail_, which refuses
//     recipients outside the approved domains (default ra-slo.com, editable
//     via Setup > Set Approved Email Domains) and always refuses consumer
//     mailboxes. Selected-row flows show blocked rows as skipped.
//   - SECURITY: Email subjects carry only the Case ID, not the patient name.
//     Reminder bodies no longer include name, MRN, date, or narrative.
//   - SECURITY: Debug log no longer receives Gemini output, email subjects, or
//     patient summaries. Gemini error messages never echo model output.
//     Setup > Redact PHI from Pre-v8.5 Log Entries cleans older rows.
//   - AUDIT: Log rows record the acting user (new "User" column) and the
//     recipient of every PHI email. Status Notes entries record "(by user)".
//   - MINIMUM NECESSARY: BOD summary omits patient name and MRN by default
//     (CONFIG.BOD_INCLUDE_IDENTIFIERS) and carries a confidentiality banner.
//   - SAFETY: "Send ALL Entered as Primary" now confirms before bulk sending.
//   - Manifest declares explicit OAuth scopes (adds cloud-platform for
//     Vertex AI). Every user, including the trigger owner, must re-authorize.
// ============================================================================
// v8.4 CHANGES (from v8.3) — ORGAN SYSTEM TRACKING:
//   - NEW: "Organ System" column (O, col 15) on RASLO Tracking and Archive.
//     Appended after Case ID so existing data does not shift; Initial Setup
//     adds the header to existing sheets.
//   - NEW: Dropdown options are read from Reference!F under the header
//     "Systems". Setup seeds ORGAN_SYSTEM_DEFAULTS only if that column is
//     empty and never overwrites it (setupReferenceSheet_ no longer calls
//     sheet.clear(), which would have wiped the user's list).
//   - NEW: Gemini extraction returns organ_system, constrained to the live
//     Reference list. matchOrganSystem_ normalizes the result; unmatched
//     values are kept and flagged by a warn-only validation rule.
//   - NEW: Organ System appears in the BOD summary doc and is available to
//     custom email templates as {{ORGAN_SYSTEM}}.
// ============================================================================
// v8.3 CHANGES (from v8.2) — MMC EXPORT FIXES:
//   - FIX: exportToMMC no longer drops cases that have no matching row on the
//     MMC Import sheet. The import sheet is now used only to carry DOB, QM No,
//     and Reminder Email onto the export, not as a filter. Previously
//     "if (!orig) continue" silently discarded every unmatched case.
//   - FIX: exportToMMC now also reads the Archive sheet. Completed cases are
//     moved to Archive by archiveCompletedCases, so an export reading only the
//     tracker lost every case that finished the workflow.
//   - FIX: Matching is normalized. normalizeDateKey_ handles Date objects and
//     text dates ('3/14/2026', '2026-03-14', '3-14-26') identically, and
//     normalizeNameKey_ ignores case, punctuation, and word order. The old key
//     compared raw strings, so a Date on one sheet never matched text on the
//     other. Falls back to MRN, then unique-name matching.
//   - FIX: The export reports exactly which cases were exported without MMC
//     Import enrichment, instead of failing silently.
//   - FIX: MMC import duplicate detection uses the same normalized keys and
//     now also checks the Archive, so re-importing a batch cannot re-create
//     cases that were already completed and archived.
// ============================================================================
// v8.2 CHANGES (from v8.1):
//   - FIX: All spreadsheet access goes through getSS_(), which falls back to
//     SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID) when there is no active
//     spreadsheet (time-driven trigger / standalone execution).
//   - FIX: checkForRepliesInternal_ now moves threads from the PeerReview
//     label to PeerReview/Processed after capturing a reply, as documented.
//     Previously the swap never happened and "Re-scan Processed Threads"
//     could never find anything.
//   - FIX: fillTemplate_ uses a function replacement so "$" sequences in
//     sheet data no longer corrupt email bodies; empty values still render
//     as "(not provided)".
//   - FIX: generateCaseId_ now verifies uniqueness against the RASLO and
//     Archive sheets (the case ID is the sole reply-matching key). Removed
//     the ineffective Utilities.sleep(50) calls that claimed to do this.
//   - FIX: Thread tracker sheet is auto-created at every call site, so a
//     send can no longer email successfully and then crash before updating
//     status (which allowed accidental duplicate sends).
//   - FIX: rescanProcessedThreads uses the same sender+date dedup key as the
//     main reply checker, so re-scans cannot double-append replies.
//   - FIX: HTML dialog options are HTML-escaped (patient names with <, &, "
//     no longer break the secondary review dialog).
//   - FIX: HTML entity decoding order in getReplyFromMessage_ (&amp; last).
//   - FIX: checkForReplies guards against a missing RASLO sheet.
// ============================================================================
// v8.1 CHANGES (from v8):
//   - FIX: checkForRepliesInternal_ no longer skips messages just because they
//     are from the script user's email. Self-replies are now captured. The
//     original outgoing review is still correctly skipped because its body
//     starts with "RASLO PEER REVIEW" which extractReplyText_ treats as the
//     start of the quoted block, yielding empty text.
//   - FIX: Removed the "reviewer === attrib" block in sendSecondaryReviewsSelected
//     so you can assign yourself as secondary reviewer.
//   - FIX: Removed self-review guard in showSecondaryReviewDialogAll dialog.
// ============================================================================

// ---------------------------------------------------------------------------
// 0. CONFIGURATION & CONSTANTS
// ---------------------------------------------------------------------------

var CONFIG = {
  SPREADSHEET_ID: '1UzWdq8wnh3N4wqVFqT3y-REYv82h3TAtlhlYzSTHKf8',
  RASLO_SHEET: 'RASLO Tracking',
  ARCHIVE_SHEET: 'Archive',
  MMC_IMPORT_SHEET: 'MMC Import',
  MMC_EXPORT_SHEET: 'MMC Export',
  REF_SHEET: 'Reference',
  RAD_SHEET: 'Radiologists',
  GEMINI_INPUT_SHEET: 'Gemini Input',
  THREAD_TRACKER_SHEET: '_ThreadTracker',
  DEBUG_LOG_SHEET: '_DebugLog',

  // Column positions (1-based) for RASLO Tracking.
  // New columns are appended at the end so existing data never shifts:
  // CASE_ID was added at col 14 (v5), ORGAN_SYSTEM at col 15 (v8.4).
  RASLO_COLS: {
    CASE_STATUS: 1, DATE_STATUS: 2, PATIENT_NAME: 3, SYSTEM: 4,
    MRN: 5, EVENT_DATE: 6, STUDY_TYPE: 7, ATTRIB_PHYS: 8,
    REVIEW_PHYS: 9, NARRATIVE: 10, IMAGING_RATING: 11,
    STATUS_NOTES: 12, DISCUSSION: 13, CASE_ID: 14, ORGAN_SYSTEM: 15
  },
  RASLO_COL_COUNT: 15,

  // Reference sheet: column F holds the user-maintained organ system list
  // under the header "Systems". Setup seeds it only if empty and never
  // overwrites it.
  REF_ORGAN_SYSTEM_COL: 6,
  REF_ORGAN_SYSTEM_HEADER: 'Systems',

  MMC_COLS: {
    CASE_STATUS: 1, DATE_STATUS: 2, PATIENT_NAME: 3, DOB: 4,
    MRN: 5, QM_NO: 6, EVENT_DATE: 7, STUDY_TYPE: 8,
    ATTRIB_PHYS: 9, ISSUE: 10, IMAGING_RATING: 11,
    RATIONALE: 12, REMINDER_EMAIL: 13
  },

  SENDER_EMAIL: 'tauran@ra-slo.com',  // reference only — NOT used for reply filtering
  SUBJECT_PREFIX: '[RASLO-PR]',

  // ---- HIPAA safeguards (v8.5) ----
  // Gemini runs only on Vertex AI. Project ID is a Script Property set via
  // Setup > Configure Vertex AI; these are the defaults for the other two.
  VERTEX_DEFAULT_LOCATION: 'us-central1',
  VERTEX_DEFAULT_MODEL: 'gemini-2.5-pro',
  // Emails containing PHI may only go to these domains (and their
  // subdomains). Override with the PHI_ALLOWED_DOMAINS Script Property via
  // Setup > Set Approved Email Domains.
  PHI_ALLOWED_DOMAINS_DEFAULT: ['ra-slo.com'],
  // Minimum necessary: the BOD summary identifies cases by Case ID only.
  // Set true to also print patient name and MRN.
  BOD_INCLUDE_IDENTIFIERS: false,

  GMAIL_LABEL: 'PeerReview',
  GMAIL_PROCESSED_LABEL: 'PeerReview/Processed',
  GMAIL_INPUT_LABEL: 'PeerReviewInput',
  GMAIL_INPUT_DONE_LABEL: 'PeerReviewInput/Processed'
};

var STATUS_OPTIONS = ['Entered', 'Out for primary review', 'Back from primary', 'Out for secondary review', 'Back from secondary', 'Pending BOD vote', 'Completed'];
var SYSTEM_OPTIONS = ['SVH', 'TCCH', 'FH', 'AG', 'MMC', 'RASLO'];
var STUDY_TYPE_OPTIONS = ['CT', 'MRI', 'NM', 'IR', 'XR', 'US', 'FL', 'MG'];
var RATING_OPTIONS = ['eV1', 'eV2', 'eV3', 'eV4', 'eV5'];
// Seed values for Reference!F ("Systems"). Used only when that column is
// empty; the live list is always read from the sheet via getOrganSystems_().
var ORGAN_SYSTEM_DEFAULTS = [
  'Neuro', 'Head & Neck', 'Spine', 'Chest', 'Cardiac', 'Breast',
  'Abdomen', 'Pelvis', 'GI', 'GU', 'Musculoskeletal', 'Vascular',
  'Pediatric', 'Other'
];
var RADIOLOGIST_NAMES = [
  'Auran, Timothy', 'Barton, Mark', 'Burnette, William', 'Cartland, James',
  'Cedillo, Mario', 'Davis, Timothy', 'Duberg, Arthur', 'Gulaya, Karan',
  'Haddadin, Zaid', 'Hiti, Corey', 'Holtzman, Stephen', 'Jamison, Dale',
  'Lu, Timothy', 'McBride, Aaron', 'Moiyadi, Ammar', 'Muhar, Ramanjyot',
  'Mulder, Linda', 'Olson, Erik', 'Reburn, Michael', 'Selph, Chad',
  'Steele, Darren', 'Tuttle, David', 'Vogler, Elizabeth', 'Wright, William',
  'Wyatt, Eric', 'Yap, Felix', 'Ziemba, Mark', 'VetMed', 'None'
];


// ============================================================================
// 0b. SPREADSHEET ACCESS
// ============================================================================

/**
 * Returns the tracking spreadsheet. Uses the active spreadsheet when running
 * from the Sheets UI, and falls back to opening by ID for time-driven
 * triggers or standalone execution where there is no active spreadsheet.
 */
function getSS_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { }
  if (!ss) ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return ss;
}


// ============================================================================
// 1. DEBUG LOGGING
// ============================================================================

// HIPAA: the debug log doubles as the script's audit trail (who did what, to
// which Case ID, when). It must never contain PHI: log Case IDs, counts,
// lengths, and status codes, never patient names, MRNs, narratives, email
// subjects, or model output.

var LOG_HEADERS_ = ['Timestamp', 'Function', 'Message', 'Type', 'User'];

/** Email of the person running the script ('' if Google withholds it). */
function getActorEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function getLogSheet_() {
  var ss = getSS_();
  var sheet = ss.getSheetByName(CONFIG.DEBUG_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DEBUG_LOG_SHEET);
    sheet.getRange(1, 1, 1, LOG_HEADERS_.length).setValues([LOG_HEADERS_]).setFontWeight('bold');
    sheet.setColumnWidth(3, 600);
  } else if (sheet.getRange(1, LOG_HEADERS_.length).getValue() !== 'User') {
    sheet.getRange(1, LOG_HEADERS_.length).setValue('User').setFontWeight('bold');
  }
  return sheet;
}

function debugLog_(functionName, message) {
  try {
    getLogSheet_().appendRow([new Date(), functionName, String(message), 'INFO', getActorEmail_()]);
    SpreadsheetApp.flush();
  } catch (e) {
    Logger.log('DEBUG LOG FAILED: ' + e.message + ' | ' + message);
  }
}

function debugError_(functionName, error) {
  var fullMsg = '';
  if (typeof error === 'string') { fullMsg = error; }
  else if (error && error.message) {
    fullMsg = error.message;
    if (error.stack) fullMsg += '\n\nSTACK:\n' + error.stack;
  } else {
    try { fullMsg = JSON.stringify(error); } catch(e2) { fullMsg = String(error); }
  }
  try {
    getLogSheet_().appendRow([new Date(), functionName, fullMsg, 'ERROR', getActorEmail_()]);
    SpreadsheetApp.flush();
  } catch (e2) {
    Logger.log('DEBUG ERROR LOG FAILED: ' + e2.message + ' | ' + fullMsg);
  }
  return fullMsg;
}


// ============================================================================
// 2. MENU & SETUP
// ============================================================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Peer Review')
    .addItem('How to Use (Instructions)', 'showInstructions')
    .addSeparator()
    // ---- Selection-based actions (primary workflow) ----
    .addItem('Send Primary Reviews (Selected)', 'sendPrimaryReviewsSelected')
    .addItem('Send Secondary Reviews (Selected)', 'sendSecondaryReviewsSelected')
    .addItem('Send Reminder (Selected)', 'sendRemindersSelected')
    .addSeparator()
    // ---- Add new cases ----
    .addItem('Paste New Case (Gemini)...', 'showPasteDialog')
    .addItem('Scan Gmail for New Cases (Gemini)', 'scanGmailForCases')
    .addSeparator()
    // ---- Reply checking ----
    .addItem('Check for Email Replies (Manual)', 'checkForReplies')
    .addItem('Re-scan Processed Threads', 'rescanProcessedThreads')
    .addItem('Install Auto-Reply Checker (every 30 min)', 'installTimeTriggerWithConfirm')
    .addSeparator()
    // ---- BOD / Archive ----
    .addItem('Generate BOD Summary Document', 'generateBODSummaryDoc')
    .addItem('Archive Completed Cases', 'archiveCompletedCases')
    .addSeparator()
    // ---- Import / Export ----
    .addItem('Import MMC to RASLO', 'importMMCToRASLO')
    .addItem('Export RASLO to MMC', 'exportToMMC')
    .addSeparator()
    // ---- Batch sends (legacy) ----
    .addSubMenu(ui.createMenu('Batch Actions')
      .addItem('Send ALL Entered as Primary', 'sendPrimaryReviewsAll')
      .addItem('Send Secondary (from list)...', 'showSecondaryReviewDialogAll')
      .addSeparator()
      .addItem('Parse Freeform Text from Sheet (Gemini)', 'parseGeminiInput'))
    .addSeparator()
    // ---- Setup ----
    .addSubMenu(ui.createMenu('Setup')
      .addItem('Initial Setup', 'setupSystem')
      .addItem('Configure Vertex AI (HIPAA)', 'promptForVertexConfig')
      .addItem('Set Approved Email Domains', 'promptForAllowedDomains')
      .addItem('Set Template Doc IDs', 'promptForTemplateIds')
      .addItem('Backfill Missing Case IDs', 'backfillCaseIds')
      .addSeparator()
      .addItem('View Debug / Audit Log', 'showDebugLog')
      .addItem('Redact PHI from Pre-v8.5 Log Entries', 'redactLegacyDebugLog'))
    .addToUi();
}

function setupSystem() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();

  ensureSheet_(ss, CONFIG.RASLO_SHEET, getRASLOHeaders_());
  ensureSheet_(ss, CONFIG.ARCHIVE_SHEET, getRASLOHeaders_());
  ensureSheet_(ss, CONFIG.MMC_IMPORT_SHEET, getMMCHeaders_());
  ensureSheet_(ss, CONFIG.MMC_EXPORT_SHEET, getMMCHeaders_());
  ensureSheet_(ss, CONFIG.GEMINI_INPUT_SHEET, ['Freeform Text', 'Parsed Result', 'Status']);
  ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);

  getLogSheet_();

  // Ensure appended columns exist on sheets created by older versions
  // (Case ID from v4 upgrades, Organ System from pre-v8.4 sheets).
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var archiveSheet = ss.getSheetByName(CONFIG.ARCHIVE_SHEET);
  [rasloSheet, archiveSheet].forEach(function(sh) {
    if (!sh) return;
    ensureHeader_(sh, CONFIG.RASLO_COLS.CASE_ID, 'Case ID');
    ensureHeader_(sh, CONFIG.RASLO_COLS.ORGAN_SYSTEM, 'Organ System');
  });

  setupReferenceSheet_(ss);
  setupRadiologistSheet_(ss);
  applyRASLOValidations_(ss);

  ensureGmailLabel_(CONFIG.GMAIL_LABEL);
  ensureGmailLabel_(CONFIG.GMAIL_PROCESSED_LABEL);
  ensureGmailLabel_(CONFIG.GMAIL_INPUT_LABEL);
  ensureGmailLabel_(CONFIG.GMAIL_INPUT_DONE_LABEL);

  try { ss.getSheetByName(CONFIG.THREAD_TRACKER_SHEET).hideSheet(); } catch (e) { }

  debugLog_('setupSystem', 'Setup completed (v8.5)');

  ui.alert('Setup Complete',
    'System initialized (v8.5).\n\n' +
    'Organ System column (O) added. Its dropdown options come from the\n' +
    'Reference sheet, column F ("Systems") — edit that list to change them.\n\n' +
    'HIPAA: review emails only go to these domains: ' + getPhiAllowedDomains_().join(', ') + '\n' +
    'Gemini extraction is ' + (getVertexConfig_().projectId ? 'ON (Vertex AI, ' + getVertexConfig_().projectId + ')' :
      'OFF until you run Setup > Configure Vertex AI (HIPAA)') + '.\n\n' +
    'Gmail labels created:\n' +
    '  - PeerReviewInput (label emails to scan for new cases)\n' +
    '  - PeerReviewInput/Processed (auto-applied after scanning)\n' +
    '  - PeerReview (outgoing review emails)\n' +
    '  - PeerReview/Processed (replies handled)\n\n' +
    'Next steps:\n' +
    '1. Configure Vertex AI (HIPAA) to enable Gemini extraction\n' +
    '2. Check Approved Email Domains\n' +
    '3. Optionally create Doc templates and set Template Doc IDs\n' +
    '4. Fill in radiologist work emails on the Radiologists sheet\n' +
    '5. If upgrading from v4, run Setup > Backfill Missing Case IDs\n' +
    '6. Install Auto-Reply Checker for background reply scanning\n' +
    '7. If upgrading from before v8.5, run Setup > Redact PHI from Pre-v8.5 Log Entries',
    ui.ButtonSet.OK);
}

/** Menu: Setup > Set Approved Email Domains. */
function promptForAllowedDomains() {
  var ui = SpreadsheetApp.getUi();
  var cur = getPhiAllowedDomains_();
  var r = ui.prompt('Approved Email Domains',
    'Review emails contain PHI, so they are only sent to these domains.\n' +
    'Only list domains covered by your Google Workspace BAA or a signed BAA with that organization.\n\n' +
    'Current: ' + cur.join(', ') + '\n\nEnter a comma-separated list (blank keeps the current list):',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var text = r.getResponseText().trim();
  if (!text) return;

  var domains = text.split(/[,\s;]+/).map(function(d) { return d.trim().toLowerCase().replace(/^@/, ''); })
    .filter(Boolean);
  var bad = domains.filter(function(d) { return !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d); });
  if (bad.length || domains.length === 0) {
    ui.alert('Invalid domain', 'These are not valid domains: ' + bad.join(', '), ui.ButtonSet.OK);
    return;
  }
  var consumer = domains.filter(function(d) { return CONSUMER_EMAIL_DOMAINS_.indexOf(d) >= 0; });
  if (consumer.length) {
    ui.alert('Not allowed', 'Consumer email domains can never receive PHI from this system: ' +
      consumer.join(', '), ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty('PHI_ALLOWED_DOMAINS', domains.join(','));
  debugLog_('promptForAllowedDomains', 'Approved PHI email domains set to: ' + domains.join(', '));
  ui.alert('Saved', 'Approved domains: ' + domains.join(', '), ui.ButtonSet.OK);
}

/**
 * Menu: Setup > Redact PHI from Pre-v8.5 Log Entries.
 * Versions before v8.5 wrote Gemini output, email subjects, and patient
 * summaries into the debug log. This blanks the Message cell of every row
 * from the functions that did so, keeping timestamp/function/type/user as
 * the audit record. (Rows those functions write in v8.5+ are PHI-free, so
 * redacting them too loses only diagnostic detail.)
 */
function redactLegacyDebugLog() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getSS_().getSheetByName(CONFIG.DEBUG_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) { ui.alert('The debug log is empty.'); return; }

  var leaky = { callGemini_: 1, scanGmailForCases: 1, parsePastedText: 1, getGeminiApiKey_: 1, promptForApiKey: 1 };
  var n = sheet.getLastRow() - 1;
  var vals = sheet.getRange(2, 2, n, 2).getValues();  // Function, Message
  var hits = 0;
  for (var i = 0; i < n; i++) {
    if (leaky[vals[i][0]] && vals[i][1] !== '[redacted]') hits++;
  }
  if (hits === 0) { ui.alert('Nothing to redact', 'No pre-v8.5 entries from PHI-logging functions were found.', ui.ButtonSet.OK); return; }

  if (ui.alert('Redact ' + hits + ' log entries?',
      'The Message text of ' + hits + ' rows will be replaced with "[redacted]". ' +
      'Timestamps and function names stay. This cannot be undone except through the sheet\'s version history.',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var out = [];
  for (var j = 0; j < n; j++) {
    out.push([leaky[vals[j][0]] ? '[redacted]' : vals[j][1]]);
  }
  sheet.getRange(2, 3, n, 1).setValues(out);
  debugLog_('redactLegacyDebugLog', 'Redacted ' + hits + ' pre-v8.5 log entries');
  ui.alert('Done', hits + ' entries redacted. Version history of the spreadsheet still holds the old text; ' +
    'see HIPAA.md in the repo for how to handle that.', ui.ButtonSet.OK);
}

function promptForTemplateIds() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Primary Review Template', 'Enter the Google Doc ID for the Primary Review email template:', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty('PRIMARY_TEMPLATE_ID', r1.getResponseText().trim());
  }
  var r2 = ui.prompt('Secondary Review Template', 'Enter the Google Doc ID for the Secondary Review email template:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() === ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty('SECONDARY_TEMPLATE_ID', r2.getResponseText().trim());
  }
  ui.alert('Template IDs saved.');
}

function showDebugLog() {
  var ss = getSS_();
  var sheet = ss.getSheetByName(CONFIG.DEBUG_LOG_SHEET);
  if (sheet) ss.setActiveSheet(sheet);
  else SpreadsheetApp.getUi().alert('No debug log. Run Initial Setup first.');
}


// ============================================================================
// 2b. INSTRUCTIONS DIALOG
// ============================================================================

function showInstructions() {
  var html = HtmlService.createHtmlOutput(
    '<style>' +
    'body { font-family: Arial, sans-serif; padding: 16px; font-size: 13px; line-height: 1.5; color: #333; }' +
    'h2 { color: #1a73e8; margin-top: 20px; margin-bottom: 6px; font-size: 15px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }' +
    'h3 { color: #444; margin-top: 14px; margin-bottom: 4px; font-size: 13px; }' +
    'code { background: #f1f3f4; padding: 1px 5px; border-radius: 3px; font-size: 12px; }' +
    'ol, ul { padding-left: 22px; margin: 4px 0; }' +
    'li { margin-bottom: 4px; }' +
    '.label { background: #e8f0fe; color: #1967d2; padding: 1px 6px; border-radius: 3px; font-family: monospace; font-size: 12px; white-space: nowrap; }' +
    '.status { background: #fce8e6; color: #c5221f; padding: 1px 6px; border-radius: 3px; font-size: 12px; white-space: nowrap; }' +
    '.section { background: #f8f9fa; border-left: 3px solid #1a73e8; padding: 8px 12px; margin: 8px 0; }' +
    'table { border-collapse: collapse; margin: 8px 0; font-size: 12px; }' +
    'th, td { border: 1px solid #ddd; padding: 5px 10px; text-align: left; }' +
    'th { background: #f1f3f4; }' +
    '</style>' +

    '<h2>WORKFLOW OVERVIEW</h2>' +
    '<div class="section">' +
    '<b>Case lifecycle:</b> ' +
    '<span class="status">Entered</span> → ' +
    '<span class="status">Out for primary review</span> → ' +
    '<span class="status">Back from primary</span> → ' +
    '<span class="status">Out for secondary review</span> → ' +
    '<span class="status">Back from secondary</span> → ' +
    '<span class="status">Pending BOD vote</span> → ' +
    '<span class="status">Completed</span> → <b>Archive</b>' +
    '</div>' +
    '<p>Every case gets a permanent <b>Case ID</b> (e.g. <code>PR-20260314-A7K2</code>) stored in column N. ' +
    'This ID is embedded in every email subject line and is how replies are matched back to cases — ' +
    'so row insertions, deletions, or sorting will never break reply tracking.</p>' +
    '<p>Each case also has an <b>Organ System</b> (column O) for more detailed tracking. The dropdown options ' +
    'come from the <b>Reference</b> sheet, column F (header <code>Systems</code>) — edit that list to change them. ' +
    'Gemini fills this in automatically when cases are added by paste or Gmail scan; a value that does not match ' +
    'the list is kept and flagged with a warning triangle so you can correct it. ' +
    'Custom email templates can include it with <code>{{ORGAN_SYSTEM}}</code>.</p>' +

    '<h2>STEP 1 — ADD CASES</h2>' +
    '<p>Three ways to get cases into the RASLO Tracking sheet:</p>' +
    '<ol>' +
    '<li><b>Paste text (recommended):</b> Click <b>Peer Review → Paste New Case (Gemini)</b>. A dialog opens with a large text area — paste any freeform text including emails, reports, or notes with tabs and newlines intact. Gemini extracts the fields automatically. To paste <b>multiple cases at once</b>, separate them with a line containing only <code>---</code>. Press <b>Ctrl+Enter</b> as a shortcut to submit.</li>' +
    '<li><b>Gmail → Gemini parsing:</b> In Gmail, apply the <span class="label">PeerReviewInput</span> label to any email containing case info. Then click <b>Peer Review → Scan Gmail for New Cases</b>. Gemini extracts patient name, MRN, study type, etc. A Case ID is auto-generated.</li>' +
    '<li><b>MMC Import:</b> Paste MMC data into the <b>MMC Import</b> sheet, then click <b>Import MMC to RASLO</b>.</li>' +
    '</ol>' +

    '<h2>STEP 2 — SEND PRIMARY REVIEW</h2>' +
    '<ol>' +
    '<li>Go to the <b>RASLO Tracking</b> sheet.</li>' +
    '<li><b>Select the row(s)</b> you want to send. Hold Ctrl/Cmd to select non-contiguous rows.</li>' +
    '<li>Click <b>Peer Review → Send Primary Reviews (Selected)</b>.</li>' +
    '<li>A confirmation dialog shows who gets what. Click <b>Yes</b> to send.</li>' +
    '<li>Only rows with status <span class="status">Entered</span> and a valid radiologist email are sent.</li>' +
    '<li>Status auto-updates to <span class="status">Out for primary review</span>.</li>' +
    '</ol>' +

    '<h2>STEP 3 — CAPTURE PRIMARY REPLY</h2>' +
    '<div class="section">' +
    '<b>How replies get into the Discussion column:</b>' +
    '<ol>' +
    '<li>The radiologist replies to the review email in Gmail.</li>' +
    '<li>The system finds the thread via the <span class="label">PeerReview</span> label, extracts the Case ID from the subject line (e.g. <code>[PR-20260314-A7K2]</code>), looks up which row has that Case ID, and appends the reply to <b>Discussion</b> (col M).</li>' +
    '<li>Status auto-updates to <span class="status">Back from primary</span>.</li>' +
    '</ol>' +
    '<p><b>Two ways to trigger reply scanning:</b></p>' +
    '<ul>' +
    '<li><b>Manual:</b> Click <b>Peer Review → Check for Email Replies</b>.</li>' +
    '<li><b>Automatic:</b> Click <b>Install Auto-Reply Checker</b> once. Scans every 30 minutes in the background.</li>' +
    '</ul>' +
    '<p><b>Self-testing:</b> You can send a review to yourself and reply to yourself — the system will capture your reply correctly as long as you type some fresh text above the quoted original.</p>' +
    '</div>' +

    '<h2>STEP 4 — SEND SECONDARY REVIEW</h2>' +
    '<ol>' +
    '<li>For each case with status <span class="status">Back from primary</span>, set the <b>Reviewing Physician</b> dropdown (column I) to the desired secondary reviewer (you can assign yourself).</li>' +
    '<li>Select those rows on the RASLO Tracking sheet.</li>' +
    '<li>Click <b>Peer Review → Send Secondary Reviews (Selected)</b>.</li>' +
    '<li>Confirm the summary. Emails go out, status updates to <span class="status">Out for secondary review</span>.</li>' +
    '</ol>' +

    '<h2>STEP 5 — SECONDARY REPLY → BOD VOTE → ARCHIVE</h2>' +
    '<p>When the secondary reviewer replies, status auto-updates to <span class="status">Back from secondary</span>. ' +
    'Set status to <span class="status">Pending BOD vote</span> when you are ready to bring it to the Board.</p>' +
    '<ol>' +
    '<li><b>Generate summary:</b> Click <b>Peer Review → Generate BOD Summary Document</b>. This creates a Google Doc summarizing every "Pending BOD vote" case by Case ID, with study details, narrative, discussion, and a blank "BOD Decision" section with rating checkboxes. Patient name and MRN are left out (HIPAA minimum necessary). Share the doc with partners using Google Drive sharing to RASLO accounts only. Do not email it as an attachment.</li>' +
    '<li><b>Tip:</b> If you want to include specific cases regardless of status, select those rows first — the generator will use your selection.</li>' +
    '<li><b>After the vote:</b> Set status to <span class="status">Completed</span>, then click <b>Archive Completed Cases</b> to move them off the active tracker.</li>' +
    '</ol>' +

    '<h2>GMAIL LABELS</h2>' +
    '<table>' +
    '<tr><th>Label</th><th>Purpose</th><th>Applied by</th></tr>' +
    '<tr><td><span class="label">PeerReviewInput</span></td><td>Tag emails with new case info for Gemini parsing</td><td>You (or Gmail filter)</td></tr>' +
    '<tr><td><span class="label">PeerReviewInput/Processed</span></td><td>Marks scanned input emails</td><td>Script (auto)</td></tr>' +
    '<tr><td><span class="label">PeerReview</span></td><td>Applied to outgoing review email threads for reply tracking. <b>Removed</b> after replies are captured.</td><td>Script (auto)</td></tr>' +
    '<tr><td><span class="label">PeerReview/Processed</span></td><td>Applied after replies are captured — replaces the base PeerReview label</td><td>Script (auto)</td></tr>' +
    '</table>' +
    '<p>All four are created by <b>Initial Setup</b>. You only manually apply <span class="label">PeerReviewInput</span>.</p>' +

    '<h2>REMINDERS</h2>' +
    '<p>If a reviewer hasn\'t responded, select the case(s) and click <b>Peer Review → Send Reminder (Selected)</b>. ' +
    'Works for any case with status "Out for primary review" or "Out for secondary review." ' +
    'The reminder goes to the appropriate person (attributing physician for primary, reviewing physician for secondary) ' +
    'and includes how many days have elapsed since the review was sent. Each reminder is logged in Status Notes.</p>' +

    '<h2>HIPAA RULES BUILT INTO THIS SYSTEM</h2>' +
    '<ul>' +
    '<li><b>Email only goes to approved domains</b> (' + escapeHtml_(getPhiAllowedDomains_().join(', ')) + '). ' +
    'Rows whose radiologist email is elsewhere are skipped. Personal Gmail, Yahoo, and similar addresses are always blocked.</li>' +
    '<li><b>Subject lines carry only the Case ID</b>, never the patient name. Reminders contain no patient details.</li>' +
    '<li><b>Gemini runs only on Vertex AI</b> under the Google Cloud BAA. Gemini menu items show an error until an owner completes <b>Setup → Configure Vertex AI (HIPAA)</b>.</li>' +
    '<li><b>The debug log is also the audit log.</b> It records who did what to which Case ID, and never patient details.</li>' +
    '<li><b>BOD documents omit patient name and MRN.</b> Share them through Drive with RASLO accounts only.</li>' +
    '<li><b>Only RASLO workforce accounts may edit this spreadsheet.</b> Do not share it with personal accounts.</li>' +
    '</ul>' +

    '<h2>SETUP CHECKLIST</h2>' +
    '<ol>' +
    '<li>Run <b>Setup → Initial Setup</b></li>' +
    '<li>Run <b>Setup → Configure Vertex AI (HIPAA)</b> and check <b>Approved Email Domains</b></li>' +
    '<li>Optionally set <b>Template Doc IDs</b></li>' +
    '<li>Fill in radiologist <b>emails</b> on the Radiologists sheet</li>' +
    '<li>Run <b>Install Auto-Reply Checker</b></li>' +
    '<li>If upgrading from v4: run <b>Setup → Backfill Missing Case IDs</b></li>' +
    '</ol>'

  ).setWidth(720).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'RASLO Peer Review — How to Use');
}

function installTimeTriggerWithConfirm() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var existing = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkForRepliesAuto_') { existing = true; break; }
  }

  if (existing) {
    var resp = ui.alert('Trigger Already Exists',
      'The auto-reply checker is already installed (runs every 30 minutes).\n\nReinstall?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
  } else {
    var resp = ui.alert('Install Auto-Reply Checker',
      'This creates a trigger that checks for radiologist email replies every 30 minutes.\n\nInstall now?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
  }

  installTimeTrigger();
  debugLog_('installTimeTriggerWithConfirm', 'Auto-reply trigger installed via menu');
  ui.alert('Auto-Reply Checker Installed',
    'The system will check for replies every 30 minutes.\n\n' +
    'When a radiologist replies:\n' +
    '• Reply text is extracted and appended to the Discussion column\n' +
    '• The case is found by its Case ID (not row number), so sorting/editing is safe\n' +
    '• Status Notes gets a timestamped entry\n' +
    '• Primary reviewer replies set status to "Back from primary"\n' +
    '• Secondary reviewer replies set status to "Back from secondary"\n\n' +
    'You can also check manually via "Check for Email Replies".',
    ui.ButtonSet.OK);
}


// ============================================================================
// 3. SHEET SETUP HELPERS
// ============================================================================

function getRASLOHeaders_() {
  return ['Case Status', 'Date Status Update', 'Patient Name', 'System',
    'MR#/FIN#', 'Event Date', 'Imaging Study Type', 'Attributing Physician',
    'Reviewing Physician', 'Narrative', 'Imaging Rating', 'Status Notes', 'Discussion', 'Case ID', 'Organ System'];
}

function getMMCHeaders_() {
  return ['Case Status', 'Date Status Update', 'Patient Name', 'DOB',
    'MR#/FIN#', 'QM No', 'Event Date', 'Imaging Study Type',
    'Attributing Physician', 'Issue', 'Imaging Rating',
    'Rationale for Rating', 'Reminder Email'];
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function setupReferenceSheet_(ss) {
  var sheet = ss.getSheetByName(CONFIG.REF_SHEET);
  if (!sheet) sheet = ss.insertSheet(CONFIG.REF_SHEET);

  // Rebuild only columns A–E from the code constants. Column F ("Systems")
  // is user-maintained, so it must survive re-running setup — the old
  // sheet.clear() would have wiped it.
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), 5).clearContent();
  sheet.getRange('A1').setValue('Case Status').setFontWeight('bold');
  STATUS_OPTIONS.forEach(function(v, i) { sheet.getRange(i + 2, 1).setValue(v); });
  sheet.getRange('B1').setValue('System').setFontWeight('bold');
  SYSTEM_OPTIONS.forEach(function(v, i) { sheet.getRange(i + 2, 2).setValue(v); });
  sheet.getRange('C1').setValue('Study Type').setFontWeight('bold');
  STUDY_TYPE_OPTIONS.forEach(function(v, i) { sheet.getRange(i + 2, 3).setValue(v); });
  sheet.getRange('D1').setValue('Imaging Rating').setFontWeight('bold');
  RATING_OPTIONS.forEach(function(v, i) { sheet.getRange(i + 2, 4).setValue(v); });
  sheet.getRange('E1').setValue('Radiologists').setFontWeight('bold');
  RADIOLOGIST_NAMES.forEach(function(v, i) { sheet.getRange(i + 2, 5).setValue(v); });

  // Seed the organ system list only when column F has no entries.
  var col = CONFIG.REF_ORGAN_SYSTEM_COL;
  if (getOrganSystems_(ss).length === 0) {
    sheet.getRange(1, col).setValue(CONFIG.REF_ORGAN_SYSTEM_HEADER).setFontWeight('bold');
    sheet.getRange(2, col, ORGAN_SYSTEM_DEFAULTS.length, 1)
      .setValues(ORGAN_SYSTEM_DEFAULTS.map(function(v) { return [v]; }));
    debugLog_('setupReferenceSheet_', 'Seeded ' + ORGAN_SYSTEM_DEFAULTS.length + ' default organ systems in Reference!F');
  } else if (sheet.getRange(1, col).getValue() !== CONFIG.REF_ORGAN_SYSTEM_HEADER) {
    sheet.getRange(1, col).setValue(CONFIG.REF_ORGAN_SYSTEM_HEADER).setFontWeight('bold');
  }

  sheet.autoResizeColumns(1, col);
}

function setupRadiologistSheet_(ss) {
  var sheet = ss.getSheetByName(CONFIG.RAD_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.RAD_SHEET);
    sheet.getRange(1, 1, 1, 3).setValues([['Radiologist Name', 'Email', 'Active']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    RADIOLOGIST_NAMES.forEach(function(name, i) {
      sheet.getRange(i + 2, 1).setValue(name);
      sheet.getRange(i + 2, 3).setValue('Yes');
    });
    sheet.autoResizeColumns(1, 3);
  }
}

function applyRASLOValidations_(ss) {
  var sheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var ref = ss.getSheetByName(CONFIG.REF_SHEET);
  if (!sheet || !ref) return;
  var lastRow = 500;
  function setDropdown(col, refCol, refCount) {
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(ref.getRange(2, refCol, refCount, 1), true)
      .setAllowInvalid(false).build();
    sheet.getRange(2, col, lastRow, 1).setDataValidation(rule);
  }
  setDropdown(CONFIG.RASLO_COLS.CASE_STATUS, 1, STATUS_OPTIONS.length);
  setDropdown(CONFIG.RASLO_COLS.SYSTEM, 2, SYSTEM_OPTIONS.length);
  setDropdown(CONFIG.RASLO_COLS.STUDY_TYPE, 3, STUDY_TYPE_OPTIONS.length);
  setDropdown(CONFIG.RASLO_COLS.IMAGING_RATING, 4, RATING_OPTIONS.length);
  setDropdown(CONFIG.RASLO_COLS.ATTRIB_PHYS, 5, RADIOLOGIST_NAMES.length);
  setDropdown(CONFIG.RASLO_COLS.REVIEW_PHYS, 5, RADIOLOGIST_NAMES.length);

  // Organ System: point at a generous range of Reference!F so the user can
  // add options without re-running setup (blank cells are ignored by the
  // dropdown). Warn rather than reject, so a Gemini value that didn't match
  // the list is flagged for correction instead of being lost.
  var organRows = Math.max(1, Math.min(200, ref.getMaxRows() - 1));
  var organRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ref.getRange(2, CONFIG.REF_ORGAN_SYSTEM_COL, organRows, 1), true)
    .setAllowInvalid(true).build();
  sheet.getRange(2, CONFIG.RASLO_COLS.ORGAN_SYSTEM, lastRow, 1).setDataValidation(organRule);
  sheet.getRange(2, CONFIG.RASLO_COLS.DATE_STATUS, lastRow, 1).setNumberFormat('yyyy-MM-dd');
  sheet.getRange(2, CONFIG.RASLO_COLS.EVENT_DATE, lastRow, 1).setNumberFormat('yyyy-MM-dd');
}


// ============================================================================
// 4. CASE ID GENERATION & LOOKUP
// ============================================================================

/**
 * Generates a unique case ID in format PR-YYYYMMDD-XXXX
 * where XXXX is a random 4-character alphanumeric string.
 * Verifies the ID is not already used on the RASLO or Archive sheets,
 * since the case ID is the sole key matching email replies to rows.
 */
function generateCaseId_() {
  var now = new Date();
  var datePart = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I/L)
  var id = '';
  for (var attempt = 0; attempt < 5; attempt++) {
    var rand = '';
    for (var i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    id = 'PR-' + datePart + '-' + rand;
    if (!caseIdExists_(id)) return id;
  }
  return id;
}

/**
 * Returns true if the given case ID already appears on the RASLO or
 * Archive sheets.
 */
function caseIdExists_(caseId) {
  try {
    var ss = getSS_();
    var raslo = ss.getSheetByName(CONFIG.RASLO_SHEET);
    if (raslo && findRowByCaseId_(raslo, caseId) > 0) return true;
    var archive = ss.getSheetByName(CONFIG.ARCHIVE_SHEET);
    if (archive && archive.getLastRow() > 1) {
      var ids = archive.getRange(2, CONFIG.RASLO_COLS.CASE_ID, archive.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if ((ids[i][0] || '').toString().trim() === caseId) return true;
      }
    }
  } catch (e) { }
  return false;
}

/**
 * Finds the 1-based row number for a given Case ID on the RASLO sheet.
 * Returns -1 if not found.
 */
function findRowByCaseId_(rasloSheet, caseId) {
  if (!caseId) return -1;
  var lastRow = rasloSheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = rasloSheet.getRange(2, CONFIG.RASLO_COLS.CASE_ID, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if ((ids[i][0] || '').toString().trim() === caseId) return i + 2; // +2 for 1-based + header
  }
  return -1;
}

/**
 * Builds a map of { caseId: rowNumber } for fast lookups.
 */
function buildCaseIdMap_(rasloSheet) {
  var lastRow = rasloSheet.getLastRow();
  if (lastRow < 2) return {};
  var ids = rasloSheet.getRange(2, CONFIG.RASLO_COLS.CASE_ID, lastRow - 1, 1).getValues();
  var map = {};
  for (var i = 0; i < ids.length; i++) {
    var id = (ids[i][0] || '').toString().trim();
    if (id) map[id] = i + 2;
  }
  return map;
}

/**
 * Extracts the case ID from an email subject line.
 * Looks for [PR-XXXXXXXX-XXXX] pattern.
 */
function extractCaseIdFromSubject_(subject) {
  if (!subject) return null;
  var m = subject.match(/\[(PR-\d{8}-[A-Z0-9]{4})\]/);
  return m ? m[1] : null;
}

/**
 * Backfills Case IDs for any RASLO rows that are missing one.
 * Use after upgrading from v4 or if rows were added manually.
 */
function backfillCaseIds() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  if (!rasloSheet) { ui.alert('Error', 'RASLO sheet not found.', ui.ButtonSet.OK); return; }

  var lastRow = rasloSheet.getLastRow();
  if (lastRow < 2) { ui.alert('No data rows.'); return; }

  var data = rasloSheet.getRange(2, 1, lastRow - 1, CONFIG.RASLO_COL_COUNT).getValues();
  var filled = 0;

  for (var i = 0; i < data.length; i++) {
    var existingId = (data[i][CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim();
    var patName = (data[i][CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
    if (!existingId && patName) {
      var newId = generateCaseId_();
      rasloSheet.getRange(i + 2, CONFIG.RASLO_COLS.CASE_ID).setValue(newId);
      filled++;
    }
  }

  ui.alert('Backfill Complete', filled + ' case IDs generated.\nRows that already had IDs were left unchanged.', ui.ButtonSet.OK);
  debugLog_('backfillCaseIds', 'Backfilled ' + filled + ' case IDs');
}


// ============================================================================
// 5. FUZZY NAME MATCHING
// ============================================================================

function fuzzyMatchRadiologist(inputName) {
  if (!inputName || inputName.toString().trim() === '') return null;
  var input = inputName.toString().trim().toLowerCase();

  for (var i = 0; i < RADIOLOGIST_NAMES.length; i++) {
    if (RADIOLOGIST_NAMES[i].toLowerCase() === input) return { match: RADIOLOGIST_NAMES[i], confidence: 1.0 };
  }

  var inputParts = input.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  var lastNameMatches = [];
  for (var i = 0; i < RADIOLOGIST_NAMES.length; i++) {
    var name = RADIOLOGIST_NAMES[i];
    if (name === 'VetMed' || name === 'None') continue;
    var lastName = name.toLowerCase().split(',')[0].trim();
    for (var j = 0; j < inputParts.length; j++) {
      if (lastName === inputParts[j]) lastNameMatches.push(name);
    }
  }
  if (lastNameMatches.length === 1) return { match: lastNameMatches[0], confidence: 0.9 };

  for (var i = 0; i < RADIOLOGIST_NAMES.length; i++) {
    var name = RADIOLOGIST_NAMES[i];
    if (name === 'VetMed' || name === 'None') continue;
    var nameTokens = name.toLowerCase().replace(/,/g, '').split(/\s+/);
    var matchedTokens = 0;
    for (var j = 0; j < inputParts.length; j++) {
      for (var k = 0; k < nameTokens.length; k++) {
        if (nameTokens[k].indexOf(inputParts[j]) === 0 || inputParts[j].indexOf(nameTokens[k]) === 0) { matchedTokens++; break; }
      }
    }
    if (matchedTokens >= 2) return { match: name, confidence: 0.85 };
  }

  var bestMatch = null, bestDistance = Infinity;
  for (var i = 0; i < RADIOLOGIST_NAMES.length; i++) {
    var name = RADIOLOGIST_NAMES[i];
    if (name === 'VetMed' || name === 'None') continue;
    var dist = levenshtein_(input, name.toLowerCase());
    if (dist < bestDistance) { bestDistance = dist; bestMatch = name; }
  }
  var maxLen = Math.max(input.length, bestMatch ? bestMatch.length : 1);
  var confidence = 1 - (bestDistance / maxLen);
  if (confidence >= 0.5) return { match: bestMatch, confidence: confidence };
  return null;
}

function levenshtein_(a, b) {
  var m = a.length, n = b.length, dp = [];
  for (var i = 0; i <= m; i++) { dp[i] = []; for (var j = 0; j <= n; j++) dp[i][j] = 0; }
  for (var i = 0; i <= m; i++) dp[i][0] = i;
  for (var j = 0; j <= n; j++) dp[0][j] = j;
  for (var i = 1; i <= m; i++) {
    for (var j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}


// ============================================================================
// 6. MMC IMPORT
// ============================================================================

function importMMCToRASLO() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var mmcSheet = ss.getSheetByName(CONFIG.MMC_IMPORT_SHEET);
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  if (!mmcSheet || !rasloSheet) { ui.alert('Error', 'Sheets not found. Run Initial Setup.', ui.ButtonSet.OK); return; }

  var mmcData = mmcSheet.getDataRange().getValues();
  if (mmcData.length <= 1) { ui.alert('No data on MMC Import sheet.'); return; }

  // Duplicate detection covers the archive too — otherwise re-importing a
  // batch would re-create cases that already finished the workflow.
  var existingKeys = {};
  function indexExisting(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var pn = normalizeNameKey_(data[i][CONFIG.RASLO_COLS.PATIENT_NAME - 1]);
      if (!pn) continue;
      existingKeys[pn + '|' + normalizeDateKey_(data[i][CONFIG.RASLO_COLS.EVENT_DATE - 1])] = true;
    }
  }
  indexExisting(rasloSheet);
  indexExisting(ss.getSheetByName(CONFIG.ARCHIVE_SHEET));

  var imported = 0, skipped = 0, nameIssues = [];

  for (var i = 1; i < mmcData.length; i++) {
    var row = mmcData[i];
    var patName = (row[CONFIG.MMC_COLS.PATIENT_NAME - 1] || '').toString().trim();
    if (!patName) continue;
    var evtDate = row[CONFIG.MMC_COLS.EVENT_DATE - 1];
    var key = normalizeNameKey_(patName) + '|' + normalizeDateKey_(evtDate);
    if (existingKeys[key]) { skipped++; continue; }

    var raw = (row[CONFIG.MMC_COLS.ATTRIB_PHYS - 1] || '').toString().trim();
    var mr = fuzzyMatchRadiologist(raw);
    var phys = mr ? mr.match : raw;
    if (mr && mr.confidence < 0.85) nameIssues.push('Row ' + (i+1) + ': "' + raw + '" -> "' + mr.match + '" (' + Math.round(mr.confidence*100) + '%)');
    else if (!mr && raw) nameIssues.push('Row ' + (i+1) + ': "' + raw + '" NO MATCH');

    var caseId = generateCaseId_();
    rasloSheet.appendRow([
      row[CONFIG.MMC_COLS.CASE_STATUS - 1] || 'Entered',
      row[CONFIG.MMC_COLS.DATE_STATUS - 1] || new Date(),
      patName, 'MMC',
      row[CONFIG.MMC_COLS.MRN - 1] || '', evtDate || '',
      row[CONFIG.MMC_COLS.STUDY_TYPE - 1] || '', phys, '',
      row[CONFIG.MMC_COLS.ISSUE - 1] || '',
      row[CONFIG.MMC_COLS.IMAGING_RATING - 1] || '', '',
      row[CONFIG.MMC_COLS.RATIONALE - 1] || '',
      caseId,
      ''  // Organ System — MMC data has no equivalent field
    ]);
    existingKeys[key] = true;
    imported++;
  }

  if (imported > 0) {
    var lr = rasloSheet.getLastRow();
    rasloSheet.getRange(lr - imported + 1, CONFIG.RASLO_COLS.DATE_STATUS, imported, 1).setNumberFormat('yyyy-MM-dd');
    rasloSheet.getRange(lr - imported + 1, CONFIG.RASLO_COLS.EVENT_DATE, imported, 1).setNumberFormat('yyyy-MM-dd');
  }

  var msg = imported + ' imported, ' + skipped + ' duplicates skipped';
  if (nameIssues.length > 0) msg += '\n\nName issues:\n' + nameIssues.join('\n');
  ui.alert('MMC Import', msg, ui.ButtonSet.OK);
}


// ============================================================================
// 7. RASLO EXPORT TO MMC
// ============================================================================

/**
 * Exports MMC cases to the MMC Export sheet.
 *
 * The MMC Import sheet is used only to carry DOB, QM No, and Reminder Email
 * back onto the export — it is NOT a filter. Cases are pulled from the live
 * tracker and from the Archive, so cases that reached "Completed" (and were
 * therefore archived) still export.
 */
function exportToMMC() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var archiveSheet = ss.getSheetByName(CONFIG.ARCHIVE_SHEET);
  var mmcImportSheet = ss.getSheetByName(CONFIG.MMC_IMPORT_SHEET);
  var mmcExportSheet = ensureSheet_(ss, CONFIG.MMC_EXPORT_SHEET, getMMCHeaders_());
  if (!rasloSheet) { ui.alert('Error', 'RASLO Tracking sheet not found. Run Initial Setup.', ui.ButtonSet.OK); return; }

  // ---- Collect candidate cases from the tracker and the archive ----
  var cases = [];
  var seen = {};

  function collectCases(sheet, source) {
    if (!sheet || sheet.getLastRow() < 2) return;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var r = data[i];
      var pn = (r[CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
      if (!pn) continue;
      var cid = (r[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim();
      var dedupKey = cid || (normalizeNameKey_(pn) + '|' + normalizeDateKey_(r[CONFIG.RASLO_COLS.EVENT_DATE - 1]));
      if (seen[dedupKey]) continue;
      seen[dedupKey] = true;
      cases.push({ data: r, name: pn, source: source });
    }
  }

  collectCases(rasloSheet, 'Tracking');
  collectCases(archiveSheet, 'Archive');

  // ---- Index MMC Import for enrichment (name+date, then MRN, then name) ----
  var byNameDate = {}, byMrn = {}, byName = {}, ambiguousName = {};
  if (mmcImportSheet && mmcImportSheet.getLastRow() > 1) {
    var mmcData = mmcImportSheet.getDataRange().getValues();
    for (var i = 1; i < mmcData.length; i++) {
      var row = mmcData[i];
      var nm = (row[CONFIG.MMC_COLS.PATIENT_NAME - 1] || '').toString().trim();
      if (!nm) continue;
      var nk = normalizeNameKey_(nm);
      byNameDate[nk + '|' + normalizeDateKey_(row[CONFIG.MMC_COLS.EVENT_DATE - 1])] = row;
      var mk = normalizeMrnKey_(row[CONFIG.MMC_COLS.MRN - 1]);
      if (mk) byMrn[mk] = row;
      if (byName[nk]) ambiguousName[nk] = true; else byName[nk] = row;
    }
  }

  function findImportRow(c) {
    var nk = normalizeNameKey_(c.name);
    var hit = byNameDate[nk + '|' + normalizeDateKey_(c.data[CONFIG.RASLO_COLS.EVENT_DATE - 1])];
    if (hit) return hit;
    var mk = normalizeMrnKey_(c.data[CONFIG.RASLO_COLS.MRN - 1]);
    if (mk && byMrn[mk]) return byMrn[mk];
    if (byName[nk] && !ambiguousName[nk]) return byName[nk];
    return null;
  }

  // ---- Build export rows ----
  var exportRows = [];
  var enriched = 0, fromArchive = 0, skippedNonMmc = 0;
  var unmatched = [];

  for (var i = 0; i < cases.length; i++) {
    var c = cases[i];
    var r = c.data;
    var orig = findImportRow(c);
    var system = (r[CONFIG.RASLO_COLS.SYSTEM - 1] || '').toString().trim().toUpperCase();

    // Export every MMC-system case, plus any case that traces back to an MMC
    // Import row even if its System cell was later edited.
    if (system !== 'MMC' && !orig) { skippedNonMmc++; continue; }

    if (orig) {
      enriched++;
    } else {
      var cid = (r[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim() || '(no ID)';
      unmatched.push(cid + ': ' + c.name);
    }
    if (c.source === 'Archive') fromArchive++;

    exportRows.push([
      r[CONFIG.RASLO_COLS.CASE_STATUS - 1] || '',
      r[CONFIG.RASLO_COLS.DATE_STATUS - 1] || '',
      c.name,
      orig ? (orig[CONFIG.MMC_COLS.DOB - 1] || '') : '',
      r[CONFIG.RASLO_COLS.MRN - 1] || (orig ? orig[CONFIG.MMC_COLS.MRN - 1] : '') || '',
      orig ? (orig[CONFIG.MMC_COLS.QM_NO - 1] || '') : '',
      r[CONFIG.RASLO_COLS.EVENT_DATE - 1] || '',
      r[CONFIG.RASLO_COLS.STUDY_TYPE - 1] || '',
      r[CONFIG.RASLO_COLS.ATTRIB_PHYS - 1] || '',
      r[CONFIG.RASLO_COLS.NARRATIVE - 1] || '',
      r[CONFIG.RASLO_COLS.IMAGING_RATING - 1] || '',
      r[CONFIG.RASLO_COLS.DISCUSSION - 1] || '',
      orig ? (orig[CONFIG.MMC_COLS.REMINDER_EMAIL - 1] || '') : ''
    ]);
  }

  // ---- Write ----
  var headerCount = getMMCHeaders_().length;
  var lastRow = mmcExportSheet.getLastRow();
  if (lastRow > 1) {
    mmcExportSheet.getRange(2, 1, lastRow - 1, Math.max(mmcExportSheet.getLastColumn(), headerCount)).clearContent();
  }
  if (exportRows.length > 0) {
    mmcExportSheet.getRange(2, 1, exportRows.length, headerCount).setValues(exportRows);
    mmcExportSheet.getRange(2, CONFIG.MMC_COLS.DATE_STATUS, exportRows.length, 1).setNumberFormat('yyyy-MM-dd');
    mmcExportSheet.getRange(2, CONFIG.MMC_COLS.EVENT_DATE, exportRows.length, 1).setNumberFormat('yyyy-MM-dd');
  }

  var msg = exportRows.length + ' case(s) exported to the MMC Export sheet.\n\n';
  msg += enriched + ' matched an MMC Import row (DOB, QM No, Reminder Email carried over).\n';
  if (fromArchive > 0) msg += fromArchive + ' came from the Archive sheet (already completed).\n';
  if (unmatched.length > 0) {
    msg += '\n' + unmatched.length + ' case(s) had no MMC Import match. They WERE exported, but with ' +
      'DOB, QM No, and Reminder Email blank:\n';
    for (var u = 0; u < unmatched.length && u < 20; u++) msg += '  ' + unmatched[u] + '\n';
    if (unmatched.length > 20) msg += '  ... and ' + (unmatched.length - 20) + ' more\n';
  }
  if (skippedNonMmc > 0) msg += '\n' + skippedNonMmc + ' non-MMC case(s) skipped.';

  debugLog_('exportToMMC', 'Exported ' + exportRows.length + ' (' + enriched + ' enriched, ' +
    unmatched.length + ' unmatched, ' + fromArchive + ' archived, ' + skippedNonMmc + ' non-MMC skipped)');
  ui.alert('MMC Export', msg, ui.ButtonSet.OK);
}


// ============================================================================
// 8. GEMINI VIA VERTEX AI (HIPAA)
// ============================================================================
//
// PHI goes to Gemini only through Vertex AI, in a Google Cloud project that
// the organization's Google Cloud BAA covers. The earlier Google AI Studio
// endpoint (generativelanguage.googleapis.com with an API key) has no BAA,
// and its terms forbid clinical use, so that path was removed entirely.
// Calls authenticate with the user's OAuth token, so no key appears in a URL.
// A regional endpoint keeps processing in the configured region.

function getVertexConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    projectId: (props.getProperty('VERTEX_PROJECT_ID') || '').trim(),
    location: (props.getProperty('VERTEX_LOCATION') || CONFIG.VERTEX_DEFAULT_LOCATION).trim(),
    model: (props.getProperty('VERTEX_MODEL') || CONFIG.VERTEX_DEFAULT_MODEL).trim()
  };
}

/** Menu: Setup > Configure Vertex AI (HIPAA). */
function promptForVertexConfig() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var cur = getVertexConfig_();

  var ack = ui.alert('Configure Vertex AI (HIPAA)',
    'Gemini extraction sends patient information to Google Cloud.\n\n' +
    'Only continue if ALL of these are true:\n' +
    '  1. The Cloud project is under your organization\'s signed Google Cloud BAA.\n' +
    '  2. The Vertex AI API is enabled in that project.\n' +
    '  3. Everyone who uses the Gemini menu items has the "Vertex AI User" role there.\n\n' +
    'Continue?', ui.ButtonSet.YES_NO);
  if (ack !== ui.Button.YES) return;

  var r1 = ui.prompt('Google Cloud Project ID',
    'Project ID (not the number), e.g. raslo-peer-review.' +
    (cur.projectId ? '\nCurrent: ' + cur.projectId : ''), ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var projectId = r1.getResponseText().trim() || cur.projectId;
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    ui.alert('Invalid project ID', 'Project IDs are 6-30 lowercase letters, digits, or hyphens.', ui.ButtonSet.OK);
    return;
  }

  var r2 = ui.prompt('Region',
    'Regional location for processing (leave blank for ' + cur.location + ').\n' +
    'Use a US region such as us-central1 or us-west1. "global" is not allowed for PHI.', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var location = r2.getResponseText().trim() || cur.location;
  if (!/^[a-z]+-[a-z]+[0-9]+$/.test(location)) {
    ui.alert('Invalid region', 'Enter a regional location like us-central1.', ui.ButtonSet.OK);
    return;
  }

  var r3 = ui.prompt('Gemini model',
    'Model ID (leave blank for ' + cur.model + ').', ui.ButtonSet.OK_CANCEL);
  if (r3.getSelectedButton() !== ui.Button.OK) return;
  var model = r3.getResponseText().trim() || cur.model;
  if (!/^[a-z0-9][a-z0-9.\-]*$/.test(model)) {
    ui.alert('Invalid model ID', 'Model IDs look like gemini-2.5-pro.', ui.ButtonSet.OK);
    return;
  }

  props.setProperty('VERTEX_PROJECT_ID', projectId);
  props.setProperty('VERTEX_LOCATION', location);
  props.setProperty('VERTEX_MODEL', model);
  // The AI Studio key is no longer used anywhere. Remove it so it can't be
  // copied out of Project Settings and used against PHI elsewhere.
  var hadKey = !!props.getProperty('GEMINI_API_KEY');
  props.deleteProperty('GEMINI_API_KEY');

  debugLog_('promptForVertexConfig', 'Vertex AI configured: project=' + projectId + ', location=' + location +
    ', model=' + model + (hadKey ? '; legacy AI Studio API key deleted' : ''));
  ui.alert('Vertex AI configured',
    'Gemini extraction will use project ' + projectId + ' in ' + location + '.' +
    (hadKey ? '\n\nThe old Gemini API key was deleted from Script Properties.' : '') +
    '\n\nTip: try "Paste New Case" with dummy text first to confirm access.', ui.ButtonSet.OK);
}

function callGemini_(freeformText) {
  debugLog_('callGemini_', 'START. Input length: ' + (freeformText ? freeformText.length : 'null'));

  var cfg = getVertexConfig_();
  if (!cfg.projectId) {
    throw new Error('Gemini extraction is disabled until Vertex AI is configured. An owner must run ' +
      'Peer Review > Setup > Configure Vertex AI (HIPAA). Patient data is never sent to AI services without a BAA.');
  }
  var url = 'https://' + cfg.location + '-aiplatform.googleapis.com/v1/projects/' +
    encodeURIComponent(cfg.projectId) + '/locations/' + cfg.location +
    '/publishers/google/models/' + encodeURIComponent(cfg.model) + ':generateContent';

  // Organ system options come from the live Reference sheet so the prompt
  // always matches the dropdown the user maintains.
  var organSystems = [];
  try { organSystems = getOrganSystems_(); } catch (e) { }
  if (organSystems.length === 0) organSystems = ORGAN_SYSTEM_DEFAULTS;

  var prompt = 'You are a medical data extraction assistant for a radiology peer review system.\n\n' +
    'Extract the following fields from this freeform text. Return ONLY valid JSON with these exact keys.\n' +
    'If a field cannot be determined, use an empty string.\n\n' +
    'Fields to extract:\n' +
    '- patient_name: Full patient name\n' +
    '- system: One of: SVH, TCCH, FH, AG, MMC, RASLO (AGCH = AG, Arroyo Grande = AG, Sierra Vista = SVH, French Hospital = FH, Twin Cities = TCCH, Marian = MMC)\n' +
    '- mrn: Medical record number or FIN number\n' +
    '- event_date: Date of the imaging study (format: YYYY-MM-DD)\n' +
    '- study_type: One of: CT, MRI, NM, IR, XR, US, FL, MG\n' +
    '- attributing_physician: Radiologist name (format: "Last, First" from this list: ' + RADIOLOGIST_NAMES.join(', ') + ')\n' +
    '- narrative: Description of the issue. IMPORTANT: Keep under 500 characters. Summarize if the original is longer.\n' +
    '- imaging_rating: One of: eV1, eV2, eV3, eV4, eV5\n' +
    '- organ_system: The anatomic/organ system of the imaging study or finding. Must be exactly one of: ' +
      organSystems.join(', ') + '. Infer from the body region described (e.g. brain MRI -> Neuro, ' +
      'chest CT -> Chest, knee XR -> Musculoskeletal). Use empty string only if truly undeterminable.\n\n' +
    'Text to parse:\n"""\n' + freeformText + '\n"""\n\n' +
    'Return ONLY the JSON object, no markdown, no explanation.';

  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 16384, responseMimeType: 'application/json' }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // HIPAA: nothing below logs or throws the model's output or the request
  // text. Error messages carry only status codes, API error text (which
  // describes configuration, not content), and lengths.
  var response, responseText;
  try {
    response = UrlFetchApp.fetch(url, options);
    responseText = response.getContentText();
    debugLog_('callGemini_', 'HTTP ' + response.getResponseCode() + ', length: ' + responseText.length);
  } catch (fetchErr) {
    debugError_('callGemini_', 'FETCH FAILED: ' + fetchErr.message);
    throw new Error('Could not reach Vertex AI: ' + fetchErr.message);
  }

  var result = null;
  try { result = JSON.parse(responseText); } catch (e) { }

  var code = response.getResponseCode();
  if (code !== 200) {
    var apiErr = result && result.error ? ((result.error.status || '') + ' ' + (result.error.message || '')).trim() : '';
    var hint = '';
    if (code === 403) {
      hint = ' Check that the Vertex AI API is enabled in project ' + cfg.projectId +
        ' and that your account has the "Vertex AI User" role there.';
    } else if (code === 404) {
      hint = ' Check the model ID (' + cfg.model + ') and region (' + cfg.location + ').';
    }
    var errMsg = 'Vertex AI HTTP ' + code + (apiErr ? ': ' + apiErr.substring(0, 300) : '') + '.' + hint;
    debugError_('callGemini_', errMsg);
    throw new Error(errMsg);
  }

  if (!result) {
    debugError_('callGemini_', 'Response body was not JSON (' + responseText.length + ' chars)');
    throw new Error('Vertex AI returned a response that was not JSON.');
  }

  if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
    var why = (result.promptFeedback && result.promptFeedback.blockReason) ||
      (result.candidates && result.candidates[0] && result.candidates[0].finishReason) || 'unknown';
    debugError_('callGemini_', 'No usable candidate (reason: ' + why + ')');
    throw new Error('Gemini returned no answer (reason: ' + why + ').');
  }

  var parts = result.candidates[0].content.parts || [];
  var text = '';
  for (var p = 0; p < parts.length; p++) {
    if (parts[p].thought !== true && parts[p].text) text = parts[p].text;
  }
  if (!text && parts.length) text = parts[parts.length - 1].text || '';

  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    var parsed = JSON.parse(text);
    debugLog_('callGemini_', 'Parsed OK (' + text.length + ' chars)');
    return parsed;
  } catch (jsonErr) {
    debugError_('callGemini_', 'Model output was not valid JSON (' + text.length + ' chars)');
    throw new Error('Gemini output was not valid JSON. Try again, or enter the case manually.');
  }
}


// ============================================================================
// 9. GMAIL-BASED GEMINI INPUT
// ============================================================================

function scanGmailForCases() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var inputSheet = ss.getSheetByName(CONFIG.GEMINI_INPUT_SHEET);

  if (!rasloSheet) { ui.alert('Error', 'RASLO sheet not found. Run setup.', ui.ButtonSet.OK); return; }

  var inputLabel = getOrCreateLabel_(CONFIG.GMAIL_INPUT_LABEL);
  var doneLabel = getOrCreateLabel_(CONFIG.GMAIL_INPUT_DONE_LABEL);

  var query = 'label:' + CONFIG.GMAIL_INPUT_LABEL + ' -label:"' + CONFIG.GMAIL_INPUT_DONE_LABEL + '"';
  debugLog_('scanGmailForCases', 'Searching Gmail: ' + query);
  var threads = GmailApp.search(query, 0, 50);

  if (threads.length === 0) {
    ui.alert('No New Cases', 'No emails found with the "' + CONFIG.GMAIL_INPUT_LABEL + '" label that haven\'t been processed.\n\n' +
      'To use this feature:\n' +
      '1. In Gmail, label an email containing peer review info with "PeerReviewInput"\n' +
      '2. Come back here and click "Scan Gmail for New Cases"', ui.ButtonSet.OK);
    return;
  }

  var processed = 0, errors = [], results = [];

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var msg = messages[messages.length - 1];
    var subject = msg.getSubject();
    var body = msg.getPlainBody();
    var from = msg.getFrom();
    var date = msg.getDate();

    // HIPAA: subjects can name the patient, so the log gets only position and size.
    debugLog_('scanGmailForCases', 'Processing labeled email ' + (t + 1) + ' of ' + threads.length + ' (' + body.length + ' chars)');

    try {
      var parsed = callGemini_(body);

      var attribPhys = parsed.attributing_physician || '';
      if (attribPhys) {
        var match = fuzzyMatchRadiologist(attribPhys);
        if (match) attribPhys = match.match;
      }
      var organSystem = matchOrganSystem_(parsed.organ_system);

      var caseId = generateCaseId_();
      var newRow = [
        'Entered', new Date(),
        parsed.patient_name || '', parsed.system || '',
        parsed.mrn || '', parsed.event_date || '',
        parsed.study_type || '', attribPhys, '',
        parsed.narrative || '', parsed.imaging_rating || '',
        'From email: "' + subject + '" (' + from + ')', '',
        caseId, organSystem
      ];

      rasloSheet.appendRow(newRow);

      if (inputSheet) {
        inputSheet.appendRow([
          'EMAIL: ' + subject + '\nFrom: ' + from + '\nDate: ' + date + '\n\n' + body.substring(0, 2000),
          JSON.stringify(parsed, null, 2),
          'Processed'
        ]);
      }

      doneLabel.addToThread(thread);

      var summary = caseId + ' — ' + (parsed.patient_name || '?') + ' / ' + (parsed.study_type || '?') + ' / ' + (organSystem || '?') + ' / ' + (attribPhys || '?');
      results.push('OK: ' + summary);
      processed++;

    } catch (e) {
      debugError_('scanGmailForCases', 'Error on labeled email ' + (t + 1) + ' of ' + threads.length + ': ' + e.message);
      errors.push('"' + subject + '": ' + e.message);
      doneLabel.addToThread(thread);
    }

    if (t < threads.length - 1) Utilities.sleep(2000);
  }

  var msg = processed + ' emails parsed and added to RASLO sheet.';
  if (results.length > 0) msg += '\n\n' + results.join('\n');
  if (errors.length > 0) msg += '\n\nErrors:\n' + errors.join('\n');
  ui.alert('Gmail Scan Results', msg, ui.ButtonSet.OK);
}


// ============================================================================
// 10. SHEET-BASED GEMINI PARSING (backup method)
// ============================================================================

function parseGeminiInput() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var inputSheet = ss.getSheetByName(CONFIG.GEMINI_INPUT_SHEET);
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  if (!inputSheet || !rasloSheet) { ui.alert('Error', 'Sheets not found.', ui.ButtonSet.OK); return; }

  var data = inputSheet.getDataRange().getValues();
  var processed = 0, errors = [];

  for (var i = 1; i < data.length; i++) {
    var text = (data[i][0] || '').toString().trim();
    var status = (data[i][2] || '').toString().trim();
    if (!text || status === 'Processed' || status === 'Error') continue;

    try {
      var parsed = callGemini_(text);
      var phys = parsed.attributing_physician || '';
      if (phys) { var m = fuzzyMatchRadiologist(phys); if (m) phys = m.match; }

      var caseId = generateCaseId_();
      rasloSheet.appendRow([
        'Entered', new Date(), parsed.patient_name || '', parsed.system || '',
        parsed.mrn || '', parsed.event_date || '', parsed.study_type || '',
        phys, '', parsed.narrative || '', parsed.imaging_rating || '',
        'Added via Gemini (sheet)', '',
        caseId, matchOrganSystem_(parsed.organ_system)
      ]);

      inputSheet.getRange(i + 1, 2).setValue(JSON.stringify(parsed, null, 2));
      inputSheet.getRange(i + 1, 3).setValue('Processed');
      processed++;
    } catch (e) {
      inputSheet.getRange(i + 1, 2).setValue('ERROR: ' + e.message);
      inputSheet.getRange(i + 1, 3).setValue('Error');
      errors.push('Row ' + (i + 1) + ': ' + e.message);
    }
  }

  var msg = processed + ' entries processed';
  if (errors.length > 0) msg += '\n\nErrors:\n' + errors.join('\n');
  ui.alert('Gemini Parse Results', msg, ui.ButtonSet.OK);
}


// ============================================================================
// 10b. PASTE DIALOG — Gemini-powered case entry from pasted text
// ============================================================================

function showPasteDialog() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt('Paste New Case',
    'Paste the case information below.\n\n' +
    'For multiple cases, separate with a line of "---".\n\n' +
    'Gemini will extract patient name, system, MRN, study type, date, physician, narrative, and rating.',
    ui.ButtonSet.OK_CANCEL);

  if (result.getSelectedButton() !== ui.Button.OK) return;
  var text = result.getResponseText().trim();
  if (!text) { ui.alert('Nothing to parse.'); return; }

  var outcome = parsePastedTextDirect_(text);

  var msg = outcome.added + ' case(s) added to RASLO sheet.';
  if (outcome.results.length > 0) {
    msg += '\n\n';
    for (var i = 0; i < outcome.results.length; i++) {
      var r = outcome.results[i];
      msg += r.ok ? '\u2713 ' + r.summary + '\n' : '\u2717 ' + r.error + '\n';
    }
  }
  ui.alert('Parse Results', msg, ui.ButtonSet.OK);
}

function parsePastedTextDirect_(text) {
  var ss = getSS_();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var inputSheet = ss.getSheetByName(CONFIG.GEMINI_INPUT_SHEET);
  if (!rasloSheet) throw new Error('RASLO sheet not found. Run Initial Setup.');

  var blocks = text.split(/\n\s*-{3,}\s*\n/);
  blocks = blocks.filter(function(b) { return b.trim().length > 0; });

  if (blocks.length === 0) throw new Error('No text to parse.');

  debugLog_('parsePastedText', 'Parsing ' + blocks.length + ' block(s), total length ' + text.length);

  var added = 0;
  var results = [];

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    var blockLabel = blocks.length > 1 ? 'Block ' + (i + 1) + ': ' : '';

    try {
      var parsed = callGemini_(block);

      var phys = parsed.attributing_physician || '';
      if (phys) {
        var m = fuzzyMatchRadiologist(phys);
        if (m) phys = m.match;
      }
      var organSystem = matchOrganSystem_(parsed.organ_system);

      var caseId = generateCaseId_();
      rasloSheet.appendRow([
        'Entered', new Date(),
        parsed.patient_name || '', parsed.system || '',
        parsed.mrn || '', parsed.event_date || '',
        parsed.study_type || '', phys, '',
        parsed.narrative || '', parsed.imaging_rating || '',
        'Added via paste dialog', '',
        caseId, organSystem
      ]);

      if (inputSheet) {
        inputSheet.appendRow([
          'PASTE: ' + block.substring(0, 2000),
          JSON.stringify(parsed, null, 2),
          'Processed'
        ]);
      }

      var summary = caseId + ' — ' + (parsed.patient_name || '?') + ' / ' +
        (parsed.study_type || '?') + ' / ' + (organSystem || '?') + ' / ' + (phys || '?');
      results.push({ ok: true, summary: blockLabel + summary });
      added++;
      debugLog_('parsePastedText', 'Added case ' + caseId);

    } catch (e) {
      results.push({ ok: false, error: blockLabel + e.message });
      debugError_('parsePastedText', 'Block ' + (i + 1) + ': ' + e.message);

      if (inputSheet) {
        inputSheet.appendRow([
          'PASTE (FAILED): ' + block.substring(0, 2000),
          'ERROR: ' + e.message,
          'Error'
        ]);
      }
    }

    if (i < blocks.length - 1) Utilities.sleep(2000);
  }

  return { added: added, results: results };
}


// ============================================================================
// 11. SELECTION HELPER — get selected RASLO rows
// ============================================================================

function getSelectedRASLORows_() {
  var ss = getSS_();
  var activeSheet = ss.getActiveSheet();
  if (activeSheet.getName() !== CONFIG.RASLO_SHEET) return null;

  var selection = activeSheet.getActiveRangeList();
  if (!selection) return [];

  var ranges = selection.getRanges();
  var rowSet = {};
  for (var r = 0; r < ranges.length; r++) {
    var startRow = ranges[r].getRow();
    var numRows = ranges[r].getNumRows();
    for (var i = 0; i < numRows; i++) {
      var row = startRow + i;
      if (row >= 2) rowSet[row] = true;
    }
  }

  var rows = Object.keys(rowSet).map(function(k) { return parseInt(k, 10); });
  rows.sort(function(a, b) { return a - b; });
  return rows;
}


// ============================================================================
// 12. EMAIL — PRIMARY REVIEW (SELECTED ROWS)
// ============================================================================

function sendPrimaryReviewsSelected() {
  var ui = SpreadsheetApp.getUi();
  var rows = getSelectedRASLORows_();

  if (rows === null) {
    ui.alert('Wrong Sheet', 'Please switch to the "' + CONFIG.RASLO_SHEET + '" sheet and select the rows you want to send.', ui.ButtonSet.OK);
    return;
  }
  if (rows.length === 0) {
    ui.alert('No Selection', 'Select one or more data rows (not the header) in the RASLO Tracking sheet, then try again.', ui.ButtonSet.OK);
    return;
  }

  var ss = getSS_();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var radSheet = ss.getSheetByName(CONFIG.RAD_SHEET);
  var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);
  if (!rasloSheet || !radSheet) { ui.alert('Error', 'Sheets not found.', ui.ButtonSet.OK); return; }

  var radEmails = buildRadEmailLookup_(radSheet);
  var templateBody = loadPrimaryTemplate_();
  var allData = rasloSheet.getDataRange().getValues();

  var eligible = [];
  var skippedStatus = [];
  var skippedEmail = [];

  for (var r = 0; r < rows.length; r++) {
    var rowNum = rows[r];
    var idx = rowNum - 1;
    if (idx >= allData.length) continue;

    var rowData = allData[idx];
    var status = (rowData[CONFIG.RASLO_COLS.CASE_STATUS - 1] || '').toString().trim();
    var phys = (rowData[CONFIG.RASLO_COLS.ATTRIB_PHYS - 1] || '').toString().trim();
    var email = radEmails[phys];
    var pat = (rowData[CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
    var caseId = (rowData[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim();

    if (status !== 'Entered') {
      skippedStatus.push('Row ' + rowNum + ' (' + pat + '): status is "' + status + '"');
      continue;
    }
    if (!email) {
      skippedEmail.push('Row ' + rowNum + ' (' + pat + '): no email for "' + phys + '"');
      continue;
    }
    if (!isPhiRecipientAllowed_(email)) {
      skippedEmail.push('Row ' + rowNum + ' (' + pat + '): ' + email + ' is not an approved domain');
      continue;
    }

    if (!caseId) {
      caseId = generateCaseId_();
      rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.CASE_ID).setValue(caseId);
    }

    eligible.push({ rowNum: rowNum, rowData: rowData, phys: phys, email: email, pat: pat, caseId: caseId });
  }

  if (eligible.length === 0) {
    var msg = 'No eligible rows in your selection.\n';
    if (skippedStatus.length > 0) msg += '\nWrong status:\n' + skippedStatus.join('\n');
    if (skippedEmail.length > 0) msg += '\nMissing email:\n' + skippedEmail.join('\n');
    ui.alert('Nothing to Send', msg, ui.ButtonSet.OK);
    return;
  }

  var confirmMsg = 'Send primary review emails for ' + eligible.length + ' case(s)?\n\n';
  for (var i = 0; i < eligible.length; i++) {
    var e = eligible[i];
    confirmMsg += '  ' + e.caseId + ': ' + e.pat + ' → ' + e.phys + ' (' + e.email + ')\n';
  }
  if (skippedStatus.length > 0) confirmMsg += '\nSkipped (wrong status):\n' + skippedStatus.join('\n');
  if (skippedEmail.length > 0) confirmMsg += '\nSkipped (no email):\n' + skippedEmail.join('\n');

  var confirm = ui.alert('Confirm Send', confirmMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  var sent = 0, errors = [];

  for (var i = 0; i < eligible.length; i++) {
    var e = eligible[i];
    var body = fillTemplate_(templateBody, {
      '{{PATIENT_NAME}}': e.pat,
      '{{SYSTEM}}': e.rowData[CONFIG.RASLO_COLS.SYSTEM - 1] || '',
      '{{MRN}}': e.rowData[CONFIG.RASLO_COLS.MRN - 1] || '',
      '{{EVENT_DATE}}': formatDateForDisplay_(e.rowData[CONFIG.RASLO_COLS.EVENT_DATE - 1]),
      '{{STUDY_TYPE}}': e.rowData[CONFIG.RASLO_COLS.STUDY_TYPE - 1] || '',
      '{{ORGAN_SYSTEM}}': e.rowData[CONFIG.RASLO_COLS.ORGAN_SYSTEM - 1] || '',
      '{{ATTRIB_PHYSICIAN}}': e.phys,
      '{{NARRATIVE}}': e.rowData[CONFIG.RASLO_COLS.NARRATIVE - 1] || '',
      '{{IMAGING_RATING}}': e.rowData[CONFIG.RASLO_COLS.IMAGING_RATING - 1] || '',
      '{{CASE_ID}}': e.caseId
    });
    // HIPAA: subject lines show in notifications and lock screens, so they
    // carry only the Case ID, never the patient name.
    var subject = CONFIG.SUBJECT_PREFIX + ' Primary Review [' + e.caseId + ']';

    try {
      sendPhiEmail_(e.email, subject, body);
      Utilities.sleep(2000);
      var threads = GmailApp.search('subject:"[' + e.caseId + ']" from:me newer_than:1d', 0, 1);
      if (threads.length > 0) {
        trackerSheet.appendRow([e.caseId, threads[0].getId(), 'primary', e.email, new Date()]);
        getOrCreateLabel_(CONFIG.GMAIL_LABEL).addToThread(threads[0]);
        debugLog_('sendPrimaryReviewsSelected', e.caseId + ': sent to ' + e.email + ', thread tracked, PeerReview label applied');
      } else {
        debugLog_('sendPrimaryReviewsSelected', e.caseId + ': sent to ' + e.email + ' but Gmail search could not find thread — PeerReview label NOT applied. Reply tracking may not work for this case.');
      }
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Out for primary review');
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
        appendNote_(e.rowData[CONFIG.RASLO_COLS.STATUS_NOTES - 1], 'Primary review sent to ' + e.phys));
      sent++;
    } catch (err) {
      errors.push(e.caseId + ': ' + err.message);
      debugError_('sendPrimaryReviewsSelected', e.caseId + ': ' + err.message);
    }
  }

  var resultMsg = 'Sent: ' + sent + ' of ' + eligible.length;
  if (errors.length > 0) resultMsg += '\n\nErrors:\n' + errors.join('\n');
  ui.alert('Primary Reviews', resultMsg, ui.ButtonSet.OK);
}


// ============================================================================
// 13. EMAIL — SECONDARY REVIEW (SELECTED ROWS)
// ============================================================================

/**
 * Sends secondary review emails for selected rows.
 *
 * v8.1: Self-review is now allowed — you can assign yourself as secondary
 * reviewer even if you are also the attributing physician.
 */
function sendSecondaryReviewsSelected() {
  var ui = SpreadsheetApp.getUi();
  var rows = getSelectedRASLORows_();

  if (rows === null) {
    ui.alert('Wrong Sheet', 'Switch to "' + CONFIG.RASLO_SHEET + '" and select rows.', ui.ButtonSet.OK);
    return;
  }
  if (rows.length === 0) {
    ui.alert('No Selection', 'Select one or more data rows, then try again.', ui.ButtonSet.OK);
    return;
  }

  var ss = getSS_();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var radSheet = ss.getSheetByName(CONFIG.RAD_SHEET);
  var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);
  if (!rasloSheet || !radSheet) { ui.alert('Error', 'Sheets not found.', ui.ButtonSet.OK); return; }

  var radEmails = buildRadEmailLookup_(radSheet);
  var templateBody = loadSecondaryTemplate_();
  var allData = rasloSheet.getDataRange().getValues();

  var eligible = [];
  var skippedStatus = [];
  var skippedReviewer = [];

  for (var r = 0; r < rows.length; r++) {
    var rowNum = rows[r];
    var idx = rowNum - 1;
    if (idx >= allData.length) continue;

    var rowData = allData[idx];
    var status = (rowData[CONFIG.RASLO_COLS.CASE_STATUS - 1] || '').toString().trim();
    var pat = (rowData[CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
    var reviewer = (rowData[CONFIG.RASLO_COLS.REVIEW_PHYS - 1] || '').toString().trim();
    var caseId = (rowData[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim();

    if (status !== 'Back from primary') {
      skippedStatus.push('Row ' + rowNum + ' (' + pat + '): status is "' + status + '"');
      continue;
    }
    if (!reviewer) {
      skippedReviewer.push('Row ' + rowNum + ' (' + pat + '): set Reviewing Physician in column I first');
      continue;
    }
    var email = radEmails[reviewer];
    if (!email) {
      skippedReviewer.push('Row ' + rowNum + ' (' + pat + '): no email for "' + reviewer + '"');
      continue;
    }
    if (!isPhiRecipientAllowed_(email)) {
      skippedReviewer.push('Row ' + rowNum + ' (' + pat + '): ' + email + ' is not an approved domain');
      continue;
    }

    if (!caseId) {
      caseId = generateCaseId_();
      rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.CASE_ID).setValue(caseId);
    }

    eligible.push({ rowNum: rowNum, rowData: rowData, pat: pat, reviewer: reviewer, email: email, caseId: caseId });
  }

  if (eligible.length === 0) {
    var msg = 'No eligible rows.\n\nTo send secondary reviews:\n';
    msg += '1. Set Reviewing Physician (col I) for each case\n';
    msg += '2. Ensure status is "Back from primary"\n';
    msg += '3. Select rows and try again\n';
    if (skippedStatus.length > 0) msg += '\nWrong status:\n' + skippedStatus.join('\n');
    if (skippedReviewer.length > 0) msg += '\nReviewer issues:\n' + skippedReviewer.join('\n');
    ui.alert('Nothing to Send', msg, ui.ButtonSet.OK);
    return;
  }

  var confirmMsg = 'Send secondary review emails for ' + eligible.length + ' case(s)?\n\n';
  for (var i = 0; i < eligible.length; i++) {
    var e = eligible[i];
    confirmMsg += '  ' + e.caseId + ': ' + e.pat + ' \u2192 ' + e.reviewer + ' (' + e.email + ')\n';
  }
  if (skippedStatus.length > 0) confirmMsg += '\nSkipped (status):\n' + skippedStatus.join('\n');
  if (skippedReviewer.length > 0) confirmMsg += '\nSkipped (reviewer):\n' + skippedReviewer.join('\n');

  if (ui.alert('Confirm Send', confirmMsg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var sent = 0, errors = [];

  for (var i = 0; i < eligible.length; i++) {
    var e = eligible[i];
    var body = fillTemplate_(templateBody, {
      '{{PATIENT_NAME}}': e.pat,
      '{{SYSTEM}}': e.rowData[CONFIG.RASLO_COLS.SYSTEM - 1] || '',
      '{{MRN}}': e.rowData[CONFIG.RASLO_COLS.MRN - 1] || '',
      '{{EVENT_DATE}}': formatDateForDisplay_(e.rowData[CONFIG.RASLO_COLS.EVENT_DATE - 1]),
      '{{STUDY_TYPE}}': e.rowData[CONFIG.RASLO_COLS.STUDY_TYPE - 1] || '',
      '{{ORGAN_SYSTEM}}': e.rowData[CONFIG.RASLO_COLS.ORGAN_SYSTEM - 1] || '',
      '{{ATTRIB_PHYSICIAN}}': e.rowData[CONFIG.RASLO_COLS.ATTRIB_PHYS - 1] || '',
      '{{REVIEWER}}': e.reviewer,
      '{{NARRATIVE}}': e.rowData[CONFIG.RASLO_COLS.NARRATIVE - 1] || '',
      '{{IMAGING_RATING}}': e.rowData[CONFIG.RASLO_COLS.IMAGING_RATING - 1] || '',
      '{{DISCUSSION}}': e.rowData[CONFIG.RASLO_COLS.DISCUSSION - 1] || '',
      '{{CASE_ID}}': e.caseId
    });
    var subject = CONFIG.SUBJECT_PREFIX + ' Secondary Review [' + e.caseId + ']';

    try {
      sendPhiEmail_(e.email, subject, body);
      Utilities.sleep(2000);
      var threads = GmailApp.search('subject:"[' + e.caseId + ']" "Secondary Review" from:me newer_than:1d', 0, 1);
      if (threads.length > 0) {
        trackerSheet.appendRow([e.caseId, threads[0].getId(), 'secondary', e.email, new Date()]);
        getOrCreateLabel_(CONFIG.GMAIL_LABEL).addToThread(threads[0]);
        debugLog_('sendSecondaryReviewsSelected', e.caseId + ': sent to ' + e.email + ', thread tracked');
      } else {
        debugLog_('sendSecondaryReviewsSelected', e.caseId + ': sent to ' + e.email + ' but thread not found by Gmail search');
      }
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Out for secondary review');
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
        appendNote_(e.rowData[CONFIG.RASLO_COLS.STATUS_NOTES - 1], 'Secondary review sent to ' + e.reviewer));
      sent++;
    } catch (err) {
      errors.push(e.caseId + ': ' + err.message);
      debugError_('sendSecondaryReviewsSelected', e.caseId + ': ' + err.message);
    }
  }

  var resultMsg = 'Sent: ' + sent + ' of ' + eligible.length;
  if (errors.length > 0) resultMsg += '\n\nErrors:\n' + errors.join('\n');
  ui.alert('Secondary Reviews', resultMsg, ui.ButtonSet.OK);
}


// ============================================================================
// 13b. REMINDER EMAILS (SELECTED ROWS)
// ============================================================================

function sendRemindersSelected() {
  var ui = SpreadsheetApp.getUi();
  var rows = getSelectedRASLORows_();

  if (rows === null) {
    ui.alert('Wrong Sheet', 'Switch to "' + CONFIG.RASLO_SHEET + '" and select rows.', ui.ButtonSet.OK);
    return;
  }
  if (rows.length === 0) {
    ui.alert('No Selection', 'Select one or more data rows, then try again.', ui.ButtonSet.OK);
    return;
  }

  var ss = getSS_();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var radSheet = ss.getSheetByName(CONFIG.RAD_SHEET);
  if (!rasloSheet || !radSheet) { ui.alert('Error', 'Sheets not found.', ui.ButtonSet.OK); return; }

  var radEmails = buildRadEmailLookup_(radSheet);
  var allData = rasloSheet.getDataRange().getValues();

  var eligible = [];
  var skipped = [];

  for (var r = 0; r < rows.length; r++) {
    var rowNum = rows[r];
    var idx = rowNum - 1;
    if (idx >= allData.length) continue;

    var rowData = allData[idx];
    var status = (rowData[CONFIG.RASLO_COLS.CASE_STATUS - 1] || '').toString().trim();
    var pat = (rowData[CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
    var attrib = (rowData[CONFIG.RASLO_COLS.ATTRIB_PHYS - 1] || '').toString().trim();
    var reviewer = (rowData[CONFIG.RASLO_COLS.REVIEW_PHYS - 1] || '').toString().trim();
    var caseId = (rowData[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim();
    var dateSent = rowData[CONFIG.RASLO_COLS.DATE_STATUS - 1];

    var recipient, email, reviewType;

    if (status === 'Out for primary review') {
      recipient = attrib;
      email = radEmails[attrib];
      reviewType = 'primary';
    } else if (status === 'Out for secondary review') {
      recipient = reviewer;
      email = radEmails[reviewer];
      reviewType = 'secondary';
    } else {
      skipped.push('Row ' + rowNum + ' (' + pat + '): status is "' + status + '" — not awaiting a review');
      continue;
    }

    if (!recipient) {
      skipped.push('Row ' + rowNum + ' (' + pat + '): no ' + reviewType + ' reviewer assigned');
      continue;
    }
    if (!email) {
      skipped.push('Row ' + rowNum + ' (' + pat + '): no email for "' + recipient + '"');
      continue;
    }
    if (!isPhiRecipientAllowed_(email)) {
      skipped.push('Row ' + rowNum + ' (' + pat + '): ' + email + ' is not an approved domain');
      continue;
    }

    var daysSince = '';
    if (dateSent instanceof Date) {
      var diff = Math.floor((new Date() - dateSent) / (1000 * 60 * 60 * 24));
      daysSince = diff + ' day' + (diff !== 1 ? 's' : '') + ' ago';
    }

    eligible.push({
      rowNum: rowNum, rowData: rowData, pat: pat, recipient: recipient,
      email: email, caseId: caseId, reviewType: reviewType, daysSince: daysSince
    });
  }

  if (eligible.length === 0) {
    var msg = 'No selected rows are awaiting a review response.\n\nReminders can be sent for cases with status "Out for primary review" or "Out for secondary review".\n';
    if (skipped.length > 0) msg += '\nSkipped:\n' + skipped.join('\n');
    ui.alert('Nothing to Send', msg, ui.ButtonSet.OK);
    return;
  }

  var confirmMsg = 'Send reminder emails for ' + eligible.length + ' case(s)?\n\n';
  for (var i = 0; i < eligible.length; i++) {
    var e = eligible[i];
    confirmMsg += '  ' + e.caseId + ': ' + e.pat + ' \u2192 ' + e.recipient + ' (' + e.reviewType + ')';
    if (e.daysSince) confirmMsg += ' — sent ' + e.daysSince;
    confirmMsg += '\n';
  }
  if (skipped.length > 0) confirmMsg += '\nSkipped:\n' + skipped.join('\n');

  if (ui.alert('Confirm Reminders', confirmMsg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var sent = 0, errors = [];

  for (var i = 0; i < eligible.length; i++) {
    var e = eligible[i];
    var studyType = (e.rowData[CONFIG.RASLO_COLS.STUDY_TYPE - 1] || '').toString().trim();
    var system = (e.rowData[CONFIG.RASLO_COLS.SYSTEM - 1] || '').toString().trim();

    var typeLabel = e.reviewType === 'primary' ? 'Primary' : 'Secondary';
    var subject = CONFIG.SUBJECT_PREFIX + ' REMINDER: ' + typeLabel + ' Review [' + e.caseId + ']';

    // HIPAA minimum necessary: a reminder only points back to the original
    // review email, so it carries no patient name, MRN, date, or narrative.
    var bodyLines = [
      'RASLO PEER REVIEW \u2014 REMINDER',
      '',
      'Case ID: ' + e.caseId,
      '',
      'Dear ' + e.recipient + ',',
      '',
      'This is a reminder that a ' + typeLabel.toLowerCase() + ' review response is pending for case ' + e.caseId +
        ' (' + [system, studyType].filter(Boolean).join(' ') + ').',
      e.daysSince ? 'The review was sent ' + e.daysSince + '.' : '',
      '',
      'Search your email for ' + e.caseId + ' to find the original review request, which has the case details,',
      'and reply to it with your comments.',
      '',
      '\u2014 RASLO Peer Review System'
    ];

    try {
      sendPhiEmail_(e.email, subject, bodyLines.join('\n'));

      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
        appendNote_(e.rowData[CONFIG.RASLO_COLS.STATUS_NOTES - 1],
          'Reminder sent to ' + e.recipient + ' (' + typeLabel.toLowerCase() + ' review)'));
      rasloSheet.getRange(e.rowNum, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());
      sent++;
      debugLog_('sendRemindersSelected', e.caseId + ': reminder sent to ' + e.recipient + ' <' + e.email + '>');
    } catch (err) {
      errors.push(e.caseId + ': ' + err.message);
      debugError_('sendRemindersSelected', e.caseId + ': ' + err.message);
    }
  }

  var resultMsg = 'Reminders sent: ' + sent + ' of ' + eligible.length;
  if (errors.length > 0) resultMsg += '\n\nErrors:\n' + errors.join('\n');
  ui.alert('Reminders', resultMsg, ui.ButtonSet.OK);
}


// ============================================================================
// 14. LEGACY BATCH ACTIONS
// ============================================================================

function sendPrimaryReviewsAll() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var radSheet = ss.getSheetByName(CONFIG.RAD_SHEET);
  var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);
  if (!rasloSheet || !radSheet) { ui.alert('Error', 'Sheets not found.', ui.ButtonSet.OK); return; }

  var radEmails = buildRadEmailLookup_(radSheet);
  var templateBody = loadPrimaryTemplate_();
  var data = rasloSheet.getDataRange().getValues();
  var sent = 0, errors = [];

  // Bulk PHI disclosure: always confirm the count first.
  var pending = 0;
  for (var k = 1; k < data.length; k++) {
    if ((data[k][CONFIG.RASLO_COLS.CASE_STATUS-1]||'').toString().trim() === 'Entered') pending++;
  }
  if (pending === 0) { ui.alert('Nothing to Send', 'No cases have status "Entered".', ui.ButtonSet.OK); return; }
  if (ui.alert('Send ALL Primary Reviews',
      'Send primary review emails for all ' + pending + ' case(s) with status "Entered"?\n\n' +
      'Each email contains patient information. Only approved domains (' + getPhiAllowedDomains_().join(', ') +
      ') will receive one.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  for (var i = 1; i < data.length; i++) {
    if ((data[i][CONFIG.RASLO_COLS.CASE_STATUS-1]||'').toString().trim() !== 'Entered') continue;
    var phys = (data[i][CONFIG.RASLO_COLS.ATTRIB_PHYS-1]||'').toString().trim();
    var email = radEmails[phys];
    if (!email) { errors.push('Row ' + (i+1) + ': No email for "' + phys + '"'); continue; }
    if (!isPhiRecipientAllowed_(email)) { errors.push('Row ' + (i+1) + ': ' + email + ' is not an approved domain'); continue; }

    var pat = data[i][CONFIG.RASLO_COLS.PATIENT_NAME-1] || '';
    var rowNum = i + 1;
    var caseId = (data[i][CONFIG.RASLO_COLS.CASE_ID-1] || '').toString().trim();
    if (!caseId) {
      caseId = generateCaseId_();
      rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.CASE_ID).setValue(caseId);
    }

    var body = fillTemplate_(templateBody, {
      '{{PATIENT_NAME}}': pat, '{{SYSTEM}}': data[i][CONFIG.RASLO_COLS.SYSTEM-1]||'',
      '{{MRN}}': data[i][CONFIG.RASLO_COLS.MRN-1]||'',
      '{{EVENT_DATE}}': formatDateForDisplay_(data[i][CONFIG.RASLO_COLS.EVENT_DATE-1]),
      '{{STUDY_TYPE}}': data[i][CONFIG.RASLO_COLS.STUDY_TYPE-1]||'',
      '{{ORGAN_SYSTEM}}': data[i][CONFIG.RASLO_COLS.ORGAN_SYSTEM-1]||'',
      '{{ATTRIB_PHYSICIAN}}': phys,
      '{{NARRATIVE}}': data[i][CONFIG.RASLO_COLS.NARRATIVE-1]||'',
      '{{IMAGING_RATING}}': data[i][CONFIG.RASLO_COLS.IMAGING_RATING-1]||'',
      '{{CASE_ID}}': caseId
    });
    var subject = CONFIG.SUBJECT_PREFIX + ' Primary Review [' + caseId + ']';

    try {
      sendPhiEmail_(email, subject, body);
      Utilities.sleep(2000);
      var threads = GmailApp.search('subject:"[' + caseId + ']" from:me newer_than:1d', 0, 1);
      if (threads.length > 0) {
        trackerSheet.appendRow([caseId, threads[0].getId(), 'primary', email, new Date()]);
        getOrCreateLabel_(CONFIG.GMAIL_LABEL).addToThread(threads[0]);
        debugLog_('sendPrimaryReviewsAll', caseId + ': sent to ' + email + ', thread tracked');
      } else {
        debugLog_('sendPrimaryReviewsAll', caseId + ': sent to ' + email + ' but thread not found by Gmail search');
      }
      rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Out for primary review');
      rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());
      rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
        appendNote_(data[i][CONFIG.RASLO_COLS.STATUS_NOTES-1], 'Primary review sent to ' + phys));
      sent++;
    } catch (e) { errors.push(caseId + ': ' + e.message); }
  }

  var msg = 'Sent: ' + sent;
  if (errors.length > 0) msg += '\nErrors:\n' + errors.join('\n');
  ui.alert('Primary Reviews (All)', msg, ui.ButtonSet.OK);
}

/**
 * v8.1: Self-review is allowed. The warning indicator and block have been removed.
 */
function showSecondaryReviewDialogAll() {
  var ss = getSS_();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var data = rasloSheet.getDataRange().getValues();

  var eligible = [];
  for (var i = 1; i < data.length; i++) {
    if ((data[i][CONFIG.RASLO_COLS.CASE_STATUS-1]||'').toString().trim() === 'Back from primary') {
      var caseId = (data[i][CONFIG.RASLO_COLS.CASE_ID-1] || '').toString().trim();
      if (!caseId) {
        caseId = generateCaseId_();
        rasloSheet.getRange(i + 1, CONFIG.RASLO_COLS.CASE_ID).setValue(caseId);
      }
      eligible.push({ caseId: caseId, patient: data[i][CONFIG.RASLO_COLS.PATIENT_NAME-1]||'',
        attrib: data[i][CONFIG.RASLO_COLS.ATTRIB_PHYS-1]||'',
        studyType: data[i][CONFIG.RASLO_COLS.STUDY_TYPE-1]||'',
        eventDate: formatDateForDisplay_(data[i][CONFIG.RASLO_COLS.EVENT_DATE-1]) });
    }
  }
  if (eligible.length === 0) { SpreadsheetApp.getUi().alert('No cases ready for secondary review.'); return; }

  var caseOpts = '';
  for (var i = 0; i < eligible.length; i++) {
    var c = eligible[i];
    caseOpts += '<option value="' + escapeHtml_(c.caseId) + '">' + escapeHtml_(c.caseId + ' — ' + c.patient + ' - ' + c.studyType + ' ' + c.eventDate + ' (' + c.attrib + ')') + '</option>';
  }
  var radOpts = '';
  for (var i = 0; i < RADIOLOGIST_NAMES.length; i++) {
    if (RADIOLOGIST_NAMES[i] !== 'VetMed' && RADIOLOGIST_NAMES[i] !== 'None')
      radOpts += '<option value="' + escapeHtml_(RADIOLOGIST_NAMES[i]) + '">' + escapeHtml_(RADIOLOGIST_NAMES[i]) + '</option>';
  }

  var html = HtmlService.createHtmlOutput(
    '<style>body{font-family:Arial;padding:10px}label{display:block;margin:10px 0 5px;font-weight:bold}select{width:100%;padding:8px;margin-bottom:10px}button{padding:10px 20px;background:#1a73e8;color:white;border:none;border-radius:4px;cursor:pointer;margin-right:10px}.cancel{background:#666}</style>'
    + '<label>Case:</label><select id="cs">' + caseOpts + '</select>'
    + '<label>Secondary Reviewer:</label><select id="rs">' + radOpts + '</select><br>'
    + '<button onclick="go()">Send</button><button class="cancel" onclick="google.script.host.close()">Cancel</button>'
    + '<script>'
    + 'function go(){var c=document.getElementById("cs").value,r=document.getElementById("rs").value;'
    + 'google.script.run.withSuccessHandler(function(){alert("Sent!");google.script.host.close()}).withFailureHandler(function(e){alert("Error: "+e.message)}).sendSecondaryReviewSingle(c,r)}</script>'
  ).setWidth(550).setHeight(280);
  SpreadsheetApp.getUi().showModalDialog(html, 'Send Secondary Review');
}

/** Single secondary review send (used by legacy dialog). */
function sendSecondaryReviewSingle(caseId, reviewerName) {
  var ss = getSS_();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var radSheet = ss.getSheetByName(CONFIG.RAD_SHEET);
  var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);

  var email = buildRadEmailLookup_(radSheet)[reviewerName];
  if (!email) throw new Error('No email for ' + reviewerName);

  var rowNum = findRowByCaseId_(rasloSheet, caseId);
  if (rowNum < 0) throw new Error('Case ID ' + caseId + ' not found on sheet');

  var rowData = rasloSheet.getRange(rowNum, 1, 1, CONFIG.RASLO_COL_COUNT).getValues()[0];
  var templateBody = loadSecondaryTemplate_();

  var pat = rowData[CONFIG.RASLO_COLS.PATIENT_NAME-1] || '';
  var body = fillTemplate_(templateBody, {
    '{{PATIENT_NAME}}': pat, '{{SYSTEM}}': rowData[CONFIG.RASLO_COLS.SYSTEM-1]||'',
    '{{MRN}}': rowData[CONFIG.RASLO_COLS.MRN-1]||'',
    '{{EVENT_DATE}}': formatDateForDisplay_(rowData[CONFIG.RASLO_COLS.EVENT_DATE-1]),
    '{{STUDY_TYPE}}': rowData[CONFIG.RASLO_COLS.STUDY_TYPE-1]||'',
    '{{ORGAN_SYSTEM}}': rowData[CONFIG.RASLO_COLS.ORGAN_SYSTEM-1]||'',
    '{{ATTRIB_PHYSICIAN}}': rowData[CONFIG.RASLO_COLS.ATTRIB_PHYS-1]||'',
    '{{REVIEWER}}': reviewerName,
    '{{NARRATIVE}}': rowData[CONFIG.RASLO_COLS.NARRATIVE-1]||'',
    '{{IMAGING_RATING}}': rowData[CONFIG.RASLO_COLS.IMAGING_RATING-1]||'',
    '{{DISCUSSION}}': rowData[CONFIG.RASLO_COLS.DISCUSSION-1]||'',
    '{{CASE_ID}}': caseId
  });
  var subject = CONFIG.SUBJECT_PREFIX + ' Secondary Review [' + caseId + ']';
  sendPhiEmail_(email, subject, body);

  Utilities.sleep(2000);
  var threads = GmailApp.search('subject:"[' + caseId + ']" "Secondary Review" from:me newer_than:1d', 0, 1);
  if (threads.length > 0) {
    trackerSheet.appendRow([caseId, threads[0].getId(), 'secondary', email, new Date()]);
    getOrCreateLabel_(CONFIG.GMAIL_LABEL).addToThread(threads[0]);
    debugLog_('sendSecondaryReviewSingle', caseId + ': sent to ' + email + ', thread tracked');
  } else {
    debugLog_('sendSecondaryReviewSingle', caseId + ': sent to ' + email + ' but thread not found by Gmail search');
  }

  rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Out for secondary review');
  rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());
  rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.REVIEW_PHYS).setValue(reviewerName);
  rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
    appendNote_(rasloSheet.getRange(rowNum, CONFIG.RASLO_COLS.STATUS_NOTES).getValue(), 'Secondary review sent to ' + reviewerName));
}


// ============================================================================
// 15. EMAIL REPLY PARSING (now uses Case ID lookup)
// ============================================================================

function checkForReplies() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);
  if (!rasloSheet) { ui.alert('Error', 'RASLO sheet not found. Run Initial Setup.', ui.ButtonSet.OK); return; }

  var result = checkForRepliesInternal_(rasloSheet, trackerSheet);

  var msg = 'Replies captured: ' + result.count;
  if (result.updated.length > 0) msg += '\n\n' + result.updated.join('\n');
  else msg += '\nNo new replies.';
  if (result.orphaned.length > 0) msg += '\n\nOrphaned (Case ID not found on sheet):\n' + result.orphaned.join('\n');
  ui.alert('Email Replies', msg, ui.ButtonSet.OK);
}

function rescanProcessedThreads() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);
  if (!rasloSheet || !trackerSheet) { ui.alert('Error', 'Sheets not found.', ui.ButtonSet.OK); return; }

  var q = 'label:"' + CONFIG.GMAIL_PROCESSED_LABEL + '" subject:"' + CONFIG.SUBJECT_PREFIX + '"';
  debugLog_('rescanProcessedThreads', 'Searching: ' + q);
  var threads = GmailApp.search(q, 0, 100);
  debugLog_('rescanProcessedThreads', 'Found ' + threads.length + ' processed thread(s) to re-scan');

  if (threads.length === 0) {
    ui.alert('Re-scan', 'No processed threads found to re-scan.', ui.ButtonSet.OK);
    return;
  }

  var caseIdMap = buildCaseIdMap_(rasloSheet);
  var td = trackerSheet.getDataRange().getValues(), tm = {};
  for (var i = 1; i < td.length; i++) {
    var tId = (td[i][1] || '').toString().trim();
    if (!tId) continue;
    if (!tm[tId]) tm[tId] = [];
    tm[tId].push({ caseId: (td[i][0] || '').toString().trim(), type: td[i][2] });
  }

  var count = 0, updated = [], skipped = 0;

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var msgs = thread.getMessages();
    if (msgs.length <= 1) { skipped++; continue; }

    var subj = thread.getFirstMessageSubject();
    var caseId = extractCaseIdFromSubject_(subj);
    if (!caseId) { skipped++; continue; }

    var row = caseIdMap[caseId];
    if (!row) { skipped++; continue; }

    var tracking = tm[thread.getId()];
    var rtype = tracking && tracking.length > 0 ? tracking[tracking.length - 1].type : 'unknown';
    if (rtype === 'unknown') {
      var currentStatus = rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).getValue().toString().trim();
      if (currentStatus === 'Out for primary review' || currentStatus === 'Back from primary') rtype = 'primary';
      else if (currentStatus === 'Out for secondary review' || currentStatus === 'Back from secondary') rtype = 'secondary';
    }

    for (var m = 1; m < msgs.length; m++) {
      var msg = msgs[m];
      var from = msg.getFrom();
      var reply = getReplyFromMessage_(msg);
      var sender = extractNameFromEmail_(from);
      var rdate = msg.getDate().toLocaleDateString();
      if (!reply.trim()) continue;

      var dedupKey = '[' + sender + ' - ' + rdate + ']';
      var entry = dedupKey + ': ' + reply.trim();
      var disc = rasloSheet.getRange(row, CONFIG.RASLO_COLS.DISCUSSION).getValue() || '';

      // Same dedup key as checkForRepliesInternal_ so re-scans never double-append
      if (disc.indexOf(dedupKey) >= 0) continue;

      debugLog_('rescanProcessedThreads', 'Recovered reply for ' + caseId + ' from ' + sender);
      rasloSheet.getRange(row, CONFIG.RASLO_COLS.DISCUSSION).setValue(disc ? disc + '\n\n' + entry : entry);
      rasloSheet.getRange(row, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());

      var st = rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).getValue();
      if (rtype === 'primary' && st === 'Out for primary review') {
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Back from primary');
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
          appendNote_(rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).getValue(),
            'Primary response from ' + sender + ' (recovered from re-scan). Status \u2192 Back from primary.'));
      } else if (rtype === 'secondary' && st === 'Out for secondary review') {
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Back from secondary');
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
          appendNote_(rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).getValue(),
            'Secondary response from ' + sender + ' (recovered from re-scan). Status \u2192 Back from secondary.'));
      }

      if (!tm[thread.getId()]) {
        trackerSheet.appendRow([caseId, thread.getId(), rtype, '(re-scan)', new Date()]);
        tm[thread.getId()] = [{ caseId: caseId, type: rtype }];
      }

      count++;
      updated.push(caseId + ': ' + sender + ' (' + rtype + ', recovered)');
    }
  }

  var msg = 'Re-scan complete.\n\nRecovered replies: ' + count;
  if (updated.length > 0) msg += '\n\n' + updated.join('\n');
  if (skipped > 0) msg += '\n\n' + skipped + ' thread(s) skipped (no replies, no case ID, or already captured).';
  debugLog_('rescanProcessedThreads', 'Done. Recovered ' + count + ' replies from ' + threads.length + ' processed threads.');
  ui.alert('Re-scan Results', msg, ui.ButtonSet.OK);
}

/**
 * Core reply-checking logic, shared by manual and auto-trigger paths.
 * Returns { count, updated[], orphaned[] }.
 *
 * v8.1: No longer filters messages by sender email. Self-replies are captured
 * correctly because the original outgoing review starts with "RASLO PEER REVIEW"
 * which extractReplyText_ treats as the quoted block delimiter, so it yields
 * empty reply text and is naturally filtered by the empty-reply check.
 */
function checkForRepliesInternal_(rasloSheet, trackerSheet) {
  // Search threads from last 90 days with our subject prefix
  var q = 'subject:"' + CONFIG.SUBJECT_PREFIX + '" newer_than:90d';
  debugLog_('checkForRepliesInternal_', 'Search: ' + q);
  var threads = GmailApp.search(q, 0, 100);
  debugLog_('checkForRepliesInternal_', 'Found ' + threads.length + ' thread(s)');

  if (threads.length === 0) {
    debugLog_('checkForRepliesInternal_', 'No threads found.');
    return { count: 0, updated: [], orphaned: [] };
  }

  // Build tracker map: threadId -> [{ caseId, type }]
  var td = trackerSheet.getDataRange().getValues(), tm = {};
  for (var i = 1; i < td.length; i++) {
    var tId = (td[i][1] || '').toString().trim();
    if (!tId) continue;
    if (!tm[tId]) tm[tId] = [];
    tm[tId].push({ caseId: (td[i][0] || '').toString().trim(), type: td[i][2] });
  }

// Build case ID → row map
  var caseIdMap = buildCaseIdMap_(rasloSheet);

  // Build set of archived case IDs so we don't report them as orphaned
  var archivedIds = {};
  var archiveSheet = getSS_().getSheetByName(CONFIG.ARCHIVE_SHEET);
  if (archiveSheet && archiveSheet.getLastRow() > 1) {
    var archiveIds = archiveSheet.getRange(2, CONFIG.RASLO_COLS.CASE_ID, archiveSheet.getLastRow() - 1, 1).getValues();
    for (var a = 0; a < archiveIds.length; a++) {
      var aid = (archiveIds[a][0] || '').toString().trim();
      if (aid) archivedIds[aid] = true;
    }
  }

  // Track which case IDs we've already captured replies for in this run
  var capturedThisRun = {};

  var count = 0, updated = [], orphaned = [];
  var seenOrphans = {};

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var msgs = thread.getMessages();

    // Extract case ID from subject
    var subj = thread.getFirstMessageSubject();
    var caseId = extractCaseIdFromSubject_(subj);

    // Fallback: check tracker map, but only accept valid PR-format IDs
    if (!caseId) {
      var trackingFallback = tm[thread.getId()];
      if (trackingFallback && trackingFallback.length > 0) {
        var candidate = trackingFallback[trackingFallback.length - 1].caseId;
        if (candidate && candidate.match(/^PR-\d{8}-[A-Z0-9]{4}$/)) {
          caseId = candidate;
        }
      }
    }

    if (!caseId) continue;

    // Skip if we already captured a reply for this case in this run
    if (capturedThisRun[caseId]) continue;

// Find the row
    var row = caseIdMap[caseId];
    if (!row) {
      // Silently skip archived cases — they're expected to not be on the live sheet
      if (archivedIds[caseId]) continue;
      if (!seenOrphans[caseId]) { orphaned.push(caseId); seenOrphans[caseId] = true; }
      continue;
    }

    // Determine review type from tracker, subject, or status
    var tracking = tm[thread.getId()];
    var rtype = 'unknown';
    if (tracking && tracking.length > 0) {
      rtype = tracking[tracking.length - 1].type;
    } else {
      if (subj.indexOf('Secondary Review') >= 0) rtype = 'secondary';
      else if (subj.indexOf('Primary Review') >= 0) rtype = 'primary';
      else if (subj.indexOf('REMINDER') >= 0) {
        if (subj.indexOf('Primary') >= 0) rtype = 'primary';
        else if (subj.indexOf('Secondary') >= 0) rtype = 'secondary';
      }
      trackerSheet.appendRow([caseId, thread.getId(), rtype, '(auto-detected)', new Date()]);
      tm[thread.getId()] = [{ caseId: caseId, type: rtype }];
    }

    // Process ALL messages. Outgoing review emails are filtered by the
    // empty-reply check below because extractReplyText_ returns '' for them
    // (their body starts with the template marker "RASLO PEER REVIEW").
    var threadCaptured = false;
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];

      var reply = getReplyFromMessage_(msg);
      if (!reply.trim()) continue;  // filters original outgoing reviews/reminders

      var sender = extractNameFromEmail_(msg.getFrom());
      var rdate = msg.getDate().toLocaleDateString();

      // Dedup key: sender + date header — consistent regardless of plain vs HTML extraction
      var dedupKey = '[' + sender + ' - ' + rdate + ']';
      var entry = dedupKey + ': ' + reply.trim();
      var disc = rasloSheet.getRange(row, CONFIG.RASLO_COLS.DISCUSSION).getValue() || '';

      // Duplicate check — if this sender+date combo is already in Discussion, skip
      if (disc.indexOf(dedupKey) >= 0) continue;

      debugLog_('checkForRepliesInternal_', 'NEW reply for ' + caseId + ' from ' + sender + ' (' + rtype + ')');
      rasloSheet.getRange(row, CONFIG.RASLO_COLS.DISCUSSION).setValue(disc ? disc + '\n\n' + entry : entry);
      rasloSheet.getRange(row, CONFIG.RASLO_COLS.DATE_STATUS).setValue(new Date());

      var st = rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).getValue();
      if (rtype === 'primary' && st === 'Out for primary review') {
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Back from primary');
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
          appendNote_(rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).getValue(),
            'Primary response from ' + sender + '. Status \u2192 Back from primary.'));
      } else if (rtype === 'secondary' && st === 'Out for secondary review') {
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.CASE_STATUS).setValue('Back from secondary');
        rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).setValue(
          appendNote_(rasloSheet.getRange(row, CONFIG.RASLO_COLS.STATUS_NOTES).getValue(),
            'Secondary response from ' + sender + '. Status \u2192 Back from secondary.'));
      }
      count++;
      capturedThisRun[caseId] = true;
      threadCaptured = true;
      updated.push(caseId + ': ' + sender + ' (' + rtype + ')');
    }

    // Move the thread from PeerReview to PeerReview/Processed once a reply
    // has been captured, matching the documented label lifecycle and making
    // "Re-scan Processed Threads" able to find these threads later.
    if (threadCaptured) {
      try {
        var baseLabel = GmailApp.getUserLabelByName(CONFIG.GMAIL_LABEL);
        if (baseLabel) baseLabel.removeFromThread(thread);
        getOrCreateLabel_(CONFIG.GMAIL_PROCESSED_LABEL).addToThread(thread);
      } catch (labelErr) {
        debugError_('checkForRepliesInternal_', 'Label swap failed for ' + caseId + ': ' + labelErr.message);
      }
    }
  }

  debugLog_('checkForRepliesInternal_', 'Done. Captured ' + count + ' new replies from ' + threads.length + ' threads.');
  return { count: count, updated: updated, orphaned: orphaned };
}


// ============================================================================
// 16. ARCHIVE COMPLETED CASES
// ============================================================================

function archiveCompletedCases() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  var archiveSheet = ss.getSheetByName(CONFIG.ARCHIVE_SHEET);

  if (!rasloSheet) { ui.alert('Error', 'RASLO sheet not found.', ui.ButtonSet.OK); return; }
  if (!archiveSheet) {
    archiveSheet = ensureSheet_(ss, CONFIG.ARCHIVE_SHEET, getRASLOHeaders_());
  }

  var data = rasloSheet.getDataRange().getValues();
  var completedRows = [];

  for (var i = 1; i < data.length; i++) {
    var status = (data[i][CONFIG.RASLO_COLS.CASE_STATUS - 1] || '').toString().trim();
    if (status === 'Completed') {
      completedRows.push({ rowNum: i + 1, rowData: data[i] });
    }
  }

  if (completedRows.length === 0) {
    ui.alert('No Completed Cases', 'No cases with status "Completed" were found on the RASLO Tracking sheet.', ui.ButtonSet.OK);
    return;
  }

  var confirmMsg = 'Archive ' + completedRows.length + ' completed case(s)?\n\n';
  for (var i = 0; i < completedRows.length && i < 20; i++) {
    var r = completedRows[i].rowData;
    var cid = (r[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim() || '(no ID)';
    var pat = (r[CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
    confirmMsg += '  ' + cid + ': ' + pat + '\n';
  }
  if (completedRows.length > 20) confirmMsg += '  ... and ' + (completedRows.length - 20) + ' more\n';
  confirmMsg += '\nThese will be moved to the Archive sheet and removed from RASLO Tracking.';

  var confirm = ui.alert('Confirm Archive', confirmMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  for (var i = 0; i < completedRows.length; i++) {
    var rowData = completedRows[i].rowData;
    var archiveRow = [];
    for (var c = 0; c < CONFIG.RASLO_COL_COUNT; c++) {
      archiveRow.push(rowData[c] !== undefined ? rowData[c] : '');
    }
    archiveSheet.appendRow(archiveRow);
  }

  for (var i = completedRows.length - 1; i >= 0; i--) {
    rasloSheet.deleteRow(completedRows[i].rowNum);
  }

  debugLog_('archiveCompletedCases', 'Archived ' + completedRows.length + ' cases');
  ui.alert('Archive Complete', completedRows.length + ' completed case(s) moved to the Archive sheet.', ui.ButtonSet.OK);
}


// ============================================================================
// 17. BOD SUMMARY DOCUMENT GENERATOR
// ============================================================================

function generateBODSummaryDoc() {
  var ss = getSS_();
  var ui = SpreadsheetApp.getUi();
  var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
  if (!rasloSheet) { ui.alert('Error', 'RASLO sheet not found.', ui.ButtonSet.OK); return; }

  var allData = rasloSheet.getDataRange().getValues();
  var cases = [];

  var selectedRows = getSelectedRASLORows_();
  var selectionMode = (selectedRows !== null && selectedRows.length > 0);

  if (selectionMode) {
    for (var r = 0; r < selectedRows.length; r++) {
      var idx = selectedRows[r] - 1;
      if (idx >= 1 && idx < allData.length) {
        cases.push({ rowNum: selectedRows[r], data: allData[idx] });
      }
    }
  } else {
    for (var i = 1; i < allData.length; i++) {
      var status = (allData[i][CONFIG.RASLO_COLS.CASE_STATUS - 1] || '').toString().trim();
      if (status === 'Pending BOD vote') {
        cases.push({ rowNum: i + 1, data: allData[i] });
      }
    }
  }

  if (cases.length === 0) {
    if (selectionMode) {
      ui.alert('No Cases', 'The selected rows contain no data.', ui.ButtonSet.OK);
    } else {
      ui.alert('No Cases', 'No cases with status "Pending BOD vote" found.\n\n' +
        'Tip: You can also select specific rows on the RASLO sheet before running this — any status will be included.', ui.ButtonSet.OK);
    }
    return;
  }

  var statusNote = selectionMode
    ? cases.length + ' selected case(s) (any status)'
    : cases.length + ' case(s) with status "Pending BOD vote"';
  var confirm = ui.alert('Generate BOD Summary',
    'Create a Google Doc summarizing ' + statusNote + '?\n\n' +
    'The document will be created in your Google Drive.',
    ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var docTitle = 'RASLO Peer Review — BOD Summary — ' + dateStr;
  var doc = DocumentApp.create(docTitle);
  var body = doc.getBody();

  var titleStyle = {};
  titleStyle[DocumentApp.Attribute.FONT_SIZE] = 18;
  titleStyle[DocumentApp.Attribute.BOLD] = true;
  titleStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var subtitleStyle = {};
  subtitleStyle[DocumentApp.Attribute.FONT_SIZE] = 11;
  subtitleStyle[DocumentApp.Attribute.BOLD] = false;
  subtitleStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#666666';
  subtitleStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var headingStyle = {};
  headingStyle[DocumentApp.Attribute.FONT_SIZE] = 14;
  headingStyle[DocumentApp.Attribute.BOLD] = true;
  headingStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var labelStyle = {};
  labelStyle[DocumentApp.Attribute.FONT_SIZE] = 10;
  labelStyle[DocumentApp.Attribute.BOLD] = true;
  labelStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var valueStyle = {};
  valueStyle[DocumentApp.Attribute.FONT_SIZE] = 10;
  valueStyle[DocumentApp.Attribute.BOLD] = false;
  valueStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var narrativeStyle = {};
  narrativeStyle[DocumentApp.Attribute.FONT_SIZE] = 10;
  narrativeStyle[DocumentApp.Attribute.BOLD] = false;
  narrativeStyle[DocumentApp.Attribute.ITALIC] = false;
  narrativeStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';

  var discussionStyle = {};
  discussionStyle[DocumentApp.Attribute.FONT_SIZE] = 10;
  discussionStyle[DocumentApp.Attribute.BOLD] = false;
  discussionStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  discussionStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#333333';

  var decisionStyle = {};
  decisionStyle[DocumentApp.Attribute.FONT_SIZE] = 10;
  decisionStyle[DocumentApp.Attribute.BOLD] = false;
  decisionStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  decisionStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#999999';
  decisionStyle[DocumentApp.Attribute.ITALIC] = true;

  body.clear();

  var title = body.appendParagraph('RASLO Peer Review');
  title.setAttributes(titleStyle);
  title.setAlignment(DocumentApp.HorizontalAlignment.LEFT);

  var subtitle = body.appendParagraph('Board of Directors Case Summary — ' + dateStr);
  subtitle.setAttributes(subtitleStyle);

  var countLine = body.appendParagraph(cases.length + ' case' + (cases.length > 1 ? 's' : '') + ' for review');
  countLine.setAttributes(subtitleStyle);

  // HIPAA notice. Narrative and discussion text can still contain PHI even
  // when names and MRNs are omitted.
  var phiStyle = {};
  phiStyle[DocumentApp.Attribute.FONT_SIZE] = 10;
  phiStyle[DocumentApp.Attribute.BOLD] = true;
  phiStyle[DocumentApp.Attribute.FOREGROUND_COLOR] = '#c5221f';
  phiStyle[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  body.appendParagraph('CONFIDENTIAL — Contains protected health information and peer review work product. ' +
    'Share only with RASLO accounts. Do not download, print, or forward outside RASLO.').setAttributes(phiStyle);

  body.appendHorizontalRule();
  body.appendParagraph('');

  for (var c = 0; c < cases.length; c++) {
    var d = cases[c].data;
    var caseId   = (d[CONFIG.RASLO_COLS.CASE_ID - 1] || '').toString().trim() || '(no ID)';
    var patient  = (d[CONFIG.RASLO_COLS.PATIENT_NAME - 1] || '').toString().trim();
    var system   = (d[CONFIG.RASLO_COLS.SYSTEM - 1] || '').toString().trim();
    var mrn      = (d[CONFIG.RASLO_COLS.MRN - 1] || '').toString().trim();
    var evtDate  = formatDateForDisplay_(d[CONFIG.RASLO_COLS.EVENT_DATE - 1]);
    var studyType = (d[CONFIG.RASLO_COLS.STUDY_TYPE - 1] || '').toString().trim();
    var reviewer = (d[CONFIG.RASLO_COLS.REVIEW_PHYS - 1] || '').toString().trim();
    var narrative = (d[CONFIG.RASLO_COLS.NARRATIVE - 1] || '').toString().trim();
    var rating   = (d[CONFIG.RASLO_COLS.IMAGING_RATING - 1] || '').toString().trim();
    var discussion = (d[CONFIG.RASLO_COLS.DISCUSSION - 1] || '').toString().trim();
    var status   = (d[CONFIG.RASLO_COLS.CASE_STATUS - 1] || '').toString().trim();
    var organSystem = (d[CONFIG.RASLO_COLS.ORGAN_SYSTEM - 1] || '').toString().trim();

    if (c > 0) {
      body.appendPageBreak();
    }

    var caseHeading = body.appendParagraph('Case ' + (c + 1) + ' of ' + cases.length + '  —  ' + caseId);
    caseHeading.setAttributes(headingStyle);

    // Minimum necessary: the board decides on the reading, not the patient,
    // so cases are identified by Case ID unless the owner opts in.
    var tableData = CONFIG.BOD_INCLUDE_IDENTIFIERS ? [['Patient', patient], ['MRN/FIN', mrn]] : [];
    tableData = tableData.concat([
      ['System', system],
      ['Study Type', studyType],
      ['Organ System', organSystem || '(not specified)'],
      ['Event Date', evtDate],
      ['Imaging Rating', rating],
      ['Reviewing Physician', reviewer || '(none assigned)'],
      ['Status', status]
    ]);

    var table = body.appendTable();
    table.setBorderColor('#cccccc');
    table.setBorderWidth(0.5);

    for (var row = 0; row < tableData.length; row++) {
      var tr = table.appendTableRow();
      var labelCell = tr.appendTableCell(tableData[row][0]);
      labelCell.setAttributes(labelStyle);
      labelCell.setBackgroundColor('#f5f5f5');
      labelCell.setWidth(110);
      labelCell.setPaddingTop(3);
      labelCell.setPaddingBottom(3);
      labelCell.setPaddingLeft(6);
      labelCell.setPaddingRight(6);

      var valCell = tr.appendTableCell(tableData[row][1] || '');
      valCell.setAttributes(valueStyle);
      valCell.setWidth(330);
      valCell.setPaddingTop(3);
      valCell.setPaddingBottom(3);
      valCell.setPaddingLeft(6);
      valCell.setPaddingRight(6);
    }
    if (table.getNumRows() > tableData.length) {
      table.removeRow(0);
    }

    body.appendParagraph('');

    var narLabel = body.appendParagraph('Narrative');
    narLabel.setAttributes(labelStyle);
    if (narrative) {
      var narText = body.appendParagraph(narrative);
      narText.setAttributes(narrativeStyle);
    } else {
      var narNone = body.appendParagraph('(no narrative provided)');
      narNone.setAttributes(decisionStyle);
    }

    body.appendParagraph('');

    var discLabel = body.appendParagraph('Discussion');
    discLabel.setAttributes(labelStyle);
    if (discussion) {
      var entries = discussion.split(/\n\n+/);
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].trim()) {
          var entryPara = body.appendParagraph(entries[e].trim());
          entryPara.setAttributes(discussionStyle);
          entryPara.setIndentStart(18);
        }
      }
    } else {
      var discNone = body.appendParagraph('(no discussion recorded)');
      discNone.setAttributes(decisionStyle);
    }

    body.appendParagraph('');

    var decLabel = body.appendParagraph('BOD Decision');
    decLabel.setAttributes(labelStyle);

    var ratingLine = body.appendParagraph('Final Rating:  \u2610 eV1   \u2610 eV2   \u2610 eV3   \u2610 eV4   \u2610 eV5');
    ratingLine.setAttributes(valueStyle);

    var notesLine = body.appendParagraph('Notes: ');
    notesLine.setAttributes(decisionStyle);

    body.appendParagraph('');
    body.appendParagraph('');
  }

  body.appendHorizontalRule();
  var footer = body.appendParagraph(
    'Generated ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
    ' from RASLO Peer Review System');
  footer.setAttributes(subtitleStyle);

  doc.saveAndClose();
  var docUrl = doc.getUrl();

  debugLog_('generateBODSummaryDoc', 'Created BOD summary: ' + docTitle + ' (' + cases.length + ' cases) — ' + docUrl);

  var resultHtml = HtmlService.createHtmlOutput(
    '<style>' +
    'body { font-family: Arial, sans-serif; padding: 16px; font-size: 13px; line-height: 1.6; }' +
    '.success { color: #1e8e3e; font-size: 16px; font-weight: bold; margin-bottom: 12px; }' +
    'a { color: #1a73e8; }' +
    'a.btn { display: inline-block; background: #1a73e8; color: white; padding: 10px 24px; ' +
    '  text-decoration: none; border-radius: 4px; margin-top: 10px; font-weight: bold; }' +
    '.details { color: #666; font-size: 12px; margin-top: 12px; }' +
    '</style>' +
    '<div class="success">✓ BOD Summary Document Created</div>' +
    '<p><b>' + cases.length + ' case' + (cases.length > 1 ? 's' : '') + '</b> summarized in:</p>' +
    '<p><a href="' + docUrl + '" target="_blank">' + escapeHtml_(docTitle) + '</a></p>' +
    '<a class="btn" href="' + docUrl + '" target="_blank">Open Document</a>' +
    '<div class="details">' +
    'The document is in your Google Drive and is shared with no one. It contains PHI: share it only with ' +
    'RASLO accounts using the Share button, and do not attach it to email or download it.<br><br>' +
    'Tip: After the meeting, update the final ratings and status to "Completed" on the RASLO sheet, ' +
    'then use "Archive Completed Cases" to move them off the active tracker.' +
    '</div>'
  ).setWidth(500).setHeight(320);
  ui.showModalDialog(resultHtml, 'BOD Summary');
}


// ============================================================================
// 18. UTILITIES
// ============================================================================

function formatDateForKey_(d) {
  return normalizeDateKey_(d);
}

function pad2_(v) {
  v = v.toString();
  return v.length < 2 ? '0' + v : v;
}

/**
 * Normalizes a date cell to 'yyyy-MM-dd' for matching. Handles real Date
 * objects and the common text forms ('2026-03-14', '3/14/2026', '03-14-26').
 * Sheets stores dates as Date objects on one sheet and as text on another
 * depending on how the data arrived, so raw string comparison never matched.
 */
function normalizeDateKey_(d) {
  if (d === null || d === undefined || d === '') return '';
  if (d instanceof Date) {
    return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = d.toString().trim();
  if (!s) return '';

  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);

  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (m) {
    var yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return yr + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
  }

  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return s.toLowerCase();
}

/**
 * Normalizes a patient name for matching: case, punctuation, and word order
 * are ignored, so 'Doe, Jane M.' and 'jane m doe' produce the same key.
 */
function normalizeNameKey_(name) {
  var s = (name || '').toString().toLowerCase();
  s = s.replace(/['’.]/g, '');        // drop intra-word marks: O'Brien -> obrien, M. -> m
  s = s.replace(/[^a-z0-9\s]/g, ' ');      // other punctuation (commas, hyphens) separates words
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.split(' ').sort().join(' ');
}

/** Normalizes an MRN/FIN for matching (strips punctuation and leading zeros). */
function normalizeMrnKey_(mrn) {
  var s = (mrn || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  return s.replace(/^0+/, '');
}

function formatDateForDisplay_(d) {
  if (!d) return '(no date)';
  if (d instanceof Date) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  return d.toString();
}

function buildRadEmailLookup_(radSheet) {
  var d = radSheet.getDataRange().getValues(), r = {};
  for (var i = 1; i < d.length; i++) {
    var n = (d[i][0]||'').toString().trim(), e = (d[i][1]||'').toString().trim();
    if (n && e) r[n] = e;
  }
  return r;
}

function fillTemplate_(t, reps) {
  var r = t, k = Object.keys(reps);
  for (var i = 0; i < k.length; i++) {
    var val = reps[k[i]];
    val = (val === null || val === undefined || val.toString().trim() === '') ? '(not provided)' : val.toString();
    // Function replacement so '$' sequences in sheet data (e.g. "$&") are kept literal
    r = r.replace(new RegExp(k[i].replace(/[{}]/g, '\\$&'), 'g'), (function(v) { return function() { return v; }; })(val));
  }
  return r;
}

function appendNote_(existing, note) {
  var c = (existing||'').toString().trim();
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  // HIPAA audit: record who took the action alongside what and when.
  var who = getActorEmail_();
  var line = '[' + ts + '] ' + note + (who ? ' (by ' + who + ')' : '');
  return c ? c + '\n' + line : line;
}


// ---------------------------------------------------------------------------
// PHI email egress control (HIPAA)
// ---------------------------------------------------------------------------

// Free consumer mailboxes are never covered by a BAA, so they can't be added
// to the approved list even by mistake.
var CONSUMER_EMAIL_DOMAINS_ = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me',
  'protonmail.com', 'gmx.com', 'mail.com', 'zoho.com', 'comcast.net', 'att.net', 'sbcglobal.net'
];

/** Domains allowed to receive PHI: Script Property override, else CONFIG default. */
function getPhiAllowedDomains_() {
  var prop = '';
  try { prop = PropertiesService.getScriptProperties().getProperty('PHI_ALLOWED_DOMAINS') || ''; } catch (e) { }
  var list = prop.split(',').map(function(d) { return d.trim().toLowerCase(); }).filter(Boolean);
  return list.length ? list : CONFIG.PHI_ALLOWED_DOMAINS_DEFAULT.slice();
}

/**
 * True when every address in a comma/semicolon-separated recipient string
 * is on an approved domain (or a subdomain of one) and none is a consumer
 * mailbox. Accepts "Name <addr>" forms.
 */
function isPhiRecipientAllowed_(recipients, allowed) {
  allowed = allowed || getPhiAllowedDomains_();
  var parts = (recipients || '').toString().split(/[,;]/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (parts.length === 0) return false;
  for (var i = 0; i < parts.length; i++) {
    var m = parts[i].match(/<([^>]+)>/);
    var addr = (m ? m[1] : parts[i]).trim().toLowerCase();
    var at = addr.lastIndexOf('@');
    if (at < 1 || at === addr.length - 1) return false;
    var domain = addr.substring(at + 1);
    if (CONSUMER_EMAIL_DOMAINS_.indexOf(domain) >= 0) return false;
    var ok = false;
    for (var j = 0; j < allowed.length; j++) {
      if (domain === allowed[j] || domain.slice(-(allowed[j].length + 1)) === '.' + allowed[j]) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * The only way this script sends email that contains PHI. Refuses any
 * recipient outside the approved domains, so a typo or personal address on
 * the Radiologists sheet can't cause a disclosure.
 */
function sendPhiEmail_(to, subject, body) {
  if (!isPhiRecipientAllowed_(to)) {
    throw new Error('Blocked: ' + to + ' is not on an approved email domain (' +
      getPhiAllowedDomains_().join(', ') + '). See Setup > Set Approved Email Domains.');
  }
  GmailApp.sendEmail(to, subject, body, { name: 'RASLO Peer Review' });
}

/** Writes a bold header into the given column if it isn't already there. */
function ensureHeader_(sheet, col, name) {
  if (sheet.getMaxColumns() < col) sheet.insertColumnsAfter(sheet.getMaxColumns(), col - sheet.getMaxColumns());
  var cell = sheet.getRange(1, col);
  if (cell.getValue() !== name) {
    cell.setValue(name).setFontWeight('bold');
    debugLog_('ensureHeader_', 'Added "' + name + '" header at column ' + col + ' on ' + sheet.getName());
  }
}

/**
 * Reads the organ system list from Reference!F (header "Systems"),
 * skipping blanks. Returns [] if the sheet or column is missing.
 */
function getOrganSystems_(ss) {
  ss = ss || getSS_();
  var ref = ss.getSheetByName(CONFIG.REF_SHEET);
  if (!ref) return [];
  var lastRow = ref.getLastRow();
  if (lastRow < 2 || ref.getMaxColumns() < CONFIG.REF_ORGAN_SYSTEM_COL) return [];
  var vals = ref.getRange(2, CONFIG.REF_ORGAN_SYSTEM_COL, lastRow - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = (vals[i][0] || '').toString().trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * Maps a Gemini-returned organ system onto the Reference list.
 *   1. exact match ignoring case, punctuation, and "&" vs "and"
 *   2. an option appearing as whole word(s) in the raw text ("Chest CT" -> Chest)
 *   3. raw text (3+ chars) as a prefix of an option ("Musculo" -> Musculoskeletal)
 * Whole-word matching matters because short options like "GI" would otherwise
 * match inside words like "Angiography". If nothing matches, the raw text is
 * returned so it lands on the sheet flagged by the validation warning rather
 * than being silently dropped.
 */
function matchOrganSystem_(raw, list) {
  var s = (raw || '').toString().trim();
  if (!s) return '';
  list = list || getOrganSystems_();

  var norm = function(v) {
    return (v || '').toString().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  };
  var target = norm(s);
  if (!target) return s;

  for (var i = 0; i < list.length; i++) {
    if (norm(list[i]) === target) return list[i];
  }
  var padded = ' ' + target + ' ';
  for (var j = 0; j < list.length; j++) {
    var opt = norm(list[j]);
    if (opt && padded.indexOf(' ' + opt + ' ') >= 0) return list[j];
  }
  if (target.length >= 3) {
    for (var k = 0; k < list.length; k++) {
      if (norm(list[k]).indexOf(target) === 0) return list[k];
    }
  }
  return s;
}

function getOrCreateLabel_(n) {
  var l = GmailApp.getUserLabelByName(n); if (!l) l = GmailApp.createLabel(n); return l;
}

function ensureGmailLabel_(n) { try { getOrCreateLabel_(n); } catch(e) {} }

function extractReplyText_(body) {
  if (!body) return '';
  var lines = body.split('\n');
  var fresh = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();

    // Stop at common reply delimiters
    if (line.match(/^On .+ wrote:\s*$/)) break;
    if (line.match(/^-{3,}\s*Original Message/i)) break;
    if (line.match(/^--\s*$/)) break;  // standard sig delimiter

    // Stop at mobile device signatures (reply text is above these)
    if (trimmed.match(/^Sent from my (iPhone|iPad|Galaxy|Samsung|Android|Pixel)/i)) break;
    if (trimmed.match(/^Get Outlook for/i)) break;
    if (trimmed.match(/^Sent from Mail for/i)) break;
    if (trimmed.match(/^Sent via /i)) break;

    // Stop at our own email template markers (start of quoted original)
    if (trimmed.match(/^RASLO PEER REVIEW/)) break;
    if (trimmed.match(/^Case ID:\s*PR-/)) break;
    if (trimmed.match(/^CASE DETAILS:/)) break;
    if (trimmed.match(/^NARRATIVE:/)) break;

    // Skip quoted lines (starts with ">")
    if (line.match(/^\s*>/)) continue;

    fresh.push(line);
  }

  return fresh.join('\n').trim();
}

/**
 * Gets reply text from a Gmail message, trying plain body first,
 * then falling back to HTML body stripped of tags.
 */
function getReplyFromMessage_(msg) {
  var plain = msg.getPlainBody();
  var text = extractReplyText_(plain);
  if (text) return text;

  var html = msg.getBody();
  if (!html) return '';
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/?(p|div|tr|li|h[1-6])[^>]*>/gi, '\n');
  html = html.replace(/<[^>]+>/g, '');
  html = html.replace(/&nbsp;/gi, ' ');
  html = html.replace(/&lt;/gi, '<');
  html = html.replace(/&gt;/gi, '>');
  html = html.replace(/&quot;/gi, '"');
  html = html.replace(/&#39;/gi, "'");
  html = html.replace(/&amp;/gi, '&');  // decode last so "&amp;lt;" doesn't double-decode
  html = html.replace(/\n{3,}/g, '\n\n').trim();
  return extractReplyText_(html);
}

function extractNameFromEmail_(f) {
  var m = f.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : f.replace(/<|>/g, '').trim();
}

function escapeHtml_(s) {
  return (s || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadPrimaryTemplate_() {
  var templateId = null;
  try { templateId = PropertiesService.getScriptProperties().getProperty('PRIMARY_TEMPLATE_ID'); } catch(e) {}
  if (templateId) {
    try { return DocumentApp.openById(templateId).getBody().getText(); } catch(e) { }
  }
  return getDefaultPrimaryTemplate_();
}

function loadSecondaryTemplate_() {
  var templateId = null;
  try { templateId = PropertiesService.getScriptProperties().getProperty('SECONDARY_TEMPLATE_ID'); } catch(e) {}
  if (templateId) {
    try { return DocumentApp.openById(templateId).getBody().getText(); } catch(e) { }
  }
  return getDefaultSecondaryTemplate_();
}


// ============================================================================
// 19. DEFAULT TEMPLATES
// ============================================================================

function getDefaultPrimaryTemplate_() {
  return 'RASLO PEER REVIEW — PRIMARY REVIEW REQUEST\n\nCase ID: {{CASE_ID}}\n\nDear {{ATTRIB_PHYSICIAN}},\n\nA peer review case has been submitted regarding a study you interpreted. Please review and reply to this email with your comments.\n\nCASE DETAILS:\nPatient: {{PATIENT_NAME}}\nSystem: {{SYSTEM}}\nMRN/FIN: {{MRN}}\nEvent Date: {{EVENT_DATE}}\nStudy Type: {{STUDY_TYPE}}\nImaging Rating: {{IMAGING_RATING}}\n\nNARRATIVE:\n{{NARRATIVE}}\n\nPlease reply directly to this email.\n\n— RASLO Peer Review System';
}

function getDefaultSecondaryTemplate_() {
  return 'RASLO PEER REVIEW — SECONDARY REVIEW REQUEST\n\nCase ID: {{CASE_ID}}\n\nDear {{REVIEWER}},\n\nYou have been selected for secondary review.\n\nCASE DETAILS:\nPatient: {{PATIENT_NAME}}\nSystem: {{SYSTEM}}\nMRN/FIN: {{MRN}}\nEvent Date: {{EVENT_DATE}}\nStudy Type: {{STUDY_TYPE}}\nAttributing Physician: {{ATTRIB_PHYSICIAN}}\nImaging Rating: {{IMAGING_RATING}}\n\nNARRATIVE:\n{{NARRATIVE}}\n\nDISCUSSION TO DATE:\n{{DISCUSSION}}\n\nPlease reply directly to this email.\n\n— RASLO Peer Review System';
}


// ============================================================================
// 20. TIME TRIGGER
// ============================================================================

function installTimeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkForRepliesAuto_') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('checkForRepliesAuto_').timeBased().everyMinutes(30).create();
  Logger.log('Trigger installed.');
}

/**
 * Trigger handler. Runs under the central Email Automation Hub, which records
 * successes and errors (never empty scans), alerts if this job errors or stops
 * running, and can pause it from the hub's Registry sheet.
 *
 * The typeof guard below only covers the case where the EmailHub entry has
 * been REMOVED from appsscript.json. It cannot help a user who lacks read
 * access to the library project: Apps Script resolves library dependencies
 * at load time, so for that user the whole project fails to load (including
 * onOpen, so no menu) with "Library with identifier EmailHub is missing".
 * Every editor of the spreadsheet must therefore have at least Viewer access
 * to the EmailHub script (library ID in appsscript.json). See README.
 */
function checkForRepliesAuto_() {
  if (typeof EmailHub === 'undefined') return checkForRepliesAutoInner_();
  return EmailHub.runJob('peer-review-replies', checkForRepliesAutoInner_, {
    project: 'Peer Review', handler: 'checkForRepliesAuto_', intervalMin: 30, phi: true
  });
}

/** Returns {processed, summary, errors, errorMessages}; summary is counts only (no case IDs). */
function checkForRepliesAutoInner_() {
  try {
    var ss = getSS_();
    var rasloSheet = ss.getSheetByName(CONFIG.RASLO_SHEET);
    var trackerSheet = ensureSheet_(ss, CONFIG.THREAD_TRACKER_SHEET, ['Case ID', 'Thread ID', 'Type', 'Recipient', 'Date Sent']);
    if (!trackerSheet || !rasloSheet) return 0;

    var result = checkForRepliesInternal_(rasloSheet, trackerSheet);
    if (result.count > 0) {
      debugLog_('checkForRepliesAuto_', 'Captured ' + result.count + ' replies: ' + result.updated.join(', '));
    }
    if (result.orphaned.length > 0) {
      debugLog_('checkForRepliesAuto_', 'Orphaned case IDs: ' + result.orphaned.join(', '));
    }
    return {
      processed: result.count,
      summary: 'Captured ' + result.count + ' repl' + (result.count === 1 ? 'y' : 'ies') +
        (result.orphaned.length ? '; ' + result.orphaned.length + ' orphaned case ID(s)' : '')
    };
  } catch (e) {
    debugError_('checkForRepliesAuto_', e);
    return { processed: 0, errors: 1, errorMessages: [String(e && e.message || e)] };
  }
}