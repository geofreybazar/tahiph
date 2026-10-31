import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientInputSchema } from '@tahi/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch, apiFetchPage } from '@/lib/api';
import { useTenantAccess } from '@/lib/use-tenant-access';

export interface Client {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archivedAt: string | null;
}

export type ClientInput = z.input<typeof clientInputSchema>;
export type ClientOutput = z.output<typeof clientInputSchema>;

export function ClientsPage() {
  const { tenantId } = useTenantAccess();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const clients = useQuery({
    queryKey: ['clients', tenantId, q, page],
    queryFn: () =>
      apiFetchPage<Client>(`/clients?${new URLSearchParams({ q, page: String(page) })}`, {
        tenantId,
      }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <NewClient tenantId={tenantId} />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Input
            aria-label="Search clients"
            placeholder="Search by name, email or phone"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
          {clients.isPending && <p>Loading…</p>}
          <FormError error={clients.error} />
          {clients.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No clients found.</p>
          )}
          <ul className="divide-y">
            {clients.data?.data.map((client) => (
              <li key={client.id} className="py-3">
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  to={`/clients/${client.id}`}
                >
                  {client.fullName}
                </Link>
                <p className="break-words text-sm text-muted-foreground">
                  {[client.email, client.phone].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
          <Pager meta={clients.data?.meta} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}

function NewClient({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ClientInput, unknown, ClientOutput>({ resolver: zodResolver(clientInputSchema) });
  const create = useMutation({
    mutationFn: (body: ClientOutput) =>
      apiFetch<Client>('/clients', { tenantId, method: 'POST', body }),
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: ['clients', tenantId] });
      void navigate(`/clients/${client.id}`);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a client</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={handleSubmit((values) => create.mutate(values))}
          noValidate
        >
          <Field id="client-name" label="Full name" error={errors.fullName && 'Enter a name.'}>
            <Input id="client-name" {...register('fullName')} />
          </Field>
          <Field id="client-email" label="Email" error={errors.email && 'Enter a valid email.'}>
            <Input id="client-email" type="email" {...register('email')} />
          </Field>
          <Field id="client-phone" label="Phone">
            <Input id="client-phone" {...register('phone')} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={create.isPending}>
              Add client
            </Button>
            <FormError error={create.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
