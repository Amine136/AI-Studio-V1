"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signUp, signIn, signInWithGoogle } from "../../lib/auth";
import { useAuth } from "../../context/AuthContext";

type AuthMode = "signin" | "signup";

export default function AuthPage() {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();

    const [mode, setMode] = useState<AuthMode>("signup");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    // Redirect after auth state changes (not during render)
    useEffect(() => {
        if (!authLoading && user) {
            router.replace("/");
        }
    }, [authLoading, user, router]);

    if (authLoading || user) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <div className="auth-loader" />
            </main>
        );
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");

        if (!email.trim() || !password.trim()) {
            setError("Please fill in all fields.");
            return;
        }

        if (mode === "signup" && password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        if (password.length < 6) {
            setError("Password must be at least 6 characters.");
            return;
        }

        setLoading(true);
        try {
            if (mode === "signup") {
                await signUp(email, password);
            } else {
                await signIn(email, password);
            }
            router.replace("/");
        } catch (err: unknown) {
            const firebaseError = err as { code?: string; message?: string };
            const code = firebaseError.code || "";
            if (code === "auth/email-already-in-use") {
                setError("This email is already registered. Try signing in.");
            } else if (code === "auth/invalid-email") {
                setError("Invalid email address.");
            } else if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
                setError("Invalid email or password.");
            } else if (code === "auth/user-not-found") {
                setError("No account found with this email.");
            } else if (code === "auth/weak-password") {
                setError("Password is too weak. Use at least 6 characters.");
            } else {
                setError(firebaseError.message || "An unexpected error occurred.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError("");
        setLoading(true);
        try {
            await signInWithGoogle();
            router.replace("/");
        } catch (err: unknown) {
            const firebaseError = err as { message?: string };
            setError(firebaseError.message || "Google sign-in failed.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="min-h-screen flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-md animate-fade-in-up">

                {/* Branding */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-5 shadow-lg auth-logo-glow">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                    </div>
                    <h1 className="text-3xl sm:text-4xl font-extrabold gradient-text tracking-tight">
                        NovaNode
                    </h1>
                    <p className="mt-2 text-sm text-gray-500">
                        {mode === "signup" ? "Create your account to get started" : "Welcome back — sign in to continue"}
                    </p>
                </div>

                {/* Auth Card */}
                <div className="glass-card p-6 sm:p-8">

                    {/* Mode Toggle */}
                    <div className="auth-toggle-container mb-6">
                        <button
                            type="button"
                            className={`auth-toggle-btn ${mode === "signup" ? "auth-toggle-active" : ""}`}
                            onClick={() => { setMode("signup"); setError(""); }}
                        >
                            Sign Up
                        </button>
                        <button
                            type="button"
                            className={`auth-toggle-btn ${mode === "signin" ? "auth-toggle-active" : ""}`}
                            onClick={() => { setMode("signin"); setError(""); }}
                        >
                            Sign In
                        </button>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="auth-error mb-5 animate-fade-in">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Email */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                                Email
                            </label>
                            <input
                                id="auth-email"
                                type="email"
                                className="glass-input w-full p-3.5 text-sm"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                autoComplete="email"
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                                Password
                            </label>
                            <input
                                id="auth-password"
                                type="password"
                                className="glass-input w-full p-3.5 text-sm"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                            />
                        </div>

                        {/* Confirm Password (signup only) */}
                        {mode === "signup" && (
                            <div className="animate-fade-in">
                                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                                    Confirm Password
                                </label>
                                <input
                                    id="auth-confirm-password"
                                    type="password"
                                    className="glass-input w-full p-3.5 text-sm"
                                    placeholder="••••••••"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    autoComplete="new-password"
                                />
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full mt-2"
                        >
                            <span>
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="auth-spinner" />
                                        {mode === "signup" ? "Creating Account..." : "Signing In..."}
                                    </span>
                                ) : (
                                    mode === "signup" ? "Create Account" : "Sign In"
                                )}
                            </span>
                        </button>
                    </form>

                    {/* Divider */}
                    <div className="auth-divider my-6">
                        <span>or</span>
                    </div>

                    {/* Google Sign-In */}
                    <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={loading}
                        className="auth-google-btn w-full"
                    >
                        <svg width="18" height="18" viewBox="0 0 48 48">
                            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                        </svg>
                        Continue with Google
                    </button>
                </div>

                {/* Footer */}
                <p className="text-center text-[11px] text-gray-600 mt-6">
                    Powered by NovaNode
                </p>
            </div>
        </main>
    );
}
