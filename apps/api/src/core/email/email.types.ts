export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Producer side (API): queue an email. Never awaits delivery. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}
export const MAILER = Symbol('MAILER');

/** Consumer side (worker): deliver an email. */
export interface EmailTransport {
  deliver(message: EmailMessage): Promise<void>;
}
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
