"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { RefObject } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { api } from "../../services/api";
import BuyCodesButton from "../../components/BuyCodesButton";
import type { CreditActivityEntry, CreditBreakdown, CreditOrder } from "../../types";


// Balance is unbounded, so these are comfort thresholds, not limits: the gauge
// reads full from 30 Cr up, and warns below the smallest code we sell (10 Cr).
const FUEL_FULL_AT = 30;
const FUEL_LOW_BELOW = 10;
const REFUEL_MS = 1200;

const formatCr = (value: number) => `${value.toFixed(2)} Cr`;
const fuelPercent = (value: number) =>
  value > 0 ? Math.max(3, Math.min(100, (value / FUEL_FULL_AT) * 100)) : 0;

/* The refuel animation writes to these two nodes DIRECTLY, frame by frame,
   instead of going through setState — a per-frame setState re-renders the whole
   page (history table and all) 60x a second, which is what drops frames on a
   slow phone. They are memoised on their settled value, so React leaves the
   nodes alone mid-flight and the direct writes survive any unrelated re-render
   (history arriving, breakdown loading). React takes over again at the end. */
const BalanceReadout = memo(function BalanceReadout({
  nodeRef,
  value,
}: {
  nodeRef: RefObject<HTMLDivElement | null>;
  value: number | null;
}) {
  return (
    <div
      ref={nodeRef}
      className="mt-2 text-3xl font-bold tracking-tight text-white tabular-nums sm:text-4xl"
    >
      {value === null ? "..." : formatCr(value)}
    </div>
  );
});

const FuelFill = memo(function FuelFill({
  nodeRef,
  value,
}: {
  nodeRef: RefObject<HTMLDivElement | null>;
  value: number | null;
}) {
  return (
    <div
      ref={nodeRef}
      className="vc-fuel-fill"
      style={{ width: `${value === null ? 0 : fuelPercent(value)}%` }}
    >
      <span className="vc-fuel-sheen" />
    </div>
  );
});

interface SuspensionState {
  reason: string;
  endsAt: string | null;
  endsAtLabel: string | null;
}

