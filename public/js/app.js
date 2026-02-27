// NodeJsReport Dashboard App

const API_BASE = '';
let selectedFile = null;

// Socket.IO
const socket = typeof io !== 'undefined' ? io() : null;

if (socket) {
  socket.on('connect', () => {
    console.log('Socket.IO connected');
  });

  socket.on('watcher:processing', (data) => {
    showToast(`處理中: ${data.filename}`, 'info');
  });

  socket.on('watcher:completed', (data) => {
    showToast(`列印完成: ${data.filename}`, 'success');
    loadWatcherStatus();
    loadJobs();
  });

  socket.on('watcher:failed', (data) => {
    showToast(`列印失敗: ${data.filename} - ${data.error}`, 'error');
    loadWatcherStatus();
    loadJobs();
  });

  socket.on('watcher:started', () => {
    loadWatcherStatus();
  });

  socket.on('watcher:stopped', () => {
    loadWatcherStatus();
  });
}

// API helpers
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Toast notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Load printers
async function loadPrinters() {
  try {
    const result = await apiGet('/api/printers');
    const list = document.getElementById('printer-list');
    const watchSelect = document.getElementById('watch-printer');

    if (!result.success || !result.data.length) {
      list.innerHTML = '<div class="empty-state"><p>未偵測到印表機</p></div>';
      return;
    }

    list.innerHTML = result.data.map((p) => `
      <div class="printer-item">
        <span class="name">${p.name}</span>
        ${p.isDefault ? '<span class="default">預設</span>' : ''}
      </div>
    `).join('');

    // Update printer selects
    const options = '<option value="">(系統預設)</option>' +
      result.data.map((p) => `<option value="${p.name}">${p.name}</option>`).join('');
    watchSelect.innerHTML = options;
  } catch (error) {
    showToast('載入印表機失敗', 'error');
  }
}

// Load paper sizes
async function loadPaperSizes() {
  try {
    const result = await apiGet('/api/paper-sizes');
    if (result.success) {
      const select = document.getElementById('watch-paper-size');
      select.innerHTML = result.data.map((s) =>
        `<option value="${s.id}">${s.name} (${s.widthMm}x${s.heightMm}mm)</option>`
      ).join('');
    }
  } catch (error) {
    console.error('Failed to load paper sizes:', error);
  }
}

// Health check
async function loadHealth() {
  try {
    const result = await apiGet('/api/health');
    const el = document.getElementById('health-status');
    if (result.success) {
      el.className = 'status status-active';
      el.innerHTML = '<span class="status-dot"></span><span>運行中</span>';
    }
  } catch {
    const el = document.getElementById('health-status');
    el.className = 'status status-error';
    el.innerHTML = '<span class="status-dot"></span><span>離線</span>';
  }
}

