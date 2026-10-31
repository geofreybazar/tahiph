import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTenantSchema, type IssuedInvitation, type TenantStatus } from '@tahi/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch, apiFetchPage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { InvitationLink } from '../members/members-page';
import { MfaGate } from './mfa-gate';

interface PlatformTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
}

type TenantInput = z.input<typeof createTenantSchema>;
type TenantOutput = z.output<typeof createTenantSchema>;

const PAGE_SIZE = 20;

export default function PlatformPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Platform administration</h1>
      <MfaGate>
        <TenantAdmin />
      </MfaGate>
    </div>
  );
}

function TenantAdmin() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const tenants = useQuery({
    queryKey: ['platform-tenants', page],
    queryFn: () =>
      apiFetchPage<PlatformTenant>(`/platform/tenants?page=${page}&limit=${PAGE_SIZE}`),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
  const setStatus = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'suspend' | 'activate' }) =>
      apiFetch(`/platform/tenants/${id}/${action}`, { method: 'POST' }),
    onSettled: refresh,
  });

  const meta = tenants.data?.meta;

  return (
    <>
      <CreateTenantForm onCreated={refresh} />
      <Card>
        <CardHeader>
          <CardTitle>Businesses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tenants.isPending && <p>Loading…</p>}
          <FormError error={tenants.error ?? setStatus.error} />
          {tenants.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No businesses yet.</p>
          )}
          <ul className="divide-y">
            {tenants.data?.data.map((tenant) => (
              <li key={tenant.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 break-words">
                  {tenant.name}
                  <span className="block text-sm text-muted-foreground">
                    {tenant.slug}, created {formatDate(tenant.createdAt)}
                  </span>
                </span>
                <span className="text-sm">{tenant.status}</span>
                {tenant.status === 'active' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const question = `Suspend ${tenant.name}? Its team loses access immediately.`;
                      if (window.confirm(question)) {
                        setStatus.mutate({ id: tenant.id, action: 'suspend' });
                      }
                    }}
                  >
                    Suspend
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus.mutate({ id: tenant.id, action: 'activate' })}
                  >
                    Activate
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center gap-3 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {meta.page} of {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CreateTenantForm({ onCreated }: { onCreated: () => void }) {
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TenantInput, unknown, TenantOutput>({ resolver: zodResolver(createTenantSchema) });
  const create = useMutation({
    mutationFn: (body: TenantOutput) =>
      apiFetch<{ invitation: IssuedInvitation }>('/platform/tenants', { method: 'POST', body }),
    onSuccess: ({ invitation }) => {
      setIssued(invitation);
      reset();
      onCreated();
    },
  });

  const field = (id: keyof TenantInput, label: string, type = 'text') => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} aria-invalid={Boolean(errors[id])} {...register(id)} />
      {errors[id] && <p className="text-sm text-destructive">{errors[id]?.message}</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a business</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={handleSubmit((values) => {
            setIssued(null);
            create.mutate(values);
          })}
          noValidate
        >
          {field('name', 'Business name')}
          {field('slug', 'Web address')}
          {field('ownerEmail', 'Owner email', 'email')}
          <div className="sm:col-span-3">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add business and invite owner'}
            </Button>
          </div>
        </form>
        <FormError error={create.error} />
        {issued && <InvitationLink invitation={issued} />}
      </CardContent>
    </Card>
  );
}
