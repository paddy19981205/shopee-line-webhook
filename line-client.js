import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export function verifyLineSignature({ body, channelSecret, signature }) {
  if (!body || !channelSecret || !signature) return false;
  const expected = createHmac("sha256", channelSecret).update(body).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function extractLineTargets(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const targets = [];
  const seen = new Set();

  for (const event of events) {
    const source = event?.source || {};
    const id = source.groupId || source.roomId || source.userId || "";
    const type = source.groupId ? "group" : source.roomId ? "room" : source.userId ? "user" : "";
    const key = `${type}:${id}`;
    if (!id || !type || seen.has(key)) continue;
    seen.add(key);
    targets.push({ type, id });
  }

  return targets;
}

export async function pushLineText({ accessToken, to, text, fetchImpl = fetch }) {
  if (!accessToken) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN.");
  if (!to) throw new Error("Missing LINE target id.");
  if (!text) throw new Error("Missing LINE message text.");

  const response = await fetchImpl(LINE_PUSH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`LINE push failed: HTTP ${response.status}${details ? ` ${details}` : ""}`);
  }
}

export function buildBatchSummaryMessage({ title, mode, inputFile, success, failed, skipped, logFile }) {
  return [
    `${title || "蝦皮通知"}完成`,
    `模式：${mode}`,
    `名單：${path.basename(inputFile || "")}`,
    `成功：${success}`,
    `失敗：${failed}`,
    `略過：${skipped}`,
    `紀錄：${path.basename(logFile || "")}`,
  ].join("\n");
}
