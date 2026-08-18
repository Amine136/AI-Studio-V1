"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { fetchAuthenticatedAsset, isPrivateFileUrl, isRenderableImageUrl } from "./AuthenticatedImage";

function inferExtensionFromType(mimeType?: string | null): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/svg+xml") return "svg";
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
  loadingNode,
  errorClassName,
  controls = "all",
  controlButtonClassName = "h-9 w-9",
  controlIconClassName = "text-[18px]",
  zoomOnClick = false,
}: {
  src: string;
  alt: string;
  imageClassName: string;
  wrapperClassName: string;
  loadingClassName?: string;
  // Optional custom placeholder shown while the image loads (e.g. a shimmer
  // skeleton). Falls back to the plain "Loading image..." text when omitted.
  loadingNode?: ReactNode;
  errorClassName?: string;
  controls?: "all" | "open";
  controlButtonClassName?: string;
  controlIconClassName?: string;
  // When true, the tile shows no overlay icons; clicking the image opens the
  // zoom lightbox, and the download / open-in-new-tab actions live in there.
  zoomOnClick?: boolean;
}) {
  const { user } = useAuth();
  const { t } = useLanguage();
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
        {loadingNode ?? "Loading image..."}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className={errorClassName || "flex min-h-40 min-w-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-xs text-white/50"}>
        <span className="material-symbols-outlined text-[20px] text-white/40">schedule</span>
        <span>{t("Image expired (stored for 30 days)")}</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={`group relative overflow-hidden ${zoomOnClick ? "cursor-zoom-in" : ""} ${wrapperClassName}`}
        role={zoomOnClick ? "button" : undefined}
        tabIndex={zoomOnClick ? 0 : undefined}
        aria-label={zoomOnClick ? "Zoom image" : undefined}
        onClick={zoomOnClick ? () => setIsZoomOpen(true) : undefined}
        onKeyDown={
          zoomOnClick
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setIsZoomOpen(true);
                }
              }
            : undefined
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={activeSrc} alt={alt} className={imageClassName} />
        {!zoomOnClick ? (
          <>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-100 transition-opacity duration-200" />
            <div className="absolute right-2 top-2 flex gap-2 opacity-100 transition-opacity duration-200">
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
          </>
        ) : null}
      </div>

      {isZoomOpen && portalReady
        ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setIsZoomOpen(false)}
          >
            {/* lightbox actions — download + open in new tab live here now */}
            <div className="absolute right-4 top-4 z-10 flex gap-2" onClick={(event) => event.stopPropagation()}>
              {controls === "all" ? (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur hover:bg-black/70"
                  aria-label="Download image"
                >
                  <span className="material-symbols-outlined text-[20px]">download</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleOpenInNewTab}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur hover:bg-black/70"
                aria-label="Open image in new tab"
              >
                <span className="material-symbols-outlined text-[20px]">open_in_new</span>
              </button>
              <button
                type="button"
                onClick={() => setIsZoomOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur hover:bg-black/70"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
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
