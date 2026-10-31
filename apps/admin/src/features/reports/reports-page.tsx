import { useQuery } from '@tanstack/react-query';
import {
  APPOINTMENT_STATUS_LABELS,
  formatCentavos,
  GARMENT_STAGE_LABELS,
  GARMENT_STAGES,
} from '@tahi/shared';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { Field } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { monthLabel } from '@/lib/calendar';
import { useTenantAccess } from '@/lib/use-tenant-access';

type Row = Record<string, string | number>;
interface Column {
  key: string;
  label: string;
  format?: (value: number) => string;
}

const money = (key: string, label: string): Column => ({ key, label, format: formatCentavos });

function Table({
  caption,
  columns,
  rows,
  totals,
}: {
  caption: string;
  columns: Column[];
  rows: Row[];
  totals?: Row;
}) {
  const show = (column: Column, row: Row) => {
    const value = row[column.key];
    if (value === undefined) return '';
    return column.format ? column.format(value as number) : value;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="p-2 text-left font-medium">
              Month
            </th>
            {columns.map((column) => (
              <th key={column.key} scope="col" className="p-2 text-right font-medium">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className="border-b">
              <th scope="row" className="whitespace-nowrap p-2 text-left font-normal">
                {monthLabel(row.month as string)}
              </th>
              {columns.map((column) => (
                <td key={column.key} className="whitespace-nowrap p-2 text-right tabular-nums">
                  {show(column, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className="p-2 text-left font-semibold">
                Total
              </th>
              {columns.map((column) => (
                <td key={column.key} className="whitespace-nowrap p-2 text-right tabular-nums">
                  {show(column, totals)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function PeriodReport({
  name,
  title,
  note,
  columns,
  period,
  tenantId,
}: {
  name: string;
  title: string;
  note?: string;
  columns: Column[];
  period: string;
  tenantId: string;
}) {
  const report = useQuery({
    queryKey: ['reports', tenantId, name, period],
    queryFn: () =>
      apiFetch<{ items: Row[]; totals: Row }>(`/reports/${name}?${period}`, { tenantId }),
  });
  return (
    <Section title={title}>
      {report.isPending && <p>Loading…</p>}
      <FormError error={report.error} />
      {report.data && (
        <Table
          caption={title}
          columns={columns}
          rows={report.data.items}
          totals={report.data.totals}
        />
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Section>
  );
}

interface ReceivablesReport {
  totalCentavos: number;
  items: {
    id: string;
    projectNumber: string;
    title: string;
    clientName: string;
    priceCentavos: number;
    paidCentavos: number;
    refundedCentavos: number;
    balanceCentavos: number;
  }[];
}

function Receivables({ tenantId }: { tenantId: string }) {
  const report = useQuery({
    queryKey: ['reports', tenantId, 'receivables'],
    queryFn: () => apiFetch<ReceivablesReport>('/reports/receivables', { tenantId }),
  });
  return (
    <Section title="Receivables">
      {report.isPending && <p>Loading…</p>}
      <FormError error={report.error} />
      {report.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No active orders.</p>
      )}
      {report.data && report.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Receivables by active order</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="p-2 text-left font-medium">
                  Order
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Price
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Paid
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Refunded
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {report.data.items.map((item) => (
                <tr key={item.id} className="border-b">
                  <th scope="row" className="p-2 text-left font-normal">
                    <Link className="underline-offset-4 hover:underline" to={`/orders/${item.id}`}>
                      {item.projectNumber}
                    </Link>
                    <span className="block break-words text-muted-foreground">
                      {item.clientName}
                    </span>
                  </th>
                  {[
                    item.priceCentavos,
                    item.paidCentavos,
                    item.refundedCentavos,
                    item.balanceCentavos,
                  ].map((value, index) => (
                    <td key={index} className="whitespace-nowrap p-2 text-right tabular-nums">
                      {formatCentavos(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <th scope="row" colSpan={4} className="p-2 text-left font-semibold">
                  Total
                </th>
                <td className="whitespace-nowrap p-2 text-right tabular-nums">
                  {formatCentavos(report.data.totalCentavos)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

interface OperationsReport {
  garmentsByStage: Record<(typeof GARMENT_STAGES)[number], number>;
  appointments: Row[];
}

function Operations({ period, tenantId }: { period: string; tenantId: string }) {
  const report = useQuery({
    queryKey: ['reports', tenantId, 'operations', period],
    queryFn: () => apiFetch<OperationsReport>(`/reports/operations?${period}`, { tenantId }),
  });
  return (
    <Section title="Operations">
      {report.isPending && <p>Loading…</p>}
      <FormError error={report.error} />
      {report.data && (
        <>
          <Table
            caption="Appointments by month"
            columns={(['scheduled', 'completed', 'cancelled', 'no_show'] as const).map((key) => ({
              key,
              label: APPOINTMENT_STATUS_LABELS[key],
            }))}
            rows={report.data.appointments}
          />
          <h3 className="font-medium">Garments at each stage now</h3>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {GARMENT_STAGES.map((stage) => (
              <li key={stage} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{GARMENT_STAGE_LABELS[stage]}</span>
                <span className="tabular-nums">{report.data.garmentsByStage[stage]}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export function ReportsPage() {
  const { tenantId } = useTenantAccess();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const period = params.toString();
  const shared = { period, tenantId };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <div className="flex flex-wrap items-end gap-3">
        <Field id="report-from" label="From month">
          <Input
            id="report-from"
            type="month"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field id="report-to" label="To month">
          <Input id="report-to" type="month" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <p className="text-sm text-muted-foreground">
          The last 12 months unless you choose. Up to 36 months. These are Manila months on a cash
          basis, not accounting or tax records.
        </p>
      </div>
      <PeriodReport
        {...shared}
        name="profit"
        title="Profit"
        note="Revenue minus expenses. A deposit counts when received, even if the garment is unfinished."
        columns={[
          money('revenueCentavos', 'Revenue'),
          money('expensesCentavos', 'Expenses'),
          money('profitCentavos', 'Profit'),
        ]}
      />
      <PeriodReport
        {...shared}
        name="revenue"
        title="Revenue"
        note="Payments minus refunds, by the date the money moved. Voided rows don't count."
        columns={[
          money('paidCentavos', 'Paid'),
          money('refundedCentavos', 'Refunded'),
          money('revenueCentavos', 'Revenue'),
        ]}
      />
      <PeriodReport
        {...shared}
        name="sales"
        title="Sales"
        note="Active and completed orders, by the month they were created, at their current price."
        columns={[{ key: 'orderCount', label: 'Orders' }, money('soldCentavos', 'Sold')]}
      />
      <Receivables tenantId={tenantId} />
      <Operations {...shared} />
    </div>
  );
}
