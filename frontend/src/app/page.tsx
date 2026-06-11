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

const roadmapItems = [
  {
    title: "Video generation",
    description: "Cinematic 4K motion synthesis.",
    status: "Status: under developpement",
    icon: "movie",
    accent: "text-primary",
    dot: "bg-primary shadow-[0_0_20px_rgba(173,198,255,1)]",
    border: "hover:border-primary/40",
    side: "left",
  },
  {
    title: "Voice content",
    description: "Cloning and synthetic narration with emotional depth.",
    status: "Status: under intergration",
    icon: "mic",
    accent: "text-secondary",
    dot: "bg-secondary shadow-[0_0_20px_rgba(208,188,255,1)]",
    border: "hover:border-secondary/40",
    side: "right",
  },
  {
    title: "Multiple generations",
    description: "Parallel workflow processing for large-scale campaigns.",
    status: "Status: Architecture Design",
    icon: "layers",
    accent: "text-tertiary",
    dot: "bg-tertiary shadow-[0_0_20px_rgba(185,200,222,1)]",
    border: "hover:border-tertiary/40",
    side: "left",
  },
  {
    title: "Automatic social posting",
    description: "Direct integration with social platforms via AI scheduler.",
    status: "Status: API Integration",
    icon: "share",
    accent: "text-on-surface",
    dot: "bg-outline shadow-[0_0_20px_rgba(140,144,159,1)]",
    border: "hover:border-white/20",
    side: "right",
  },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const primaryHref = user ? "/dashboard" : "/auth";
  const primaryLabel = user ? "Open Dashboard" : "Get Started";
  const loginHref = user ? "/dashboard" : "/auth";

  return (
    <main className="bg-[#0c1324] text-[#dce1fb] selection:bg-[#4d8eff]/30">
      <nav className="fixed top-0 z-50 w-full bg-[#0c1324]/80 shadow-xl shadow-blue-900/10 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5 lg:px-12 lg:py-6">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <img
              src="/best-version/logo-192.png?v=20260506-1210"
              alt="Vibecraft logo"
              className="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9"
            />
            <div className="font-headline text-xl font-bold tracking-tighter text-blue-100 sm:text-2xl">Vibecraft</div>
          </div>

          <div className="hidden items-center gap-10 md:flex">
            <a href="#features" className="border-b-2 border-blue-400 pb-1 font-headline text-sm tracking-tight text-blue-200 transition-colors duration-300 hover:text-blue-100">
              Features
            </a>
            <a href="#models" className="font-headline text-sm tracking-tight text-slate-400 transition-colors duration-300 hover:text-blue-100">
              Models
            </a>
            <a href="#horizon" className="font-headline text-sm tracking-tight text-slate-400 transition-colors duration-300 hover:text-blue-100">
              Coming Soon
            </a>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 sm:gap-3 lg:gap-6">
            <Link href={loginHref} className="font-headline text-xs tracking-tight text-slate-400 transition-colors duration-300 hover:text-blue-100 sm:text-sm">
              Log In
            </Link>
            <Link href={primaryHref} className="rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-3.5 py-2 text-xs font-medium text-[#002e6a] transition-transform duration-100 active:scale-95 sm:px-5 sm:text-sm lg:px-6">
              {primaryLabel}
            </Link>
          </div>
        </div>
      </nav>

      <section className="relative flex min-h-[640px] items-center overflow-hidden px-4 py-16 pt-28 sm:min-h-[716px] sm:px-6 sm:py-24 sm:pt-36 lg:px-12">
        <div className="absolute inset-0 z-0">
          <div className="absolute right-[-10%] top-[-10%] h-[600px] w-[600px] rounded-full bg-[#adc6ff]/10 blur-[120px]" />
          <div className="absolute bottom-[-5%] left-[-5%] h-[400px] w-[400px] rounded-full bg-[#d0bcff]/10 blur-[100px]" />
        </div>
        <div className="relative z-10 mx-auto max-w-4xl text-center animate-fade-in-up stagger-children">
          <h1 className="font-headline text-[2.45rem] font-bold leading-[1.04] tracking-tight text-[#dce1fb] sm:text-5xl md:text-7xl lg:text-8xl">
            Vibe at the speed of{" "}
            <span className="bg-gradient-to-r from-[#adc6ff] to-[#d0bcff] bg-clip-text text-transparent">thought.</span>
          </h1>
          <p className="mx-auto mb-8 mt-6 max-w-2xl text-base font-light leading-relaxed text-[#c2c6d6] sm:mb-12 sm:mt-8 sm:text-lg md:text-xl">
            Direct access to premium AI chat, image generation, and smarter creation flows built for fast creative work.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
            <Link href={primaryHref} className="rounded-md bg-gradient-to-br from-[#adc6ff] to-[#4d8eff] px-8 py-3.5 text-base font-semibold text-[#002e6a] transition-all hover:shadow-[0_0_40px_-10px_rgba(173,198,255,0.5)] sm:px-10 sm:py-4 sm:text-lg">
              {user ? "Launch Dashboard" : "Launch Studio"}
            </Link>
            <a href="#models" className="rounded-md border border-[#424754]/20 bg-[#23293c]/40 px-8 py-3.5 text-base font-semibold text-[#dce1fb] backdrop-blur-md transition-colors hover:bg-[#2e3447]/60 sm:px-10 sm:py-4 sm:text-lg">
              View Models
            </a>
          </div>
          
          <div className="mt-10 flex flex-col items-center justify-center gap-2 animate-fade-in-up sm:mt-14 sm:flex-row sm:gap-4" style={{ animationDelay: '400ms' }}>
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 w-10 rounded-full border-2 border-[#0c1324] bg-gradient-to-br from-indigo-400 to-purple-400" style={{ backgroundImage: `url('https://api.dicebear.com/7.x/avataaars/svg?seed=${i + 10}&backgroundColor=b6e3f4')` }} />
              ))}
            </div>
            <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
              <div className="flex translate-x-2 text-yellow-400 sm:translate-x-0">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className="material-symbols-outlined text-sm">star</span>
                ))}
              </div>
              <p className="text-sm font-medium text-[#c2c6d6]">Be one of the first 1,000 creators</p>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="bg-[#0c1324] px-4 py-16 sm:px-6 sm:py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-10 sm:mb-20">
            <h2 className="font-headline text-3xl font-bold tracking-tight sm:text-4xl">Core Engine</h2>
            <div className="mt-4 h-1 w-20 bg-[#adc6ff]" />
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
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c1324] via-[#0c1324]/20 to-transparent" />
              <div className="absolute bottom-0 p-6 sm:p-10">
                <span className="material-symbols-outlined mb-3 text-3xl text-[#adc6ff] sm:mb-4 sm:text-4xl">auto_awesome</span>
                <h3 className="font-headline text-2xl font-bold sm:text-3xl">Chat with models</h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-[#c2c6d6] sm:text-base">
                  Work directly with text, image, and multimodal models in playground. Send prompts, upload images, and iterate inside one conversation.
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
              <div className="absolute inset-0 bg-gradient-to-t from-[#0c1324] via-[#0c1324]/20 to-transparent" />
              <div className="absolute bottom-0 p-6 sm:p-10">
                <span className="material-symbols-outlined mb-3 text-3xl text-[#adc6ff] sm:mb-4 sm:text-4xl">brush</span>
                <h3 className="font-headline text-2xl font-bold">Edit images</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#c2c6d6] sm:text-base">
                  Upload a reference, transform it with image-capable models, and continue refining results through follow-up instructions.
                </p>
              </div>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="group relative overflow-hidden rounded-xl border border-[#424754]/10 bg-[#23293c] md:col-span-12"
            >
              <div className="grid items-center lg:grid-cols-5">
                <div className="p-6 sm:p-10 lg:col-span-2 lg:p-12">
                  <span className="material-symbols-outlined mb-4 text-4xl text-[#adc6ff]">psychology</span>
                  <h3 className="font-headline text-2xl font-bold sm:text-3xl">Smart generation</h3>
                  <p className="mt-4 text-base leading-relaxed text-[#c2c6d6] sm:mt-6 sm:text-lg">
                    Start from a simple idea, review the optimized direction, then generate images and captions with model-aware settings and billing visibility.
                  </p>
                  <ul className="mt-6 space-y-3 text-sm sm:mt-8 sm:space-y-4 sm:text-base">
                    <li className="flex items-center gap-3 text-[#dce1fb]">
                      <span className="material-symbols-outlined text-[#adc6ff]">check_circle</span>
                      Intent analysis before generation
                    </li>
                    <li className="flex items-center gap-3 text-[#dce1fb]">
                      <span className="material-symbols-outlined text-[#adc6ff]">check_circle</span>
                      Optimized prompts before execution
                    </li>
                    <li className="flex items-center gap-3 text-[#dce1fb]">
                      <span className="material-symbols-outlined text-[#adc6ff]">check_circle</span>
                      Controlled image and caption outputs
                    </li>
                  </ul>
                </div>

                <div className="p-4 pt-0 sm:p-8 lg:col-span-3 lg:p-12 lg:pl-0">
                  <div className="relative mx-auto max-w-[800px] [perspective:1000px]">
                    <div className="absolute -bottom-10 left-1/2 h-4 w-[90%] -translate-x-1/2 rounded-full bg-[#adc6ff]/20 blur-2xl" />
                    <div className="relative rounded-t-3xl border-x border-t border-white/10 bg-zinc-900 p-3 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5),0_30px_60px_-30px_rgba(173,198,255,0.1)]">
                      <div className="relative flex aspect-[16/10] overflow-hidden rounded-2xl bg-black">
                        <div className="hidden w-1/3 flex-col gap-6 bg-[#0c1324] p-6 sm:flex">
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">Style</label>
                            <div className="flex items-center justify-between rounded-lg border border-[#adc6ff]/20 bg-[#23293c] p-3">
                              <span className="text-sm font-medium">3D</span>
                              <span className="material-symbols-outlined text-sm opacity-50">expand_more</span>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">Contrast</label>
                              <span className="font-mono text-[10px] text-[#adc6ff]">High</span>
                            </div>
                            <div className="relative h-1 rounded-full bg-[#2e3447]">
                              <div className="absolute inset-y-0 left-0 w-3/4 rounded-full bg-[#adc6ff]" />
                              <div className="absolute left-[75%] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white shadow-lg ring-4 ring-[#adc6ff]/20" />
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">Resolution</label>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded border border-[#424754]/30 p-2 text-center text-[10px]">1080p</div>
                              <div className="rounded bg-[#adc6ff] p-2 text-center text-[10px] font-bold text-[#002e6a]">4K</div>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#adc6ff]/60">Aspect Ratio</label>
                            <div className="flex gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded border border-[#adc6ff] bg-[#adc6ff]/10 text-[10px] font-bold">1:1</div>
                              <div className="flex h-8 w-8 items-center justify-center rounded border border-[#424754]/30 text-[10px] opacity-40">16:9</div>
                              <div className="flex h-8 w-8 items-center justify-center rounded border border-[#424754]/30 text-[10px] opacity-40">4:3</div>
                            </div>
                          </div>
                          <div className="mt-auto">
                            <button className="w-full rounded-xl bg-[#adc6ff] py-3 text-xs font-bold uppercase tracking-wider text-[#002e6a]">Refine Output</button>
                          </div>
                        </div>

                        <div className="relative flex-1 overflow-hidden bg-black">
                          <Image src="/landing/smart-generation-v2-dark.png" alt="Smart generation preview" width={2048} height={1365} quality={100} sizes="(max-width: 1023px) 100vw, 48vw" className="h-full w-full object-cover" />
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-[#adc6ff]/5 to-transparent" />
                          <div className="absolute right-4 top-4 flex gap-2">
                            <span className="flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-[10px] font-mono backdrop-blur-md">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                              Rendering...
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

      <section id="models" className="bg-[#0c1324] px-4 py-16 sm:px-6 sm:py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-10 flex flex-col gap-4 sm:mb-20 sm:gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-headline text-3xl font-bold tracking-tight sm:text-4xl">Model Showcase</h2>
              <p className="mt-4 text-[#c2c6d6]">Models available across playground and Smart Creation workflows.</p>
            </div>
            <Link href={primaryHref} className="flex items-center gap-2 font-semibold text-[#adc6ff] transition-all hover:gap-4">
              View Live Studio
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
                <div className="absolute inset-0 bg-gradient-to-t from-[#0c1324]/90 via-[#0c1324]/20 to-transparent transition-colors group-hover:via-transparent" />
                <div className="absolute bottom-6 left-6">
                  <span className={`mb-2 inline-block rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${model.badgeClass}`}>
                    {model.badge}
                  </span>
                  <h4 className="font-headline text-xl font-bold text-white">{model.title}</h4>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="horizon" className="relative overflow-hidden bg-[#0c1324] px-4 py-16 sm:px-6 sm:py-24 lg:px-12 lg:py-32">
        <div className="relative z-10 mx-auto max-w-[1600px]">
          <div className="mb-8 text-center sm:mb-24">
            <h2 className="font-headline text-3xl font-bold tracking-tight sm:text-5xl">The Horizon</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-[#c2c6d6] sm:mt-6 sm:text-base">What we are building next.</p>
          </div>

          <div className="relative md:hidden">
            <div className="absolute bottom-0 left-3 top-0 w-px bg-gradient-to-b from-[#adc6ff] via-[#424754] to-transparent" />
            <div className="space-y-4">
              {roadmapItems.map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: index * 0.06 }}
                  className="relative pl-9"
                >
                  <div className={`absolute left-[7px] top-3 h-3 w-3 rounded-full ${item.dot}`} />
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-[#424754]/20 bg-[#191f31] px-4 py-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-headline text-base font-bold text-[#dce1fb]">{item.title}</h3>
                      <p className={`mt-1 text-[11px] font-mono uppercase tracking-tight ${item.accent}/60`}>{item.status}</p>
                    </div>
                    <span className={`material-symbols-outlined text-xl ${item.accent}`}>{item.icon}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="relative hidden md:block">
            <div className="absolute bottom-0 left-1/2 top-0 hidden w-px -translate-x-1/2 bg-gradient-to-b from-[#adc6ff] via-[#424754] to-transparent md:block" />
            <div className="space-y-24">
              {roadmapItems.map((item, index) => (
                <motion.div 
                  key={item.title} 
                  initial={{ opacity: 0, x: item.side === 'left' ? -30 : 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="grid items-center gap-6 md:grid-cols-2 md:gap-20"
                >
                  {item.side === "left" ? (
                    <>
                      <div className="hidden text-right md:block">
                        <h3 className={`font-headline text-2xl font-bold ${item.accent}`}>{item.title}</h3>
                        <p className="mt-2 text-[#c2c6d6]">{item.description}</p>
                      </div>
                      <div className="relative">
                        <div className={`absolute left-[-10px] top-1/2 z-20 h-4 w-4 -translate-y-1/2 rounded-full md:left-[-60px] ${item.dot}`} />
                        <div className={`rounded-xl border border-[#424754]/20 bg-[#191f31] p-6 transition-colors sm:p-8 ${item.border}`}>
                          <span className={`material-symbols-outlined mb-4 text-4xl ${item.accent}`}>{item.icon}</span>
                          <h4 className="mb-2 font-headline text-xl font-bold md:hidden">{item.title}</h4>
                          <p className="mb-4 text-[#c2c6d6] md:hidden">{item.description}</p>
                          <p className={`text-sm font-mono uppercase tracking-tighter ${item.accent}/60`}>{item.status}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="order-2 relative md:order-1">
                        <div className={`absolute right-[-10px] top-1/2 z-20 h-4 w-4 -translate-y-1/2 rounded-full md:right-[-60px] ${item.dot}`} />
                        <div className={`rounded-xl border border-[#424754]/20 bg-[#191f31] p-6 transition-colors sm:p-8 ${item.border}`}>
                          <span className={`material-symbols-outlined mb-4 text-4xl ${item.accent}`}>{item.icon}</span>
                          <h4 className="mb-2 font-headline text-xl font-bold md:hidden">{item.title}</h4>
                          <p className="mb-4 text-[#c2c6d6] md:hidden">{item.description}</p>
                          <p className={`text-sm font-mono uppercase tracking-tighter ${item.accent}/60`}>{item.status}</p>
                        </div>
                      </div>
                      <div className="order-1 hidden text-left md:order-2 md:block">
                        <h3 className={`font-headline text-2xl font-bold ${item.accent}`}>{item.title}</h3>
                        <p className="mt-2 text-[#c2c6d6]">{item.description}</p>
                      </div>
                    </>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-12 lg:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-[2rem] border border-[#adc6ff]/20 bg-gradient-to-br from-[#4d8eff]/20 to-[#571bc1]/20 p-6 text-center sm:p-10 lg:p-16">
            <div className="absolute right-0 top-0 p-8 opacity-10">
              <span className="material-symbols-outlined text-[10rem]">rocket_launch</span>
            </div>
            <h2 className="font-headline text-3xl font-bold sm:text-4xl lg:text-5xl">Ready to Build?</h2>
            <p className="mx-auto mb-8 mt-4 max-w-xl text-base leading-relaxed text-[#c2c6d6] sm:mb-10 sm:mt-6 sm:text-lg">
              Add credits and enjoy state-of-the-art AI models in one place, with top-ups in Tunisian dinar.
            </p>
            <div className="flex flex-col justify-center gap-6 sm:flex-row">
              <Link href={primaryHref} className="rounded-md bg-[#adc6ff] px-6 py-4 text-base font-bold text-[#002e6a] shadow-lg shadow-[#adc6ff]/20 transition-all hover:scale-105 active:scale-95 sm:px-12 sm:py-5 sm:text-xl">
                {user ? "Open Dashboard" : "Claim Early Access"}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="pb-8 text-center text-sm text-[#8c909f]">Checking session…</div>
      ) : null}

      <footer className="w-full border-t border-slate-800/30 bg-[#0c1324] px-4 py-12 sm:px-6 sm:py-16 lg:px-12">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-8 md:flex-row">
          <div className="flex flex-col items-center gap-2 md:items-start">
            <div className="font-headline text-lg font-bold text-blue-100">Vibecraft</div>
            <p className="text-center font-body text-xs uppercase tracking-widest text-slate-500 md:text-left">
              &copy; {new Date().getFullYear()} Vibecraft AI Studio. All rights reserved.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-4 md:gap-12">
            <Link href="/privacy" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              Privacy
            </Link>
            <Link href="/policy" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              Terms
            </Link>
            <Link href="/dashboard" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              Studio
            </Link>
            <Link href="/credits" className="font-body text-xs uppercase tracking-widest text-slate-500 transition-opacity hover:text-white">
              Credits
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
