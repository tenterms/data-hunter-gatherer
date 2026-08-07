import Link from "next/link";

/** Layout for the team-only backend (behind the password gate when set). */
export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="inner">
          <Link href="/" className="brand">
            TenTerms<span className="tm">™</span>
          </Link>
          <span className="sub">SEO reporting</span>
          <nav className="header-nav">
            <Link href="/">Reports</Link>
            <Link href="/reactimus">Reactimus</Link>
            <Link href="/admin">Admin</Link>
          </nav>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
