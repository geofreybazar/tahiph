import { useQuery } from '@tanstack/react-query';
import { formatCentavos, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@tahi/shared';
import { Link } from 'react-router';
import { FormError } from '@/components/form-error';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { formatDate } from '@/lib/format';

export interface Payment {
  id: string;
  kind: 'payment' | 'refund';
  amountCentavos: number;
  method: (typeof PAYMENT_METHODS)[number];
  reference: string | null;
  paidAt: string;
  proofMediaId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  recordedBy: { email: string; fullName: string | null };
  project: { id: string; projectNumber: string; title: string; client: { fullName: string } };
  scheduleItem: { label: string } | null;
}

// Download URLs last 120 seconds, so the link is refreshed while the page stays open.
const REFRESH_LINK_MS = 100_000;

export function ProofLink({
  mediaId,
  tenantId,
  label = 'View proof',
}: {
  mediaId: string;
  tenantId: string;
  label?: string;
}) {
  const link = useQuery({
    queryKey: ['media-url', tenantId, mediaId],
    queryFn: () => apiFetch<{ url: string }>(`/media/${mediaId}/download-url`, { tenantId }),
    refetchInterval: REFRESH_LINK_MS,
    staleTime: REFRESH_LINK_MS,
  });
  if (link.isError) return <FormError error={link.error} />;
  if (!link.data) return null;
  return (
    <a className="underline" href={link.data.url} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

export function PaymentList({
  payments,
  tenantId,
  showProject = false,
  onVoid,
}: {
  payments: Payment[];
  tenantId: string;
  showProject?: boolean;
  onVoid?: (payment: Payment) => void;
}) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded.</p>;
  }
  return (
    <ul className="divide-y">
      {payments.map((payment) => (
        <li key={payment.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
          <div className="min-w-0 flex-1">
            <p className={payment.voidedAt ? 'line-through' : 'font-medium'}>
              {payment.kind === 'refund' ? 'Refund ' : ''}
              {formatCentavos(payment.amountCentavos)}, {PAYMENT_METHOD_LABELS[payment.method]}
            </p>
            <p className="break-words text-muted-foreground">
              {formatDate(payment.paidAt)}
              {payment.scheduleItem && `, for ${payment.scheduleItem.label}`}
              {payment.reference && `, ref ${payment.reference}`}, recorded by{' '}
              {payment.recordedBy.fullName ?? payment.recordedBy.email}
            </p>
            {showProject && (
              <Link
                className="underline-offset-4 hover:underline"
                to={`/orders/${payment.project.id}`}
              >
                {payment.project.projectNumber}: {payment.project.client.fullName}
              </Link>
            )}
            {payment.voidedAt && (
              <p className="break-words text-destructive">Voided: {payment.voidReason}</p>
            )}
          </div>
          {payment.proofMediaId && <ProofLink mediaId={payment.proofMediaId} tenantId={tenantId} />}
          {onVoid && !payment.voidedAt && (
            <Button variant="outline" size="sm" onClick={() => onVoid(payment)}>
              Void
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
