// Elements
const uploadForm = document.getElementById('uploadForm');
const pdfFile = document.getElementById('pdfFile');
const uploadStatus = document.getElementById('uploadStatus');
const pdfCanvas = document.getElementById('pdfCanvas');
const sigCanvas = document.getElementById('sigCanvas');
const pageIndexInput = document.getElementById('pageIndex');
const clearSigBtn = document.getElementById('clearSig');
const placeBtn = document.getElementById('placeBtn');
const downloadLink = document.getElementById('downloadLink');

const penWidth = document.getElementById('penWidth');
const penColor = document.getElementById('penColor');
const toggleDraw = document.getElementById('toggleDraw');
const eraseAll = document.getElementById('eraseAll');
const sigImage = document.getElementById('sigImage');
const addSigImageBtn = document.getElementById('addSigImageBtn');

const textContent = document.getElementById('textContent');
const textSize = document.getElementById('textSize');
const textColor = document.getElementById('textColor');
const addTextBtn = document.getElementById('addTextBtn');

const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');

let currentPdfUrl = null;
let currentFilename = null;
let pdfDoc = null;
let fabricCanvas = null;
let currentScale = 1.5;

// PDF.js worker
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.js';
} catch {}

// Fabric overlay
function initFabric() {
  fabricCanvas = new fabric.Canvas('sigCanvas', {
    isDrawingMode: true,
    backgroundColor: 'rgba(0,0,0,0)'
  });
  if (penWidth) fabricCanvas.freeDrawingBrush.width = Number(penWidth.value || 3);
  if (penColor) fabricCanvas.freeDrawingBrush.color = penColor.value || '#000000';
}

function syncOverlayToPdf() {
  if (!fabricCanvas) return;
  const w = pdfCanvas.width, h = pdfCanvas.height;
  if (!w || !h) return;
  if (sigCanvas.width !== w) sigCanvas.width = w;
  if (sigCanvas.height !== h) sigCanvas.height = h;
  fabricCanvas.setWidth(w);
  fabricCanvas.setHeight(h);
  fabricCanvas.renderAll();
}

async function renderPage(num) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const viewport = page.getViewport({ scale: currentScale });
  const ctx = pdfCanvas.getContext('2d');
  pdfCanvas.width = Math.floor(viewport.width);
  pdfCanvas.height = Math.floor(viewport.height);
  ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  syncOverlayToPdf();
}

