import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer, Header } from "@/components/layout";
import { REQUIRED_WARNING } from "@/lib/disclaimer";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Lao Lottery Statistics Dashboard", template: "%s · Lao Lottery Statistics" },
  description: `แดชบอร์ดวิเคราะห์สถิติย้อนหลังผลสลากลาวเพื่อการศึกษา — ${REQUIRED_WARNING}`,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

// Runs before paint: stored choice → OS preference. Avoids a light/dark flash.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t)}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          ข้ามไปยังเนื้อหา
        </a>
        <Header />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
