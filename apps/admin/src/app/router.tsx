import { lazy, type ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { AcceptInvitePage } from '@/features/auth/accept-invite-page';
import { LoginPage } from '@/features/auth/login-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { AppointmentsPage } from '@/features/appointments/appointments-page';
import { ClientDetailPage } from '@/features/clients/client-detail-page';
import { ClientsPage } from '@/features/clients/clients-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { ExpensesPage } from '@/features/expenses/expenses-page';
import { GarmentDetailPage } from '@/features/garments/garment-detail-page';
import { ProductionPage } from '@/features/garments/production-page';
import { ProfilePage } from '@/features/measurements/profile-page';
import { ProjectDetailPage } from '@/features/projects/project-detail-page';
import { ProjectsPage } from '@/features/projects/projects-page';
import { MembersPage } from '@/features/members/members-page';
import { PaymentsPage } from '@/features/payments/payments-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { isManager } from '@/lib/navigation';
import { supabase } from '@/lib/supabase';
import { AppShell } from './app-shell';
import { TenantProvider, useMe, useSession, useTenant } from './session';

const PlatformPage = lazy(() => import('@/features/platform/platform-page'));

function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

function RequireManager({ children }: { children: ReactNode }) {
  const { tenant } = useTenant();
  return tenant && isManager(tenant.role) ? children : <Navigate to="/" replace />;
}

function SignedInApp() {
  const me = useMe();

  if (me.isPending) return <Message title="Loading…" />;
  if (me.isError) {
    return (
      <Message title="Could not load your account">
        <p className="text-muted-foreground">{me.error.message}</p>
        <Button onClick={() => void me.refetch()}>Try again</Button>
      </Message>
    );
  }
  if (me.data.memberships.length === 0 && !me.data.isPlatformAdmin) {
    return (
      <Message title="No business yet">
        <p className="text-muted-foreground">
          Ask the business owner to invite you, then open the link they send.
        </p>
        <Button variant="outline" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </Message>
    );
  }

  const isPlatformOnly = me.data.memberships.length === 0;
  return (
    <TenantProvider me={me.data}>
      <Routes>
        <Route element={<AppShell me={me.data} />}>
          <Route
            index
            element={isPlatformOnly ? <Navigate to="/platform" replace /> : <DashboardPage />}
          />
          {!isPlatformOnly && (
            <>
              <Route path="clients" element={<ClientsPage />} />
              <Route path="clients/:id" element={<ClientDetailPage />} />
              <Route path="orders" element={<ProjectsPage />} />
              <Route path="orders/:id" element={<ProjectDetailPage />} />
              <Route path="production" element={<ProductionPage />} />
              <Route path="garments/:id" element={<GarmentDetailPage />} />
              <Route path="measurements/:id" element={<ProfilePage />} />
              <Route path="appointments" element={<AppointmentsPage />} />
            </>
          )}
          <Route
            path="reports"
            element={
              <RequireManager>
                <ReportsPage />
              </RequireManager>
            }
          />
          <Route
            path="payments"
            element={
              <RequireManager>
                <PaymentsPage />
              </RequireManager>
            }
          />
          <Route
            path="expenses"
            element={
              <RequireManager>
                <ExpensesPage />
              </RequireManager>
            }
          />
          <Route
            path="members"
            element={
              <RequireManager>
                <MembersPage />
              </RequireManager>
            }
          />
          {me.data.isPlatformAdmin && (
            <Route
              path="platform"
              element={
                <Suspense fallback={<p>Loading…</p>}>
                  <PlatformPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </TenantProvider>
  );
}

export function AppRoutes() {
  const { session, loading } = useSession();
  const { pathname } = useLocation();
  if (loading) return <Message title="Loading…" />;
  if (pathname === '/accept-invite') return <AcceptInvitePage />;
  if (pathname === '/reset-password') return <ResetPasswordPage />;
  return session ? <SignedInApp /> : <LoginPage />;
}
