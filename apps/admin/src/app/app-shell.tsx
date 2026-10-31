import { Link, NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { navigationFor } from '@/lib/navigation';
import { supabase } from '@/lib/supabase';
import type { Me } from '@/lib/tenants';
import { useTenant } from './session';

export function AppShell({ me }: { me: Me }) {
  const { tenant, switchTenant } = useTenant();

  return (
    <div className="min-h-svh">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Link to="/" className="font-semibold">
          TahiPh
        </Link>
        {me.memberships.length > 1 && tenant && (
          <select
            aria-label="Business"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={tenant.id}
            onChange={(event) => switchTenant(event.target.value)}
          >
            {me.memberships.map((membership) => (
              <option key={membership.id} value={membership.id}>
                {membership.name}
              </option>
            ))}
          </select>
        )}
        <nav aria-label="Main" className="flex flex-wrap gap-3 text-sm">
          {tenant &&
            navigationFor(tenant.role).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) => (isActive ? 'font-medium' : 'text-muted-foreground')}
              >
                {item.label}
              </NavLink>
            ))}
          {me.isPlatformAdmin && (
            <NavLink
              to="/platform"
              className={({ isActive }) => (isActive ? 'font-medium' : 'text-muted-foreground')}
            >
              Platform
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{me.email}</span>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      {tenant && tenant.status !== 'active' && (
        <p role="alert" className="bg-destructive/10 px-4 py-2 text-sm text-destructive">
          This business is currently unavailable. Contact TahiPh support.
        </p>
      )}
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
