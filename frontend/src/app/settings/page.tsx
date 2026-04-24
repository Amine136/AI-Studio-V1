"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function initialsFromName(value?: string | null) {
  if (!value) return "VC";
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "VC";
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [productUpdates, setProductUpdates] = useState(false);
  const [accent, setAccent] = useState("blue");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth");
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }

  const displayName = user.displayName || user.email?.split("@")[0] || "Vibecraft User";
  const email = user.email || "No email available";
  const photoUrl = user.photoURL || null;
  const username = email.includes("@") ? email.split("@")[0] : displayName.toLowerCase().replace(/\s+/g, "");
  const profileNote =
    "Google authentication is currently the only live user sign-in method. Update your Google profile if you want Vibecraft to reflect a new name or image.";

  return (
    <div className="space-y-12">
      <section id="account">
        <div className="mb-8">
          <div>
            <h3 className="font-headline text-4xl font-bold tracking-tight text-[#dce1fb]">Account</h3>
            <p className="mt-2 max-w-md text-[#c2c6d6]">
              Manage your public profile and core identity within the Creative Studio ecosystem.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-4 rounded-md bg-[#151b2d] p-8 text-center">
            <div className="relative mx-auto w-fit">
              <div className="h-32 w-32 overflow-hidden rounded-md ring-4 ring-[#adc6ff]/20 ring-offset-4 ring-offset-[#151b2d]">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#1f2b42] text-3xl font-black text-[#adc6ff]">
                    {initialsFromName(displayName)}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="absolute bottom-0 right-0 rounded-md bg-[#adc6ff] p-2 text-[#002e6a] shadow-lg transition-transform hover:scale-110"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
            </div>

            <div className="mt-6">
              <h4 className="text-xl font-bold text-[#dce1fb]">{displayName}</h4>
              <p className="text-sm text-[#c2c6d6]">Google-linked Vibecraft account</p>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <span className="rounded-full bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                Pro Plan
              </span>
              <span className="rounded-full bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                Verified
              </span>
            </div>
          </div>

          <div className="space-y-8 rounded-md bg-[#151b2d] p-8 lg:col-span-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Full Name</label>
                <input
                  readOnly
                  type="text"
                  value={displayName}
                  className="w-full rounded-sm border-none bg-[#070d1f] px-4 py-3 text-[#dce1fb] outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Email Address</label>
                <input
                  readOnly
                  type="email"
                  value={email}
                  className="w-full rounded-sm border-none bg-[#070d1f] px-4 py-3 text-[#dce1fb] outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Username</label>
                <input
                  type="text"
                  defaultValue={username}
                  className="w-full rounded-sm border-none bg-[#070d1f] px-4 py-3 text-[#dce1fb] outline-none placeholder:text-[#8c909f]"
                  placeholder="Choose a username"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Professional Bio</label>
                <textarea
                  readOnly
                  rows={4}
                  value={profileNote}
                  className="w-full resize-none rounded-sm border-none bg-[#070d1f] px-4 py-3 text-[#dce1fb] outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="button"
                disabled
                className="cursor-not-allowed rounded-sm bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-8 py-3 text-sm font-bold tracking-wide text-[#002e6a] opacity-60"
              >
                Update Profile
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="preferences" className="pt-8">
        <div className="mb-8">
          <h3 className="font-headline text-3xl font-bold tracking-tight text-[#dce1fb]">Preferences</h3>
          <p className="mt-2 text-[#c2c6d6]">Tailor the Studio environment to your creative workflow.</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="overflow-hidden rounded-md bg-[#151b2d] lg:col-span-2">
            <div className="border-b border-white/8 px-8 py-6">
              <h4 className="text-lg font-bold text-[#dce1fb]">Notifications</h4>
            </div>
            <div className="space-y-6 p-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#dce1fb]">Email Notifications</p>
                  <p className="text-xs text-[#c2c6d6]">Daily summaries and account alerts</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEmailNotifications((current) => !current)}
                  className={`relative h-6 w-11 rounded-full transition ${emailNotifications ? "bg-[#adc6ff]" : "bg-[#2e3447]"}`}
                >
                  <span
                    className={`absolute top-[2px] h-5 w-5 rounded-full bg-white transition ${
                      emailNotifications ? "left-[22px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[#dce1fb]">Product Updates</p>
                  <p className="text-xs text-[#c2c6d6]">Early access to beta features and AI models</p>
                </div>
                <button
                  type="button"
                  onClick={() => setProductUpdates((current) => !current)}
                  className={`relative h-6 w-11 rounded-full transition ${productUpdates ? "bg-[#adc6ff]" : "bg-[#2e3447]"}`}
                >
                  <span
                    className={`absolute top-[2px] h-5 w-5 rounded-full bg-white transition ${
                      productUpdates ? "left-[22px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col rounded-md bg-[#151b2d] p-8">
            <h4 className="mb-6 text-lg font-bold text-[#dce1fb]">Accent Color</h4>
            <div className="grid flex-1 grid-cols-3 gap-4">
              {[
                { id: "blue", color: "bg-[#adc6ff]" },
                { id: "violet", color: "bg-[#d0bcff]" },
                { id: "red", color: "bg-[#ef4444]" },
                { id: "green", color: "bg-[#10b981]" },
                { id: "amber", color: "bg-[#f59e0b]" },
                { id: "pink", color: "bg-[#ec4899]" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setAccent(option.id)}
                  className={`aspect-square rounded-sm transition-all ${option.color} ${
                    accent === option.id ? "ring-2 ring-[#adc6ff] ring-offset-4 ring-offset-[#151b2d]" : "opacity-60 hover:opacity-100"
                  }`}
                />
              ))}
            </div>
            <p className="mt-8 text-center text-[10px] font-bold uppercase tracking-[0.24em] text-[#8c909f]">
              System theme: Obsidian Dark
            </p>
          </div>
        </div>
      </section>

      <section id="legal" className="pt-8">
        <div className="mb-8">
          <h3 className="font-headline text-3xl font-bold tracking-tight text-[#dce1fb]">Legal</h3>
          <p className="mt-2 text-[#c2c6d6]">Review our guidelines, privacy commitment, and terms of service.</p>
        </div>

        <div className="overflow-hidden rounded-md border border-white/8 bg-[#151b2d]">
          <div className="divide-y divide-white/8">
            <Link href="/privacy" className="group flex items-center justify-between p-6 transition-colors hover:bg-white/[0.03]">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-[#2e3447] text-[#adc6ff]">
                  <span className="material-symbols-outlined">shield_lock</span>
                </div>
                <div>
                  <p className="font-bold text-[#dce1fb]">Privacy Policy</p>
                  <p className="text-xs text-[#c2c6d6]">How we handle and protect your data</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-[#8c909f] transition-colors group-hover:text-[#adc6ff]">chevron_right</span>
            </Link>

            <Link href="/policy" className="group flex items-center justify-between p-6 transition-colors hover:bg-white/[0.03]">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-[#2e3447] text-[#adc6ff]">
                  <span className="material-symbols-outlined">description</span>
                </div>
                <div>
                  <p className="font-bold text-[#dce1fb]">Terms of Service</p>
                  <p className="text-xs text-[#c2c6d6]">The legal framework for using our platform</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-[#8c909f] transition-colors group-hover:text-[#adc6ff]">chevron_right</span>
            </Link>

            <Link href="/privacy" className="group flex items-center justify-between p-6 transition-colors hover:bg-white/[0.03]">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-[#2e3447] text-[#adc6ff]">
                  <span className="material-symbols-outlined">cookie</span>
                </div>
                <div>
                  <p className="font-bold text-[#dce1fb]">Cookie Policy</p>
                  <p className="text-xs text-[#c2c6d6]">Information about our use of session storage and cookies</p>
                </div>
              </div>
              <span className="material-symbols-outlined text-[#8c909f] transition-colors group-hover:text-[#adc6ff]">chevron_right</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-12 pt-16">
        <div className="flex flex-col items-start justify-between gap-6 rounded-md border border-[#93000a]/30 bg-[#93000a]/10 p-8 md:flex-row md:items-center">
          <div>
            <h4 className="text-xl font-bold text-[#ffb4ab]">Deactivate Account</h4>
            <p className="mt-1 text-sm text-[#c2c6d6]">
              This action is not self-serve in the MVP. Contact support if you need account removal or assistance with your Google-linked identity.
            </p>
          </div>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-sm border border-[#93000a]/50 px-6 py-2.5 text-sm font-bold text-[#ffb4ab] opacity-70"
          >
            Delete Account
          </button>
        </div>
      </section>
    </div>
  );
}
