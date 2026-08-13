import type { Metadata } from "next";
// TenTerms brand font (self-hosted so builds never depend on Google Fonts).
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "TenTerms · SEO Reporting",
  description: "Monthly SEO reporting by TenTerms",
  // Internal tool + unguessable client share links: never in search engines.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
