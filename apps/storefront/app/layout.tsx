import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// Per-tenant metadata, theming and Host-based tenant resolution arrive in Phase 5.
export const metadata: Metadata = {
  title: 'TAHI',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
