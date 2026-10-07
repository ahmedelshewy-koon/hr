import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { PwaRegistration } from "./pwa-registration";
import { appOrigin } from "./app-origin";

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#031212" };

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = appOrigin() ?? `${protocol}://${host}`;
  return {
    title: "HR — People, simply managed",
    description: "A bilingual employee experience and HR operations platform.",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "HR", statusBarStyle: "default" },
    openGraph: {
      title: "HR — People, simply managed",
      description: "A modern bilingual employee experience and HR operations platform.",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "HR — People, simply managed" }],
    },
    twitter: { card: "summary_large_image", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* Keep icons in the initial head: streamed metadata can land in the body. */}
        <link rel="icon" type="image/png" href="/favicon.png?v=sana-1" />
        <link rel="shortcut icon" href="/favicon.png?v=sana-1" />
        <link rel="apple-touch-icon" href="/hr-icon-192.png" />
      </head>
      <body
        className="antialiased"
      >
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
