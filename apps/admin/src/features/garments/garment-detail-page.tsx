import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GARMENT_STAGE_LABELS,
  GARMENT_STAGES,
  garmentInputSchema,
  WEARER_ROLES,
} from '@tahi/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { Field, selectClass, textareaClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LinkedAppointments } from '@/features/appointments/linked-appointments';
import type { ProfileSummary } from '@/features/clients/client-detail-page';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useTenantAccess } from '@/lib/use-tenant-access';
import { GarmentFiles } from './garment-files';
import type { Garment, GarmentStage } from './production-page';

interface StageEvent {
  id: string;
  fromStage: GarmentStage | null;
  toStage: GarmentStage;
  note: string | null;
  occurredAt: string;
  changedBy: { email: string; fullName: string | null };
}

export function GarmentDetailPage() {
  const { id = '' } = useParams();
  const { tenantId, manager } = useTenantAccess();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const garment = useQuery({
    queryKey: ['garments', tenantId, 'detail', id],
    queryFn: () => apiFetch<Garment>(`/garments/${id}`, { tenantId }),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/garments/${id}`, { tenantId, method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['garments', tenantId, 'detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['garments', tenantId] });
      void navigate(`/orders/${garment.data!.project.id}`);
    },
  });

  if (garment.isPending) return <p>Loading…</p>;
  if (garment.isError) return <FormError error={garment.error} />;
  const { data } = garment;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold">{data.name}</h1>
          <Link
            className="text-sm underline-offset-4 hover:underline"
            to={`/orders/${data.project.id}`}
          >
            {data.project.projectNumber}: {data.project.title}
          </Link>
        </div>
        {manager && (
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm(`Remove ${data.name}?`)) remove.mutate();
            }}
          >
            Remove
          </Button>
        )}
      </div>
      <FormError error={remove.error} />
      <EditGarment key={data.id} garment={data} tenantId={tenantId} />
      <GarmentFiles garmentId={data.id} tenantId={tenantId} />
      <LinkedAppointments
        tenantId={tenantId}
        filter={{ garmentId: data.id }}
        schedule={{
          clientId: data.project.clientId,
          projectId: data.project.id,
          garmentId: data.id,
          type: 'fitting',
        }}
      />
      <Stage key={`stage-${data.stage}`} garment={data} tenantId={tenantId} />
    </div>
  );
}

type GarmentFormInput = z.input<typeof garmentInputSchema>;
type GarmentFormOutput = z.output<typeof garmentInputSchema>;

function EditGarment({ garment, tenantId }: { garment: Garment; tenantId: string }) {
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ['measurement-profiles', tenantId, garment.project.clientId],
    queryFn: () =>
      apiFetch<ProfileSummary[]>(`/clients/${garment.project.clientId}/measurement-profiles`, {
        tenantId,
      }),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GarmentFormInput, unknown, GarmentFormOutput>({
    resolver: zodResolver(garmentInputSchema),
    defaultValues: garment,
  });
  const [recordId, setRecordId] = useState(garment.measurementRecordId ?? '');
  const save = useMutation({
    mutationFn: (body: GarmentFormOutput) =>
      apiFetch(`/garments/${garment.id}`, {
        tenantId,
        method: 'PATCH',
        body: { ...body, measurementRecordId: recordId || null },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['garments', tenantId] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={handleSubmit((v) => save.mutate(v))}
          noValidate
        >
          <Field id="edit-name" label="Garment" error={errors.name && 'Enter a name.'}>
            <Input id="edit-name" {...register('name')} />
          </Field>
          <Field id="edit-wearer" label="Worn by" error={errors.wearerName && 'Enter a name.'}>
            <Input id="edit-wearer" {...register('wearerName')} />
          </Field>
          <Field id="edit-role" label="Role">
            <select
              id="edit-role"
              className={`${selectClass} block w-full`}
              {...register('wearerRole')}
            >
              {WEARER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </Field>
          <Field id="edit-due" label="Due date">
            <Input id="edit-due" type="date" {...register('dueDate')} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="edit-record" label="Measurements used">
              <select
                id="edit-record"
                className={`${selectClass} block w-full`}
                value={recordId}
                disabled={profiles.isPending}
                onChange={(event) => setRecordId(event.target.value)}
              >
                <option value="">None assigned</option>
                {profiles.data?.flatMap((profile) =>
                  profile.records.map((record) => (
                    <option key={record.id} value={record.id}>
                      {profile.personName}, {formatDate(record.takenOn)} ({record.unit})
                    </option>
                  )),
                )}
              </select>
            </Field>
            <FormError error={profiles.error} />
          </div>
          <div className="sm:col-span-2">
            <Field id="edit-description" label="Design details">
              <textarea
                id="edit-description"
                rows={4}
                className={textareaClass}
                {...register('description')}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            {/* A failed profile load must not read as "None assigned" and clear the assignment. */}
            <Button type="submit" disabled={save.isPending || !profiles.isSuccess}>
              Save
            </Button>
            {save.isSuccess && (
              <span className="ml-3 text-sm" role="status">
                Saved.
              </span>
            )}
            <FormError error={save.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Stage({ garment, tenantId }: { garment: Garment; tenantId: string }) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<GarmentStage>(garment.stage);
  const [note, setNote] = useState('');
  const history = useQuery({
    queryKey: ['garments', tenantId, 'history', garment.id],
    queryFn: () => apiFetch<StageEvent[]>(`/garments/${garment.id}/stage-events`, { tenantId }),
  });
  const move = useMutation({
    mutationFn: () =>
      apiFetch(`/garments/${garment.id}/stage`, {
        tenantId,
        method: 'POST',
        body: { stage, note },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['garments', tenantId] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage: {GARMENT_STAGE_LABELS[garment.stage]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            move.mutate();
          }}
        >
          <Field id="move-stage" label="Move to">
            <select
              id="move-stage"
              className={`${selectClass} block`}
              value={stage}
              onChange={(event) => setStage(event.target.value as GarmentStage)}
            >
              {GARMENT_STAGES.map((value) => (
                <option key={value} value={value}>
                  {GARMENT_STAGE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-56 flex-1">
            <Field id="move-note" label="Note">
              <Input
                id="move-note"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" disabled={move.isPending || stage === garment.stage}>
            Move
          </Button>
        </form>
        <FormError error={move.error ?? history.error} />
        {history.isPending && <p>Loading…</p>}
        <ol className="divide-y">
          {history.data?.map((event) => (
            <li key={event.id} className="py-2 text-sm">
              <p>
                {event.fromStage ? `${GARMENT_STAGE_LABELS[event.fromStage]} → ` : ''}
                {GARMENT_STAGE_LABELS[event.toStage]}
              </p>
              <p className="break-words text-muted-foreground">
                {formatDate(event.occurredAt)}, {event.changedBy.fullName ?? event.changedBy.email}
                {event.note && `: ${event.note}`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
