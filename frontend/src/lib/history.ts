import { api } from "./../services/api";

export interface HistoryEntry {
    id: string;
    imageUrl?: string;
    caption?: string;
    prompt: string;
    model: string;
    createdAt: Date;
}

export async function addHistoryEntry(
    _uid: string,
    data: {
        imageUrl?: string;
        caption?: string;
        prompt: string;
        model: string;
    }
): Promise<void> {
    await api.addHistoryEntry(data);
}

export async function getHistory(
    _uid: string,
    maxItems: number = 20
): Promise<HistoryEntry[]> {
    const res = await api.getHistory(maxItems);
    return (res.entries || []).map((entry: any) => ({
        id: entry.id,
        imageUrl: entry.imageUrl || undefined,
        caption: entry.caption || undefined,
        prompt: entry.prompt || "",
        model: entry.model || "",
        createdAt: new Date((entry.createdAt || 0) * 1000),
    }));
}
