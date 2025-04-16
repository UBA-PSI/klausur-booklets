# PSI PDF Merger Tool

An Electron application for merging student PDF submissions with cover sheets for exams.

## Features

- Transform PDF pages to a standard format
- Generate cover sheets with student info and missing pages
- Merge PDFs into complete exam booklets
- Create print-ready booklets with proper pagination

## Requirements

- Node.js (16.x or later)
- Python 3.7 or later
- pdfimpose (for booklet creation)

## Quick Start

For development, run:

```bash
./start.sh
```

This script will:
1. Create a Python virtual environment if needed
2. Install Python dependencies
3. Install Node.js dependencies
4. Start the application

## Manual Setup

### Python Environment

```bash
# Create a virtual environment
python -m venv venv

# Activate the environment
source venv/bin/activate  # On Unix/macOS
# OR
.\venv\Scripts\activate  # On Windows

# Install dependencies
pip install -r requirements.txt
```

### Node.js Dependencies

```bash
npm install
```

### Running the Application

```bash
npm start
```

## Building for Distribution

To create distributable packages:

```bash
npm run build
```

This will create platform-specific packages in the `dist` directory.

## Project Structure

- `src/js/` - JavaScript application code
- `src/python/` - Python transformation scripts
- `src/assets/` - CSS and other assets
- `src/legacy/` - Older versions (not used in current build)

## Configuration

DPI settings for PDF transformation can be configured via the Settings button in the application.

## License

[MIT](LICENSE) 