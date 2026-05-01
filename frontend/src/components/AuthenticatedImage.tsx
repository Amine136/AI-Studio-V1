"use client";

import { useEffect, useState } from "react";

import { useAuth } from "../context/AuthContext";

export function isPrivateFileUrl(url?: string): boolean {
  if (!url) return false;
  return url.includes("/api/files/");
}

export async function fetchAuthenticatedAsset(user: { getIdToken: () => Promise<string> } | null, src: string): Promise<Blob> {
  const headers: HeadersInit = {};
  if (isPrivateFileUrl(src)) {
    if (!user) {
      throw new Error("Authentication required");
    }
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }

  const response = await fetch(src, { headers });
  if (!response.ok) {
    throw new Error(`Asset request failed with ${response.status}`);
  }
  return response.blob();
}

export default function AuthenticatedImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const { user } = useAuth();
  const isPrivate = isPrivateFileUrl(src);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(isPrivate ? null : src);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(isPrivate ? "loading" : "ready");

  useEffect(() => {
    let objectUrl: string | null = null;
    let revoked = false;

    async function resolvePrivateImage() {
      if (!isPrivate) {
        setResolvedSrc(src);
        setStatus("ready");
        return;
      }
      if (!user) {
        setResolvedSrc(null);
        setStatus("loading");
        return;
      }

      try {
        const blob = await fetchAuthenticatedAsset(user, src);
        objectUrl = URL.createObjectURL(blob);
        if (!revoked) {
          setResolvedSrc(objectUrl);
          setStatus("ready");
        }
      } catch {
        if (!revoked) {
          setResolvedSrc(null);
          setStatus("error");
        }
      }
    }

    void resolvePrivateImage();

    return () => {
      revoked = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isPrivate, src, user]);

  if (isPrivate && status === "loading") {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60">
        Loading image...
      </div>
    );
  }

  if (isPrivate && status === "error") {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60">
        Private image unavailable
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={resolvedSrc || src} alt={alt} className={className} />;
}
