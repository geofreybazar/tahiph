import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXPENSE_KINDS, formatCentavos, pesosToCentavos } from '@tahi/shared';
import { type FormEvent, useState } from 'react';
import { Field, selectClass, textareaClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ProofLink } from '@/features/payments/payment-list';
import type { Project } from '@/features/projects/projects-page';
import { apiFetch, apiFetchPage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { uploadMedia } from '@/lib/upload';
import { useTenantAccess } from '@/lib/use-tenant-access';

type Kind = (typeof EXPENSE_KINDS)[number];

interface Expense {
  id: string;
  kind: Kind;
  category: string;
  description: string | null;
  amountCentavos: number;
  incurredOn: string;
  projectId: string | null;
  receiptMediaId: string | null;
  project: { id: string; projectNumber: string; title: string } | null;
}

const KIND_LABELS: Record<Kind, string> = { operating: 'Operating', production: 'Production' };

export function ExpensesPage() {
  const { tenantId } = useTenantAccess();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Expense | null>(null);
  const expenses = useQuery({
    queryKey: ['expenses', tenantId, from, to, kind, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (kind) params.set('kind', kind);
      return apiFetchPage<Expense>(`/expenses?${params}`, { tenantId });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/expenses/${id}`, { tenantId, method: 'DELETE' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Expenses</h1>
      <ExpenseForm
        key={editing?.id ?? 'new'}
        tenantId={tenantId}
        expense={editing}
        onDone={() => setEditing(null)}
      />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-3">
            <Field id="filter-from" label="From">
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field id="filter-to" label="To">
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field id="filter-kind" label="Kind">
              <select
                id="filter-kind"
                className={`${selectClass} block`}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All kinds</option>
                {EXPENSE_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {expenses.isPending && <p>Loading…</p>}
          <FormError error={expenses.error ?? remove.error} />
          {expenses.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No expenses found.</p>
          )}
          <ul className="divide-y">
            {expenses.data?.data.map((expense) => (
              <li key={expense.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">
                    {formatCentavos(expense.amountCentavos)}, {expense.category}
                  </p>
                  <p className="break-words text-muted-foreground">
                    {formatDate(expense.incurredOn)}, {KIND_LABELS[expense.kind]}
                    {expense.project && `, ${expense.project.projectNumber}`}
                  </p>
                  {expense.description && (
                    <p className="whitespace-pre-wrap break-words">{expense.description}</p>
                  )}
                </div>
                {expense.receiptMediaId && (
                  <ProofLink
                    mediaId={expense.receiptMediaId}
                    tenantId={tenantId}
                    label="View receipt"
                  />
                )}
                <Button variant="outline" size="sm" onClick={() => setEditing(expense)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Delete this ${expense.category} expense?`)) {
                      remove.mutate(expense.id);
                    }
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
          <Pager meta={expenses.data?.meta} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}

function ExpenseForm({
  tenantId,
  expense,
  onDone,
}: {
  tenantId: string;
  expense: Expense | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>(expense?.kind ?? 'operating');
  const [category, setCategory] = useState(expense?.category ?? '');
  const [amount, setAmount] = useState(expense ? formatCentavos(expense.amountCentavos) : '');
  const [incurredOn, setIncurredOn] = useState(expense?.incurredOn ?? '');
  const [projectId, setProjectId] = useState(expense?.projectId ?? '');
  const [description, setDescription] = useState(expense?.description ?? '');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [clearReceipt, setClearReceipt] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // shortcut: lists the 100 newest projects, add a search if an atelier links expenses to older ones.
  const projects = useQuery({
    queryKey: ['projects', tenantId, 'expense-options'],
    queryFn: () => apiFetchPage<Project>('/projects?limit=100', { tenantId }),
  });
  const save = useMutation({
    mutationFn: async (amountCentavos: number) => {
      const body: Record<string, unknown> = {
        kind,
        category,
        description,
        amountCentavos,
        incurredOn,
        projectId: projectId || null,
      };
      if (clearReceipt) body.receiptMediaId = null;
      if (receipt) body.receiptMediaId = await uploadMedia(tenantId, 'expense_receipt', receipt);
      return expense
        ? apiFetch(`/expenses/${expense.id}`, { tenantId, method: 'PATCH', body })
        : apiFetch('/expenses', { tenantId, method: 'POST', body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', tenantId] });
      if (expense) {
        onDone();
        return;
      }
      setCategory('');
      setAmount('');
      setDescription('');
      setProjectId('');
      setReceipt(null);
      setFileKey((value) => value + 1);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const centavos = pesosToCentavos(amount);
    const valid = Boolean(centavos && category.trim() && incurredOn);
    setInvalid(!valid);
    if (centavos && valid) save.mutate(centavos);
  };

  // A project archived since is still offered, so saving an edit can't silently unlink it.
  const projectOptions = projects.data?.data ?? [];
  const missingCurrent =
    expense?.project && !projectOptions.some((p) => p.id === expense.project!.id)
      ? expense.project
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{expense ? 'Edit expense' : 'Add an expense'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={submit} noValidate>
          <Field id="expense-kind" label="Type">
            <select
              id="expense-kind"
              className={`${selectClass} block w-full`}
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {EXPENSE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="expense-category" label="Category">
            <Input
              id="expense-category"
              placeholder="Fabric, rent, salaries"
              maxLength={80}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
          <Field id="expense-amount" label="Amount (₱)">
            <Input
              id="expense-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field id="expense-date" label="Date">
            <Input
              id="expense-date"
              type="date"
              value={incurredOn}
              onChange={(e) => setIncurredOn(e.target.value)}
            />
          </Field>
          <Field id="expense-project" label="Order (optional)">
            <select
              id="expense-project"
              className={`${selectClass} block w-full`}
              value={projectId}
              disabled={projects.isPending}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">None</option>
              {missingCurrent && (
                <option value={missingCurrent.id}>
                  {missingCurrent.projectNumber}: {missingCurrent.title}
                </option>
              )}
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.projectNumber}: {project.title}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="expense-receipt"
            label={expense?.receiptMediaId ? 'Replace receipt' : 'Receipt (optional)'}
          >
            <Input
              key={fileKey}
              id="expense-receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
          </Field>
          <div className="sm:col-span-3">
            <Field id="expense-description" label="Description">
              <textarea
                id="expense-description"
                rows={2}
                maxLength={2000}
                className={textareaClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
          {expense?.receiptMediaId && !receipt && (
            <label className="flex items-center gap-2 text-sm sm:col-span-3">
              <input
                type="checkbox"
                checked={clearReceipt}
                onChange={(e) => setClearReceipt(e.target.checked)}
              />
              Delete the current receipt
            </label>
          )}
          <div className="space-y-2 sm:col-span-3">
            {invalid && (
              <p role="alert" className="text-sm text-destructive">
                Enter a category, a date and an amount above zero, like 1,500.50.
              </p>
            )}
            <FormError error={save.error ?? projects.error} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.isPending}>
                {expense ? 'Save changes' : 'Add expense'}
              </Button>
              {expense && (
                <Button type="button" variant="outline" onClick={onDone}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
