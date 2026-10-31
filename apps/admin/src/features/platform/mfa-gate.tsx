import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';

/** The API requires aal2 on platform routes; this only gets the session there. */
export function MfaGate({ children }: { children: ReactNode }) {
  const assurance = useQuery({
    queryKey: ['mfa-assurance'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data;
    },
  });

  if (assurance.isPending) return <p>Loading…</p>;
  if (assurance.isError) return <FormError error={assurance.error} />;
  if (assurance.data.currentLevel === 'aal2') return children;
  return assurance.data.nextLevel === 'aal2' ? <MfaChallenge /> : <MfaEnroll />;
}

function CodeForm({
  title,
  factorId,
  children,
}: {
  title: string;
  factorId: string | null;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (result.error) {
      setError(new Error('That code did not work. Check it and try again.'));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['mfa-assurance'] });
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="mfa-code">6-digit code from your authenticator app</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <FormError error={error} />
          <Button type="submit" disabled={busy || !factorId}>
            {busy ? 'Checking…' : 'Verify'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MfaChallenge() {
  const [factorId, setFactorId] = useState<string | null>(null);
  useEffect(() => {
    void supabase.auth.mfa.listFactors().then(({ data }) => {
      setFactorId(data?.totp[0]?.id ?? null);
    });
  }, []);
  return <CodeForm title="Two-factor sign-in" factorId={factorId} />;
}

function MfaEnroll() {
  const [enrollment, setEnrollment] = useState<{
    id: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // An abandoned attempt leaves an unverified factor, which would block a new enrolment.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const factor of factors?.all ?? []) {
        if (factor.status === 'unverified') {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (cancelled) return;
      if (enrollError) setError(enrollError);
      else setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CodeForm title="Set up two-factor sign-in" factorId={enrollment?.id ?? null}>
      <p className="text-sm text-muted-foreground">
        Platform administration requires it. Scan this with an authenticator app.
      </p>
      <FormError error={error} />
      {enrollment && (
        <>
          <img src={enrollment.qr} alt="QR code for your authenticator app" className="size-44" />
          <p className="text-sm break-all">
            Or enter this key: <code data-testid="mfa-secret">{enrollment.secret}</code>
          </p>
        </>
      )}
    </CodeForm>
  );
}
