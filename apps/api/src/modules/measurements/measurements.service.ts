import { Inject, Injectable } from '@nestjs/common';
import { createMeasurementRecordSchema, measurementProfileInputSchema } from '@tahi/shared';
import { z } from 'zod';
import { ApiException } from '../../common/http/api-exception';
import { fromDbDate, toDbDate } from '../../common/http/dates';
import type { ScopedPrisma } from '../../common/prisma/prisma-clients';
import { SCOPED_PRISMA } from '../../common/prisma/scoped-prisma.token';
import { RequestContext } from '../../common/request-context/request-context';
import { ClientsService } from '../clients/clients.service';

type ProfileInput = z.output<typeof measurementProfileInputSchema>;

const notFound = () => new ApiException(404, 'NOT_FOUND', 'Measurements not found');
const RECORD_DETAIL = {
  values: { orderBy: { key: 'asc' } },
  recordedBy: { select: { email: true, fullName: true } },
} as const;

const presentDay = <T extends { takenOn: Date }>(record: T) => ({
  ...record,
  takenOn: fromDbDate(record.takenOn),
});
const presentRecord = <
  T extends { takenOn: Date; values: { value: { toFixed(places: number): string } }[] },
>(
  record: T,
) => ({
  ...presentDay(record),
  values: record.values.map((v) => ({ ...v, value: v.value.toFixed(2) })),
});

@Injectable()
export class MeasurementsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrisma,
    private readonly clients: ClientsService,
    private readonly context: RequestContext,
  ) {}

  async listProfiles(clientId: string) {
    await this.clients.get(clientId);
    const profiles = await this.db.measurementProfile.findMany({
      where: { clientId, archivedAt: null },
      include: {
        records: { select: { id: true, takenOn: true, unit: true }, orderBy: { takenOn: 'desc' } },
      },
      orderBy: { personName: 'asc' },
    });
    return profiles.map((profile) => ({ ...profile, records: profile.records.map(presentDay) }));
  }

  async createProfile(clientId: string, data: ProfileInput) {
    await this.clients.assertActive(clientId);
    return this.db.measurementProfile.create({ data: { ...data, clientId } as never });
  }

  async getProfile(id: string) {
    const profile = await this.db.measurementProfile.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, fullName: true } },
        records: {
          include: RECORD_DETAIL,
          orderBy: [{ takenOn: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!profile) throw notFound();
    return { ...profile, records: profile.records.map(presentRecord) };
  }

  async updateProfile(id: string, data: ProfileInput) {
    await this.getProfile(id);
    return this.db.measurementProfile.update({ where: { id }, data });
  }

  async addRecord(
    profileId: string,
    { takenOn, values, ...data }: z.output<typeof createMeasurementRecordSchema>,
  ) {
    const profile = await this.db.measurementProfile.findFirst({
      where: { id: profileId, archivedAt: null },
    });
    if (!profile) throw notFound();
    const userId = this.context.principal!.userId;
    const recordId = await this.db.$transaction(async (tx) => {
      const record = await tx.measurementRecord.create({
        data: { ...data, profileId, takenOn: toDbDate(takenOn), recordedByUserId: userId } as never,
      });
      await tx.measurementValue.createMany({
        data: values.map((value) => ({ ...value, recordId: record.id })) as never,
      });
      return record.id;
    });
    return this.getRecord(recordId);
  }

  async getRecord(id: string) {
    const record = await this.db.measurementRecord.findUnique({
      where: { id },
      include: RECORD_DETAIL,
    });
    if (!record) throw notFound();
    return presentRecord(record);
  }

  /** For garments: only the wearing client's own measurements can be assigned. */
  async assertRecordOfClient(recordId: string, clientId: string): Promise<void> {
    const record = await this.db.measurementRecord.findFirst({
      where: { id: recordId, profile: { is: { clientId } } },
    });
    if (!record) throw notFound();
  }
}
