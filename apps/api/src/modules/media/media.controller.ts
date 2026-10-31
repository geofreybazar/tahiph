import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { createUploadIntentSchema } from '@tahi/shared';
import { createZodDto } from 'nestjs-zod';
import { TenantRoute } from '../../common/auth/decorators';
import { MediaService } from './media.service';

class CreateUploadIntentDto extends createZodDto(createUploadIntentSchema) {}

@Controller('media')
@TenantRoute()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload-intents')
  createUploadIntent(@Body() body: CreateUploadIntentDto) {
    return this.media.createUploadIntent(body);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.confirm(id);
  }

  @Get(':id/download-url')
  downloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.createDownloadUrl(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.remove(id);
  }
}
