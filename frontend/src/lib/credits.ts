import { api } from "../services/api";
import type { AdminUserListItem } from "../types";

export type UserRecord = AdminUserListItem;
export type CurrentUserProfile = UserRecord;

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
