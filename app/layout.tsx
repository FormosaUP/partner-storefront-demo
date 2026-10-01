import type { Metadata, Viewport } from 'next';
import { Fraunces, Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'optional',
});

const ui = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Order online for pickup',
  description: 'Browse the menu, build your order and pick it up at the counter.',
};

export const viewport: Viewport = {
  themeColor: '#f6f1e7',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <head>
        <link rel="preconnect" href="https://api-dev.ulite.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://img-dev.ulite.com" />
      </head>
      <body>{children}</body>
    </html>
  );
}
