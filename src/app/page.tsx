import { createClient } from "@/utils/supabase/server";
import Header from "@/components/Header";
import Link from "next/link";

export const metadata = {
  title: "Blind Box Travelling",
  description: "Khám phá những địa điểm bí mật đang chờ bạn.",
};

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#fff" }}>
      <Header user={user} />
      <main style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: "2rem", padding: "2rem",
      }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{
            fontSize: "clamp(2rem, 6vw, 3.5rem)", fontWeight: 700,
            letterSpacing: "-0.03em", color: "#111827", margin: "0 0 0.75rem", lineHeight: 1.1,
          }}>
            Blind Box Travelling
          </h1>
          <p style={{ color: "#6b7280", fontSize: "1.125rem", margin: 0 }}>
            Khám phá những địa điểm bí mật đang chờ bạn.
          </p>
        </div>

        {user ? (
          <Link href="/app" style={{
            display: "inline-flex", alignItems: "center", gap: "0.625rem",
            padding: "0.875rem 2.25rem", borderRadius: "10px",
            background: "#111827", color: "#fff", fontWeight: 600,
            fontSize: "1rem", textDecoration: "none", letterSpacing: "-0.01em",
          }}>
            START
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
        ) : (
          <Link href="/login" style={{
            display: "inline-flex", alignItems: "center", gap: "0.625rem",
            padding: "0.875rem 2.25rem", borderRadius: "10px",
            background: "#111827", color: "#fff", fontWeight: 600,
            fontSize: "1rem", textDecoration: "none",
          }}>
            Đăng nhập để bắt đầu
          </Link>
        )}
      </main>
    </div>
  );
}