// Watcher
async function loadWatcherStatus() {
  try {
    const result = await apiGet('/api/watcher/status');
    if (!result.success) return;

    const data = result.data;
    const el = document.getElementById('watcher-status');
    const btnStart = document.getElementById('btn-start-watch');
    const btnStop = document.getElementById('btn-stop-watch');

    if (data.active) {
      el.className = 'status status-active';
      el.innerHTML = `<span class="status-dot"></span><span>監測中: ${data.directory}</span>`;
      btnStart.disabled = true;
      btnStop.disabled = false;
      document.getElementById('watch-dir').value = data.directory;
    } else {
      el.className = 'status status-inactive';
      el.innerHTML = '<span class="status-dot"></span><span>未啟動</span>';
      btnStart.disabled = false;
      btnStop.disabled = true;
    }

    // Processed files
    const tbody = document.getElementById('processed-table-body');
    if (data.processedFiles && data.processedFiles.length > 0) {
      tbody.innerHTML = data.processedFiles.map((f) => `
        <tr>
          <td>${f.filename}</td>
          <td><span class="badge ${f.status === 'success' ? 'badge-success' : 'badge-danger'}">${f.status === 'success' ? '成功' : '失敗'}</span></td>
          <td>${new Date(f.processedAt).toLocaleString('zh-TW')}</td>
          <td class="text-sm text-muted">${f.error || '-'}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center">尚無記錄</td></tr>';
    }
  } catch (error) {
    console.error('Failed to load watcher status:', error);
  }
}

async function startWatcher() {
  const directory = document.getElementById('watch-dir').value.trim();
  if (!directory) {
    showToast('請輸入監測目錄', 'error');
    return;
  }

  try {
    const result = await apiPost('/api/watcher/start', {
      directory,
      printer: document.getElementById('watch-printer').value || undefined,
      paperSize: document.getElementById('watch-paper-size').value,
    });

    if (result.success) {
      showToast('目錄監測已啟動', 'success');
      loadWatcherStatus();
    } else {
      showToast(`啟動失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('啟動監測失敗', 'error');
  }
}

async function stopWatcher() {
  try {
    const result = await apiPost('/api/watcher/stop', {});
    if (result.success) {
      showToast('目錄監測已停止', 'info');
      loadWatcherStatus();
    }
  } catch (error) {
    showToast('停止監測失敗', 'error');
  }
}

// Jobs
async function loadJobs() {
  try {
    const result = await apiGet('/api/jobs');
    if (!result.success) return;

    // Stats
    const stats = result.stats;
    document.getElementById('job-stats').textContent =
      `共 ${stats.total} | 等待 ${stats.pending} | 列印中 ${stats.printing} | 完成 ${stats.completed} | 失敗 ${stats.failed}`;

    // Table
    const tbody = document.getElementById('job-table-body');
    if (result.data.length > 0) {
      tbody.innerHTML = result.data.slice(0, 20).map((job) => `
        <tr>
          <td class="text-sm">${job.id.substring(0, 8)}...</td>
          <td>${job.source}</td>
          <td>${job.printer}</td>
          <td><span class="badge badge-${statusBadge(job.status)}">${statusLabel(job.status)}</span></td>
          <td class="text-sm">${new Date(job.createdAt).toLocaleString('zh-TW')}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="text-align:center">尚無列印工作</td></tr>';
    }
  } catch (error) {
    console.error('Failed to load jobs:', error);
  }
}

function statusBadge(status) {
  const map = { pending: 'info', printing: 'warning', completed: 'success', failed: 'danger' };
  return map[status] || 'info';
}

function statusLabel(status) {
  const map = { pending: '等待中', printing: '列印中', completed: '已完成', failed: '失敗' };
  return map[status] || status;
}

// Excel upload
function setupDropZone() {
  const zone = document.getElementById('excel-drop-zone');
  const input = document.getElementById('excel-file-input');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  });

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelect(file);
  });
}

function handleFileSelect(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'xls' && ext !== 'xlsx') {
    showToast('只支援 XLS/XLSX 檔案', 'error');
    return;
  }

  selectedFile = file;
  const zone = document.getElementById('excel-drop-zone');
  zone.innerHTML = `<p>已選擇: <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)</p>`;

  document.getElementById('btn-excel-print').disabled = false;
  document.getElementById('btn-excel-preview').disabled = false;
}

async function excelPrint() {
  if (!selectedFile) {
    showToast('請先選擇 Excel 檔案', 'error');
    return;
  }

  const btn = document.getElementById('btn-excel-print');
  btn.disabled = true;

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('paperSize', document.getElementById('watch-paper-size').value);

  try {
    showToast('正在列印...', 'info');
    const res = await fetch('/api/excel/print', { method: 'POST', body: formData });
    const result = await res.json();

    if (result.success) {
      showToast('列印成功', 'success');
      loadJobs();
    } else {
      showToast(`列印失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Excel print error:', error);
    showToast(`列印失敗: ${error.message || '網路錯誤'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function excelPreview() {
  if (!selectedFile) {
    showToast('請先選擇 Excel 檔案', 'error');
    return;
  }

  const btn = document.getElementById('btn-excel-preview');
  btn.disabled = true;

  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('paperSize', document.getElementById('watch-paper-size').value);

  try {
    showToast('正在產生預覽...', 'info');
    const res = await fetch('/api/excel/preview', { method: 'POST', body: formData });
    const result = await res.json();

    if (result.success) {
      window.open(`/preview.html?id=${result.previewId}`, '_blank');
    } else {
      showToast(`預覽失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Excel preview error:', error);
    showToast(`預覽失敗: ${error.message || '網路錯誤'}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Update checker
async function checkUpdate() {
  const modal = document.getElementById('update-modal');
  const title = document.getElementById('update-modal-title');
  const body = document.getElementById('update-modal-body');
  const actions = document.getElementById('update-modal-actions');

  modal.style.display = 'flex';
  title.textContent = '檢查更新';
  body.innerHTML = '<p>正在檢查更新...</p>';
  actions.innerHTML = '<button class="btn btn-outline" onclick="closeUpdateModal()">關閉</button>';

  try {
    const result = await apiGet('/api/updater/check');
    if (!result.success) {
      body.innerHTML = `<p style="color:var(--danger)">檢查失敗: ${result.error}</p>`;
      return;
    }

    const data = result.data;
    if (data.available) {
      title.textContent = '有新版本可用';
      body.innerHTML = `
        <p><strong>目前版本:</strong> v${data.currentVersion}</p>
        <p><strong>最新版本:</strong> v${data.latestVersion}</p>
        <p style="margin-top:8px"><strong>發佈時間:</strong> ${data.publishedAt ? new Date(data.publishedAt).toLocaleString('zh-TW') : '-'}</p>
        ${data.releaseNotes ? `<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;font-size:13px;white-space:pre-wrap;max-height:200px;overflow-y:auto">${escapeHtml(data.releaseNotes)}</div>` : ''}
      `;
      if (data.downloadUrl) {
        actions.innerHTML = `
          <button class="btn btn-outline" onclick="closeUpdateModal()">稍後再說</button>
          <button class="btn btn-primary" id="btn-apply-update" data-url="${escapeHtml(data.downloadUrl)}" data-version="${escapeHtml(data.latestVersion)}">下載並更新</button>
        `;
        document.getElementById('btn-apply-update').addEventListener('click', function() {
          applyUpdate(this.dataset.url, this.dataset.version);
        });
      } else {
        body.innerHTML += '<p style="color:var(--warning);margin-top:8px">找不到可下載的 exe 檔案，請至 GitHub Releases 手動下載。</p>';
      }
    } else {
      title.textContent = '已是最新版本';
      body.innerHTML = `<p>目前版本 v${data.currentVersion} 已經是最新版本。</p>`;
    }
  } catch (error) {
    body.innerHTML = `<p style="color:var(--danger)">檢查更新失敗: ${error.message || '網路錯誤'}</p>`;
  }
}

async function applyUpdate(downloadUrl, version) {
  const body = document.getElementById('update-modal-body');
  const actions = document.getElementById('update-modal-actions');

  body.innerHTML = '<p>正在下載更新...</p><p class="text-sm text-muted">下載完成後服務會自動重啟，請稍候。</p>';
  actions.innerHTML = '';

  try {
    const result = await apiPost('/api/updater/apply', { downloadUrl, version });
    if (result.success) {
      body.innerHTML = `
        <p style="color:var(--success)">更新下載完成，服務即將重啟...</p>
        <p class="text-sm text-muted" style="margin-top:8px">頁面將在 10 秒後自動重新整理。</p>
      `;
      // Auto-refresh after service restarts
      setTimeout(() => { window.location.reload(); }, 10000);
    } else {
      body.innerHTML = `<p style="color:var(--danger)">更新失敗: ${result.error}</p>`;
      actions.innerHTML = '<button class="btn btn-outline" onclick="closeUpdateModal()">關閉</button>';
    }
  } catch (error) {
    // Connection lost means the server is restarting - this is expected
    body.innerHTML = `
      <p style="color:var(--success)">服務正在重啟中...</p>
      <p class="text-sm text-muted" style="margin-top:8px">頁面將在 10 秒後自動重新整理。</p>
    `;
    setTimeout(() => { window.location.reload(); }, 10000);
  }
}

function closeUpdateModal() {
  document.getElementById('update-modal').style.display = 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadHealth();
  loadPrinters();
  loadPaperSizes();
  loadWatcherStatus();
  loadJobs();
  setupDropZone();

  // Load version badge
  apiGet('/api/health').then((result) => {
    if (result.success) {
      document.getElementById('version-badge').textContent = 'v' + result.version;
    }
  }).catch(() => {});

  // Auto-refresh jobs every 10s
  setInterval(loadJobs, 10000);
  setInterval(loadWatcherStatus, 15000);
});
