import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import worker from "../src/index.js";

const password = randomUUID();
const env = { ADMIN_PASSWORD: password };
const headers = { Origin: "https://pmtinkerer.github.io", Authorization: "Bearer " + password };
const root = "https://example.invalid/api/";

test("malformed feedback cannot enqueue a log write", async (t) => {
  const outbound = t.mock.method(globalThis, "fetch", async () => Response.json({message: "unavailable"}, {status: 403}));
  for (const fields of [{score: "<b>old</b>"}, {score: 11}, {issues_detected: "broken"}, {issues_detected: [{}]}, {session_id: {}}]) {
    const body = JSON.stringify({submission_id: "sub", session_id: "session", ...fields});
    const response = await worker.fetch(new Request(root + "feedback", {method: "POST", headers, body}), env, {waitUntil() {}});
    assert.equal(response.status, 400);
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test("dashboard handles malformed historical feedback and arbitrary string identifiers", async (t) => {
  const submissions = [{session_id: "__proto__", property_name: "Test", created_at: "2026-11-01", cost_estimate: 1}];
  const feedback = [
    {session_id: "__proto__", score: 8, issues_detected: ["constructor"]},
    {session_id: "__proto__", score: "<b>old</b>", issues_detected: "broken"},
    {session_id: {toString: false}, score: null, issues_detected: [{toString: false}]},
  ];
  t.mock.method(globalThis, "fetch", async (url) => {
    const rows = url.endsWith("submissions.jsonl") ? submissions : feedback;
    return Response.json({content: btoa(rows.map((row) => JSON.stringify(row)).join("\n"))});
  });
  const response = await worker.fetch(new Request(root + "admin/dashboard", {headers}), env, {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.avg_score, 8);
  assert.equal(data.score_distribution[8], 1);
  assert.equal(Object.keys(data.score_distribution).length, 10);
  assert.deepEqual(data.common_issues, [{issue: "constructor", count: 1}]);
  assert.equal(data.recent_sessions[0].avg_score, 8);
});

test("regular ratings and unrated feedback still enqueue their records", async (t) => {
  const writes = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (options.method !== "PUT") return new Response(null, {status: 404});
    writes.push(JSON.parse(atob(JSON.parse(options.body).content)));
    return Response.json({});
  });
  for (const score of [1, 10, null]) {
    const body = JSON.stringify({submission_id: "sub", session_id: "s", score, issues_detected: ["trees"]});
    const tasks = [];
    const response = await worker.fetch(new Request(root + "feedback", {method: "POST", headers, body}), env, {waitUntil: task => tasks.push(task)});
    assert.equal(response.status, 200);
    await Promise.all(tasks);
  }
  assert.deepEqual(writes.map(row => row.score), [1, 10, null]);
});
