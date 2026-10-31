import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ClientProjectsController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [ClientsModule],
  controllers: [ProjectsController, ClientProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
