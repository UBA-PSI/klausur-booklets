# Changelog

All notable changes to this project will be documented in this file.

## [1.6.0] - 2026-02-18

- [NEW] **MBZ Modifier (replaces MBZ Creator)**: Rebuilt as a modifier that takes an existing Moodle backup and lets you adjust all assignments at once, instead of generating a new backup from scratch. Load any `.mbz` file, and the tool discovers all assignment activities inside it.
- [NEW] **Timestamp grouping**: Assignments on the same date are grouped automatically. The preview table shows all computed open/due/cutoff timestamps before saving.
- [NEW] **Open modes (Chain / Fixed)**: Choose whether each assignment opens when the previous one closes (Chain) or a fixed number of days before its own deadline (Fixed).
- [NEW] **Rename All**: Enter a prefix (e.g., "Page") and apply sequential names ("Page 1", "Page 2", ...) to all assignments in one click.
- [NEW] **Timestamp preview table**: Expandable section showing all computed activation, due, and cutoff timestamps before saving.
- [FIXED] **UTC timezone bug**: Times entered in the MBZ Modifier were interpreted as UTC, causing deadlines to appear shifted (e.g., 1 hour later in CET) after import into Moodle. All date handling now uses local time consistently.
- [IMPROVED] Extracted shared helpers, removed redundant button-disable logic, simplified code (~240 lines removed).
- [IMPROVED] Comprehensive test coverage for timestamp computation and MBZ roundtrip (parse, modify, re-parse).
- [IMPROVED] Documentation rewritten to match the new MBZ Modifier workflow. CLI tools (`bin/modify-mbz-js`, `python-cli/`) deprecated in favor of the GUI.

## [1.5.0] - 2026-02-16

- [SECURITY] **Electron upgrade 35 to 39**: Fixes critical CVEs (CVE-2025-10585, CVE-2025-55305, CVE-2026-0628) and adds macOS Tahoe compatibility. Removed deprecated `@electron/remote` dependency.
- [NEW] **Abort button**: Processing steps (Convert, Merge, Booklets) can now be canceled mid-operation. Already-completed files are kept. The abort button appears in the status bar during processing.
- [NEW] **Button disabling during processing**: All action buttons are disabled while a processing step is running, preventing accidental double-clicks or conflicting operations.
- [NEW] **Progress indicator for all steps**: The status bar now shows progress (x/y and percentage) during all three processing steps, including Merge PDFs and Create Booklets.
- [NEW] **Detailed merge log output**: The Merge PDFs step now shows detailed progress in the process log (previously only visible on the console).
- [FIXED] **Booklet crash with blank pages**: Fixed "Can't embed page with missing Contents" error when PDFs were padded to multiples of 4 with blank pages.
- [IMPROVED] **IPC safety**: All renderer IPC sends now check for destroyed webContents, preventing crashes when the window is closed during processing.
- [IMPROVED] **XSS hardening**: User-controlled content in the collision modal is now HTML-escaped.
- [IMPROVED] Code simplification: extracted shared helpers, deduplicated Unicode character map (~70 lines), simplified fallback chains, removed dead code (-240 lines net).

## [1.4.0] - 2026-02-15

- [NEW] **Configurable minimum margin**: The minimum margin for student PDFs can now be configured in Settings (default: 3.5 mm, set to 0 to disable). Pages with content extending into the margin zone are automatically scaled down to enforce the minimum margin.
- [NEW] **Pad to multiple of 4**: New setting to pad merged PDFs with blank pages so the total page count is a multiple of 4, ready for saddle-stitch booklet printing without manual adjustment.
- [NEW] **Booklet number on cover sheet**: Each cover sheet now shows its sequential booklet number (001, 002, ...) in the top-right corner at 24 pt bold for easier sorting after printing.
- [FIXED] **TXT summary column alignment with umlauts**: Fixed misaligned columns in the page summary TXT file when student names contain umlauts or other multi-byte characters. Now uses NFC normalization for correct visual width calculation.

## [1.3.0] - 2026-02-14

- [NEW] **Smart margin enforcement**: Automatically detects pages with content extending to the edge (borderless) and scales them down to enforce a minimum margin. Pages that already have sufficient margins are left untouched, preserving original quality and file size. Uses the existing Sharp image buffer in the transform pipeline — no additional rendering overhead.
- [NEW] **Page count summary**: Generates `page-summary.txt` (with CRLF line endings for Windows) and `page-summary.xlsx` alongside the merged PDFs. Lists per-student page counts, A4 pages/sheets needed for saddle-stitch booklet printing, and totals.
- [NEW] Added `node-xlsx` dependency for XLSX summary generation.

## [1.2.1] - 2026-02-07

- [IMPROVED] Removed bundled Ghostscript binaries (~39 MB smaller). Ghostscript must now be installed separately on all platforms.
- [IMPROVED] Default PDF renderer changed to PDFium WASM (built-in). Ghostscript is opt-in for users who install it.
- [NEW] Startup banner recommending Ghostscript installation when using the built-in PDFium renderer.
- [NEW] "Why Ghostscript?" section in README explaining renderer differences.
- [IMPROVED] Settings UI: replaced "Bundled Version" with "System PATH" option, added platform-specific installation instructions.
- [IMPROVED] Added ability to open external links in system browser.

