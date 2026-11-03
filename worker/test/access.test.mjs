import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import worker from "../src/index.js";

const origin = "https://pmtinkerer.github.io";
const password = randomUUID();

function probe(route, { method = "POST", auth, env = { ADMIN_PASSWORD: password } } = {}) {
  const headers = { Origin: origin };
  if (auth) headers.Authorization = auth;
  const body = method !== "POST" ? undefined : route === "generate" ? new FormData() : "{}";
  return worker.fetch(new Request("https://example.invalid/api/" + route, { method, headers, body }), env, {});
}

for (const route of ["generate", "iterate", "feedback"]) {
  test(route + " checks identity before input validation", async () => {
    assert.equal((await probe(route)).status, 401);
    assert.equal((await probe(route, { auth: "Bearer " + randomUUID() })).status, 401);
    assert.equal((await probe(route, { auth: "Bearer " + password })).status, 400);
    assert.equal((await probe(route, { method: "OPTIONS" })).status, 204);
  });
}

test("unconfigured password always denies administrative access", async () => {
  for (const value of [undefined, ""]) {
    const result = await probe("admin/unknown", { method: "GET", auth: "Bearer " + value, env: { ADMIN_PASSWORD: value } });
    assert.equal(result.status, 401);
  }
});

test("unknown endpoints retain their routing behavior", async () => {
  assert.equal((await probe("unknown")).status, 404);
  assert.equal((await probe("admin/unknown", { method: "GET", auth: "Bearer " + password })).status, 404);
});
