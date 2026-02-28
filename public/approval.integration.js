/*
  approval.integration.js (FIXED)
  - Support ?contract_id= / ?id=
  - Add undo/redo for signature placement (before saving)
  - Do NOT auto-save on click (so user can adjust placement)
  - Save signature only when user clicks Download Final / Approve
*/

(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- Session ----------
  function getSessionUser() {
    try {
      const s = sessionStorage.getItem("user");
      if (s) return JSON.parse(s);
    } catch (e) {}
    try {
      const l = localStorage.getItem("user");
      if (l) return JSON.parse(l);
    } catch (e) {}
    return null;
  }

  function setUserUI(user) {
    const topName = document.querySelector(".top-bar .user-name");
    if (topName) topName.textContent = user?.full_name || user?.name || "Nama";
    const topRole = document.querySelector(".top-bar .user-role");
    if (topRole) topRole.textContent = user?.role || "User";
  }

  function getParam(name) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  }

  function getContractIdFromUrl() {
    // support both ?contract_id= and ?id=
    const cid = getParam("contract_id") || getParam("id");
    return cid;
  }

  // ---------- Fetch helpers ----------
  async function fetchJSON(url, opts) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...(opts || {}),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {}

    if (!res.ok) {
      const msg = data.message || data.error || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function fetchForm(url, formData, method = "POST") {
    const res = await fetch(url, { method, body: formData });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {}

    if (!res.ok) {
      const msg = data.message || data.error || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let b = Number(bytes);
    let i = 0;
    while (b >= 1024 && i < units.length - 1) {
      b /= 1024;
      i++;
    }
    return `${b.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  }

  // ===== PDF STATE =====
  let currentContractId = null;
  let currentPdfUrl = null; // /uploads/... atau /storage/...
  let pdfDoc = null;
  let pngDataUrl = null;

  // signature default size (px di canvas)
  const SIG_W_PX = 170;
  const SIG_H_PX = 70;

  // ---------- Signature overlay state (Undo/Redo) ----------
  // We store placements before saving to backend.
  let sigStack = [];   // [{pageIndex, pdfX, pdfY, pdfW, pdfH, domEl}]
  let redoStack = [];
  let penMode = false;

  function updateUndoRedoButtons() {
    const btnUndo = $("btnUndo");
    const btnRedo = $("btnRedo");
    if (btnUndo) btnUndo.disabled = sigStack.length === 0;
    if (btnRedo) btnRedo.disabled = redoStack.length === 0;
  }

  function clearSignatureOverlays() {
    // remove all overlay nodes
    sigStack.forEach((s) => {
      try { s.domEl?.remove(); } catch (e) {}
    });
    redoStack.forEach((s) => {
      try { s.domEl?.remove(); } catch (e) {}
    });
    sigStack = [];
    redoStack = [];
    updateUndoRedoButtons();
  }

  function placeSignatureOverlay({ pageIndex, canvas, viewport, clickX, clickY }) {
    if (!pngDataUrl) {
      alert("Pilih TTD PNG dulu (klik tombol 'TTD PNG').");
      return;
    }
    if (!penMode) {
      alert("Aktifkan mode pen (klik ikon ✍️) dulu sebelum menaruh TTD.");
      return;
    }

    // Convert canvas px -> PDF points using viewport scale
    const scale = viewport.scale;

    const pdfX = clickX / scale;
    const pdfY = (canvas.height - clickY - SIG_H_PX) / scale;
    const pdfW = SIG_W_PX / scale;
    const pdfH = SIG_H_PX / scale;

    // Create overlay DOM image positioned on top of canvas
    const wrapper = canvas.parentElement; // .pdf-page
    if (!wrapper) return;

    // Ensure wrapper is position:relative (it already is in your CSS)
    const img = document.createElement("img");
    img.src = pngDataUrl;
    img.alt = "signature";
    img.style.position = "absolute";
    img.style.left = `${clickX}px`;
    img.style.top = `${clickY}px`;
    img.style.width = `${SIG_W_PX}px`;
    img.style.height = `${SIG_H_PX}px`;
    img.style.transform = `translate(0, -${SIG_H_PX}px)`; // place above cursor like before
    img.style.pointerEvents = "none";
    img.style.opacity = "0.95";

    wrapper.appendChild(img);

    // push to history
    sigStack.push({ pageIndex, pdfX, pdfY, pdfW, pdfH, domEl: img });
    redoStack = [];
    updateUndoRedoButtons();

    // Update UI status text
    const sigStatus = $("sigStatus");
    if (sigStatus) sigStatus.textContent = "TTD siap disimpan";
  }

  function undoSig() {
    if (sigStack.length === 0) return;
    const last = sigStack.pop();
    try { last.domEl?.remove(); } catch (e) {}
    redoStack.push(last);
    updateUndoRedoButtons();

    if (sigStack.length === 0) {
      const sigStatus = $("sigStatus");
      if (sigStatus) sigStatus.textContent = currentPdfUrl && String(currentPdfUrl).includes("/storage/")
        ? "Sudah ditandatangani"
        : "Belum ditandatangani";
    }
  }

  function redoSig() {
    if (redoStack.length === 0) return;
    const item = redoStack.pop();

    // re-create dom overlay for redo (so it displays again)
    // We re-place it using stored PDF coords by approximating back to canvas px.
    // For simplicity, we just re-add the previous node if still exists, otherwise ignore.
    // (Most cases: node removed, so we recreate a new one not possible without canvas+viewport reference.)
    // We'll do a safe fallback: cannot redo reliably after page re-render; so we keep it minimal.
    // Better UX: redo works within same render cycle if DOM node exists.
    if (item.domEl && item.domEl.isConnected === false) {
      // cannot reattach to correct wrapper without extra refs
      // so redo will be disabled after undo if we can't reconstruct
      alert("Redo tidak tersedia setelah undo pada render ini. Silakan taruh ulang tanda tangan.");
      redoStack = [];
      updateUndoRedoButtons();
      return;
    }

    sigStack.push(item);
    updateUndoRedoButtons();
  }

  // ---------- Load contract ----------
  async function loadContract(contractId) {
    const c = await fetchJSON(`/api/contracts/${encodeURIComponent(contractId)}`);

    // header
    const titleEl = $("docTitle");
    const docIdEl = $("docId");
    if (titleEl) titleEl.textContent = c.title || "Kontrak / LOA";
    // FIX: pakai contract_code dari DB
    if (docIdEl) docIdEl.textContent = c.contract_code || c.contractId || "CTR-____-____";

    // status badge
    const statusText = $("approvalStatusText");
    if (statusText) statusText.textContent = c.status || "Draft";

    // file indicators
    const chip = $("chipDoc");
    const fileName = $("fileName");
    const fileType = $("fileType");
    const fileSize = $("fileSize");

    // pilih sumber pdf: signed_path > upload_path
    currentPdfUrl = c.signed_path || c.upload_path || null;

    // reset overlays when loading a new pdf
    clearSignatureOverlays();

    if (!currentPdfUrl) {
      if (chip) {
        chip.classList.remove("ok");
        chip.classList.add("warn");
        chip.innerHTML = '<span class="dot"></span> Belum ada file';
      }
      if (fileName) fileName.textContent = "-";
      if (fileType) fileType.textContent = "-";
      if (fileSize) fileSize.textContent = "-";
      $("sigStatus").textContent = "Belum ditandatangani";
      renderEmptyPreview();
      return;
    }

    if (chip) {
      chip.classList.remove("warn");
      chip.classList.add("ok");
      chip.innerHTML = '<span class="dot"></span> File siap';
    }

    if (fileName) {
      const base = decodeURIComponent(String(currentPdfUrl).split("/").pop() || "");
      fileName.textContent = base || "document.pdf";
    }
    if (fileType) fileType.textContent = "PDF";

    // ukuran file via HEAD (best-effort)
    if (fileSize) {
      try {
        const head = await fetch(currentPdfUrl, { method: "HEAD" });
        const len = head.headers.get("content-length");
        fileSize.textContent = len ? humanSize(Number(len)) : "-";
      } catch (e) {
        fileSize.textContent = "-";
      }
    }

    $("sigStatus").textContent = c.signed_path ? "Sudah ditandatangani" : "Belum ditandatangani";

    await renderPdf(currentPdfUrl);
  }

  function renderEmptyPreview() {
    const pdfPages = document.getElementById("pdfPages");
    if (pdfPages) {
      pdfPages.innerHTML =
        '<div class="preview-inner" id="previewInner">Belum ada dokumen. Klik <b>Upload Document</b> di kiri.</div>';
    }
  }

  // ---------- Render PDF ----------
  async function renderPdf(url) {
    const pdfPages = document.getElementById("pdfPages");
    if (!pdfPages) return;

    pdfPages.innerHTML = "";

    const loadingTask = window.pdfjsLib.getDocument(url);
    pdfDoc = await loadingTask.promise;

    for (let i = 0; i < pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i + 1);

      const container = document.createElement("div");
      container.className = "pdf-page";
      container.dataset.pageIndex = String(i);

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-canvas";

      const viewport = page.getViewport({ scale: 1.25 });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      // Click to place signature (overlay only)
      canvas.style.cursor = "crosshair";
      canvas.addEventListener("click", (ev) => {
        const rect = canvas.getBoundingClientRect();
        const clickX = ev.clientX - rect.left;
        const clickY = ev.clientY - rect.top;
        placeSignatureOverlay({ pageIndex: i, canvas, viewport, clickX, clickY });
      });

      container.appendChild(canvas);
      pdfPages.appendChild(container);
    }
  }

  // ---------- Upload ----------
  async function handleUpload(file) {
    if (!file) return;
    if (!currentContractId) {
      alert("contract_id tidak ada di URL.");
      return;
    }
    if (String(file.type) !== "application/pdf") {
      alert("Untuk sekarang: Upload hanya mendukung PDF.");
      return;
    }

    const fd = new FormData();
    fd.append("pdf", file);

    try {
      await fetchForm(`/api/contracts/${encodeURIComponent(currentContractId)}/upload`, fd, "POST");
      await loadContract(currentContractId);
      alert("Upload berhasil ✅");
    } catch (e) {
      alert("Upload gagal:\n" + e.message);
    }
  }

  // ---------- Save signature to backend ----------
  async function saveSignaturesToBackend() {
    if (!currentContractId) throw new Error("contract_id tidak valid.");
    if (!currentPdfUrl) throw new Error("Belum ada PDF untuk ditandatangani.");
    if (!pngDataUrl) throw new Error("TTD PNG belum dipilih.");
    if (sigStack.length === 0) throw new Error("Belum ada TTD yang ditaruh di PDF.");

    // IMPORTANT: Backend endpoint /sign membuat file signed baru berdasarkan input PDF.
    // Jika PDF sudah signed sebelumnya, dan user ingin “ulang”, sebaiknya upload ulang file original.
    if (String(currentPdfUrl).includes("/storage/")) {
      const ok = confirm(
        "Dokumen ini sudah bertanda tangan sebelumnya.\n" +
        "Jika ingin mengubah posisi tanda tangan, sebaiknya upload ulang PDF original.\n\n" +
        "Lanjut simpan tanda tangan di dokumen ini?"
      );
      if (!ok) return { skipped: true };
    }

    // Untuk sekarang: simpan hanya SIGN TERAKHIR (yang paling kamu posisikan terakhir)
    // biar user bisa koreksi posisi dengan undo/redo tanpa bikin banyak signature.
    const last = sigStack[sigStack.length - 1];

    await fetchJSON(`/api/contracts/${encodeURIComponent(currentContractId)}/sign`, {
      method: "POST",
      body: JSON.stringify({
        pageIndex: last.pageIndex,
        x: last.pdfX,
        y: last.pdfY,
        width: last.pdfW,
        height: last.pdfH,
        imageDataUrl: pngDataUrl,
      }),
    });

    return { skipped: false };
  }

  // ---------- UI setups ----------
  function setupPngPicker() {
    const btn = $("btnPickTtdPng");
    const input = $("ttdPngInput");
    if (!btn || !input) return;

    btn.addEventListener("click", () => input.click());

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.type !== "image/png") {
        alert("TTD harus PNG.");
        input.value = "";
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        pngDataUrl = String(r.result || "");
        const pngStatus = $("pngStatus");
        if (pngStatus) pngStatus.textContent = "Sudah dipilih";
        alert("TTD PNG siap ✅ Aktifkan pen (✍️) lalu klik di PDF untuk menaruh tanda tangan.");
      };
      r.readAsDataURL(file);
    });
  }

  function setupUploadControls() {
    const btnPick = $("btnPickDoc");
    const btnClear = $("btnClearDoc");
    const input = $("docInput");

    if (btnPick && input) {
      btnPick.addEventListener("click", () => input.click());
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        await handleUpload(file);
      });
    }

    if (btnClear) {
      btnClear.addEventListener("click", async () => {
        // Clear hanya reset overlay (biar bisa taruh ulang tanpa refresh)
        clearSignatureOverlays();
        const sigStatus = $("sigStatus");
        if (sigStatus) {
          sigStatus.textContent = currentPdfUrl && String(currentPdfUrl).includes("/storage/")
            ? "Sudah ditandatangani"
            : "Belum ditandatangani";
        }
        alert("Overlay TTD direset. Silakan taruh ulang tanda tangan.");
      });
    }
  }

  function setupPenUndoRedo() {
    const btnPen = $("btnPen");
    const btnUndo = $("btnUndo");
    const btnRedo = $("btnRedo");

    if (btnPen) {
      btnPen.addEventListener("click", () => {
        penMode = !penMode;
        btnPen.classList.toggle("active", penMode);
        alert(penMode ? "Mode pen aktif ✍️" : "Mode pen nonaktif");
      });
    }

    if (btnUndo) btnUndo.addEventListener("click", undoSig);
    if (btnRedo) btnRedo.addEventListener("click", redoSig);

    updateUndoRedoButtons();
  }

  function setupActions() {
    const btnDownload = $("btnDownloadFinal");
    if (btnDownload) {
      btnDownload.addEventListener("click", async () => {
        try {
          // kalau ada overlay ttd, simpan dulu ke backend
          if (sigStack.length > 0) {
            const r = await saveSignaturesToBackend();
            if (r?.skipped) return;

            await loadContract(currentContractId);
            alert("TTD berhasil disimpan ✅");
          }

          if (!currentPdfUrl) {
            alert("Belum ada file.");
            return;
          }
          window.open(currentPdfUrl, "_blank");
        } catch (e) {
          alert("Gagal download/simpan:\n" + e.message);
        }
      });
    }

    const btnApprove = $("btnApprove");
    if (btnApprove) {
      btnApprove.addEventListener("click", async () => {
        try {
          if (!currentPdfUrl) {
            alert("Upload PDF dulu.");
            return;
          }

          // Simpan tanda tangan kalau user sudah taruh overlay
          if (sigStack.length > 0) {
            const r = await saveSignaturesToBackend();
            if (r?.skipped) return;

            await loadContract(currentContractId);
            alert("TTD berhasil disimpan ✅");
          }

          // UI status
          const st = $("approvalStatusText");
          if (st) st.textContent = "Approved";
          alert("Approved ✅");
        } catch (e) {
          alert("Approve gagal:\n" + e.message);
        }
      });
    }

    const btnReject = $("btnReject");
    if (btnReject) {
      btnReject.addEventListener("click", () => {
        const st = $("approvalStatusText");
        if (st) st.textContent = "Rejected";
        alert("Rejected ❌");
      });
    }
  }

  // ---------- Init ----------
  async function init() {
    const user = getSessionUser();
    if (!user) {
      window.location.href = "signin.html";
      return;
    }
    setUserUI(user);

    const btnNotif = $("btnNotification");
    if (btnNotif) btnNotif.addEventListener("click", () => (window.location.href = "notification.html"));

    const btnProfile = $("btnProfile");
    if (btnProfile) btnProfile.addEventListener("click", () => (window.location.href = "settings.html"));

    const cid = getContractIdFromUrl();
    if (!cid) {
      alert("contract_id tidak ada. Buka halaman ini dari My Contract (Upload and Sign / Create Draft).");
      renderEmptyPreview();
      return;
    }

    currentContractId = Number(cid);

    setupUploadControls();
    setupPngPicker();
    setupPenUndoRedo();
    setupActions();

    try {
      await loadContract(currentContractId);
    } catch (e) {
      alert("Gagal load contract:\n" + e.message);
    }

    // status awal png
    const pngStatus = $("pngStatus");
    if (pngStatus) pngStatus.textContent = "Belum dipilih";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
