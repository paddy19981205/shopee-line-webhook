#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { extractLineTargets, pushLineText, verifyLineSignature } from "./line-client.js";

const DEFAULT_PORT = 3000;
const DEFAULT_TARGET_LOG_FILE = "line-targets.jsonl";

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

function appendTargets(targetLogFile, targets) {
  if (!targets.length) return;
  for (const target of targets) {
    fs.appendFileSync(targetLogFile, `${JSON.stringify({ ...target, timestamp: new Date().toISOString() })}\n`, "utf8");
  }
}

export async function handleLineWebhookRequest({ method, body, headers, channelSecret, targetLogFile }) {
  if (method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }
  if (!channelSecret) {
    return jsonResponse(500, { ok: false, error: "Missing LINE_CHANNEL_SECRET" });
  }

  const signature = headers["x-line-signature"] || headers["X-Line-Signature"] || "";
  if (!verifyLineSignature({ body, channelSecret, signature })) {
    return jsonResponse(401, { ok: false, error: "Invalid LINE signature" });
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  const targets = extractLineTargets(payload);
  appendTargets(targetLogFile, targets);
  return jsonResponse(200, { ok: true, targets });
}

async function handlePushRequest({ method, body, headers, adminToken, accessToken }) {
  if (method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }
  if (!adminToken) {
    return jsonResponse(403, { ok: false, error: "Missing LINE_ADMIN_TOKEN" });
  }
  const auth = headers.authorization || headers.Authorization || "";
  if (auth !== `Bearer ${adminToken}`) {
    return jsonResponse(401, { ok: false, error: "Invalid admin token" });
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON" });
  }

  await pushLineText({
    accessToken,
    to: payload.to || process.env.LINE_NOTIFY_TARGET_ID,
    text: payload.text,
  });
  return jsonResponse(200, { ok: true });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response, result) {
  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
}

export function createLineWebhookServer({
  channelSecret = process.env.LINE_CHANNEL_SECRET,
  accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN,
  adminToken = process.env.LINE_ADMIN_TOKEN,
  targetLogFile = process.env.LINE_TARGET_LOG_FILE || DEFAULT_TARGET_LOG_FILE,
} = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, jsonResponse(200, { ok: true }));
        return;
      }

      const body = await readRequestBody(request);
      if (url.pathname === "/line/webhook") {
        send(response, await handleLineWebhookRequest({
          method: request.method,
          body,
          headers: request.headers,
          channelSecret,
          targetLogFile,
        }));
        return;
      }

      if (url.pathname === "/line/push") {
        send(response, await handlePushRequest({
          method: request.method,
          body,
          headers: request.headers,
          adminToken,
          accessToken,
        }));
        return;
      }

      send(response, jsonResponse(404, { ok: false, error: "Not found" }));
    } catch (error) {
      send(response, jsonResponse(500, { ok: false, error: error.message }));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || "0.0.0.0";
  const server = createLineWebhookServer();
  server.listen(port, host, () => {
    console.log(`LINE webhook server listening on http://${host}:${port}`);
    console.log(`Webhook path: /line/webhook`);
  });
}
