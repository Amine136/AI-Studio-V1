"use client";

import Image from "next/image";
import Link from "next/link";
import { useAuth } from "../context/AuthContext";
import { motion } from "framer-motion";

const showcaseModels = [
  {
    title: "NanoBanana Pro",
    badge: "Flagship",
    badgeClass: "bg-primary/90 text-[#002e6a]",
    image: "/landing/model-nanobanana-pro-dark.png",
    alt: "Featured model showcase image",
  },
  {
    title: "ImagenUltra 4",
    badge: "Photoreal",
    badgeClass: "bg-secondary/90 text-[#23005c]",
    image: "/landing/model-imagen-ultra-4-dark.png",
    alt: "Photoreal model showcase image",
  },
  {
    title: "Grok Imagine Quality",
    badge: "Versatile",
    badgeClass: "bg-[#8392a6]/90 text-[#1c2b3c]",
    image: "/landing/model-grok-imagine-quality-dark.png",
    alt: "Versatile model showcase image",
  },
  {
    title: "GPT Image 2",
    badge: "Studio",
    badgeClass: "bg-[#424754]/90 text-white",
    image: "/landing/model-gpt-image-2-dark.png",
    alt: "Studio model showcase image",
  },
];

import { useLanguage } from "../context/LanguageContext";
import AuthPanel from "../components/auth/AuthPanel";
import ThemeToggle from "../components/ThemeToggle";

