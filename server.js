// ponytail: zero-dep (node:http + global fetch). Upgrade path: add express + sheet cache if sheet grows / needs auth.
// Live source: Google Sheets CSV export. Fallback: embedded snapshot when sheet unreachable or private.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const SHEET_ID = process.env.SHEET_ID || "1HN4MlIUBsEP5tzpOfKFeNbQ2G7ldgaZu9_r9qOHm6pA";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const CACHE_MS = 60_000;

// Snapshot scraped 2026-11-07 via Firecrawl (first sheet, "Centralize"). Cols 0-21 used.
const FALLBACK = [
  ["CENTRALIZED MANUAL No.","Pool Name","Achv","Tanggal","Total Jalur","Total Team","Prod.","Bobot Masuk","Bobot Finish","Pending Resch","Rusong","Tungkom","Brg.","Inst.","Total","Open","Lanjut Install","Cancel","LKPB","(n/a)","Instalasi Target","Real."],
  ["1","SINGKAWANG","100,00%","01 Nov 2026","5","1","5","9","6","-","-","-","-","-","-","-","-","1","-","-","5","5"],
  ["2","SINGKAWANG","100,00%","02 Nov 2026","6","1","6","11","11","-","-","-","-","-","-","-","-","-","-","-","6","6"],
  ["3","SINGKAWANG","100,00%","03 Nov 2026","4","1","4","15","15","-","-","-","-","-","-","-","-","-","-","-","4","4"],
  ["4","SINGKAWANG","100,00%","04 Nov 2026","5","1","5","9","4","-","-","1","1","-","2","-","-","1","-","-","3","3"],
  ["5","SINGKAWANG","100,00%","05 Nov 2026","5","1","5","18","2","-","-","-","-","-","-","-","-","-","-","-","5","5"],
  ["6","SINGKAWANG","100,00%","06 Nov 2026","12","1","12","53","-","-","-","-","-","-","-","-","-","-","-","-","12","12"],
  ["7","SINGKAWANG","100,00%","07 Nov 2026","5","1","5","20","20","-","-","-","-","-","-","-","-","-","-","-","5","5"],
];

const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.,-]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const pct = (v) => { const n = parseFloat(String(v ?? "").replace("%", "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); if (row.some(x => x.trim())) rows.push(row); }
  return rows;
}

// ponytail: header matched by position (known sheet layout). Upgrade: fuzzy header-name map if columns reorder.
function toRecords(rows) {
  const hi = rows.findIndex(r => r.includes("Tanggal") || r.includes("Pool Name"));
  if (hi < 0) return [];
  // Sheet uses 2-row merged header: group row above holds Open/Cancel/etc, subheader holds the rest.
  const group = hi > 0 ? rows[hi - 1] : [];
  const h = rows[hi].map((c, i) => c.trim() ? c : (group[i] || ""));
  const col = (...names) => { const i = h.findIndex(c => names.includes(c.trim().toLowerCase())); if (i < 0) throw new Error(`missing column: ${names[0]}`); return i; };
  const C = { no: col("no.", "centralized manual no."), pool: col("pool name"), achv: col("achv"), date: col("tanggal"),
    jalur: col("total jalur"), team: col("total team"), prod: col("prod.", "prod"), bobotIn: col("bobot masuk"), bobotFin: col("bobot finish"),
    rusong: col("rusong"), tungkom: col("tungkom"), brg: col("brg."), inst: col("inst."), obstTotal: col("total"),
    open: col("open"), lanjut: col("lanjut install"), cancel: col("cancel"), lkpb: col("lkpb"), target: col("target", "instalasi target"), real: col("real.", "real") };
  return rows.slice(hi + 1)
    .filter(r => r[C.date] && r[C.pool] && num(r[C.jalur]) > 0) // skip blank future days + totals row
    .map(r => ({ no: r[C.no] || "", pool: r[C.pool], achv: pct(r[C.achv]), date: r[C.date],
      jalur: num(r[C.jalur]), team: num(r[C.team]), prod: num(r[C.prod]), bobotIn: num(r[C.bobotIn]), bobotFin: num(r[C.bobotFin]),
      obstacles: { Rusong: num(r[C.rusong]), Tungkom: num(r[C.tungkom]), Barang: num(r[C.brg]), Instalasi: num(r[C.inst]) },
      obstTotal: num(r[C.obstTotal]), open: num(r[C.open]), lanjut: num(r[C.lanjut]), cancel: num(r[C.cancel]),
      lkpb: num(r[C.lkpb]), target: num(r[C.target]), real: num(r[C.real]) }));
}

function summarize(records) {
  const sum = (k) => records.reduce((a, r) => a + (r[k] || 0), 0);
  const sumOb = (k) => records.reduce((a, r) => a + (r.obstacles[k] || 0), 0);
  const bobotIn = sum("bobotIn"), bobotFin = sum("bobotFin"), target = sum("target"), real = sum("real");
  return {
    rows: records.length, pools: [...new Set(records.map(r => r.pool))],
    activeDays: records.length, team: Math.max(0, ...records.map(r => r.team)),
    totalJalur: sum("jalur"), prod: sum("prod"), bobotIn, bobotFin,
    bobotRate: bobotIn ? +(bobotFin / bobotIn * 100).toFixed(1) : 0,
    target, real, installRate: target ? +(real / target * 100).toFixed(1) : 0,
    cancel: sum("cancel"), lkpb: sum("lkpb"), open: sum("open"), lanjut: sum("lanjut"),
    obstacles: { Rusong: sumOb("Rusong"), Tungkom: sumOb("Tungkom"), Barang: sumOb("Barang"), Instalasi: sumOb("Instalasi") },
    obstTotal: sum("obstTotal"),
    jalurPerDay: records.map(r => ({ date: r.date, jalur: r.jalur, real: r.real, bobotIn: r.bobotIn, bobotFin: r.bobotFin })),
  };
}

let cache = null, cacheAt = 0;
async function getData() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  let source = "snapshot", records = toRecords(FALLBACK);
  try {
    const res = await fetch(SHEET_URL, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`sheet HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("Tanggal")) throw new Error("sheet not public / unexpected content");
    const parsed = toRecords(parseCSV(text));
    if (!parsed.length) throw new Error("no data rows parsed");
    records = parsed; source = "live";
  } catch (e) { console.error("sheet fetch failed, using snapshot:", e.message); }
  cache = { source, fetchedAt: new Date().toISOString(), records, summary: summarize(records) };
  cacheAt = Date.now();
  return cache;
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/data") {
    const d = await getData();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(d));
  }
  if (url.pathname === "/api/health") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}'); }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const fp = path.join(__dirname, "public", path.normalize(file));
  if (!fp.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(data);
  });
});
server.listen(PORT, () => console.log(`Pool Analytics: http://localhost:${PORT}`));
