# Mango Tree ERP — Master Multi-Tenant Architecture & Phased Rollout Blueprint

## 1. Vision & Closed-Loop Architecture

Mango Tree consolidates four autonomous college workflows into a single multi-tenant, `institution_id`-isolated SaaS platform (Vite + React + TypeScript on Render, backed by Supabase PostgreSQL, RLS, and dual-bucket Storage):

1. **Governance & Question Paper Vaults** *(absorbed from `amc-bos-boe-portal`)*: BOS curriculum, syllabi, CO-PO mapping, CIE rubrics, classroom allocations, BOE setter nominations, NDA-logged SEE QP drafting, and PIN-encrypted IA QP vaults with per-tenant RSA-2048 keys.
2. **Front Office, Finance & Student Onboarding** *(absorbed from `brs` & `photo_bhoot`)*: Desk Cash Book with UTR validation, Phase 1 Academic Course Registration (Core, Lateral, Specialization, ONLINE, Electives), Phase 2 Exam Applications (Regular, Arrear, Summer Rules 1–3, ODE Attempt 1/2+), Student Photo Booth with `admission_number` fallback, and A4 3×4 Barcode Temp ID generation.
3. **Examination Operations & Result Processing** *(Live — Phase 2 M9–M12)*: Exam Cycles, Fee Rules, Timetable (OMR/Descriptive), Appearing Lists, Branded A4 Hall Tickets, Numerically Sorted Room Allotments, Live Form B/A Sync, Room-Wise QPDS, Course-Branch Bundles (`1AM`/`1AX` series split + PG), Blind Marks Entry, Decoding, SGPA & Provisional Grade Cards.
4. **Executive Oversight & Self-Service**: 4-Tab MIS Compliance Tracker, Duty Allocations (Invigilation & FIFO Evaluation), Management KPIs, and an authenticated Mobile-First Student Portal.

---

## 2. Live Baseline (Completed)

- **Phase 1 (`0001`–`0007`)**: Organizations, Institutions, Campuses, Users & RBAC, Academic Units, Programs, Curricula, Course Catalog, Students, Bulk CSV Migration Engine, Audit Logs.
- **Phase 2 (`0008`–`0012`)**:
  - `0008`: `exam_cycles`, `exam_fee_rules`, `exam_registrations`, `exam_registration_courses` (M9).
  - `0009`: `exam_timetable_slots`, `hall_tickets`, bulk issuance & print counter RPCs (M10).
  - `0010`: `exam_rooms`, `exam_course_aliases`, `exam_room_allotment_runs`, `exam_seat_allotments` (M11).
  - `0011`: `exam_script_bundles`, `exam_bundle_scripts`, `exam_course_results`, `exam_semester_results` (M12).
  - `0012`: Dual Storage buckets — `institution-branding` (public: Top-Left Logo, Top-Right Logo, Watermark) and `tenant-private-assets` (private signed URLs: COE/Principal signatures & student photos).

---

## 3. Three-Tier Multi-Tenant RBAC Model

| Tier | Roles | Data Scope | Core Authority |
| :--- | :--- | :--- | :--- |
| **Platform** | `SUPER_ADMIN`, `PLATFORM_ADMIN` | Cross-tenant | Onboard institutions, manage platform LaTeX/Bloom's catalogs, platform audit logs. |
| **Tier 1: Management Team** | `TRUST_ADMIN`, `MANAGEMENT_EXEC`, `FINANCE_CONTROLLER` | Institution-wide (Read + Executive Reports) | Cash Book & fee rollups, Photo Booth completion metrics, MIS compliance, pass/fail & SGPA analytics, budgets. |
| **Tier 2: Lead Team** | `PRINCIPAL_DIRECTOR`, `EXAM_CONTROLLER`, `DEAN_ACADEMICS`, `DEAN_FIRST_YEAR`, `HOD`, `ACADEMIC_ADVISOR`, `BOS_CHAIR`, `BOE_CHAIR` | Institution-wide, Sem 1–2 (`DEAN_FIRST_YEAR`), or Department-scoped (`academic_unit_id`) | BOS curriculum/rubrics, section allocations, BOE nominations, HOD/Dean CIE lock, Summer 15-credit override, Hall Ticket holds, branding/signatures. **COE-Only Vault:** `institution_vault_keys`, `exam_bundle_scripts`, `.pem` QP decryption, private signatures. |
| **Tier 3: Operational & Self-Service Users** | `FINANCE_CLERK`, `DEPT_COORDINATOR`, `FACULTY`, `EVALUATOR`, `STUDENT` (+ External Setter via UUID token) | Task-scoped or self-scoped (`auth.uid()`) | Desk UTR entry, dept course/exam registrations, Temp ID batches, PIN-encrypted IA drafting, CIE entry, blind SEE evaluation (dummy codes only), NDA-gated SEE drafting, Student Photo Booth & Hall Ticket/Grade Card access. |

