import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./MatchRoom.js";
import { createHttpApp } from "./httpApp.js";

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? "127.0.0.1";
const app = createHttpApp();

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }), greet: false });
gameServer.define("battle_royale", MatchRoom);

await gameServer.listen(port, host);
console.log(JSON.stringify({ level: "info", event: "server_ready", host, port, region: process.env.FLY_REGION ?? "local" }));

