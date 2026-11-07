import type { Overview, OverviewInstance, OverviewService } from '../registry/types.js';

/**
 * Trang /lists: render HTML ở SERVER, bằng hàm thuần (Overview → string), không template engine.
 *
 * - Chỉ MỘT chỗ render: lần đầu trả cả trang; JS trên trang gọi lại `/lists?partial=1` mỗi 2s
 *   để lấy phần nội dung đã render sẵn rồi thay vào. Không phải viết lại logic render bằng JS.
 * - MỌI giá trị đi qua `escapeHtml`: `patterns`, `metadata`, `host` là chuỗi do service gửi lên.
 *   Một service gửi pattern `<img src=x onerror=...>` mà không escape là XSS ngay trên trang quản trị.
 * - CSP (header do controller đặt) là lớp chặn thứ hai: chỉ script có `nonce` mới chạy,
 *   nên kể cả lỡ quên escape ở đâu đó, script chèn vào cũng không chạy.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Toàn trang (lần tải đầu). `nonce` phải trùng với header CSP của response. */
export function renderOverviewPage(overview: Overview, nonce: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Service Registry</title>
<style>${STYLES}</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <span class="logo" aria-hidden="true"></span>
    <div><h1>Service Registry</h1><p class="sub">Các service đang đăng ký, health theo heartbeat và pattern của từng service</p></div>
  </div>
  <div class="live">
    <span id="status" class="status ok" role="status">Tự cập nhật mỗi 2s</span>
    <button id="pause" type="button" aria-pressed="false">Tạm dừng</button>
  </div>
</header>
<div class="filters">
  <label class="grow">Tìm <input id="search" type="search" placeholder="service, instance hoặc pattern (VD user.getById)" autocomplete="off"></label>
</div>
<main id="content">${renderOverviewContent(overview)}</main>
<script nonce="${escapeHtml(nonce)}">${SCRIPT}</script>
</body>
</html>`;
}

/** Phần nội dung thay được (summary + các service). Dùng cho cả trang đầy đủ và `?partial=1`. */
export function renderOverviewContent(overview: Overview): string {
  const services = overview.services;
  const instances = services.flatMap((s) => s.instances);
  const healthy = instances.filter((i) => i.health === 'healthy').length;
  const late = instances.length - healthy;

  const summary = `
<section class="summary" aria-label="Tổng quan">
  ${stat('Service', services.length)}
  ${stat('Instance', instances.length)}
  ${stat('Healthy', healthy, 'ok')}
  ${stat('Late', late, late ? 'warn' : '')}
</section>
<p class="meta">
  Lease TTL <b>${seconds(overview.leaseTtlMs)}</b> · heartbeat mỗi <b>${seconds(overview.heartbeatIntervalMs)}</b> ·
  <span class="dot ok"></span> healthy: heartbeat ≤ ${seconds(overview.healthyThresholdMs)} ·
  <span class="dot warn"></span> late: đã lỡ nhịp, sẽ bị gỡ khi hết TTL ·
  version <b title="Chỉ tăng khi bảng đổi">v${overview.version}</b> ·
  boot <code title="${escapeHtml(overview.bootId)}">${escapeHtml(overview.bootId.slice(0, 8))}</code> ·
  cập nhật ${time(overview.generatedAt)}
</p>`;

  if (services.length === 0) {
    return `${summary}
<section class="empty">
  <h2>Chưa có service nào đăng ký</h2>
  <p>Chạy một service có cấu hình registry, ví dụ trong <code>apps/echo-service</code>:</p>
  <pre>REGISTRY_URL=http://localhost:8500 REGISTRY_ADVERTISE_HOST=127.0.0.1 npm run start:dev</pre>
</section>`;
  }
  return `${summary}<section class="services">${services.map(renderService).join('')}</section>`;
}

function renderService(service: OverviewService): string {
  // Chuỗi để ô "Tìm" lọc trên client: tên service, id instance, pattern (đã escape khi đưa vào attribute).
  const searchable = [service.service, ...service.instances.map((i) => i.id), ...service.patterns].join(' ').toLowerCase();
  const allHealthy = service.healthyCount === service.instanceCount;
  return `
<article class="service" data-search="${escapeHtml(searchable)}">
  <header>
    <h3>${escapeHtml(service.service)}</h3>
    <span class="badge ${allHealthy ? 'ok' : 'warn'}">${service.healthyCount}/${service.instanceCount} healthy</span>
  </header>
  <div class="patterns" aria-label="Pattern">
    <span class="label">Service xử lý ${service.patterns.length} pattern:</span>
    ${service.patterns.map(chip).join('')}
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Health</th><th>Instance</th><th>Địa chỉ</th><th>Heartbeat cuối</th><th>Lease còn lại</th><th>Đăng ký lúc</th><th>Message pattern đã đăng ký</th></tr></thead>
      <tbody>${service.instances.map(renderInstance).join('')}</tbody>
    </table>
  </div>
</article>`;
}

function renderInstance(instance: OverviewInstance): string {
  const ok = instance.health === 'healthy';
  const metadata = instance.metadata
    ? Object.entries(instance.metadata)
        .map(([k, v]) => `<span class="kv">${escapeHtml(k)}=${escapeHtml(v)}</span>`)
        .join(' ')
    : '';
  return `
<tr class="${ok ? '' : 'is-late'}">
  <td><span class="health ${ok ? 'ok' : 'warn'}"><span class="dot ${ok ? 'ok' : 'warn'}"></span>${ok ? 'healthy' : 'late'}</span></td>
  <td><code>${escapeHtml(instance.id)}</code>${metadata ? `<div class="md">${metadata}</div>` : ''}</td>
  <td><code>${escapeHtml(instance.host)}:${instance.port}</code></td>
  <td class="num">${ago(instance.lastHeartbeatAgoMs)}</td>
  <td>${leaseBar(instance)}</td>
  <td>${time(instance.registeredAt)}</td>
  <td><div class="cell-patterns">${instance.patterns.map(chip).join('')}</div></td>
</tr>`;
}

/** Một pattern dạng "chip". `data-pattern` để ô tìm kiếm tô sáng pattern khớp. */
function chip(pattern: string): string {
  return `<code class="chip" data-pattern="${escapeHtml(pattern.toLowerCase())}">${escapeHtml(pattern)}</code>`;
}

function leaseBar(instance: OverviewInstance): string {
  const total = instance.leaseRemainingMs + instance.lastHeartbeatAgoMs;
  const percent = total > 0 ? Math.round((instance.leaseRemainingMs / total) * 100) : 0;
  return `<div class="lease"><span class="bar"><span class="fill ${instance.health === 'healthy' ? 'ok' : 'warn'}" style="width:${percent}%"></span></span><span class="num">${seconds(instance.leaseRemainingMs)}</span></div>`;
}

function stat(label: string, value: number, tone = ''): string {
  return `<div class="stat ${tone}"><span class="value">${value}</span><span class="label">${label}</span></div>`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function ago(ms: number): string {
  return ms < 1000 ? 'vừa xong' : `${(ms / 1000).toFixed(1)}s trước`;
}

/** `<time>` theo UTC; JS trên trang đổi sang giờ địa phương của người xem. */
function time(iso: string): string {
  const text = `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(text)}</time>`;
}

const STYLES = `
:root {
  --bg: #f6f7f9; --panel: #ffffff; --text: #17202a; --muted: #5d6b7a; --line: #e2e6eb;
  --accent: #3b5bdb; --ok: #2b8a3e; --ok-soft: #e6f4ea; --warn: #b35c00; --warn-soft: #fff1e0;
  --chip: #eef1f6; --code: #f1f3f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1419; --panel: #171e26; --text: #e6ebf0; --muted: #93a1b0; --line: #26313d;
    --accent: #8ea6ff; --ok: #5cc779; --ok-soft: #173323; --warn: #f0a24a; --warn-soft: #3a2a14;
    --chip: #222c37; --code: #1d2630;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.top { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
  padding: 16px clamp(16px, 4vw, 40px); background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { display: flex; gap: 12px; align-items: center; }
.logo { width: 34px; height: 34px; border-radius: 9px; flex: none;
  background: radial-gradient(circle at 30% 30%, var(--accent) 0 28%, transparent 30%),
              radial-gradient(circle at 72% 40%, var(--ok) 0 20%, transparent 22%),
              radial-gradient(circle at 45% 75%, var(--warn) 0 16%, transparent 18%), var(--chip); }
h1 { font-size: 18px; margin: 0; }
.sub { margin: 0; color: var(--muted); font-size: 13px; }
.live { display: flex; gap: 10px; align-items: center; }
.status { font-size: 12.5px; color: var(--muted); }
.status::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--muted); }
.status.ok::before { background: var(--ok); }
.status.error { color: var(--warn); }
.status.error::before { background: var(--warn); }
button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--panel); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
.filters { display: flex; flex-wrap: wrap; gap: 12px; padding: 14px clamp(16px, 4vw, 40px) 0; }
.filters label { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
.filters .grow { flex: 1 1 260px; }
select, input { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 6px 10px; }
input { width: 100%; }
main { padding: 14px clamp(16px, 4vw, 40px) 40px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; }
.stat .value { display: block; font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
.stat .label { color: var(--muted); font-size: 12.5px; }
.stat.ok .value { color: var(--ok); }
.stat.warn .value { color: var(--warn); }
.meta { color: var(--muted); font-size: 12.5px; margin: 10px 0 4px; }
.services { margin-top: 18px; }
.service { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; }
.service > header { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.service h3 { margin: 0; font-size: 15px; }
.badge { font-size: 12px; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
.badge.ok { background: var(--ok-soft); color: var(--ok); }
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.patterns { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 10px 0 12px; }
.patterns .label { color: var(--muted); font-size: 12px; margin-right: 4px; }
.chip { background: var(--chip); border-radius: 6px; padding: 2px 8px; }
.cell-patterns { display: flex; flex-wrap: wrap; gap: 4px; min-width: 200px; }
td .chip { padding: 1px 6px; font-size: 12px; }
.chip.hit { background: var(--accent); color: var(--panel); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 720px; }
th, td { text-align: left; padding: 8px 10px; border-top: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; font-weight: 600; color: var(--muted); border-top: none; }
td code { background: var(--code); padding: 1px 6px; border-radius: 5px; white-space: nowrap; }
.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
tr.is-late td { background: var(--warn-soft); }
.health { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px; }
.health.ok { color: var(--ok); }
.health.warn { color: var(--warn); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.dot.ok { background: var(--ok); }
.dot.warn { background: var(--warn); }
.lease { display: flex; align-items: center; gap: 8px; }
.bar { width: 90px; height: 6px; border-radius: 3px; background: var(--chip); overflow: hidden; flex: none; }
.fill { display: block; height: 100%; }
.fill.ok { background: var(--ok); }
.fill.warn { background: var(--warn); }
.md { margin-top: 4px; }
.kv { color: var(--muted); font-size: 12px; margin-right: 8px; }
.empty { margin-top: 22px; background: var(--panel); border: 1px dashed var(--line); border-radius: 12px; padding: 22px; }
.empty h2 { margin: 0 0 6px; font-size: 16px; }
.empty pre { background: var(--code); padding: 12px; border-radius: 8px; overflow-x: auto; }
.nomatch { color: var(--muted); margin-top: 22px; }
[hidden] { display: none !important; }
`;

/**
 * JS trên trang (chạy nhờ nonce trong CSP):
 * - Poll `/lists?partial=1` bằng setTimeout NỐI TIẾP (xong lần này mới hẹn lần sau), dừng khi tab ẩn.
 * - Nội dung thay vào bằng innerHTML: an toàn vì server đã escape; và CSP chặn mọi script/handler
 *   chèn vào (script trong innerHTML không chạy, handler `on...` không có nonce).
 * - Tìm kiếm áp lại sau mỗi lần thay nội dung.
 */
const SCRIPT = `
(() => {
  const INTERVAL = 2000;
  const content = document.getElementById('content');
  const status = document.getElementById('status');
  const pause = document.getElementById('pause');
  const search = document.getElementById('search');
  let paused = false;
  let timer;

  function setStatus(kind, text) { status.className = 'status ' + kind; status.textContent = text; }

  function localizeTimes() {
    content.querySelectorAll('time[datetime]').forEach((t) => {
      const d = new Date(t.getAttribute('datetime'));
      if (!isNaN(d)) t.textContent = d.toLocaleString();
    });
  }

  function applyFilters() {
    const q = search.value.trim().toLowerCase();
    let visible = 0;
    content.querySelectorAll('.service').forEach((card) => {
      const match = !q || card.dataset.search.includes(q);
      card.hidden = !match;
      card.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('hit', !!q && chip.dataset.pattern.includes(q)));
      if (match) visible++;
    });
    let note = content.querySelector('.nomatch');
    const hasServices = content.querySelector('.service');
    if (hasServices && visible === 0) {
      if (!note) { note = document.createElement('p'); note.className = 'nomatch'; content.append(note); }
      note.textContent = 'Không có service nào khớp bộ lọc.';
    } else if (note) { note.remove(); }
  }

  function afterRender() { localizeTimes(); applyFilters(); }

  async function refresh() {
    try {
      const res = await fetch('/lists?partial=1', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      content.innerHTML = await res.text();
      afterRender();
      setStatus('ok', 'Tự cập nhật mỗi 2s');
    } catch (e) {
      setStatus('error', 'Mất kết nối registry, đang thử lại…');
    } finally {
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!paused && !document.hidden) timer = setTimeout(refresh, INTERVAL);
  }

  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? 'Tiếp tục' : 'Tạm dừng';
    pause.setAttribute('aria-pressed', String(paused));
    if (paused) { clearTimeout(timer); setStatus('', 'Đã tạm dừng'); } else { refresh(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) refresh(); });
  search.addEventListener('input', applyFilters);

  afterRender();
  schedule();
})();
`;
