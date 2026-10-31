import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GARMENT_STAGE_LABELS, GARMENT_STAGES, WEARER_ROLES } from '@tahi/shared';
import { Link } from 'react-router';
import { selectClass } from '@/components/field';
import { FormError } from '@/components/form-error';
import { apiFetch, apiFetchPage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useTenantAccess } from '@/lib/use-tenant-access';

export type GarmentStage = (typeof GARMENT_STAGES)[number];

export interface Garment {
  id: string;
  name: string;
  wearerName: string;
  wearerRole: (typeof WEARER_ROLES)[number];
  description: string | null;
  stage: GarmentStage;
  dueDate: string | null;
  measurementRecordId: string | null;
  project: {
    id: string;
    title: string;
    projectNumber: string;
    clientId: string;
    client: { fullName: string };
  };
}

const LIMIT = 100;

export function ProductionPage() {
  const { tenantId } = useTenantAccess();
  const queryClient = useQueryClient();
  // shortcut: shows the first 100 garments by due date, page per stage if an atelier ever exceeds that.
  const board = useQuery({
    queryKey: ['garments', tenantId, 'board'],
    queryFn: () => apiFetchPage<Garment>(`/garments?limit=${LIMIT}`, { tenantId }),
  });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: GarmentStage }) =>
      apiFetch(`/garments/${id}/stage`, { tenantId, method: 'POST', body: { stage } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['garments', tenantId] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Production</h1>
      {board.isPending && <p>Loading…</p>}
      <FormError error={board.error ?? move.error} />
      {board.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No garments yet. Add them from an order.</p>
      )}
      {board.data && board.data.meta.total > LIMIT && (
        <p role="status" className="text-sm">
          Showing the first {LIMIT} of {board.data.meta.total} garments.
        </p>
      )}
      {board.data && board.data.data.length > 0 && (
        <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(9,minmax(13rem,1fr))]">
          {GARMENT_STAGES.map((stage) => {
            const garments = board.data.data.filter((garment) => garment.stage === stage);
            return (
              <section
                key={stage}
                aria-label={GARMENT_STAGE_LABELS[stage]}
                className="space-y-2 rounded-md bg-muted p-2"
              >
                <h2 className="text-sm font-semibold">
                  {GARMENT_STAGE_LABELS[stage]} ({garments.length})
                </h2>
                {garments.map((garment) => (
                  <article
                    key={garment.id}
                    className="space-y-1 rounded-md border bg-background p-2 text-sm"
                  >
                    <Link
                      className="break-words font-medium underline-offset-4 hover:underline"
                      to={`/garments/${garment.id}`}
                    >
                      {garment.name}
                    </Link>
                    <p className="break-words text-muted-foreground">
                      {garment.wearerName}, {garment.project.client.fullName}
                    </p>
                    {garment.dueDate && <p>Due {formatDate(garment.dueDate)}</p>}
                    <select
                      aria-label={`Move ${garment.name}`}
                      className={`${selectClass} w-full`}
                      value={stage}
                      disabled={move.isPending}
                      onChange={(event) =>
                        move.mutate({ id: garment.id, stage: event.target.value as GarmentStage })
                      }
                    >
                      {GARMENT_STAGES.map((value) => (
                        <option key={value} value={value}>
                          {GARMENT_STAGE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
