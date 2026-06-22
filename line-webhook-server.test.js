import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleLineWebhookRequest } from "./line-webhook-server.js";

function signature(body, secret) {
  return createHmac("sha256", secret).update(body).digest("base64");
}

test("handleLineWebhookRequest records LINE group targets when signature is valid", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "line-webhook-"));
  const targetLogFile = path.join(tmpDir, "targets.jsonl");
  const body = JSON.stringify({
    events: [{ type: "message", source: { type: "group", groupId: "Cgroup" } }],
  });

  const response = await handleLineWebhookRequest({
    method: "POST",
    body,
    headers: { "x-line-signature": signature(body, "secret") },
    channelSecret: "secret",
    targetLogFile,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, targets: [{ type: "group", id: "Cgroup" }] });
  assert.match(fs.readFileSync(targetLogFile, "utf8"), /"id":"Cgroup"/);
});

test("handleLineWebhookRequest rejects invalid LINE signatures", async () => {
  const response = await handleLineWebhookRequest({
    method: "POST",
    body: JSON.stringify({ events: [] }),
    headers: { "x-line-signature": "bad" },
    channelSecret: "secret",
    targetLogFile: "/tmp/not-used.jsonl",
  });

  assert.equal(response.statusCode, 401);
});
