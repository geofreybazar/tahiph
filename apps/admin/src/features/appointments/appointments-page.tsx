import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPES,
} from '@tahi/shared';
import { type FormEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Field, selectClass, textareaClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Client } from '@/features/clients/clients-page';
import type { Garment } from '@/features/garments/production-page';
import type { Project } from '@/features/projects/projects-page';
import { apiFetch, apiFetchPage } from '@/lib/api';
import {
  addMonths,
  fromManilaInput,
  manilaDay,
  monthGrid,
  monthLabel,
  toManilaInput,
} from '@/lib/calendar';
import { formatTime } from '@/lib/format';
import { useTenantAccess } from '@/lib/use-tenant-access';

type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface Appointment {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  location: string | null;
  notes: string | null;
  clientId: string | null;
  projectId: string | null;
  garmentId: string | null;
  client: { id: string; fullName: string } | null;
  project: { id: string; projectNumber: string; title: string } | null;
  garment: { id: string; name: string; wearerName: string } | null;
}

const LIMIT = 100;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AppointmentsPage() {
  const { tenantId } = useTenantAccess();
  const [params] = useSearchParams();
  const [month, setMonth] = useState(() => manilaDay(new Date()).slice(0, 7));
  const [editing, setEditing] = useState<Appointment | null>(null);
  const { leading, days } = monthGrid(month);
  const appointments = useQuery({
    queryKey: ['appointments', tenantId, 'month', month],
    queryFn: () =>
      apiFetchPage<Appointment>(`/appointments?from=${days[0]}&to=${days.at(-1)}&limit=${LIMIT}`, {
        tenantId,
      }),
  });
  const today = manilaDay(new Date());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Appointments</h1>
      <AppointmentForm
        key={editing?.id ?? 'new'}
        tenantId={tenantId}
        appointment={editing}
        prefill={params}
        onDone={() => setEditing(null)}
      />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2">
          <CardTitle className="min-w-0 flex-1">{monthLabel(month)}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, -1))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, 1))}>
            Next
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {appointments.isPending && <p>Loading…</p>}
          <FormError error={appointments.error} />
          {appointments.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No appointments this month.</p>
          )}
          {appointments.data && appointments.data.meta.total > LIMIT && (
            <p role="status" className="text-sm">
              Showing the first {LIMIT} of {appointments.data.meta.total} appointments this month.
            </p>
          )}
          {/* Phones get a list of the days that have something on, not seven tiny columns. */}
          <div className="grid gap-1 sm:grid-cols-7">
            {WEEKDAYS.map((day) => (
              <div key={day} className="hidden text-center text-xs font-medium sm:block">
                {day}
              </div>
            ))}
            {Array.from({ length: leading }, (_, i) => (
              <div key={i} className="hidden sm:block" />
            ))}
            {days.map((day) => {
              const items = (appointments.data?.data ?? []).filter(
                (item) => manilaDay(item.startsAt) === day,
              );
              return (
                <section
                  key={day}
                  aria-label={day}
                  className={`min-h-20 min-w-0 rounded-md border p-1 ${
                    items.length === 0 ? 'hidden sm:block' : ''
                  } ${day === today ? 'border-primary' : ''}`}
                >
                  <h2 className="text-xs font-medium">
                    <span className="sm:hidden">{day}</span>
                    <span className="hidden sm:inline">{Number(day.slice(8))}</span>
                  </h2>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`mt-1 block w-full break-words rounded bg-muted p-1 text-left text-xs ${
                        item.status === 'cancelled' || item.status === 'no_show'
                          ? 'line-through'
                          : ''
                      }`}
                      onClick={() => setEditing(item)}
                    >
                      {formatTime(item.startsAt)} {APPOINTMENT_TYPE_LABELS[item.type]}
                      {item.client && `: ${item.client.fullName}`}
                      {item.status !== 'scheduled' &&
                        ` (${APPOINTMENT_STATUS_LABELS[item.status]})`}
                    </button>
                  ))}
                </section>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AppointmentForm({
  tenantId,
  appointment,
  prefill,
  onDone,
}: {
  tenantId: string;
  appointment: Appointment | null;
  prefill: URLSearchParams;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['appointments', tenantId] });
  const [type, setType] = useState<AppointmentType>(
    appointment?.type ?? ((prefill.get('type') as AppointmentType | null) || 'consultation'),
  );
  const [startsAt, setStartsAt] = useState(appointment ? toManilaInput(appointment.startsAt) : '');
  const [endsAt, setEndsAt] = useState(appointment ? toManilaInput(appointment.endsAt) : '');
  const [clientId, setClientId] = useState(appointment?.clientId ?? prefill.get('clientId') ?? '');
  const [projectId, setProjectId] = useState(
    appointment?.projectId ?? prefill.get('projectId') ?? '',
  );
  const [garmentId, setGarmentId] = useState(
    appointment?.garmentId ?? prefill.get('garmentId') ?? '',
  );
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [invalid, setInvalid] = useState<string | null>(null);
  const locked = Boolean(appointment && appointment.status !== 'scheduled');

  // shortcut: offers the first 100 clients by name, add a search box when an atelier outgrows that.
  const clients = useQuery({
    queryKey: ['clients', tenantId, 'appointment-options'],
    queryFn: () => apiFetchPage<Client>('/clients?limit=100', { tenantId }),
  });
  const projects = useQuery({
    queryKey: ['projects', tenantId, 'client', clientId, 'appointment-options'],
    queryFn: () => apiFetchPage<Project>(`/clients/${clientId}/projects?limit=100`, { tenantId }),
    enabled: Boolean(clientId),
  });
  const garments = useQuery({
    queryKey: ['garments', tenantId, 'project', projectId],
    queryFn: () => apiFetch<Garment[]>(`/projects/${projectId}/garments`, { tenantId }),
    enabled: Boolean(projectId),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        type,
        startsAt: fromManilaInput(startsAt),
        endsAt: fromManilaInput(endsAt),
        clientId: clientId || null,
        projectId: projectId || null,
        garmentId: garmentId || null,
        location,
        notes,
      };
      return appointment
        ? apiFetch(`/appointments/${appointment.id}`, { tenantId, method: 'PATCH', body })
        : apiFetch('/appointments', { tenantId, method: 'POST', body });
    },
    onSuccess: () => {
      void refresh();
      if (appointment) {
        onDone();
        return;
      }
      setStartsAt('');
      setEndsAt('');
      setLocation('');
      setNotes('');
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: AppointmentStatus) =>
      apiFetch(`/appointments/${appointment!.id}/status`, {
        tenantId,
        method: 'POST',
        body: { status },
      }),
    onSuccess: () => {
      void refresh();
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!startsAt || !endsAt) return setInvalid('Enter when it starts and ends.');
    if (new Date(fromManilaInput(endsAt)) <= new Date(fromManilaInput(startsAt))) {
      return setInvalid('The end must be after the start.');
    }
    setInvalid(null);
    save.mutate();
  };

  // An archived record no longer appears in the lists, so offer the current one anyway.
  const withCurrent = <T extends { id: string }>(items: T[] | undefined, current: T | null) =>
    current && !items?.some((item) => item.id === current.id)
      ? [current, ...(items ?? [])]
      : (items ?? []);
  const clientOptions = withCurrent<{ id: string; fullName: string }>(
    clients.data?.data,
    appointment?.client ?? null,
  );
  const projectOptions = withCurrent<{ id: string; projectNumber: string; title: string }>(
    projects.data?.data,
    appointment?.project ?? null,
  );
  const garmentOptions = withCurrent<{ id: string; name: string; wearerName: string }>(
    garments.data,
    appointment?.garment ?? null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {appointment
            ? `${APPOINTMENT_TYPE_LABELS[appointment.type]}: ${APPOINTMENT_STATUS_LABELS[appointment.status]}`
            : 'Schedule an appointment'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={submit} noValidate>
          <Field id="appt-type" label="Type">
            <select
              id="appt-type"
              className={`${selectClass} block w-full`}
              value={type}
              disabled={locked}
              onChange={(e) => setType(e.target.value as AppointmentType)}
            >
              {APPOINTMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {APPOINTMENT_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="appt-start" label="Starts (Manila time)">
            <Input
              id="appt-start"
              type="datetime-local"
              value={startsAt}
              disabled={locked}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field id="appt-end" label="Ends (Manila time)">
            <Input
              id="appt-end"
              type="datetime-local"
              value={endsAt}
              disabled={locked}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Field>
          <Field id="appt-client" label="Client (optional)">
            <select
              id="appt-client"
              className={`${selectClass} block w-full`}
              value={clientId}
              disabled={locked}
              onChange={(e) => {
                setClientId(e.target.value);
                setProjectId('');
                setGarmentId('');
              }}
            >
              <option value="">None</option>
              {/* Prefilled from a client page that isn't among the first 100. */}
              {clientId && !clientOptions.some((c) => c.id === clientId) && (
                <option value={clientId}>Selected client</option>
              )}
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field id="appt-project" label="Order (optional)">
            <select
              id="appt-project"
              className={`${selectClass} block w-full`}
              value={projectId}
              disabled={locked || !clientId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setGarmentId('');
              }}
            >
              <option value="">None</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.projectNumber}: {project.title}
                </option>
              ))}
            </select>
          </Field>
          <Field id="appt-garment" label="Garment (optional)">
            <select
              id="appt-garment"
              className={`${selectClass} block w-full`}
              value={garmentId}
              disabled={locked || !projectId}
              onChange={(e) => setGarmentId(e.target.value)}
            >
              <option value="">None</option>
              {garmentOptions.map((garment) => (
                <option key={garment.id} value={garment.id}>
                  {garment.name} for {garment.wearerName}
                </option>
              ))}
            </select>
          </Field>
          <Field id="appt-location" label="Location">
            <Input
              id="appt-location"
              maxLength={200}
              value={location}
              disabled={locked}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id="appt-notes" label="Notes">
              <textarea
                id="appt-notes"
                rows={2}
                className={textareaClass}
                value={notes}
                disabled={locked}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          <div className="space-y-2 sm:col-span-3">
            {invalid && (
              <p role="alert" className="text-sm text-destructive">
                {invalid}
              </p>
            )}
            <FormError
              error={
                save.error ?? setStatus.error ?? clients.error ?? projects.error ?? garments.error
              }
            />
            <div className="flex flex-wrap gap-2">
              {!locked && (
                <Button type="submit" disabled={save.isPending}>
                  {appointment ? 'Save changes' : 'Schedule'}
                </Button>
              )}
              {appointment?.status === 'scheduled' &&
                (['completed', 'cancelled', 'no_show'] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    variant="outline"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate(status)}
                  >
                    Mark {APPOINTMENT_STATUS_LABELS[status].toLowerCase()}
                  </Button>
                ))}
              {locked && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate('scheduled')}
                >
                  Back to scheduled
                </Button>
              )}
              {appointment && (
                <Button type="button" variant="outline" onClick={onDone}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
