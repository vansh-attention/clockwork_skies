import { pathToFileURL } from "node:url";
import { createInvite } from "../apps/server/src/invite.js";

export function parseInviteOptions(args: string[]) {
  const options = { uses: 1, hours: 24 };
  for (const arg of args) {
    const match = /^--(uses|hours)=(\d+)$/.exec(arg);
    if (!match) throw new Error(`Unknown or invalid option: ${arg}. Use --uses=N --hours=N.`);
    const key = match[1] as keyof typeof options;
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value) || value < 1 || value > (key === "uses" ? 1000 : 720)) throw new Error(`${key} is out of range`);
    options[key] = value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { uses, hours } = parseInviteOptions(process.argv.slice(2));
  const secret = process.env.INVITE_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-")) throw new Error("Set INVITE_SECRET to at least 32 random characters before generating invites.");
  console.log(createInvite(secret, uses, Date.now() + hours * 3_600_000));
}