type UsageEvent = {
  id: string;
  date: string;
  activity: string;
  status: string;
  amount: string;
  positive: boolean;
  rawCredits: number;
  /** Sort key. Ledger rows and order rows share one table, so both carry it. */
  createdAt: number;
  /* Order rows only. They are NOT ledger entries — accepting an order moves no
     credits, the user redeems the code — so they render muted unless accepted,
     and carry the code for the copy button. */
  isOrder?: boolean;
  orderCode?: string;
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

function mapActivityToUsageEvents(entries: CreditActivityEntry[]): UsageEvent[] {
  return entries.map((g) => {
    const createdAt = new Date((g.createdAt || 0) * 1000);
    const credits = Math.abs(Number(g.deltaMinor || 0)) / 100;
    const isZero = g.deltaMinor === 0;
    const positive = Number(g.deltaMinor || 0) > 0;
    const amountStr = isZero ? "0.00" : `${positive ? "+" : "-"}${credits.toFixed(2)}`;
    return {
      id: g.id,
      date: createdAt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
      activity: g.activity,
      status: g.status || "COMPLETED",
      amount: `${amountStr} Cr`,
      positive: g.deltaMinor >= 0,
      rawCredits: credits,
      createdAt: g.createdAt || 0,
    };
  });
}

/* Orders are merged into the same history table CLIENT-SIDE rather than injected
   into /credits/activity: that endpoint groups by activity id and merges
   consecutive chat rows, and an order is not a ledger entry to begin with.
   Note a redeemed purchase legitimately shows two rows — this receipt, and the
   real "Credit Redeem" entry that actually moved the balance. */
function mapOrdersToUsageEvents(orders: CreditOrder[]): UsageEvent[] {
  return orders.map((order) => {
    const createdAt = new Date((order.createdAt || 0) * 1000);
    const accepted = order.status === "accepted";
    return {
      id: `order-${order.id}`,
      date: createdAt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
      activity:
        order.status === "accepted"
          ? "Payment accepted"
          : order.status === "refused"
            ? "Payment declined"
            : "Payment pending review",
      status: order.status.toUpperCase(),
      amount: `${order.credits.toFixed(2)} Cr`,
      // Only an accepted order gets the coloured badge; pending/refused stay muted
      // so the table never implies credits landed.
      positive: accepted,
      rawCredits: order.credits,
      createdAt: order.createdAt || 0,
      isOrder: true,
      orderCode: accepted ? order.code : "",
    };
  });
}

// Colour lives in globals.css (.vc-amount--*), not in hex utilities here: on a
// dark card "premium" is a gold GLOW, but the same gold washes out to nothing on
// white. Light needs the mirror of the effect, not the same values — so each
// theme states its own, instead of the class remap guessing.
const AMOUNT_BADGE_BASE =
  "inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-[13px] font-bold vc-amount";

function getAmountBadgeClass(positive: boolean, rawCredits: number) {
  if (!positive) return "text-[#c2c6d6]";
  if (rawCredits >= 60) return `${AMOUNT_BADGE_BASE} vc-amount--gold`;
  if (rawCredits >= 30) return `${AMOUNT_BADGE_BASE} vc-amount--blue`;
  return `${AMOUNT_BADGE_BASE} vc-amount--base`;
}



const faqItems = [
  {
    title: "Do credits expire?",
    body: "Purchased credits do not expire. Redeemed code credits may have a time limit only when that limit is clearly shown in the redeem action.",
  },
  {
    title: "Can I add credits directly?",
    body: "Choose a plan under Get Credits, pay with a Tunisian method, and upload your receipt. We review it manually and send you a redeem code on this page. Card payment and auto-refill are not active yet.",
  },
  {
    title: "What happens if a task fails?",
    body: "If the platform cannot deliver a usable result, reserved generation credits are released automatically and the user is not charged.",
  },
  {
    title: "What does Smart mode charge?",
    body: "Smart mode adds a fixed analysis fee before generation starts, then applies the selected model costs for any successful output.",
  },
];

/* ── Anonymous preview ──
   The page is browsable logged-out: visitors see the real layout filled with
   SAMPLE data (clearly labelled "Example") so they understand how credits work
   before creating an account. The activity labels below are the exact strings
   the backend ledger emits, so they run through the same translations. Redeem
   carries the typed code through the auth wall as /credits?code=... — the
   existing deep-link effect then auto-redeems it right after sign-in. */
const DEMO_CREDITS = 24.5;

function buildDemoHistory(): CreditActivityEntry[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    { id: "demo-1", createdAt: now - 2 * 3600, activityType: "generation", activity: "Image Generation", status: "COMPLETED", deltaMinor: -26 },
    { id: "demo-2", createdAt: now - 26 * 3600, activityType: "smart_generation", activity: "Smart Content Creation", status: "COMPLETED", deltaMinor: -120 },
    { id: "demo-3", createdAt: now - 50 * 3600, activityType: "chat", activity: 'Chat: "a neon poster for a late-night coffee brand"', status: "COMPLETED", deltaMinor: -8 },
    { id: "demo-4", createdAt: now - 74 * 3600, activityType: "credit_code_redeem", activity: "Credit Redeem", status: "COMPLETED", deltaMinor: 3000 },
  ];
}

function formatExpiresIn(expiresAt: number): string {
  const seconds = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
  if (seconds <= 0) return "expiring now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (!days && !hours && minutes) parts.push(`${minutes}m`);
  return `expires in ${parts.join(" ") || "under 1m"}`;
}

