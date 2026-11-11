import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Public, Realm } from '../../core/auth/decorators.js';
import { healthReportSchema, livenessSchema } from '@tahi/validation';
import { ResponseSchema } from '../../core/http/contract.js';
import { ServiceUnavailableError } from '../../core/http/domain-error.js';
import { HealthService, type HealthReport } from './health.service.js';

/**
 * Liveness: the process is up (no dependencies checked).
 * Readiness: the API can serve traffic (database + Redis reachable). Used by Docker health
 * checks and deploy verification (docs/DEPLOYMENT.md §5).
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
@Realm('internal')
@Public()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ResponseSchema(livenessSchema)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ResponseSchema(healthReportSchema)
  async ready(): Promise<HealthReport> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableError(
        'One or more dependencies are unavailable.',
        Object.entries(report.checks)
          .filter(([, s]) => s === 'down')
          .map(([name]) => ({ path: [name], message: 'down' })),
      );
    }
    return report;
  }
}
