import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/modules/auth/LoginPage'

const DashboardPage = lazy(() =>
  import('@/modules/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage }))
)
const InstitutionsPage = lazy(() =>
  import('@/modules/institutions/InstitutionsPage').then((m) => ({ default: m.InstitutionsPage }))
)
const OrganizationsPage = lazy(() =>
  import('@/modules/organizations/OrganizationsPage').then((m) => ({ default: m.OrganizationsPage }))
)
const UsersPage = lazy(() =>
  import('@/modules/users/UsersPage').then((m) => ({ default: m.UsersPage }))
)
const AcademicsPage = lazy(() =>
  import('@/modules/academics/AcademicsPage').then((m) => ({ default: m.AcademicsPage }))
)
const FrontOfficePage = lazy(() =>
  import('@/modules/front-office/FrontOfficePage').then((m) => ({ default: m.FrontOfficePage }))
)
const GovernancePage = lazy(() =>
  import('@/modules/governance/GovernancePage').then((m) => ({ default: m.GovernancePage }))
)
const QpVaultPage = lazy(() =>
  import('@/modules/qp-vault/QpVaultPage').then((m) => ({ default: m.QpVaultPage }))
)
const ExternalSeeDrafterPage = lazy(() =>
  import('@/modules/qp-vault/ExternalSeeDrafterPage').then((m) => ({ default: m.ExternalSeeDrafterPage }))
)
const OperationsPage = lazy(() =>
  import('@/modules/operations/OperationsPage').then((m) => ({ default: m.OperationsPage }))
)
const AnalyticsPage = lazy(() =>
  import('@/modules/analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage }))
)
const FacultyPortalPage = lazy(() =>
  import('@/modules/faculty-portal/FacultyPortalPage').then((m) => ({ default: m.FacultyPortalPage }))
)
const StudentPortalPage = lazy(() =>
  import('@/modules/student-portal/StudentPortalPage').then((m) => ({ default: m.StudentPortalPage }))
)
const ExamsPage = lazy(() =>
  import('@/modules/exams/ExamsPage').then((m) => ({ default: m.ExamsPage }))
)
const ConfigurationPage = lazy(() =>
  import('@/modules/configuration/ConfigurationPage').then((m) => ({ default: m.ConfigurationPage }))
)
const DataManagementPage = lazy(() =>
  import('@/modules/migrations/DataManagementPage').then((m) => ({ default: m.DataManagementPage }))
)
const AuditLogsPage = lazy(() =>
  import('@/modules/audit/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage }))
)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function RouteFallback() {
  return (
    <div className="py-12 text-center text-xs text-slate-500">
      Loading workspace module...
    </div>
  )
}

function TierRouteGuard({ path, children }: { path: string; children: ReactNode }) {
  const { platformRoles, memberships, activeInstitutionId, context, previewTier } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  if (!access.canAccessRoute(path)) {
    return <Navigate to="/" replace />
  }
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

function AppRoutes() {
  const { session, isLoadingAuth, initializeSession } = useAppStore()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      initializeSession(data.session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      initializeSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [initializeSession])

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">
        Verifying session...
      </div>
    )
  }

  if (!session) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/setter-drafter" element={<ExternalSeeDrafterPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    )
  }

  return (
    <Routes>
      <Route
        path="/setter-drafter"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ExternalSeeDrafterPage />
          </Suspense>
        }
      />
      <Route element={<AppLayout />}>
        <Route
          path="/"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="/institutions"
          element={
            <TierRouteGuard path="/institutions">
              <InstitutionsPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/organizations"
          element={
            <TierRouteGuard path="/organizations">
              <OrganizationsPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/users"
          element={
            <TierRouteGuard path="/users">
              <UsersPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/academics"
          element={
            <TierRouteGuard path="/academics">
              <AcademicsPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/governance"
          element={
            <TierRouteGuard path="/governance">
              <GovernancePage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/qp-vault"
          element={
            <TierRouteGuard path="/qp-vault">
              <QpVaultPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/analytics"
          element={
            <TierRouteGuard path="/analytics">
              <AnalyticsPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/operations"
          element={
            <TierRouteGuard path="/operations">
              <OperationsPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/faculty-portal"
          element={
            <TierRouteGuard path="/faculty-portal">
              <FacultyPortalPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/student-portal"
          element={
            <TierRouteGuard path="/student-portal">
              <StudentPortalPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/front-office"
          element={
            <TierRouteGuard path="/front-office">
              <FrontOfficePage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/exams"
          element={
            <TierRouteGuard path="/exams">
              <ExamsPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/configuration"
          element={
            <TierRouteGuard path="/configuration">
              <ConfigurationPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/data-management"
          element={
            <TierRouteGuard path="/data-management">
              <DataManagementPage />
            </TierRouteGuard>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <TierRouteGuard path="/audit-logs">
              <AuditLogsPage />
            </TierRouteGuard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
