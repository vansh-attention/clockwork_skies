import {createHmac} from "node:crypto";
import {expect,it,vi} from "vitest";
import jwt from "jsonwebtoken";
import {consumeInvite,getInviteSecret,verifyGuestToken} from "../src/invite.js";
it("refuses default or short secrets in production",()=>{
 vi.stubEnv("NODE_ENV","production");vi.stubEnv("INVITE_SECRET","");
 expect(()=>getInviteSecret()).toThrow();vi.stubEnv("INVITE_SECRET","local-development-secret-change-me");expect(()=>getInviteSecret()).toThrow();
 vi.stubEnv("INVITE_SECRET","a".repeat(32));expect(getInviteSecret()).toHaveLength(32);vi.unstubAllEnvs();
});
it("validates numeric bounds on correctly signed invites",()=>{
 for(const payload of [{exp:"tomorrow",uses:1,nonce:"x"},{exp:Date.now()+1000,uses:1.5,nonce:"x"},{exp:Date.now()+1000,uses:1,nonce:123}]) {
 const body=Buffer.from(JSON.stringify(payload)).toString("base64url"),sig=createHmac("sha256","secret").update(body).digest("base64url");expect(consumeInvite(`${body}.${sig}`,"secret")).toBe(null);
 }
});
it("restricts JWT algorithm, issuer, expiry and well-formed claims",()=>{
 const claims={guestId:"guest",callsign:"PILOT",inviteNonce:"x"};
 for(const options of [{algorithm:"HS384",issuer:"clockwork-skies",expiresIn:"1h"},{issuer:"other",expiresIn:"1h"},{issuer:"clockwork-skies",expiresIn:-1},{issuer:"clockwork-skies"}]) {
 expect(verifyGuestToken("secret",jwt.sign(claims,"secret",options as any))).toBe(null);
 }
 expect(verifyGuestToken("secret",jwt.sign(claims,"secret",{issuer:"clockwork-skies",expiresIn:"1h"}))).toEqual(claims);
});
