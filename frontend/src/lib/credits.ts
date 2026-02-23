import { doc, getDoc, setDoc, increment, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

const USERS_COLLECTION = "users";

/**
 * Get the current credits for a user. Creates the document with 0 credits if it doesn't exist.
 */
export async function getCredits(uid: string): Promise<number> {
    const userRef = doc(db, USERS_COLLECTION, uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
        await setDoc(userRef, { credits: 0 });
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
        await setDoc(userRef, { credits: amount });
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
        await setDoc(userRef, { credits: 0 });
        return false;
    }

    const current = snap.data().credits ?? 0;
    if (current < amount) {
        return false;
    }

    await updateDoc(userRef, { credits: increment(-amount) });
    return true;
}
