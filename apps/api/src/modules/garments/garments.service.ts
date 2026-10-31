import { Inject, Injectable } from '@nestjs/common';
import { GarmentStage, garmentInputSchema, listGarmentsSchema } from '@tahi/shared';
import { z } from 'zod';
import { fromDbDate, toDbDate } from '../../common/http/dates';
import { ApiException } from '../../common/http/api-exception';
import { Paginated } from '../../common/http/paginated';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { MediaService } from '../media/media.service';
import { MeasurementsService } from '../measurements/measurements.service';
import { ProjectsService } from '../projects/projects.service';

type GarmentInput = z.output<typeof garmentInputSchema>;

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Garment not found');
const PROJECT_SUMMARY = {
  project: {
    select: {
      id: true,
      title: true,
      projectNumber: true,
      clientId: true,
      client: { select: { fullName: true } },
    },
  },
} as const;

const present = <T extends { dueDate: Date | null }>(garment: T) => ({
  ...garment,
  dueDate: fromDbDate(garment.dueDate),
});

@Injectable()
export class GarmentsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly projects: ProjectsService,
    private readonly measurements: MeasurementsService,
    private readonly media: MediaService,
    private readonly context: RequestContext,
  ) {}

  async listForProject(projectId: string) {
    await this.projects.get(projectId);
    const garments = await this.db.garment.findMany({
      where: { projectId },
      include: PROJECT_SUMMARY,
      orderBy: { createdAt: 'asc' },
    });
    return garments.map(present);
  }

  async list({ page, limit, stage }: z.output<typeof listGarmentsSchema>) {
    const where = {
      project: { is: { archivedAt: null } },
      ...(stage ? { stage } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.garment.findMany({
        where,
        include: PROJECT_SUMMARY,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.garment.count({ where }),
    ]);
    return new Paginated(items.map(present), { page, limit }, total);
  }

  async create(projectId: string, { dueDate, ...data }: GarmentInput) {
    const { clientId } = await this.projects.assertActive(projectId);
    if (data.measurementRecordId) {
      await this.measurements.assertRecordOfClient(data.measurementRecordId, clientId);
    }
    const userId = this.context.principal!.userId;
    return this.db.$transaction(async (tx) => {
      const garment = await tx.garment.create({
        data: { ...data, projectId, dueDate: toDbDate(dueDate) } as never,
        include: PROJECT_SUMMARY,
      });
      await tx.garmentStageEvent.create({
        data: { garmentId: garment.id, toStage: garment.stage, changedByUserId: userId } as never,
      });
      return present(garment);
    });
  }

  private async find(id: string) {
    const garment = await this.db.garment.findUnique({ where: { id }, include: PROJECT_SUMMARY });
    if (!garment) throw notFound();
    return garment;
  }

  async get(id: string) {
    return present(await this.find(id));
  }

  async update(id: string, { dueDate, ...data }: GarmentInput) {
    const { project } = await this.find(id);
    if (data.measurementRecordId) {
      await this.measurements.assertRecordOfClient(data.measurementRecordId, project.clientId);
    }
    return present(
      await this.db.garment.update({
        where: { id },
        data: { ...data, dueDate: toDbDate(dueDate) },
        include: PROJECT_SUMMARY,
      }),
    );
  }

  /** Any stage may follow any other: fittings and alterations repeat, and mistakes get corrected. */
  async moveStage(id: string, stage: GarmentStage, note: string | null) {
    const userId = this.context.principal!.userId;
    return this.db.$transaction(async (tx) => {
      const current = await tx.garment.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (current.stage === stage) {
        throw new ApiException(409, 'CONFLICT', 'The garment is already at this stage');
      }
      // Conditional on the stage we read, so two simultaneous moves can't both record history.
      const { count } = await tx.garment.updateMany({
        where: { id, stage: current.stage },
        data: { stage },
      });
      if (count === 0) {
        throw new ApiException(409, 'CONFLICT', 'The garment was just moved by someone else');
      }
      await tx.garmentStageEvent.create({
        data: {
          garmentId: id,
          fromStage: current.stage,
          toStage: stage,
          changedByUserId: userId,
          note,
        } as never,
      });
      return present(
        await tx.garment.findUniqueOrThrow({ where: { id }, include: PROJECT_SUMMARY }),
      );
    });
  }

  async history(id: string) {
    await this.find(id);
    return this.db.garmentStageEvent.findMany({
      where: { garmentId: id },
      select: {
        id: true,
        fromStage: true,
        toStage: true,
        note: true,
        occurredAt: true,
        changedBy: { select: { email: true, fullName: true } },
      },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async listMedia(id: string) {
    await this.find(id);
    const links = await this.db.garmentMedia.findMany({
      where: { garmentId: id },
      select: {
        mediaFile: { select: { id: true, purpose: true, mimeType: true, originalFilename: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((link) => link.mediaFile);
  }

  async attachMedia(id: string, mediaFileId: string) {
    await this.find(id);
    await this.media.assertAttachableToGarment(mediaFileId);
    await this.db.garmentMedia.create({ data: { garmentId: id, mediaFileId } as never });
    return this.listMedia(id);
  }

  /** The file exists only for this garment, so it goes too. */
  async removeMedia(id: string, mediaFileId: string): Promise<void> {
    const link = await this.db.garmentMedia.findFirst({ where: { garmentId: id, mediaFileId } });
    if (!link) throw new ApiException(404, 'NOT_FOUND', 'File not found');
    await this.media.remove(mediaFileId, (tx) =>
      tx.garmentMedia.delete({ where: { id: link.id } }),
    );
  }

  /** Refused once work has started, so production history can't disappear. */
  async remove(id: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const garment = await tx.garment.findUnique({ where: { id } });
      if (!garment) throw notFound();
      const moves = await tx.garmentStageEvent.count({
        where: { garmentId: id, fromStage: { not: null } },
      });
      if (moves > 0) {
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          'This garment has production history and cannot be removed',
        );
      }
      if ((await tx.garmentMedia.count({ where: { garmentId: id } })) > 0) {
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          "Remove this garment's sketches and references first",
        );
      }
      await tx.garmentStageEvent.deleteMany({ where: { garmentId: id } });
      await tx.garment.delete({ where: { id } });
    });
  }
}