---

## 4. Security & Multi-Tenant Standards

1. **Zero Hardcoded Tenant Values**: No hardcoded college names, static logo assets, email-substring department routing, or department-name Dean detection. All branding resolves from `printBranding.ts`; all scopes resolve from `membership_roles` and `staff_profiles.academic_unit_id`.
2. **Per-Tenant Cryptographic Vaults**: Each institution manages its own RSA-2048 public key in `institution_vault_keys(institution_id)`; the corresponding `.pem` private key stays strictly offline with that institution's COE and is loaded only into browser RAM/sessionStorage during decryption.
3. **RLS-Enforced Student Sessions**: No direct `anon` reads on `students` or unverified `localStorage` sessions. Student USN/Admission No. + PIN login routes through a tenant-scoped server/RPC gate issuing a verified session bound to `students.user_id`.
4. **USN Migration Continuity**: Student photo resolution checks `students.photo_url` first and falls back to `{institution_id}/students/{admission_number}.{ext}` so pre-USN photos persist seamlessly after USN allotment.
5. **Batch & CSV Standards**: All CSV exports use UTF-8 BOM (`utf-8-sig`), trimmed values, and 400-row database upsert/insert batching to prevent statement timeouts.

---

## 5. Phased Rollout Roadmap

- **Phase 3A (`0013`) — 3-Tier RBAC, Department-Scoped RLS & Role-Aware Workspaces**: Seed all 3-tier roles, add `academic_unit_id` / `DEAN_FIRST_YEAR` RLS helpers, build role-filtered navigation and dedicated Tier 1 (Management), Tier 2 (Lead Team), and Tier 3 (User) dashboards.
- **Phase 3B (`0014`) — Front Office (`brs` + `photo_bhoot`)**: Desk Cash Book & UTR validation, Phase 1 Academic Course Registration, Phase 2 Special Cycles (Summer Rules 1–3 + Lead-Team 15-credit override, ODE Attempt 1/2+), Student Photo Booth + Analytics, and A4 3×4 Barcode Temp ID Engine.
- **Phase 4A (`0015`) — BOS Curriculum, Allocations & Verified CIE Pipeline**: Full syllabus/CO/CO-PO/Rubrics persistence, HOD/First-Year Dean section allocations & reassignment, Faculty 360 (roster, leaves, onboarding), and HOD/Dean IA Marks verification feeding M12 `exam_course_results`.
- **Phase 4B (`0016`) — BOE Appointments & Per-Tenant Encrypted QP Vaults**: BOE nomination cycles, COE approval/15-day tokens/Mail Merge CSV/Appointment PDFs, Internal OMR assignments, NDA-logged SEE `QPDrafter`, Multi-Faculty PIN-encrypted `FacultyIADrafter` + Platform Formula Library + Scrutiny Pack PDF, `IaQpSetterTab`, `ProgressTrackerTab`, and `CoeOmrKeyGenerator`.
- **Phase 5 (`0017`) — Duty Allocations, MIS Compliance & Student Portal**: Date/Session Invigilation & FIFO Evaluation duty allocations, 4-Tab MIS Compliance Tracker, authenticated Mobile-First Student Portal (live Timetable, Room/Seat, Hall Tickets, Published Grade Cards), and Vite route code-splitting.