## [1.2.0] - 2026-02-07

- [NEW] **ILIAS ZIP Export Support**: Added automatic detection and preprocessing of ILIAS ZIP exports. Supports both per-assignment format (one ZIP per exercise with all students) and per-student format (one ZIP per student with all assignments). Simply place downloaded ZIP files in the input directory—the tool automatically detects the format and restructures submissions for processing.
- [NEW] Settings UI documentation explaining ILIAS download options and workflow.
- [FIXED] **ILIAS missing pages detection**: Fixed missing pages detection for ILIAS ZIP exports. The preprocessor now ensures all page/assignment directories are created (including empty ones), and the temporary directory is preserved until after the merging phase completes. This enables accurate detection of missing student submissions on booklet cover sheets.
- [SECURITY] **ZIP bomb protection**: Size validation now uses ZIP header metadata instead of decompressing files, preventing memory exhaustion from malicious archives. Added compression ratio check.
- [SECURITY] **Path traversal hardening**: Replaced string-based path traversal check with resolve-based containment verification, including checks at all file extraction points.
- [FIXED] **Partial ZIP failure handling**: ILIAS preprocessing now fails explicitly when any ZIP file cannot be processed, instead of silently continuing with incomplete data.
- [FIXED] **Race condition in ambiguity resolution**: Fixed premature cleanup of ILIAS temp directory during ambiguity resolution that could cause missing pages detection to fail during merging.

## [1.1.0] - 2025-09-10

- [NEW] **External PDF renderer support**: Added configurable PDF rendering system with support for both bundled Ghostscript and system-installed Ghostscript. Users can now specify custom Ghostscript paths for better compatibility across different environments. By default, Ghostscript replaces the PDFium-based renderer that could not parse some esoterical files.
- [NEW] **Linux compatibility**: Enhanced Ghostscript detection and configuration on Linux systems with automatic fallback options and clear user guidance when Ghostscript is not found.
- [NEW] Added renderer information display during PDF processing to show which rendering engine and version is being used.
- [NEW] Settings interface for configuring PDF renderer preferences including bundled vs system Ghostscript selection.
- [IMPROVED] PDF renderer handles incorrectly built oversized PDFs (larger than A4) when rendering pages.
- [IMPROVED] Better error handling and user feedback for PDF rendering issues with detailed troubleshooting information.

## [1.0.3]

- [FIXED] **Sorting issue**: Pages are now sorted numerically instead of lexicographically. This fixes the major issue where pages were incorrectly ordered as "1, 10, 11, 2" instead of "1, 2, 10, 11". The fix applies to PDF merging order, missing pages lists, and cover sheet displays. Supports all naming conventions including prefixed names like "Page 1", "Seite 2", etc.

## [1.0.2]

- [FIXED] Folder name parsing bug where patterns starting with FULLNAMEWITHSPACES failed to detect underscore separator, causing incorrect student grouping and name splitting.
- [FIXED] Added support for Moodle folder names ending with "assignsubmission_file" (without trailing underscore) in addition to the existing "_assignsubmission_file_" format.
- [IMPROVED] Updated default Moodle pattern and settings dialog documentation to clarify that trailing underscore is optional.
- [IMPROVED] Changed default Moodle format to use "FULLNAMEWITHSPACES_SOMENUMBER_assignsubmission_file" (without trailing underscore) to match folder structures (apparently this was changed in a recent Moodle update).
- [FIXED] Unicode character encoding error when generating cover sheets for students with non-ASCII characters (like umlauts) in their names. Now uses Roboto fonts with full Unicode support via fontkit library, with automatic fallback to character sanitization if fonts can't be loaded.
- [FIXED] Added Roboto fonts to asarUnpack configuration to ensure they're available in built Electron applications and improved font path resolution for both development and production environments.
- [IMPROVED] Added filename sanitization for output PDFs to prevent filesystem issues with non-ASCII characters while preserving readability (e.g., "ä" becomes "ae").
- [IMPROVED] Added automatic numbering system for PDF filenames: students are sorted by last name and numbered sequentially (001, 002, 003, etc.) for easier organization.
- [FIXED] Improved filename sanitization to properly handle German umlauts and other Unicode characters with correct ASCII replacements.
- [FIXED] Added Unicode normalization (NFC) to convert combining diacritical marks (like U+308 combining diaeresis) to composed characters (like ä U+E4) for proper display in cover sheets and filename handling.
- [FIXED] Applied Unicode normalization to page names and filenames in submitted/missing pages lists on cover sheets to fix display issues with non-ASCII characters in directory and file names.

## [1.0.1] - 2025-04-21

- Release of Windows (x64) and Linux (x64 and arm64) versions.
- Version number display and "More Info" button have been added. 
- More detailed logging output during merging.

- [FIXED] Import Config and Export Config buttons did not work.
- [FIXED] Grace Period in MBZ creator was not honoured.

- [KNOWN LIMITATION] Automatic saving of Settings does not work on Windows. Workaround: Use Export and Import Settings for manual saving.

## [1.0.0] - 2025-04-20

- Initial Release of the Booklet Tool (macOS)
- booklet-tool-testdata.zip contains dummy submissions to test the Booklet generation. Extract it and set the folder as input directory.