import { doc, getDoc, setDoc, increment, updateDoc, collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

const USERS_COLLECTION = "users";

export interface UserRecord {
    uid: string;
    email: string;
    displayName: string;
    credits: number;
}

/**
 * Ensure the user document exists with profile info. Called on sign-in.
 */
export async function ensureUserDoc(uid: string, email: string, displayName: string): Promise<void> {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        await setDoc(userRef, { email, displayName, credits: 0 });
    } else {
        // Update profile info in case it changed (e.g. Google name update)
        await updateDoc(userRef, { email, displayName });
    }
}

/**
 * Get the current credits for a user.
 */
export async function getCredits(uid: string): Promise<number> {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        return 0;
    }

    return snap.data().credits ?? 0;
}

/**
 * Add credits to a user's balance.
 */
export async function addCredits(uid: string, amount: number): Promise<void> {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        await setDoc(userRef, { credits: amount, email: "", displayName: "" });
    } else {
        await updateDoc(userRef, { credits: increment(amount) });
    }
}

/**
 * Deduct credits from a user's balance. Returns false if insufficient credits.
 */
export async function deductCredits(uid: string, amount: number): Promise<boolean> {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        await setDoc(userRef, { credits: 0, email: "", displayName: "" });
        return false;
    }

    const current = snap.data().credits ?? 0;
    if (current < amount) {
        return false;
    }

    await updateDoc(userRef, { credits: increment(-amount) });
    return true;
}

/**
 * Fetch all users (for admin panel).
 */
export async function getAllUsers(): Promise<UserRecord[]> {
    const snapshot = await getDocs(collection(db, USERS_COLLECTION));
    return snapshot.docs.map((d) => ({
        uid: d.id,
        email: d.data().email ?? "",
        displayName: d.data().displayName ?? "",
        credits: d.data().credits ?? 0,
    }));
}
