import type { Metadata } from 'next';

export const metadata: Metadata = { robots: { index: false } };

export default async function SitePlaceholder({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">{site}</h1>
      <p className="mt-2 text-gray-600">Placeholder site.</p>
    </main>
  );
}
