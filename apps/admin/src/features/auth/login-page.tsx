import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';

const schema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
type Credentials = z.infer<typeof schema>;

export function LoginPage({ notice }: { notice?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<Credentials>({ resolver: zodResolver(schema) });

  async function signIn(credentials: Credentials) {
    setFailed(null);
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) {
      setFailed(
        error.status === 400 ? 'Incorrect email or password.' : 'Could not sign in. Try again.',
      );
    }
  }

  async function sendReset() {
    setFailed(null);
    if (!(await trigger('email'))) return;
    const { error } = await supabase.auth.resetPasswordForEmail(getValues('email'), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // The same message either way, so this can't reveal whether an account exists.
    if (error && error.status !== 400 && error.status !== 422) {
      setFailed('Could not send the email. Try again.');
    } else {
      setResetSent(true);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to TahiPh</CardTitle>
        </CardHeader>
        <CardContent>
          {notice && <p className="mb-4 text-sm text-muted-foreground">{notice}</p>}
          <form className="space-y-4" onSubmit={handleSubmit(signIn)} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                {...register('email')}
              />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            {failed && (
              <p role="alert" className="text-sm text-destructive">
                {failed}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              onClick={() => void sendReset()}
            >
              Forgot your password?
            </Button>
            {resetSent && (
              <p role="status" className="text-sm text-muted-foreground">
                If that email has an account, a reset link is on its way.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
