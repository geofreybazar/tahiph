import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TenantDatabase } from '@tahi/database';
import type { EraseClientRequest } from '@tahi/validation';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../core/audit/audit.service.js';
import { requireContext, type RequestContext } from '../../core/context/request-context.js';
import { TENANT_DB } from '../../core/database/tenant-database.provider.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { MeasurementsService } from '../measurements/measurements.service.js';

/**
 * Data-subject export and erasure (RA 10173, ADR-032). Each owning module exports and erases
 * its own tables; this service runs them in one tenant transaction and audits the result.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    @Inject(TENANT_DB) private readonly tenantDb: TenantDatabase,
    private readonly cls: ClsService<RequestContext>,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly measurements: MeasurementsService,
    private readonly appointments: AppointmentsService,
  ) {}

  private audited(action: string, clientId: string, ip: string, metadata?: { reason: string }) {
    return this.audit.tenant({
      actorType: 'USER',
      actorId: requireContext(this.cls, 'userId'),
      action,
      targetType: 'client',
      targetId: clientId,
      ip,
      ...(metadata ? { metadata } : {}),
    });
  }

  async export(clientId: string, ip: string) {
    // One transaction: a consistent snapshot across the client's tables.
    return this.tenantDb.withTenantTx(async () => {
      const { client, notes, communications } = await this.clients.exportData(clientId);
      const measurements = await this.measurements.exportForClient(clientId);
      const appointments = await this.appointments.exportForClient(clientId);
      await this.audited('client.exported', clientId, ip);
      return {
        exportedAt: new Date().toISOString(),
        client,
        notes,
        communications,
        measurements,
        appointments,
      };
    });
  }

  /** Irreversible. All or nothing: any refusal (e.g. upcoming appointments) changes nothing. */
  async erase(clientId: string, body: EraseClientRequest, ip: string): Promise<null> {
    await this.tenantDb.withTenantTx(async () => {
      await this.clients.get(clientId); // 404 first, before any other check
      await this.appointments.eraseForClient(clientId);
      await this.measurements.eraseForClient(clientId);
      await this.clients.eraseData(clientId);
      await this.audited('client.erased', clientId, ip, { reason: body.reason });
    });
    // Ids only. Outside the database on purpose: restoring an older dump loses the audit row
    // too, and the restore runbook replays erasures from these lines (BACKUP_AND_RECOVERY §5).
    this.logger.log(
      { event: 'client.erased', tenantId: requireContext(this.cls, 'tenantId'), clientId },
      'client erased',
    );
    return null;
  }
}
