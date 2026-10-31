import { Module } from '@nestjs/common';
import { MeasurementsModule } from '../measurements/measurements.module';
import { ProjectsModule } from '../projects/projects.module';
import { GarmentsController } from './garments.controller';
import { GarmentsService } from './garments.service';

@Module({
  imports: [ProjectsModule, MeasurementsModule],
  controllers: [GarmentsController],
  providers: [GarmentsService],
})
export class GarmentsModule {}
