import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatCentavos,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  pesosToCentavos,
} from '@tahi/shared';
import { type FormEvent, useState } from 'react';
import { Field, selectClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PaymentList, type Payment } from '@/features/payments/payment-list';
import { apiFetch } from '@/lib/api';
import { uploadMedia } from '@/lib/upload';
import type { Project } from './projects-page';

interface ProjectPaymentsData {
  items: Payment[];
  paidCentavos: number;
  refundedCentavos: number;
  balanceCentavos: number;
}

const manilaNow = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Manila',
    dateStyle: 'short',
    timeStyle: 'short',
  })
    .format()
    .replace(' ', 'T');

export function ProjectPayments({
  project,
  tenantId,
  manager,
  canRecord,
}: {
  project: Project;
  tenantId: string;
  manager: boolean;
  canRecord: boolean;
}) {
  const queryClient = useQueryClient();
  const payments = useQuery({
    queryKey: ['projects', tenantId, 'payments', project.id, project.priceCentavos],
    queryFn: () => apiFetch<ProjectPaymentsData>(`/projects/${project.id}/payments`, { tenantId }),
  });
  const voidPayment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/payments/${id}/void`, { tenantId, method: 'POST', body: { reason } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects', tenantId] }),
  });
  const data = payments.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {payments.isPending && <p>Loading…</p>}
        <FormError error={payments.error ?? voidPayment.error} />
        {data && (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">Price</dt>
                <dd>{formatCentavos(project.priceCentavos)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Paid</dt>
                <dd>{formatCentavos(data.paidCentavos)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Refunded</dt>
                <dd>{formatCentavos(data.refundedCentavos)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {data.balanceCentavos < 0 ? 'Overpaid' : 'Balance'}
                </dt>
                <dd className="font-semibold">{formatCentavos(Math.abs(data.balanceCentavos))}</dd>
              </div>
            </dl>
            <PaymentList
              payments={data.items}
              tenantId={tenantId}
              onVoid={
                manager
                  ? (payment) => {
                      const reason = window.prompt('Why is this payment being voided?')?.trim();
                      if (reason) voidPayment.mutate({ id: payment.id, reason });
                    }
                  : undefined
              }
            />
          </>
        )}
        {canRecord && (
          <RecordPayment projectId={project.id} tenantId={tenantId} manager={manager} />
        )}
      </CardContent>
    </Card>
  );
}

function RecordPayment({
  projectId,
  tenantId,
  manager,
}: {
  projectId: string;
  tenantId: string;
  manager: boolean;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(manilaNow);
  const [scheduleItemId, setScheduleItemId] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const [proofId, setProofId] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [invalid, setInvalid] = useState<string | null>(null);
  // Kept across failures, so resubmitting after a lost response can't record the money twice.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const schedule = useQuery({
    queryKey: ['projects', tenantId, 'schedule', projectId, 'options'],
    queryFn: () =>
      apiFetch<{ items: { id: string; label: string }[] }>(
        `/projects/${projectId}/payment-schedule`,
        { tenantId },
      ),
  });
  const record = useMutation({
    mutationFn: async (amountCentavos: number) => {
      // shortcut: a proof uploaded for a payment that's then abandoned stays in storage, sweep confirmed unattached proofs if that grows.
      let proofMediaId = proofId;
      if (proof && !proofMediaId) {
        proofMediaId = await uploadMedia(tenantId, 'payment_proof', proof);
        setProofId(proofMediaId);
      }
      return apiFetch(`/projects/${projectId}/payments`, {
        tenantId,
        method: 'POST',
        idempotencyKey: requestKey,
        body: {
          kind,
          amountCentavos,
          method,
          reference,
          // The field shows Manila time, whatever the device's time zone is.
          paidAt: `${paidAt}:00+08:00`,
          scheduleItemId: scheduleItemId || null,
          proofMediaId,
        },
      });
    },
    onSuccess: () => {
      setRequestKey(crypto.randomUUID());
      setAmount('');
      setReference('');
      setScheduleItemId('');
      setKind('payment');
      setProof(null);
      setProofId(null);
      setFileKey((value) => value + 1);
      setPaidAt(manilaNow());
      void queryClient.invalidateQueries({ queryKey: ['projects', tenantId] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const centavos = pesosToCentavos(amount);
    if (!centavos || !paidAt) {
      setInvalid('Enter an amount above zero, like 1,500.50, and when it was paid.');
      return;
    }
    setInvalid(null);
    record.mutate(centavos);
  };

  return (
    <form className="space-y-3 border-t pt-4" onSubmit={submit} noValidate>
      <h3 className="font-medium">{kind === 'refund' ? 'Record a refund' : 'Record a payment'}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {manager && (
          <Field id="pay-kind" label="Type">
            <select
              id="pay-kind"
              className={`${selectClass} block w-full`}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="payment">Payment</option>
              <option value="refund">Refund</option>
            </select>
          </Field>
        )}
        <Field id="pay-amount" label="Amount (₱)">
          <Input
            id="pay-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field id="pay-method" label="Method">
          <select
            id="pay-method"
            className={`${selectClass} block w-full`}
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pay-at" label="Paid at (Manila time)">
          <Input
            id="pay-at"
            type="datetime-local"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </Field>
        <Field id="pay-ref" label="Reference">
          <Input
            id="pay-ref"
            maxLength={120}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field id="pay-item" label="For scheduled payment">
          <select
            id="pay-item"
            className={`${selectClass} block w-full`}
            value={scheduleItemId}
            onChange={(e) => setScheduleItemId(e.target.value)}
          >
            <option value="">Not linked</option>
            {schedule.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pay-proof" label="Proof (optional)">
          <Input
            key={fileKey}
            id="pay-proof"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              setProof(e.target.files?.[0] ?? null);
              setProofId(null);
            }}
          />
        </Field>
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {invalid}
        </p>
      )}
      <FormError error={record.error} />
      <Button type="submit" disabled={record.isPending}>
        {record.isPending ? 'Saving…' : kind === 'refund' ? 'Record refund' : 'Record payment'}
      </Button>
    </form>
  );
}
