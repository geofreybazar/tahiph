import { useQuery } from '@tanstack/react-query';
import { formatCentavos, PROJECT_STATUSES } from '@tahi/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { selectClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { Pager } from '@/components/pager';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetchPage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useTenantAccess } from '@/lib/use-tenant-access';

export interface Project {
  id: string;
  title: string;
  projectNumber: string;
  status: (typeof PROJECT_STATUSES)[number];
  priceCentavos: number;
  weddingDate: string | null;
  notes: string | null;
  archivedAt: string | null;
  client: { id: string; fullName: string };
}

/** Orders are a view over wedding projects (ADR 0007). */
export function ProjectsPage() {
  const { tenantId } = useTenantAccess();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const projects = useQuery({
    queryKey: ['projects', tenantId, q, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ q, page: String(page) });
      if (status) params.set('status', status);
      return apiFetchPage<Project>(`/projects?${params}`, { tenantId });
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <p className="text-sm text-muted-foreground">
        To add an order, open the client it belongs to.
      </p>
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap gap-3">
            <Input
              className="min-w-56 flex-1"
              aria-label="Search orders"
              placeholder="Search by title, number or client"
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPage(1);
              }}
            />
            <select
              aria-label="Filter by status"
              className={selectClass}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {PROJECT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          {projects.isPending && <p>Loading…</p>}
          <FormError error={projects.error} />
          {projects.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No orders found.</p>
          )}
          <ul className="divide-y">
            {projects.data?.data.map((project) => (
              <li key={project.id} className="flex flex-wrap items-baseline gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    to={`/orders/${project.id}`}
                  >
                    {project.projectNumber}: {project.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {project.client.fullName}
                    {project.weddingDate && `, wedding ${formatDate(project.weddingDate)}`}
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">
                  {project.status}, {formatCentavos(project.priceCentavos)}
                </span>
              </li>
            ))}
          </ul>
          <Pager meta={projects.data?.meta} onPage={setPage} />
        </CardContent>
      </Card>
    </div>
  );
}
