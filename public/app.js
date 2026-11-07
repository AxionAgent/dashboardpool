"use strict";
// ponytail: hand-rolled SVG/div charts, zero deps. Upgrade: chart lib only if tooltips/zoom required.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let DATA = null;

async function load() {
  $("#source").textContent = "loading…";
  try {
    const r = await fetch("/api/data", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    DATA = await r.json();
  } catch (e) { $("#source").textContent = `failed: ${e.message}`; return; }
  render();
}

function kpi(label, value, sub) {
  return `<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b><span>${esc(sub || "")}</span></div>`;
}

function render() {
  const { summary: s, records, source, fetchedAt } = DATA;
  $("#source").textContent = source === "live" ? "live · Google Sheets" : "snapshot (sheet unreachable)";
  $("#subtitle").textContent = `${s.pools.join(", ")} pool · ${s.activeDays} active days · Nov 2026`;
  $("#fetched").textContent = `fetched ${new Date(fetchedAt).toLocaleString()}`;
  $("#kpis").innerHTML =
    kpi("Total jalur", s.totalJalur, `${s.activeDays} days`) +
    kpi("Production", s.prod, `${s.team} team`) +
    kpi("Bobot finish rate", `${s.bobotRate}%`, `${s.bobotFin}/${s.bobotIn}`) +
    kpi("Install real / target", `${s.real}/${s.target}`, `${s.installRate}% achieved`) +
    kpi("Cancel", s.cancel, `${s.lkpb} LKPB`) +
    kpi("Obstacles", s.obstTotal, "4 types");

  const max = Math.max(1, ...s.jalurPerDay.map(d => d.jalur));
  $("#daily").innerHTML = s.jalurPerDay.map(d => `
    <div class="bar" title="${esc(d.date)}: ${d.jalur} jalur, ${d.real} real">
      <div class="col" style="height:${Math.round(d.jalur / max * 130)}px"></div>
      <div class="col real" style="height:${Math.round(d.real / max * 130)}px"></div>
      <span class="lbl">${esc(d.date.slice(0, 2))}</span>
    </div>`).join("");
  $("#daily").setAttribute("aria-label", `Jalur per day: ${s.jalurPerDay.map(d => `${d.date} ${d.jalur}`).join(", ")}`);

  const row = (label, val, maxV, cls) => `<div class="frow"><span>${esc(label)}</span><div class="track"><div class="fill ${cls || ""}" style="width:${maxV ? Math.round(val / maxV * 100) : 0}%"></div></div><output>${val}</output></div>`;
  $("#funnel").innerHTML = row("Bobot masuk", s.bobotIn, Math.max(s.bobotIn, s.bobotFin), "") + row("Bobot finish", s.bobotFin, Math.max(s.bobotIn, s.bobotFin), "teal") + `<p>${s.bobotRate}% completion</p>`;
  $("#target").innerHTML = `<div class="big">${s.installRate}%</div>` + row("Target", s.target, Math.max(s.target, s.real), "") + row("Real", s.real, Math.max(s.target, s.real), "teal");
  const obMax = Math.max(1, ...Object.values(s.obstacles));
  $("#obstacles").innerHTML = Object.entries(s.obstacles).map(([k, v]) => row(k, v, obMax, v ? "coral" : "")).join("") + `<p>Total ${s.obstTotal} · latest day ${records.length ? esc(records[records.length - 1].date) : "—"}</p>`;

  $("#table-note").textContent = `${records.length} rows`;
  drawTable();
}

function drawTable() {
  if (!DATA) return;
  const q = $("#q").value.trim().toLowerCase(), min = Number($("#min").value || 0);
  const rows = DATA.records.filter(r => r.jalur >= min && (!q || `${r.date} ${r.pool}`.toLowerCase().includes(q)));
  $("#tbl tbody").innerHTML = rows.map(r => `<tr><td>${esc(r.no)}</td><td>${esc(r.date)}</td><td>${esc(r.pool)}</td><td>${r.achv == null ? "—" : r.achv.toFixed(0) + "%"}</td><td>${r.jalur}</td><td>${r.prod}</td><td>${r.bobotIn}</td><td>${r.bobotFin}</td><td>${r.target}</td><td>${r.real}</td><td>${r.cancel}</td></tr>`).join("");
  $("#empty").hidden = rows.length > 0;
  $("#table-note").textContent = `${rows.length} of ${DATA.records.length} rows`;
}

$("#refresh").addEventListener("click", load);
$("#q").addEventListener("input", drawTable);
$("#min").addEventListener("input", drawTable);
load();
