import type { Metadata } from 'next';
import { getSite } from '../../lib/api';

type Props = { params: Promise<{ site: string }> };

// Rendered on first request, then revalidated. Each host has its own path, so its own entry.
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = await getSite((await params).site);
  return site.available
    ? { title: site.name, robots: { index: false } } // Placeholder content until Phase 2.
    : { title: 'Unavailable', robots: { index: false } };
}

export default async function SitePlaceholder({ params }: Props) {
  const site = await getSite((await params).site);
  return (
    <main className="mx-auto max-w-xl p-6">
      {site.available ? (
        <>
          <h1 className="text-2xl font-semibold">{site.name}</h1>
          <p className="mt-2 text-gray-600">This site is being prepared.</p>
        </>
      ) : (
        <h1 className="text-2xl font-semibold">This site is currently unavailable</h1>
      )}
    </main>
  );
}
