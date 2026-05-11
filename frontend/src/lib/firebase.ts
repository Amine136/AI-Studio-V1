import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyD_kNHn-n5LdyG8WESDN44dwn4pXmCr7Ew",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "portfolio-645a8.firebaseapp.com",
    projectId: "portfolio-645a8",
    storageBucket: "portfolio-645a8.firebasestorage.app",
    messagingSenderId: "634345037897",
    appId: "1:634345037897:web:d64fa91357ed91aa055f98",
    measurementId: "G-B2NVP25P7C",
};

// Initialize Firebase (SSR-safe: avoid double-init)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };
