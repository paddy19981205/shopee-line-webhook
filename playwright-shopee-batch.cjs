#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const file = path.resolve(arg('--file', 'users.2026-06-21.csv'));
const reportFile = path.resolve(arg('--report', 'notification-report.2026-06-21.csv'));
const endpoint = arg('--cdp', 'http://127.0.0.1:9224');
const limit = Number(arg('--limit', '0')) || Infinity;
const offset = Number(arg('--offset', '0')) || 0;
const stopOnError = args.includes('--stop-on-error');
const send = args.includes('--send');
const retryFailed = args.includes('--retry-failed');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

function esc(v) {
  v = String(v ?? '');
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function objectsFromCsv(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r, i) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])).rowIndex = i + 1);
}

function readObjects(csvPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const header = rows[0];
  return rows.slice(1).map((r, i) => {
    const obj = Object.fromEntries(header.map((h, j) => [h, r[j] ?? '']));
    obj.__rowNumber = i + 1;
    return obj;
  });
}

function writeReport(reportPath, reportRows) {
  const header = ['row', 'username', 'status', 'sent_at', 'error', 'message_preview'];
  fs.writeFileSync(reportPath, [header.join(','), ...reportRows.map(r => header.map(h => esc(r[h])).join(','))].join('\n') + '\n');
}

function counts(rows) {
  return rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
}

function nodeText(el) {
  return ((el.textContent || el.innerText || '')).trim();
}

async function findBuyerResult(page, username) {
  return await page.evaluate((u) => {
    const exact = [...document.querySelectorAll('body *')]
      .map(el => {
        const text = ((el.textContent || el.innerText || '')).trim();
        const r = el.getBoundingClientRect();
        return { text, x: r.x, y: r.y, w: r.width, h: r.height };
      })
      .filter(o => o.text === u && o.w > 0 && o.h > 0 && o.x >= 70 && o.x < 430 && o.y > 180 && o.y < 340)
      .sort((a, b) => a.y - b.y || b.w - a.w);
    if (!exact.length) return null;
    const r = exact[0];
    return { x: r.x + Math.min(r.w / 2, 80), y: r.y + r.h / 2 };
  }, username);
}

async function headerMatches(page, username) {
  const u = String(username || '').trim();
  const candidates = await headerCandidates(page);
  return candidates.some(o => {
    if (u.endsWith('...')) {
      const prefix = u.slice(0, -3);
      return prefix.length >= 8 && o.text.startsWith(prefix);
    }
    if (o.text === u) return true;
    if (!o.text.startsWith(u)) return false;
    const next = o.text.slice(u.length, u.length + 1);
    return next && !/[A-Za-z0-9._-]/.test(next);
  });
}

async function headerCandidates(page) {
  return await page.evaluate(() => {
    return [...document.querySelectorAll('body *')]
      .map(el => {
        const text = ((el.textContent || el.innerText || '')).trim();
        const r = el.getBoundingClientRect();
        return { text, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter(o => o.text && o.text.length <= 80 && o.x > 430 && o.y > 90 && o.y < 160 && o.w > 0 && o.h > 0)
      .slice(0, 20);
  });
}

async function sendOne(page, row) {
  const username = String(row.username || '').trim();
  const message = row.message;
  let matched = await headerMatches(page, username);

  if (!matched) {
    await page.locator('input[placeholder="搜尋全部"]').fill(username);
    await page.waitForTimeout(800);

    for (let i = 0; i < 12; i++) {
      if (await headerMatches(page, username)) {
        matched = true;
        break;
      }
      await page.waitForTimeout(250);
    }
  }

  if (!matched) {
    const result = await findBuyerResult(page, username);
    if (!result) throw new Error(`找不到精準買家搜尋結果；右側候選=${JSON.stringify(await headerCandidates(page)).slice(0, 500)}`);
    await page.mouse.click(result.x, result.y);
    await page.waitForTimeout(1800);

    if (!(await headerMatches(page, username))) {
      throw new Error('右側聊天對象驗證失敗');
    }
  }

  const reenable = page.getByText('重新啟用對話', { exact: true });
  if (await reenable.count()) {
    await reenable.first().click();
    await page.waitForTimeout(1000);
  }

  const input = page.locator('textarea[placeholder="輸入文字"]').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(message);
  const actual = await input.inputValue();
  if (actual !== message) throw new Error('輸入框內容與待送訊息不一致');

  if (!send) return 'dry_run_ready';
  await input.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);

  const stillThere = await input.inputValue().catch(() => '');
  if (stillThere.trim()) {
    const box = await input.boundingBox();
    const viewport = page.viewportSize() || { width: 1790, height: 976 };
    await page.mouse.click(Math.min(viewport.width - 485, (box?.x || 450) + (box?.width || 850) - 20), (box?.y || 900) + (box?.height || 80) - 20);
    await page.waitForTimeout(1500);
  }

  const body = await page.locator('body').innerText();
  if (!body.includes(message.slice(0, 80))) throw new Error('送出後未在對話中確認到訊息');
  return 'sent';
}

(async () => {
  const rows = readObjects(file);
  const reportRows = readObjects(reportFile);
  const reportByUser = new Map(reportRows.map(r => [r.username, r]));
  const selected = rows.slice(offset)
    .filter(r => {
      const status = reportByUser.get(r.username)?.status || '';
      return status !== 'sent' && (retryFailed || status !== 'failed');
    })
    .slice(0, limit);

  console.log(`Mode: ${send ? 'SEND' : 'DRY-RUN'}`);
  console.log(`Selected: ${selected.length}`);

  const browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('seller.shopee.tw/new-webchat'));
  if (!page) throw new Error('找不到 Shopee 聊聊頁面');
  await page.bringToFront();

  for (const row of selected) {
    const report = reportByUser.get(row.username);
    try {
      const status = await sendOne(page, row);
      if (status === 'sent') {
        report.status = 'sent';
        report.sent_at = new Date().toISOString();
        report.error = '';
      }
      console.log(`${row.__rowNumber},${row.username},${status}`);
    } catch (err) {
      report.status = 'failed';
      report.sent_at = '';
      report.error = err.message;
      console.log(`${row.__rowNumber},${row.username},failed,${err.message}`);
      if (stopOnError) break;
    } finally {
      writeReport(reportFile, reportRows);
      console.log('counts', JSON.stringify(counts(reportRows)));
    }
  }
  await browser.close();
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
