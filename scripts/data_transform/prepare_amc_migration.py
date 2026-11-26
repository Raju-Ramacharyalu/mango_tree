import csv
import glob
import io
import os
import re
import sys
import zipfile
from collections import Counter

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
EXPORT_DIR = os.path.join(BASE_DIR, "scripts", "legacy_export")
OUT_DIR = os.path.join(BASE_DIR, "scripts", "data_transform", "output")
CHUNK_SIZE = 500


def clean_str(val):
    if val is None:
        return ""
    s = str(val).strip()
    if s.lower() in ("nan", "none", "null", "nat"):
        return ""
    return s


def clean_int_str(val, default=""):
    s = clean_str(val)
    if not s:
        return default
    try:
        return str(int(float(s)))
    except ValueError:
        return default


def clean_num_str(val, default=""):
    s = clean_str(val)
    if not s:
        return default
    try:
        f = float(s)
        return str(int(f)) if f.is_integer() else str(f)
    except ValueError:
        return default


def clean_phone(val):
    s = clean_str(val)
    if not s:
        return ""
    if s.endswith(".0"):
        s = s[:-2]
    return s.strip()


def clean_date(val):
    s = clean_str(val)
    if not s:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", s)
    if m:
        dd, mm, yyyy = m.groups()
        return f"{yyyy}-{mm.zfill(2)}-{dd.zfill(2)}"
    return ""


def read_table_from_zip(zf, table_name):
    target = f"{table_name}_backup.csv"
    empty_target = f"{table_name}_backup_EMPTY.csv"
    names = zf.namelist()
    if target in names:
        with zf.open(target) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
            return [{(k or "").strip().lower(): v for k, v in row.items()} for row in reader]
    if empty_target in names:
        return []
    return []