function getDrawnBounds() {
  const objs = fabricCanvas.getObjects();
  if (!objs || objs.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  objs.forEach(o => {
    const r = o.getBoundingRect(true, true);
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.left + r.width);
    maxY = Math.max(maxY, r.top + r.height);
  });
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

async function loadRecent() {
  try {
    const ul = document.getElementById('recentList');
    if (!ul) return;
    const res = await fetch('/api/pdf/list');
    const data = await res.json();
    ul.innerHTML = '';
    const files = (data.files || []).slice().reverse().slice(0, 8);
    if (files.length === 0) {
      ul.innerHTML = '<li class="muted">No files</li>';
      return;
    }
    for (const f of files) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/uploads/${encodeURIComponent(f)}`;
      a.target = '_blank';
      a.textContent = f;
      li.appendChild(a);
      ul.appendChild(li);
    }
  } catch {}
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  initFabric();
  loadRecent();

  // Upload
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pdfFile.files[0]) { alert('Choose a PDF'); return; }
    const fd = new FormData();
    fd.append('pdf', pdfFile.files[0]);
    uploadStatus.textContent = 'Uploading...';
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { uploadStatus.textContent = data?.error || 'Upload failed'; return; }
      currentFilename = data.filename;
      currentPdfUrl = data.path;
      uploadStatus.textContent = 'Uploaded ✔';

      const task = pdfjsLib.getDocument({ url: currentPdfUrl });
      pdfDoc = await task.promise;
      pageIndexInput.max = pdfDoc.numPages;
      pageIndexInput.value = 1;
      fabricCanvas.clear();
      fabricCanvas.isDrawingMode = true;
      await renderPage(1);
      loadRecent();
    } catch {
      uploadStatus.textContent = 'Upload/preview failed';
    }
  });

  // page change
  pageIndexInput.addEventListener('change', async () => {
    if (!pdfDoc) return;
    let v = parseInt(pageIndexInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > pdfDoc.numPages) v = pdfDoc.numPages;
    pageIndexInput.value = v;
    await renderPage(v);
  });

  // clear canvas
  clearSigBtn.addEventListener('click', () => {
    fabricCanvas.clear();
    fabricCanvas.isDrawingMode = true;
  });

  // pen settings
  penWidth?.addEventListener('input', () => {
    if (fabricCanvas?.freeDrawingBrush) fabricCanvas.freeDrawingBrush.width = Number(penWidth.value || 3);
  });
  penColor?.addEventListener('input', () => {
    if (fabricCanvas?.freeDrawingBrush) fabricCanvas.freeDrawingBrush.color = penColor.value || '#000000';
  });
  toggleDraw?.addEventListener('click', () => {
    fabricCanvas.isDrawingMode = !fabricCanvas.isDrawingMode;
    toggleDraw.textContent = fabricCanvas.isDrawingMode ? 'Toggle Draw/Move' : 'Back to Draw';
  });
  eraseAll?.addEventListener('click', () => {
    fabricCanvas.clear();
    fabricCanvas.isDrawingMode = true;
  });

  // add signature image
  addSigImageBtn?.addEventListener('click', () => {
    const file = sigImage?.files?.[0];
    if (!file) { alert('Pick signature image'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      fabric.Image.fromURL(reader.result, (img) => {
        const w = sigCanvas.width || 600;
        const s = Math.min(1, (w * 0.4) / (img.width || 1));
        img.set({ left: 60, top: 60, scaleX: s, scaleY: s, selectable: true });
        fabricCanvas.add(img);
        fabricCanvas.setActiveObject(img);
        fabricCanvas.isDrawingMode = false;
        fabricCanvas.requestRenderAll();
      }, { crossOrigin: 'anonymous' });
    };
    reader.readAsDataURL(file);
  });

  // add text
  addTextBtn?.addEventListener('click', () => {
    const content = (textContent?.value || '').trim();
    if (!content) { alert('Enter text'); return; }
    const size = Math.max(10, Math.min(72, parseInt(textSize?.value || '18', 10) || 18));
    const color = textColor?.value || '#000000';
    const tb = new fabric.Textbox(content, {
      left: 60, top: 60, fontSize: size, fill: color, editable: true,
      fontFamily: 'Inter, Segoe UI, Roboto, Arial, sans-serif',
      borderColor: '#5aa8ff', cornerColor: '#5aa8ff', transparentCorners: false, padding: 4
    });
    fabricCanvas.add(tb);
    fabricCanvas.setActiveObject(tb);
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.requestRenderAll();
  });

  // delete selected
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const obj = fabricCanvas.getActiveObject();
      if (obj) {
        fabricCanvas.remove(obj);
        fabricCanvas.requestRenderAll();
        e.preventDefault();
      }
    }
  });

  // place & save
  placeBtn.addEventListener('click', async () => {
    if (!currentFilename) { alert('Upload a PDF first'); return; }
    const objs = fabricCanvas.getObjects();
    if (!objs || objs.length === 0) { alert('Add strokes/text/image first'); return; }

    const b = getDrawnBounds();
    const dataUrl = fabricCanvas.toDataURL({
      format: 'png',
      left: b.left, top: b.top,
      width: b.width, height: b.height,
      multiplier: 2
    });

    const pageHeight = sigCanvas.height;
    const pdfY = pageHeight - b.top - b.height;

    const payload = {
      filename: currentFilename,
      pageIndex: (parseInt(pageIndexInput.value, 10) || 1) - 1,
      x: Math.round(b.left),
      y: Math.round(pdfY),
      width: Math.round(b.width),
      height: Math.round(b.height),
      imageDataUrl: dataUrl
    };

    try {
      const res = await fetch('/api/pdf/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) { alert(data?.error || 'Failed to sign'); return; }
      downloadLink.classList.remove('hidden');
      downloadLink.href = data.output;
      downloadLink.textContent = 'Download Signed';
    } catch {
      alert('Failed to sign');
    }
  });

  // ping
  pingBtn?.addEventListener('click', async () => {
    pingResult.textContent = 'Checking...';
    try {
      const r = await fetch('/api/health');
      const j = await r.json();
      pingResult.textContent = j?.ok ? '✅ Server OK' : '⚠️ Not OK';
    } catch {
      pingResult.textContent = '❌ Cannot reach server';
    }
  });

  window.addEventListener('resize', syncOverlayToPdf);
});
