import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

export const selectClass = 'h-9 rounded-md border bg-background px-2 text-sm';
export const textareaClass = 'block w-full rounded-md border bg-background px-3 py-2 text-sm';

export function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
