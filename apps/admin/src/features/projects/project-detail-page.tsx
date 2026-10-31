import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatCentavos,
  GARMENT_STAGE_LABELS,
  garmentInputSchema,
  pesosToCentavos,
  PROJECT_STATUSES,
  updateProjectSchema,
  WEARER_ROLES,
} from '@tahi/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import type { z } from 'zod';
import { Field, selectClass, textareaClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Garment } from '@/features/garments/production-page';
import { apiFetch } from '@/lib/api';
import { useTenantAccess } from '@/lib/use-tenant-access';
import { PaymentSchedule } from './payment-schedule';
import type { Project } from './projects-page';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { tenantId, manager } = useTenantAccess();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['projects', tenantId] });
  const project = useQuery({
    queryKey: ['projects', tenantId, 'detail', id],
    queryFn: () => apiFetch<Project>(`/projects/${id}`, { tenantId }),
  });
  const setStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/projects/${id}/status`, { tenantId, method: 'POST', body: { status } }),
    onSettled: refresh,
  });
  const archive = useMutation({
    mutationFn: () => apiFetch(`/projects/${id}/archive`, { tenantId, method: 'POST' }),
    onSettled: refresh,
  });

  if (project.isPending) return <p>Loading…</p>;
  if (project.isError) return <FormError error={project.error} />;
  const { data } = project;
  const archived = Boolean(data.archivedAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-2xl font-semibold">
            {data.projectNumber}: {data.title}
          </h1>
          <Link
            className="text-sm underline-offset-4 hover:underline"
            to={`/clients/${data.client.id}`}
          >
            {data.client.fullName}
          </Link>
        </div>
        {archived && <span className="text-sm text-muted-foreground">Archived</span>}
        <select
          aria-label="Status"
          className={selectClass}
          value={data.status}
          onChange={(event) => setStatus.mutate(event.target.value)}
        >
          {PROJECT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {manager && !archived && (
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm(`Archive ${data.projectNumber}?`)) archive.mutate();
            }}
          >
            Archive
          </Button>
        )}
      </div>
      <FormError error={setStatus.error ?? archive.error} />
      <EditProject key={data.id} project={data} tenantId={tenantId} />
      <Price
        key={`price-${data.priceCentavos}`}
        project={data}
        tenantId={tenantId}
        manager={manager}
      />
      <PaymentSchedule project={data} tenantId={tenantId} manager={manager} canEdit={!archived} />
      <Garments projectId={id} tenantId={tenantId} canAdd={!archived} />
    </div>
  );
}

type UpdateInput = z.input<typeof updateProjectSchema>;
type UpdateOutput = z.output<typeof updateProjectSchema>;

function EditProject({ project, tenantId }: { project: Project; tenantId: string }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateInput, unknown, UpdateOutput>({
    resolver: zodResolver(updateProjectSchema),
    defaultValues: project,
  });
  const save = useMutation({
    mutationFn: (body: UpdateOutput) =>
      apiFetch(`/projects/${project.id}`, { tenantId, method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', tenantId] }),
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
          <Field id="edit-title" label="Title" error={errors.title && 'Enter a title.'}>
            <Input id="edit-title" {...register('title')} />
          </Field>
          <Field id="edit-date" label="Wedding date">
            <Input id="edit-date" type="date" {...register('weddingDate')} />
          </Field>
          <div className="sm:col-span-2">
            <Field id="edit-notes" label="Notes">
              <textarea id="edit-notes" rows={3} className={textareaClass} {...register('notes')} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
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

function Price({
  project,
  tenantId,
  manager,
}: {
  project: Project;
  tenantId: string;
  manager: boolean;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const change = useMutation({
    mutationFn: (priceCentavos: number) =>
      apiFetch(`/projects/${project.id}/price`, {
        tenantId,
        method: 'PATCH',
        body: { priceCentavos },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects', tenantId] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Price: {formatCentavos(project.priceCentavos)}</CardTitle>
      </CardHeader>
      {manager && (
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const centavos = pesosToCentavos(value);
              setInvalid(centavos === null);
              if (centavos !== null) change.mutate(centavos);
            }}
            noValidate
          >
            <Field
              id="new-price"
              label="New price (₱)"
              error={invalid ? 'Enter an amount, like 1,500.50.' : undefined}
            >
              <Input
                id="new-price"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={change.isPending}>
              Change price
            </Button>
          </form>
          <FormError error={change.error} />
        </CardContent>
      )}
    </Card>
  );
}

function Garments({
  projectId,
  tenantId,
  canAdd,
}: {
  projectId: string;
  tenantId: string;
  canAdd: boolean;
}) {
  const queryClient = useQueryClient();
  const garments = useQuery({
    queryKey: ['garments', tenantId, 'project', projectId],
    queryFn: () => apiFetch<Garment[]>(`/projects/${projectId}/garments`, { tenantId }),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.input<typeof garmentInputSchema>, unknown, z.output<typeof garmentInputSchema>>({
    resolver: zodResolver(garmentInputSchema),
    defaultValues: { wearerRole: 'bride' },
  });
  const create = useMutation({
    mutationFn: (body: z.output<typeof garmentInputSchema>) =>
      apiFetch(`/projects/${projectId}/garments`, { tenantId, method: 'POST', body }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: ['garments', tenantId] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Garments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {garments.isPending && <p>Loading…</p>}
        <FormError error={garments.error} />
        {garments.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No garments yet.</p>
        )}
        <ul className="divide-y">
          {garments.data?.map((garment) => (
            <li key={garment.id} className="flex flex-wrap gap-3 py-3">
              <Link
                className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline"
                to={`/garments/${garment.id}`}
              >
                {garment.name} for {garment.wearerName}
              </Link>
              <span className="text-sm text-muted-foreground">
                {GARMENT_STAGE_LABELS[garment.stage]}
              </span>
            </li>
          ))}
        </ul>
        {canAdd && (
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={handleSubmit((v) => create.mutate(v))}
            noValidate
          >
            <Field id="garment-name" label="Garment" error={errors.name && 'Enter a name.'}>
              <Input id="garment-name" {...register('name')} />
            </Field>
            <Field id="garment-wearer" label="Worn by" error={errors.wearerName && 'Enter a name.'}>
              <Input id="garment-wearer" {...register('wearerName')} />
            </Field>
            <Field id="garment-role" label="Role">
              <select
                id="garment-role"
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
            <Field id="garment-due" label="Due date">
              <Input id="garment-due" type="date" {...register('dueDate')} />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={create.isPending}>
                Add garment
              </Button>
              <FormError error={create.error} />
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
