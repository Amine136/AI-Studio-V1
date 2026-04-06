import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyDCNd0eUooJ8wSlYoIC4W-MnNGM_rMsqeM",
    authDomain: "novanodetn.firebaseapp.com",
    projectId: "novanodetn",
    storageBucket: "novanodetn.firebasestorage.app",
    messagingSenderId: "973322616880",
    appId: "1:973322616880:web:efd5953ad0e75301d42df5",
    measurementId: "G-9DFZC010R8",
};

// Initialize Firebase (SSR-safe: avoid double-init)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };
