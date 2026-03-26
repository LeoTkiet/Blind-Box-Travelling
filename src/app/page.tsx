import { createClient } from "@/utils/supabase/server";
import UserButton from "@/components/UserButton";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "0.75rem 1.5rem",
        borderBottom: "1px solid #e5e7eb",
        background: "#ffffff",
      }}>
        <UserButton user={user} />
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <p style={{ fontSize: "1rem", color: "#374151" }}>Đây là trang chính</p>
      </main>
    </div>
  );
}