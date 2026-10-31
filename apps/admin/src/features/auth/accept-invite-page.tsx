import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useSession } from '@/app/session';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api';
import { arrivedWithExpiredLink, supabase } from '@/lib/supabase';
import { rememberTenant } from '@/lib/tenants';
import { LoginPage } from './login-page';

const MIN_PASSWORD = 8;

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { session } = useSession();

  if (!token) {
    return (
      <main className="flex min-h-svh items-center justify-center p-4">
        <p role="alert">This invitation link is incomplete. Ask for a new one.</p>
      </main>
    );
  }
  if (!session) {
    const notice = arrivedWithExpiredLink
      ? 'This email link has expired or was already used. Sign in if you have a password, use "Forgot your password?", or ask for a new invitation.'
      : 'Sign in with the email that was invited to accept this invitation.';
    return <LoginPage notice={notice} />;
  }
  return <AcceptForm token={token} email={session.user.email ?? ''} />;
}

function AcceptForm({ token, email }: { token: string; email: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  // Someone arriving from the invitation email has an account with no password yet.
  const [needsPassword, setNeedsPassword] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      const methods = data?.currentAuthenticationMethods ?? [];
      setNeedsPassword(
        !methods.some((entry) => (typeof entry === 'string' ? entry : entry.method) === 'password'),
      );
    });
  }, []);

  const accept = useMutation({
    mutationFn: async () => {
      if (needsPassword) {
        if (password.length < MIN_PASSWORD) {
          throw new Error(`Use at least ${MIN_PASSWORD} characters for your password.`);
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      }
      return apiFetch<{ tenantId: string }>('/invitations/accept', {
        method: 'POST',
        body: { token },
      });
    },
    onSuccess: async ({ tenantId }) => {
      rememberTenant(tenantId);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      void navigate('/', { replace: true });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    accept.mutate();
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Accept your invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <p className="text-sm text-muted-foreground">Signed in as {email}.</p>
            {needsPassword && (
              <div className="space-y-2">
                <Label htmlFor="new-password">Choose a password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            )}
            <FormError error={accept.error} />
            <Button
              type="submit"
              className="w-full"
              disabled={accept.isPending || needsPassword === null}
            >
              {accept.isPending ? 'Accepting…' : 'Accept invitation'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void supabase.auth.signOut()}
            >
              Use a different account
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
