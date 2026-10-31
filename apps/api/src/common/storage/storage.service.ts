import { Inject, Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';

export type StorageBucket = 'public-media' | 'private-media';

export interface StoredObject {
  sizeBytes: number;
  leadingBytes: Uint8Array;
}

const LEADING_BYTES = 16;

/** Uses the secret key, so callers must check tenant and role first. Keys come from the API only. */
@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async createUploadUrl(bucket: StorageBucket, key: string): Promise<string> {
    const { data, error } = await this.client.storage.from(bucket).createSignedUploadUrl(key);
    if (error) throw error;
    return data.signedUrl;
  }

  async createDownloadUrl(
    bucket: StorageBucket,
    key: string,
    expiresInSeconds: number,
    filename?: string,
  ): Promise<string> {
    // Download disposition, so a stored file can never render as a page on the storage origin.
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds, { download: filename ?? true });
    if (error) throw error;
    return data.signedUrl;
  }

  /** Reads what was really stored, or null if nothing was uploaded. */
  async inspect(bucket: StorageBucket, key: string): Promise<StoredObject | null> {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(key, 60);
    if (error) {
      if (/not found/i.test(error.message)) return null;
      throw error;
    }
    const response = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${LEADING_BYTES - 1}` },
    });
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) throw new Error(`Storage read failed with ${response.status}`);

    const leadingBytes = new Uint8Array(await response.arrayBuffer()).slice(0, LEADING_BYTES);
    const total = response.headers.get('content-range')?.split('/')[1];
    return { sizeBytes: Number(total ?? leadingBytes.length), leadingBytes };
  }

  async remove(bucket: StorageBucket, keys: string[]): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove(keys);
    if (error) throw error;
  }
}
