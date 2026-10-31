import { Module } from '@nestjs/common';
import { StorageService } from '../../common/storage/storage.service';
import { MediaCleanupJob } from './media-cleanup.job';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaCleanupJob, StorageService],
  exports: [MediaService],
})
export class MediaModule {}
