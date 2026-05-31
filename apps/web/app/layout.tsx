/**
 * Root layout. Wraps every page.
 *
 * - Uses Geist Sans + Geist Mono via Vercel's `geist` font package (zero layout shift).
 * - Imports global Tailwind v4 styles + shadcn theme variables.
 * - Light-only theme for MVP; add `className="dark"` to <html> for dark mode.
 */

import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'RAG — Engineering Memory',
  description:
    'Searchable engineering memory built from your team’s GitHub PRs, issues, comments, and commits.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
