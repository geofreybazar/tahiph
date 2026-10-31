import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  clientInputSchema,
  createProjectSchema,
  formatCentavos,
  measurementProfileInputSchema,
  pesosToCentavos,
} from '@tahi/shared';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { Field, textareaClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PaymentList, type Payment } from '@/features/payments/payment-list';
import type { Project } from '@/features/projects/projects-page';
import { apiFetch, apiFetchPage } from '@/lib/api';
import { useTenantAccess } from '@/lib/use-tenant-access';
import type { Client, ClientInput, ClientOutput } from './clients-page';

export interface ProfileSummary {
  id: string;
  personName: string;
  records: { id: string; takenOn: string; unit: string }[];
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { tenantId, manager } = useTenantAccess();
  const queryClient = useQueryClient();
  const client = useQuery({
    queryKey: ['clients', tenantId, id],
    queryFn: () => apiFetch<Client>(`/clients/${id}`, { tenantId }),
  });
  const archive = useMutation({
    mutationFn: () => apiFetch(`/clients/${id}/archive`, { tenantId, method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['clients', tenantId] }),
  });

  if (client.isPending) return <p>Loading…</p>;
  if (client.isError) return <FormError error={client.error} />;
  const archived = Boolean(client.data.archivedAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 break-words text-2xl font-semibold">
          {client.data.fullName}
        </h1>
        {archived && <span className="text-sm text-muted-foreground">Archived</span>}
        {manager && !archived && (
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm(`Archive ${client.data.fullName}?`)) archive.mutate();
            }}
          >
            Archive
          </Button>
        )}
      </div>
      <FormError error={archive.error} />
      <EditClient key={client.data.id} client={client.data} tenantId={tenantId} />
      <ClientProjects clientId={id} tenantId={tenantId} canAdd={!archived} />
      <ClientPayments clientId={id} tenantId={tenantId} />
      <Profiles clientId={id} tenantId={tenantId} canAdd={!archived} />
    </div>
  );
}

