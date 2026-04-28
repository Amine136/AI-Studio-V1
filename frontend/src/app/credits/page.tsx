"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { redeemCode } from "../../lib/creditCodes";
import { getCredits } from "../../lib/credits";
import { getHistory, type HistoryEntry } from "../../lib/history";


interface SuspensionState {
  reason: string;
  endsAt: string | null;
  endsAtLabel: string | null;
}

type UsageEvent = {
  id: string;
  date: string;
  activity: string;
  detail: string;
  status: string;
  amount: string;
  positive?: boolean;
};



function formatSuspensionEndsAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date) + " UTC"
  );
}

function parseSuspensionState(message: string): SuspensionState | null {
  if (!message.toLowerCase().includes("your account is suspended") && !message.toLowerCase().includes("account is suspended")) {
    return null;
  }

  const endsAtMatch = message.match(/Suspension ends at\s+([^.]+)\./i);
  const endsAt = endsAtMatch?.[1]?.trim() || null;
  const reasonText = message
    .replace(/^Your account is suspended:\s*/i, "")
    .replace(/^Your account is suspended\.?\s*/i, "")
    .replace(/^Account is suspended:\s*/i, "")
    .replace(/\s*Suspension ends at\s+([^.]+)\./i, "")
    .trim();

  return {
    reason: reasonText || "Access to this account has been restricted.",
    endsAt,
    endsAtLabel: endsAt ? formatSuspensionEndsAt(endsAt) : null,
  };
}

function shouldShowPolicyLink(message: string) {
  return /usage policy|failed credit code attempts|failed credit-code attempts|suspended/i.test(message);
}

function isRedeemCooldownMessage(message: string) {
  return /reached 5 failed credit code attempts in 5 minutes/i.test(message);
}

function mapHistoryToUsageEvents(entries: HistoryEntry[]): UsageEvent[] {
  return entries.slice(0, 5).map((entry) => {
    const outputs = [entry.imageUrl ? "Image" : null, entry.caption ? "Caption" : null].filter(Boolean).join(" + ") || "Generation";
    return {
      id: entry.id,
      date: entry.createdAt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
      activity: outputs,
      detail: entry.model || "Saved studio output",
      status: "COMPLETED",
      amount: "Logged",
    };
  });
}



const faqItems = [
  {
    title: "Do credits expire?",
    body: "Regular Vibecraft credits do not expire during the MVP. Temporary or promotional credits may include their own expiry windows.",
  },
  {
    title: "Can I add credits directly?",
    body: "For the current MVP, top-ups happen through redeem codes only. Public checkout and auto-refill are not active yet.",
  },
  {
    title: "What happens if a task fails?",
    body: "If Vibecraft cannot deliver a usable result, reserved generation credits are released automatically and the user is not charged.",
  },
  {
    title: "What does Smart mode charge?",
    body: "Smart mode adds a fixed analysis fee before generation starts, then applies the selected model costs for any successful output.",
  },
];

