// Overlay Designer - Visual field positioning tool

let currentTemplate = null;
let fields = [];
let selectedFieldIndex = -1;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let canvasScale = 1;
let bgPdfDoc = null;

const PTS_PER_MM = 72 / 25.4;

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

function ptToMm(pt) { return (pt / PTS_PER_MM).toFixed(1); }

// Load templates list
async function loadTemplateList() {
  try {
    const res = await fetch('/api/templates');
    const result = await res.json();
    if (result.success) {
      const select = document.getElementById('template-select');
      select.innerHTML = '<option value="">選擇範本...</option>' +
        result.data.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');

      // Auto-select from URL param
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      if (id) {
        select.value = id;
        loadSelectedTemplate();
      }
    }
  } catch (error) {
    showToast('載入範本失敗', 'error');
  }
}

async function loadSelectedTemplate() {
  const id = document.getElementById('template-select').value;
  if (!id) {
    currentTemplate = null;
    fields = [];
    renderAll();
    return;
  }

  try {
    const res = await fetch(`/api/templates/${id}`);
    const result = await res.json();
    if (result.success) {
      currentTemplate = result.data;
      fields = [...currentTemplate.fields];
      selectedFieldIndex = -1;

      // Load background if exists
      if (currentTemplate.backgroundPdf) {
        await loadBackgroundPdf(`/data/uploads/${currentTemplate.backgroundPdf}`);
      } else {
        drawBlankPage();
      }

      renderAll();
    }
  } catch (error) {
    showToast('載入範本失敗', 'error');
  }
}

// Load PDF.js
function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      resolve(window.pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function loadBackgroundPdf(url) {
  try {
    const pdfjsLib = await loadPdfJs();
    bgPdfDoc = await pdfjsLib.getDocument(url).promise;
    const page = await bgPdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });

    const canvas = document.getElementById('bg-canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvasScale = 1;

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (error) {
    console.error('Failed to load background PDF:', error);
    drawBlankPage();
  }
}

function drawBlankPage() {
  const canvas = document.getElementById('bg-canvas');
  // Default A4 at 72 DPI
  canvas.width = 595;
  canvas.height = 842;
  canvasScale = 1;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw margin guides
  ctx.strokeStyle = '#e0e0e0';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(40, 40, canvas.width - 80, canvas.height - 80);
  ctx.setLineDash([]);
}

// Render field markers on canvas
function renderAll() {
  renderFieldList();
  renderFieldMarkers();
  updatePropsPanel();
}

function renderFieldList() {
  const list = document.getElementById('field-list');
  if (fields.length === 0) {
    list.innerHTML = '<p class="text-sm text-muted">尚無欄位</p>';
    return;
  }

  list.innerHTML = fields.map((f, i) => `
    <div class="field-list-item ${i === selectedFieldIndex ? 'selected' : ''}"
         onclick="selectField(${i})">
      <span>${f.name} <span class="text-muted">(${f.type})</span></span>
      <span class="text-muted text-sm">${ptToMm(f.x)}, ${ptToMm(f.y)} mm</span>
    </div>
  `).join('');
}

function renderFieldMarkers() {
  // Remove existing markers
  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.querySelectorAll('.field-marker').forEach((m) => m.remove());

  const canvas = document.getElementById('bg-canvas');

  fields.forEach((field, index) => {
    const marker = document.createElement('div');
    marker.className = `field-marker ${index === selectedFieldIndex ? 'selected' : ''}`;

    // PDF coordinates: origin at bottom-left
    // Screen coordinates: origin at top-left
    const screenX = field.x * canvasScale;
    const screenY = (canvas.height - field.y) * canvasScale;

    marker.style.left = screenX + 'px';
    marker.style.top = screenY + 'px';
    marker.innerHTML = `<span class="label">${field.name}</span>`;
    marker.dataset.index = index;

    // Drag handling
    marker.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      selectField(index);
      isDragging = true;
      const rect = marker.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
    });

    wrapper.appendChild(marker);
  });
}

function selectField(index) {
  selectedFieldIndex = index;
  renderAll();
}

function updatePropsPanel() {
  const panel = document.getElementById('field-props');
  const coordDisplay = document.getElementById('coord-display');

  if (selectedFieldIndex < 0 || selectedFieldIndex >= fields.length) {
    panel.style.display = 'none';
    coordDisplay.innerHTML = '<strong>座標</strong><br/>滑鼠: - , -<br/>選取: - , -';
    return;
  }

  panel.style.display = 'block';
  const f = fields[selectedFieldIndex];

  document.getElementById('prop-name').value = f.name;
  document.getElementById('prop-type').value = f.type;
  document.getElementById('prop-x').value = f.x;
  document.getElementById('prop-y').value = f.y;
  document.getElementById('prop-fontSize').value = f.fontSize || 11;
  document.getElementById('prop-bold').checked = f.bold || false;
  document.getElementById('prop-letterSpacing').value = f.letterSpacing || 0;

  coordDisplay.innerHTML =
    `<strong>座標</strong><br/>` +
    `PDF: ${f.x.toFixed(1)} pt, ${f.y.toFixed(1)} pt<br/>` +
    `mm: ${ptToMm(f.x)} mm, ${ptToMm(f.y)} mm`;
}

