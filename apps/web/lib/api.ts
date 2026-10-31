import { notFound } from 'next/navigation';

export type Site =
  { slug: string; name: string; available: true } | { slug: string; available: false };

/** Cached by slug. The slug comes only from the host, through proxy.ts. */
export async function getSite(slug: string): Promise<Site> {
  const response = await fetch(`${process.env.API_URL}/public/sites/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60, tags: [`site:${slug}`] },
  });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(`Site lookup failed with ${response.status}`);
  return ((await response.json()) as { data: Site }).data;
}
