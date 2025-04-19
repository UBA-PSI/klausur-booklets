# Booklet Tool

An Electron application developed at the [Chair of Privacy and Security in Information Systems](https://www.uni-bamberg.de/psi/), University of Bamberg, designed to help instructors create personalized exam aids ("Klausur-Booklets") from student submissions.

This tool facilitates the "Klausur-Booklet" incentive system as described at [www.uni-bamberg.de/psi/teaching/booklet-tool/](https://www.uni-bamberg.de/psi/teaching/booklet-tool/). Students submit note pages regularly during the semester, and instructors use this tool to compile these submissions (along with generated cover sheets) into printed A5 booklets allowed during the final exam.

## Features

- Processes individual student PDF submissions.
- Generates cover sheets indicating student information and missing submissions.
- Merges cover sheets and submitted pages into complete, personalized booklets.
- Creates print-ready A5 booklets with correct imposition.
- Optionally generates Moodle Backup (MBZ) files to easily create corresponding assignment activities in Moodle.

## Requirements (for the Electron App)

- **Node.js:** Version 16.x or later.
- **Operating System:** macOS, Windows, or Linux (Builds are provided).

*(Note: Python is NOT required to run the packaged Electron application.)*

## Setup & Running (for Development)

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url> # Replace with actual URL
    cd booklet-tool
    ```

2.  **Install Node.js Dependencies:**
    ```bash
    npm install
    ```

3.  **Run the Application:**
    ```bash
    npm start
    ```

## Building for Distribution

To create distributable packages for macOS, Windows (portable), and Linux (AppImage):

```bash
npm run build
```

This command will:
1.  Build the platform-specific application bundles in the `dist/` directory.
2.  Create a `dist/booklet-tool-testdata.zip` file containing sample input PDFs for testing the tool's functionality. Unzip this file and use the contained folders/files as input within the Booklet Tool.

## Configuration

PDF processing settings (like DPI) can be adjusted via the Settings button within the application.

## Standalone Python MBZ Modifier (Optional)

This repository also contains a standalone Python script for modifying Moodle Backup (MBZ) files, located in the `python-cli/` directory. This script provides similar functionality to the MBZ creation feature within the Electron app but runs directly from the command line.

- **Script:** `python-cli/modify_moodle_backup.py`
- **Test:** `python-cli/test_modify_moodle.py`

This Python tool is independent of the Electron application and does not require Node.js or the Electron environment. It uses only standard Python libraries and does not have external dependencies (no `requirements.txt` needed).

To use it, run directly with Python 3.7+:
```bash
python3 python-cli/modify_moodle_backup.py --help
```

## License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Author

Dominik Herrmann (dh.psi@uni-bamberg.de)
Chair of Privacy and Security in Information Systems
University of Bamberg 