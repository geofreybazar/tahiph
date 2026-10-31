import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvitationSchema, type IssuedInvitation, type TenantRole } from '@tahi/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useMe, useTenant } from '@/app/session';
import { selectClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Member {
  id: string;
  role: TenantRole;
  email: string;
  fullName: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: TenantRole;
  expiresAt: string;
}



export function MembersPage() {
  const { tenant } = useTenant();
  const me = useMe();
  const queryClient = useQueryClient();
  const tenantId = tenant!.id;
  const isOwner = tenant!.role === 'owner';

  const members = useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => apiFetch<Member[]>('/members', { tenantId }),
  });
  const invitations = useQuery({
    queryKey: ['invitations', tenantId],
    queryFn: () => apiFetch<Invitation[]>('/invitations', { tenantId }),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['members', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['invitations', tenantId] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: TenantRole }) =>
      apiFetch(`/members/${id}`, { tenantId, method: 'PATCH', body: { role } }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/members/${id}`, { tenantId, method: 'DELETE' }),
    onSettled: refresh,
  });
  const transfer = useMutation({
    mutationFn: (membershipId: string) =>
      apiFetch('/members/transfer-ownership', {
        tenantId,
        method: 'POST',
        body: { membershipId },
      }),
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/invitations/${id}`, { tenantId, method: 'DELETE' }),
    onSettled: refresh,
  });

  const canManage = (member: Member) =>
    member.role !== 'owner' &&
    member.email !== me.data?.email &&
    (isOwner || member.role === 'staff');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Team</h1>

      <InviteForm tenantId={tenantId} canInviteAdmins={isOwner} onInvited={refresh} />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.isPending && <p>Loading…</p>}
          <FormError error={members.error} />
          <FormError error={changeRole.error ?? remove.error ?? transfer.error} />
          <ul className="divide-y">
            {members.data?.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 break-words">
                  {member.fullName ?? member.email}
                </span>
                {canManage(member) ? (
                  <select
                    aria-label={`Role for ${member.email}`}
                    className={selectClass}
                    value={member.role}
                    disabled={!isOwner}
                    onChange={(event) =>
                      changeRole.mutate({ id: member.id, role: event.target.value as TenantRole })
                    }
                  >
                    {isOwner && <option value="admin">admin</option>}
                    <option value="staff">staff</option>
                  </select>
                ) : (
                  <span className="text-sm text-muted-foreground">{member.role}</span>
                )}
                {canManage(member) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Remove ${member.email} from ${tenant!.name}?`)) {
                        remove.mutate(member.id);
                      }
                    }}
                  >
                    Remove
                  </Button>
                )}
                {isOwner && member.role !== 'owner' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const question = `Make ${member.email} the owner? You will become an admin.`;
                      if (window.confirm(question)) transfer.mutate(member.id);
                    }}
                  >
                    Make owner
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormError error={invitations.error ?? revoke.error} />
          {invitations.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No pending invitations.</p>
          )}
          <ul className="divide-y">
            {invitations.data?.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1 break-words">{invitation.email}</span>
                <span className="text-sm text-muted-foreground">
                  {invitation.role}, expires {formatDate(invitation.expiresAt)}
                </span>
                <Button variant="outline" size="sm" onClick={() => revoke.mutate(invitation.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

type InviteInput = z.input<typeof createInvitationSchema>;
type InviteOutput = z.output<typeof createInvitationSchema>;

function InviteForm({
  tenantId,
  canInviteAdmins,
  onInvited,
}: {
  tenantId: string;
  canInviteAdmins: boolean;
  onInvited: () => void;
}) {
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteInput, unknown, InviteOutput>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { role: 'staff' },
  });
  const invite = useMutation({
    mutationFn: (body: InviteOutput) =>
      apiFetch<IssuedInvitation>('/invitations', { tenantId, method: 'POST', body }),
    onSuccess: (data) => {
      setIssued(data);
      reset();
      onInvited();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite someone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={handleSubmit((values) => {
            setIssued(null);
            invite.mutate(values);
          })}
          noValidate
        >
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <select id="invite-role" className={`${selectClass} block`} {...register('role')}>
              <option value="staff">staff</option>
              {canInviteAdmins && <option value="admin">admin</option>}
            </select>
          </div>
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Inviting…' : 'Send invitation'}
          </Button>
        </form>
        {errors.email && <p className="text-sm text-destructive">Enter a valid email.</p>}
        <FormError error={invite.error} />
        {issued && <InvitationLink invitation={issued} />}
      </CardContent>
    </Card>
  );
}

export function InvitationLink({ invitation }: { invitation: IssuedInvitation }) {
  return (
    <div role="status" className="space-y-2 rounded-md border p-3 text-sm">
      <p>
        {invitation.emailSent
          ? `Invitation emailed to ${invitation.email}. You can also share this link with them.`
          : `${invitation.email} may already have an account, so no email was sent. Share this link with them.`}{' '}
        It works once, and only for that email. It won't be shown again.
      </p>
      <Input aria-label="Invitation link" readOnly value={invitation.acceptUrl} />
    </div>
  );
}
