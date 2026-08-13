"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sticky sub-navigation inside a client's admin area. */
export default function ClientTabs({ clientKey }: { clientKey: string }) {
  const pathname = usePathname();
  const base = `/admin/${clientKey}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/draw`, label: "Work grid" },
    { href: `${base}/pages`, label: "Key pages" },
    { href: `${base}/content-groups`, label: "Content groups" },
    { href: `${base}/topic-clusters`, label: "Topic clusters" },
    { href: `${base}/report-settings`, label: "Report settings" },
    { href: `/reactimus/${clientKey}/pages`, label: "Master page list" },
  ];
  return (
    <nav className="client-tabs">
      {tabs.map((tab) => {
        const active = tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "active" : ""}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
