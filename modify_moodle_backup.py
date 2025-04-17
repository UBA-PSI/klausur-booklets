# MIT License
# 
# Copyright (c) 2025 Dominik Herrmann
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import os
import shutil
import tarfile
import re
import argparse
import time
import pathlib
import tempfile
import uuid # Added for backup ID
from datetime import datetime, timedelta

TARGET_ASSIGNMENT_COUNT = 4

# --- Helper Functions for ID Extraction ---

def enable_offline_feedback_plugin(content):
    """Enable the offline feedback plugin by setting its value to 1."""
    lines = content.splitlines()
    modified = False
    
    # Look for the pattern: line with "offline" followed by "assignfeedback", "enabled", and then "value"
    for i in range(len(lines)):
        if "<plugin>offline</plugin>" in lines[i]:
            # Check the next three lines for our pattern
            if i+3 < len(lines):
                if ("<subtype>assignfeedback</subtype>" in lines[i+1] and 
                    "<n>enabled</n>" in lines[i+2] and 
                    "<value>0</value>" in lines[i+3]):
                    # Replace value 0 with value 1
                    lines[i+3] = lines[i+3].replace("<value>0</value>", "<value>1</value>")
                    modified = True
                    break
    
    # If we modified content, return the new content
    if modified:
        return "\n".join(lines), True
    else:
        return content, False

def find_max_id(pattern, text, cast_to=int):
    """Find all matches for a pattern and return the maximum ID found."""
    ids = [cast_to(match) for match in pattern.findall(text)]
    return max(ids) if ids else 0

def find_first_id(pattern, text, cast_to=int):
    """Find the first match for a pattern and return the ID."""
    match = pattern.search(text)
    return cast_to(match.group(1)) if match else None

# --- Date Handling Functions ---

def parse_datetime(date_str, time_str):
    """Parse date and time strings into a datetime object."""
    try:
        # Parse date in YYYY-mm-dd format
        # Parse time in HH:MM:SS format
        dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")
        return dt
    except ValueError as e:
        print(f"Error parsing date/time: {e}")
        print("Please ensure date is in YYYY-MM-DD format and time in HH:MM:SS format")
        raise

def generate_assignment_dates(args):
    """Generate assignment dates based on command line arguments."""
    assignments = []
    extra_minutes = args.extra_time
    name_prefix = args.assignment_name_prefix
    
    # Current time for the first activation time if needed
    now = datetime.now()
    
    # Option A: First date + consecutive weeks
    if args.first_submission_date and args.num_consecutive_weeks:
        first_dt = parse_datetime(args.first_submission_date, args.submission_time)
        
        for i in range(args.num_consecutive_weeks):
            due_dt = first_dt + timedelta(weeks=i)
            cutoff_dt = due_dt + timedelta(minutes=extra_minutes)
            
            # For the first assignment, activation is current time
            # For subsequent assignments, activation is previous cutoff
            if i == 0:
                activation_dt = now
            else:
                activation_dt = previous_cutoff_dt
                
            assignments.append({
                "name": f"{name_prefix} {i+1}",
                "due_dt": due_dt,
                "due_ts": int(due_dt.timestamp()),
                "cutoff_dt": cutoff_dt,
                "cutoff_ts": int(cutoff_dt.timestamp()),
                "activation_dt": activation_dt,
                "activation_ts": int(activation_dt.timestamp())
            })
            
            previous_cutoff_dt = cutoff_dt
            
    # Option B: List of dates
    elif args.submission_dates:
        date_list = args.submission_dates.split(',')
        
        for i, date_str in enumerate(date_list):
            date_str = date_str.strip()
            due_dt = parse_datetime(date_str, args.submission_time)
            cutoff_dt = due_dt + timedelta(minutes=extra_minutes)
            
            # For the first assignment, activation is current time
            # For subsequent assignments, activation is previous cutoff
            if i == 0:
                activation_dt = now
            else:
                activation_dt = previous_cutoff_dt
                
            assignments.append({
                "name": f"{name_prefix} {i+1}",
                "due_dt": due_dt,
                "due_ts": int(due_dt.timestamp()),
                "cutoff_dt": cutoff_dt,
                "cutoff_ts": int(cutoff_dt.timestamp()),
                "activation_dt": activation_dt,
                "activation_ts": int(activation_dt.timestamp())
            })
            
            previous_cutoff_dt = cutoff_dt
    
    return assignments

# --- Core Moodle Backup Modification Functions ---

