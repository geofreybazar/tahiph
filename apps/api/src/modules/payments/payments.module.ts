import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { MediaModule } from '../media/media.module';
import { ProjectsModule } from '../projects/projects.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ProjectsModule, ClientsModule, MediaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
