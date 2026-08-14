import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const plexSansArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-sans-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "Sanad HR — People, simply managed",
    description: "Sanad's bilingual employee experience and HR operations platform.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Sanad HR — People, simply managed",
      description: "A modern bilingual employee experience and HR operations platform.",
      images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: "Sanad HR — People, simply managed" }],
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
    <html lang="en">
      <body
        className={`${plexSansArabic.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
