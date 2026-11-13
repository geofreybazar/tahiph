import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/** Object storage for the API (presign, confirm) and the worker (image processing). */
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
