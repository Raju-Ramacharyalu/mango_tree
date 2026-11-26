import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Receipt, Download, Link2, CheckCircle2, AlertTriangle, Search } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import type { ExamCycle } from '@/types/exams'
import type { FeeReceiptRow, PaymentMode, StudentFrontOfficeRecord } from '@/types/frontOffice'
import { cn } from '@/utils/cn'

interface Props {
  institutionId: string
  cycle: ExamCycle | null
  students: StudentFrontOfficeRecord[]
  programs: Array<{ id: string; code: string; name: string }>
  canRecordReceipts: boolean
}

const FEE_TYPES = [
  'Exam Fee',
  'Tuition Fee',
  'Fine',
  'Revaluation fee',
  'Convocation fees',
  'Arrears fees',
  'Summer Semester Fee',
  'On-Demand Exam (ODE) Fee',
  'Other',
]

const PAYMENT_MODES: PaymentMode[] = [
  'UPI (QR / App)',
  'Bank Transfer (NEFT / RTGS)',
  'SBI Direct',
  'CASH',
  'DD',
]

function validateUtr(mode: PaymentMode, rawUtr: string): string | null {
  const utr = rawUtr.trim().toUpperCase()
  if (!utr) return 'Transaction ID / UTR is required.'
  if (mode === 'UPI (QR / App)' && !/^\d{12}$/.test(utr)) {
    return 'UPI UTR must be exactly 12 numeric digits.'
  }
  if (mode === 'Bank Transfer (NEFT / RTGS)' && !/^[A-Z0-9]{22}$/.test(utr)) {
    return 'NEFT / RTGS UTR must be exactly 22 alphanumeric characters.'
  }
  if (mode === 'SBI Direct' && !/^[A-Z0-9]+$/.test(utr)) {
    return 'SBI Direct Transaction ID must be alphanumeric.'
  }
  if ((mode === 'CASH' || mode === 'DD') && utr.length < 3) {
    return 'Receipt / DD number must be at least 3 characters.'
  }
  return null
}

