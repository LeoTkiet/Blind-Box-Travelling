import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import UserButton from "./UserButton";

const TABS = [{ label: "Du lịch hộp mù", href: "/app" }];

export default function Header({ user }: { user: User | null }) {
  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 1.5rem", height: "52px",
      borderBottom: "1px solid #e5e7eb", background: "#fff", flexShrink: 0,
    }}>
      <Link href="/" style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#111827", textDecoration: "none", letterSpacing: "-0.02em" }}>
        BBT
      </Link>

      <nav style={{ display: "flex", gap: "0.125rem" }}>
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} style={{
            padding: "0.4rem 0.875rem", borderRadius: "6px",
            fontSize: "0.875rem", fontWeight: 500, color: "#374151", textDecoration: "none",
          }}>
            {tab.label}
          </Link>
        ))}
      </nav>

      <UserButton user={user} />
    </header>
  );
}
