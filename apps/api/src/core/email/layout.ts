// Shared plain HTML/text email layout.

/** Escapes text for HTML email bodies. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function layout(
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  const button = action
    ? `<p><a href="${esc(action.url)}" style="background:#1f1a17;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(action.label)}</a></p><p style="font-size:12px;color:#666">Or paste this link into your browser: ${esc(action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#1f1a17"><h1 style="font-size:20px">${esc(title)}</h1>${body}${button}<p style="font-size:12px;color:#666">TAHI.ph</p></body></html>`;
}

export const text = (paragraphs: string[], url?: string) =>
  [...paragraphs, ...(url ? [url] : []), '', 'TAHI.ph'].join('\n\n');
