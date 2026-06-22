import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  buildBatchSummaryMessage,
  extractLineTargets,
  pushLineText,
  verifyLineSignature,
} from "./line-client.js";

test("verifyLineSignature validates LINE x-line-signature header", () => {
  const body = JSON.stringify({ events: [] });
  const secret = "test-secret";
  const signature = createHmac("sha256", secret).update(body).digest("base64");

  assert.equal(verifyLineSignature({ body, channelSecret: secret, signature }), true);
  assert.equal(verifyLineSignature({ body, channelSecret: secret, signature: "bad" }), false);
});

test("extractLineTargets returns group, room, and user target ids from webhook events", () => {
  const targets = extractLineTargets({
    events: [
      { type: "message", source: { type: "group", groupId: "Cgroup", userId: "Uignored" } },
      { type: "message", source: { type: "room", roomId: "Rroom" } },
      { type: "follow", source: { type: "user", userId: "Uuser" } },
    ],
  });

  assert.deepEqual(targets, [
    { type: "group", id: "Cgroup" },
    { type: "room", id: "Rroom" },
    { type: "user", id: "Uuser" },
  ]);
});

test("pushLineText sends a LINE push message to the requested target", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => "",
    };
  };

  await pushLineText({
    accessToken: "token",
    to: "Cgroup",
    text: "done",
    fetchImpl,
  });

  assert.equal(calls[0].url, "https://api.line.me/v2/bot/message/push");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    to: "Cgroup",
    messages: [{ type: "text", text: "done" }],
  });
});

test("buildBatchSummaryMessage formats final notification counts", () => {
  assert.equal(
    buildBatchSummaryMessage({
      title: "蝦皮通知",
      mode: "SEND",
      inputFile: "/tmp/users.csv",
      success: 3,
      failed: 1,
      skipped: 2,
      logFile: "/tmp/log.csv",
    }),
    [
      "蝦皮通知完成",
      "模式：SEND",
      "名單：users.csv",
      "成功：3",
      "失敗：1",
      "略過：2",
      "紀錄：log.csv",
    ].join("\n"),
  );
});
