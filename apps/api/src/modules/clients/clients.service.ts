import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, TenantDatabase } from '@tahi/database';
import type {
  ClientListQuery,
  CreateClientNoteRequest,
  CreateClientRequest,
  CreateCommunicationRequest,
  UpdateClientRequest,
} from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { afterCursor, decodeCursor, encodeCursor } from '../../core/http/cursor.js';
import { ForbiddenError, NotFoundError } from '../../core/http/domain-error.js';
import { Paginated } from '../../core/http/envelope.interceptor.js';

type ClientRow = Prisma.ClientGetPayload<object>;

const toDate = (iso: string | null | undefined) =>
  iso === undefined ? undefined : iso === null ? null : new Date(`${iso}T00:00:00.000Z`);

function toClient(c: ClientRow) {
  const { tenantId: _tenant, ...rest } = c;
  return {
    ...rest,
    birthday: c.birthday ? c.birthday.toISOString().slice(0, 10) : null,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const AUTHOR = { select: { id: true, user: { select: { name: true } } } } as const;
const toAuthor = (m: { id: string; user: { name: string } }) => ({
  membershipId: m.id,
  name: m.user.name,
});

/** CRM: clients, their notes and logged communications (ADR-026). */
@Injectable()
export class ClientsService {
  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
  ) {}

  private audited(action: string, targetType: string, targetId: string, ip: string) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType,
      targetId,
      ip,
    });
  }

  /** Newest first, keyset-paginated. Search is a case-insensitive substring match. */
  async list(query: ClientListQuery) {
    const where: Prisma.ClientWhereInput = {
      erasedAt: null,
      ...(query.status === 'active' ? { archivedAt: null } : {}),
      ...(query.status === 'archived' ? { archivedAt: { not: null } } : {}),
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...(query.q
        ? {
            OR: (['firstName', 'lastName', 'email', 'phone'] as const).map((field) => ({
              [field]: { contains: query.q, mode: 'insensitive' as const },
            })),
          }
        : {}),
    };
    const rows = await this.tenantDb.db().client.findMany({
      where: query.cursor ? { AND: [where, afterCursor(decodeCursor(query.cursor))] } : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = rows.length > query.limit;
    return new Paginated(page.map(toClient), {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  }

  async get(id: string) {
    return toClient(await this.find(id));
  }

  async create(input: CreateClientRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const c = await this.tenantDb.db().client.create({
        data: { ...input, birthday: toDate(input.birthday) } as never,
      });
      await this.audited('client.created', 'client', c.id, ip);
      return toClient(c);
    });
  }

  async update(id: string, input: UpdateClientRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      await this.find(id);
      const c = await this.tenantDb.db().client.update({
        where: { id },
        data: { ...input, birthday: toDate(input.birthday) },
      });
      await this.audited('client.updated', 'client', id, ip);
      return toClient(c);
    });
  }

  /** Archive or restore; idempotent. Clients are never deleted. */
  async setArchived(id: string, archived: boolean, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      const current = await this.find(id);
      if ((current.archivedAt !== null) === archived) return toClient(current);
      const c = await this.tenantDb.db().client.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });
      await this.audited(archived ? 'client.archived' : 'client.restored', 'client', id, ip);
      return toClient(c);
    });
  }

  // shortcut: notes and communications return the latest 200, unpaginated; paginate when clients accumulate more.
  async notes(clientId: string) {
    await this.find(clientId);
    const rows = await this.tenantDb.db().clientNote.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, body: true, createdAt: true, author: AUTHOR },
    });
    return rows.map((n) => ({
      id: n.id,
      body: n.body,
      author: toAuthor(n.author),
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async addNote(clientId: string, input: CreateClientNoteRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      await this.find(clientId);
      const n = await this.tenantDb.db().clientNote.create({
        data: {
          clientId,
          body: input.body,
          authorMembershipId: requireContext(this.cls, 'membershipId'),
        } as never,
        select: { id: true, body: true, createdAt: true, author: AUTHOR },
      });
      await this.audited('client_note.created', 'client_note', n.id, ip);
      return {
        id: n.id,
        body: n.body,
        author: toAuthor(n.author),
        createdAt: n.createdAt.toISOString(),
      };
    });
  }

  /** Only the author deletes a note. The note must belong to the client in the path. */
  async deleteNote(clientId: string, noteId: string, ip: string): Promise<null> {
    await this.tenantDb.withTenantTx(async () => {
      const note = await this.tenantDb.db().clientNote.findFirst({
        where: { id: noteId, clientId },
        select: { authorMembershipId: true },
      });
      if (!note) throw new NotFoundError('Note not found.');
      if (note.authorMembershipId !== requireContext(this.cls, 'membershipId')) {
        throw new ForbiddenError('NOT_NOTE_AUTHOR', 'Only the author can delete this note.');
      }
      await this.tenantDb.db().clientNote.deleteMany({ where: { id: noteId } });
      await this.audited('client_note.deleted', 'client_note', noteId, ip);
    });
    return null;
  }

  async communications(clientId: string) {
    await this.find(clientId);
    const rows = await this.tenantDb.db().communication.findMany({
      where: { clientId },
      orderBy: { occurredAt: 'desc' },
      take: 200,
      include: { recordedBy: AUTHOR },
    });
    return rows.map((c) => toCommunication(c));
  }

  async addCommunication(clientId: string, input: CreateCommunicationRequest, ip: string) {
    return this.tenantDb.withTenantTx(async () => {
      await this.find(clientId);
      const c = await this.tenantDb.db().communication.create({
        data: {
          clientId,
          channel: input.channel,
          direction: input.direction,
          summary: input.summary,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
          recordedByMembershipId: requireContext(this.cls, 'membershipId'),
        } as never,
        include: { recordedBy: AUTHOR },
      });
      await this.audited('communication.created', 'communication', c.id, ip);
      return toCommunication(c);
    });
  }

  // ----- Data-subject rights (ADR-032); called by PrivacyService inside its transaction ---

  /** The client with every note and communication (no page limit). */
  async exportData(id: string) {
    const client = toClient(await this.find(id));
    const notes = await this.tenantDb.db().clientNote.findMany({
      where: { clientId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, body: true, createdAt: true, author: AUTHOR },
    });
    const communications = await this.tenantDb.db().communication.findMany({
      where: { clientId: id },
      orderBy: { occurredAt: 'asc' },
      include: { recordedBy: AUTHOR },
    });
    return {
      client,
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        author: toAuthor(n.author),
        createdAt: n.createdAt.toISOString(),
      })),
      communications: communications.map(toCommunication),
    };
  }

  /**
   * Deletes notes and communications and clears every personal field. The row stays as a
   * pseudonymous reference for records that must be kept (orders and payments, Phase 4).
   */
  async eraseData(id: string): Promise<void> {
    await this.find(id);
    const db = this.tenantDb.db();
    await db.clientNote.deleteMany({ where: { clientId: id } });
    await db.communication.deleteMany({ where: { clientId: id } });
    const now = new Date();
    await db.client.update({
      where: { id },
      data: {
        firstName: 'Erased client',
        lastName: null,
        email: null,
        phone: null,
        birthday: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        province: null,
        postalCode: null,
        preferences: null,
        tags: [],
        archivedAt: now,
        erasedAt: now,
      },
    });
  }

  private async find(id: string): Promise<ClientRow> {
    // Scoped: another atelier's client is not found (404), nor is an erased one (ADR-032).
    const c = await this.tenantDb.db().client.findFirst({ where: { id, erasedAt: null } });
    if (!c) throw new NotFoundError('Client not found.');
    return c;
  }
}

function toCommunication(c: {
  id: string;
  channel: string;
  direction: string;
  summary: string;
  occurredAt: Date;
  recordedBy: { id: string; user: { name: string } };
}) {
  return {
    id: c.id,
    channel: c.channel,
    direction: c.direction,
    summary: c.summary,
    occurredAt: c.occurredAt.toISOString(),
    recordedBy: toAuthor(c.recordedBy),
  };
}
