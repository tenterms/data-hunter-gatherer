import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEO Reporting Dashboard",
  description: "Internal monthly SEO reporting dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="brand">
              SEO Reporting
            </Link>
            <span className="sub">internal monthly reports</span>
            <nav className="header-nav">
              <Link href="/">Reports</Link>
              <Link href="/admin">Admin</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
