import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.js";
import { ALICE, BOB, makeAssistant } from "./helpers.js";

const { assistant } = makeAssistant();
const tokens: Record<string, { id: string; name?: string }> = { "tok-alice": { id: ALICE, name: "Camille Durand" }, "tok-bob": { id: BOB } };
const app = createApp(assistant, async (t) => tokens[t] ?? null, { allowedOrigin: "https://soona.test", adminToken: "admin-secret" });
const server = app.listen(0);
after(() => server.close());
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assistant`;
const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) =>
  fetch(base() + path, {
    method: init.method ?? (init.json ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });

test("401 sans jeton ou avec un jeton invalide", async () => {
  assert.equal((await call("/chat", { json: { message: "hi" } })).status, 401);
  assert.equal((await call("/chat", { json: { message: "hi" }, token: "faux" })).status, 401);
});

test("400 sur un corps invalide (message vide, trop long, id non UUID)", async () => {
  assert.equal((await call("/chat", { token: "tok-alice", json: { message: "  " } })).status, 400);
  assert.equal((await call("/chat", { token: "tok-alice", json: { message: "x".repeat(4001) } })).status, 400);
  assert.equal((await call("/feedback", { token: "tok-alice", json: { messageId: "abc", rating: 1 } })).status, 400);
  assert.equal((await call("/feedback", { token: "tok-alice", json: { messageId: crypto.randomUUID(), rating: 5 } })).status, 400);
});

test("chat → feedback → export → effacement, avec CORS restreint", async () => {
  const r = await call("/chat", { token: "tok-alice", json: { message: "Bonjour, je suis Camille Durand" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "https://soona.test");
  const chat = (await r.json()) as { messageId: string; conversationId: string };

  // Bob ne peut pas noter la réponse d'Alice : l'identité vient du jeton, pas du corps
  assert.equal((await call("/feedback", { token: "tok-bob", json: { messageId: chat.messageId, rating: -1 } })).status, 404);
  const fb = await call("/feedback", { token: "tok-alice", json: { messageId: chat.messageId, rating: -1, correction: "Plus court svp" } });
  assert.equal(fb.status, 201);
  const { id: lessonId } = (await fb.json()) as { id: string };
  assert.equal((await call("/feedback", { token: "tok-alice", json: { messageId: chat.messageId, rating: 1 } })).status, 409);

  // Modération : refusée sans le bon jeton admin
  assert.equal((await call(`/lessons/${lessonId}`, { method: "PATCH", json: { status: "approved" } })).status, 403);
  assert.equal((await call(`/lessons/${lessonId}`, { method: "PATCH", json: { status: "approved" }, headers: { "x-admin-token": "nope-secret!" } })).status, 403);
  assert.equal((await call(`/lessons/${lessonId}`, { method: "PATCH", json: { status: "approved" }, headers: { "x-admin-token": "admin-secret" } })).status, 200);

  const exp = (await (await call("/memory", { token: "tok-alice" })).json()) as { memories: { content: string }[] };
  assert.equal(exp.memories.length, 2);
  assert.doesNotMatch(JSON.stringify(exp), /Camille|Durand/, "le nom du profil est masqué même sans indice");

  const del = (await (await call("/memory", { token: "tok-alice", method: "DELETE" })).json()) as { deleted: { memories: number } };
  assert.equal(del.deleted.memories, 2);
});

test("429 au-delà de 20 messages par minute", async () => {
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await call("/chat", { token: "tok-bob", json: { message: `m${i}` } })).status;
  assert.equal(last, 429);
});

test("OPTIONS (pré-requête CORS) → 204", async () => {
  assert.equal((await fetch(base() + "/chat", { method: "OPTIONS" })).status, 204);
});
