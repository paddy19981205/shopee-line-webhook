import { execFileSync, spawnSync } from "node:child_process";

export const SHOPEE_CHAT_URL =
  "https://seller.shopee.tw/new-webchat/conversations?ignore-html-cache=1";

export const DEFAULT_TIMEOUT_MS = 15000;

export function runAppleScript(script, args = []) {
  const result = spawnSync("osascript", ["-", ...args], {
    input: script,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(cleanAppleScriptError(details.trim()) || "osascript failed");
  }

  return result.stdout.trim();
}

export function cleanAppleScriptError(message) {
  const match = message.match(/execution error: (.+?) \(-?\d+\)$/s);
  return match ? match[1].trim() : message;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function setClipboard(value) {
  execFileSync("zsh", ["-lc", `printf %s ${shellQuote(value)} | pbcopy`], {
    stdio: "ignore",
  });
}

function getClipboard() {
  try {
    return execFileSync("pbpaste", { encoding: "utf8" });
  } catch {
    return "";
  }
}

export function openShopeeChat() {
  execFileSync("open", ["-a", "Comet", SHOPEE_CHAT_URL], { stdio: "ignore" });
}

export function automate({ user, message = "", mode = "draft", open = false, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!["verify", "draft", "send"].includes(mode)) {
    throw new Error(`Unknown mode: ${mode}`);
  }

  if (open) {
    console.log("Opening Shopee chat in Comet...");
    openShopeeChat();
  }

  const previousClipboard = getClipboard();

  try {
    if (mode !== "verify") {
      setClipboard(message);
    }

    return runAppleScript(AUTOMATION_SCRIPT, [
      user,
      mode,
      String(Math.ceil(timeoutMs / 1000)),
      message,
    ]);
  } finally {
    setClipboard(previousClipboard);
  }
}

export function preflightComet() {
  return runAppleScript(PREFLIGHT_SCRIPT);
}

const AUTOMATION_SCRIPT = `
on chatWindow()
  tell application "System Events"
    tell process "Comet"
      repeat with w in windows
        try
          if (name of w as text) contains "賣家版蝦皮聊聊" then return w
        end try
      end repeat
    end tell
  end tell
  error "找不到 Comet 的賣家版蝦皮聊聊視窗"
end chatWindow

on waitForBuyer(targetUser, timeoutSeconds)
  tell application "System Events"
    tell process "Comet"
      set targetWindow to my chatWindow()
      set winPos to position of targetWindow
      set leftX to item 1 of winPos
      set startTime to current date
      repeat
        set allItems to entire contents of targetWindow
        repeat with e in allItems
          try
            if (role of e as text) is "AXStaticText" and (name of e as text) is targetUser then
              set encodedBox to encodeLeftListBox(e, leftX)
              if encodedBox is not "" then return encodedBox
            end if
          end try
        end repeat

        if ((current date) - startTime) > timeoutSeconds then
          error "找不到買家帳號：" & targetUser
        end if
        delay 0.5
      end repeat
    end tell
  end tell
end waitForBuyer

on findVisibleBuyer(targetUser)
  tell application "System Events"
    tell process "Comet"
      set targetWindow to my chatWindow()
      set winPos to position of targetWindow
      set leftX to item 1 of winPos
      set allItems to entire contents of targetWindow
      repeat with e in allItems
        try
          if (role of e as text) is "AXStaticText" and (name of e as text) is targetUser then
            set encodedBox to encodeLeftListBox(e, leftX)
            if encodedBox is not "" then return encodedBox
          end if
        end try
      end repeat
    end tell
  end tell
  return ""
end findVisibleBuyer

on encodeLeftListBox(e, leftX)
  set p to position of e
  set s to size of e
  set foundX to item 1 of p
  set foundY to item 2 of p
  set foundW to item 1 of s
  set foundH to item 2 of s
  if foundX > (leftX + 55) and foundX < (leftX + 330) then
    return (foundX as text) & "," & (foundY as text) & "," & (foundW as text) & "," & (foundH as text)
  end if
  return ""
end encodeLeftListBox

on clearSearchBox()
  tell application "System Events"
    tell process "Comet"
      set targetWindow to my chatWindow()
      set winPos to position of targetWindow
      set leftX to item 1 of winPos
      set topY to item 2 of winPos
      click at {leftX + 170, topY + 168}
      delay 0.1
      keystroke "a" using command down
      delay 0.1
      key code 51
      delay 0.7
    end tell
  end tell
end clearSearchBox

on verifyOpenChat(targetUser, timeoutSeconds)
  tell application "System Events"
    tell process "Comet"
      set targetWindow to my chatWindow()
      set winPos to position of targetWindow
      set leftX to item 1 of winPos
      set startTime to current date
      repeat
        set allItems to entire contents of targetWindow
        repeat with e in allItems
          try
            if (role of e as text) is "AXStaticText" and (name of e as text) is targetUser then
              set p to position of e
              set xPos to item 1 of p
              if xPos > (leftX + 300) then return true
            end if
          end try
        end repeat

        if ((current date) - startTime) > timeoutSeconds then
          error "已點擊搜尋結果，但右側聊天室標題未確認為：" & targetUser
        end if
        delay 0.5
      end repeat
    end tell
  end tell
end verifyOpenChat

on run argv
  set targetUser to item 1 of argv
  set actionMode to item 2 of argv
  set timeoutSeconds to (item 3 of argv) as number
  set targetMessage to item 4 of argv

  tell application "Comet" to activate
  delay 0.5

  clearSearchBox()
  set resultBox to findVisibleBuyer(targetUser)

  if resultBox is "" then
    tell application "System Events"
    tell process "Comet"
      set frontmost to true
        set targetWindow to my chatWindow()
        set winPos to position of targetWindow
        set winSize to size of targetWindow
        set leftX to item 1 of winPos
        set topY to item 2 of winPos
        set winH to item 2 of winSize

        -- Shopee webchat search input, relative to the current Comet window.
        click at {leftX + 170, topY + 168}
        delay 0.1
        keystroke "a" using command down
        delay 0.1
        set the clipboard to targetUser
        keystroke "v" using command down
        delay 0.1
        key code 36
      end tell
    end tell

    set resultBox to waitForBuyer(targetUser, timeoutSeconds)
  end if
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to ","
  set parts to text items of resultBox
  set AppleScript's text item delimiters to oldDelims

  set buyerX to (item 1 of parts) as number
  set buyerY to (item 2 of parts) as number
  set buyerW to (item 3 of parts) as number
  set buyerH to (item 4 of parts) as number

  tell application "System Events"
    tell process "Comet"
      click at {buyerX + (buyerW / 2), buyerY + (buyerH / 2)}
    end tell
  end tell

  verifyOpenChat(targetUser, timeoutSeconds)

  if actionMode is "verify" then return "verified"

  tell application "System Events"
    tell process "Comet"
      set targetWindow to my chatWindow()
      set winPos to position of targetWindow
      set winSize to size of targetWindow
      set leftX to item 1 of winPos
      set topY to item 2 of winPos
      set winW to item 1 of winSize
      set winH to item 2 of winSize

      -- Message editor. Paste is used so Chinese text and punctuation survive.
      click at {leftX + 365, topY + winH - 145}
      delay 0.15
      set the clipboard to targetMessage
      keystroke "v" using command down
      delay 0.3

      if actionMode is "send" then
        -- Click the send arrow. This is more reliable than Return when quick-reply suggestions are open.
        click at {leftX + winW - 28, topY + winH - 22}
        delay 0.7
        return "sent"
      else
        return "drafted"
      end if
    end tell
  end tell
end run
`;

const PREFLIGHT_SCRIPT = `
on chatWindow()
  tell application "System Events"
    tell process "Comet"
      repeat with w in windows
        try
          if (name of w as text) contains "賣家版蝦皮聊聊" then return w
        end try
      end repeat
    end tell
  end tell
  error "找不到 Comet 的賣家版蝦皮聊聊視窗"
end chatWindow

on run
  tell application "Comet" to activate
  delay 0.3
  tell application "System Events"
    tell process "Comet"
      set targetWindow to my chatWindow()
      set itemCount to count of entire contents of targetWindow
      if itemCount < 20 then error "Comet accessibility tree is empty; restart Comet or re-open Shopee chat before batch automation."
      set allItems to entire contents of targetWindow
      repeat with e in allItems
        try
          if (role of e as text) is "AXTextField" then return "ok"
        end try
      end repeat
    end tell
  end tell
  error "找不到蝦皮聊聊搜尋欄"
end run
`;
