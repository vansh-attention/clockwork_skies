import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";

const DEV_SECRET = "local-development-secret-change-me";
export function getInviteSecret() {
 const secret = process.env.INVITE_SECRET ?? DEV_SECRET;
 if (process.env.NODE_ENV === "production" && (secret === DEV_SECRET || secret.length < 32)) throw new Error("Production requires an explicit INVITE_SECRET of at least 32 characters");
 return secret;
}
const inviteSchema = z.object({exp:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),uses:z.number().int().min(1).max(10000),nonce:z.string().min(1).max(64)}).strict();
const claimsSchema = z.object({guestId:z.string().min(1).max(64),callsign:z.string().trim().min(2).max(18),inviteNonce:z.string().min(1).max(64),exp:z.number().int().positive()});

export type InvitePayload = { exp: number; uses: number; nonce: string };
export type GuestToken = { guestId: string; callsign: string; inviteNonce: string };
const uses = new Map<string, number>();

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const signature = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function createInvite(secret: string, maxUses: number, expiresAt: number) {
  const body = encode(inviteSchema.parse({ exp: expiresAt, uses: maxUses, nonce: randomBytes(9).toString("base64url") }));
  return `${body}.${signature(body, secret)}`;
}

export function consumeInvite(code: string, secret: string, now = Date.now()): InvitePayload | null {
  if (process.env.NODE_ENV !== "production" && code === "ALPHA-LOCAL") return { exp: now + 86_400_000, uses: 999, nonce: "local" };
  if (typeof code !== "string" || code.length > 2048 || code.split(".").length !== 2) return null;
  const [body, provided] = code.split(".");
  if (!body || !provided) return null;
  const expected = signature(body, secret);
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = inviteSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.exp <= now) return null;
    const payload = parsed.data;
    const consumed = uses.get(payload.nonce) ?? 0;
    if (consumed >= payload.uses) return null;
    uses.set(payload.nonce, consumed + 1);
    return payload;
  } catch { return null; }
}

export function issueGuestToken(secret: string, callsign: string, inviteNonce: string) {
  const guestId = `guest_${randomBytes(8).toString("hex")}`;
  const token = jwt.sign({ guestId, callsign, inviteNonce } satisfies GuestToken, secret, { expiresIn: "12h", issuer: "clockwork-skies" });
  return { token, guestId, callsign, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
}

export function verifyGuestToken(secret: string, token: string): GuestToken | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  try {
    const parsed = claimsSchema.safeParse(jwt.verify(token, secret, { issuer: "clockwork-skies", algorithms:["HS256"] }));
    if (!parsed.success) return null;
    const { guestId,callsign,inviteNonce }=parsed.data;return {guestId,callsign,inviteNonce};
  } catch { return null; }
}
