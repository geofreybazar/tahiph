import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ProjectsModule } from '../projects/projects.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [ProjectsModule, MediaModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
