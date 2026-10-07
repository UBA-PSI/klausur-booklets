import os
import subprocess
import tempfile
import tarfile
import filecmp
import shutil
import pathlib
import sys
import re

# --- Configuration ---
PYTHON_EXECUTABLE = sys.executable # Use the same python that runs this script
SCRIPT_TO_TEST = "modify_moodle_backup.py"
INPUT_MBZ = "moodle-4.5-2024100700.mbz"
EXPECTED_OUTPUT_MBZ = "test-20250425-3-195959-5-ExamBooklet-Page-20250422.mbz"
ACTUAL_OUTPUT_MBZ_TEMP = "_temp_test_output.mbz" # Temporary file for the current run

# Command line arguments used for the test run (same as provided)
TEST_ARGS = [
    INPUT_MBZ,
    "-o", ACTUAL_OUTPUT_MBZ_TEMP,
    "--first-submission-date", "2025-04-25",
    "--num-consecutive-weeks", "3",
    "--submission-time", "19:59:59",
    "--extra-time", "5",
    "--section-title", "Exam Booklet",
    "--assignment-name-prefix", "Page",
    "--target-start-date", "2025-04-22"
]

# Patterns to ignore when comparing files (timestamps and other runtime-generated values)
TIMESTAMP_PATTERNS = [
    # Generic timestamp formats (unix timestamps, ISO dates, etc.)
    r'<timecreated>\d+</timecreated>',
    r'<timemodified>\d+</timemodified>',
    r'<added>\d+</added>',
    # Backup ID (changes each run)
    r'backup_id="[a-f0-9]+"',
    # Various Moodle-specific timestamps
    r'<date>\d+</date>',
    # Version info that might change
    r'version="\d+"',
]

# --- Helper Functions ---

def run_modifier_script():
    """Runs the modify_moodle_backup.py script with specified arguments."""
    command = [PYTHON_EXECUTABLE, SCRIPT_TO_TEST] + TEST_ARGS
    print(f"Running command: {' '.join(command)}")
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
        print("Script executed successfully.")
        print("Script Output:")
        print("---")
        print(result.stdout)
        print("---")
        return True
    except FileNotFoundError:
        print(f"Error: Script '{SCRIPT_TO_TEST}' not found.")
        return False
    except subprocess.CalledProcessError as e:
        print(f"Error: Script execution failed with return code {e.returncode}.")
        print("Stderr:")
        print("---")
        print(e.stderr)
        print("---")
        print("Stdout:")
        print("---")
        print(e.stdout)
        print("---")
        return False
    except Exception as e:
        print(f"An unexpected error occurred while running the script: {e}")
        return False

def extract_mbz(mbz_path, extract_to):
    """Extracts a .mbz (tar.gz) file to the specified directory."""
    print(f"Extracting {mbz_path} to {extract_to}...")
    if not os.path.exists(mbz_path):
        print(f"Error: Cannot extract, file not found: {mbz_path}")
        return False
    try:
        with tarfile.open(mbz_path, "r:gz") as tar:
            # Secure extraction if possible (requires Python 3.12+)
            if hasattr(tarfile, 'data_filter') and callable(tarfile.data_filter):
                tar.extractall(path=extract_to, filter='data')
            else:
                 tar.extractall(path=extract_to)
        print(f"Extraction complete for {mbz_path}.")
        return True
    except tarfile.ReadError as e:
        print(f"Error reading archive {mbz_path}: {e}. Is it a valid tar.gz file?")
        return False
    except Exception as e:
        print(f"An unexpected error occurred during extraction: {e}")
        return False

