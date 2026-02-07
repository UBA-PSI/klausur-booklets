# ILIAS Test Data

This directory contains test data for ILIAS ZIP export functionality.

## Generating Test ZIPs

Run the generator script to create test ZIP files:

```bash
node testdata/ilias/generate-test-zips.js
```

This will create three test directories with different scenarios:

## Test Cases

### 1. Per-Assignment Format (`per-assignment/`)

**Format:** One ZIP per exercise containing all students' submissions.

**Files:**
- `Seite 2.zip`, `Seite 3.zip`, `Seite 4.zip`, `Seite 5.zip`, `Seite 10.zip`

**Students:**
- Alice Zephyr (azephyr, 901234)
- Bob Quantum (bquantum, 902345)
- Charlie Nexus (cnexus, 903456)

**Missing Submissions:**
- Bob Quantum has NO submission for `Seite 3`

**Expected Results:**
- ✅ Format detected as `per-assignment`
- ✅ Bob's booklet should show "Missing: Seite 3"
- ✅ Page order in PDFs: Seite 2, 3, 4, 5, 10 (NOT 10, 2, 3, 4, 5!)
- ✅ All students should have pages in correct numerical order

### 2. Per-Assignment with Alternative Names (`per-assignment-alt-names/`)

**Format:** Tests that the tool works with different page naming conventions.

**Files:**
- `Exercise 2.zip`, `Exercise 3.zip`, `Exercise 10.zip`, `Aufgabe 1.zip`, `Übung 5.zip`

**Missing Submissions:**
- Alice Zephyr has NO submission for `Exercise 10`
- Charlie Nexus has NO submission for `Übung 5`

**Expected Results:**
- ✅ Format detected as `per-assignment`
- ✅ Alice's booklet should show "Missing: Exercise 10"
- ✅ Charlie's booklet should show "Missing: Übung 5"
- ✅ Page order should be natural sorted: Aufgabe 1, Exercise 2, 3, 10, Übung 5

### 3. Per-Student Format (`per-student/`)

**Format:** One ZIP per student containing all their assignments.

**Files:**
- `Zephyr_Alice_azephyr_901234.zip`
- `Quantum_Bob_bquantum_902345.zip`
- `Nexus_Charlie_cnexus_903456.zip`

**Pages in each ZIP:**
- Seite 2, 3, 4, 5, 10

**Missing Submissions:**
- Alice Zephyr has NO submission for `Seite 4` (folder exists but empty)
- Bob Quantum has NO submissions for `Seite 5` and `Seite 10` (folders exist but empty)

**Expected Results:**
- ✅ Format detected as `per-student`
- ✅ Alice's booklet should show "Missing: Seite 4"
- ✅ Bob's booklet should show "Missing: Seite 5, 10"
- ✅ All student ZIPs should contain ALL page folders (even empty ones)
- ✅ Page order: Seite 2, 3, 4, 5, 10

## Verifying Results

After processing with the Booklet Tool:

1. **Check Format Detection:**
   - Look at the logs during "Convert to PDFs"
   - Should see: "Detected ILIAS format: per-assignment" or "per-student"

2. **Check Page Order in Merged PDFs:**
   - Open `output/pdfs/001_901234.pdf` (Alice)
   - Pages should be in order: cover, 2, 3, 4, 5, 10
   - Each page should show the correct number in large font

3. **Check Missing Pages on Cover Sheet:**
   - Alice (per-assignment): none missing
   - Bob (per-assignment): should show "Seite 3"
   - Alice (per-student): should show "Seite 4"
   - Bob (per-student): should show "Seite 5, 10"

4. **Check Booklet Order:**
   - Booklets will have pages rearranged for saddle-stitch printing
   - This is EXPECTED behavior for the booklet format

## Test Data Structure

```
testdata/ilias/
├── README.md                          (this file)
├── generate-test-zips.js              (generator script)
├── per-assignment/                    (TC1.1 + TC2.2)
│   ├── Seite 2.zip
│   ├── Seite 3.zip
│   ├── Seite 4.zip
│   ├── Seite 5.zip
│   └── Seite 10.zip
├── per-assignment-alt-names/          (TC1.1 variant)
│   ├── Aufgabe 1.zip
│   ├── Exercise 2.zip
│   ├── Exercise 3.zip
│   ├── Exercise 10.zip
│   └── Übung 5.zip
└── per-student/                       (TC1.2 + TC3.2)
    ├── Zephyr_Alice_azephyr_901234.zip
    ├── Quantum_Bob_bquantum_902345.zip
    └── Nexus_Charlie_cnexus_903456.zip
```

## Notes

- Student names are **completely fictional** and randomly generated
- Each PDF contains a large page number for easy visual verification
- PDFs are minimal (one page each) to keep file sizes small
- The tool should automatically detect the correct format based on ZIP filenames