def extract_ids(base_path):
    """Extracts maximum IDs and constants from existing backup files."""
    print("\nExtracting existing IDs...")
    ids = {
        'max_module_id': 0,
        'max_activity_id': 0,
        'max_plugin_config_id': 0,
        'max_grade_item_id': 0,
        'context_id': None, # From activity
        'max_context_id': 0, # New - track highest contextid
        'max_grading_area_id': 0, # New - track highest grading area id
        'max_sortorder': 0, # New - track highest sortorder
        'section_id': None,
        'existing_module_ids': [],
        'existing_activity_ids': [],
        'original_backup_id': None
    }

    # 1. moodle_backup.xml
    moodle_backup_path = base_path / "moodle_backup.xml"
    if moodle_backup_path.is_file():
        content = moodle_backup_path.read_text()
        # Max moduleid from <activity><moduleid>...
        ids['max_module_id'] = find_max_id(re.compile(r'<moduleid>(\d+)</moduleid>'), content)
        ids['existing_module_ids'] = [str(m) for m in re.findall(r'<moduleid>(\d+)</moduleid>', content)]
        # sectionid from first <activity><sectionid>...
        ids['section_id'] = find_first_id(re.compile(r'<sectionid>(\d+)</sectionid>'), content)
        # Original backup ID
        backup_id_match = re.search(r'<detail backup_id="([a-f0-9]+)">', content)
        if backup_id_match:
            ids['original_backup_id'] = backup_id_match.group(1)
        print(f"  Found in moodle_backup.xml: max_module_id={ids['max_module_id']}, section_id={ids['section_id']}, backup_id={ids['original_backup_id']}")

    # 2. assign.xml files
    activity_dir = base_path / "activities"
    max_act_id_overall = 0
    max_plugin_id_overall = 0
    max_context_id_overall = 0
    existing_act_ids_temp = []

    if activity_dir.is_dir():
        for item in activity_dir.glob('assign_*/assign.xml'):
            if item.is_file():
                content = item.read_text()
                # Max activity id (should match assign id)
                act_id = find_max_id(re.compile(r'<(?:activity|assign) id="(\d+)">'), content)
                max_act_id_overall = max(max_act_id_overall, act_id)
                existing_act_ids_temp.append(act_id)
                # Max plugin_config id
                plug_id = find_max_id(re.compile(r'<plugin_config id="(\d+)">'), content)
                max_plugin_id_overall = max(max_plugin_id_overall, plug_id)
                # Max context ID
                context_id = find_first_id(re.compile(r'<activity.*?contextid="(\d+)".*?>'), content)
                if context_id:
                    max_context_id_overall = max(max_context_id_overall, context_id)
                    # Also track the first context ID found for backward compatibility
                    if ids['context_id'] is None:
                        ids['context_id'] = context_id

    ids['max_activity_id'] = max_act_id_overall
    ids['existing_activity_ids'] = sorted(list(set(existing_act_ids_temp)))
    ids['max_plugin_config_id'] = max_plugin_id_overall
    ids['max_context_id'] = max_context_id_overall
    print(f"  Found in assign.xml files: max_activity_id={ids['max_activity_id']}, max_plugin_config_id={ids['max_plugin_config_id']}, max_context_id={ids['max_context_id']}")

    # 3. inforef.xml files
    max_grade_id_overall = 0
    if activity_dir.is_dir():
        for item in activity_dir.glob('assign_*/inforef.xml'):
            if item.is_file():
                content = item.read_text()
                grade_id = find_max_id(re.compile(r'<grade_item>\s*<id>(\d+)</id>\s*</grade_item>'), content)
                max_grade_id_overall = max(max_grade_id_overall, grade_id)
    ids['max_grade_item_id'] = max_grade_id_overall
    print(f"  Found in inforef.xml files: max_grade_item_id={ids['max_grade_item_id']}")

    # 4. grading.xml files
    max_grading_area_id_overall = 0
    if activity_dir.is_dir():
        for item in activity_dir.glob('assign_*/grading.xml'):
            if item.is_file():
                content = item.read_text()
                area_id = find_max_id(re.compile(r'<area id="(\d+)">'), content)
                max_grading_area_id_overall = max(max_grading_area_id_overall, area_id)
    ids['max_grading_area_id'] = max_grading_area_id_overall
    print(f"  Found in grading.xml files: max_grading_area_id={ids['max_grading_area_id']}")

    # 5. grades.xml files
    max_sortorder_overall = 0
    if activity_dir.is_dir():
        for item in activity_dir.glob('assign_*/grades.xml'):
            if item.is_file():
                content = item.read_text()
                sortorder = find_max_id(re.compile(r'<sortorder>(\d+)</sortorder>'), content)
                max_sortorder_overall = max(max_sortorder_overall, sortorder)
    ids['max_sortorder'] = max_sortorder_overall
    print(f"  Found in grades.xml files: max_sortorder={ids['max_sortorder']}")

    return ids

def extract_mbz(mbz_path, extract_to):
    """Extracts the .mbz (tar.gz) file."""
    print(f"Extracting {mbz_path} to {extract_to}...")
    mode = "r:gz" # Standard moodle backup is .tar.gz
    try:
        with tarfile.open(mbz_path, mode) as tar:
            if hasattr(tarfile, 'data_filter') and callable(tarfile.data_filter):
                tar.extractall(path=extract_to, filter='data')
            else:
                 tar.extractall(path=extract_to)
            print(f"Extracted as {mode}")
    except tarfile.ReadError as e:
        print(f"Error reading archive {mbz_path}: {e}")
        print("Is it a valid .mbz (tar.gz or tar.xz) file?")
        raise
    except Exception as e:
        print(f"An unexpected error occurred during extraction: {e}")
        raise

def delete_dotfiles(base_path):
    """Recursively deletes files and directories starting with '.'"""
    print(f"\nDeleting dotfiles and dot directories in {base_path}...")
    deleted_count = 0
    path_obj = pathlib.Path(base_path)
    for item in path_obj.rglob('.*'):
        if not item.exists():
            continue
        try:
            if item.resolve() == path_obj.resolve():
                continue
            if item.is_file():
                item.unlink()
                print(f"  Deleted file: {item.relative_to(base_path)}")
                deleted_count += 1
            elif item.is_dir():
                if item.name not in ('.', '..'):
                    shutil.rmtree(item)
                    print(f"  Deleted directory: {item.relative_to(base_path)}")
                    deleted_count += 1
        except Exception as e:
            print(f"  Error deleting {item.relative_to(base_path)}: {e}")
    print(f"Deleted {deleted_count} dotfiles/directories.")

def find_assign_xml_files(base_path):
    """Finds all assign.xml files within the activities directory, sorted."""
    activity_dir = pathlib.Path(base_path) / "activities"
    assign_files = []
    if activity_dir.is_dir():
        assign_files = sorted(list(activity_dir.glob('assign_*/assign.xml')))
    print(f"Found {len(assign_files)} assignment files: {[str(f.relative_to(base_path)) for f in assign_files]}")
    return assign_files

