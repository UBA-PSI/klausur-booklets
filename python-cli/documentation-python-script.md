# Python MBZ Creator Script

The script `modify_moodle_backup.py` takes a Moodle backup, such as `src/mbz-templates/moodle-4.5-2024100700.mbz` and creates a *new* Moodle backup file (`.mbz`) containing all the individual page assignments tailored to your schedule and naming preferences.

*   **Open Terminal / Command Prompt:**
    *   **Windows:** Search for `cmd` or `PowerShell`.
    *   **Mac:** Open `Terminal` (Applications > Utilities).
    *   **Linux:** Open your terminal.
*   **Navigate to the Folder:** Use the `cd` command to go to the directory where `modify_moodle_backup.py` and the `.mbz` file are saved.
    ```bash
    cd path/to/your/files
    ```
*   **Run the Script:** Use the `python3` command (or `python` on some systems) followed by the script name and necessary parameters:

    ```bash
    python3 modify_moodle_backup.py moodle-4.5-2024100700.mbz -o <output_file.mbz> --section-title "Your Exact Section Name in Moodle" --target-start-date YYYY-MM-DD [Date Options] [Other Options]
    ```

    The script allows you to create multiple assignments in a batch. You can still edit the details and deadlines in Moodle later, but this involves a lot of clicking and can be errorprone.

    **Key Parameters Explained:**

    *   `moodle-4.5-2024100700.mbz`: The input template file (you may have to change this).
    *   `-o <output_file.mbz>`: **Required.** Specifies the name of the *new* Moodle backup file to be created (e.g., `-o Fall2024_BookletAssignments.mbz`).
    *   `--section-title "Your Exact Section Name"`: **Required.** Provide the *exact* title of the Moodle section you created in Step 3.1. Use quotes if the name has spaces. This tells Moodle where to put the assignments during import.
    *   `--target-start-date YYYY-MM-DD`: **Required.** This must match the start date of your **target Moodle course** where you'll import the assignments. This ensures that assignment due dates will be correctly preserved during import. The date format must be `YYYY-MM-DD` (e.g., `2024-09-01`).
    *   `--assignment-name-prefix "Prefix"`: (Optional, Default: `"Page"`). Sets the base name for assignments. The script adds a space and number (e.g., `"Page 1"`, `"Page 2"`). You could use `--assignment-name-prefix "Booklet Submission"` to get "Booklet Submission 1", etc. These names will be used for the assignments in Moodle.
    *   **Date Options (Choose ONE method):**
        *   **A) Weekly Schedule:** Use *both* `--first-submission-date` and `--num-consecutive-weeks`.
            *   `--first-submission-date YYYY-MM-DD`: Date of the *first* assignment deadline.
            *   `--num-consecutive-weeks N`: Total number of weekly assignments to create.
            *   *Example:* `--first-submission-date 2024-10-07 --num-consecutive-weeks 7` creates 7 assignments, due Oct 7, Oct 14, Oct 21, etc.
        *   **B) Specific Dates:** Use `--submission-dates` with a comma-separated list.
            *   `--submission-dates YYYY-MM-DD,YYYY-MM-DD,...`: List of exact due dates.
            *   *Example:* `--submission-dates 2024-10-07,2024-10-21,2024-11-04` creates 3 assignments due on those specific dates.
    *   **Common Time Options:**
        *   `--submission-time HH:MM:SS`: (Optional, Default: `"23:59:59"`). The time of day the assignment is due.
        *   `--extra-time minutes`: (Optional, Default: `60`). Grace period in minutes after the due time before the final cutoff.

*   **Full Example Command:**
    ```bash
    python3 modify_moodle_backup.py moodle-4.5-2024100700.mbz -o WI24_Booklets.mbz --section-title "Exam Booklet Pages" --target-start-date 2024-10-01 --assignment-name-prefix "Booklet Page" --submission-dates 2024-11-04,2024-11-18,2024-12-02,2024-12-16,2025-01-06,2025-01-20,2025-02-03 --submission-time 18:00:00 --extra-time 15
    ```
    *(This creates `WI24_Booklets.mbz` with 7 assignments named "Booklet Page 1" through "Booklet Page 7", placed in the "Exam Booklet Pages" Moodle section, using October 1, 2024 as the course start date, due on the specified dates at 6:00 PM, with a 15-minute cutoff grace period.)*

*   **Result:** The script will print progress messages and create the specified output `.mbz` file (e.g., `WI24_Booklets.mbz`) in the current folder.