function escapeCsvCell(val: string | number | null | undefined): string {
  const s = String(val ?? '').trim()
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function CashBookTab({ institutionId, cycle, students, programs, canRecordReceipts }: Props) {
  const queryClient = useQueryClient()
  const { session, profile } = useAppStore()

  const todayStr = new Date().toISOString().slice(0, 10)
  const monthStartStr = `${todayStr.slice(0, 8)}01`

  const [usnInput, setUsnInput] = useState('')
  const [studentName, setStudentName] = useState('')
  const [programCode, setProgramCode] = useState('')
  const [paymentDate, setPaymentDate] = useState(todayStr)
  const [amount, setAmount] = useState('')
  const [feeType, setFeeType] = useState('Exam Fee')
  const [otherFeeDesc, setOtherFeeDesc] = useState('')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('UPI (QR / App)')
  const [utrInput, setUtrInput] = useState('')
  const [collegeAccount, setCollegeAccount] = useState('')
  const [remarks, setRemarks] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState(monthStartStr)
  const [toDate, setToDate] = useState(todayStr)
  const [searchQuery, setSearchQuery] = useState('')

  const studentByKey = useMemo(() => {
    const map = new Map<string, StudentFrontOfficeRecord>()
    for (const s of students) {
      map.set(s.registration_number.trim().toUpperCase(), s)
      if (s.admission_number) {
        map.set(s.admission_number.trim().toUpperCase(), s)
      }
    }
    return map
  }, [students])

  const { data: receipts = [], isLoading } = useQuery<FeeReceiptRow[]>({
    queryKey: ['fee_receipts', institutionId, fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fee_receipts')
        .select('*')
        .eq('institution_id', institutionId)
        .gte('payment_date', fromDate)
        .lte('payment_date', toDate)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({
        ...(r as FeeReceiptRow),
        amount: Number(r.amount ?? 0),
      }))
    },
  })

  const { data: cycleRegs = [] } = useQuery<Array<{ id: string; student_id: string; payment_status: string; total_fee: number }>>({
    queryKey: ['cashbook_cycle_regs', institutionId, cycle?.id],
    enabled: Boolean(cycle?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_registrations')
        .select('id, student_id, payment_status, total_fee')
        .eq('institution_id', institutionId)
        .eq('exam_cycle_id', cycle!.id)
      if (error) throw error
      return (data ?? []).map((r) => ({
        id: r.id as string,
        student_id: r.student_id as string,
        payment_status: r.payment_status as string,
        total_fee: Number(r.total_fee ?? 0),
      }))
    },
  })

  const regByStudentId = useMemo(() => {
    const map = new Map<string, { id: string; payment_status: string; total_fee: number }>()
    for (const r of cycleRegs) map.set(r.student_id, r)
    return map
  }, [cycleRegs])

  const handleUsnChange = (val: string) => {
    const upper = val.toUpperCase()
    setUsnInput(upper)
    const found = studentByKey.get(upper.trim())
    if (found) {
      setStudentName(found.full_name)
      setProgramCode(found.program_code)
    }
  }

  const saveReceiptMutation = useMutation({
    mutationFn: async () => {
      const cleanUsn = usnInput.trim().toUpperCase()
      const cleanUtr = utrInput.trim().toUpperCase()
      const numericAmount = Number(amount)
      if (!cleanUsn || !studentName.trim() || !programCode.trim() || !collegeAccount.trim()) {
        throw new Error('USN, Student Name, Branch, and Credited College Account are mandatory.')
      }
      if (!numericAmount || numericAmount <= 0) {
        throw new Error('Enter a valid positive amount in ₹.')
      }
      const utrErr = validateUtr(paymentMode, cleanUtr)
      if (utrErr) throw new Error(utrErr)

      const finalType =
        feeType === 'Other'
          ? `Other - ${otherFeeDesc.trim().slice(0, 12) || 'Misc'}`
          : feeType

      const matchedStudent = studentByKey.get(cleanUsn) ?? null

      const { error } = await supabase.from('fee_receipts').insert({
        institution_id: institutionId,
        exam_cycle_id: cycle?.id ?? null,
        student_id: matchedStudent?.id ?? null,
        usn: matchedStudent?.registration_number ?? cleanUsn,
        student_name: studentName.trim(),
        program_code: programCode.trim().toUpperCase(),
        payment_date: paymentDate,
        amount: numericAmount,
        payment_type: finalType,
        payment_mode: paymentMode,
        utr_number: cleanUtr,
        college_account: collegeAccount.trim(),
        remarks: remarks.trim() || null,
        entered_by: session?.user.id ?? null,
        entered_by_name: profile?.full_name ?? profile?.email ?? 'Clerk',
        created_by: session?.user.id ?? null,
        updated_by: session?.user.id ?? null,
      })
      if (error) throw error
      return { usn: matchedStudent?.registration_number ?? cleanUsn, utr: cleanUtr }
    },
    onSuccess: (res) => {
      setErrorMsg(null)
      setNotice(`Receipt saved for ${res.usn} (UTR: ${res.utr}).`)
      setUsnInput('')
      setStudentName('')
      setAmount('')
      setUtrInput('')
      setOtherFeeDesc('')
      setRemarks('')
      queryClient.invalidateQueries({ queryKey: ['fee_receipts', institutionId] })
    },
    onError: (err) => {
      setNotice(null)
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save receipt (duplicate UTR or validation error).')
    },
  })

  const linkReceiptMutation = useMutation({
    mutationFn: async ({ receiptId, registrationId }: { receiptId: string; registrationId: string }) => {
      const { error } = await supabase.rpc('link_fee_receipt_to_registration', {
        p_institution_id: institutionId,
        p_receipt_id: receiptId,
        p_registration_id: registrationId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setErrorMsg(null)
      setNotice('UTR linked and Exam Registration marked PAID.')
      queryClient.invalidateQueries({ queryKey: ['fee_receipts', institutionId] })
      queryClient.invalidateQueries({ queryKey: ['cashbook_cycle_regs', institutionId, cycle?.id] })
      queryClient.invalidateQueries({ queryKey: ['exam_cycle_stats', institutionId, cycle?.id] })
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to link receipt')
    },
  })

  const filteredReceipts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return receipts
    return receipts.filter((r) =>
      `${r.usn} ${r.student_name} ${r.program_code} ${r.utr_number} ${r.payment_type} ${r.college_account}`
        .toLowerCase()
        .includes(q)
    )
  }, [receipts, searchQuery])

  const totalCashBook = useMemo(
    () => filteredReceipts.reduce((sum, r) => sum + Number(r.amount || 0), 0),
    [filteredReceipts]
  )

  const exportCashBookCsv = () => {
    const headers = [
      'Payment_Date',
      'USN',
      'Student_Name',
      'Branch',
      'Fee_Type',
      'Amount_INR',
      'Payment_Mode',
      'UTR_Number',
      'College_Account',
      'Status',
      'Entered_By',
    ]
    const lines = filteredReceipts.map((r) => [
      r.payment_date,
      r.usn,
      r.student_name,
      r.program_code,
      r.payment_type,
      r.amount,
      r.payment_mode,
      r.utr_number,
      r.college_account,
      r.verification_status,
      r.entered_by_name ?? '',
    ])
    const body = [headers, ...lines].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
    const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `CashBook_${fromDate}_to_${toDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
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

      {canRecordReceipts && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-indigo-600" />
              Desk Payment Synchronization (Strict UTR Validation)
            </h2>
            <span className="text-[11px] text-slate-500">
              UPI: 12 digits · NEFT/RTGS: 22 chars · SBI Direct: Alphanumeric
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student USN / Admission No. *</label>
              <input
                type="text"
                placeholder="e.g. 1AM25CS001"
                value={usnInput}
                onChange={(e) => handleUsnChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Name *</label>
              <input
                type="text"
                placeholder="Auto-fills on valid USN"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Branch / Program *</label>
              <select
                value={programCode}
                onChange={(e) => setProgramCode(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="">Select branch...</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Date of Payment *</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount Paid (₹) *</label>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 2000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Fee Type *</label>
              <div className="flex gap-1.5">
                <select
                  value={feeType}
                  onChange={(e) => setFeeType(e.target.value)}
                  className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                >
                  {FEE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {feeType === 'Other' && (
                  <input
                    type="text"
                    maxLength={12}
                    placeholder="Specify (12c)"
                    value={otherFeeDesc}
                    onChange={(e) => setOtherFeeDesc(e.target.value)}
                    className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Mode *</label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Transaction ID / UTR No. *</label>
              <input
                type="text"
                placeholder={
                  paymentMode === 'UPI (QR / App)'
                    ? '12-digit UPI Ref'
                    : paymentMode === 'Bank Transfer (NEFT / RTGS)'
                      ? '22-char NEFT/RTGS UTR'
                      : 'Transaction / Receipt No.'
                }
                value={utrInput}
                onChange={(e) => setUtrInput(e.target.value.toUpperCase())}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Credited To A/C (Bank Details) *</label>
              <input
                type="text"
                placeholder="e.g. SBI Exam A/C"
                value={collegeAccount}
                onChange={(e) => setCollegeAccount(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <input
              type="text"
              placeholder="Optional remarks..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="flex-1 min-w-[200px] rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={saveReceiptMutation.isPending}
              onClick={() => saveReceiptMutation.mutate()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saveReceiptMutation.isPending ? 'Saving...' : 'Save & Sync Receipt'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-slate-800">
              Cash Book Ledger ({filteredReceipts.length} receipts · ₹{totalCashBook.toLocaleString('en-IN')})
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            />
            <span className="text-slate-400">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input
                type="text"
                placeholder="Search USN / UTR..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-md border border-slate-300 bg-white pl-7 pr-2.5 py-1 text-xs"
              />
            </div>
            <button
              type="button"
              disabled={filteredReceipts.length === 0}
              onClick={exportCashBookCsv}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Export Cash Book CSV
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 font-semibold">Student</th>
                <th className="px-3 py-2.5 font-semibold">Fee Type / Mode</th>
                <th className="px-3 py-2.5 font-semibold">UTR / Account</th>
                <th className="px-3 py-2.5 font-semibold text-right">Amount</th>
                <th className="px-3 py-2.5 font-semibold text-right">Reconciliation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Loading Cash Book receipts...
                  </td>
                </tr>
              ) : filteredReceipts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No receipts recorded in this date window.
                  </td>
                </tr>
              ) : (
                filteredReceipts.map((r) => {
                  const candidateReg = r.student_id ? regByStudentId.get(r.student_id) : undefined
                  const canLink =
                    canRecordReceipts &&
                    !r.linked_registration_id &&
                    candidateReg &&
                    candidateReg.payment_status !== 'PAID'
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{r.payment_date}</td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono font-semibold text-slate-900">{r.usn}</span>
                        <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {r.program_code}
                        </span>
                        <p className="text-slate-600">{r.student_name}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-800">{r.payment_type}</p>
                        <p className="text-[11px] text-slate-500">{r.payment_mode}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-mono font-semibold text-slate-800">{r.utr_number}</p>
                        <p className="text-[11px] text-slate-500">{r.college_account}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900">
                        ₹{r.amount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {r.verification_status === 'RECONCILED' ? (
                          <span className="inline-block rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            RECONCILED
                          </span>
                        ) : canLink && candidateReg ? (
                          <button
                            type="button"
                            disabled={linkReceiptMutation.isPending}
                            onClick={() =>
                              linkReceiptMutation.mutate({
                                receiptId: r.id,
                                registrationId: candidateReg.id,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                          >
                            <Link2 className="h-3 w-3" />
                            Link to {cycle?.code}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                              'bg-slate-100 text-slate-600'
                            )}
                          >
                            {r.verification_status}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