def modify_assignment(file_path, new_name, new_due_ts, new_cutoff_ts, new_activation_ts=None):
    """Modifies name, duedate, and cutoffdate in an existing assign.xml."""
    # Simplified: assumes IDs are not changed for existing assignments
    print(f"\nModifying existing {file_path.relative_to(file_path.parent.parent.parent)}...")
    modified = False
    try:
        content = file_path.read_text()
        original_content = content
        changes = []

        # Modify name
        new_content, count = re.subn(r'(<name>)(.*?)(</name>)', rf'\g<1>{new_name}\g<3>', content, count=1)
        if count > 0 and content != new_content:
            changes.append(f"  - Name changed to: '{new_name}'")
            content = new_content
        else: print(f"  - Warning: Could not find <name> tag in {file_path}")

        # Modify duedate
        new_content, count = re.subn(r'(<duedate>)(.*?)(</duedate>)', rf'\g<1>{new_due_ts}\g<3>', content, count=1)
        if count > 0 and content != new_content:
            changes.append(f"  - Due date changed to: {new_due_ts} ({datetime.fromtimestamp(new_due_ts)})")
            content = new_content
        else: print(f"  - Warning: Could not find <duedate> tag in {file_path}")

        # Modify cutoffdate
        new_content, count = re.subn(r'(<cutoffdate>)(.*?)(</cutoffdate>)', rf'\g<1>{new_cutoff_ts}\g<3>', content, count=1)
        if count > 0 and content != new_content:
            changes.append(f"  - Cutoff date changed to: {new_cutoff_ts} ({datetime.fromtimestamp(new_cutoff_ts)})")
            content = new_content
        else: print(f"  - Warning: Could not find <cutoffdate> tag in {file_path}")
        
        # Modify allowsubmissionsfromdate (activation time) if provided
        if new_activation_ts is not None:
            new_content, count = re.subn(r'(<allowsubmissionsfromdate>)(.*?)(</allowsubmissionsfromdate>)', 
                                         rf'\g<1>{new_activation_ts}\g<3>', content, count=1)
            if count > 0 and content != new_content:
                changes.append(f"  - Activation date changed to: {new_activation_ts} ({datetime.fromtimestamp(new_activation_ts)})")
                content = new_content
            else: print(f"  - Warning: Could not find <allowsubmissionsfromdate> tag in {file_path}")
            
        # Enable offline feedback plugin
        content, plugin_enabled = enable_offline_feedback_plugin(content)
        if plugin_enabled:
            changes.append(f"  - Offline feedback plugin enabled")
        else:
            print(f"  - Warning: Could not find and enable offline feedback plugin in {file_path}")

        if content != original_content:
            file_path.write_text(content)
            print("  Changes written.")
            for change in changes:
                print(change)
            modified = True
        else:
            print("  No changes made.")

    except Exception as e:
        print(f"Error modifying file {file_path}: {e}")

    return modified

def create_new_assignment_files(base_path, assign_template_content, inforef_template_content, 
                            new_module_id, new_activity_id, start_plugin_config_id, new_grade_item_id, 
                            new_context_id, new_grading_area_id, new_sortorder, assignment_info, section_id):
    """Creates directory and files for a new assignment."""
    print(f"\nCreating new assignment files for module ID {new_module_id}...")
    assign_dir = base_path / "activities" / f"assign_{new_module_id}"
    assign_dir.mkdir(parents=True, exist_ok=True)

    current_plugin_config_id = start_plugin_config_id
    files_created = []

    try:
        # 1. Create assign.xml
        assign_content = assign_template_content

        # Replace IDs first
        assign_content = re.sub(r'<activity id="\d+"', f'<activity id="{new_activity_id}"', assign_content, count=1)
        assign_content = re.sub(r'moduleid="\d+"', f'moduleid="{new_module_id}"', assign_content, count=1)
        assign_content = re.sub(r'contextid="\d+"', f'contextid="{new_context_id}"', assign_content, count=1)
        assign_content = re.sub(r'<assign id="\d+">', f'<assign id="{new_activity_id}">', assign_content, count=1)

        # Replace data
        assign_content = re.sub(r'<name>.*?</name>', f'<name>{assignment_info["name"]}</name>', assign_content, count=1)
        assign_content = re.sub(r'<duedate>\d+</duedate>', f'<duedate>{assignment_info["due_ts"]}</duedate>', assign_content, count=1)
        assign_content = re.sub(r'<cutoffdate>\d+</cutoffdate>', f'<cutoffdate>{assignment_info["cutoff_ts"]}</cutoffdate>', assign_content, count=1)
        
        # Set activation date if provided
        if "activation_ts" in assignment_info:
            assign_content = re.sub(r'<allowsubmissionsfromdate>\d+</allowsubmissionsfromdate>',
                                   f'<allowsubmissionsfromdate>{assignment_info["activation_ts"]}</allowsubmissionsfromdate>', 
                                   assign_content, count=1)
                                   
        # Enable offline feedback plugin
        assign_content, plugin_enabled = enable_offline_feedback_plugin(assign_content)
        if plugin_enabled:
            print("  - Enabled offline feedback plugin")
        else:
            print("  - Warning: Could not find and enable offline feedback plugin in template")

        # Replace plugin_config IDs sequentially
        def replace_plugin_id(match):
            nonlocal current_plugin_config_id
            replacement = f'<plugin_config id="{current_plugin_config_id}">'
            current_plugin_config_id += 1
            return replacement

        assign_content = re.sub(r'<plugin_config id="\d+">', replace_plugin_id, assign_content)

        assign_xml_path = assign_dir / "assign.xml"
        assign_xml_path.write_text(assign_content)
        files_created.append(f"  Created {assign_xml_path.relative_to(base_path)}")

        # 2. Create inforef.xml
        inforef_content = inforef_template_content
        inforef_content = re.sub(r'<id>\d+</id>', f'<id>{new_grade_item_id}</id>', inforef_content, count=1)

        inforef_xml_path = assign_dir / "inforef.xml"
        inforef_xml_path.write_text(inforef_content)
        files_created.append(f"  Created {inforef_xml_path.relative_to(base_path)}")

        # 3. Create module.xml
        module_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<module id="{new_module_id}" version="2024100700">
  <modulename>assign</modulename>
  <sectionid>{section_id}</sectionid>
  <sectionnumber>1</sectionnumber>
  <idnumber></idnumber>
  <added>{int(time.time())}</added>
  <score>0</score>
  <indent>0</indent>
  <visible>1</visible>
  <visibleoncoursepage>1</visibleoncoursepage>
  <visibleold>1</visibleold>
  <groupmode>0</groupmode>
  <groupingid>0</groupingid>
  <completion>0</completion>
  <completiongradeitemnumber>$@NULL@$</completiongradeitemnumber>
  <completionpassgrade>0</completionpassgrade>
  <completionview>0</completionview>
  <completionexpected>0</completionexpected>
  <availability>$@NULL@$</availability>
  <showdescription>0</showdescription>
  <downloadcontent>1</downloadcontent>
  <lang></lang>
  <plugin_plagiarism_turnitinsim_module>
    <turnitinsim_mods>
    </turnitinsim_mods>
  </plugin_plagiarism_turnitinsim_module>
  <tags>
  </tags>
