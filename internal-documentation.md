
Okay, here's the developer documentation explaining the MBZ Batch Creator feature, its components, and the workflow after the recent refactoring:

## MBZ Batch Creator - Developer Documentation

This document outlines the architecture and workflow of the Moodle Backup (MBZ) Batch Assignment Creator feature within the Electron application. This feature allows users to take a template MBZ file containing one or more assignments and generate a new MBZ file with multiple assignments based on user-selected dates and naming conventions.

The backend logic has been recently refactored to use a standalone Node.js library (`src/mbz-creator`) which mirrors the functionality of a previously validated Python script (`modify_moodle_backup.py`).

### Core Components

1.  **UI / Renderer Process (`index.html` & `src/assets/calendar-ui-browser.js`)**
    *   **`index.html`:** Contains the modal (`#mbzBatchModal`) triggered by the `#batchCreateMbzBtn`. This modal includes:
        *   File input for the template MBZ (`#mbzTemplateFile`).
        *   Input for assignment name prefix (`#mbzNamePrefix`).
        *   Input for section title (`#mbzSectionTitle`, optional).
        *   Input for target course start date (`#mbzTargetStartDate`, optional, date picker).
        *   Time selectors for deadline hour/minute (`#mbzDeadlineHour`, `#mbzDeadlineMinute`).
        *   An embedded [Flatpickr](https://flatpickr.js.org/) calendar (`#calendar`) for selecting multiple assignment deadline dates.
        *   A preview table (`#dates-table`) showing generated assignment names and dates.
        *   A "Generate" button (`#generateMbzBtn`).
        *   Status/processing indicators.
    *   **`calendar-ui-browser.js` (`MbzBatchCreatorUI` class):** This script runs in the **renderer process**.
        *   It initializes the UI elements within the modal.
        *   It manages the Flatpickr instance and captures selected dates.
        *   It handles the "Select MBZ File" button click.
        *   When the "Generate" button is clicked (`generateBatchAssignments` method):
            *   It gathers all user inputs (template path, dates, time, prefix, section title, target start date).
            *   It formats these inputs into an `options` object.
            *   It calls `window.electronAPI.createBatchAssignments(options)` to trigger the backend logic via the preload script.
            *   It handles the success/error response from the main process to update the UI (e.g., show alerts, status messages).

2.  **Preload Script (`src/js/preload.js`)**
    *   Acts as the secure bridge between the renderer process (UI) and the main process.
    *   Uses `contextBridge.exposeInMainWorld` to expose specific functions under `window.electronAPI`.
    *   The relevant function is `createBatchAssignments`. When called from the renderer, it uses `ipcRenderer.invoke('mbz:createBatchAssignments', options)` to send the data asynchronously to the main process and wait for a response.
    *   It also exposes utility functions like `showOpenDialog`, `showMessageBox`, `pathBasename`, `pathDirname` used by the UI.

3.  **Main Process (`src/js/main.js`)**
    *   Handles overall application lifecycle, window creation, menus, etc.
    *   Listens for IPC messages from the renderer process.
    *   **`ipcMain.handle('mbz:createBatchAssignments', ...)`:** This is the crucial handler for the MBZ creation request.
        *   Receives the `incomingOptions` object from the renderer via IPC.
        *   **Adapts Options:** It transforms the `incomingOptions` into the format required by the backend library. This includes:
            *   Parsing/formatting dates.
            *   Generating the full list of assignment timestamps using `generateAssignmentDates` from `src/mbz-creator/lib/dateUtils.js`.
            *   Determining the final output path.
            *   Calculating the `targetStartTimestamp` (UTC seconds) if a date was provided.
        *   **Calls Backend:** It calls `await modifyMoodleBackup(adaptedOptions)` from `src/mbz-creator/lib/mbzCreator.js`. **This is critical because file system operations, archive handling (`tar`), and potentially CPU-intensive XML manipulation happen here, preventing the UI (renderer process) from freezing.**
        *   **Handles Result:** It catches success or errors from `modifyMoodleBackup`.
        *   **Sends Response:** It returns a result object (`{ success: true/false, outputPath?, message? }`) back to the renderer process via the resolved `invoke` promise.

4.  **MBZ Creator Library (`src/mbz-creator/lib/`)**
    *   This is the core Node.js backend logic, completely decoupled from Electron specifics.
    *   **`mbzCreator.js` (`modifyMoodleBackup` function):** Orchestrates the entire MBZ modification workflow, mirroring the tested Python script. It calls functions from other modules within this library.
    *   **`archive.js`:** Handles extracting (`.tar.gz`) and creating (`.tar.gz`) MBZ archives using the `tar` library.
    *   **`idUtils.js`:** Extracts existing IDs (max IDs, section ID, backup ID) from various XML files within the extracted archive.
    *   **`fileHelpers.js`:** Contains utility functions like deleting dotfiles (`deleteDotfiles`) and finding template files (`findAssignmentTemplates`).
    *   **`assignmentFiles.js`:** Handles the creation of new assignment XML files (`createNewAssignmentFiles`) based on templates and modification of existing assignment files (`modifyAssignment`).
    *   **`manifest.js`:** Updates the main manifest files (`section.xml`, `moodle_backup.xml`) with new sequences, titles, activities, settings, etc.
    *   **`dateUtils.js`:** Parses date/time strings (treating them as UTC) and generates the list of assignment date/time objects (with UTC timestamps) based on user options.

5.  **CLI (`bin/modify-mbz-js`)** (Optional Interface)
    *   Provides a command-line interface to the core library.
    *   Uses `yargs` to parse arguments mirroring the Python script's options.
    *   Calls the same `modifyMoodleBackup` function as the Electron main process, demonstrating the reusability of the `mbz-creator` library.

### Workflow Summary (Generate Button Click)

1.  **UI (`calendar-ui-browser.js`):** User clicks "Generate". Event listener gathers data from form elements (file path, dates, time, prefix, title, start date).
2.  **UI -> Preload:** `window.electronAPI.createBatchAssignments(options)` is called.
3.  **Preload -> Main:** `ipcRenderer.invoke('mbz:createBatchAssignments', options)` sends data.
4.  **Main (`main.js`):** `ipcMain.handle` receives `options`.
5.  **Main:** Adapts options (generates assignment dates/timestamps using `dateUtils.js`, sets output path).
6.  **Main -> Backend Lib:** Calls `await modifyMoodleBackup(adaptedOptions)`.
7.  **Backend Lib (`mbzCreator.js` & others):** Executes the full modification process (extract, read IDs, read templates, modify/create files, update manifests, pack archive) using Node.js APIs. This happens *asynchronously* but *within* the main process.
8.  **Backend Lib -> Main:** `modifyMoodleBackup` returns (or throws error).
9.  **Main:** `ipcMain.handle` catches result/error, creates response object.
10. **Main -> Preload:** Response object is returned via the `invoke` promise.
11. **Preload -> UI:** Promise resolves in `calendar-ui-browser.js`.
12. **UI:** Updates status message/shows alert based on the success/failure response.

This architecture ensures that the UI remains responsive while the potentially long-running MBZ processing occurs safely in the main process.