def write_csv(path, headers, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    zips = sorted(glob.glob(os.path.join(EXPORT_DIR, "*.zip")), key=os.path.getmtime, reverse=True)
    if not zips:
        print(f"No backup ZIP found in: {EXPORT_DIR}")
        print("Download AMC_ERP_Master_Backup_*.zip from Tab 4 of your live Streamlit app and place it there.")
        sys.exit(1)

    zip_path = zips[0]
    os.makedirs(OUT_DIR, exist_ok=True)
    report = []
    report.append(f"AMC Legacy Migration Pre-Flight Report")
    report.append(f"Source Archive: {os.path.basename(zip_path)}")
    report.append("=" * 64)

    with zipfile.ZipFile(zip_path, "r") as zf:
        raw_branches = read_table_from_zip(zf, "master_branches")
        raw_courses = read_table_from_zip(zf, "master_courses")
        raw_staff = read_table_from_zip(zf, "master_staff")
        raw_students = read_table_from_zip(zf, "master_students")

    # 1. PROGRAMS (master_branches)
    programs_out = []
    known_branches = set()
    for r in raw_branches:
        code = clean_str(r.get("branch_code")).upper()
        name = clean_str(r.get("branch_name"))
        if not code or not name or code in known_branches:
            continue
        known_branches.add(code)
        prog_type = clean_str(r.get("program_type") or r.get("degree_type") or "UG").upper()
        if prog_type == "PHD":
            level, qual, dur = "DOCTORAL", "Ph.D.", "3"
        elif prog_type == "PG":
            level, qual, dur = "PG", ("MBA" if "MBA" in code else "MCA" if "MCA" in code else "M.Tech"), "2"
        elif prog_type == "DIPLOMA":
            level, qual, dur = "DIPLOMA", "Diploma", "3"
        else:
            level, qual, dur = "UG", "B.E.", "4"

        programs_out.append({
            "branch_code": code,
            "branch_name": name,
            "program_type": level,
            "qualification": qual,
            "duration_years": dur,
            "dept_code": clean_str(r.get("dept_name")).upper(),
        })

    # 2. COURSES (master_courses)
    courses_out = []
    seen_courses = set()
    missing_course_branches = Counter()
    course_sems = Counter()
    online_course_count = 0
    for r in raw_courses:
        c_code = clean_str(r.get("course_code")).upper()
        title = clean_str(r.get("title"))
        if not c_code or not title or c_code in seen_courses:
            continue
        seen_courses.add(c_code)

        raw_br = clean_str(r.get("branch_code"))
        br_list = [b.strip().upper() for b in raw_br.split(",") if b.strip()]
        for b in br_list:
            if b not in known_branches:
                missing_course_branches[b] += 1

        sem = clean_int_str(r.get("semester_id"))
        if sem:
            course_sems[int(sem)] += 1

        c_type = clean_str(r.get("course_type") or "CORE").upper()
        is_online = c_type == "ONLINE"
        if is_online:
            online_course_count += 1
        total_m = clean_num_str(r.get("total_marks"), "100")
        if is_online and (not total_m or float(total_m) <= 0):
            total_m = "100"

        courses_out.append({
            "course_code": c_code,
            "title": title,
            "branch_code": ", ".join(br_list),
            "semester_id": sem,
            "credits": clean_num_str(r.get("credits"), "3"),
            "max_cie": "0" if is_online else clean_num_str(r.get("max_cie"), "50"),
            "max_see": "0" if is_online else clean_num_str(r.get("max_see"), "50"),
            "total_marks": total_m,
            "course_type": c_type,
            "scheme_batch": clean_int_str(r.get("scheme_batch"), "25"),
            "offering_department": clean_str(r.get("offering_department")).upper(),
            "specialization": clean_str(r.get("specialization") or "GENERAL").upper() or "GENERAL",
        })

    # 3. STAFF (master_staff)
    staff_out = []
    seen_staff_emails = set()
    dup_staff_emails = 0
    for r in raw_staff:
        full_name = clean_str(r.get("full_name"))
        if not full_name:
            continue
        email = clean_str(r.get("email")).lower()
        if email:
            if email in seen_staff_emails:
                dup_staff_emails += 1
                email = ""
            else:
                seen_staff_emails.add(email)

        staff_out.append({
            "faculty_id": clean_str(r.get("faculty_id")).upper(),
            "full_name": full_name,
            "role": clean_str(r.get("role") or "Faculty"),
            "dept": clean_str(r.get("dept") or "GEN").upper(),
            "branch": clean_str(r.get("branch") or r.get("dept") or "GEN").upper(),
            "email": email,
            "is_evaluator": "true" if clean_str(r.get("is_evaluator")).lower() in ("true", "1", "yes", "t") else "false",
        })

    # 4. STUDENTS & STATUSES (master_students)
    students_out = []
    status_out = []
    seen_usns = set()
    seen_student_emails = set()
    dup_student_emails = 0
    missing_student_branches = Counter()
    student_sems = Counter()
    status_counts = Counter()

    for r in raw_students:
        usn = clean_str(r.get("usn")).upper()
        full_name = clean_str(r.get("full_name")).upper()
        branch = clean_str(r.get("branch_code")).upper()
        if not full_name:
            continue
        if usn and usn in seen_usns:
            continue
        if usn:
            seen_usns.add(usn)

        if branch and branch not in known_branches:
            missing_student_branches[branch] += 1

        sem = clean_int_str(r.get("current_sem"))
        if sem:
            student_sems[int(sem)] += 1

        email = clean_str(r.get("email")).lower()
        if email:
            if email in seen_student_emails:
                dup_student_emails += 1
                email = ""
            else:
                seen_student_emails.add(email)

        phone = clean_phone(r.get("contact")) or clean_phone(r.get("phone"))
        students_out.append({
            "usn": usn,
            "full_name": full_name,
            "branch_code": branch,
            "current_sem": sem,
            "section": clean_str(r.get("section")).upper(),
            "scheme_batch": clean_int_str(r.get("scheme_batch"), "25"),
            "contact": phone,
            "email": email,
            "dob": clean_date(r.get("dob")),
            "student_category": clean_str(r.get("student_category") or "REGULAR").upper() or "REGULAR",
            "specialization": clean_str(r.get("specialization") or "GENERAL").upper() or "GENERAL",
        })

        raw_status = clean_str(r.get("status") or "ACTIVE").upper()
        is_active = clean_str(r.get("is_active") or "true").lower() not in ("false", "0", "f", "no")
        if not is_active and raw_status == "ACTIVE":
            raw_status = "DISCONTINUED"
        if raw_status not in ("ACTIVE", "DETAINED", "DISCONTINUED", "COMPLETED", "TRANSFERRED", "SUSPENDED"):
            raw_status = "ACTIVE"
        status_counts[raw_status] += 1
        if usn and raw_status != "ACTIVE":
            status_out.append({"usn": usn, "status": raw_status})

    # Write outputs
    write_csv(
        os.path.join(OUT_DIR, "01_programs.csv"),
        ["branch_code", "branch_name", "program_type", "qualification", "duration_years", "dept_code"],
        programs_out,
    )
    write_csv(
        os.path.join(OUT_DIR, "02_courses.csv"),
        [
            "course_code", "title", "branch_code", "semester_id", "credits",
            "max_cie", "max_see", "total_marks", "course_type", "scheme_batch",
            "offering_department", "specialization",
        ],
        courses_out,
    )
    write_csv(
        os.path.join(OUT_DIR, "03_staff.csv"),
        ["faculty_id", "full_name", "role", "dept", "branch", "email", "is_evaluator"],
        staff_out,
    )
    student_headers = [
        "usn", "full_name", "branch_code", "current_sem", "section",
        "scheme_batch", "contact", "email", "dob", "student_category", "specialization",
    ]
    write_csv(os.path.join(OUT_DIR, "04_students.csv"), student_headers, students_out)

    chunks_dir = os.path.join(OUT_DIR, "04_students_chunks")
    if len(students_out) > CHUNK_SIZE:
        os.makedirs(chunks_dir, exist_ok=True)
        for f in glob.glob(os.path.join(chunks_dir, "*.csv")):
            os.remove(f)
        for idx in range(0, len(students_out), CHUNK_SIZE):
            part_no = (idx // CHUNK_SIZE) + 1
            write_csv(
                os.path.join(chunks_dir, f"04_students_part_{part_no:02d}.csv"),
                student_headers,
                students_out[idx:idx + CHUNK_SIZE],
            )

    if status_out:
        write_csv(os.path.join(OUT_DIR, "05_student_status.csv"), ["usn", "status"], status_out)

    # Build anonymized report
    report.append("SOURCE -> TRANSFORMED COUNTS:")
    report.append(f"  1. master_branches -> 01_programs.csv       : {len(raw_branches)} -> {len(programs_out)}")
    report.append(f"  2. master_courses  -> 02_courses.csv        : {len(raw_courses)} -> {len(courses_out)} (ONLINE: {online_course_count})")
    report.append(f"  3. master_staff    -> 03_staff.csv          : {len(raw_staff)} -> {len(staff_out)}")
    report.append(f"  4. master_students -> 04_students.csv       : {len(raw_students)} -> {len(students_out)}")
    report.append(f"  5. Non-ACTIVE rows -> 05_student_status.csv : {len(status_out)}")
    report.append("")
    report.append("PRE-FLIGHT CHECKS (ANONYMIZED):")
    report.append(f"  - Duplicate staff emails nulled   : {dup_staff_emails}")
    report.append(f"  - Duplicate student emails nulled : {dup_student_emails}")
    report.append(f"  - Student status distribution     : {dict(status_counts)}")

    sems_over_8 = sorted([s for s in set(course_sems.keys()) | set(student_sems.keys()) if s > 8])
    report.append(f"  - Semesters > 8 detected          : {sems_over_8 if sems_over_8 else 'None (all within SEM_1..SEM_8)'}")
    report.append(f"  - Course branches not in master_branches  : {dict(missing_course_branches) if missing_course_branches else 'None'}")
    report.append(f"  - Student branches not in master_branches : {dict(missing_student_branches) if missing_student_branches else 'None'}")
    if len(students_out) > CHUNK_SIZE:
        num_parts = (len(students_out) + CHUNK_SIZE - 1) // CHUNK_SIZE
        report.append(f"  - Student CSV auto-split into {num_parts} chunks ({CHUNK_SIZE} rows each) in 04_students_chunks/")

    report.append("=" * 64)
    report.append(f"Output directory: {OUT_DIR}")

    report_text = "\n".join(report)
    with open(os.path.join(OUT_DIR, "00_preflight_report.txt"), "w", encoding="utf-8") as rf:
        rf.write(report_text + "\n")
    print(report_text)


if __name__ == "__main__":
    main()
