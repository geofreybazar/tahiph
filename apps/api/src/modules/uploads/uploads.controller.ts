import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  catalogIdParamsSchema,
  catalogImageParamsSchema,
  createUploadRequestSchema,
  createUploadResponseSchema,
  logoParamsSchema,
  mediaAssetSchema,
  type CreateUploadRequest,
} from '@tahi/validation';
import type { Request } from 'express';
import { z } from 'zod';
import { clientIp } from '../../core/auth/client-ip.js';
import { ActiveMember, Realm, RequirePermission } from '../../core/auth/decorators.js';
import { ENV } from '../../core/config/config.module.js';
import type { Env } from '../../core/config/env.js';
import { References, ResponseSchema } from '../../core/http/contract.js';
import { ZodValidationPipe } from '../../core/http/zod-validation.pipe.js';
import { UploadsService } from './uploads.service.js';

type ItemParams = { id: string };
type ImageParams = { id: string; imageId: string };
const uploadPipe = () => new ZodValidationPipe(createUploadRequestSchema);
const item = (p: ItemParams) => ({ purpose: 'CATALOG_ITEM_IMAGE' as const, catalogItemId: p.id });
const LOGO = { purpose: 'LOGO' as const };

/** Catalogue item images (ADR-031). */
@Controller('tenant/catalog/items/:id/images')
@Realm('tenant')
export class CatalogImagesController {
  constructor(
    private readonly uploads: UploadsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(z.array(mediaAssetSchema))
  @References({ id: 'catalogItem' })
  @RequirePermission('catalog.read')
  list(@Param(new ZodValidationPipe(catalogIdParamsSchema)) p: ItemParams) {
    return this.uploads.list(item(p));
  }

  @Post()
  @ResponseSchema(createUploadResponseSchema)
  @References({ id: 'catalogItem' })
  @RequirePermission('catalog.write')
  create(
    @Param(new ZodValidationPipe(catalogIdParamsSchema)) p: ItemParams,
    @Body(uploadPipe()) body: CreateUploadRequest,
    @Req() req: Request,
  ) {
    return this.uploads.create(item(p), body, clientIp(req, this.env));
  }

  @Post(':imageId/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(mediaAssetSchema)
  @References({ id: 'catalogItem', imageId: 'catalogImage' })
  @RequirePermission('catalog.write')
  confirm(@Param(new ZodValidationPipe(catalogImageParamsSchema)) p: ImageParams) {
    return this.uploads.confirm(item(p), p.imageId);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ id: 'catalogItem', imageId: 'catalogImage' })
  @RequirePermission('catalog.write')
  remove(
    @Param(new ZodValidationPipe(catalogImageParamsSchema)) p: ImageParams,
    @Req() req: Request,
  ) {
    return this.uploads.remove(item(p), p.imageId, clientIp(req, this.env));
  }
}

/** The atelier's logo: one at a time; a new ready logo replaces the old one (ADR-031). */
@Controller('tenant/settings/logo')
@Realm('tenant')
export class LogoController {
  constructor(
    private readonly uploads: UploadsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @ResponseSchema(mediaAssetSchema.nullable())
  @ActiveMember()
  current() {
    return this.uploads.currentLogo();
  }

  @Post()
  @ResponseSchema(createUploadResponseSchema)
  @RequirePermission('tenant.settings')
  create(@Body(uploadPipe()) body: CreateUploadRequest, @Req() req: Request) {
    return this.uploads.create(LOGO, body, clientIp(req, this.env));
  }

  @Post(':imageId/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(mediaAssetSchema)
  @References({ imageId: 'logo' })
  @RequirePermission('tenant.settings')
  confirm(@Param(new ZodValidationPipe(logoParamsSchema)) p: { imageId: string }) {
    return this.uploads.confirm(LOGO, p.imageId);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ResponseSchema(z.null())
  @References({ imageId: 'logo' })
  @RequirePermission('tenant.settings')
  remove(
    @Param(new ZodValidationPipe(logoParamsSchema)) p: { imageId: string },
    @Req() req: Request,
  ) {
    return this.uploads.remove(LOGO, p.imageId, clientIp(req, this.env));
  }
}
