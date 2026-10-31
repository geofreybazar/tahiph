import { Inject, Injectable } from '@nestjs/common';
import { clientInputSchema, listClientsSchema } from '@tahi/shared';
import { z } from 'zod';
import { ApiException } from '../../common/http/api-exception';
import { Paginated } from '../../common/http/paginated';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Client not found');

@Injectable()
export class ClientsService {
  constructor(@Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma) {}

  async list({ page, limit, q, sort }: z.output<typeof listClientsSchema>) {
    const contains = (field: string) => ({ [field]: { contains: q, mode: 'insensitive' as const } });
    const where = {
      archivedAt: null,
      ...(q ? { OR: [contains('fullName'), contains('email'), contains('phone')] } : {}),
    };
    const field = sort.replace('-', '');
    const [items, total] = await Promise.all([
      this.db.client.findMany({
        where,
        orderBy: { [field]: sort.startsWith('-') ? 'desc' : 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.client.count({ where }),
    ]);
    return new Paginated(items, { page, limit }, total);
  }

  create(data: z.output<typeof clientInputSchema>) {
    return this.db.client.create({ data: data as never });
  }

  async get(id: string) {
    const client = await this.db.client.findUnique({ where: { id } });
    if (!client) throw notFound();
    return client;
  }

  async update(id: string, data: z.output<typeof clientInputSchema>) {
    await this.get(id);
    return this.db.client.update({ where: { id }, data });
  }

  async archive(id: string) {
    await this.get(id);
    return this.db.client.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  /** For other modules: a client that can take new work. */
  async assertActive(id: string): Promise<void> {
    const client = await this.db.client.findFirst({ where: { id, archivedAt: null } });
    if (!client) throw notFound();
  }
}
