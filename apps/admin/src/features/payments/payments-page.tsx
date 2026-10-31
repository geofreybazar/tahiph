import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Pager } from '@/components/pager';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetchPage } from '@/lib/api';
import { useTenantAccess } from '@/lib/use-tenant-access';
import { PaymentList, type Payment } from './payment-list';

export function PaymentsPage() {
  const { tenantId } = useTenantAccess();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const payments = useQuery({
    queryKey: ['projects', tenantId, 'all-payments', from, to, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return apiFetchPage<Payment>(`/payments?${params}`, { tenantId });
    },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payments</h1>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-3">
            <Field id="payments-from" label="From">
              <Input
                id="payments-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field id="payments-to" label="To">
              <Input
                id="payments-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </div>
          {payments.isPending && <p>Loading…</p>}
          <FormError error={payments.error} />
          {payments.data && (
            <PaymentList payments={payments.data.data} tenantId={tenantId} showProject />
          )}
          <Pager meta={payments.data?.meta} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
