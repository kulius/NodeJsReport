// Template Manager

let templates = [];
let editingId = null;

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

async function loadTemplates() {
  try {
    const res = await fetch('/api/templates');
    const result = await res.json();
    if (result.success) {
      templates = result.data;
      renderTemplates();
    }
  } catch (error) {
    showToast('載入範本失敗', 'error');
  }
}

async function loadPaperSizes() {
  try {
    const res = await fetch('/api/paper-sizes');
    const result = await res.json();
    if (result.success) {
      const select = document.getElementById('tmpl-paper-size');
      select.innerHTML = result.data.map((s) =>
        `<option value="${s.id}">${s.name} (${s.widthMm}x${s.heightMm}mm)</option>`
      ).join('');
    }
  } catch (error) {
    console.error('Failed to load paper sizes:', error);
  }
}

function renderTemplates() {
  const list = document.getElementById('template-list');

  if (templates.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>尚無範本。點擊「建立範本」開始。</p></div>';
    return;
  }

  list.innerHTML = templates.map((t) => `
    <div class="template-card">
      <div class="info">
        <h3>${t.name}</h3>
        <div class="meta">
          ID: ${t.id} | 紙張: ${t.paperSize} | 欄位: ${t.fields.length} 個
          ${t.backgroundPdf ? ' | 有背景 PDF' : ''}
          | 更新: ${new Date(t.updatedAt).toLocaleString('zh-TW')}
        </div>
      </div>
      <div class="actions">
        <a href="/overlay-designer.html?id=${t.id}" class="btn btn-outline btn-sm">設計</a>
        <button class="btn btn-outline btn-sm" onclick="editTemplate('${t.id}')">編輯</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTemplate('${t.id}')">刪除</button>
      </div>
    </div>
  `).join('');
}

function showCreateModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '建立範本';
  document.getElementById('tmpl-id').value = '';
  document.getElementById('tmpl-id').disabled = false;
  document.getElementById('tmpl-name').value = '';
  document.getElementById('tmpl-paper-size').value = 'A4';
  document.getElementById('tmpl-show-bg').checked = false;
  document.getElementById('modal-overlay').classList.add('active');
}

function editTemplate(id) {
  const tmpl = templates.find((t) => t.id === id);
  if (!tmpl) return;

  editingId = id;
  document.getElementById('modal-title').textContent = '編輯範本';
  document.getElementById('tmpl-id').value = tmpl.id;
  document.getElementById('tmpl-id').disabled = true;
  document.getElementById('tmpl-name').value = tmpl.name;
  document.getElementById('tmpl-paper-size').value = tmpl.paperSize;
  document.getElementById('tmpl-show-bg').checked = tmpl.showBackground;
  document.getElementById('modal-overlay').classList.add('active');
}

function hideModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) {
    hideModal();
  }
}

async function saveTemplate(e) {
  e.preventDefault();

  const data = {
    id: document.getElementById('tmpl-id').value,
    name: document.getElementById('tmpl-name').value,
    paperSize: document.getElementById('tmpl-paper-size').value,
    showBackground: document.getElementById('tmpl-show-bg').checked,
  };

  try {
    let res;
    if (editingId) {
      res = await fetch(`/api/templates/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }

    const result = await res.json();
    if (result.success) {
      showToast(editingId ? '範本已更新' : '範本已建立', 'success');
      hideModal();
      loadTemplates();
    } else {
      showToast(`儲存失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('儲存失敗', 'error');
  }
}

async function deleteTemplate(id) {
  if (!confirm(`確定要刪除範本 "${id}"？`)) return;

  try {
    const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast('範本已刪除', 'success');
      loadTemplates();
    } else {
      showToast(`刪除失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('刪除失敗', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadTemplates();
  loadPaperSizes();
});
