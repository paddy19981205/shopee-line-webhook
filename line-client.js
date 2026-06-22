import { createHmac, timingSafeEqual } from "node:crypto";
import path from "node:path";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const DEFAULT_LINE_TEXT_MAX_LENGTH = 4500;

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

export async function pushLineTextViaEndpoint({ endpointUrl, adminToken, to, text, fetchImpl = fetch }) {
  if (!endpointUrl) throw new Error("Missing LINE_PUSH_ENDPOINT.");
  if (!adminToken) throw new Error("Missing LINE_ADMIN_TOKEN.");
  if (!text) throw new Error("Missing LINE message text.");

  const response = await fetchImpl(endpointUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      text,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`LINE relay push failed: HTTP ${response.status}${details ? ` ${details}` : ""}`);
  }
}

function buildBatchHeaderLines({ title, mode, inputFile, success, failed, skipped }) {
  return [
    `${title || "蝦皮通知"}完成`,
    `模式：${mode}`,
    `名單：${path.basename(inputFile || "")}`,
    `成功：${success}`,
    `失敗：${failed}`,
    `略過：${skipped}`,
  ];
}

export function buildBatchSummaryMessage({ title, mode, inputFile, success, failed, skipped, logFile, failedUsers = [] }) {
  const failedUserLines = failedUsers.length > 0
    ? ["未成功帳號：", ...failedUsers]
    : ["未成功帳號：無"];

  return [
    ...buildBatchHeaderLines({ title, mode, inputFile, success, failed, skipped }),
    ...failedUserLines,
    `紀錄：${path.basename(logFile || "")}`,
  ].join("\n");
}

export function buildBatchSummaryMessages({
  title,
  mode,
  inputFile,
  success,
  failed,
  skipped,
  logFile,
  failedUsers = [],
  maxLength = DEFAULT_LINE_TEXT_MAX_LENGTH,
}) {
  if (failedUsers.length === 0) {
    return [buildBatchSummaryMessage({ title, mode, inputFile, success, failed, skipped, logFile, failedUsers })];
  }

  const header = buildBatchHeaderLines({ title, mode, inputFile, success, failed, skipped });
  const footer = `紀錄：${path.basename(logFile || "")}`;
  const messages = [];
  let currentLines = [...header, "未成功帳號："];

  for (const user of failedUsers) {
    const nextLines = [...currentLines, user];
    if (nextLines.join("\n").length > maxLength && currentLines.length > header.length + 1) {
      messages.push(currentLines.join("\n"));
      currentLines = [`${title || "蝦皮通知"}未成功帳號續列：`, user];
    } else {
      currentLines = nextLines;
    }
  }

  if ([...currentLines, footer].join("\n").length <= maxLength) {
    currentLines.push(footer);
    messages.push(currentLines.join("\n"));
  } else {
    messages.push(currentLines.join("\n"));
    messages.push(footer);
  }

  return messages;
}
