# Shopee Comet UI Automation

This is a local UI automation helper for Shopee Seller Chat running inside Comet.
It does not call Shopee private APIs. It uses macOS Accessibility to operate the
visible Comet window.

## Prerequisites

- Comet is open and logged into Shopee Seller Chat.
- The active Comet window is the Shopee chat page:
  `seller.shopee.tw/new-webchat/conversations`.
- macOS has granted Accessibility permission to the app that runs this command
  (Terminal, Codex, or your shell runner).
- Keep the Comet window visible and do not move the mouse/keyboard while it runs.

## Usage

### Single Message

Draft only, recommended for testing:

```bash
node comet-shopee-send.js --user see4306 --message hi
```

Draft and send:

```bash
node comet-shopee-send.js --user see4306 --message hi --send
```

Open the Shopee chat page first, then draft:

```bash
node comet-shopee-send.js --open --user see4306 --message hi
```

### Batch Send

Create a CSV with `username,message` columns:

```csv
username,message
user001,您好，這是通知內容
user002,您好，這是通知內容
```

Dry-run first. This searches users and verifies the chat title, but sends
nothing:

```bash
node batch-send.js --file users.csv
```

Test a small send batch:

```bash
node batch-send.js --file users.csv --limit 5 --send --confirm-send SEND
```

Send the full file:

```bash
node batch-send.js --file users.csv --send --confirm-send SEND
```

Send the full file and notify a LINE group after the batch finishes:

```bash
LINE_CHANNEL_ACCESS_TOKEN=... \
node batch-send.js --file users.csv --send --confirm-send SEND \
  --line-notify --line-target <LINE_GROUP_ID>
```

Recommended production flow when LINE is hosted on Render:

```bash
LINE_PUSH_ENDPOINT=https://shopee-line-webhook.onrender.com/line/push \
LINE_ADMIN_TOKEN=<LINE_ADMIN_TOKEN from Render> \
node batch-send.js --file users.csv --send --confirm-send SEND --line-notify
```

The LINE message includes the final counts and all Shopee buyer usernames that
were not successfully notified. If the failed-user list is too long for one
LINE text message, the script splits it into multiple LINE messages.

Resume after an interruption, skipping users already marked successful in the
log for the same action:

```bash
node batch-send.js --file users.csv --send --confirm-send SEND --resume
```

Useful options:

- `--limit 5`: process only the first 5 selected rows.
- `--offset 20`: skip the first 20 CSV data rows before applying `--limit`.
- `--resume`: skip usernames already successful in the log.
- `--stop-on-error`: stop at the first failed row.
- `--min-delay-ms 3000 --max-delay-ms 8000`: random delay range between rows.
- `--log custom-log.csv`: write results to a custom log file.
- `--timeout-ms 15000`: max wait for finding and verifying each chat.
- `--line-notify`: send a LINE completion message after the batch finishes.
- `--line-target <LINE_GROUP_ID>`: LINE group, room, or user ID to receive the completion message. You can also set `LINE_NOTIFY_TARGET_ID`.
- `--line-push-endpoint <URL>`: send through the deployed relay endpoint, for example `https://shopee-line-webhook.onrender.com/line/push`.
- `--line-admin-token <TOKEN>`: admin token for the deployed relay endpoint. You can also set `LINE_ADMIN_TOKEN`.
- `--line-title "蝦皮通知"`: title used in the LINE completion message.

### LINE Webhook API

The webhook endpoint path is:

```text
https://<your-domain>/line/webhook
```

If this project is deployed on the existing domain shown in your LINE channel
settings, the webhook URL will be:

```text
https://merge-masters.zeabur.app/line/webhook
```

Start the webhook server:

```bash
LINE_CHANNEL_SECRET=... \
LINE_CHANNEL_ACCESS_TOKEN=... \
LINE_ADMIN_TOKEN=<choose-a-random-admin-token> \
npm run line:webhook
```

Required LINE settings and secrets:

- `LINE_CHANNEL_SECRET`: used to verify `x-line-signature` on incoming LINE webhook requests.
- `LINE_CHANNEL_ACCESS_TOKEN`: required to push messages to a group. The Channel secret alone cannot send messages.
- `LINE_NOTIFY_TARGET_ID`: optional default target group, room, or user ID for completion notifications.
- `LINE_ADMIN_TOKEN`: protects the manual test endpoint `POST /line/push`.

To get the target group ID:

1. Deploy or tunnel the webhook server so LINE can reach `https://.../line/webhook`.
2. Paste that URL into LINE Developers > Messaging API > Webhook URL, then enable webhook.
3. Add the LINE Official Account to the target group.
4. Send any message in the group.
5. Check `line-targets.jsonl`; the logged `id` with `"type":"group"` is the value for `LINE_NOTIFY_TARGET_ID` or `--line-target`.

Manual push test:

```bash
curl -X POST https://<your-domain>/line/push \
  -H "Authorization: Bearer <LINE_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"to":"<LINE_GROUP_ID>","text":"LINE webhook test"}'
```

## Safety Behavior

- Batch mode runs a preflight check before the first row. If Comet's
  Accessibility tree is empty or the Shopee search field cannot be read, it
  stops before sending anything. Restart Comet or re-open Shopee chat, then
  rerun the command.
- If the buyer username is not found in search results, the script stops.
- After clicking a search result, the script verifies that the open chat header
  contains the same username before drafting.
- By default, it only drafts the message. It sends only when `--send` is present.
- Batch mode defaults to dry-run verification. It sends only when both `--send`
  and `--confirm-send SEND` are present.
- Batch mode appends every row result to `batch-send-log.csv`, including success,
  failed, and skipped rows.
- Use `--limit` for a small test batch before sending a large list.

## Known Limits

- This is UI automation, so Shopee layout changes can break coordinates.
- It cannot message users that Shopee search does not return.
- If Shopee opens a modal, login prompt, or verification prompt, stop and handle
  it manually before rerunning.
