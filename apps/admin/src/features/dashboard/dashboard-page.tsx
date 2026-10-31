import { useTenant } from '@/app/session';

export function DashboardPage() {
  const { tenant } = useTenant();
  return (
    <>
      <h1 className="text-2xl font-semibold">{tenant?.name}</h1>
      <p className="mt-2 text-muted-foreground">
        Signed in as {tenant?.role}. Dashboard modules arrive in Phase 1.
      </p>
    </>
  );
}
