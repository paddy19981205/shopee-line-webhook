#!/usr/bin/env node
import { automate, DEFAULT_TIMEOUT_MS, preflightComet } from "./comet-ui.js";

function usage(exitCode = 0) {
  console.log(`Usage:
  node comet-shopee-send.js --user <buyer_username> --message <text> [--send]

Examples:
  node comet-shopee-send.js --user see4306 --message hi
  node comet-shopee-send.js --user see4306 --message hi --send

Default behavior drafts the message only. Add --send to click the send arrow after drafting.`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    user: "",
    message: "",
    send: false,
    open: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--send") {
      args.send = true;
    } else if (arg === "--open") {
      args.open = true;
    } else if (arg === "--user") {
      args.user = argv[++i] || "";
    } else if (arg === "--message") {
      args.message = argv[++i] || "";
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i] || DEFAULT_TIMEOUT_MS);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage(1);
    }
  }

  if (!args.user.trim()) {
    console.error("Missing --user.");
    usage(1);
  }
  if (!args.message.length) {
    console.error("Missing --message.");
    usage(1);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 3000) {
    console.error("--timeout-ms must be a number >= 3000.");
    process.exit(1);
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));

try {
  preflightComet();
  const output = automate({
    user: args.user,
    message: args.message,
    mode: args.send ? "send" : "draft",
    open: args.open,
    timeoutMs: args.timeoutMs,
  });

  console.log(
    output === "sent"
      ? `Sent message to ${args.user}.`
      : `Drafted message for ${args.user}. Review Comet and send manually, or rerun with --send.`,
  );
} catch (error) {
  console.error(`Automation stopped: ${error.message}`);
  process.exit(1);
}