export default function CreditsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  // Translate server-generated activity labels (finite set) + the "Chat: <prompt>"
  // prefix, keeping the user's own prompt text intact.
  const translateActivity = (activity: string) => {
    const chat = activity.match(/^Chat:\s*"([\s\S]*)"$/);
    if (chat) return `${t("Chat:")} "${chat[1]}"`;
    return t(activity);
  };
  // Translate the server redeem-success message, preserving the numeric amount
  // and reconstructing the gift-validity sentence (incl. duration units).
  const translateRedeemMessage = (message: string) => {
    const added = message.match(/^\+([\d.]+)\s+(credit|credits)\s+added to your account!/);
    if (!added) return message;
    const unit = added[2] === "credits" ? t("credits added to your account!") : t("credit added to your account!");
    let out = `+${added[1]} ${unit}`;
    const valid = message.match(/These gift credits are valid for\s+(.+?)\s+—\s+use them before they expire\./);
    if (valid) {
      const dur = valid[1].replace(/(\d+)\s+(days?|hours?|minutes?)/g, (_m, n, u) => `${n} ${t(u)}`);
      out += ` ${t("These gift credits are valid for")} ${dur} ${t("— use them before they expire.")}`;
    }
    return out;
  };

  const [history, setHistory] = useState<CreditActivityEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [orders, setOrders] = useState<CreditOrder[]>([]);
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<CreditBreakdown | null>(null);
  const [showBalanceDetails, setShowBalanceDetails] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [codeInput, setCodeInput] = useState("");
  const [codeMessage, setCodeMessage] = useState<{ text: string; success: boolean; showPolicyLink?: boolean } | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemBlockedUntil, setRedeemBlockedUntil] = useState<number | null>(null);
  const [suspension, setSuspension] = useState<SuspensionState | null>(null);
  const [showAllTransactions, setShowAllTransactions] = useState(false);

  const [displayCredits, setDisplayCredits] = useState<number | null>(null);
  const creditsRef = useRef<number | null>(null);
  const balanceNodeRef = useRef<HTMLDivElement | null>(null);
  const fuelNodeRef = useRef<HTMLDivElement | null>(null);
  const [redeemedTier, setRedeemedTier] = useState<number | null>(null);
  const [redeemDelta, setRedeemDelta] = useState<number | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [autoRedeemProcessed, setAutoRedeemProcessed] = useState(false);

  // Icon fonts render as raw ligature text ("diamond") until they load.
  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) {
      setFontsReady(true);
      return;
    }
    let alive = true;
    void document.fonts.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // The delta chip is the whole celebration; it clears itself.
  useEffect(() => {
    if (redeemDelta === null) return;
    const timeout = setTimeout(() => setRedeemDelta(null), 2600);
    return () => clearTimeout(timeout);
  }, [redeemDelta]);

  // Refuelling: ONE clock drives BOTH the balance count-up and the fuel gauge,
  // because they are the same event — so the bar and the number can never drift
  // apart or land on different beats.
  useEffect(() => {
    if (credits === null) return;

    const startValue = creditsRef.current;
    const endValue = credits;
    creditsRef.current = credits;

    if (startValue === null || startValue === endValue) {
      setDisplayCredits(endValue);
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setDisplayCredits(endValue);
      return;
    }

    let frame = 0;
    let cancelled = false;

    const step = (now: number, startTime: number) => {
      if (cancelled) return;
      const progress = Math.min((now - startTime) / REFUEL_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 4); // easeOutQuart
      const value = startValue + (endValue - startValue) * eased;

      if (balanceNodeRef.current) balanceNodeRef.current.textContent = formatCr(value);
      if (fuelNodeRef.current) fuelNodeRef.current.style.width = `${fuelPercent(value)}%`;

      if (progress < 1) frame = requestAnimationFrame((t) => step(t, startTime));
      else setDisplayCredits(endValue); // hand the final value back to React
    };

    // Don't start until the browser can actually DRAW it. The icon font renders
    // its ligatures as raw text ("diamond") until it loads, and a cold main
    // thread would eat the first frames — so on a slow phone the animation used
    // to visibly stutter or half-play. Waiting turns that into a clean start a
    // moment later. Fonts are cached after the first visit, so this is normally
    // a single frame of delay.
    const fontsSettled: Promise<unknown> =
      typeof document !== "undefined" && "fonts" in document
        ? Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 1500)), // never hang on it
          ])
        : Promise.resolve();

    void fontsSettled.then(() => {
      if (cancelled) return;
      // One idle frame of headroom, then start the clock from the real first frame.
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        frame = requestAnimationFrame((t) => step(t, t));
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [credits]);

  const redeemCooldownStorageKey = user ? `vibecraft:redeemCooldownUntil:${user.uid}` : null;

  const fetchBalance = useCallback(async () => {
    if (!user) return;
    try {
      const [profile, nextBreakdown] = await Promise.all([
        api.getProfile(),
        api.getCreditBreakdown().catch(() => null),
      ]);
      const nextCredits = profile.credits ?? 0;
      setCredits(nextCredits);
      setBreakdown(nextBreakdown);
      setProfileError(null);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t("Could not load your credit balance.");
      setCredits(0);
      setProfileError(message);
    }
  }, [user]);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const response = await api.getCreditActivity(20);
      setHistory(response.entries || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  // The checkout wizard lands here as /credits?order=<id>. Consume the flag and
  // strip it, same as the ?code= deep link below, so a refresh isn't a re-confirm.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("order")) return;
    setOrderPlaced(true);
    params.delete("order");
    const query = params.toString();
    window.history.replaceState({}, document.title, `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    try {
      const response = await api.getCreditOrders();
      setOrders(response.orders || []);
    } catch {
      // Orders are supplementary — a failure here must not blank the page.
      setOrders([]);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      if (loading) return; // don't flash the sample while auth is still resolving
      // Anonymous preview: sample balance + history, labelled "Example" in the UI.
      setCredits(DEMO_CREDITS);
      setHistory(buildDemoHistory());
      setOrders([]);
      setHistoryLoading(false);
      return;
    }
    void Promise.all([fetchBalance(), fetchHistory(), fetchOrders()]);
  }, [fetchBalance, fetchHistory, fetchOrders, loading, user]);

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

  const handleRedeem = useCallback(async (overrideCode?: string | React.MouseEvent | React.KeyboardEvent) => {
    const codeToUse = typeof overrideCode === "string" ? overrideCode : codeInput;
    if (!user) {
      // Auth wall, keeping the typed code: /credits?code=... auto-redeems right
      // after sign-in via the deep-link effect below, so the visitor doesn't
      // have to re-type it.
      const trimmed = codeToUse.trim();
      const next = trimmed ? `/credits?code=${encodeURIComponent(trimmed)}` : "/credits";
      router.push(`/auth?next=${encodeURIComponent(next)}`);
      return;
    }
    if (!codeToUse.trim()) return;
    if (redeemBlockedUntil && redeemBlockedUntil > Date.now()) {
      setCodeMessage({
        text: t("This account reached 5 failed credit code attempts in 5 minutes. Please wait about 5 minutes before trying again and review the usage policy."),
        success: false,
        showPolicyLink: true,
      });
      return;
    }

    setRedeeming(true);
    setCodeMessage(null);
    try {
      const result = await api.redeemCode(codeToUse);
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
        const oldCredits = credits || 0;

        // Fetch fresh profile explicitly to calculate the exact diff immediately
        const freshProfile = await api.getProfile().catch(() => null);
        let tier = 10;
        let added: number | null = null;

        if (freshProfile && freshProfile.credits !== undefined) {
          added = freshProfile.credits - oldCredits;
          if (added >= 60) tier = 70;
          else if (added >= 30) tier = 35;
          else tier = 10;
        }

        setRedeemedTier(tier);
        setCodeInput("");
        setRedeemBlockedUntil(null);
        if (redeemCooldownStorageKey && typeof window !== "undefined") {
          window.localStorage.removeItem(redeemCooldownStorageKey);
        }

        // The chip goes up only once the new balance has landed, so on a slow
        // connection it rises WITH the count-up instead of hanging there alone
        // waiting for the network.
        await fetchBalance();
        if (added !== null && added > 0) setRedeemDelta(added);
      }
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : t("Could not redeem this code right now.");
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
  }, [activateRedeemCooldown, codeInput, fetchBalance, redeemBlockedUntil, redeemCooldownStorageKey, router, user]);

  useEffect(() => {
    if (typeof window === "undefined" || autoRedeemProcessed) return;

    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get("code")?.trim().toUpperCase();

    if (!user) {
      // Anon with a shared code link: prefill the input so pressing Redeem
      // carries the code through the auth wall. Functional update so re-runs
      // (this effect depends on handleRedeem) never clobber the visitor's own
      // typing. Don't mark processed — after sign-in it auto-redeems as usual.
      if (codeFromUrl && codeFromUrl.startsWith("VC-")) {
        setCodeInput((prev) => prev || codeFromUrl);
      }
      return;
    }

    if (codeFromUrl && codeFromUrl.startsWith("VC-")) {
      setCodeInput(codeFromUrl);
      setAutoRedeemProcessed(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      void handleRedeem(codeFromUrl);
    } else {
      setAutoRedeemProcessed(true);
    }
  }, [user, autoRedeemProcessed, handleRedeem]);

  const usageEvents = useMemo(
    () =>
      [...mapActivityToUsageEvents(history), ...mapOrdersToUsageEvents(orders)].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [history, orders],
  );
  const visibleUsageEvents = useMemo(
    () => (showAllTransactions ? usageEvents : usageEvents.slice(0, 5)),
    [showAllTransactions, usageEvents],
  );
  const pendingOrders = useMemo(() => orders.filter((o) => o.status === "pending"), [orders]);
  const resolvedOrders = useMemo(
    () => orders.filter((o) => o.status !== "pending").slice(0, 3),
    [orders],
  );

  const copyOrderCode = useCallback(async (orderId: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedOrderId(orderId);
      window.setTimeout(() => setCopiedOrderId((current) => (current === orderId ? null : current)), 1600);
    } catch {
      // Clipboard can be denied; the code is on screen and selectable.
    }
  }, []);
  const hiddenTransactionCount = Math.max(0, usageEvents.length - 5);
  // Fuel gauge, not a percentage: a balance has no maximum, so "full" is the top
  // of the comfortable range (30 Cr) rather than a cap. Past that — 70, 500 — the
  // tank simply reads full. Red below the smallest top-up we sell.
  // The settled balance decides the colour, so a refuel doesn't flash through red.
  const fuel = useMemo(
    () => ({ low: (credits ?? 0) < FUEL_LOW_BELOW, ready: credits !== null }),
    [credits],
  );


  if (loading) {
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
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#ffb4ab]/80">{t("Account Restricted")}</p>
            <h1 className="mt-4 font-headline text-4xl font-bold tracking-tight text-blue-50">{t("This account is currently suspended")}</h1>
            <p className="mt-4 text-sm leading-7 text-[#c2c6d6]">{suspension.reason}</p>
            <div className="mt-6 rounded-lg border border-white/10 bg-[#151b2d] px-5 py-4 text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8c909f]">{t("Status")}</p>
              <p className="mt-2 text-base font-semibold text-white">{suspension.endsAtLabel || t("Suspended until admin review")}</p>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/policy" className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#c2c6d6] transition hover:bg-white/10 hover:text-white">
                {t("View Usage Policy")}
              </Link>
              <Link href="/privacy" className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#c2c6d6] transition hover:bg-white/10 hover:text-white">
                {t("Privacy")}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-12">
        <section className="mb-10 sm:mb-16">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <h1 className="font-headline text-4xl font-bold tracking-tighter text-blue-50 sm:text-5xl md:text-7xl">{t("Fuel Your Vision")}</h1>
              {/* /pricing left the sidebar in the nav redesign; this is now its way in. */}
              <Link
                href="/pricing"
                className="mt-6 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 px-5 py-3 text-sm font-semibold text-[#c2c6d6] transition-colors hover:border-white/25 hover:text-white"
              >
                <span className="material-symbols-outlined text-[17px]">payments</span>
                {t("Model Pricing")}
              </Link>
            </div>

            <div className="relative rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-4 backdrop-blur-xl sm:min-w-[260px] sm:p-6">
              <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#adc6ff]">{t("Available Balance")}</span>
              {redeemDelta !== null && (
                <span
                  className="vc-refuel-delta"
                  data-top-tier={redeemedTier === 70 ? "true" : "false"}
                  aria-live="polite"
                >
                  {redeemedTier === 70 && fontsReady && (
                    <span className="material-symbols-outlined text-[15px]">diamond</span>
                  )}
                  +{redeemDelta.toFixed(2)} Cr
                </span>
              )}
              <BalanceReadout nodeRef={balanceNodeRef} value={displayCredits} />
            {breakdown && breakdown.gifts.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowBalanceDetails((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-[#adc6ff] hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {showBalanceDetails ? "expand_less" : "expand_more"}
                  </span>
                  {showBalanceDetails ? t("Hide details") : t("View details")}
                </button>
                {showBalanceDetails && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
                    <div className="flex items-center justify-between text-[#c2c6d6]">
                      <span>{t("Your credits")}</span>
                      <span className="font-semibold text-white">{breakdown.own.toFixed(2)} Cr</span>
                    </div>
                    {breakdown.gifts.map((gift, index) => (
                      <div key={index} className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[#ffd6a5]">
                          <span className="material-symbols-outlined text-[15px]">redeem</span>
                          {t("Gift")} · {formatExpiresIn(gift.expiresAt)}
                        </span>
                        <span className="font-semibold text-white">{gift.credits.toFixed(2)} Cr</span>
                      </div>
                    ))}
                    {breakdown.reserved > 0 && (
                      <div className="flex items-center justify-between border-t border-white/10 pt-1.5 text-[#8c909f]">
                        <span>{t("Reserved (in progress)")}</span>
                        <span>{breakdown.reserved.toFixed(2)} Cr</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="vc-fuel mt-5" data-low={fuel.low ? "true" : "false"}>
              <div className="vc-fuel-track">
                <FuelFill nodeRef={fuelNodeRef} value={displayCredits} />
              </div>
              {fuel.ready && (
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <span className="vc-fuel-status">
                    {/* Always rendered so the label never shifts when the icon
                        font lands; hidden (not absent) until it can draw. */}
                    <span
                      className="material-symbols-outlined vc-fuel-icon"
                      data-ready={fontsReady ? "true" : "false"}
                      aria-hidden="true"
                    >
                      {fuel.low ? "battery_alert" : "bolt"}
                    </span>
                    {fuel.low ? t("Running low") : t("Fueled up")}
                  </span>
                  {fuel.low && (
                    <a href="#redeem-code" className="vc-fuel-cta">
                      {t("Top up")}
                    </a>
                  )}
                </div>
              )}
            </div>
            {user ? (
              <p className="mt-4 text-sm text-[#c2c6d6]">
                {profileError || t("Generation and Smart analysis draw from the same live account balance.")}
              </p>
            ) : (
              <p className="mt-4 text-sm text-[#c2c6d6]">
                {t("Sample data — sign in to see your real balance and history.")}{" "}
                <Link
                  href={`/auth?next=${encodeURIComponent("/credits")}`}
                  className="font-semibold text-[#adc6ff] hover:underline"
                >
                  {t("Sign in")}
                </Link>
              </p>
            )}
          </div>
        </div>
      </section>

      <section id="redeem-code" className="mb-12 sm:mb-24">
        <h2 className="mb-8 flex items-center gap-3 font-headline text-2xl font-bold tracking-tight text-blue-50">
          <span className="h-px w-8 bg-[#adc6ff]" /> {t("Redeem Code")}
        </h2>
        <div className="max-w-2xl rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-5 backdrop-blur-xl sm:p-8">
          <p className="mb-6 text-sm text-[#c2c6d6]">{t("Enter a credit code or a gift code to instantly top up your balance.")}</p>
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
              {redeeming ? t("Redeeming...") : t("Redeem")}
            </button>
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-[#c2c6d6]/60">{t("Codes are sensitive. Single use only.")}</p>

          <div className="mt-6 flex flex-col items-start gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[#c2c6d6]">{t("Don't have a code yet?")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <BuyCodesButton className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[#adc6ff]/40 bg-[#adc6ff]/10 px-6 py-2.5 text-sm font-bold text-[#adc6ff] transition-all hover:scale-105 hover:bg-[#adc6ff]/20 active:scale-95" />
            </div>
          </div>

          {codeMessage && (
            <div
              className={`mt-5 rounded-md border px-5 py-4 text-sm ${
                codeMessage.success
                  ? "vc-redeem-ok"
                  : "border-[#93000a]/30 bg-[#93000a]/10 text-[#ffdad6]"
              }`}
              role={codeMessage.success ? "status" : "alert"}
            >
              <div className="flex items-center gap-2">
                {codeMessage.success && (
                  <span className="material-symbols-outlined text-[19px]">check_circle</span>
                )}
                <p className="flex-1 font-medium">{translateRedeemMessage(codeMessage.text)}</p>
              </div>

              {codeMessage.success && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link href="/playground" className="inline-block rounded-md bg-[linear-gradient(90deg,#adc6ff,#4d8eff)] px-5 py-2 text-xs font-bold uppercase tracking-wider text-[#002e6a] transition-transform hover:scale-105 active:scale-95 shadow-lg shadow-[#adc6ff]/20">
                    {t("Go to Studio")}
                  </Link>
                </div>
              )}

              {codeMessage.showPolicyLink ? (
                <Link href="/policy" className="mt-3 inline-flex text-xs font-semibold uppercase tracking-[0.22em] text-[#adc6ff] hover:underline">
                  {t("View usage policy")}
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {/* Manual purchase orders. Pending ones are the reason this section exists —
          a user who just paid needs to see that we have their receipt. */}
      {(pendingOrders.length > 0 || resolvedOrders.length > 0) && (
        <section className="mb-12 sm:mb-16">
          <h2 className="font-headline mb-5 text-2xl font-bold tracking-tight text-blue-50">
            {t("Your orders")}
          </h2>
          {orderPlaced && (
            <div className="vc-redeem-ok mb-4 flex items-center gap-2 rounded-md border px-5 py-4 text-sm" role="status">
              <span className="material-symbols-outlined text-[19px]">check_circle</span>
              <p className="font-medium">{t("Order received. We'll review your payment shortly.")}</p>
            </div>
          )}
          <div className="space-y-3">
            {[...pendingOrders, ...resolvedOrders].map((order) => (
              <div
                key={order.id}
                className="rounded-xl border border-white/10 bg-[rgba(25,31,49,0.7)] p-4 backdrop-blur-xl sm:p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">
                      {order.planName} — {order.credits.toFixed(0)} Cr
                    </p>
                    <p className="mt-0.5 text-xs text-[#c2c6d6]">
                      {new Date((order.createdAt || 0) * 1000).toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                      order.status === "pending"
                        ? "border-[#ffb95e]/30 bg-[#ffb95e]/10 text-[#ffb95e]"
                        : order.status === "accepted"
                          ? "border-[#67d98f]/30 bg-[#67d98f]/10 text-[#67d98f]"
                          : "border-[#ff9a9a]/30 bg-[#ff9a9a]/10 text-[#ff9a9a]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[15px]">
                      {order.status === "pending"
                        ? "hourglass_top"
                        : order.status === "accepted"
                          ? "check_circle"
                          : "cancel"}
                    </span>
                    {order.status === "pending"
                      ? t("Pending review")
                      : order.status === "accepted"
                        ? t("Accepted")
                        : t("Declined")}
                  </span>
                </div>

                {order.status === "pending" && (
                  <p className="mt-3 text-sm text-[#c2c6d6]">
                    {t("We received your payment proof. Your code will appear here once it's approved.")}
                  </p>
                )}

                {order.status === "accepted" && order.code && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-white/10 bg-[#070d1f] p-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-sm tracking-wider text-white">
                      {order.code}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyOrderCode(order.id, order.code)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#adc6ff]/40 bg-[#adc6ff]/10 px-3 py-1.5 text-xs font-bold text-[#adc6ff] transition hover:bg-[#adc6ff]/20"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {copiedOrderId === order.id ? "check" : "content_copy"}
                      </span>
                      {copiedOrderId === order.id ? t("Copied") : t("Copy code")}
                    </button>
                  </div>
                )}

                {order.status === "refused" && order.adminMessage && (
                  <p className="mt-3 text-sm text-[#c2c6d6]">{order.adminMessage}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-12 sm:mb-24">
        <div>
          <div className="mb-8 flex items-center justify-between">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-blue-50">{t("Recent History")}</h2>
          </div>
          <div className="hidden overflow-hidden rounded-xl border border-white/10 sm:block">
            <table className="w-full text-left">
              <thead className="bg-[#23293c] text-xs uppercase tracking-[0.22em] text-[#c2c6d6]">
                <tr>
                  <th className="px-6 py-4 font-semibold">{t("Date")}</th>
                  <th className="px-6 py-4 font-semibold">{t("Activity")}</th>
                  <th className="px-6 py-4 text-right font-semibold">{t("Amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-[#151b2d]/50">
                {historyLoading ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-sm text-[#c2c6d6]">
                      {t("Loading recent usage…")}
                    </td>
                  </tr>
                ) : visibleUsageEvents.length ? (
                  visibleUsageEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="px-6 py-5 text-sm">{event.date}</td>
                      <td className="px-6 py-5">
                        <p className="font-medium text-white">
                          {translateActivity(event.activity)}
                          {event.orderCode ? (
                            <>
                              {" — "}
                              <span className="font-mono text-sm text-[#adc6ff]">{event.orderCode}</span>
                              <button
                                type="button"
                                onClick={() => copyOrderCode(event.id, event.orderCode || "")}
                                aria-label={t("Copy code")}
                                className="ms-2 inline-flex align-middle text-[#adc6ff] transition hover:text-white"
                              >
                                <span className="material-symbols-outlined text-[16px]">
                                  {copiedOrderId === event.id ? "check" : "content_copy"}
                                </span>
                              </button>
                            </>
                          ) : null}
                        </p>
                      </td>
                      <td className="px-6 py-5 text-right">
                        <span className={getAmountBadgeClass(event.positive, event.rawCredits)}>
                          {event.amount}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-sm text-[#c2c6d6]">
                      {t("No recent credit transactions yet. Your balance changes will appear here.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 sm:hidden">
            {historyLoading ? (
              <div className="rounded-xl border border-white/10 bg-[#151b2d]/50 p-5 text-sm text-[#c2c6d6]">{t("Loading recent usage…")}</div>
            ) : visibleUsageEvents.length ? (
              visibleUsageEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-white/10 bg-[#151b2d]/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{translateActivity(event.activity)}</p>
                      <p className="mt-1 text-xs text-[#c2c6d6]">{event.date}</p>
                    </div>
                    <div className="shrink-0">
                      <span className={getAmountBadgeClass(event.positive, event.rawCredits)}>
                        {event.amount}
                      </span>
                    </div>
                  </div>
                  {event.orderCode ? (
                    <div className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-[#070d1f] p-2.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-wider text-white">
                        {event.orderCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyOrderCode(event.id, event.orderCode || "")}
                        aria-label={t("Copy code")}
                        className="shrink-0 text-[#adc6ff] transition hover:text-white"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {copiedOrderId === event.id ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-white/10 bg-[#151b2d]/50 p-5 text-sm text-[#c2c6d6]">
                {t("No recent credit transactions yet. Your balance changes will appear here.")}
              </div>
            )}
          </div>
          {hiddenTransactionCount > 0 ? (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowAllTransactions((current) => !current)}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#adc6ff] transition hover:bg-white/10"
              >
                {showAllTransactions ? t("Show Less") : `${t("Show")} ${hiddenTransactionCount} ${t("More")}`}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mx-auto mb-12 max-w-4xl sm:mb-24">
        <h2 className="mb-6 text-center font-headline text-2xl font-bold tracking-tighter text-blue-50 sm:mb-12 sm:text-3xl">{t("Usage Questions")}</h2>
        <div className="grid grid-cols-1 gap-4 sm:gap-8 md:grid-cols-2">
          {faqItems.map((item) => (
            <div key={item.title} className="rounded-lg border-l-2 border-[#adc6ff] bg-[#151b2d] p-6">
              <h3 className="mb-3 font-semibold text-white">{t(item.title)}</h3>
              <p className="text-sm leading-relaxed text-[#c2c6d6]">{t(item.body)}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
    </>
  );
}
