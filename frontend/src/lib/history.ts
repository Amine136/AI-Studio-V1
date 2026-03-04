import {
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
    Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const USERS_COLLECTION = "users";
const HISTORY_SUBCOLLECTION = "history";

export interface HistoryEntry {
    id: string;
    imageUrl?: string;
    caption?: string;
    prompt: string;
    model: string;
    createdAt: Date;
}

/**
 * Save a generation result to the user's history.
 */
export async function addHistoryEntry(
    uid: string,
    data: {
        imageUrl?: string;
        caption?: string;
        prompt: string;
        model: string;
    }
): Promise<void> {
    const historyRef = collection(db, USERS_COLLECTION, uid, HISTORY_SUBCOLLECTION);
    await addDoc(historyRef, {
        ...data,
        createdAt: serverTimestamp(),
    });
}

/**
 * Get the user's generation history, most recent first.
 */
export async function getHistory(
    uid: string,
    maxItems: number = 20
): Promise<HistoryEntry[]> {
    const historyRef = collection(db, USERS_COLLECTION, uid, HISTORY_SUBCOLLECTION);
    const q = query(historyRef, orderBy("createdAt", "desc"), limit(maxItems));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            imageUrl: data.imageUrl || undefined,
            caption: data.caption || undefined,
            prompt: data.prompt || "",
            model: data.model || "",
            createdAt: data.createdAt instanceof Timestamp
                ? data.createdAt.toDate()
                : new Date(),
        };
    });
}
