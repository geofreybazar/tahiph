import { Inject, Injectable } from '@nestjs/common';
import {
  createProjectSchema,
  listProjectsSchema,
  ProjectStatus,
  updateProjectSchema,
} from '@tahi/shared';
import { z } from 'zod';
import { AuditService } from '../../common/auth/audit.service';
import { fromDbDate, manilaYear, toDbDate } from '../../common/http/dates';
import { ApiException } from '../../common/http/api-exception';
import { Paginated } from '../../common/http/paginated';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { ClientsService } from '../clients/clients.service';

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Project not found');
const CLIENT_NAME = { client: { select: { id: true, fullName: true } } } as const;

const present = <T extends { weddingDate: Date | null }>(project: T) => ({
  ...project,
  weddingDate: fromDbDate(project.weddingDate),
});

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly context: RequestContext,
  ) {}

  /** Numbers are per tenant and per Manila year. The increment is atomic, so they never repeat. */
  private async nextProjectNumber(): Promise<string> {
    const year = manilaYear();
    const key = `project:${year}`;
    const increment = () =>
      this.db.documentCounter.upsert({
        where: { tenantId_key: { tenantId: this.context.tenantId!, key } },
        create: { key, value: 1 } as never,
        update: { value: { increment: 1 } },
      });
    // Two requests can both try to create the year's first counter; the loser just retries.
    const counter = await increment().catch((error: { code?: string }) => {
      if (error.code === 'P2002') return increment();
      throw error;
    });
    return `P-${year}-${String(counter.value).padStart(4, '0')}`;
  }

  async list({ page, limit, q, status, clientId, sort }: z.output<typeof listProjectsSchema>) {
    const where = {
      archivedAt: null,
      ...(status ? { status } : {}),
      ...(clientId ? { clientId } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { projectNumber: { contains: q, mode: 'insensitive' as const } },
              { client: { is: { fullName: { contains: q, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
    };
    const field = sort.replace('-', '');
    const [items, total] = await Promise.all([
      this.db.weddingProject.findMany({
        where,
        include: CLIENT_NAME,
        orderBy: { [field]: sort.startsWith('-') ? 'desc' : 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.weddingProject.count({ where }),
    ]);
    return new Paginated(items.map(present), { page, limit }, total);
  }

  async create({ weddingDate, ...data }: z.output<typeof createProjectSchema>) {
    await this.clients.assertActive(data.clientId);
    const project = await this.db.weddingProject.create({
      data: {
        ...data,
        weddingDate: toDbDate(weddingDate),
        projectNumber: await this.nextProjectNumber(),
      } as never,
      include: CLIENT_NAME,
    });
    return present(project);
  }

  private async find(id: string) {
    const project = await this.db.weddingProject.findUnique({
      where: { id },
      include: CLIENT_NAME,
    });
    if (!project) throw notFound();
    return project;
  }

  async get(id: string) {
    return present(await this.find(id));
  }

  async update(id: string, { weddingDate, ...data }: z.output<typeof updateProjectSchema>) {
    await this.find(id);
    return present(
      await this.db.weddingProject.update({
        where: { id },
        data: { ...data, weddingDate: toDbDate(weddingDate) },
        include: CLIENT_NAME,
      }),
    );
  }

  async changePrice(id: string, priceCentavos: number) {
    const { priceCentavos: from } = await this.find(id);
    const project = await this.db.weddingProject.update({
      where: { id },
      data: { priceCentavos },
      include: CLIENT_NAME,
    });
    await this.audit.record({
      action: 'project.price_changed',
      entityType: 'wedding_project',
      entityId: id,
      metadata: { from, to: priceCentavos },
    });
    return present(project);
  }

  async changeStatus(id: string, status: ProjectStatus) {
    await this.find(id);
    return present(
      await this.db.weddingProject.update({
        where: { id },
        data: { status },
        include: CLIENT_NAME,
      }),
    );
  }

  async archive(id: string) {
    await this.find(id);
    return present(
      await this.db.weddingProject.update({
        where: { id },
        data: { archivedAt: new Date() },
        include: CLIENT_NAME,
      }),
    );
  }

  /** For other modules: a project that can take new work. */
  async assertActive(id: string) {
    const project = await this.db.weddingProject.findFirst({ where: { id, archivedAt: null } });
    if (!project) throw notFound();
    return project;
  }

  async listForClient(clientId: string, query: z.output<typeof listProjectsSchema>) {
    await this.clients.get(clientId);
    return this.list({ ...query, clientId });
  }
}
