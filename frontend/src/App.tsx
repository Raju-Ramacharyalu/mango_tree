import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { resolveUserAccess } from '@/app/rbac'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/modules/auth/LoginPage'
import { DashboardPage } from '@/modules/dashboard/DashboardPage'
import { InstitutionsPage } from '@/modules/institutions/InstitutionsPage'
import { OrganizationsPage } from '@/modules/organizations/OrganizationsPage'
import { UsersPage } from '@/modules/users/UsersPage'
import { AcademicsPage } from '@/modules/academics/AcademicsPage'
import { FrontOfficePage } from '@/modules/front-office/FrontOfficePage'
import { ExamsPage } from '@/modules/exams/ExamsPage'
import { ConfigurationPage } from '@/modules/configuration/ConfigurationPage'
import { DataManagementPage } from '@/modules/migrations/DataManagementPage'
import { AuditLogsPage } from '@/modules/audit/AuditLogsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

function TierRouteGuard({ path, children }: { path: string; children: ReactNode }) {
  const { platformRoles, memberships, activeInstitutionId, context, previewTier } = useAppStore()
  const activeMembership = memberships.find((m) => m.institution_id === activeInstitutionId)
  const access = resolveUserAccess({ platformRoles, activeMembership, context, previewTier })

  if (!access.canAccessRoute(path)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
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
    return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<DashboardPage />} />
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
