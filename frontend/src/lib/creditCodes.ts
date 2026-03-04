import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    getDocs,
    arrayUnion,
} from "firebase/firestore";
import { db } from "./firebase";
import { addCredits } from "./credits";

const CODES_COLLECTION = "credit_codes";

export interface CreditCode {
    code: string;
    credits: number;
    maxClaims: number;
    claimedBy: string[]; // array of UIDs
    createdAt: number;
}

/**
 * Generate a random alphanumeric code (e.g. "NV-X7K9M2")
 */
function generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `NV-${result}`;
}

/**
 * Create a new credit code.
 */
export async function createCreditCode(
    credits: number,
    maxClaims: number
): Promise<CreditCode> {
    const code = generateCode();
    const data: CreditCode = {
        code,
        credits,
        maxClaims,
        claimedBy: [],
        createdAt: Date.now(),
    };

    await setDoc(doc(db, CODES_COLLECTION, code), data);
    return data;
}

/**
 * Get all credit codes (for admin).
 */
export async function getAllCreditCodes(): Promise<CreditCode[]> {
    const snapshot = await getDocs(collection(db, CODES_COLLECTION));
    return snapshot.docs
        .map((d) => d.data() as CreditCode)
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Redeem a credit code for a user. Returns a result message.
 */
export async function redeemCode(
    code: string,
    uid: string
): Promise<{ success: boolean; message: string }> {
    const normalized = code.trim().toUpperCase();
    const codeRef = doc(db, CODES_COLLECTION, normalized);
    const snap = await getDoc(codeRef);

    if (!snap.exists()) {
        return { success: false, message: "Invalid code. Please check and try again." };
    }

    const data = snap.data() as CreditCode;

    if (data.claimedBy.includes(uid)) {
        return { success: false, message: "You have already used this code." };
    }

    if (data.claimedBy.length >= data.maxClaims) {
        return { success: false, message: "This code has expired (max claims reached)." };
    }

    // Add user to claimedBy and give credits
    await updateDoc(codeRef, { claimedBy: arrayUnion(uid) });
    await addCredits(uid, data.credits);

    return {
        success: true,
        message: `+${data.credits} credit${data.credits > 1 ? "s" : ""} added to your account!`,
    };
}