</module>"""
        module_xml_path = assign_dir / "module.xml"
        module_xml_path.write_text(module_content)
        files_created.append(f"  Created {module_xml_path.relative_to(base_path)}")

        # 4. Create grades.xml
        current_time = int(time.time())
        grades_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<activity_gradebook>
  <grade_items>
    <grade_item id="{new_grade_item_id}">
      <categoryid>27919</categoryid>
      <itemname>{assignment_info["name"]}</itemname>
      <itemtype>mod</itemtype>
      <itemmodule>assign</itemmodule>
      <iteminstance>{new_activity_id}</iteminstance>
      <itemnumber>0</itemnumber>
      <iteminfo>$@NULL@$</iteminfo>
      <idnumber></idnumber>
      <calculation>$@NULL@$</calculation>
      <gradetype>1</gradetype>
      <grademax>100.00000</grademax>
      <grademin>0.00000</grademin>
      <scaleid>$@NULL@$</scaleid>
      <outcomeid>$@NULL@$</outcomeid>
      <gradepass>0.00000</gradepass>
      <multfactor>1.00000</multfactor>
      <plusfactor>0.00000</plusfactor>
      <aggregationcoef>0.00000</aggregationcoef>
      <aggregationcoef2>0.00000</aggregationcoef2>
      <weightoverride>0</weightoverride>
      <sortorder>{new_sortorder}</sortorder>
      <display>0</display>
      <decimals>$@NULL@$</decimals>
      <hidden>0</hidden>
      <locked>0</locked>
      <locktime>0</locktime>
      <needsupdate>0</needsupdate>
      <timecreated>{current_time}</timecreated>
      <timemodified>{current_time}</timemodified>
      <grade_grades>
      </grade_grades>
    </grade_item>
  </grade_items>
  <grade_letters>
  </grade_letters>
</activity_gradebook>"""
        grades_xml_path = assign_dir / "grades.xml"
        grades_xml_path.write_text(grades_content)
        files_created.append(f"  Created {grades_xml_path.relative_to(base_path)}")

        # 5. Create grading.xml
        grading_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<areas>
  <area id="{new_grading_area_id}">
    <areaname>submissions</areaname>
    <activemethod>$@NULL@$</activemethod>
    <definitions>
    </definitions>
  </area>
</areas>"""
        grading_xml_path = assign_dir / "grading.xml"
        grading_xml_path.write_text(grading_content)
        files_created.append(f"  Created {grading_xml_path.relative_to(base_path)}")

        # 6. Create grade_history.xml
        grade_history_content = """<?xml version="1.0" encoding="UTF-8"?>
<grade_history>
  <grade_grades>
  </grade_grades>
</grade_history>"""
        grade_history_xml_path = assign_dir / "grade_history.xml"
        grade_history_xml_path.write_text(grade_history_content)
        files_created.append(f"  Created {grade_history_xml_path.relative_to(base_path)}")

        # 7. Create roles.xml
        roles_content = """<?xml version="1.0" encoding="UTF-8"?>
<roles>
  <role_overrides>
  </role_overrides>
  <role_assignments>
  </role_assignments>
