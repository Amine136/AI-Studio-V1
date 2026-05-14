"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../context/AuthContext";
import { fetchAuthenticatedAsset, isPrivateFileUrl, isRenderableImageUrl } from "./AuthenticatedImage";

function inferExtensionFromType(mimeType?: string | null): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  return "png";
}

function buildDownloadName(src: string, mimeType?: string | null): string {
  const url = src.split("?")[0] || src;
  const rawName = url.split("/").pop() || "image";
  if (rawName.includes(".")) return rawName;
  return `${rawName}.${inferExtensionFromType(mimeType)}`;
}

export default function InteractiveAuthenticatedImage({
  src,
  alt,
  imageClassName,
  wrapperClassName,
  loadingClassName,
  errorClassName,
  controls = "all",
  controlButtonClassName = "h-9 w-9",
  controlIconClassName = "text-[18px]",
}: {
  src: string;
  alt: string;
  imageClassName: string;
  wrapperClassName: string;
  loadingClassName?: string;
  errorClassName?: string;
  controls?: "all" | "open";
  controlButtonClassName?: string;
  controlIconClassName?: string;
}) {
  const { user } = useAuth();
  const isRenderable = isRenderableImageUrl(src);
  const isPrivate = isPrivateFileUrl(src);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(isPrivate ? null : isRenderable ? src : null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(isPrivate ? "loading" : isRenderable ? "ready" : "error");
  const [resolvedMimeType, setResolvedMimeType] = useState<string | null>(null);
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!isRenderable) {
      setResolvedSrc(null);
      setResolvedMimeType(null);
      setStatus("error");
      return;
    }
    if (!isPrivate) {
      setResolvedSrc(src);
      setResolvedMimeType(null);
      setStatus("ready");
      return;
    }
    if (!user) {
      setResolvedSrc(null);
      setResolvedMimeType(null);
      setStatus("loading");
      return;
    }

    let isActive = true;
    let objectUrl: string | null = null;

    setResolvedSrc(null);
    setResolvedMimeType(null);
    setStatus("loading");

    void (async () => {
      try {
        const blob = await fetchAuthenticatedAsset(user, src);
        objectUrl = URL.createObjectURL(blob);
        if (isActive) {
          setResolvedSrc(objectUrl);
          setResolvedMimeType(blob.type || null);
          setStatus("ready");
        }
      } catch {
        if (isActive) {
          setResolvedSrc(null);
          setResolvedMimeType(null);
          setStatus("error");
        }
      }
    })();

    return () => {
      isActive = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isPrivate, isRenderable, src, user]);

  const activeSrc = resolvedSrc || src;
  const downloadName = useMemo(() => buildDownloadName(src, resolvedMimeType), [resolvedMimeType, src]);

  function handleDownload() {
    if (!activeSrc) return;
    const anchor = document.createElement("a");
    anchor.href = activeSrc;
    anchor.download = downloadName;
    anchor.rel = "noopener noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function handleOpenInNewTab() {
    if (!activeSrc) return;
    window.open(activeSrc, "_blank", "noopener,noreferrer");
  }

  if (status === "loading") {
    return (
      <div className={loadingClassName || "flex min-h-40 min-w-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60"}>
        Loading image...
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={errorClassName || "flex min-h-40 min-w-40 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-xs text-white/60"}>
        Private image unavailable
      </div>
    );
  }

  return (
    <>
      <div className={`group relative overflow-hidden ${wrapperClassName}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activeSrc} alt={alt} className={imageClassName} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {controls === "all" ? (
            <>
              <button
                type="button"
                onClick={() => setIsZoomOpen(true)}
                className={`flex ${controlButtonClassName} items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur hover:bg-black/65`}
                aria-label="Zoom image"
              >
                <span className={`material-symbols-outlined ${controlIconClassName}`}>zoom_in</span>
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className={`flex ${controlButtonClassName} items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur hover:bg-black/65`}
                aria-label="Download image"
              >
                <span className={`material-symbols-outlined ${controlIconClassName}`}>download</span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={handleOpenInNewTab}
            className={`flex ${controlButtonClassName} items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur hover:bg-black/65`}
            aria-label="Open image in new tab"
          >
            <span className={`material-symbols-outlined ${controlIconClassName}`}>open_in_new</span>
          </button>
        </div>
      </div>

      {isZoomOpen && portalReady
        ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4"
            onClick={() => setIsZoomOpen(false)}
          >
            <div className="max-h-[96vh] max-w-[96vw]" onClick={(event) => event.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={activeSrc} alt={alt} className="max-h-[96vh] max-w-[96vw] object-contain" />
            </div>
          </div>
          ,
          document.body,
        )
        : null}
    </>
  );
}
