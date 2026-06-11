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

function mapHistoryEntries(entries: any[]): HistoryEntry[] {
    return (entries || []).map((entry: any) => ({
        id: entry.id,
        imageUrl: entry.imageUrl || undefined,
        caption: entry.caption || undefined,
        prompt: entry.prompt || "",
        model: entry.model || "",
        createdAt: new Date((entry.createdAt || 0) * 1000),
    }));
}

export async function getHistory(
    _uid: string,
    maxItems: number = 20
): Promise<HistoryEntry[]> {
    const res = await api.getHistory(maxItems);
    return mapHistoryEntries(res.entries);
}

export interface HistoryPage {
    entries: HistoryEntry[];
    total: number;
}

// Returns the most recent `maxItems` entries plus `total` — the true count of
// all saved history for the user (server-side COUNT, not the fetched slice).
export async function getHistoryPage(
    _uid: string,
    maxItems: number = 20
): Promise<HistoryPage> {
    const res = await api.getHistory(maxItems);
    const entries = mapHistoryEntries(res.entries);
    return {
        entries,
        total: typeof res.total === "number" ? res.total : entries.length,
    };
}
