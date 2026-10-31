import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCentavos, pesosToCentavos } from '@tahi/shared';
import { type FormEvent, useState } from 'react';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Project } from './projects-page';

interface ScheduleItem {
  id: string;
  label: string;
  dueDate: string;
  amountCentavos: number;
}

interface Schedule {
  items: ScheduleItem[];
  totalCentavos: number;
  differenceCentavos: number;
}

interface Row {
  id?: string;
  label: string;
  dueDate: string;
  amount: string;
}

const toRow = ({ id, label, dueDate, amountCentavos }: ScheduleItem): Row => ({
  id,
  label,
  dueDate,
  amount: formatCentavos(amountCentavos),
});

export function PaymentSchedule({
  project,
  tenantId,
  manager,
  canEdit,
}: {
  project: Project;
  tenantId: string;
  manager: boolean;
  canEdit: boolean;
}) {
  const key = ['projects', tenantId, 'schedule', project.id];
  const path = `/projects/${project.id}/payment-schedule`;
  const queryClient = useQueryClient();
  const schedule = useQuery({
    queryKey: [...key, project.priceCentavos],
    queryFn: () => apiFetch<Schedule>(path, { tenantId }),
  });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (items: unknown[]) => apiFetch(path, { tenantId, method: 'PUT', body: { items } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      setRows(null);
    },
  });

  const change = (index: number, field: keyof Row, value: string) =>
    setRows(rows!.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const items = rows!.map(({ id, label, dueDate, amount }) => ({
      id,
      label: label.trim(),
      dueDate,
      amountCentavos: pesosToCentavos(amount),
    }));
    const valid = items.every((i) => i.label && i.dueDate && i.amountCentavos);
    setInvalid(!valid);
    if (valid) save.mutate(items);
  };

  const data = schedule.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {schedule.isPending && <p>Loading…</p>}
        <FormError error={schedule.error} />
        {data && !rows && (
          <>
            {data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments planned yet.</p>
            ) : (
              <ul className="divide-y">
                {data.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 break-words">{item.label}</span>
                    <span className="text-muted-foreground">Due {formatDate(item.dueDate)}</span>
                    <span>{formatCentavos(item.amountCentavos)}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.items.length > 0 && (
              <p className="text-sm">Scheduled total: {formatCentavos(data.totalCentavos)}</p>
            )}
            {data.items.length > 0 && data.differenceCentavos !== 0 && (
              <p role="status" className="text-sm text-destructive">
                {data.differenceCentavos > 0
                  ? `${formatCentavos(data.differenceCentavos)} of the price isn't scheduled.`
                  : `The schedule is ${formatCentavos(-data.differenceCentavos)} more than the price.`}
              </p>
            )}
            {manager && canEdit && (
              <Button variant="outline" onClick={() => setRows(data.items.map(toRow))}>
                Edit schedule
              </Button>
            )}
          </>
        )}
        {rows && (
          <form className="space-y-3" onSubmit={submit} noValidate>
            {rows.map((row, index) => (
              <fieldset
                key={row.id ?? `new-${index}`}
                className="flex flex-wrap items-center gap-2"
              >
                <legend className="sr-only">Payment {index + 1}</legend>
                <Input
                  className="min-w-40 flex-1"
                  aria-label={`Payment ${index + 1} label`}
                  placeholder="Deposit"
                  value={row.label}
                  onChange={(e) => change(index, 'label', e.target.value)}
                />
                <Input
                  className="w-40"
                  type="date"
                  aria-label={`Payment ${index + 1} due date`}
                  value={row.dueDate}
                  onChange={(e) => change(index, 'dueDate', e.target.value)}
                />
                <Input
                  className="w-36"
                  inputMode="decimal"
                  aria-label={`Payment ${index + 1} amount in pesos`}
                  placeholder="1,500.50"
                  value={row.amount}
                  onChange={(e) => change(index, 'amount', e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove payment ${index + 1}`}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </fieldset>
            ))}
            {invalid && (
              <p role="alert" className="text-sm text-destructive">
                Each payment needs a label, a due date and an amount above zero, like 1,500.50.
              </p>
            )}
            <FormError error={save.error} />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRows([...rows, { label: '', dueDate: '', amount: '' }])}
              >
                Add payment
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Save schedule
              </Button>
              <Button type="button" variant="outline" onClick={() => setRows(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
