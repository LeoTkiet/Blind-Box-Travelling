"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingAnon, setLoadingAnon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setError("Đăng nhập thất bại. Vui lòng thử lại.");
    }
  }, []);

  const handleGoogleLogin = async () => {
    setLoadingGoogle(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoadingGoogle(false);
    }
  };

  const handleAnonLogin = async () => {
    setLoadingAnon(true);
    setError(null);
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      setError(error.message);
      setLoadingAnon(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="login-root">
      <div className={`login-card ${mounted ? "login-card--visible" : ""}`}>
        {/* Logo */}
        <div className="logo-wrap">
          <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
            <circle cx="18" cy="18" r="17" stroke="currentColor" strokeWidth="2" />
            <circle cx="18" cy="18" r="5" fill="currentColor" />
            <line x1="18" y1="1" x2="18" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="18" y1="29" x2="18" y2="35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="1" y1="18" x2="7" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <line x1="29" y1="18" x2="35" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>

        {/* Heading */}
        <div className="card-header">
          <h1 className="card-title">Blind Box Travelling</h1>
          <p className="card-subtitle">Chọn cách bắt đầu hành trình của bạn.</p>
        </div>

        {/* Error message */}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="btn-group">
          {/* Google Button */}
          <button
            id="btn-google-login"
            className="btn btn-google"
            onClick={handleGoogleLogin}
            disabled={loadingGoogle || loadingAnon}
          >
            {loadingGoogle ? (
              <span className="spinner" />
            ) : (
              <svg className="btn-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            <span>{loadingGoogle ? "Đang chuyển hướng..." : "Tiếp tục với Google"}</span>
          </button>

          {/* Divider */}
          <div className="divider">
            <span>hoặc</span>
          </div>

          {/* Anonymous Button */}
          <button
            id="btn-anonymous-login"
            className="btn btn-anon"
            onClick={handleAnonLogin}
            disabled={loadingGoogle || loadingAnon}
          >
            {loadingAnon ? (
              <span className="spinner spinner-anon" />
            ) : (
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            )}
            <span>{loadingAnon ? "Đang vào..." : "Tiếp tục ẩn danh"}</span>
          </button>
        </div>

        {/* Footer */}
        <p className="card-footer">
          Khi tiếp tục, bạn đồng ý với{" "}
          <a href="#" className="footer-link">Điều khoản dịch vụ</a>{" "}
          và <a href="#" className="footer-link">Chính sách bảo mật</a>.
        </p>
      </div>

      <style jsx>{`
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
          font-family: var(--font-geist-sans), 'Inter', system-ui, sans-serif;
          padding: 1rem;
        }

        /* Card */
        .login-card {
          width: 100%;
          max-width: 400px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 2.5rem 2rem;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
          opacity: 0;
          transform: translateY(12px);
          transition: opacity 0.35s ease, transform 0.35s ease;
        }
        .login-card--visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Logo */
        .logo-wrap {
          display: flex;
          justify-content: center;
          margin-bottom: 1.5rem;
          color: #111827;
        }

        /* Header */
        .card-header {
          text-align: center;
          margin-bottom: 2rem;
        }
        .card-title {
          font-size: 1.5rem;
          font-weight: 700;
          color: #111827;
          letter-spacing: -0.02em;
          margin: 0 0 0.5rem;
        }
        .card-subtitle {
          font-size: 0.875rem;
          color: #6b7280;
          margin: 0;
        }

        /* Error */
        .error-banner {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #b91c1c;
          border-radius: 8px;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          margin-bottom: 1.25rem;
        }

        /* Button group */
        .btn-group {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        /* Buttons */
        .btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.625rem;
          width: 100%;
          height: 48px;
          border-radius: 10px;
          font-size: 0.9375rem;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
        }
        .btn:active { transform: scale(0.98); }
        .btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .btn:disabled:active { transform: none; }

        /* Google: white with border */
        .btn-google {
          background: #ffffff;
          color: #111827;
          border: 1px solid #d1d5db;
          box-shadow: 0 1px 3px rgba(0,0,0,0.07);
        }
        .btn-google:hover:not(:disabled) {
          background: #f9fafb;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }

        /* Anon: black fill */
        .btn-anon {
          background: #111827;
          color: #ffffff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .btn-anon:hover:not(:disabled) {
          background: #1f2937;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }

        /* Icon */
        .btn-icon {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        /* Spinner */
        .spinner {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid rgba(0,0,0,0.12);
          border-top-color: #111827;
          animation: spin 0.65s linear infinite;
          flex-shrink: 0;
        }
        .spinner-anon {
          border-color: rgba(255,255,255,0.2);
          border-top-color: #ffffff;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Divider */
        .divider {
          display: flex;
          align-items: center;
          gap: 0.875rem;
          color: #9ca3af;
          font-size: 0.8125rem;
        }
        .divider::before,
        .divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #e5e7eb;
        }

        /* Footer */
        .card-footer {
          text-align: center;
          font-size: 0.75rem;
          color: #9ca3af;
          line-height: 1.6;
          margin: 0;
        }
        .footer-link {
          color: #6b7280;
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: color 0.15s;
        }
        .footer-link:hover { color: #111827; }
      `}</style>
    </div>
  );
}
