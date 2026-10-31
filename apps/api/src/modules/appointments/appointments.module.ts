import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { GarmentsModule } from '../garments/garments.module';
import { ProjectsModule } from '../projects/projects.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [ClientsModule, ProjectsModule, GarmentsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