</roles>"""
        roles_xml_path = assign_dir / "roles.xml"
        roles_xml_path.write_text(roles_content)
        files_created.append(f"  Created {roles_xml_path.relative_to(base_path)}")

        # Print summary of files created
        for file_msg in files_created:
            print(file_msg)

        return current_plugin_config_id # Return the next available ID

    except Exception as e:
        print(f"Error creating files for module {new_module_id}: {e}")
        import traceback
        traceback.print_exc()
        return start_plugin_config_id # Return original start ID on error

def update_section_xml(section_xml_path, all_module_ids, section_title=None):
    """Updates the sequence in section.xml and optionally the section title."""
    print(f"\nUpdating {section_xml_path.relative_to(section_xml_path.parent.parent.parent)}...") # More informative path
    if not section_xml_path.is_file():
        print(f"  Error: {section_xml_path} not found. Cannot update sequence.")
        return False
    try:
        content = section_xml_path.read_text()
        original_content = content # Store original content
        changes_made = False
        
        # Update sequence
        sequence_str = ",".join(map(str, all_module_ids))
        new_content, count = re.subn(
            r'(<sequence>)(.*?)(</sequence>)', # Match existing sequence
            rf'\g<1>{sequence_str}\g<3>', # Replace content
            content,
            count=1
        )
        if count > 0 and new_content != original_content:
            print(f"  Updated sequence to: {sequence_str}")
            content = new_content
            changes_made = True
        elif count == 0:
            print("  Error: Could not find <sequence>...</sequence> tag to update.")
            return False
        else:
            print("  Sequence already up-to-date.")
        
        # Update section title if provided
        if section_title:
            new_content, count = re.subn(
                r'(<name>)(.*?)(</name>)',  # Match existing name
                rf'\g<1>{section_title}\g<3>',  # Replace with new title
                content,
                count=1
            )
            if count > 0 and new_content != content:
                print(f"  Updated section title to: {section_title}")
                content = new_content
                changes_made = True
            elif count == 0:
                print("  Warning: Could not find <name> tag in section.xml.")
        
        if changes_made:
            section_xml_path.write_text(content)
            return True
        else: 
            print("  No changes needed to make.")
            return True # Considered success as it matches target
    except Exception as e:
        print(f"Error modifying file {section_xml_path}: {e}")
        return False

def update_moodle_backup_xml(xml_path, output_filename, original_backup_id, new_backup_id, all_assignment_details, section_id, added_module_ids, section_title=None, target_start_timestamp=None):
    """Modifies moodle_backup.xml: filename, backup_id, startdate, rebuilds activities, adds settings."""
    print(f"\nUpdating {xml_path.name}...")
    print(f"DEBUG: Received target_start_timestamp in update_moodle_backup_xml: {target_start_timestamp}") # DEBUG
    if not xml_path.is_file():
        print(f"  Error: {xml_path} not found.")
        return False

    try:
        content = xml_path.read_text()
        original_content = content
        changes_made = False

        # DEBUG: If we're looking for startdate, examine the file structure first
        if target_start_timestamp is not None:
            print("\nDEBUG: Searching for course date-related tags in moodle_backup.xml...")
            # Check for the existence of various potential date tags
            potential_tags = ["startdate", "start_date", "course_startdate", "original_course_startdate"]
            for tag in potential_tags:
                matches = re.findall(f"<{tag}[^>]*>([^<]+)</{tag}>", content)
                if matches:
                    print(f"  Found <{tag}> tags with values: {matches}")
            
            # Also check for course tag
            course_tag = re.search(r"<course\b[^>]*>(.*?)</course>", content, re.DOTALL)
            if course_tag:
                print("  Found <course> tag, checking for date fields inside")
                course_content = course_tag.group(1)
                date_tags = re.findall(r"<(\w*date\w*)[^>]*>([^<]+)</\1>", course_content)
                if date_tags:
                    print(f"  Date-related tags inside <course>: {date_tags}")
            
            # Look for other structures that might contain the course start date
            original_course_info = re.search(r"<original_course[^>]*>(.*?)</original_course>", content, re.DOTALL)
            if original_course_info:
                print("  Found <original_course> tag, checking for date fields inside")
                course_content = original_course_info.group(1)
                date_tags = re.findall(r"<(\w*date\w*)[^>]*>([^<]+)</\1>", course_content)
                if date_tags:
                    print(f"  Date-related tags inside <original_course>: {date_tags}")
            
            # Look for course/details section
            course_details = re.search(r"<details>(.*?)</details>", content, re.DOTALL)
            if course_details:
                print("  Found <details> tag, checking for date fields inside")
                details_content = course_details.group(1)
                date_tags = re.findall(r"<(\w*date\w*)[^>]*>([^<]+)</\1>", details_content)
                if date_tags:
                    print(f"  Date-related tags inside <details>: {date_tags}")

        # 1. Modify backup filename in <information><name>
        new_content_1, count1 = re.subn(r'(<information>.*?<name>)(.*?)(</name>)', rf'\g<1>{output_filename}\g<3>', content, count=1, flags=re.DOTALL)
        if count1 > 0 and content != new_content_1: print(f"  - Updated <information><name> to: {output_filename}"); changes_made = True
        else: print("  - Warning: Could not find <information><name> tag.")
        content = new_content_1

        # 2. Modify backup filename in <setting>
        pattern_setting = re.compile(r'(<setting>\s*<level>root</level>\s*<name>filename</name>\s*<value>)(.*?)(</value>\s*</setting>)', re.DOTALL)
        new_content_2, count2 = pattern_setting.subn(rf'\g<1>{output_filename}\g<3>', content, count=1)
        if count2 > 0 and content != new_content_2: print(f"  - Updated filename setting value to: {output_filename}"); changes_made = True
        else: print("  - Warning: Could not find <setting> for filename.")
        content = new_content_2

        # 3. Modify backup_id
        if original_backup_id:
            new_content_3, count3 = re.subn(f'backup_id="{original_backup_id}"', f'backup_id="{new_backup_id}"', content, count=1)
            if count3 > 0 and content != new_content_3: print(f"  - Updated backup_id to: {new_backup_id}"); changes_made = True
            else: print("  - Warning: Could not find original backup_id to replace.")
            content = new_content_3
        else:
             print("  - Warning: No original backup_id found, cannot replace.")

        # 3.5. Update section title in <sections> if provided
        if section_title and section_id:
            section_title_pattern = rf'(<section>\s*<sectionid>{section_id}</sectionid>\s*<title>)(.*?)(</title>)'
            new_content_3_5, count3_5 = re.subn(section_title_pattern, rf'\g<1>{section_title}\g<3>', content, count=1, flags=re.DOTALL)
            if count3_5 > 0 and content != new_content_3_5: 
                print(f"  - Updated section title in <sections> to: {section_title}")
                content = new_content_3_5
                changes_made = True
            else: 
                print("  - Warning: Could not find section title to update in <sections>.")

        # 4. Rebuild <activities> block
        activities_match = re.search(r'(<activities>)(.*?)(</activities>)', content, re.DOTALL)
        if activities_match:
            # Capture leading whitespace before the first activity for proper indentation
            first_activity_match = re.search(r'(\s*)<activity>', activities_match.group(2))
            leading_indent = first_activity_match.group(1) if first_activity_match else '          ' # Default indent

            activity_template_match = re.search(r'(<activity>.*?</activity>)', activities_match.group(2), re.DOTALL)
            if activity_template_match:
                activity_template = activity_template_match.group(1)
                new_activities_content = "\n"
                print("  - Rebuilding <activities> block:")
                for details in all_assignment_details:
                    new_entry = activity_template
                    # Ensure title is XML-safe (basic check for now)
                    safe_title = details["name"].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    new_entry = re.sub(r'<moduleid>\d+</moduleid>', f'<moduleid>{details["moduleid"]}</moduleid>', new_entry, count=1)
                    new_entry = re.sub(r'<sectionid>\d+</sectionid>', f'<sectionid>{section_id}</sectionid>', new_entry, count=1)
                    new_entry = re.sub(r'<title>.*?</title>', f'<title>{safe_title}</title>', new_entry, count=1)
                    new_entry = re.sub(r'<directory>.*?</directory>', f'<directory>activities/assign_{details["moduleid"]}</directory>', new_entry, count=1)
                    new_activities_content += f"{leading_indent}{new_entry}\n"
                    print(f"    - Added entry for module {details['moduleid']}")

                # Capture trailing whitespace before </activities> for proper closing indentation
                closing_activities_match = re.search(r'(\s*)</activities>$', activities_match.group(0))
                trailing_indent = closing_activities_match.group(1) if closing_activities_match else '        ' # Default indent

                new_activities_block = activities_match.group(1) + new_activities_content + trailing_indent + activities_match.group(3)
                content = content.replace(activities_match.group(0), new_activities_block, 1)
                changes_made = True
            else:
                print("  - Warning: Could not find an <activity> template within <activities> block.")
        else:
             print("  - Warning: Could not find <activities> section.")

        # 5. Add new <setting> blocks for added activities
        if added_module_ids:
            print("  - Adding new <setting> blocks for added activities:")
            # Find the last setting block to determine indentation and insertion point
            last_setting_match = None
            for match in re.finditer(r'(\s*)<setting>.*?</setting>', content, re.DOTALL):
                 last_setting_match = match

            if last_setting_match:
                indent = last_setting_match.group(1) # Indentation of the last existing setting
                insertion_point = last_setting_match.end() # Insert after the last setting
                new_settings_text = "\n" # Start with a newline

                for mod_id in added_module_ids:
                    activity_name = f"assign_{mod_id}"
                    # Use captured indent for new blocks
                    setting_included = (
                        f"{indent}<setting>\n"
                        f"{indent}  <level>activity</level>\n"
                        f"{indent}  <activity>{activity_name}</activity>\n"
                        f"{indent}  <name>{activity_name}_included</name>\n"
                        f"{indent}  <value>1</value>\n"
                        f"{indent}</setting>\n"
                    )
                    setting_userinfo = (
                        f"{indent}<setting>\n"
                        f"{indent}  <level>activity</level>\n"
                        f"{indent}  <activity>{activity_name}</activity>\n"
                        f"{indent}  <name>{activity_name}_userinfo</name>\n"
                        f"{indent}  <value>0</value>\n"
                        f"{indent}</setting>\n"
                    )
                    new_settings_text += setting_included + setting_userinfo
                    print(f"    - Added settings for {activity_name}")

                # Insert the new settings text at the calculated point
                content = content[:insertion_point] + new_settings_text + content[insertion_point:]
                changes_made = True
            else:
                # Fallback if no existing settings found (less likely but possible)
                settings_end_match = re.search(r'(\s*)</settings>', content)
                if settings_end_match:
                    indent = settings_end_match.group(1) + '  ' # Guess indentation
                    # ... (generate new_settings_text as above using guessed indent) ...
                    # ... (insert before </settings>) ...
                    print("  - Warning: Could not find existing <setting> blocks to determine indent. Used fallback.")
                    # (Implementation of fallback insertion needed if this case is critical)
                else:
                    print("  - Warning: Could not find </settings> tag or existing settings to insert new ones.")

        # 6. Modify course start date if provided
        if target_start_timestamp is not None:
            # Try a broader set of patterns based on what we've found in our scan
            changes_made_for_date = False
            
            # Pattern 1: <original_course_startdate> tag
            pattern1 = re.compile(r'(<original_course_startdate>)\d+(</original_course_startdate>)')
            new_content_6, count_p1 = pattern1.subn(rf'\g<1>{target_start_timestamp}\g<2>', content, count=1)
            if count_p1 > 0 and content != new_content_6:
                content = new_content_6
                print(f"  - Updated <original_course_startdate> to: {target_start_timestamp}")
                changes_made = True
                changes_made_for_date = True
            
            # Pattern 2: <details><startdate> (inside course details)
            pattern2 = re.compile(r'(<details>.*?<startdate>)\d+(</startdate>.*?</details>)', re.DOTALL)
            new_content_6, count_p2 = pattern2.subn(rf'\g<1>{target_start_timestamp}\g<2>', content, count=1)
            if count_p2 > 0 and content != new_content_6:
                content = new_content_6
                print(f"  - Updated <details><startdate> to: {target_start_timestamp}")
                changes_made = True
                changes_made_for_date = True
            
            # Pattern 3: <course><startdate> (in main course tag)
            pattern3 = re.compile(r'(<course\b[^>]*>.*?<startdate>)\d+(</startdate>.*?</course>)', re.DOTALL)
            new_content_6, count_p3 = pattern3.subn(rf'\g<1>{target_start_timestamp}\g<2>', content, count=1)
            if count_p3 > 0 and content != new_content_6:
                content = new_content_6
                print(f"  - Updated <course><startdate> to: {target_start_timestamp}")
                changes_made = True
                changes_made_for_date = True
            
            # Pattern 4: Try original pattern one more time (already tried earlier)
            if not changes_made_for_date:
                startdate_pattern_global = re.compile(r'(<startdate>)\d+(</startdate>)')
                new_content_6, count6 = startdate_pattern_global.subn(rf'\g<1>{target_start_timestamp}\g<2>', content, count=1)
                print(f"DEBUG: Global regex (<startdate>) substitution count: {count6}") # DEBUG

                if count6 > 0 and content != new_content_6:
                    # Display human-readable date along with timestamp
                    start_dt_readable = datetime.fromtimestamp(target_start_timestamp)
                    print(f"  - Updated course <startdate> to: {target_start_timestamp} ({start_dt_readable.strftime('%Y-%m-%d %H:%M:%S')})")
                    content = new_content_6
                    changes_made = True
            
            # Final check if we couldn't find any expected patterns
            if not changes_made_for_date:
                # Provide a more helpful warning if the tag isn't found
                print(f"  - Warning: Could not find the <startdate> tag in {xml_path.name} to update.")
                # Suggest checking course.xml instead
                course_xml_path = xml_path.parent / "course" / "course.xml"
                if course_xml_path.exists():
                    print(f"  - Note: You might need to check {course_xml_path.relative_to(xml_path.parent)} for the course start date instead.")
         
        # Write changes if any were made
        if changes_made:
            xml_path.write_text(content)
            print(f"  Changes written to {xml_path.name}.")
            return True
        else:
            print(f"  No changes made to {xml_path.name}.")
            return False

    except Exception as e:
        print(f"Error modifying file {xml_path}: {e}")
        # Optional: add traceback print here if needed during debugging
        # import traceback
        # traceback.print_exc()
        return False

def create_mbz(source_dir, output_path):
    """Creates a .tar.gz archive from the source directory."""
    print(f"\nCreating archive {output_path} (tar.gz) from {source_dir}...")
    output_path = pathlib.Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        print(f"Warning: Output file {output_path} exists. Deleting.")
        output_path.unlink()
    cwd = os.getcwd()
    try:
        os.chdir(source_dir)
        with tarfile.open(output_path, "w:gz") as tar:
            items_to_add = sorted(list(pathlib.Path('.').glob('**/*')))
            print(f"  Adding {len(items_to_add)} items to archive...") # Less verbose now
            for item in items_to_add:
                arcname = str(item.relative_to('.'))
                # print(f"  Adding: {arcname}") # Removed per-file logging
                tar.add(str(item), arcname=arcname)
        print(f"Archive created successfully: {output_path}")
    except Exception as e:
        print(f"Error creating archive {output_path}: {e}")
        raise
    finally:
        os.chdir(cwd)

def truncate_log_file(log_file_path):
    """Truncates the moodle_backup.log file."""
    print(f"\nTruncating log file: {log_file_path.name}")
    try:
        with open(log_file_path, 'w') as f:
            f.truncate(0)
        print("  Log file truncated.")
    except Exception as e:
        print(f"  Error truncating log file {log_file_path}: {e}")

def main():
    parser = argparse.ArgumentParser(description="Modify or add assignments in a Moodle backup (.mbz).")
    parser.add_argument("input_mbz", help="Path to the input .mbz file (e.g., sample.tar.gz).")
    parser.add_argument("-o", "--output_mbz", default="testbackup.mbz", help="Path for the output .mbz file.")
    parser.add_argument("-n", "--num_assignments", type=int, default=TARGET_ASSIGNMENT_COUNT, help=f"Total number of assignments in output (default: {TARGET_ASSIGNMENT_COUNT}).")
    
    # Date/time options - Method A
    parser.add_argument("--first-submission-date", help="Date of the first assignment (YYYY-MM-DD)")
    parser.add_argument("--num-consecutive-weeks", type=int, help="Number of consecutive weeks to create assignments for")
    
    # Date/time options - Method B
    parser.add_argument("--submission-dates", help="Comma-separated list of assignment dates (YYYY-MM-DD,YYYY-MM-DD,...)")
    
    # Common options
    parser.add_argument("--submission-time", default="23:59:59", help="Time for submissions (HH:MM:SS, default: 23:59:59)")
    parser.add_argument("--extra-time", type=int, default=60, help="Minutes between due time and cutoff time (default: 60)")
    
    # New options for section title and assignment naming
    parser.add_argument("--section-title", help="Exact title of the section in Moodle where assignments should be imported")
    parser.add_argument("--assignment-name-prefix", default="Page", help="Prefix for assignment names, followed by incremented number (default: 'Page')")
    
    # New option for target course start date
    parser.add_argument("--target-start-date", help="Target course start date (YYYY-MM-DD). Modifies the backup's start date.")
    
    args = parser.parse_args()

    # Validate date/time options
    if args.first_submission_date and args.submission_dates:
        print("Error: Cannot use both --first-submission-date and --submission-dates. Choose one method.")
        return
        
    if args.first_submission_date and not args.num_consecutive_weeks:
        print("Error: When using --first-submission-date, you must also specify --num-consecutive-weeks")
        return
        
    if args.num_consecutive_weeks and not args.first_submission_date:
        print("Error: When using --num-consecutive-weeks, you must also specify --first-submission-date")
        return
        
    # If no date options provided, use default assignment count
    target_assignment_count = args.num_assignments
    if args.first_submission_date and args.num_consecutive_weeks:
        target_assignment_count = args.num_consecutive_weeks
    elif args.submission_dates:
        target_assignment_count = len(args.submission_dates.split(','))
    
    input_path = pathlib.Path(args.input_mbz).resolve()
    output_path = pathlib.Path(args.output_mbz).resolve()
    output_filename = output_path.name

    if not input_path.is_file():
        print(f"Error: Input file not found at {input_path}")
        return

    # Parse target start date if provided
    target_start_timestamp = None
    if args.target_start_date:
        try:
            # Parse as datetime object first
            target_start_dt = datetime.strptime(args.target_start_date, "%Y-%m-%d")
            # Convert to Unix timestamp (integer seconds since epoch)
            # Moodle often uses the timestamp for the start of the day (00:00:00) in the server's timezone.
            # Using timestamp() on a date-only object effectively does this for the local timezone.
            # For full accuracy, consider server timezone if known, but this is usually sufficient.
            target_start_timestamp = int(target_start_dt.timestamp())
            print(f"DEBUG: Parsed timestamp in main: {target_start_timestamp}") # DEBUG
            print(f"  Target start date specified: {args.target_start_date} (Timestamp: {target_start_timestamp})")
        except ValueError:
            print(f"Error: Invalid format for --target-start-date '{args.target_start_date}'. Use YYYY-MM-DD.")
            return

    # --- Assignment Data Definition ---
    if args.first_submission_date or args.submission_dates:
        # Generate dates based on command line arguments
        assignment_base_data = generate_assignment_dates(args)
    else:
        # Use default date generation if no specific dates provided
        assignment_base_data = []
        now = datetime.now()
        for i in range(target_assignment_count):
            due_date = now + timedelta(days=7 * (i + 1))
            cutoff_date = due_date + timedelta(minutes=args.extra_time)
            activation_date = now if i == 0 else (now + timedelta(days=7 * i, minutes=args.extra_time))
            
            assignment_base_data.append({
                "name": f"{args.assignment_name_prefix} {i + 1}",
                "due_ts": int(due_date.timestamp()),
                "cutoff_ts": int(cutoff_date.timestamp()),
                "activation_ts": int(activation_date.timestamp())
            })

    # Use a temporary directory
    with tempfile.TemporaryDirectory(prefix="moodle_mbz_") as temp_dir:
        print(f"Using temporary directory: {temp_dir}")
        temp_path = pathlib.Path(temp_dir)

        try:
            # 1. Extract
            extract_mbz(input_path, temp_path)

            # 1.5 Delete dotfiles
            delete_dotfiles(temp_path)

            # 2. Extract existing IDs
            ids = extract_ids(temp_path)
            original_assignment_count = len(ids['existing_module_ids'])
            print(f"Original assignment count: {original_assignment_count}")

            if not ids['section_id'] or not ids['context_id']:
                 print("Error: Could not extract required section_id or context_id from backup files.")
                 return

            # 3. Find existing assignment files (sorted)
            existing_assign_files = find_assign_xml_files(temp_path)
            if len(existing_assign_files) != original_assignment_count:
                 print(f"Warning: Mismatch between module IDs in moodle_backup.xml ({original_assignment_count}) and found assign.xml files ({len(existing_assign_files)}). Proceeding cautiously.")
                 original_assignment_count = min(original_assignment_count, len(existing_assign_files))

            # 4. Read template files (use first existing assignment)
            assign_template_content = ""
            inforef_template_content = ""
            if existing_assign_files:
                 assign_template_content = existing_assign_files[0].read_text()
                 inforef_template_path = existing_assign_files[0].parent / "inforef.xml"
                 if inforef_template_path.is_file():
                      inforef_template_content = inforef_template_path.read_text()
                 else:
                      print(f"Warning: Could not read inforef.xml template from {inforef_template_path}. Cannot create new inforef files.")
            elif target_assignment_count > 0:
                print("Error: No existing assignments found to use as template, but target count > 0.")
                return

            # 5. Initialize ID counters and lists for the loop
            current_module_id = ids['max_module_id']
            current_activity_id = ids['max_activity_id']
            current_grade_item_id = ids['max_grade_item_id']
            current_plugin_config_id = ids['max_plugin_config_id'] + 1 # Start from next available
            current_context_id = ids['max_context_id']
            current_grading_area_id = ids['max_grading_area_id']
            current_sortorder = ids['max_sortorder']

            final_assignment_details = [] # List to hold {name, moduleid} for all final assignments
            final_module_ids = [] # List to hold all final module IDs in order
            added_module_ids = [] # List of module IDs added in this run

            # --- 6. Process Assignments (Modify or Add) ---
            print(f"\nProcessing target of {target_assignment_count} assignments...")
            for i in range(target_assignment_count):
                if i >= len(assignment_base_data):
                    print(f"Warning: Not enough assignment data for index {i}, skipping.")
                    continue
                    
                assignment_info = assignment_base_data[i]

                if i < original_assignment_count:
                    # Modify existing assignment
                    module_id = ids['existing_module_ids'][i]
                    file_path = temp_path / "activities" / f"assign_{module_id}" / "assign.xml"
                    if file_path.is_file():
                        modify_assignment(
                            file_path, 
                            assignment_info["name"], 
                            assignment_info["due_ts"], 
                            assignment_info["cutoff_ts"],
                            assignment_info.get("activation_ts")
                        )
                    else:
                        print(f"  Warning: Expected file {file_path} not found for modification.")

                    final_module_ids.append(module_id)
                    final_assignment_details.append({"name": assignment_info["name"], "moduleid": module_id})

                else:
                    # Add new assignment
                    current_module_id += 1
                    current_activity_id += 1
                    current_grade_item_id += 1
                    current_context_id += 1
                    current_grading_area_id += 1
                    current_sortorder += 1

                    # Ensure templates are available
                    if not assign_template_content or not inforef_template_content:
                         print("Error: Missing template content to create new assignment. Stopping.")
                         break # Stop processing further assignments

                    next_plugin_id = create_new_assignment_files(
                        temp_path,
                        assign_template_content,
                        inforef_template_content,
                        current_module_id,
                        current_activity_id,
                        current_plugin_config_id,
                        current_grade_item_id,
                        current_context_id,
                        current_grading_area_id,
                        current_sortorder,
                        assignment_info,
                        ids['section_id']
                    )
                    current_plugin_config_id = next_plugin_id # Update for the next iteration
                    added_module_ids.append(current_module_id)
                    final_module_ids.append(current_module_id)
                    final_assignment_details.append({"name": assignment_info["name"], "moduleid": current_module_id})

            # --- 7. Update Manifest Files ---
            # Update section.xml
            section_xml_path = temp_path / "sections" / f"section_{ids['section_id']}" / "section.xml"
            if not update_section_xml(section_xml_path, final_module_ids, args.section_title):
                print("Error: Failed to update section.xml. Backup may be invalid.")
                # Decide whether to proceed or stop
                return # Or raise an exception

            # Update moodle_backup.xml
            moodle_backup_xml_path = temp_path / "moodle_backup.xml"
            new_backup_id = uuid.uuid4().hex # Generate new random backup ID
            if not update_moodle_backup_xml(
                moodle_backup_xml_path, 
                output_filename, 
                ids['original_backup_id'], 
                new_backup_id, 
                final_assignment_details, 
                ids['section_id'], 
                added_module_ids, 
                args.section_title,
                target_start_timestamp # Pass the new timestamp
            ):
                print("Error: Failed to update moodle_backup.xml. Backup may be invalid.")
                # Decide whether to proceed or stop
                # return

            # Truncate log file
            log_file_path = temp_path / "moodle_backup.log"
            if log_file_path.exists():
                 truncate_log_file(log_file_path)
            else:
                 print("\nLog file moodle_backup.log not found, skipping truncation.")
            
            # --- 7.5 Enable offline feedback plugin in all assign.xml files using a simple find and replace ---
            print("\nEnabling offline feedback plugin in all assign.xml files...")
            assign_files = list(temp_path.glob("activities/assign_*/assign.xml"))
            for file_path in assign_files:
                try:
                    content = file_path.read_text()
                    # Simple string replacement
                    if "<plugin>offline</plugin>" in content and "<value>0</value>" in content:
                        # Replace only the value 0 that appears after offline plugin
                        parts = content.split("<plugin>offline</plugin>")
                        if len(parts) > 1:
                            # Find where the value tag appears in the second part
                            subparts = parts[1].split("<value>0</value>", 1)
                            if len(subparts) > 1:
                                # Replace just the first occurrence after the offline plugin
                                parts[1] = subparts[0] + "<value>1</value>" + subparts[1]
                                content = "<plugin>offline</plugin>".join(parts)
                                file_path.write_text(content)
                                print(f"  Enabled offline feedback in {file_path.relative_to(temp_path)}")
                            else:
                                print(f"  Could not find <value>0</value> tag after offline plugin in {file_path.relative_to(temp_path)}")
                    else:
                        print(f"  Could not find offline plugin configuration in {file_path.relative_to(temp_path)}")
                except Exception as e:
                    print(f"  Error processing {file_path.relative_to(temp_path)}: {e}")

            # 8. Re-pack as tar.gz
            create_mbz(temp_path, output_path)

        except Exception as e:
            print(f"\nAn error occurred during the process: {e}")
            import traceback
            traceback.print_exc() # Print detailed traceback for debugging
        finally:
             print(f"Temporary directory {temp_dir} cleaned up.")

    print("\nScript finished.")

if __name__ == "__main__":
    main() 