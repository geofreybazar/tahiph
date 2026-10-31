import { Module } from '@nestjs/common';
import { PublicSitesController } from './public-sites.controller';

@Module({ controllers: [PublicSitesController] })
export class PublicSitesModule {}
