"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sticky sub-navigation inside a client's admin area. */
export default function ClientTabs({ clientKey }: { clientKey: string }) {
  const pathname = usePathname();
  const base = `/admin/${clientKey}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/pages`, label: "Key pages" },
    { href: `${base}/content-groups`, label: "Content groups" },
    { href: `${base}/topic-clusters`, label: "Topic clusters" },
  ];
  return (
    <nav className="client-tabs">
      {tabs.map((tab) => {
        const active =
          tab.href === base
            ? pathname === base || pathname.startsWith(`${base}/draw`)
            : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "active" : ""}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
