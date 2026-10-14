import cors from "cors";
import express from "express";
import { z } from "zod";
import { consumeInvite, getInviteSecret, issueGuestToken } from "./invite.js";
import { metrics, metricsText } from "./metrics.js";

export function createHttpApp() {
const origin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const secret = getInviteSecret();
const app = express();
app.use(cors({ origin }));
app.use(express.json({ limit: "16kb" }));

const sessionRequest = z.object({ inviteCode: z.string().min(3).max(2048), callsign: z.string().trim().min(2).max(18) });
app.post("/api/session", (request, response) => {
  const parsed = sessionRequest.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "invalid_request" }); return; }
  const invite = consumeInvite(parsed.data.inviteCode, secret);
  if (!invite) { response.status(401).json({ error: "invalid_or_expired_invite" }); return; }
  response.json(issueGuestToken(secret, parsed.data.callsign.toUpperCase(), invite.nonce));
});

app.post("/api/matchmaking/join", (_request, response) => response.json({ roomName: "battle_royale", region: "sin", maxPlayers: 16 }));
app.get("/healthz", (_request, response) => response.json({ ok: true, region: process.env.FLY_REGION ?? "local", rooms: metrics.rooms }));
app.get("/metrics", (_request, response) => { response.type("text/plain").send(metricsText()); });

app.use((error: any, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
 response.status(error?.type === "entity.too.large" ? 413 : 400).json({error:"invalid_request"});
});
return app;
}
