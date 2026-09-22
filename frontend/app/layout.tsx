import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Server Inventory Platform',
  description: 'Internal server inventory and key management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
