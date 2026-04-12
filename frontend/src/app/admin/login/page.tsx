"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import AnimatedLogo from "../../../components/AnimatedLogo";
import { isAdminHost } from "../../../lib/admin";
import { api } from "../../../services/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAdminHost()) {
      router.replace("/");
      return;
    }

    api.getAdminSession()
      .then(() => {
        router.replace("/");
      })
      .catch(() => {});
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.adminLogin(username, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-scene min-h-screen flex items-center justify-center px-4 py-12">
      <div className="auth-bg-glow" aria-hidden="true" />
      <div className="auth-particles" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="relative z-10 w-full max-w-md animate-fade-in-up">
        <div className="text-center mb-10">
          <AnimatedLogo />
          <h1 className="auth-title text-4xl sm:text-5xl font-extrabold gradient-text tracking-tight">
            Vibecraft Admin
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Dedicated access for the admin portal
          </p>
        </div>

        <div className="glass-card p-6 sm:p-8">
          {error ? (
            <div className="auth-error mb-5 animate-fade-in">
              <span>{error}</span>
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="glass-input w-full"
              placeholder="Admin username"
              autoComplete="username"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="glass-input w-full"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            <button type="submit" disabled={loading} className="auth-google-btn w-full justify-center">
              {loading ? <span className="auth-spinner" /> : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
