import { Inject, Injectable } from '@nestjs/common';
import {
  appointmentInputSchema,
  appointmentStatusSchema,
  listAppointmentsSchema,
} from '@tahi/shared';
import { z } from 'zod';
import { ApiException } from '../../common/http/api-exception';
import { Paginated } from '../../common/http/paginated';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { ClientsService } from '../clients/clients.service';
import { GarmentsService } from '../garments/garments.service';
import { ProjectsService } from '../projects/projects.service';

type AppointmentInput = z.output<typeof appointmentInputSchema>;
type Links = Pick<AppointmentInput, 'clientId' | 'projectId' | 'garmentId'>;

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Appointment not found');
const mismatch = (message: string) => new ApiException(422, 'BUSINESS_RULE_VIOLATION', message);
const LINKS = {
  client: { select: { id: true, fullName: true } },
  project: { select: { id: true, projectNumber: true, title: true } },
  garment: { select: { id: true, name: true, wearerName: true } },
} as const;

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly clients: ClientsService,
    private readonly projects: ProjectsService,
    private readonly garments: GarmentsService,
  ) {}

  async list({
    page,
    limit,
    from,
    to,
    clientId,
    projectId,
    garmentId,
  }: z.output<typeof listAppointmentsSchema>) {
    const where = {
      ...(clientId ? { clientId } : {}),
      ...(projectId ? { projectId } : {}),
      ...(garmentId ? { garmentId } : {}),
      // An appointment belongs to the Manila day it starts on.
      ...(from || to
        ? {
            startsAt: {
              ...(from ? { gte: new Date(`${from}T00:00:00.000+08:00`) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59.999+08:00`) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.appointment.findMany({
        where,
        include: LINKS,
        orderBy: { startsAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.appointment.count({ where }),
    ]);
    return new Paginated(items, { page, limit }, total);
  }

  /** A garment implies its project, and a project its client, so links can't disagree. */
  private async resolveLinks({ clientId, projectId, garmentId }: Links) {
    let project = projectId ?? null;
    let client = clientId ?? null;
    if (garmentId) {
      const garment = await this.garments.get(garmentId);
      if (project && project !== garment.project.id) {
        throw mismatch('That garment belongs to a different order');
      }
      project = garment.project.id;
    }
    if (project) {
      const { clientId: owner } = await this.projects.assertActive(project);
      if (client && client !== owner) throw mismatch('That order belongs to a different client');
      client = owner;
    } else if (client) {
      await this.clients.assertActive(client);
    }
    return { clientId: client, projectId: project, garmentId: garmentId ?? null };
  }

  async create({ startsAt, endsAt, clientId, projectId, garmentId, ...data }: AppointmentInput) {
    return this.db.appointment.create({
      data: {
        ...data,
        ...(await this.resolveLinks({ clientId, projectId, garmentId })),
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      } as never,
      include: LINKS,
    });
  }

  async get(id: string) {
    const appointment = await this.db.appointment.findUnique({ where: { id }, include: LINKS });
    if (!appointment) throw notFound();
    return appointment;
  }

  async update(
    id: string,
    { startsAt, endsAt, clientId, projectId, garmentId, ...data }: AppointmentInput,
  ) {
    const current = await this.get(id);
    if (current.status !== 'scheduled') {
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        'Only a scheduled appointment can be changed. Set it back to scheduled first',
      );
    }
    // Links left as they were stay valid, even if the order or client was archived since.
    const unchanged =
      (clientId ?? null) === current.clientId &&
      (projectId ?? null) === current.projectId &&
      (garmentId ?? null) === current.garmentId;
    return this.db.appointment.update({
      where: { id },
      data: {
        ...data,
        ...(unchanged ? {} : await this.resolveLinks({ clientId, projectId, garmentId })),
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      },
      include: LINKS,
    });
  }

  /** Any status may follow any other, so a mistaken click can be corrected. */
  async changeStatus(id: string, status: z.output<typeof appointmentStatusSchema>['status']) {
    await this.get(id);
    return this.db.appointment.update({ where: { id }, data: { status }, include: LINKS });
  }
}
