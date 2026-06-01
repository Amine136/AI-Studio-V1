"use client";

import { FormEvent, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import AnimatedLogo from "../../../components/AnimatedLogo";
import { isAdminHost } from "../../../lib/admin";
import { api } from "../../../services/api";

export default function AdminLoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    // Starfield state
    const [stars, setStars] = useState<Array<{id: number, x: number, y: number, size: number, duration: number, delay: number}>>([]);
    const glowRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isAdminHost()) {
            router.replace("/");
            return;
        }

        api.getAdminSession()
            .then(() => {
                router.replace("/admin");
            })
            .catch(() => {});
            
        // Generate stars
        const newStars = Array.from({ length: 60 }).map((_, i) => ({
            id: i,
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: Math.random() * 2 + 1,
            duration: Math.random() * 3 + 2,
            delay: Math.random() * 5
        }));
        setStars(newStars);

        // Nebula Mouse move effect
        const handleMouseMove = (e: MouseEvent) => {
            if (glowRef.current) {
                const x = e.clientX;
                const y = e.clientY;
                glowRef.current.style.transform = `translate(calc(-50% + ${(x - window.innerWidth / 2) * 0.05}px), calc(-50% + ${(y - window.innerHeight / 2) * 0.05}px))`;
            }
        };
        
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [router]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        try {
            await api.adminLogin(username, password);
            router.replace("/admin");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex-grow flex flex-col items-center justify-center px-4 py-16 z-10 min-h-screen bg-[#060e20] relative overflow-hidden">
            <style dangerouslySetInnerHTML={{ __html: `
                .star-field {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    pointer-events: none;
                    z-index: 0;
                }
                .star {
                    position: absolute;
                    background: white;
                    border-radius: 50%;
                    opacity: 0.3;
                    animation: twinkle var(--duration) infinite ease-in-out;
                }
                @keyframes twinkle {
                    0%, 100% { opacity: 0.2; transform: scale(1); }
                    50% { opacity: 0.8; transform: scale(1.2); }
                }
                .nebula-glow-login {
                    position: fixed;
                    width: 400px;
                    height: 400px;
                    background: radial-gradient(circle, rgba(73, 75, 214, 0.15) 0%, rgba(11, 19, 38, 0) 70%);
                    filter: blur(40px);
                    z-index: -1;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                }
            ` }} />
            
            <div className="star-field">
                {stars.map(star => (
                    <div 
                        key={star.id} 
                        className="star" 
                        style={{
                            left: `${star.x}%`,
                            top: `${star.y}%`,
                            width: `${star.size}px`,
                            height: `${star.size}px`,
                            "--duration": `${star.duration}s`,
                            animationDelay: `${star.delay}s`
                        } as any}
                    />
                ))}
            </div>
            
            <div ref={glowRef} className="nebula-glow-login" />
            
            <div className="flex flex-col items-center mb-10 text-center max-w-[400px] relative z-10 animate-fade-in-up">
                <div className="relative w-28 h-28 mb-6 group flex items-center justify-center">
                    <div className="absolute inset-0 bg-[#3cddc7] opacity-20 blur-3xl group-hover:opacity-40 transition-opacity duration-700 rounded-full"></div>
                    <AnimatedLogo />
                </div>
                <h1 className="font-headline-lg text-[36px] bg-gradient-to-r from-[#c0c1ff] to-[#3cddc7] text-transparent bg-clip-text tracking-tight mb-3 font-extrabold drop-shadow-sm">
                    Vibecraft Admin
                </h1>
                <p className="font-body-sm text-[15px] text-on-surface-variant opacity-90 font-medium">
                    Dedicated access for the admin portal
                </p>
            </div>
            
            <div className="w-full max-w-[448px] rounded-[20px] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.4)] relative z-10 bg-[#0d1225]/80 backdrop-blur-xl border border-white/10 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                {error && (
                    <div className="p-3 mb-6 rounded-lg bg-error-container/20 text-error text-sm text-center border border-error/20 flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined text-[18px]">error</span>
                        <span>{error}</span>
                    </div>
                )}
                <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                        <label className="block font-label-caps text-[12px] uppercase tracking-widest font-bold text-on-surface-variant px-1" htmlFor="username">Admin username</label>
                        <div className="relative group">
                            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px] group-focus-within:text-[#3cddc7] transition-colors">person</span>
                            <input 
                                className="w-full bg-[#060e20]/50 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-on-surface placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-[#3cddc7]/30 focus:border-[#3cddc7] transition-all font-body-sm text-[14px] shadow-inner" 
                                id="username" 
                                placeholder="Enter admin username" 
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        <label className="block font-label-caps text-[12px] uppercase tracking-widest font-bold text-on-surface-variant px-1" htmlFor="password">Password</label>
                        <div className="relative group">
                            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-[20px] group-focus-within:text-[#3cddc7] transition-colors">lock</span>
                            <input 
                                className="w-full bg-[#060e20]/50 border border-white/10 rounded-xl py-3.5 pl-12 pr-12 text-on-surface placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-[#3cddc7]/30 focus:border-[#3cddc7] transition-all font-body-sm text-[14px] shadow-inner" 
                                id="password" 
                                placeholder="••••••••" 
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <button 
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-outline hover:text-[#3cddc7] transition-colors flex items-center justify-center" 
                                onClick={() => setShowPassword(!showPassword)} 
                                type="button"
                            >
                                <span className="material-symbols-outlined text-[20px]">
                                    {showPassword ? "visibility_off" : "visibility"}
                                </span>
                            </button>
                        </div>
                    </div>
                    
                    <button 
                        className="w-full mt-8 bg-gradient-to-r from-[#494bd6] to-[#3cddc7] text-white font-title-md text-[18px] font-bold py-4 rounded-xl shadow-[0_0_20px_rgba(60,221,199,0.2)] hover:shadow-[0_0_25px_rgba(60,221,199,0.4)] active:scale-[0.98] transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                        type="submit"
                        disabled={loading}
                    >
                        <span>{loading ? "Authenticating..." : "Secure Sign In"}</span>
                        {!loading && <span className="material-symbols-outlined text-[20px]">login</span>}
                    </button>
                </form>
            </div>
            
            <footer className="absolute bottom-0 left-0 w-full bg-[#060e20]/80 border-t border-outline-variant/30 py-4 px-6 z-10 backdrop-blur-sm">
                <div className="flex flex-col md:flex-row justify-between items-center w-full max-w-[1440px] mx-auto space-y-4 md:space-y-0">
                    <div className="flex items-center space-x-4">
                        <span className="font-label-caps text-[11px] uppercase tracking-widest font-bold text-outline">© 2026 AdminPortal Security. All rights reserved.</span>
                    </div>
                    <div className="flex space-x-6">
                        <a className="font-body-sm text-[13px] text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100" href="#">Privacy Policy</a>
                        <a className="font-body-sm text-[13px] text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100" href="#">Terms of Service</a>
                        <a className="font-body-sm text-[13px] text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100" href="#">Help Center</a>
                    </div>
                </div>
            </footer>
        </main>
    );
}