function LandingContent() {
  const { user, loading } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  // The Playground is open for anonymous browsing (auth-wall on any operation),
  // so the primary CTA and "View Live Studio" take everyone straight there.
  // "Log In" keeps pointing at /auth for logged-out visitors.
  const primaryHref = "/playground?new=1";
  const primaryLabel = user ? t("Start Creating") : t("Get Started");
  const loginHref = user ? "/playground" : "/auth";

  return (
    <main className="bg-[#0c1324] text-[#dce1fb] selection:bg-[#4d8eff]/30">
      <nav className="fixed top-0 z-50 w-full bg-[#0c1324]/80 shadow-xl shadow-blue-900/10 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 px-3 py-4 sm:px-6 sm:py-5 lg:px-12 lg:py-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <img
              src="/best-version/logo-192.png?v=20260506-1210"
              alt="Vibecraft logo"
              className="h-7 w-7 shrink-0 object-contain sm:h-9 sm:w-9"
            />
            {/* Below ~400px the nav (pills + theme toggle + Log In) leaves the wordmark
                less room than its 80px of text needs, and it spills under the pills.
                Collapse to the "VC" monogram there (Anthropic-style ANTHROP\\C -> A\\)
                instead of dropping the name entirely. */}
            <div className="landing-logo font-headline truncate text-lg font-bold tracking-tighter text-blue-100 sm:text-2xl">
              <span className="max-sm:hidden">Vibecraft</span>
              <span className="sm:hidden">VC</span>
            </div>
          </div>

          <div className="hidden items-center gap-10 md:flex">
            <a href="#features" className="landing-nav-active border-b-2 border-blue-400 pb-1 font-headline text-sm tracking-tight text-blue-200 transition-colors duration-300 hover:text-blue-100">
              {t("Features")}
            </a>
            <a href="#models" className="landing-nav font-headline text-sm tracking-tight text-slate-400 transition-colors duration-300 hover:text-blue-100">
              {t("Models")}
            </a>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3 lg:gap-6">
            <div className="flex items-center rounded-full border border-white/10 bg-[#0c1324]/80 p-0.5 sm:p-1 shadow-inner backdrop-blur-md me-0.5 sm:me-2" dir="ltr">
              {(
                [
                  { id: "en", label: "EN" },
                  { id: "fr", label: "FR" },
                  { id: "ar", label: "AR" },
                ] as const
              ).map((lang) => (
                <button
                  key={lang.id}
                  onClick={() => setLanguage(lang.id)}
                  className={`relative px-1 sm:px-3 py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest transition-all duration-300 ${
                    language === lang.id
                      ? "text-white landing-lang-active"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {language === lang.id && (
                    <div className="landing-lang-pill absolute inset-0 rounded-full bg-[#adc6ff]/20 shadow-[inset_0_0_10px_rgba(173,198,255,0.2)]" />
                  )}
                  <span className="relative z-10">{lang.label}</span>
                </button>
              ))}
            </div>
            <ThemeToggle className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#0c1324]/80 text-slate-300 shadow-inner backdrop-blur-md transition-colors hover:border-white/25 hover:text-white light:border-slate-900/10 light:bg-white/80 light:text-slate-500 light:hover:border-slate-900/25 light:hover:text-slate-900 sm:h-10 sm:w-10" />

            <Link href={loginHref} className="landing-login font-headline inline-flex items-center rounded-md border border-[#adc6ff]/40 bg-[#adc6ff]/5 px-2.5 py-2 text-xs font-semibold tracking-tight text-[#dce1fb] transition-all duration-200 hover:border-[#adc6ff]/70 hover:bg-[#adc6ff]/15 hover:text-white active:scale-95 sm:px-5 sm:text-sm">
              {t("Log In") || "Log In"}
            </Link>
            <Link href={primaryHref} className="landing-cta-primary inline-flex rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-2.5 py-2 text-xs font-medium text-[#002e6a] transition-transform duration-100 active:scale-95 sm:px-5 sm:text-sm lg:px-6">
              {primaryLabel}
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative flex min-h-[640px] items-center overflow-hidden px-4 py-16 pt-28 sm:min-h-[716px] sm:px-6 sm:py-24 sm:pt-36 lg:px-12">
        <div className="absolute inset-0 z-0">
          <div className="landing-blob-a absolute right-[-10%] top-[-10%] h-[600px] w-[600px] rounded-full bg-[#adc6ff]/10 blur-[120px]" />
          <div className="landing-blob-b absolute bottom-[-5%] left-[-5%] h-[400px] w-[400px] rounded-full bg-[#d0bcff]/10 blur-[100px]" />
        </div>
        {user ? (
          <div className="relative z-10 mx-auto max-w-4xl text-center animate-fade-in-up stagger-children">
            <p className="landing-eyebrow mb-4 text-sm font-bold tracking-widest text-[#adc6ff] uppercase">{t("The Premier Tunisian AI Studio")}</p>
            <h1 className="font-headline text-[2.45rem] font-bold leading-[1.04] tracking-tight text-[#dce1fb] sm:text-5xl md:text-7xl lg:text-8xl">
              {t("Vibe at the speed of")}{" "}
              <span className="landing-grad-text bg-gradient-to-r from-[#adc6ff] to-[#d0bcff] bg-clip-text text-transparent">{t("thought.")}</span>
            </h1>
            <p className="landing-copy mx-auto mb-8 mt-6 max-w-2xl text-base font-light leading-relaxed text-[#c2c6d6] sm:mb-12 sm:mt-8 sm:text-lg md:text-xl">
              {t("Direct access to premium AI chat, image generation, and smarter creation flows built for fast creative work.")}
            </p>
            <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
              <Link href={primaryHref} className="landing-cta-primary rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-8 py-3.5 text-base font-semibold text-[#002e6a] transition-all hover:shadow-[0_0_40px_-10px_rgba(173,198,255,0.5)] sm:px-10 sm:py-4 sm:text-lg">
                {t("Start Creating")}
              </Link>
              <a href="#models" className="landing-cta-ghost rounded-md bg-slate-800/50 px-8 py-3.5 text-base font-medium text-slate-300 backdrop-blur-sm transition-colors hover:bg-slate-700/50 hover:text-white sm:px-10 sm:py-4 sm:text-lg border border-slate-700/50">
                {t("View Models")}
              </a>
            </div>
          </div>
        ) : (
          /* Signed-out hero: sign-in box pulled above the fold (order-1 on mobile)
             so cold ad traffic can act immediately instead of bouncing on a slogan. */
          <div className="relative z-10 mx-auto grid w-full max-w-[1600px] grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="order-2 text-center animate-fade-in-up lg:order-1 lg:text-left rtl:lg:text-right">
              <p className="landing-eyebrow mb-4 text-sm font-bold tracking-widest text-[#adc6ff] uppercase">{t("The Premier Tunisian AI Studio")}</p>
              <h1 className="font-headline text-[2.3rem] font-bold leading-[1.05] tracking-tight text-[#dce1fb] sm:text-5xl md:text-6xl">
                {t("Vibe at the speed of")}{" "}
                <span className="landing-grad-text bg-gradient-to-r from-[#adc6ff] to-[#d0bcff] bg-clip-text text-transparent">{t("thought.")}</span>
              </h1>
              <p className="landing-copy mx-auto mt-5 max-w-xl text-base font-light leading-relaxed text-[#c2c6d6] sm:mt-6 sm:text-lg lg:mx-0">
                {t("Direct access to premium AI chat, image generation, and smarter creation flows built for fast creative work.")}
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4 lg:justify-start">
                <div className="flex -space-x-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 w-10 rounded-full border-2 border-[#0c1324] bg-gradient-to-br from-indigo-400 to-purple-400" style={{ backgroundImage: `url('https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 10}&backgroundColor=b6e3f4')` }} />
                  ))}
                </div>
                <div className="flex flex-col items-center text-center sm:items-start sm:text-left rtl:sm:items-end rtl:sm:text-right">
                  <div className="flex text-yellow-400">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <span key={i} className="material-symbols-outlined text-sm">star</span>
                    ))}
                  </div>
                  <p className="text-sm font-medium text-[#c2c6d6]">{t("Be one of the first 1,000 creators")}</p>
                </div>
              </div>
            </div>
            <div className="order-1 mx-auto w-full max-w-md animate-fade-in-up lg:order-2 lg:mx-0" style={{ animationDelay: "150ms" }}>
              <AuthPanel className="w-full" />
            </div>
          </div>
        )}
      </section>

      <section id="features" className="landing-section bg-[#0c1324] px-4 py-16 sm:px-6 sm:py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-10 sm:mb-20">
            <h2 className="font-headline text-3xl font-bold tracking-tight sm:text-4xl">{t("Core Engine")}</h2>
            <div className="landing-bar mt-4 h-1 w-20 bg-[#adc6ff]" />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="group relative overflow-hidden rounded-xl border border-[#424754]/10 bg-[#151b2d] md:col-span-7"
            >
              <Image src="/landing/chat-abstract-dark.png" alt="Chat with models" width={2048} height={1152} quality={100} priority sizes="(max-width: 767px) 100vw, 58vw" className="h-[300px] w-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-105 sm:h-[400px]" />
              <div className="landing-img-shade absolute inset-0 bg-gradient-to-t from-[#0c1324] via-[#0c1324]/20 to-transparent" />
              <div className="landing-img-caption absolute bottom-0 p-6 sm:p-10">
                <span className="material-symbols-outlined mb-3 text-3xl text-[#adc6ff] sm:mb-4 sm:text-4xl">auto_awesome</span>
                <h3 className="font-headline text-2xl font-bold sm:text-3xl">{t("Chat with models")}</h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-[#c2c6d6] sm:text-base">
                  {t("Work directly with text, image, and multimodal models in playground. Send prompts, upload images, and iterate inside one conversation.")}
                </p>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="group relative overflow-hidden rounded-xl border border-[#424754]/10 bg-[#151b2d] md:col-span-5"
            >
              <Image src="/landing/edit-images-v2-dark.png" alt="Edit images" width={1800} height={1350} quality={100} sizes="(max-width: 767px) 100vw, 42vw" className="h-[300px] w-full object-cover opacity-80 transition-transform duration-700 group-hover:scale-105 sm:h-[400px]" />
              <div className="landing-img-shade absolute inset-0 bg-gradient-to-t from-[#0c1324] via-[#0c1324]/20 to-transparent" />
              <div className="landing-img-caption absolute bottom-0 p-6 sm:p-10">
                <span className="material-symbols-outlined mb-3 text-3xl text-[#adc6ff] sm:mb-4 sm:text-4xl">brush</span>
                <h3 className="font-headline text-2xl font-bold">{t("Edit images")}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#c2c6d6] sm:text-base">
                  {t("Upload a reference, transform it with image-capable models, and continue refining results through follow-up instructions.")}
                </p>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="landing-card group relative overflow-hidden rounded-xl border border-[#424754]/10 bg-[#23293c] md:col-span-12"
            >
              <div className="grid items-center lg:grid-cols-5">
                <div className="p-6 sm:p-10 lg:col-span-2 lg:p-12">
                  <span className="material-symbols-outlined mb-4 text-4xl text-[#adc6ff]">psychology</span>
                  <h3 className="font-headline text-2xl font-bold sm:text-3xl">{t("Smart generation")}</h3>
                  <p className="mt-4 text-base leading-relaxed text-[#c2c6d6] sm:mt-6 sm:text-lg">
                    {t("Start from a simple idea, review the optimized direction, then generate images and captions with model-aware settings and billing visibility.")}
                  </p>
                  <ul className="mt-6 space-y-3 text-sm sm:mt-8 sm:space-y-4 sm:text-base">
                    <li className="flex items-center gap-3 text-[#dce1fb]">
                      <span className="material-symbols-outlined text-[#adc6ff]">check_circle</span>
                      {t("Intent analysis before generation")}
                    </li>
                    <li className="flex items-center gap-3 text-[#dce1fb]">
                      <span className="material-symbols-outlined text-[#adc6ff]">check_circle</span>
                      {t("Optimized prompts before execution")}
                    </li>
                    <li className="flex items-center gap-3 text-[#dce1fb]">
                      <span className="material-symbols-outlined text-[#adc6ff]">check_circle</span>
                      {t("Controlled image and caption outputs")}
                    </li>
                  </ul>
                </div>

                <div className="p-4 pt-0 sm:p-8 lg:col-span-3 lg:p-12 lg:pl-0">
                  <div className="landing-mock relative mx-auto max-w-[800px] [perspective:1000px]">
                    <div className="absolute -bottom-10 left-1/2 h-4 w-[90%] -translate-x-1/2 rounded-full bg-[#adc6ff]/20 blur-2xl" />
                    <div className="relative rounded-t-3xl border-x border-t border-white/10 bg-zinc-900 p-3 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5),0_30px_60px_-30px_rgba(173,198,255,0.1)]">
                      <div className="relative flex aspect-[16/10] overflow-hidden rounded-2xl bg-black">
                        <div className="hidden w-1/3 flex-col gap-6 bg-[#0c1324] p-6 sm:flex">
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">{t("Style")}</label>
                            <div className="flex items-center justify-between rounded-lg border border-[#adc6ff]/20 bg-[#23293c] p-3">
                              <span className="text-sm font-medium">{t("3D")}</span>
                              <span className="material-symbols-outlined text-sm opacity-50">expand_more</span>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">{t("Contrast")}</label>
                              <span className="font-mono text-[10px] text-[#adc6ff]">{t("High")}</span>
                            </div>
                            <div className="relative h-1 rounded-full bg-[#2e3447]">
                              <div className="absolute inset-y-0 left-0 w-3/4 rounded-full bg-[#adc6ff]" />
                              <div className="absolute left-[75%] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-lg ring-4 ring-[#adc6ff]/20" />
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">{t("Resolution")}</label>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded border border-[#424754]/30 p-2 text-center text-[10px]">1080p</div>
                              <div className="rounded bg-[#adc6ff] p-2 text-center text-[10px] font-bold text-[#002e6a]">4K</div>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">{t("Aspect Ratio")}</label>
                            <div className="flex gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded border border-[#adc6ff] bg-[#adc6ff]/10 text-[10px] font-bold">1:1</div>
                              <div className="flex h-8 w-8 items-center justify-center rounded border border-[#424754]/30 text-[10px] opacity-40">16:9</div>
                              <div className="flex h-8 w-8 items-center justify-center rounded border border-[#424754]/30 text-[10px] opacity-40">4:3</div>
                            </div>
                          </div>
                          <div className="mt-auto">
                            <button className="w-full rounded-xl bg-[#adc6ff] py-3 text-xs font-bold uppercase tracking-wider text-[#002e6a]">{t("Refine Output")}</button>
                          </div>
                        </div>

                        <div className="relative flex-1 overflow-hidden bg-black">
                          <Image src="/landing/smart-generation-v2-dark.png" alt="Smart generation preview" width={2048} height={1365} quality={100} sizes="(max-width: 1023px) 100vw, 48vw" className="h-full w-full object-cover" />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#adc6ff]/5 to-transparent" />
                          <div className="absolute right-4 top-4 flex gap-2">
                            <span className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-[10px] font-mono backdrop-blur-md">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                              {t("Rendering...")}
                            </span>
                          </div>
                          <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 border border-white/5">
                            <div className="border-b border-r border-white/5" />
                            <div className="border-b border-r border-white/5" />
                            <div className="border-b border-white/5" />
                            <div className="border-b border-r border-white/5" />
                            <div className="border-b border-r border-white/5" />
                            <div className="border-b border-white/5" />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="relative flex h-4 justify-center rounded-b-xl border-x border-b border-white/10 bg-zinc-800">
                      <div className="h-1 w-24 rounded-b-full bg-zinc-900" />
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      <section id="models" className="landing-section bg-[#0c1324] px-4 py-16 sm:px-6 sm:py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-10 flex flex-col gap-4 sm:mb-20 sm:gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-headline text-3xl font-bold tracking-tight sm:text-4xl">{t("Model Showcase")}</h2>
              <p className="mt-4 text-[#c2c6d6]">{t("Models available across playground and Smart Creation workflows.")}</p>
            </div>
            <Link href={primaryHref} className="flex items-center gap-2 font-semibold text-[#adc6ff] transition-all hover:gap-4">
              {t("View Live Studio")}
              <span className="material-symbols-outlined">arrow_forward</span>
            </Link>
          </div>

          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 2xl:grid-cols-5">
            {showcaseModels.map((model, index) => (
              <motion.div 
                key={model.title} 
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="group relative aspect-[4/5] w-[66vw] max-w-[250px] shrink-0 snap-start overflow-hidden rounded-lg sm:w-auto sm:max-w-none"
              >
                <Image src={model.image} alt={model.alt} width={1200} height={1500} quality={100} sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw" className="h-full w-full object-cover" />
                <div className="landing-img-shade--models absolute inset-0 bg-gradient-to-t from-[#0c1324]/90 via-[#0c1324]/20 to-transparent transition-colors group-hover:via-transparent" />
                <div className="absolute bottom-6 left-6">
                  <span className={`mb-2 inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${model.badgeClass}`}>
                    {t(model.badge)}
                  </span>
                  <h4 className="font-headline text-xl font-bold text-white">{model.title}</h4>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      {loading ? (
        <div className="pb-8 text-center text-sm text-[#8c909f]">Checking session…</div>
      ) : null}

      <footer className="landing-section w-full border-t border-slate-800/30 bg-[#0c1324] px-4 py-12 sm:px-6 sm:py-16 lg:px-12">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-8 md:flex-row">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <div className="landing-logo font-headline text-lg font-bold text-blue-100">{t("Vibecraft Tunisian AI Studio")}</div>
            <p className="text-center font-body text-xs uppercase tracking-widest text-slate-500 md:text-left">
              &copy; {new Date().getFullYear()} {t("Vibecraft AI Tunis. The premier Tunisian AI studio. All rights reserved.")}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-4 md:gap-12">
            <Link href="/privacy" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              {t("Privacy")}
            </Link>
            <Link href="/policy" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              {t("Terms")}
            </Link>
            <Link href="/playground" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              {t("Studio")}
            </Link>
            <Link href="/credits" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              {t("Credits")}
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default function LandingPage() {
  return <LandingContent />;
}
