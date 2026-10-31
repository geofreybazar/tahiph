import { lazy, type ReactNode, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Button } from '@/components/ui/button';
import { LoginPage } from '@/features/auth/login-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { PlaceholderPage } from '@/features/placeholder-page';
import { canSeeFinancials } from '@/lib/navigation';
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

function RequireFinancials({ children }: { children: ReactNode }) {
  const { tenant } = useTenant();
  return tenant && canSeeFinancials(tenant.role) ? children : <Navigate to="/" replace />;
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
        <p className="text-muted-foreground">Ask the business owner to invite you.</p>
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
          <Route
            path="reports"
            element={
              <RequireFinancials>
                <PlaceholderPage title="Reports" />
              </RequireFinancials>
            }
          />
          <Route
            path="expenses"
            element={
              <RequireFinancials>
                <PlaceholderPage title="Expenses" />
              </RequireFinancials>
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
  if (loading) return <Message title="Loading…" />;
  return session ? <SignedInApp /> : <LoginPage />;
}
