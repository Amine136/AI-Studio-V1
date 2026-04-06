import { api } from "../services/api";

export interface UserRecord {
    uid: string;
    email: string;
    displayName: string;
    credits: number;
    lastSeenAt?: number;
}

export interface CurrentUserProfile extends UserRecord {
    isAdmin: boolean;
}

export async function getProfile(): Promise<CurrentUserProfile> {
    return api.getProfile();
}

export async function getCredits(_uid?: string): Promise<number> {
    const profile = await api.getProfile();
    return profile.credits ?? 0;
}

export async function addCredits(uid: string, amount: number): Promise<void> {
    await api.adjustUserCredits(uid, amount, "admin_add");
}

export async function deductCredits(uid: string, amount: number): Promise<boolean> {
    try {
        await api.adjustUserCredits(uid, -Math.abs(amount), "admin_deduct");
        return true;
    } catch {
        return false;
    }
}

export async function getAllUsers(): Promise<UserRecord[]> {
    const res = await api.getAdminUsers();
    return res.users || [];
}
