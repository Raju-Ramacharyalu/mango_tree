import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Users,
  Plus,
  DownloadCloud,
  FileJson,
  Printer,
  CheckCircle2,
  AlertTriangle,
  RefreshCcw,
  CheckSquare,
} from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type { BoeNominationRow } from '@/types/qpVault'
import {
  escapeHtml,
  fetchInstitutionBranding,
  openBrandedPrintWindow,
  renderBrandedHeaderHtml,
  renderSignatureBlockHtml,
  renderWatermarkHtml,
  signPrivateAssets,
} from '@/modules/exams/printBranding'
import { cn } from '@/utils/cn'

interface CourseOption {
  id: string
  course_code: string
  title: string
  course_type: string
}

interface StaffOption {
  id: string
  employee_code: string
  full_name: string
  email: string | null
  designation: string
  department_label: string | null
  branch_label: string | null
}

interface Props {
  institutionId: string
  institutionName: string
  cycle: ExamCycle | null
  courses: CourseOption[]
  staff: StaffOption[]
  nominations: BoeNominationRow[]
  canNominate: boolean
  canCoeApprove: boolean
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = String(val ?? '').replace(/\r?\n/g, ' ').trim()
  return `"${s.replace(/"/g, '""')}"`
}

export function BoeAppointmentsTab({
  institutionId,
  institutionName,
  cycle,
  courses,
  staff,
  nominations,
  canNominate,
  canCoeApprove,
}: Props) {
  const queryClient = useQueryClient()
  const { session } = useAppStore()

  const [courseId, setCourseId] = useState('')
  const [departmentName, setDepartmentName] = useState('')
  const [facultyType, setFacultyType] = useState<'Internal' | 'External'>('External')
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [setterName, setSetterName] = useState('')
  const [designation, setDesignation] = useState('Professor')
  const [collegeName, setCollegeName] = useState('')
  const [collegeAddress, setCollegeAddress] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [isCoeDirectOmr, setIsCoeDirectOmr] = useState(false)
  const [deptFilter, setDeptFilter] = useState('ALL')
  const [isExporting, setIsExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const courseByCode = useMemo(() => {
    const map = new Map<string, CourseOption>()
    for (const c of courses) map.set(c.course_code, c)
    return map
  }, [courses])

  const departments = useMemo(
    () => Array.from(new Set(nominations.map((n) => n.department_name))).sort(),
    [nominations]
  )

  const filteredNoms = useMemo(
    () =>
      nominations.filter((n) => deptFilter === 'ALL' || n.department_name === deptFilter),
    [nominations, deptFilter]
  )

  const handlePickInternalStaff = (sid: string) => {
    setSelectedStaffId(sid)
    const found = staff.find((s) => s.id === sid)
    if (found) {
      setSetterName(found.full_name)
      setDesignation(found.designation || 'Assistant Professor')
      setEmail(found.email || '')
      setCollegeName(institutionName)
      if (!departmentName) {
        setDepartmentName(found.department_label || found.branch_label || 'General')
      }
    }
  }

  const addNominationMutation = useMutation({
    mutationFn: async () => {
      if (!cycle) throw new Error('Select an active Exam Cycle in the sidebar first.')
      const crs = courses.find((c) => c.id === courseId)
      if (!crs) throw new Error('Select a course.')
      if (!setterName.trim() || !email.trim()) {
        throw new Error('Setter Name and Email are required.')
      }
      const st = selectedStaffId ? staff.find((s) => s.id === selectedStaffId) : null

      const { error } = await supabase.from('boe_nominations').insert({
        institution_id: institutionId,
        exam_cycle_id: cycle.id,
        course_id: crs.id,
        course_code: crs.course_code,
        department_name: isCoeDirectOmr ? 'COE Internal' : departmentName.trim() || 'General',
        faculty_type: isCoeDirectOmr ? 'Internal' : facultyType,
        staff_profile_id: st?.id ?? null,
        faculty_code: st?.employee_code ?? null,
        setter_name: setterName.trim(),
        designation: designation.trim() || 'Professor',
        college_name: (facultyType === 'Internal' || isCoeDirectOmr) ? institutionName : collegeName.trim(),
        college_address: collegeAddress.trim(),
        mobile: mobile.trim(),
        email: email.trim().toLowerCase(),
        nomination_status: 'SUBMITTED',
        is_selected: isCoeDirectOmr && canCoeApprove,
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
      return `${crs.course_code} — ${setterName.trim()}`
    },
    onSuccess: (summary) => {
      setErrorMsg(null)
      setNotice(`Nomination submitted: ${summary}.`)
      setSetterName('')
      setEmail('')
      setMobile('')
      setSelectedStaffId('')
      queryClient.invalidateQueries({ queryKey: ['boe_nominations', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Nomination failed'),
  })

  const toggleApprovalMutation = useMutation({
    mutationFn: async ({ id, nextSelected }: { id: string; nextSelected: boolean }) => {
      const { error } = await supabase
        .from('boe_nominations')
        .update({ is_selected: nextSelected, updated_by: session?.user.id ?? null })
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boe_nominations', institutionId, cycle?.id] })
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Approval toggle failed'),
  })

  const resetExportMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('boe_nominations')
        .update({ is_exported: false, updated_by: session?.user.id ?? null })
        .eq('id', id)
        .eq('institution_id', institutionId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['boe_nominations', institutionId, cycle?.id] })
    },
  })

  const handleExportMailMergeCsv = async () => {
    const pending = nominations.filter((n) => n.is_selected && !n.is_exported)
    if (pending.length === 0) {
      setErrorMsg('No newly approved setters waiting for Mail Merge export.')
      return
    }
    if (!window.confirm(`Generate 15-day secure links and export Mail Merge CSV for ${pending.length} setters?`)) {
      return
    }

    setIsExporting(true)
    setErrorMsg(null)
    try {
      const header =
        'Ref_No,Date,Setter_Name,Designation,Department,College_Name,Address,Mobile,Email,Faculty_Type,ODD_EVEN,AY,Dept_AMC,Exam_Type,Program,Semester,Course_Code,Course_Name,Last_date,Duration,Max_Marks,Access_Link'
      const rows: string[] = [header]
      const todayStr = new Date().toLocaleDateString('en-IN')
      const dueStr = new Date(Date.now() + 7 * 86400_000).toLocaleDateString('en-IN')
      const exportedIds: string[] = []

      for (const nom of pending) {
        let token = nom.access_token
        const expired = !nom.token_expires_at || new Date(nom.token_expires_at) <= new Date()
        if (!token || expired) {
          token = crypto.randomUUID()
          const exp = new Date(Date.now() + 15 * 86400_000).toISOString()
          const { error } = await supabase
            .from('boe_nominations')
            .update({ access_token: token, token_expires_at: exp, updated_by: session?.user.id ?? null })
            .eq('id', nom.id)
          if (error) throw error
        }

        const link = `${window.location.origin}/setter-drafter?token=${token}`
        const crs = courseByCode.get(nom.course_code)
        const ay = cycle?.academic_year ?? '2026-27'
        const examType = cycle?.cycle_type ?? 'REGULAR'
        const refNo = `${institutionName.slice(0, 3).toUpperCase()}/COE/${ay}/${nom.course_code}`

        rows.push(
          [
            refNo,
            todayStr,
            nom.setter_name,
            nom.designation,
            nom.department_name,
            nom.college_name || institutionName,
            nom.college_address,
            nom.mobile,
            nom.email,
            nom.faculty_type,
            'ODD',
            ay,
            nom.department_name,
            examType,
            'UG/PG',
            '',
            nom.course_code,
            crs?.title ?? nom.course_code,
            dueStr,
            '3',
            '100',
            link,
          ]
            .map(escapeCsvCell)
            .join(',')
        )
        exportedIds.push(nom.id)
      }

      if (exportedIds.length > 0) {
        await supabase
          .from('boe_nominations')
          .update({ is_exported: true, updated_by: session?.user.id ?? null })
          .in('id', exportedIds)
      }

      const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Setter_Mail_Merge_${cycle?.code ?? 'Cycle'}.csv`
      a.click()
      URL.revokeObjectURL(url)

      setNotice(`Exported Mail Merge CSV with 15-day secure links for ${exportedIds.length} setters.`)
      queryClient.invalidateQueries({ queryKey: ['boe_nominations', institutionId, cycle?.id] })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Mail Merge export failed')
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportBlueprintJson = () => {
    if (!cycle) return
    const approved = nominations.filter((n) => n.is_selected)
    const blueprint = {
      cycle: {
        id: cycle.id,
        code: cycle.code,
        academic_year: cycle.academic_year,
        cycle_type: cycle.cycle_type,
      },
      approved_qps: approved.map((n) => {
        const crs = courseByCode.get(n.course_code)
        const format =
          crs?.course_type === 'OMR'
            ? 'OMR'
            : n.department_name.toUpperCase().includes('MBA') || n.department_name.toUpperCase().includes('MANAGEMENT')
              ? 'MBA'
              : 'STANDARD'
        return {
          course_code: n.course_code,
          course_title: crs?.title ?? n.course_code,
          format,
          setter_name: n.setter_name,
          setter_email: n.email,
          department: n.department_name,
        }
      }),
    }
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `BOE_Blueprint_${cycle.code}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printAppointmentOrder = async (nom: BoeNominationRow) => {
    const branding = await fetchInstitutionBranding(institutionId, institutionName)
    const sigMap = await signPrivateAssets([branding.coe_signature_path])
    const coeSigUrl = branding.coe_signature_path ? (sigMap.get(branding.coe_signature_path) ?? null) : null
    const crs = courseByCode.get(nom.course_code)
    const link = nom.access_token ? `${window.location.origin}/setter-drafter?token=${nom.access_token}` : null

    openBrandedPrintWindow({
      title: `Appointment_Order_${nom.course_code}_${nom.setter_name}`,
      landscape: false,
      branding,
      watermarkMode: 'per-page',
      bodyHtml: `<section class="page">
        ${renderWatermarkHtml(branding, 'per-page')}
        <div class="doc-body" style="padding:10px">
          ${renderBrandedHeaderHtml(branding, 'OFFICIAL QUESTION PAPER SETTER APPOINTMENT ORDER')}
          <p style="text-align:right;font-weight:600">Date: ${new Date().toLocaleDateString('en-IN')}</p>
          <p><strong>To,</strong><br/>
            <strong>${escapeHtml(nom.setter_name)}</strong><br/>
            ${escapeHtml(nom.designation)}<br/>
            ${escapeHtml(nom.college_name || institutionName)}<br/>
            ${nom.college_address ? `${escapeHtml(nom.college_address)}<br/>` : ''}
            Email: ${escapeHtml(nom.email)}
          </p>
          <p style="margin-top:16px"><strong>Subject:</strong> Appointment as Question Paper Setter for <strong>${escapeHtml(nom.course_code)} — ${escapeHtml(crs?.title ?? '')}</strong> (${escapeHtml(cycle?.code ?? '')})</p>
          <p style="line-height:1.6">Dear Professor,<br/><br/>
          By the direction of the Controller of Examinations, you are hereby appointed as the Question Paper Setter for the above-mentioned course in the Department of <strong>${escapeHtml(nom.department_name)}</strong>.<br/><br/>
          Kindly prepare the Question Paper and Scheme of Evaluation adhering to the autonomous syllabus and CO–Bloom's distribution, and treat this appointment as strictly confidential.</p>
          ${link ? `<p style="background:#f8fafc;border:1px solid #cbd5e1;padding:8px;font-size:10px"><strong>Encrypted Online Submission Link (Valid 15 Days):</strong><br/><span style="font-family:monospace">${escapeHtml(link)}</span></p>` : ''}
          <div class="signatures" style="margin-top:40px">
            <div class="sig-col"></div>
            ${renderSignatureBlockHtml('Controller of Examinations', coeSigUrl)}
          </div>
        </div>
      </section>`,
    })
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {notice}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          {errorMsg}
        </div>
      )}

      {canNominate && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Plus className="h-4 w-4 text-indigo-600" />
              Nominate BOE Question Paper Setter / COE Internal OMR Assignment
            </h2>
            {canCoeApprove && (
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-800">
                <input
                  type="checkbox"
                  checked={isCoeDirectOmr}
                  onChange={(e) => {
                    setIsCoeDirectOmr(e.target.checked)
                    if (e.target.checked) setFacultyType('Internal')
                  }}
                  className="rounded border-purple-400 text-purple-600"
                />
                <CheckSquare className="h-3.5 w-3.5" />
                Direct COE Internal OMR Assignment (Auto-Approve)
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div className="md:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Course *</label>
              <select
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              >
                <option value="">Select course...</option>
                {courses
                  .filter((c) => !isCoeDirectOmr || c.course_type === 'OMR' || /1BKSK|1BKBK|1BENG|OMR/i.test(c.course_code))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.course_code} — {c.title}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Setter Type</label>
              <select
                disabled={isCoeDirectOmr}
                value={facultyType}
                onChange={(e) => setFacultyType(e.target.value as 'Internal' | 'External')}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              >
                <option value="External">External Examiner</option>
                <option value="Internal">Internal Faculty</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Department</label>
              <input
                type="text"
                disabled={isCoeDirectOmr}
                placeholder="e.g. Computer Science"
                value={isCoeDirectOmr ? 'COE Internal' : departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>

            {facultyType === 'Internal' && (
              <div className="md:col-span-2">
                <label className="block font-medium text-emerald-800 mb-1">Pick Internal Faculty (Auto-Fill)</label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => handlePickInternalStaff(e.target.value)}
                  className="w-full rounded border border-emerald-300 bg-emerald-50/40 px-2.5 py-1.5"
                >
                  <option value="">-- Choose from staff directory --</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.employee_code} · {s.branch_label || s.department_label || 'Staff'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block font-medium text-slate-700 mb-1">Setter Full Name *</label>
              <input
                type="text"
                value={setterName}
                onChange={(e) => setSetterName(e.target.value)}
                placeholder="Dr. Ananya Rao"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="setter@university.edu"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Designation</label>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Mobile</label>
              <input
                type="text"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5"
              />
            </div>
            {facultyType === 'External' && (
              <>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">External College</label>
                  <input
                    type="text"
                    value={collegeName}
                    onChange={(e) => setCollegeName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">College Address</label>
                  <input
                    type="text"
                    value={collegeAddress}
                    onChange={(e) => setCollegeAddress(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={addNominationMutation.isPending || !cycle}
              onClick={() => addNominationMutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              {addNominationMutation.isPending ? 'Saving...' : 'Submit Setter Nomination'}
            </button>
          </div>
        </div>
      )}

      {/* Appointments Table & COE Exports */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <Users className="h-4 w-4 text-indigo-600" />
            <span className="font-semibold text-slate-800">
              BOE Nominations ({filteredNoms.length} total · {filteredNoms.filter((n) => n.is_selected).length} COE
              Approved)
            </span>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            >
              <option value="ALL">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {canCoeApprove && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportBlueprintJson}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <FileJson className="h-3.5 w-3.5" />
                Blueprint JSON
              </button>
              <button
                type="button"
                disabled={isExporting}
                onClick={handleExportMailMergeCsv}
                className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
                {isExporting ? 'Generating Links...' : 'Export New Appointments (Mail Merge CSV)'}
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5">Course &amp; Dept</th>
                <th className="px-3 py-2.5">Nominee</th>
                <th className="px-3 py-2.5">Type / College</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredNoms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No BOE setter nominations recorded for this exam cycle yet.
                  </td>
                </tr>
              ) : (
                filteredNoms.map((n) => (
                  <tr key={n.id} className={n.is_selected ? 'bg-emerald-50/40' : ''}>
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-bold text-indigo-900">{n.course_code}</span>
                      <p className="text-[11px] text-slate-500">{n.department_name}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-semibold text-slate-900">{n.setter_name}</p>
                      <p className="text-[11px] text-slate-500">{n.email}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'font-semibold',
                          n.faculty_type === 'External' ? 'text-rose-700' : 'text-indigo-700'
                        )}
                      >
                        {n.faculty_type}
                      </span>
                      <p className="text-[11px] text-slate-500 truncate max-w-[180px]">
                        {n.college_name || institutionName}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            n.is_selected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          )}
                        >
                          {n.is_selected ? 'COE Approved' : 'Pending'}
                        </span>
                        {n.is_selected && (
                          <span className="text-[10px] text-slate-500">
                            {n.is_exported ? '✓ Link Exported' : '★ Ready to Export'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                        <button
                          type="button"
                          onClick={() => printAppointmentOrder(n)}
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                        >
                          <Printer className="h-3 w-3" />
                          Order PDF
                        </button>
                        {canCoeApprove && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleApprovalMutation.mutate({ id: n.id, nextSelected: !n.is_selected })
                            }
                            className={
                              n.is_selected
                                ? 'rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700'
                                : 'rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700'
                            }
                          >
                            {n.is_selected ? 'Revoke' : 'Approve'}
                          </button>
                        )}
                        {canCoeApprove && n.is_selected && n.is_exported && (
                          <button
                            type="button"
                            onClick={() => resetExportMutation.mutate(n.id)}
                            className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 underline hover:text-slate-800"
                            title="Re-include in next Mail Merge CSV export"
                          >
                            <RefreshCcw className="h-2.5 w-2.5" /> Reset
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
