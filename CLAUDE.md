# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies (runs electron-builder install-app-deps as postinstall)
npm start            # Run the Electron app in dev mode
npm run lint         # ESLint (flat config, eslint.config.js)
npm run test:mbz     # Run MBZ modifier tests (Node assert, needs sample.mbz in project root)
npm run build        # Build platform-specific distributable (uses dotenv + electron-builder)
npm run build:ci     # Trigger GitHub Actions workflow for Windows/Linux builds
npm run pdf-process  # Run PDF command-line processor standalone
```

Cross-platform sharp installs: `npm run sharp:win`, `npm run sharp:linux-x64`, `npm run sharp:linux-arm64`.

## Architecture

**Electron desktop app** (Booklet Tool) for creating personalized exam booklets from student PDF submissions. Built at University of Bamberg (PSI chair). All processing is local — no network requests.

### Process Model

- **Main process** (`src/js/main.js`): File I/O, PDF processing orchestration, config management, IPC handlers. This is the largest file (~2200 lines) and contains most business logic.
- **Renderer process** (`src/js/renderer.js`): UI state, user interaction handling, Bootstrap-based UI.
- **Preload** (`src/js/preload.js`): Context-isolated bridge exposing `window.electronAPI` with typed IPC channels.

IPC flow: Renderer calls `window.electronAPI.startTransformation(...)` → `ipcRenderer.invoke` → main process handler → progress updates via `ipcRenderer.on('transformation-progress', ...)`.

### PDF Processing Pipeline (Three Stages)

1. **Transform** (`main.js` + `pdf-cmdline-processor.js` + `pdf-renderer-external.js`): Convert student submissions (PDF/HEIC/JPG/PNG) to standardized A5 PDFs at configurable DPI. Uses external Ghostscript (primary) or PDFium WASM (fallback via `@hyzyla/pdfium`).
2. **Merge** (`pdf-merger.js`): Generate markdown-based cover sheets (with fontkit/Roboto for Unicode), then merge cover + student pages into per-student PDFs using pdf-lib.
3. **Booklet** (`pdf-merger.js: createSaddleStitchBooklet`): Saddle-stitch imposition — reorders pages for double-sided A4 printing of A5 booklets.

### MBZ Modifier (Moodle Backup Modification)

Modifies an existing Moodle backup (.mbz) exported from a course: updates assignment names, deadlines, and metadata without creating new assignments.

Backend library in `src/mbz-creator/lib/`:
- `mbzCreator.js` — orchestrator with two entry points: `parseAssignmentsFromMbz()` (discover assignments) and `modifyMoodleBackup()` (apply changes and repack)
- `manifest.js` — Moodle backup XML manipulation (section sequence, backup ID, start date)
- `assignmentFiles.js` — parse and modify individual `assign.xml` files (name, duedate, cutoffdate, activation)
- `dateUtils.js` — local-time date parsing, Unix timestamp conversion, `computeAssignmentTimestamps()` (timestamp grouping with chain/fixed open modes, grace period)
- `idUtils.js` — extract section/module/backup IDs from `moodle_backup.xml`

UI in `src/assets/batch-creator.js` + `src/mbz_creator.html`: file picker → editable assignment table with calendar → timestamp preview → save modified MBZ.

### Student Folder Name Parsing

Supports multiple LMS folder naming conventions (configured in settings):
- **Moodle**: `FULLNAMEWITHSPACES_SOMENUMBER_assignsubmission_file_`
- **ILIAS**: `FIRSTNAME_LASTNAME_USERNAME_STUDENTNUMBER`
- Custom regex patterns

Name collision resolution uses Moodle Grading Worksheet CSVs (parsed with csv-parse).

### Config

Saved to platform-specific paths (`config.json`):
- macOS: `~/Library/Application Support/Booklet Tool/`
- Windows/Linux: portable `config/` or Electron userData directory

## Code Style

ESLint flat config: 4-space indent, single quotes, unix linebreaks, semicolons required. `no-unused-vars` is warn-level.

## Key Dependencies

- **pdf-lib** — PDF creation/manipulation (cover sheets, merging, booklet imposition)
- **sharp** — image processing/validation (ASAR-unpacked for native bindings)
- **Ghostscript** (external binary) — primary PDF renderer; bundled on macOS/Windows, system-installed on Linux
- **@hyzyla/pdfium** — WASM-based PDF renderer (fallback); WASM file ASAR-unpacked
- **fontkit** — font loading for Unicode support in cover sheets (Roboto fonts in `src/assets/fonts/`)
- **csv-parse** — sync CSV parsing for grading worksheet import

## Build & Release Notes

- macOS builds require Apple notarization credentials in `.env` (APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD)
- sharp and pdfium WASM are listed in `asarUnpack` — they need filesystem access outside the ASAR archive
- Windows/Linux builds are done via GitHub Actions (`npm run build:ci`), macOS is built locally
- `python-cli/` contains an independent Python MBZ modifier tool (no Node.js dependency)
