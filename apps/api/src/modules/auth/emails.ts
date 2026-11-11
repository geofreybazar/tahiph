import type { EmailMessage } from '../../core/email/email.types.js';
import { layout, text } from '../../core/email/layout.js';

export function verifyEmail(to: string, name: string, url: string): EmailMessage {
  const p = [
    `Hi ${name},`,
    'Confirm your email address to finish creating your TAHI.ph account. The link expires in 24 hours.',
  ];
  return {
    to,
    subject: 'Confirm your email',
    text: text(p, url),
    html: layout('Confirm your email', p, { label: 'Confirm email', url }),
  };
}

export function accountExists(to: string, signInUrl: string, resetUrl: string): EmailMessage {
  const p = [
    'Someone tried to create a TAHI.ph account with this email address, but you already have one.',
    `Sign in: ${signInUrl}`,
    `Forgot your password? Reset it: ${resetUrl}`,
    'If this was not you, you can ignore this email.',
  ];
  return {
    to,
    subject: 'You already have a TAHI.ph account',
    text: text(p),
    html: layout('You already have an account', p),
  };
}

export function passwordReset(to: string, url: string): EmailMessage {
  const p = [
    'We received a request to reset your TAHI.ph password. The link expires in 30 minutes.',
    'If you did not ask for this, ignore this email; your password stays the same.',
  ];
  return {
    to,
    subject: 'Reset your password',
    text: text(p, url),
    html: layout('Reset your password', p, { label: 'Reset password', url }),
  };
}

export function passwordChanged(to: string): EmailMessage {
  const p = [
    'Your TAHI.ph password was changed and all your sessions were signed out.',
    'If this was not you, reset your password now and contact support.',
  ];
  return {
    to,
    subject: 'Your password was changed',
    text: text(p),
    html: layout('Your password was changed', p),
  };
}

export function invitation(to: string, atelier: string, role: string, url: string): EmailMessage {
  const p = [
    `You have been invited to join ${atelier} on TAHI.ph as ${role}.`,
    'The invitation expires in 7 days.',
  ];
  return {
    to,
    subject: `Join ${atelier} on TAHI.ph`,
    text: text(p, url),
    html: layout(`Join ${atelier}`, p, { label: 'Accept invitation', url }),
  };
}

export function customerSignIn(
  to: string,
  atelier: string,
  code: string,
  url: string,
): EmailMessage {
  const p = [
    `Your sign-in code for ${atelier} is ${code}.`,
    'It expires in 10 minutes. You can also sign in with the button below.',
    'If you did not ask for this, you can ignore this email.',
  ];
  return {
    to,
    subject: `${code} is your sign-in code for ${atelier}`,
    text: text(p, url),
    html: layout(`Sign in to ${atelier}`, p, { label: 'Sign in', url }),
  };
}
