// PDF Preview using PDF.js (loaded from CDN)

let pdfDoc = null;
let currentPage = 1;
let scale = 1.5;
let pdfUrl = '';

const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');

// Get preview ID from URL
function getPreviewId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// Load PDF.js from CDN
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

// Render a page
async function renderPage(num) {
  if (!pdfDoc) return;

  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  document.getElementById('page-info').textContent =
    `第 ${num} / ${pdfDoc.numPages} 頁`;
  document.getElementById('zoom-info').textContent =
    `${Math.round(scale * 100)}%`;
}

function prevPage() {
  if (currentPage <= 1) return;
  currentPage--;
  renderPage(currentPage);
}

function nextPage() {
  if (!pdfDoc || currentPage >= pdfDoc.numPages) return;
  currentPage++;
  renderPage(currentPage);
}

function zoomIn() {
  scale = Math.min(scale + 0.25, 4);
  renderPage(currentPage);
}

function zoomOut() {
  scale = Math.max(scale - 0.25, 0.5);
  renderPage(currentPage);
}

async function printPdf() {
  if (!pdfUrl) return;

  try {
    // Get preview PDF as base64
    const res = await fetch(pdfUrl);
    const blob = await res.blob();
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const printRes = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf: base64 }),
      });
      const result = await printRes.json();
      if (result.success) {
        alert('已送出列印');
      } else {
        alert('列印失敗: ' + result.error);
      }
    };
    reader.readAsDataURL(blob);
  } catch (error) {
    alert('列印失敗');
  }
}

function downloadPdf() {
  if (!pdfUrl) return;
  const a = document.createElement('a');
  a.href = pdfUrl;
  a.download = 'report.pdf';
  a.click();
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const previewId = getPreviewId();
  if (!previewId) {
    document.querySelector('.preview-body').innerHTML =
      '<div class="empty-state"><p>未指定預覽 ID。請從儀表板產生預覽。</p></div>';
    return;
  }

  pdfUrl = `/api/preview/${previewId}`;

  try {
    const pdfjsLib = await loadPdfJs();
    pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise;
    renderPage(1);
  } catch (error) {
    document.querySelector('.preview-body').innerHTML =
      '<div class="empty-state"><p>無法載入 PDF。預覽可能已過期。</p></div>';
  }
});