function EditClient({ client, tenantId }: { client: Client; tenantId: string }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientInput, unknown, ClientOutput>({
    resolver: zodResolver(clientInputSchema),
    defaultValues: client,
  });
  const save = useMutation({
    mutationFn: (body: ClientOutput) =>
      apiFetch(`/clients/${client.id}`, { tenantId, method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients', tenantId] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={handleSubmit((v) => save.mutate(v))}
          noValidate
        >
          <Field id="edit-name" label="Full name" error={errors.fullName && 'Enter a name.'}>
            <Input id="edit-name" {...register('fullName')} />
          </Field>
          <Field id="edit-email" label="Email" error={errors.email && 'Enter a valid email.'}>
            <Input id="edit-email" type="email" {...register('email')} />
          </Field>
          <Field id="edit-phone" label="Phone">
            <Input id="edit-phone" {...register('phone')} />
          </Field>
          <div className="sm:col-span-3">
            <Field id="edit-notes" label="Notes">
              <textarea id="edit-notes" rows={3} className={textareaClass} {...register('notes')} />
            </Field>
          </div>
          <div className="sm:col-span-3">
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

const newProjectSchema = createProjectSchema.omit({ clientId: true, priceCentavos: true }).extend({
  price: z.string().refine((value) => pesosToCentavos(value) !== null),
});

function ClientProjects({
  clientId,
  tenantId,
  canAdd,
}: {
  clientId: string;
  tenantId: string;
  canAdd: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: ['projects', tenantId, 'client', clientId],
    queryFn: () => apiFetchPage<Project>(`/clients/${clientId}/projects?limit=100`, { tenantId }),
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.input<typeof newProjectSchema>, unknown, z.output<typeof newProjectSchema>>({
    resolver: zodResolver(newProjectSchema),
  });
  const create = useMutation({
    mutationFn: ({ price, ...rest }: z.output<typeof newProjectSchema>) =>
      apiFetch<Project>('/projects', {
        tenantId,
        method: 'POST',
        body: { ...rest, clientId, priceCentavos: pesosToCentavos(price) },
      }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects', tenantId] });
      void navigate(`/orders/${project.id}`);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wedding projects</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {projects.isPending && <p>Loading…</p>}
        <FormError error={projects.error} />
        {projects.data?.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        )}
        <ul className="divide-y">
          {projects.data?.data.map((project) => (
            <li key={project.id} className="flex flex-wrap gap-3 py-3">
              <Link
                className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline"
                to={`/orders/${project.id}`}
              >
                {project.projectNumber}: {project.title}
              </Link>
              <span className="text-sm text-muted-foreground">
                {project.status}, {formatCentavos(project.priceCentavos)}
              </span>
            </li>
          ))}
        </ul>
        {canAdd && (
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={handleSubmit((v) => create.mutate(v))}
            noValidate
          >
            <Field id="project-title" label="Title" error={errors.title && 'Enter a title.'}>
              <Input id="project-title" {...register('title')} />
            </Field>
            <Field id="project-date" label="Wedding date">
              <Input id="project-date" type="date" {...register('weddingDate')} />
            </Field>
            <Field
              id="project-price"
              label="Price (₱)"
              error={errors.price && 'Enter an amount, like 1,500.50.'}
            >
              <Input id="project-price" inputMode="decimal" {...register('price')} />
            </Field>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={create.isPending}>
                Add project
              </Button>
              <FormError error={create.error} />
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Profiles({
  clientId,
  tenantId,
  canAdd,
}: {
  clientId: string;
  tenantId: string;
  canAdd: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ['measurement-profiles', tenantId, clientId];
  const profiles = useQuery({
    queryKey: key,
    queryFn: () =>
      apiFetch<ProfileSummary[]>(`/clients/${clientId}/measurement-profiles`, { tenantId }),
  });
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<
    z.input<typeof measurementProfileInputSchema>,
    unknown,
    z.output<typeof measurementProfileInputSchema>
  >({ resolver: zodResolver(measurementProfileInputSchema) });
  const create = useMutation({
    mutationFn: (body: z.output<typeof measurementProfileInputSchema>) =>
      apiFetch(`/clients/${clientId}/measurement-profiles`, { tenantId, method: 'POST', body }),
    onSuccess: () => {
      reset();
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Measurements</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {profiles.isPending && <p>Loading…</p>}
        <FormError error={profiles.error} />
        {profiles.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No measurement profiles yet.</p>
        )}
        <ul className="divide-y">
          {profiles.data?.map((profile) => (
            <li key={profile.id} className="flex flex-wrap gap-3 py-3">
              <Link
                className="min-w-0 flex-1 font-medium underline-offset-4 hover:underline"
                to={`/measurements/${profile.id}`}
              >
                {profile.personName}
              </Link>
              <span className="text-sm text-muted-foreground">
                {profile.records.length} {profile.records.length === 1 ? 'fitting' : 'fittings'}
              </span>
            </li>
          ))}
        </ul>
        {canAdd && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={handleSubmit((v) => create.mutate(v))}
            noValidate
          >
            <div className="min-w-56 flex-1">
              <Field
                id="profile-name"
                label="Person's name"
                error={errors.personName && 'Enter a name.'}
              >
                <Input id="profile-name" {...register('personName')} />
              </Field>
            </div>
            <Button type="submit" disabled={create.isPending}>
              Add profile
            </Button>
          </form>
        )}
        <FormError error={create.error} />
      </CardContent>
    </Card>
  );
}

function ClientPayments({ clientId, tenantId }: { clientId: string; tenantId: string }) {
  const payments = useQuery({
    queryKey: ['projects', tenantId, 'client-payments', clientId],
    queryFn: () => apiFetch<Payment[]>(`/clients/${clientId}/payments`, { tenantId }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {payments.isPending && <p>Loading…</p>}
        <FormError error={payments.error} />
        {payments.data && <PaymentList payments={payments.data} tenantId={tenantId} showProject />}
      </CardContent>
    </Card>
  );
}
