import { Inject, Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Env } from '../config/env';
import { ENV } from '../config/env.token';

@Injectable()
export class AuthAdminService {
  private readonly logger = new Logger(AuthAdminService.name);
  private readonly client: SupabaseClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Asked of Supabase directly: email_verified in a token's metadata can be set by its user. */
  async isEmailConfirmed(userId: string): Promise<boolean> {
    const { data, error } = await this.client.auth.admin.getUserById(userId);
    if (error) throw error;
    return Boolean(data.user.email_confirmed_at);
  }

  /**
   * Supabase refuses this for an email that already has an account, so false is an expected
   * result: the inviter then shares the link themselves.
   */
  async sendInvite(email: string, redirectTo: string): Promise<boolean> {
    const { error } = await this.client.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error) this.logger.warn(`Invitation email not sent: ${error.code ?? error.status}`);
    return !error;
  }
}
