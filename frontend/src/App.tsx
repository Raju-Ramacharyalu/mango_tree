import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { useAppStore } from '@/app/useAppStore'
import { AppLayout } from '@/layouts/AppLayout'
import { LoginPage } from '@/modules/auth/LoginPage'
import { DashboardPage } from '@/modules/dashboard/DashboardPage'
import { InstitutionsPage } from '@/modules/institutions/InstitutionsPage'
import { OrganizationsPage } from '@/modules/organizations/OrganizationsPage'
import { UsersPage } from '@/modules/users/UsersPage'
import { AcademicsPage } from '@/modules/academics/AcademicsPage'
import { ExamsPage } from '@/modules/exams/ExamsPage'
import { ConfigurationPage } from '@/modules/configuration/ConfigurationPage'
import { DataManagementPage } from '@/modules/migrations/DataManagementPage'
import { AuditLogsPage } from '@/modules/audit/AuditLogsPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

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
        <Route path="/institutions" element={<InstitutionsPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/academics" element={<AcademicsPage />} />
        <Route path="/exams" element={<ExamsPage />} />
        <Route path="/configuration" element={<ConfigurationPage />} />
        <Route path="/data-management" element={<DataManagementPage />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
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
