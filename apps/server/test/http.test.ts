import {createServer,type Server} from "node:http";
import {afterAll,beforeAll,expect,it} from "vitest";
import {createHttpApp} from "../src/httpApp.js";
let server:Server,url:string;
beforeAll(async()=>{
 server=createServer(createHttpApp());await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const a=server.address();if(!a||typeof a==="string")throw new Error("No port");url=`http://127.0.0.1:${a.port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
it("validates HTTP session bodies and serves authenticated guest tokens",async()=>{
 const send=(body:unknown)=>fetch(url+"/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 expect((await send({inviteCode:"ALPHA-LOCAL",callsign:123})).status).toBe(400);
 expect((await send({inviteCode:"x".repeat(3000),callsign:"TEST"})).status).toBe(400);
 expect((await send({inviteCode:"x".repeat(20000),callsign:"TEST"})).status).toBe(413);
 const result=await send({inviteCode:"ALPHA-LOCAL",callsign:"TEST"});expect(result.status).toBe(200);const data=await result.json();expect(data.token).toBeTypeOf("string");expect(data.callsign).toBe("TEST");
 const malformed=await fetch(url+"/api/session",{method:"POST",headers:{"content-type":"application/json"},body:"{"});expect(malformed.status).toBe(400);
 expect((await fetch(url+"/healthz")).status).toBe(200);
});