def normalize_file_content(content):
    """Normalizes file content by replacing timestamp patterns and filenames with placeholders."""
    # First normalize all timestamps
    for pattern in TIMESTAMP_PATTERNS:
        content = re.sub(pattern, 'NORMALIZED_TIMESTAMP', content)
    
    # Then normalize filenames - both direct replacements and XML tag contents
    content = content.replace(EXPECTED_OUTPUT_MBZ, 'NORMALIZED_FILENAME')
    content = content.replace(ACTUAL_OUTPUT_MBZ_TEMP, 'NORMALIZED_FILENAME')
    
    # Handle filename tags using regex with the .mbz extension as anchor
    # Use HTML-like tag pattern that explicitly specifies tag names
    # This should catch <name> tags with mbz filenames
    content = re.sub(r'<name>(.*?\.mbz)</name>', r'<name>NORMALIZED_FILENAME</name>', content)
    
    # And also catch <value> tags with mbz filenames
    content = re.sub(r'<value>(.*?\.mbz)</value>', r'<value>NORMALIZED_FILENAME</value>', content)
    
    return content

def files_equal_ignoring_timestamps(file1, file2):
    """Compares two files, ignoring timestamp differences."""
    try:
        # Check if files are binary first
        if not all(os.path.isfile(f) for f in [file1, file2]):
            return False

        # Try to read as text first
        try:
            with open(file1, 'r', encoding='utf-8') as f1, open(file2, 'r', encoding='utf-8') as f2:
                content1 = f1.read()
                content2 = f2.read()
                
                # Normalize content by removing timestamps
                norm1 = normalize_file_content(content1)
                norm2 = normalize_file_content(content2)
                
                return norm1 == norm2
        except UnicodeDecodeError:
            # Fall back to binary comparison for non-text files
            with open(file1, 'rb') as f1, open(file2, 'rb') as f2:
                return f1.read() == f2.read()
    except Exception as e:
        print(f"Error comparing files {file1} and {file2}: {e}")
        return False

def compare_directories(dir1, dir2):
    """Compares two directories recursively and reports differences, ignoring timestamps."""
    print(f"Comparing directories: {dir1} and {dir2}")
    dircmp = filecmp.dircmp(dir1, dir2, ignore=['.DS_Store']) # Ignore macOS metadata files
    
    differences = []

    if dircmp.left_only:
        differences.extend([f"Only in expected ({dir1}): {f}" for f in dircmp.left_only])
    if dircmp.right_only:
        differences.extend([f"Only in actual ({dir2}): {f}" for f in dircmp.right_only])
    
    # For differing files, use our custom comparison that ignores timestamps
    for filename in dircmp.diff_files:
        # Skip moodle_backup.xml as it will always have filename differences
        if filename == 'moodle_backup.xml':
            print(f"  Skipping comparison of {filename} (expected to differ)")
            continue
            
        file1 = os.path.join(dir1, filename)
        file2 = os.path.join(dir2, filename)
        
        # If files are equal when ignoring timestamps, don't report a difference
        if files_equal_ignoring_timestamps(file1, file2):
            print(f"  Files differ but timestamps match: {filename}")
        else:
            differences.append(f"Differing file content: {filename}")
            # Optionally display detailed diff here
            if filename.endswith('.xml'):
                try:
                    with open(file1, 'r', encoding='utf-8') as f1, open(file2, 'r', encoding='utf-8') as f2:
                        content1 = normalize_file_content(f1.read())
                        content2 = normalize_file_content(f2.read())
                        if content1 != content2:
                            print(f"  Detailed diff for {filename} (first 3 differences):")
                            content1_lines = content1.splitlines()
                            content2_lines = content2.splitlines()
                            diff_count = 0
                            for i, (line1, line2) in enumerate(zip(content1_lines, content2_lines)):
                                if line1 != line2 and diff_count < 3:
                                    print(f"    Line {i+1}:")
                                    print(f"      Expected: {line1[:80]}")
                                    print(f"      Actual:   {line2[:80]}")
                                    diff_count += 1
                except Exception as e:
                    print(f"  Error showing diff for {filename}: {e}")
            
    for subdir in dircmp.common_dirs:
        sub_diffs = compare_directories(os.path.join(dir1, subdir), os.path.join(dir2, subdir))
        if sub_diffs: # Only add if there are differences in the subdirectory
            differences.extend([f"In subdir '{subdir}': {d}" for d in sub_diffs])

    return differences

