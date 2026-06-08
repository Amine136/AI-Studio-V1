"use client";

import Link from "next/link";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../services/api";
import { signOutUser } from "../../lib/auth";
import {
  ACCENT_OPTIONS,
  type AccentColorId,
  applyAccentColorToDocument,
  persistAccentColor,
  readAccentColorFromCookie,
} from "../../lib/accentColor";

const PROFILE_SAVE_COOLDOWN_MS = 1200;

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
  const [accent, setAccent] = useState<AccentColorId>("blue");
  const [editableUsername, setEditableUsername] = useState("");
  const [bio, setBio] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [savedBio, setSavedBio] = useState("");
  const [profileChangesRemaining, setProfileChangesRemaining] = useState<number | null>(null);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [profileSaveSuccess, setProfileSaveSuccess] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaveCooldown, setProfileSaveCooldown] = useState(false);
  const [profileDailyLimitReached, setProfileDailyLimitReached] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsSuccess, setNotificationsSuccess] = useState<string | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [deactivationError, setDeactivationError] = useState<string | null>(null);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [deactivatingAccount, setDeactivatingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const profileSaveInFlightRef = useRef(false);
  const profileSaveCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayName = user?.displayName || user?.email?.split("@")[0] || "Vibecraft User";
  const email = user?.email || "No email available";
  const photoUrl = user?.photoURL || null;

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth");
    }
  }, [loading, router, user]);

  useEffect(() => {
    const savedAccent = readAccentColorFromCookie();
    setAccent(savedAccent);
    applyAccentColorToDocument(savedAccent);
  }, []);

  useEffect(() => {
    return () => {
      if (profileSaveCooldownTimerRef.current) {
        clearTimeout(profileSaveCooldownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void api
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        const nextUsername =
          String(profile.username || "").trim() ||
          (email.includes("@") ? email.split("@")[0] : displayName.toLowerCase().replace(/\s+/g, ""))
            .replace(/[^a-zA-Z0-9._-]/g, "")
            .slice(0, 15) ||
          "vibecraft";
        const nextBio = String(profile.bio || "");
        setEditableUsername(nextUsername);
        setSavedUsername(nextUsername);
        setBio(nextBio);
        setSavedBio(nextBio);
        setEmailNotifications(profile.emailGeneralNewsEnabled ?? true);
        setProductUpdates(profile.emailPlatformUpdatesEnabled ?? true);
        setProfileChangesRemaining(
          typeof profile.profileChangesRemaining === "number" ? profile.profileChangesRemaining : null,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setProfileSaveError(error instanceof Error ? error.message : "Failed to load profile settings.");
      });

    return () => {
      cancelled = true;
    };
  }, [displayName, email, user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="auth-loader" />
      </main>
    );
  }
  const profileNote =
    "Google authentication is currently the only live user sign-in method. Update your Google profile if you want Vibecraft to reflect a new name or image.";
  const accentPalette = ACCENT_OPTIONS[accent];
  const isProfileDirty = editableUsername !== savedUsername || bio !== savedBio;
  const profileSaveDisabled = !isProfileDirty || savingProfile || profileSaveCooldown || profileDailyLimitReached;

  async function handleProfileSave() {
    if (profileSaveDisabled || profileSaveInFlightRef.current) return;
    profileSaveInFlightRef.current = true;
    setProfileSaveCooldown(true);
    setSavingProfile(true);
    setProfileSaveError(null);
    setProfileSaveSuccess(null);
    try {
      const profile = await api.updateProfile({
        username: editableUsername,
        bio,
      });
      const nextUsername = String(profile.username || editableUsername);
      const nextBio = String(profile.bio || "");
      setEditableUsername(nextUsername);
      setSavedUsername(nextUsername);
      setBio(nextBio);
      setSavedBio(nextBio);
      setProfileChangesRemaining(
        typeof profile.profileChangesRemaining === "number" ? profile.profileChangesRemaining : null,
      );
      setProfileSaveSuccess("Profile updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update profile.";
      if (message.toLowerCase().includes("limited to 10 per day")) {
        setProfileDailyLimitReached(true);
      }
      setProfileSaveError(message);
    } finally {
      setSavingProfile(false);
      if (profileSaveCooldownTimerRef.current) {
        clearTimeout(profileSaveCooldownTimerRef.current);
      }
      profileSaveCooldownTimerRef.current = setTimeout(() => {
        profileSaveInFlightRef.current = false;
        setProfileSaveCooldown(false);
      }, PROFILE_SAVE_COOLDOWN_MS);
    }
  }

  async function handleNotificationPreferenceChange(next: {
    emailGeneralNewsEnabled: boolean;
    emailPlatformUpdatesEnabled: boolean;
  }) {
    const previousEmailNotifications = emailNotifications;
    const previousProductUpdates = productUpdates;
    setSavingNotifications(true);
    setNotificationsError(null);
    setNotificationsSuccess(null);
    setEmailNotifications(next.emailGeneralNewsEnabled);
    setProductUpdates(next.emailPlatformUpdatesEnabled);
    try {
      const profile = await api.updateNotificationPreferences(next);
      setEmailNotifications(profile.emailGeneralNewsEnabled ?? next.emailGeneralNewsEnabled);
      setProductUpdates(profile.emailPlatformUpdatesEnabled ?? next.emailPlatformUpdatesEnabled);
      setNotificationsSuccess("Notification preferences updated.");
    } catch (error) {
      setEmailNotifications(previousEmailNotifications);
      setProductUpdates(previousProductUpdates);
      setNotificationsError(error instanceof Error ? error.message : "Failed to update notification preferences.");
    } finally {
      setSavingNotifications(false);
    }
  }

  async function handleDeactivateAccount() {
    if (deactivatingAccount) return;
    setDeactivatingAccount(true);
    setDeactivationError(null);
    try {
      await api.deactivateAccount();
      await signOutUser();
      router.replace("/auth");
    } catch (error) {
      setDeactivationError(error instanceof Error ? error.message : "Failed to deactivate account.");
      setDeactivatingAccount(false);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutUser();
      router.replace("/auth");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-8 sm:space-y-12">
      <section id="account">
        <div className="mb-6 sm:mb-8">
          <div>
            <h3 className="font-headline text-3xl font-bold tracking-tight text-[#dce1fb] sm:text-4xl">Account</h3>
            <p className="mt-2 max-w-md text-[#c2c6d6]">
              Manage your public profile and core identity within the Vibecraft ecosystem.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#151b2d]">
          <div className="flex flex-col gap-5 border-b border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(173,198,255,0.14),transparent_34%),#151b2d] p-5 sm:flex-row sm:items-center sm:p-8">
            <div className="relative shrink-0">
              <div
                className="h-20 w-20 overflow-hidden rounded-2xl ring-2 ring-offset-4 ring-offset-[#151b2d] sm:h-24 sm:w-24"
                style={{
                  border: `1px solid ${accentPalette.ring}`,
                  boxShadow: `0 0 0 3px ${accentPalette.soft}`,
                  ["--tw-ring-color" as any]: accentPalette.ring,
                }}
              >
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#1f2b42] text-2xl font-black" style={{ color: accentPalette.solid }}>
                    {initialsFromName(displayName)}
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <h4 className="text-xl font-bold text-[#dce1fb]">{displayName}</h4>
              <p className="mt-1 text-sm text-[#c2c6d6]">@{savedUsername || editableUsername || "vibecraft"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                  Workspace
                </span>
                <span className="rounded-full bg-[#2e3447] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#b9c8de]">
                  Verified
                </span>
              </div>
              {savedBio || bio ? (
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d4e4fa]">{savedBio || bio}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-6 p-5 sm:space-y-8 sm:p-8">
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
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editableUsername}
                    maxLength={15}
                    onChange={(event) => {
                      const nextValue = event.target.value.replace(/[^a-zA-Z0-9._-]/g, "");
                      setEditableUsername(nextValue.slice(0, 15));
                    }}
                    className="w-full rounded-sm border border-transparent bg-[#070d1f] px-4 py-3 text-[#dce1fb] outline-none transition focus:border-[#adc6ff]/35"
                    placeholder="Choose a username"
                  />
                  <div className="flex items-center justify-between text-[11px] text-[#8c909f]">
                    <span>Letters, numbers, dots, underscores, and hyphens only.</span>
                    <span>{editableUsername.length}/15</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-[0.22em] text-[#8c909f]">Bio</label>
                <div className="space-y-2">
                  <textarea
                    rows={5}
                    value={bio}
                    maxLength={500}
                    onChange={(event) => setBio(event.target.value.slice(0, 500))}
                    className="w-full resize-none rounded-sm border border-transparent bg-[#070d1f] px-4 py-3 text-[#dce1fb] outline-none transition placeholder:text-[#8c909f] focus:border-[#adc6ff]/35"
                    placeholder="what you build, explore or create with vibecraft"
                  />
                  <div className="flex flex-col gap-2 text-[11px] text-[#8c909f] sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <span>{profileNote}</span>
                    <span className="shrink-0">{bio.length}/500</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/8 pt-4 text-[11px] text-[#8c909f] sm:flex-row sm:items-center sm:justify-between">
              <span>
                {profileChangesRemaining === null
                  ? "Profile changes are limited to 2 per month."
                  : `${profileChangesRemaining} profile change${profileChangesRemaining === 1 ? "" : "s"} remaining this month.`}
              </span>
              {profileSaveError ? <span className="text-[#ffb4ab]">{profileSaveError}</span> : null}
              {!profileSaveError && profileSaveSuccess ? <span className="text-[#adc6ff]">{profileSaveSuccess}</span> : null}
            </div>

            <div className="flex justify-end pt-2 sm:pt-4">
              <button
                type="button"
                onClick={() => void handleProfileSave()}
                disabled={profileSaveDisabled}
                className={`rounded-sm bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-8 py-3 text-sm font-bold tracking-wide text-[#002e6a] transition ${
                  profileSaveDisabled ? "cursor-not-allowed opacity-60" : "hover:brightness-110"
                }`}
              >
                {savingProfile ? "Saving..." : profileDailyLimitReached ? "Daily Limit Reached" : "Update Profile"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="preferences" className="pt-8">
        <div className="mb-8">
          <h3 className="font-headline text-2xl font-bold tracking-tight text-[#dce1fb] sm:text-3xl">Preferences</h3>
          <p className="mt-2 text-[#c2c6d6]">Tailor the Studio environment to your creative workflow.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          <div className="overflow-hidden rounded-md bg-[#151b2d] lg:col-span-2">
            <div className="border-b border-white/8 px-5 py-5 sm:px-8 sm:py-6">
              <h4 className="text-lg font-bold text-[#dce1fb]">Notifications</h4>
            </div>
            <div className="space-y-6 p-5 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-[#dce1fb]">AI General News</p>
                  <p className="text-xs text-[#c2c6d6]">Email updates about major AI news and general ecosystem shifts.</p>
                </div>
                <button
                  type="button"
                  disabled={savingNotifications}
                  onClick={() =>
                    void handleNotificationPreferenceChange({
                      emailGeneralNewsEnabled: !emailNotifications,
                      emailPlatformUpdatesEnabled: productUpdates,
                    })
                  }
                  className={`relative h-6 w-11 rounded-full transition ${emailNotifications ? "bg-[#adc6ff]" : "bg-[#2e3447]"} ${savingNotifications ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <span
                    className={`absolute top-[2px] h-5 w-5 rounded-full bg-white transition ${
                      emailNotifications ? "left-[22px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-[#dce1fb]">Platform News and Model Updates</p>
                  <p className="text-xs text-[#c2c6d6]">New Vibecraft features, platform changes, and newly added AI models.</p>
                </div>
                <button
                  type="button"
                  disabled={savingNotifications}
                  onClick={() =>
                    void handleNotificationPreferenceChange({
                      emailGeneralNewsEnabled: emailNotifications,
                      emailPlatformUpdatesEnabled: !productUpdates,
                    })
                  }
                  className={`relative h-6 w-11 rounded-full transition ${productUpdates ? "bg-[#adc6ff]" : "bg-[#2e3447]"} ${savingNotifications ? "cursor-not-allowed opacity-70" : ""}`}
                >
                  <span
                    className={`absolute top-[2px] h-5 w-5 rounded-full bg-white transition ${
                      productUpdates ? "left-[22px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
              {notificationsError ? <p className="text-xs text-[#ffb4ab]">{notificationsError}</p> : null}
              {!notificationsError && notificationsSuccess ? (
                <p className="text-xs text-[#adc6ff]">{notificationsSuccess}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col rounded-md bg-[#151b2d] p-5 sm:p-8">
            <h4 className="mb-6 text-lg font-bold text-[#dce1fb]">Accent Color</h4>
            <div className="grid max-w-[220px] grid-cols-3 gap-3">
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
                  onClick={() => {
                    const nextAccent = option.id as AccentColorId;
                    setAccent(nextAccent);
                    persistAccentColor(nextAccent);
                    applyAccentColorToDocument(nextAccent);
                  }}
                  className={`aspect-square rounded-sm transition-all ${option.color} ${
                    accent === option.id ? "ring-2 ring-[#adc6ff] ring-offset-4 ring-offset-[#151b2d]" : "opacity-60 hover:opacity-100"
                  }`}
                  style={
                    accent === option.id
                      ? ({ ["--tw-ring-color" as any]: ACCENT_OPTIONS[option.id as AccentColorId].ring } as CSSProperties)
                      : undefined
                  }
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
          <h3 className="font-headline text-2xl font-bold tracking-tight text-[#dce1fb] sm:text-3xl">Legal</h3>
          <p className="mt-2 text-[#c2c6d6]">Review our guidelines, privacy commitment, and terms of service.</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#151b2d]">
          <div className="divide-y divide-white/8">
            <Link href="/privacy" className="group flex items-center justify-between p-4 transition-colors hover:bg-white/[0.03] sm:p-6">
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

            <Link href="/policy" className="group flex items-center justify-between p-4 transition-colors hover:bg-white/[0.03] sm:p-6">
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

            <Link href="/privacy" className="group flex items-center justify-between p-4 transition-colors hover:bg-white/[0.03] sm:p-6">
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

      <section className="pt-8">
        <div className="flex flex-col items-start justify-between gap-5 rounded-2xl border border-white/8 bg-[#151b2d] p-5 sm:flex-row sm:items-center sm:p-8">
          <div>
            <h4 className="text-xl font-bold text-[#dce1fb]">Session</h4>
            <p className="mt-1 text-sm text-[#c2c6d6]">End your current session securely.</p>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={`inline-flex items-center gap-2 rounded-sm border border-white/10 bg-[#070d1f] px-5 py-2.5 text-sm font-bold text-[#dce1fb] transition ${
              signingOut ? "cursor-not-allowed opacity-70" : "hover:border-[#adc6ff]/35 hover:text-[#adc6ff]"
            }`}
          >
            <span className="material-symbols-outlined text-lg">{signingOut ? "hourglass_top" : "logout"}</span>
            {signingOut ? "Signing Out..." : "Sign Out"}
          </button>
        </div>
      </section>

      <section className="pb-12 pt-8 sm:pt-12">
        <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-[#93000a]/30 bg-[#93000a]/10 p-5 sm:p-8 md:flex-row md:items-center">
          <div>
            <h4 className="text-xl font-bold text-[#ffb4ab]">Deactivate Account</h4>
            <p className="mt-1 text-sm text-[#c2c6d6]">
              Deactivating your account is permanent. You will lose access to this account and you will no longer be able to access its data.
            </p>
            {deactivationError ? <p className="mt-3 text-xs text-[#ffb4ab]">{deactivationError}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => setShowDeactivateConfirm(true)}
            disabled={deactivatingAccount}
            className={`rounded-sm border border-[#93000a]/50 px-6 py-2.5 text-sm font-bold text-[#ffb4ab] transition ${
              deactivatingAccount ? "cursor-not-allowed opacity-70" : "hover:bg-[#93000a]/10"
            }`}
          >
            {deactivatingAccount ? "Deactivating..." : "Deactivate Account"}
          </button>
        </div>
      </section>
      {showDeactivateConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6">
          <div className="w-full max-w-lg rounded-md border border-[#93000a]/35 bg-[#151b2d] p-8">
            <h4 className="text-xl font-bold text-[#ffb4ab]">Confirm Account Deactivation</h4>
            <p className="mt-4 text-sm leading-relaxed text-[#c2c6d6]">
              Once you deactivate this account, you will lose access to your workspace, balance, history, conversations, and generated content tied to this account.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[#c2c6d6]">
              You will be signed out immediately and this account will no longer be accessible.
            </p>
            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeactivateConfirm(false)}
                disabled={deactivatingAccount}
                className="rounded-sm border border-white/10 px-5 py-2.5 text-sm font-bold text-[#dce1fb] transition hover:bg-white/[0.03]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeactivateAccount()}
                disabled={deactivatingAccount}
                className={`rounded-sm border border-[#93000a]/50 bg-[#93000a]/15 px-5 py-2.5 text-sm font-bold text-[#ffb4ab] transition ${
                  deactivatingAccount ? "cursor-not-allowed opacity-70" : "hover:bg-[#93000a]/25"
                }`}
              >
                {deactivatingAccount ? "Deactivating..." : "Confirm Deactivation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="pb-8 text-center text-xs text-[#7a8197]">Vibecraft v1.1.5</p>
    </div>
  );
}
