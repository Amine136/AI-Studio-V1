"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../lib/firebase";

interface AuthContextType {
    user: User | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            
            if (firebaseUser && typeof window !== 'undefined' && window.fbq) {
                const isNewUser = firebaseUser.metadata.creationTime === firebaseUser.metadata.lastSignInTime;
                if (isNewUser && !window.localStorage.getItem("fb_pixel_registered")) {
                    window.fbq('track', 'CompleteRegistration');
                    window.localStorage.setItem("fb_pixel_registered", "true");
                }
            }
            
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
