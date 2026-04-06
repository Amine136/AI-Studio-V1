import { api } from "../services/api";

export interface CreditCode {
    code: string;
    credits: number;
    maxClaims: number;
    claimedCount: number;
    createdAt: number;
    createdBy: string;
}

export async function createCreditCode(
    credits: number,
    maxClaims: number
): Promise<CreditCode> {
    return api.createAdminCode(credits, maxClaims);
}

export async function getAllCreditCodes(): Promise<CreditCode[]> {
    const res = await api.getAdminCodes();
    return res.codes || [];
}

export async function redeemCode(
    code: string,
    _uid?: string
): Promise<{ success: boolean; message: string; credits?: number; balance?: number }> {
    return api.redeemCode(code);
}