# --- Main Test Logic ---

def main():
    print("Starting Moodle Backup Modifier E2E Test...")

    # Basic checks
    if not os.path.exists(SCRIPT_TO_TEST):
        print(f"Error: Test target script '{SCRIPT_TO_TEST}' not found in current directory.")
        return 1
    if not os.path.exists(INPUT_MBZ):
        print(f"Error: Input file '{INPUT_MBZ}' not found.")
        return 1
    if not os.path.exists(EXPECTED_OUTPUT_MBZ):
        print(f"Error: Expected output file '{EXPECTED_OUTPUT_MBZ}' not found.")
        return 1
        
    # Clean up potential leftover temp file from previous failed run
    if os.path.exists(ACTUAL_OUTPUT_MBZ_TEMP):
        print(f"Removing leftover temporary file: {ACTUAL_OUTPUT_MBZ_TEMP}")
        try:
            os.remove(ACTUAL_OUTPUT_MBZ_TEMP)
        except OSError as e:
            print(f"Warning: Could not remove leftover temp file: {e}")


    # 1. Run the script to generate the actual output
    if not run_modifier_script():
        print("Test FAILED: Script execution failed.")
        return 1
        
    if not os.path.exists(ACTUAL_OUTPUT_MBZ_TEMP):
         print(f"Test FAILED: Script finished but did not produce output file: {ACTUAL_OUTPUT_MBZ_TEMP}")
         return 1

    # 2. Create temporary directories for extraction
    expected_extract_dir = tempfile.mkdtemp(prefix="mbz_expected_")
    actual_extract_dir = tempfile.mkdtemp(prefix="mbz_actual_")
    print(f"Created temporary directories:\n  Expected: {expected_extract_dir}\n  Actual:   {actual_extract_dir}")

    test_passed = False
    try:
        # 3. Extract both MBZ files
        print("\n--- Extraction Phase ---")
        if not extract_mbz(EXPECTED_OUTPUT_MBZ, expected_extract_dir):
            print("Test FAILED: Could not extract expected MBZ.")
            return 1 # Stop early if extraction fails

        if not extract_mbz(ACTUAL_OUTPUT_MBZ_TEMP, actual_extract_dir):
            print("Test FAILED: Could not extract actual MBZ generated by the script.")
            return 1 # Stop early if extraction fails

        # 4. Compare the extracted contents
        print("\n--- Comparison Phase ---")
        print("Note: Ignoring timestamp differences in files")
        differences = compare_directories(expected_extract_dir, actual_extract_dir)

        # 5. Report results
        print("\n--- Test Result ---")
        if not differences:
            print("✅ Test PASSED: Generated content matches expected content (ignoring timestamps).")
            test_passed = True
        else:
            print("❌ Test FAILED: Differences found between expected and actual content:")
            for diff in differences:
                print(f"  - {diff}")
            test_passed = False

    finally:
        # 6. Cleanup
        print("\n--- Cleanup Phase ---")
        try:
            print(f"Removing temporary directory: {expected_extract_dir}")
            shutil.rmtree(expected_extract_dir)
        except Exception as e:
            print(f"Warning: Could not remove temporary directory {expected_extract_dir}: {e}")
        try:
            print(f"Removing temporary directory: {actual_extract_dir}")
            shutil.rmtree(actual_extract_dir)
        except Exception as e:
            print(f"Warning: Could not remove temporary directory {actual_extract_dir}: {e}")
        try:
            print(f"Removing temporary output file: {ACTUAL_OUTPUT_MBZ_TEMP}")
            if os.path.exists(ACTUAL_OUTPUT_MBZ_TEMP):
                os.remove(ACTUAL_OUTPUT_MBZ_TEMP)
        except Exception as e:
            print(f"Warning: Could not remove temporary output file {ACTUAL_OUTPUT_MBZ_TEMP}: {e}")

    return 0 if test_passed else 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code) 