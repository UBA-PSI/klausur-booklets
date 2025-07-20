# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2025-01-XX

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