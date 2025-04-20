# Booklet Tool: Instructor Guide

**Important Note:** This guide describes the workflow specifically for the Moodle instance as configured at the **University of Bamberg**. While the general principles might apply elsewhere, details may differ significantly in other Moodle installations.

For the **Ilias** learning platform, the overall process of collecting pages and generating booklets is similar, but currently lacks the automated assignment creation workflow described here.

## 1. Purpose and Overview

This guide explains how to set up and manage student submissions for multi-page "Booklets" using Moodle. This tool facilitates the "Klausur-Booklet" incentive system as described at [www.uni-bamberg.de/psi/teaching/booklet-tool/](https://www.uni-bamberg.de/psi/teaching/booklet-tool/). Students submit note pages regularly during the semester, and instructors use this tool to compile these submissions (along with generated cover sheets) into printed A5 booklets allowed during the final exam.

**The Problem:** Encouraging students to engage actively with course material through regular note-taking can be challenging. Traditional methods might not provide enough incentive or structure.

**The Solution:** This system allows instructors to set up Moodle assignments to collect individual booklet pages from students throughout the semester. At the end, you (the instructor) can easily download all submitted pages per student and use the **Booklet Tool** desktop application to compile these pages into a single, printable A5 booklet for each student. These booklets can then serve as personalized learning aids, potentially even for use during exams (as per your course rules).

**Workflow Summary:**

1.  **Initial Setup (Once per Course):** Create a dedicated section in your Moodle course for the booklet assignments, titled, for instance "Exam Booklet Pages".
2.  **Generate Assignments:** Pages are due at certain deadlines during the semester. For every page, we use one Moodle "Assignment" Activity that will be configured to allow students to upload a single image or PDF file up to a certain deadline. With the provided Python script (`modify_moodle_backup.py`) you can automate the creation of these individual assignment (e.g. 14 assignments, one per week of a 14-week semester). The script creates a Moodle backup file (`.mbz`) containing all the individual page assignments with specific deadlines.
3.  **Import into Moodle:** Restore the generated `.mbz` file into your Moodle course to add the assignments to the dedicated section you created in Step 1.
4.  **Instruct Students:** Provide clear guidelines on content, format (e.g., strictly only handwritten), technical details (PDF, JPG, PNG; students should rotate and crop images on their smartphone before uploading) and how to submit each page to the correct Moodle assignment.
5.  **Download Submissions:** After deadlines pass, download all submitted files from each assignment using Moodle's "Download all submissions" feature. You will get one ZIP file per deadline.
6.  **Generate Booklets:** Use the **Booklet Tool**, feeding it the folder containing all downloaded submissions to create the final printable A5 booklets.

## 2. Prerequisites

To use this tool, ensure you have teacher or editing permissions in the target Moodle course.

## 3. Step-by-Step Workflow

### Step 3.0: Understanding the Two Approaches to Setting Up Booklet Assignments

There are two ways to set up the multiple assignment activities needed for booklet page submissions in Moodle:

#### Manual Approach

You can create the assignment activities manually in Moodle:

1. **Create and Configure One Template Assignment:**
   * In your Moodle course, turn on editing
   * Add a new Assignment activity to your booklet section
   * Configure it with these recommended settings:
     * Set allowed file types to: `jpg,jpeg,png,pdf`
     * Limit submissions to 1 file
     * Set maximum file size (e.g., 20 MB)
     * Set appropriate due date, cutoff date, and allowsubmissionsfrom date
     * **Important:** Enable "Offline grading worksheet" in the Feedback types section
     * Configure other settings as needed for your course
   * Save the assignment

2. **Duplicate and Modify:**
   * With editing on, locate the "Duplicate" option for your template assignment
   * Duplicate it as many times as needed (e.g., 14 times for a 14-week semester)
   * For each duplicate:
     * Edit the name to include an incremented number (e.g., "Page 1", "Page 2", etc.)
     * Adjust the due dates appropriately
     * Save changes

While this approach works, it involves a significant amount of clicking and can be time-consuming and error-prone, especially when adjusting multiple deadlines.

#### Automated Approach (Recommended)

This guide primarily focuses on the automated approach using **Booklet Tool**, which:

* Creates a properly formatted Moodle backup (`.mbz`) file containing all assignments at once
* Sets all due dates, cutoff dates, and activation dates automatically
* Ensures consistent naming and configuration across all assignments
* Enables offline grading worksheets automatically

**Prerequisites for the automated approach:**

* You must have permission to restore course backups in your Moodle instance
* You need to create a dedicated section in your course with a specific title (Step 3.1)
* You need to know your Moodle course's start date, and ideally it should be configured to start at midnight (00:00)

The following steps will guide you through this recommended automated approach.

### Step 3.1: Initial Moodle Course Setup (Once per Course)

*   Go to your Moodle course page.
*   Turn Editing On.
*   Add a new **Course Section**.
*   Give this section a clear, descriptive name (e.g., "Exam Booklet Pages", "Weekly Portfolio Submissions", "Lab Report Chapters").
*   **CRITICAL:** Note down the **exact name** of this section. You'll need it precisely for the script in the next step.
*   **IMPORTANT:** Note the **Course Start Date** in your Moodle course settings. You will need this exact date for the script in the next step. For assignments to appear with the correct deadlines, ensure your Moodle course start date is set to **00:00 (midnight)** of the selected day. If your course uses a different start time, the assignment deadlines may not align correctly.

### Step 3.2: Generate Moodle Assignments with the Booklet Tool

In the Booklet Tool, click on the button **Go to Moodle Assignment Creation** in the top right corner. Enter the requested pieces of information and create the MBZ backup file for Moodle. Store it on your machine.


### Step 3.3: Import Assignments into Moodle

Upload the `.mbz` file generated by the tool into your Moodle course.

*   In your Moodle course, go to "Course administration" (often a gear icon ⚙️) > "Restore".
    * At University of Bamberg (VC): In a course, click on **More** in the course's top menu, then click on **Course reuse**, then click on **Restore**.
*   Upload the `.mbz` backup file created in Step 3.2 (e.g., `WI24_Booklets.mbz`). **Do NOT upload `sample.mbz`**.
*   Follow the Moodle restore prompts carefully:
    *   **Destination:** Choose "Restore into this course".
    *   **Import Type:** Select **"Merge the backup course into this course"**. This is crucial to add the assignments without deleting existing content.
    *   **Settings:** Ensure "Include activities and resources" is enabled. Review other settings as needed (typically no further changes needed, follow the workflow until the Restoration starts).
    *   **Preview:** You will see the assignments that are to be added to the course and the name of the Section you provided to the python script.
    *   Proceed through the confirmation and perform the restore.
*   **Verify:** Go to the course section you specified (e.g., "Exam Booklet Pages"). You should now see all the assignments ("Booklet Page 1", etc.) listed with the correct names and due dates.

### Step 3.4: Instruct Your Students

Clear instructions are essential for student success and to ensure the Booklet Generator can process the files correctly. Provide guidelines covering:

*   **Purpose:** Explain *why* they are creating these pages (active learning, exam aid, portfolio, etc.) and that the final product will be a printed A5 booklet.
*   **Content:**
    *   Encourage them to include material they deem useful (key concepts, formulas, diagrams, summaries). This requires critical thinking about compression and clarity.
    *   Explain that the process itself (selecting, compressing, writing) is a valuable learning activity.
*   **Format Requirements (rules typically used at PSI Chair, feel free to adapt to fit your pedagogical concept):**
    *   **Handwritten ONLY:** All content on every page *must* be in the student's own handwriting (paper or tablet).
    *   **No Typed Text (Almost):** No typed body text, pasted text, or screenshots of slides/videos are allowed. *Exception:* A single, small typed header (like those added by some note-taking apps) per page is acceptable.
    *   **No Screenshots:** Directly copying parts of slides or videos is forbidden unless *redrawn/rewritten by hand*.
    *   **Arrangement:** Arranging multiple handwritten elements (e.g., diagrams, text blocks drawn separately and combined) on a single page is allowed, as long as all elements are handwritten.
*   **Collaboration:**
    *   Working in study groups to discuss content and strategy is encouraged.
    *   However, each student *must* create and submit their *own* entirely handwritten pages. Copying or sharing completed digital page files is not permitted.
*   **Submission Process:**
    *   Direct students to the specific Moodle section (e.g., "Exam Booklet Pages").
    *   Emphasize that they must upload the correct page file to the corresponding Moodle assignment link (e.g., Page 1 file goes to "Booklet Page 1" assignment).
    *   Recommend **PDF** as the submission format for best results with the Booklet Generator.
    *   Advise that only the very first page in the PDF will be used and only one file can be uploaded.
*   **Image Quality (If Scanning/Photographing):**
    *   Advise students to ensure submissions are clear, sharp, high-contrast, and not cut off. Poor quality scans/photos will result in a poor quality printed booklet. Suggest students rotate and crop pages.
    *   Suggest using scanner apps (like Microsoft Lens, Adobe Scan, Genius Scan) for better results than simple photos. Good, even lighting is crucial.
    *   *(Optional Technical Detail for context: Aim for roughly 300 DPI at A5 size - about 1770x2480 pixels - for good print quality).*
*   **Deadlines:** Clearly communicate the deadline for each page assignment. Strongly recommend submitting well *before* the deadline to avoid last-minute technical issues. Encourage testing the upload process with the first page assignment early. Moodle is configured in such a way that students can update their submission before the deadline.

### Step 3.5: Download Student Submissions

After the deadlines have passed:

*   Navigate to the first booklet page assignment in Moodle (e.g., "Booklet Page 1").
*   Click "View all submissions".
*   Use the "Grading action" menu and select **"Download all submissions"**. Moodle will create a ZIP file.
*   Download and **extract** the ZIP file.
*   **Repeat this download process for EVERY booklet page assignment.**
*   **CRITICAL:** Create a **single, dedicated folder** on your computer. Move **all** the extracted student submission files (from *all* assignments) into this one folder. The structure inside doesn't usually matter as long as all files are present.
*   The resulting structure should look like this:

```
booklet-submissions/
├── Seite 1/
│   ├── Bernd Beispiel_44441_assignsubmission_file_/
│   │   └── page1.png
│   └── Clara Clever_55551_assignsubmission_file_/
│       └── seite1.pdf
├── Seite 2/
│   ├── Anna Schmidt_11112_assignsubmission_file_/
│   │   └── IMG_13120.jpg
│   ├── Bernd Beispiel_44442_assignsubmission_file_/
│   │   └── pic.png
│   └── Clara Clever_55552_assignsubmission_file_/
│       └── Scan.jpeg
└── Seite 3/
    ├── Anna Schmidt_11113_assignsubmission_file_/
    │   └── IMG_13941.jpg
    └── Clara Clever_55553_assignsubmission_file_/
        └── dummy.png
```


### Step 3.6: Generate the Final Booklets

*   Launch the **Booklet Generator** application.
*   Follow its specific instructions. Typically, you will:
    *   Select the single folder containing all the downloaded student submissions (from Step 3.5).
    *   Configure any output options (e.g., naming, cover pages).
    *   Run the generation process.
*   The application will output the compiled A5 booklets (likely as PDF files), ready for printing.

## 4. Important Reminders

*   **Tool Creates Files, Doesn't Change Moodle Directly:** The Booklet Tool only *generates* an `.mbz` file. You *must* always use the Moodle "Restore" function (Step 3.3) to get the assignments into your course.
*   **Use the CORRECT `.mbz` File:** Only import the file *created by the script* (e.g., `WI24_Booklets.mbz`) into Moodle.
*   **Exact Section Title Match:** The Section Title used in the tool  *must perfectly match* the Moodle section name created in Step 3.1 for the import to work correctly.
*   **Target Start Date:** The Course Start Date must exactly match the start date of your Moodle course. This is crucial for assignment deadlines to be preserved correctly during import.
*   **Midnight Start Time:** For best results, your Moodle course should be configured to start at 00:00 (midnight) of the date you specify in the Booklet Tool. If your course uses a different start time, you may need to adjust your assignment due dates after import.
*   **Moodle Backups:** Consider making a standard Moodle backup of your course *before* restoring the assignments, just as a safety measure.
*   **Offline Feedback:** The generated assignments are configured to allow downloading grading worksheets (CSV files) if needed for offline grading workflows, although the primary goal is booklet generation.


---

## 5. Handling Identical Student Names

A potential complication arises if multiple students in your Moodle course share the exact same full name. The default folder names created when downloading submissions (e.g., `Anna Schmidt_11112_assignsubmission_file_`) include the student's name and a number. **Crucially, this number identifies the specific *submission*, not the student.** The same student will have *different* submission ID numbers across different assignments.

Therefore, relying solely on the folder name is insufficient to distinguish between two students named "Anna Schmidt". To resolve this, the **Booklet Generator** utilizes Moodle's **Grading Worksheets**.

*   **Detection:** If the Booklet Generator detects identical names among the submission folders, it cannot reliably group pages.
*   **Requirement:** It will instruct you to download the **Grading Worksheet (CSV file)** for *each* booklet page assignment. These can be downloaded from the "View all submissions" page via the "Grading action" menu in Moodle for each assignment activity.
*   **Resolution:** Place these downloaded CSV files alongside the student submission files (or provide them as requested by the Generator). The CSV file contains several columns, including the **submission ID** (matching the number in the folder name) and the **student's email address**. Since email addresses are unique identifiers within Moodle, the Generator uses the CSVs to map each submission ID (and thus each submitted file) back to a unique student via their email address.
*   **Necessity:** This process of downloading and providing the Grading Worksheets is **only required if you have students with identical names** in your course. If all student names are unique, the Booklet Generator can typically group the pages correctly without needing the CSV files.


This guide provides a comprehensive workflow for using the Moodle Booklet system. Remember to adapt any course-specific details (like exam rules regarding the booklet) and refer to the Booklet Generator's own documentation for its specific operation.