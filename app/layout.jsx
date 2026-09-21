import '@/index.css';
import Providers from './providers';

// Everything here came from the old index.html. Next emits <meta charset> and
// the base <meta viewport> itself, so those two are deliberately absent.
export const metadata = {
  title: 'APIx — Airfare Price Index',
  description:
    "APIx — a daily, route-level airfare price index for India, computed on MoSPI's published CPI 2024 method.",
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
};

// themeColor belongs here, not in `metadata` — it is deprecated there as of
// Next 14. Server Components only.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f5f0',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
