import { test, expect } from "@playwright/test";

const endpoint = "http://localhost:2567";

test("HTTP service reports local readiness", async ({ request }) => {
  const response = await request.get(`${endpoint}/healthz`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
});

test("HTTP session endpoint rejects invalid requests and invalid invites", async ({ request }) => {
  const invalidRequest = await request.post(`${endpoint}/api/session`, { data: { callsign: "X", inviteCode: "ALPHA-LOCAL" } });
  expect(invalidRequest.status()).toBe(400);
  const invalidInvite = await request.post(`${endpoint}/api/session`, { data: { callsign: "TEST PILOT", inviteCode: "NOT-A-SIGNED-INVITE" } });
  expect(invalidInvite.status()).toBe(401);
});

test("HTTP session endpoint issues a bounded local guest session", async ({ request }) => {
  const response = await request.post(`${endpoint}/api/session`, { data: { callsign: "TEST PILOT", inviteCode: "ALPHA-LOCAL" } });
  expect(response.status()).toBe(200);
  const session = await response.json();
  expect(session.callsign).toBe("TEST PILOT");
  expect(session.guestId).toMatch(/^guest_/);
  expect(session.token.split(".")).toHaveLength(3);
  expect(session.expiresAt).toBeGreaterThan(Date.now());
});
