export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Arrives in Phase 1.</p>
    </>
  );
}
