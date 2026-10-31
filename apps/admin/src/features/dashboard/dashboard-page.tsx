import { useQuery } from '@tanstack/react-query';
import {
  APPOINTMENT_TYPE_LABELS,
  formatCentavos,
  GARMENT_STAGE_LABELS,
  GARMENT_STAGES,
} from '@tahi/shared';
import { Link } from 'react-router';
import { useTenant } from '@/app/session';
import { FormError } from '@/components/form-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Appointment } from '@/features/appointments/appointments-page';
import { apiFetch } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useTenantAccess } from '@/lib/use-tenant-access';

interface OperationsDashboard {
  garmentsByStage: Record<(typeof GARMENT_STAGES)[number], number>;
  upcomingFittings: Appointment[];
}

interface FinancialDashboard {
  month: string;
  revenueCentavos: number;
  expensesCentavos: number;
  profitCentavos: number;
  receivablesCentavos: number;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function DashboardPage() {
  const { tenant } = useTenant();
  const { tenantId, manager } = useTenantAccess();
  const operations = useQuery({
    queryKey: ['dashboard', tenantId, 'operations'],
    queryFn: () => apiFetch<OperationsDashboard>('/dashboard/operations', { tenantId }),
  });
  return (
    <div className="space-y-6">
      <h1 className="break-words text-2xl font-semibold">{tenant?.name}</h1>
      {manager && <Financial tenantId={tenantId} />}
      <Card>
        <CardHeader>
          <CardTitle>Upcoming fittings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {operations.isPending && <p>Loading…</p>}
          <FormError error={operations.error} />
          {operations.data?.upcomingFittings.length === 0 && (
            <p className="text-sm text-muted-foreground">No fittings scheduled.</p>
          )}
          <ul className="divide-y">
            {operations.data?.upcomingFittings.map((item) => (
              <li key={item.id} className="flex flex-wrap gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 break-words">
                  {item.client?.fullName ?? APPOINTMENT_TYPE_LABELS[item.type]}
                  {item.garment && `, ${item.garment.name}`}
                </span>
                <span className="text-muted-foreground">
                  {formatDate(item.startsAt)} at {formatTime(item.startsAt)}
                </span>
              </li>
            ))}
          </ul>
          <Link className="text-sm underline-offset-4 hover:underline" to="/appointments">
            Open the calendar
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Garments by stage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {operations.isPending && <p>Loading…</p>}
          {operations.data && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {GARMENT_STAGES.map((stage) => (
                <Tile
                  key={stage}
                  label={GARMENT_STAGE_LABELS[stage]}
                  value={String(operations.data.garmentsByStage[stage])}
                />
              ))}
            </dl>
          )}
          <Link className="text-sm underline-offset-4 hover:underline" to="/production">
            Open the production board
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

/** Rendered for managers only, so staff never request it. The API refuses them regardless. */
function Financial({ tenantId }: { tenantId: string }) {
  const financial = useQuery({
    queryKey: ['dashboard', tenantId, 'financial'],
    queryFn: () => apiFetch<FinancialDashboard>('/dashboard/financial', { tenantId }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>This month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {financial.isPending && <p>Loading…</p>}
        <FormError error={financial.error} />
        {financial.data && (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Revenue" value={formatCentavos(financial.data.revenueCentavos)} />
            <Tile label="Expenses" value={formatCentavos(financial.data.expensesCentavos)} />
            <Tile label="Profit" value={formatCentavos(financial.data.profitCentavos)} />
            <Tile
              label="Receivables (all time)"
              value={formatCentavos(financial.data.receivablesCentavos)}
            />
          </dl>
        )}
        <p className="text-xs text-muted-foreground">
          Cash basis, in Manila months. Not an accounting or tax record.
        </p>
      </CardContent>
    </Card>
  );
}
