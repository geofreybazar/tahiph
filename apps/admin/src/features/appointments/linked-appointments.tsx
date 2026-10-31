import { useQuery } from '@tanstack/react-query';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '@tahi/shared';
import { Link } from 'react-router';
import { FormError } from '@/components/form-error';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetchPage } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import type { Appointment } from './appointments-page';

/** A client's, order's or garment's appointments, with a link to schedule another. */
export function LinkedAppointments({
  tenantId,
  filter,
  schedule,
}: {
  tenantId: string;
  filter: Record<string, string>;
  schedule: Record<string, string>;
}) {
  const appointments = useQuery({
    queryKey: ['appointments', tenantId, filter],
    queryFn: () =>
      apiFetchPage<Appointment>(
        `/appointments?${new URLSearchParams({ ...filter, limit: '100' })}`,
        {
          tenantId,
        },
      ),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appointments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {appointments.isPending && <p>Loading…</p>}
        <FormError error={appointments.error} />
        {appointments.data?.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No appointments yet.</p>
        )}
        <ul className="divide-y">
          {appointments.data?.data.map((item) => (
            <li key={item.id} className="flex flex-wrap gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {APPOINTMENT_TYPE_LABELS[item.type]}, {formatDate(item.startsAt)} at{' '}
                {formatTime(item.startsAt)}
              </span>
              <span className="text-muted-foreground">
                {APPOINTMENT_STATUS_LABELS[item.status]}
              </span>
            </li>
          ))}
        </ul>
        <Link
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          to={`/appointments?${new URLSearchParams(schedule)}`}
        >
          Schedule an appointment
        </Link>
      </CardContent>
    </Card>
  );
}