function updateSelectedProp(prop, value) {
  if (selectedFieldIndex < 0) return;

  fields = fields.map((f, i) => {
    if (i !== selectedFieldIndex) return f;
    return { ...f, [prop]: value };
  });

  renderAll();
}

function addField() {
  if (!currentTemplate) {
    showToast('請先選擇範本', 'error');
    return;
  }

  const name = prompt('欄位名稱 (例如: invoice_number)');
  if (!name) return;

  const newField = {
    name,
    type: 'text',
    x: 100,
    y: 400,
    fontSize: 11,
    bold: false,
  };

  fields = [...fields, newField];
  selectedFieldIndex = fields.length - 1;
  renderAll();
}

function deleteSelectedField() {
  if (selectedFieldIndex < 0) return;
  fields = fields.filter((_, i) => i !== selectedFieldIndex);
  selectedFieldIndex = -1;
  renderAll();
}

async function saveFields() {
  if (!currentTemplate) {
    showToast('請先選擇範本', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/templates/${currentTemplate.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const result = await res.json();
    if (result.success) {
      showToast('欄位已儲存', 'success');
    } else {
      showToast(`儲存失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('儲存失敗', 'error');
  }
}

function uploadBackground() {
  if (!currentTemplate) {
    showToast('請先選擇範本', 'error');
    return;
  }
  document.getElementById('bg-file-input').click();
}

async function handleBgUpload(file) {
  if (!currentTemplate) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`/api/templates/${currentTemplate.id}/background`, {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();
    if (result.success) {
      showToast('背景 PDF 已上傳', 'success');
      loadSelectedTemplate();
    } else {
      showToast(`上傳失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('上傳失敗', 'error');
  }
}

async function testPreview() {
  if (!currentTemplate) {
    showToast('請先選擇範本', 'error');
    return;
  }

  // Generate test data from field names
  const testData = {};
  for (const field of fields) {
    if (field.type === 'text') {
      testData[field.name] = `[${field.name}]`;
    } else if (field.type === 'table') {
      testData[field.name] = [
        { name: '測試品項 1', qty: '10' },
        { name: '測試品項 2', qty: '20' },
      ];
    }
  }

  try {
    const res = await fetch('/api/overlay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: currentTemplate.id,
        data: testData,
        action: 'preview',
        showBackground: true,
      }),
    });
    const result = await res.json();
    if (result.success) {
      window.open(`/preview.html?id=${result.previewId}`, '_blank');
    } else {
      showToast(`預覽失敗: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast('預覽失敗', 'error');
  }
}

// Mouse events for drag & canvas click
document.addEventListener('DOMContentLoaded', () => {
  loadTemplateList();

  const canvasArea = document.getElementById('canvas-area');
  const canvas = document.getElementById('bg-canvas');
  const wrapper = document.getElementById('canvas-wrapper');

  // Click on canvas to place selected field
  canvas.addEventListener('click', (e) => {
    if (selectedFieldIndex < 0) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to PDF coordinates (origin bottom-left)
    const pdfX = screenX / canvasScale;
    const pdfY = (canvas.height - screenY) / canvasScale;

    fields = fields.map((f, i) => {
      if (i !== selectedFieldIndex) return f;
      return { ...f, x: Math.round(pdfX * 2) / 2, y: Math.round(pdfY * 2) / 2 };
    });

    renderAll();
  });

  // Mouse move for dragging
  document.addEventListener('mousemove', (e) => {
    if (!isDragging || selectedFieldIndex < 0) return;

    const rect = wrapper.getBoundingClientRect();
    const screenX = e.clientX - rect.left - dragOffsetX;
    const screenY = e.clientY - rect.top - dragOffsetY;

    const pdfX = screenX / canvasScale;
    const pdfY = (canvas.height - screenY) / canvasScale;

    fields = fields.map((f, i) => {
      if (i !== selectedFieldIndex) return f;
      return { ...f, x: Math.round(pdfX * 2) / 2, y: Math.round(pdfY * 2) / 2 };
    });

    renderAll();
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Mouse position display
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const pdfX = screenX / canvasScale;
    const pdfY = (canvas.height - screenY) / canvasScale;

    const sel = selectedFieldIndex >= 0 ? fields[selectedFieldIndex] : null;
    const coordDisplay = document.getElementById('coord-display');
    coordDisplay.innerHTML =
      `<strong>座標</strong><br/>` +
      `滑鼠: ${ptToMm(pdfX)} mm, ${ptToMm(pdfY)} mm<br/>` +
      (sel ? `選取: ${ptToMm(sel.x)} mm, ${ptToMm(sel.y)} mm` : '選取: - , -');
  });

  // Keyboard: arrow keys for fine adjustment
  document.addEventListener('keydown', (e) => {
    if (selectedFieldIndex < 0) return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') return;

    const step = e.shiftKey ? 5 : 0.5; // Shift = 5pt, normal = 0.5pt

    let dx = 0, dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = step;    // Up = increase Y (PDF coords)
    else if (e.key === 'ArrowDown') dy = -step;
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelectedField();
      return;
    }
    else return;

    e.preventDefault();

    fields = fields.map((f, i) => {
      if (i !== selectedFieldIndex) return f;
      return { ...f, x: f.x + dx, y: f.y + dy };
    });

    renderAll();
  });

  // Background file upload
  document.getElementById('bg-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleBgUpload(file);
  });

  drawBlankPage();
});
