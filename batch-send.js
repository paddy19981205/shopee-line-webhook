#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { automate, DEFAULT_TIMEOUT_MS, preflightComet } from "./comet-ui.js";
import { buildBatchSummaryMessages, pushLineText, pushLineTextViaEndpoint } from "./line-client.js";

const DEFAULT_MIN_DELAY_MS = 3000;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_LOG_FILE = "batch-send-log.csv";

function usage(exitCode = 0) {
  console.log(`Usage:
  node batch-send.js --file users.csv [--dry-run]
  node batch-send.js --file users.csv --limit 5 --send --confirm-send SEND
  node batch-send.js --file users.csv --send --confirm-send SEND --resume
  node batch-send.js --file users.csv --send --confirm-send SEND --line-notify

CSV columns:
  username,message

Safety defaults:
  - Without --send, the batch only verifies each chat and sends nothing.
  - Sending requires both --send and --confirm-send SEND.
  - Results are appended to ${DEFAULT_LOG_FILE}.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    file: "",
    send: false,
    confirmSend: "",
    limit: 0,
    offset: 0,
    resume: false,
    stopOnError: false,
    open: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    logFile: DEFAULT_LOG_FILE,
    lineNotify: false,
    lineTarget: process.env.LINE_NOTIFY_TARGET_ID || "",
    linePushEndpoint: process.env.LINE_PUSH_ENDPOINT || "",
    lineAdminToken: process.env.LINE_ADMIN_TOKEN || "",
    lineTitle: "蝦皮通知",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--dry-run") {
      args.send = false;
    } else if (arg === "--send") {
      args.send = true;
    } else if (arg === "--confirm-send") {
      args.confirmSend = argv[++i] || "";
    } else if (arg === "--file") {
      args.file = argv[++i] || "";
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i] || 0);
    } else if (arg === "--offset") {
      args.offset = Number(argv[++i] || 0);
    } else if (arg === "--resume") {
      args.resume = true;
    } else if (arg === "--stop-on-error") {
      args.stopOnError = true;
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i] || DEFAULT_TIMEOUT_MS);
    } else if (arg === "--min-delay-ms") {
      args.minDelayMs = Number(argv[++i] || DEFAULT_MIN_DELAY_MS);
    } else if (arg === "--max-delay-ms") {
      args.maxDelayMs = Number(argv[++i] || DEFAULT_MAX_DELAY_MS);
    } else if (arg === "--log") {
      args.logFile = argv[++i] || DEFAULT_LOG_FILE;
    } else if (arg === "--line-notify") {
      args.lineNotify = true;
    } else if (arg === "--line-target") {
      args.lineTarget = argv[++i] || "";
    } else if (arg === "--line-push-endpoint") {
      args.linePushEndpoint = argv[++i] || "";
    } else if (arg === "--line-admin-token") {
      args.lineAdminToken = argv[++i] || "";
    } else if (arg === "--line-title") {
      args.lineTitle = argv[++i] || "";
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }

  if (!args.file) {
    console.error("Missing --file.");
    usage(1);
  }
  if (args.send && args.confirmSend !== "SEND") {
    console.error("Batch sending requires --confirm-send SEND.");
    process.exit(1);
  }
  if (!Number.isInteger(args.limit) || args.limit < 0) {
    console.error("--limit must be a non-negative integer.");
    process.exit(1);
  }
  if (!Number.isInteger(args.offset) || args.offset < 0) {
    console.error("--offset must be a non-negative integer.");
    process.exit(1);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 3000) {
    console.error("--timeout-ms must be a number >= 3000.");
    process.exit(1);
  }
  if (!Number.isFinite(args.minDelayMs) || !Number.isFinite(args.maxDelayMs) || args.minDelayMs < 0 || args.maxDelayMs < args.minDelayMs) {
    console.error("--min-delay-ms and --max-delay-ms must be valid, non-negative numbers.");
    process.exit(1);
  }
  if (args.lineNotify && !args.linePushEndpoint && !args.lineTarget) {
    console.error("--line-notify requires LINE_PUSH_ENDPOINT, --line-push-endpoint, --line-target, or LINE_NOTIFY_TARGET_ID.");
    process.exit(1);
  }
  if (args.lineNotify && args.linePushEndpoint && !args.lineAdminToken) {
    console.error("--line-push-endpoint requires --line-admin-token or LINE_ADMIN_TOKEN.");
    process.exit(1);
  }

  return args;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  const usernameIndex = headers.findIndex((header) => ["username", "user", "buyer", "buyer_username"].includes(header));
  const messageIndex = headers.findIndex((header) => ["message", "text", "訊息"].includes(header));

  if (usernameIndex === -1 || messageIndex === -1) {
    throw new Error("CSV must include username,message columns.");
  }

  return rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    username: (values[usernameIndex] || "").trim(),
    message: values[messageIndex] || "",
  }));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function appendLog(logFile, entry) {
  const exists = fs.existsSync(logFile);
  const line = [
    entry.timestamp,
    entry.rowNumber,
    entry.username,
    entry.action,
    entry.status,
    entry.error || "",
  ].map(csvEscape).join(",");

  if (!exists) {
    fs.appendFileSync(logFile, "timestamp,row,username,action,status,error\n", "utf8");
  }
  fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

function readCompletedUsers(logFile, action) {
  if (!fs.existsSync(logFile)) return new Set();
  const rows = parseCsvLikeLog(fs.readFileSync(logFile, "utf8"));
  return new Set(
    rows
      .filter((row) => row.action === action && row.status === "success")
      .map((row) => row.username),
  );
}

function parseCsvLikeLog(text) {
  const parsed = parseCsvWithHeaders(text);
  return parsed.map((row) => ({
    username: row.username || "",
    action: row.action || "",
    status: row.status || "",
  }));
}

function parseCsvWithHeaders(text) {
  const rawRows = parseRawCsv(text);
  if (rawRows.length === 0) return [];
  const headers = rawRows[0].map((header) => header.trim());
  return rawRows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ""]),
  ));
}

function parseRawCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  return Math.floor(minMs + Math.random() * (maxMs - minMs + 1));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(args.file);
  const logPath = path.resolve(args.logFile);
  const action = args.send ? "send" : "verify";

  const records = parseCsv(fs.readFileSync(filePath, "utf8"))
    .filter((record) => record.username || record.message)
    .slice(args.offset);

  const selected = args.limit > 0 ? records.slice(0, args.limit) : records;
  const completed = args.resume ? readCompletedUsers(logPath, action) : new Set();

  console.log(`Mode: ${args.send ? "SEND" : "DRY-RUN VERIFY ONLY"}`);
  console.log(`Input: ${filePath}`);
  console.log(`Log: ${logPath}`);
  console.log(`Rows selected: ${selected.length}`);

  preflightComet();

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const failedUsers = [];

  for (let index = 0; index < selected.length; index += 1) {
    const record = selected[index];
    const label = `[${index + 1}/${selected.length}] row ${record.rowNumber} ${record.username}`;

    if (!record.username || !record.message) {
      skipped += 1;
      const error = "missing username or message";
      console.log(`${label}: skipped (${error})`);
      appendLog(logPath, {
        timestamp: new Date().toISOString(),
        rowNumber: record.rowNumber,
        username: record.username,
        action,
        status: "skipped",
        error,
      });
      continue;
    }

    if (completed.has(record.username)) {
      skipped += 1;
      console.log(`${label}: skipped (already successful in log)`);
      continue;
    }

    try {
      const output = automate({
        user: record.username,
        message: record.message,
        mode: args.send ? "send" : "verify",
        open: args.open && index === 0,
        timeoutMs: args.timeoutMs,
      });

      success += 1;
      console.log(`${label}: ${output}`);
      appendLog(logPath, {
        timestamp: new Date().toISOString(),
        rowNumber: record.rowNumber,
        username: record.username,
        action,
        status: "success",
      });
    } catch (error) {
      failed += 1;
      failedUsers.push(record.username);
      console.log(`${label}: failed (${error.message})`);
      appendLog(logPath, {
        timestamp: new Date().toISOString(),
        rowNumber: record.rowNumber,
        username: record.username,
        action,
        status: "failed",
        error: error.message,
      });
      if (args.stopOnError) break;
    }

    if (index < selected.length - 1) {
      const delayMs = randomDelay(args.minDelayMs, args.maxDelayMs);
      console.log(`Waiting ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }

  console.log(`Done. success=${success}, failed=${failed}, skipped=${skipped}`);
  if (!args.send) {
    console.log("Dry-run only. No messages were sent.");
  }

  if (args.lineNotify) {
    const lineMessages = buildBatchSummaryMessages({
      title: args.lineTitle,
      mode: args.send ? "SEND" : "DRY-RUN",
      inputFile: filePath,
      success,
      failed,
      skipped,
      logFile: logPath,
      failedUsers,
    });

    try {
      for (const lineText of lineMessages) {
        if (args.linePushEndpoint) {
          await pushLineTextViaEndpoint({
            endpointUrl: args.linePushEndpoint,
            adminToken: args.lineAdminToken,
            to: args.lineTarget,
            text: lineText,
          });
        } else {
          await pushLineText({
            accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
            to: args.lineTarget,
            text: lineText,
          });
        }
      }
      console.log(`LINE notification sent to ${args.lineTarget}.`);
    } catch (error) {
      console.error(`LINE notification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(`Batch stopped: ${error.message}`);
  process.exit(1);
});