export default function CreditsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [credits, setCredits] = useState<number | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [codeInput, setCodeInput] = useState("");
  const [codeMessage, setCodeMessage] = useState<{ text: string; success: boolean; showPolicyLink?: boolean } | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemBlockedUntil, setRedeemBlockedUntil] = useState<number | null>(null);
  const [suspension, setSuspension] = useState<SuspensionState | null>(null);

  const redeemCooldownStorageKey = user ? `vibecraft:redeemCooldownUntil:${user.uid}` : null;

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth");
    }
  }, [loading, router, user]);

  const fetchBalance = useCallback(async () => {
    if (!user) return;
    try {
      const nextCredits = await getCredits(user.uid);
      setCredits(nextCredits);
      setProfileError(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Could not load your credit balance.";
      setCredits(0);
      setProfileError(message);
    }
  }, [user]);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const entries = await getHistory(user.uid, 8);
      setHistory(entries);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void Promise.all([fetchBalance(), fetchHistory()]);
  }, [fetchBalance, fetchHistory, user]);

  useEffect(() => {
    if (!redeemCooldownStorageKey || typeof window === "undefined") return;
    const raw = window.localStorage.getItem(redeemCooldownStorageKey);
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= Date.now()) {
      window.localStorage.removeItem(redeemCooldownStorageKey);
      return;
    }
    setRedeemBlockedUntil(parsed);
  }, [redeemCooldownStorageKey]);

  useEffect(() => {
    if (!redeemBlockedUntil || !redeemCooldownStorageKey) return;
    if (redeemBlockedUntil <= Date.now()) {
      setRedeemBlockedUntil(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(redeemCooldownStorageKey);
      }
      return;
    }

    const timeout = window.setTimeout(() => {
      setRedeemBlockedUntil(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(redeemCooldownStorageKey);
      }
    }, redeemBlockedUntil - Date.now());

    return () => window.clearTimeout(timeout);
  }, [redeemBlockedUntil, redeemCooldownStorageKey]);

  const activateRedeemCooldown = useCallback(
    (message: string) => {
      const blockedUntil = Date.now() + 5 * 60 * 1000;
      setRedeemBlockedUntil(blockedUntil);
      if (redeemCooldownStorageKey && typeof window !== "undefined") {
        window.localStorage.setItem(redeemCooldownStorageKey, String(blockedUntil));
      }
      setCodeMessage({ text: message, success: false, showPolicyLink: true });
    },
    [redeemCooldownStorageKey],
  );

  const handleRedeem = useCallback(async () => {
    if (!user || !codeInput.trim()) return;
    if (redeemBlockedUntil && redeemBlockedUntil > Date.now()) {
      setCodeMessage({
        text: "This account reached 5 failed credit code attempts in 5 minutes. Please wait about 5 minutes before trying again and review the usage policy.",
        success: false,
        showPolicyLink: true,
      });
      return;
    }

    setRedeeming(true);
    setCodeMessage(null);
    try {
      const result = await redeemCode(codeInput, user.uid);
      setCodeMessage({
        text: result.message,
        success: result.success,
        showPolicyLink: !result.success && shouldShowPolicyLink(result.message),
      });

      if (!result.success && /suspended/i.test(result.message)) {
        const parsed = parseSuspensionState(`Your account is suspended: ${result.message}`);
        if (parsed) setSuspension(parsed);
        return;
      }

      if (!result.success && isRedeemCooldownMessage(result.message)) {
        activateRedeemCooldown(result.message);
        return;
      }

      if (result.success) {
        setCodeInput("");
        setRedeemBlockedUntil(null);
        if (redeemCooldownStorageKey && typeof window !== "undefined") {
          window.localStorage.removeItem(redeemCooldownStorageKey);
        }
        await fetchBalance();
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Could not redeem this code right now.";
      setCodeMessage({ text: message, success: false, showPolicyLink: shouldShowPolicyLink(message) });
      if (/your account is suspended|account is suspended|suspended/i.test(message)) {
        const parsed = parseSuspensionState(message.startsWith("Your account is suspended") ? message : `Your account is suspended: ${message}`);
        if (parsed) setSuspension(parsed);
        return;
      }
      if (isRedeemCooldownMessage(message)) {
        activateRedeemCooldown(message);
      }
    } finally {
      setRedeeming(false);
    }
  }, [activateRedeemCooldown, codeInput, fetchBalance, redeemBlockedUntil, redeemCooldownStorageKey, user]);

  const usageEvents = useMemo(() => mapHistoryToUsageEvents(history), [history]);
  const progressWidth = useMemo(() => {
    if (credits === null) return "0%";
    const percentage = Math.max(8, Math.min(100, (credits / 5) * 100));
    return `${percentage}%`;
  }, [credits]);


  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c1324]">
        <div className="auth-loader" />
      </main>
    );
  }

  if (suspension) {
    return (
      <main className="mx-auto max-w-[1440px] px-8 py-16">
        <div className="rounded-xl border border-[#93000a]/20 bg-[#191f31]/70 p-8 backdrop-blur-xl">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-lg border border-[#93000a]/40 bg-[#93000a]/20 text-[#ffb4ab]">
              <span className="material-symbols-outlined text-3xl">gpp_bad</span>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ffb4ab]/80">Account Restricted</p>
            <h1 className="mt-4 font-headline text-4xl font-bold tracking-tight text-blue-50">This account is currently suspended</h1>
            <p className="mt-4 text-sm leading-7 text-[#c2c6d6]">{suspension.reason}</p>
            <div className="mt-6 rounded-lg border border-white/10 bg-[#151b2d] px-5 py-4 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8c909f]">Status</p>
              <p className="mt-2 text-base font-semibold text-white">{suspension.endsAtLabel || "Suspended until admin review"}</p>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/policy" className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#c2c6d6] transition hover:bg-white/10 hover:text-white">
                View Usage Policy
              </Link>
              <Link href="/privacy" className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#c2c6d6] transition hover:bg-white/10 hover:text-white">
                Privacy
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1440px] px-6 py-12 sm:px-8">
      <section className="mb-16">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <h1 className="font-headline text-5xl font-bold tracking-tighter text-blue-50 md:text-7xl">Fuel Your Vision</h1>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-[#c2c6d6]">
              Manage your resources and power your generative workflows with precision. Live credit balance, redeem codes,
              model pricing, and recent usage all in one place.
            </p>
          </div>

          <div className="min-w-[300px] rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-8 backdrop-blur-xl">
            <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#adc6ff]">Available Balance</span>
            <div className="mt-2 text-5xl font-bold tracking-tight text-white">
              {credits === null ? "..." : `${credits.toFixed(2)} Cr`}
            </div>
            <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-[#2e3447]">
              <div className="h-full bg-[#adc6ff]" style={{ width: progressWidth }} />
            </div>
            <p className="mt-4 text-sm text-[#c2c6d6]">
              {profileError || "Generation and Smart analysis draw from the same live account balance."}
            </p>
          </div>
        </div>
      </section>

      <section id="redeem-code" className="mb-24">
        <h2 className="mb-8 flex items-center gap-3 font-headline text-2xl font-bold tracking-tight text-blue-50">
          <span className="h-px w-8 bg-[#adc6ff]" /> Redeem Code
        </h2>
        <div className="max-w-2xl rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-8 backdrop-blur-xl">
          <p className="mb-6 text-sm text-[#c2c6d6]">Enter a credit code or a gift code to instantly top up your balance.</p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-grow">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-xl text-[#c2c6d6]">
                confirmation_number
              </span>
              <input
                type="text"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                onKeyDown={(event) => event.key === "Enter" && void handleRedeem()}
                maxLength={33}
                disabled={Boolean(redeemBlockedUntil && redeemBlockedUntil > Date.now())}
                placeholder="VC-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                className="w-full rounded-md border border-white/10 bg-[#070d1f] py-3 pl-12 pr-4 font-mono tracking-wider text-white placeholder:text-[#c2c6d6]/40 outline-none transition-all focus:border-[#adc6ff] focus:ring-2 focus:ring-[#adc6ff]/30"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleRedeem()}
              disabled={redeeming || !codeInput.trim() || Boolean(redeemBlockedUntil && redeemBlockedUntil > Date.now())}
              className="whitespace-nowrap rounded-md bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-8 py-3 font-bold text-[#002e6a] shadow-lg shadow-[#adc6ff]/10 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {redeeming ? "Redeeming..." : "Redeem"}
            </button>
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-[#c2c6d6]/60">Codes are case-sensitive. Single use only.</p>

          {codeMessage && (
            <div
              className={`mt-5 rounded-md border px-4 py-3 text-sm ${
                codeMessage.success
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-[#93000a]/30 bg-[#93000a]/10 text-[#ffdad6]"
              }`}
            >
              <p>{codeMessage.text}</p>
              {codeMessage.showPolicyLink ? (
                <Link href="/policy" className="mt-2 inline-flex text-xs font-semibold uppercase tracking-[0.22em] text-[#adc6ff] hover:underline">
                  View usage policy
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </section>



      <section className="mb-24">
        <div>
          <div className="mb-8 flex items-center justify-between">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-blue-50">Recent History</h2>
            <Link href="/gallery" className="text-sm text-[#adc6ff] hover:underline">
              View Gallery
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left">
              <thead className="bg-[#23293c] text-xs uppercase tracking-[0.22em] text-[#c2c6d6]">
                <tr>
                  <th className="px-6 py-4 font-semibold">Date</th>
                  <th className="px-6 py-4 font-semibold">Activity</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-[#151b2d]/50">
                {historyLoading ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-sm text-[#c2c6d6]">
                      Loading recent usage…
                    </td>
                  </tr>
                ) : usageEvents.length ? (
                  usageEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="px-6 py-5 text-sm">{event.date}</td>
                      <td className="px-6 py-5">
                        <p className="font-medium text-white">{event.activity}</p>
                        <p className="text-[10px] uppercase text-[#c2c6d6]">{event.detail}</p>
                      </td>
                      <td className="px-6 py-5">
                        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                          {event.status}
                        </span>
                      </td>
                      <td className={`px-6 py-5 text-right ${event.positive ? "text-[#adc6ff]" : "text-[#c2c6d6]"}`}>{event.amount}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-sm text-[#c2c6d6]">
                      No recent generation history yet. Your completed studio outputs will appear here.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto mb-24 max-w-4xl">
        <h2 className="mb-12 text-center font-headline text-3xl font-bold tracking-tighter text-blue-50">Usage Questions</h2>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {faqItems.map((item) => (
            <div key={item.title} className="rounded-lg border-l-2 border-[#adc6ff] bg-[#151b2d] p-6">
              <h3 className="mb-3 font-semibold text-white">{item.title}</h3>
              <p className="text-sm leading-relaxed text-[#c2c6d6]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
