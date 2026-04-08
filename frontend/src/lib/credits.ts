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

export async function getAllUsers(): Promise<UserRecord[]> {
    const res = await api.getAdminUsers();
    return res.users || [];
}
