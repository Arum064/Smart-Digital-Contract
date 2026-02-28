require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const serveIndex = require("serve-index");
const { PDFDocument } = require("pdf-lib");
const bcrypt = require("bcryptjs");

const pool = require("./db");

const app = express();

// =========================
// CONFIG
// =========================
const PORT = Number(process.env.PORT || 5000);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, "uploads");
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, "storage");
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 25);

// =========================
// MIDDLEWARE
// =========================
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

for (const p of [UPLOADS_DIR, STORAGE_DIR]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ✅ parse multipart/form-data tanpa file (buat create/update contract dari FormData)
const multipartNone = multer().none();

// =========================
// STATIC
// =========================
const PUBLIC_DIR = path.join(__dirname, "public");
app.use("/public", express.static(PUBLIC_DIR));
app.use("/", express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOADS_DIR), serveIndex(UPLOADS_DIR, { icons: true }));
app.use("/storage", express.static(STORAGE_DIR), serveIndex(STORAGE_DIR, { icons: true }));

// =========================
// HELPERS
// =========================
function safeUnlink(absPath) {
  try {
    if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (e) {
    console.warn("Failed delete file:", absPath, e.message);
  }
}
function absUploadFromPublic(publicPath) {
  const filename = decodeURIComponent(String(publicPath || "").replace("/uploads/", ""));
  return path.join(UPLOADS_DIR, path.basename(filename));
}
function absStorageFromPublic(publicPath) {
  const filename = decodeURIComponent(String(publicPath || "").replace("/storage/", ""));
  return path.join(STORAGE_DIR, path.basename(filename));
}

// ambil sumber PDF terbaik untuk sebuah kontrak:
// 1) kalau ada signed_path -> pakai itu (hasil ttd owner)
// 2) kalau belum -> pakai upload_path
async function getContractPdfSourceAbs(contractId) {
  const [rows] = await pool.query(
    "SELECT upload_path, signed_path FROM contract_files WHERE contract_id = ? LIMIT 1",
    [contractId]
  );
  if (!rows.length) return null;
  const { signed_path, upload_path } = rows[0];
  if (signed_path) return absStorageFromPublic(signed_path);
  if (upload_path) return absUploadFromPublic(upload_path);
  return null;
}

function normalizeStatus(input) {
  const s = String(input || "").trim().toLowerCase();
  if (s === "pending approval" || s === "pending_approval") return "pending_approval";
  if (s === "in progress" || s === "in_progress") return "in_progress";
  if (s === "expiring soon" || s === "expiring_soon") return "expiring_soon";
  if (s === "active contract" || s === "active_contract") return "active_contract";
  if (s === "draft") return "draft";
  return "draft";
}

function statusLabel(enumVal) {
  const v = String(enumVal || "").toLowerCase();
  if (v === "pending_approval") return "Pending Approval";
  if (v === "in_progress") return "In Progress";
  if (v === "expiring_soon") return "Expiring Soon";
  if (v === "active_contract") return "Active Contract";
  if (v === "draft") return "Draft";
  return enumVal || "";
}

function mapContractRow(r) {
  return {
    id: r.id,
    title: r.title ?? "",
    vendor: r.vendor ?? "",
    contractId: r.contract_code ?? "",
    status: statusLabel(r.status),
    upload_path: r.upload_path ?? null,
    signed_path: r.signed_path ?? null,
    owner_id: r.owner_id ?? null, // opsional (buat debug)
  };
}

// ambil field dari body dengan beberapa kemungkinan nama
function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") return obj[k];
  }
  return undefined;
}

// response error mysql biar jelas
function handleMysqlError(res, err, fallbackMsg = "Server error") {
  const code = err && err.code ? err.code : "";
  if (code === "ER_DUP_ENTRY") {
    return res.status(409).json({ message: "Data sudah ada (duplicate).", error: err.message, code });
  }
  if (code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(400).json({
      message: "owner_id tidak valid (user belum ada di tabel users).",
      error: err.message,
      code,
    });
  }
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") {
    return res.status(500).json({
      message: "Struktur tabel/kolom di MySQL tidak sesuai.",
      error: err.message,
      code,
    });
  }
  return res.status(500).json({ message: fallbackMsg, error: err.message, code });
}

// =========================
// API ROUTES
// =========================
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ message: "DB connected ✅", rows });
  } catch (err) {
    console.error("DB TEST ERROR:", err);
    res.status(500).json({ message: "DB error", error: err.message, code: err.code });
  }
});

// =========================
// PDF UPLOAD + SIGN
// =========================
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/[^\w\-.]+/g, "_")}`),
  }),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  },
});

app.post("/api/upload", (req, res) => {
  upload.single("pdf")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: `File terlalu besar. Max ${MAX_FILE_SIZE_MB}MB.` });
      }
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    return res.json({
      filename: req.file.filename,
      path: `/uploads/${encodeURIComponent(req.file.filename)}`,
    });
  });
});

app.get("/api/pdf/list", (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    res.json({ files });
  } catch (e) {
    console.error("PDF LIST ERROR:", e);
    res.status(500).json({ error: "Failed to list files" });
  }
});

app.post("/api/pdf/sign", async (req, res) => {
  try {
    const { filename, pageIndex, x, y, width, height, imageDataUrl } = req.body || {};
    if (!filename || typeof pageIndex !== "number" || !imageDataUrl) {
      return res.status(400).json({ error: "Bad payload" });
    }

    const src = path.join(UPLOADS_DIR, path.basename(filename));
    if (!fs.existsSync(src)) return res.status(404).json({ error: "Source PDF not found" });

    const bytes = fs.readFileSync(src);
    const pdfDoc = await PDFDocument.load(bytes);
    const pages = pdfDoc.getPages();
    const page = pages[pageIndex] || pages[0];

    const m = String(imageDataUrl).match(/^data:(image\/(png|jpeg));base64,(.*)$/i);
    if (!m) return res.status(400).json({ error: "Unsupported image format" });

    const imgBuf = Buffer.from(m[3], "base64");
    const embed =
      m[1].toLowerCase() === "image/png" ? await pdfDoc.embedPng(imgBuf) : await pdfDoc.embedJpg(imgBuf);

    page.drawImage(embed, {
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    });

    const out = await pdfDoc.save();
    const outName = path.basename(filename, path.extname(filename)) + `-signed-${Date.now()}.pdf`;
    const outPath = path.join(STORAGE_DIR, outName);
    fs.writeFileSync(outPath, out);

    res.json({ ok: true, output: `/storage/${encodeURIComponent(outName)}` });
  } catch (e) {
    console.error("PDF SIGN ERROR:", e);
    res.status(500).json({ error: "Failed to save signed PDF", detail: e.message });
  }
});

// =========================
// AUTH
// =========================
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { full_name, email, password } = req.body || {};
    if (!full_name || !email || !password) {
      return res.status(400).json({ message: "full_name, email, password wajib diisi." });
    }

    const [existing] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email.trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "Email sudah terdaftar." });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      "INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)",
      [full_name.trim(), email.trim(), password_hash]
    );

    res.status(201).json({
      message: "Signup berhasil ✅",
      user: { id: result.insertId, full_name: full_name.trim(), email: email.trim(), role: "user" },
    });
  } catch (err) {
    console.error("SIGNUP ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

app.post("/api/auth/signin", async (req, res) => {
  try {
    const { email, full_name, password } = req.body || {};
    const identifier = (email || full_name || "").trim();

    if (!identifier || !password) {
      return res.status(400).json({ message: "Email/Nama dan password wajib diisi." });
    }

    const [rows] = await pool.query(
      "SELECT id, full_name, email, password_hash, role FROM users WHERE email = ? OR full_name = ? LIMIT 1",
      [identifier, identifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: "Akun belum terdaftar. Silakan Sign Up terlebih dahulu." });
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Password salah." });
    }

    res.json({
      message: "Login berhasil ✅",
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("SIGNIN ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// =========================
// CONTRACT CRUD + FILES
// =========================

// ✅ LIST contracts (bisa filter per user)
// GET /api/contracts?owner_id=123
app.get("/api/contracts", async (req, res) => {
  try {
    const ownerId = req.query.owner_id ? Number(req.query.owner_id) : null;

    const sqlBase = `
      SELECT 
        c.id, c.owner_id, c.contract_code, c.title, c.vendor, c.status,
        cf.upload_path, cf.signed_path
      FROM contracts c
      LEFT JOIN contract_files cf ON cf.contract_id = c.id
    `;

    const sql = ownerId
      ? (sqlBase + " WHERE c.owner_id = ? ORDER BY c.id DESC")
      : (sqlBase + " ORDER BY c.id DESC");

    const [rows] = ownerId
      ? await pool.query(sql, [ownerId])
      : await pool.query(sql);

    return res.json(rows.map(mapContractRow));
  } catch (err) {
    console.error("GET CONTRACTS ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// GET /api/contracts/:id
// Dipakai halaman approval untuk ambil detail + path file.
app.get("/api/contracts/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid contract id" });

    const [rows] = await pool.query(
      `
      SELECT 
        c.id, c.owner_id, c.contract_code, c.title, c.vendor, c.status,
        cf.upload_path, cf.signed_path
      FROM contracts c
      LEFT JOIN contract_files cf ON cf.contract_id = c.id
      WHERE c.id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: "Contract tidak ditemukan." });
    return res.json(mapContractRow(rows[0]));
  } catch (err) {
    console.error("GET CONTRACT BY ID ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// ✅ CREATE contract (support JSON & FormData)
// owner_id WAJIB, tidak boleh default 1 lagi
app.post("/api/contracts", multipartNone, async (req, res) => {
  try {
    const body = req.body || {};

    const title = pick(body, ["title", "contract_title"]);
    const vendor = pick(body, ["vendor", "vendor_name"]);
    const contractId = pick(body, ["contractId", "contract_id", "contract_code"]);
    const status = pick(body, ["status"]);
    const owner_id = pick(body, ["owner_id", "ownerId", "user_id"]);

    if (!title || !vendor || !contractId) {
      return res.status(400).json({ message: "title, vendor, contractId wajib diisi." });
    }

    const ownerId = Number(owner_id);
    if (!ownerId || Number.isNaN(ownerId)) {
      return res.status(400).json({ message: "owner_id wajib. (User belum login / tidak dikirim)" });
    }

    const t = String(title).trim();
    const v = String(vendor).trim();
    const code = String(contractId).trim();
    const st = normalizeStatus(status);

    const [result] = await pool.query(
      "INSERT INTO contracts (owner_id, contract_code, title, vendor, status) VALUES (?, ?, ?, ?, ?)",
      [ownerId, code, t, v, st]
    );

    return res.status(201).json({
      id: result.insertId,
      title: t,
      vendor: v,
      contractId: code,
      status: statusLabel(st),
      owner_id: ownerId,
    });
  } catch (err) {
    console.error("CREATE CONTRACT ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// ✅ UPDATE contract (support JSON & FormData)
app.put("/api/contracts/:id", multipartNone, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};

    if (!id) return res.status(400).json({ message: "Invalid contract id" });

    const title = pick(body, ["title", "contract_title"]);
    const vendor = pick(body, ["vendor", "vendor_name"]);
    const contractId = pick(body, ["contractId", "contract_id", "contract_code"]);
    const status = pick(body, ["status"]);

    const t = String(title || "").trim();
    const v = String(vendor || "").trim();
    const code = String(contractId || "").trim();
    const st = normalizeStatus(status);

    await pool.query(
      "UPDATE contracts SET title=?, vendor=?, contract_code=?, status=? WHERE id=?",
      [t, v, code, st, id]
    );

    const [rows] = await pool.query(
      `
      SELECT 
        c.id, c.owner_id, c.contract_code, c.title, c.vendor, c.status,
        cf.upload_path, cf.signed_path
      FROM contracts c
      LEFT JOIN contract_files cf ON cf.contract_id = c.id
      WHERE c.id = ? LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: "Contract tidak ditemukan." });

    return res.json(mapContractRow(rows[0]));
  } catch (err) {
    console.error("UPDATE CONTRACT ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// DELETE contract + hapus file
app.delete("/api/contracts/:id", async (req, res) => {
  try {
    const contractId = Number(req.params.id);

    const [files] = await pool.query(
      "SELECT upload_path, signed_path FROM contract_files WHERE contract_id = ? LIMIT 1",
      [contractId]
    );

    if (files.length) {
      if (files[0].upload_path) safeUnlink(absUploadFromPublic(files[0].upload_path));
      if (files[0].signed_path) safeUnlink(absStorageFromPublic(files[0].signed_path));
    }

    try {
      await pool.query("DELETE FROM contract_files WHERE contract_id = ?", [contractId]);
    } catch (e) {}

    const [result] = await pool.query("DELETE FROM contracts WHERE id = ?", [contractId]);
    if (result.affectedRows === 0) return res.status(404).json({ message: "Contract tidak ditemukan." });

    res.json({ message: "Contract berhasil dihapus ✅" });
  } catch (err) {
    console.error("DELETE CONTRACT ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// UPLOAD PDF untuk contract
app.post("/api/contracts/:id/upload", (req, res) => {
  upload.single("pdf")(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ message: `File terlalu besar. Max ${MAX_FILE_SIZE_MB}MB.` });
        }
        return res.status(400).json({ message: "Upload error", error: err.message });
      }

      const contractId = Number(req.params.id);
      if (!req.file) return res.status(400).json({ message: "File PDF wajib." });

      const [c] = await pool.query("SELECT id FROM contracts WHERE id = ? LIMIT 1", [contractId]);
      if (!c.length) return res.status(404).json({ message: "Contract tidak ditemukan." });

      const upload_path = `/uploads/${encodeURIComponent(req.file.filename)}`;

      const [exist] = await pool.query(
        "SELECT id, upload_path FROM contract_files WHERE contract_id = ? LIMIT 1",
        [contractId]
      );

      if (exist.length) {
        if (exist[0].upload_path) safeUnlink(absUploadFromPublic(exist[0].upload_path));
        await pool.query("UPDATE contract_files SET upload_path = ? WHERE contract_id = ?", [upload_path, contractId]);
      } else {
        await pool.query("INSERT INTO contract_files (contract_id, upload_path) VALUES (?, ?)", [contractId, upload_path]);
      }

      await pool.query("UPDATE contracts SET status = ? WHERE id = ?", ["in_progress", contractId]);

      res.json({ message: "Upload berhasil ✅", upload_path });
    } catch (e) {
      console.error("UPLOAD CONTRACT PDF ERROR:", e);
      return handleMysqlError(res, e, "Server error");
    }
  });
});

// SIGN PDF untuk contract
app.post("/api/contracts/:id/sign", async (req, res) => {
  try {
    const contractId = Number(req.params.id);
    const { pageIndex, x, y, width, height, imageDataUrl } = req.body || {};

    if (typeof pageIndex !== "number" || !imageDataUrl) {
      return res.status(400).json({ message: "Payload tidak lengkap." });
    }

    const [rows] = await pool.query(
      "SELECT upload_path, signed_path FROM contract_files WHERE contract_id = ? LIMIT 1",
      [contractId]
    );

    if (!rows.length || !rows[0].upload_path) {
      return res.status(404).json({ message: "PDF belum diupload untuk contract ini." });
    }

    const srcAbs = absUploadFromPublic(rows[0].upload_path);
    if (!fs.existsSync(srcAbs)) return res.status(404).json({ message: "File PDF sumber tidak ditemukan." });

    const pdfBytes = fs.readFileSync(srcAbs);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const page = pages[pageIndex] || pages[0];

    const m = String(imageDataUrl).match(/^data:(image\/(png|jpeg));base64,(.*)$/i);
    if (!m) return res.status(400).json({ message: "Format imageDataUrl harus PNG/JPEG base64." });

    const imgBuf = Buffer.from(m[3], "base64");
    const embed =
      m[1].toLowerCase() === "image/png" ? await pdfDoc.embedPng(imgBuf) : await pdfDoc.embedJpg(imgBuf);

    page.drawImage(embed, {
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    });

    const outBytes = await pdfDoc.save();
    const outName = `contract-${contractId}-signed-${Date.now()}.pdf`;
    const outAbs = path.join(STORAGE_DIR, outName);
    fs.writeFileSync(outAbs, outBytes);

    const signed_path = `/storage/${encodeURIComponent(outName)}`;

    if (rows[0].signed_path) safeUnlink(absStorageFromPublic(rows[0].signed_path));

    await pool.query("UPDATE contract_files SET signed_path = ? WHERE contract_id = ?", [signed_path, contractId]);
    await pool.query("UPDATE contracts SET status = ? WHERE id = ?", ["active_contract", contractId]);

    res.json({ message: "TTD berhasil ✅", signed_path });
  } catch (err) {
    console.error("SIGN CONTRACT ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// =========================
// APPROVAL FLOW
// =========================
// Catatan: karena front-end project ini masih simple (tanpa JWT),
// semua endpoint approval memakai parameter approver_id atau contract_id.

// 1) Buat request approval untuk contract
// POST /api/contracts/:id/request-approval  { approver_id }
app.post("/api/contracts/:id/request-approval", async (req, res) => {
  try {
    const contractId = Number(req.params.id);
    const approverId = Number(req.body?.approver_id ?? req.body?.approverId);
    if (!contractId || !approverId) {
      return res.status(400).json({ message: "contractId dan approver_id wajib." });
    }

    // pastikan contract ada
    const [c] = await pool.query("SELECT id FROM contracts WHERE id = ? LIMIT 1", [contractId]);
    if (!c.length) return res.status(404).json({ message: "Contract tidak ditemukan." });

    // pastikan approver ada
    const [u] = await pool.query("SELECT id FROM users WHERE id = ? LIMIT 1", [approverId]);
    if (!u.length) return res.status(400).json({ message: "approver_id tidak valid." });

    // jika sudah ada row pending untuk approver yang sama, jangan dobel
    const [exist] = await pool.query(
      "SELECT id, status FROM approvals WHERE contract_id = ? AND approver_id = ? ORDER BY id DESC LIMIT 1",
      [contractId, approverId]
    );
    if (exist.length && exist[0].status === "pending") {
      return res.status(200).json({ message: "Approval request sudah ada.", approval_id: exist[0].id });
    }

    const [r] = await pool.query(
      "INSERT INTO approvals (contract_id, approver_id, status) VALUES (?, ?, 'pending')",
      [contractId, approverId]
    );

    // set status contract -> pending_approval
    await pool.query("UPDATE contracts SET status = ? WHERE id = ?", ["pending_approval", contractId]);

    return res.status(201).json({ message: "Request approval dibuat ✅", approval_id: r.insertId });
  } catch (err) {
    console.error("REQUEST APPROVAL ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// 2) List approvals untuk 1 approver
// GET /api/approvals?approver_id=123
app.get("/api/approvals", async (req, res) => {
  try {
    const approverId = req.query.approver_id ? Number(req.query.approver_id) : null;
    if (!approverId) return res.status(400).json({ message: "approver_id wajib." });

    const [rows] = await pool.query(
      `
      SELECT
        a.id AS approval_id,
        a.contract_id,
        a.approver_id,
        a.status AS approval_status,
        a.notes,
        a.signed_path AS approval_signed_path,
        a.created_at,
        a.updated_at,
        c.title,
        c.vendor,
        c.contract_code,
        c.status AS contract_status,
        cf.upload_path,
        cf.signed_path
      FROM approvals a
      JOIN contracts c ON c.id = a.contract_id
      LEFT JOIN contract_files cf ON cf.contract_id = c.id
      WHERE a.approver_id = ?
      ORDER BY a.id DESC
      `,
      [approverId]
    );

    const mapped = rows.map((r) => ({
      approval_id: r.approval_id,
      contract_id: r.contract_id,
      approver_id: r.approver_id,
      approval_status: r.approval_status,
      notes: r.notes ?? "",
      approval_signed_path: r.approval_signed_path ?? null,
      contract: {
        id: r.contract_id,
        title: r.title ?? "",
        vendor: r.vendor ?? "",
        contractId: r.contract_code ?? "",
        status: statusLabel(r.contract_status),
        upload_path: r.upload_path ?? null,
        signed_path: r.signed_path ?? null,
      },
    }));

    return res.json(mapped);
  } catch (err) {
    console.error("GET APPROVALS ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// 3) Approver tanda tangan di PDF + otomatis approve
// POST /api/approvals/:approvalId/sign
// body: { pageIndex, x, y, width, height, imageDataUrl, notes }
app.post("/api/approvals/:approvalId/sign", async (req, res) => {
  try {
    const approvalId = Number(req.params.approvalId);
    const { pageIndex, x, y, width, height, imageDataUrl, notes } = req.body || {};
    if (!approvalId) return res.status(400).json({ message: "Invalid approvalId" });
    if (typeof pageIndex !== "number" || !imageDataUrl) {
      return res.status(400).json({ message: "Payload tidak lengkap." });
    }

    const [aRows] = await pool.query(
      "SELECT id, contract_id, approver_id, status FROM approvals WHERE id = ? LIMIT 1",
      [approvalId]
    );
    if (!aRows.length) return res.status(404).json({ message: "Approval tidak ditemukan." });
    if (aRows[0].status === "rejected") {
      return res.status(400).json({ message: "Approval sudah rejected." });
    }

    const contractId = Number(aRows[0].contract_id);
    const srcAbs = await getContractPdfSourceAbs(contractId);
    if (!srcAbs || !fs.existsSync(srcAbs)) {
      return res.status(404).json({ message: "PDF sumber tidak ditemukan. Upload PDF dulu." });
    }

    const pdfBytes = fs.readFileSync(srcAbs);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    const page = pages[pageIndex] || pages[0];

    const m = String(imageDataUrl).match(/^data:(image\/(png|jpeg));base64,(.*)$/i);
    if (!m) return res.status(400).json({ message: "Format imageDataUrl harus PNG/JPEG base64." });
    const imgBuf = Buffer.from(m[3], "base64");
    const embed =
      m[1].toLowerCase() === "image/png" ? await pdfDoc.embedPng(imgBuf) : await pdfDoc.embedJpg(imgBuf);

    page.drawImage(embed, {
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height),
    });

    const outBytes = await pdfDoc.save();
    const outName = `approval-${approvalId}-contract-${contractId}-signed-${Date.now()}.pdf`;
    const outAbs = path.join(STORAGE_DIR, outName);
    fs.writeFileSync(outAbs, outBytes);

    const approval_signed_path = `/storage/${encodeURIComponent(outName)}`;

    await pool.query(
      "UPDATE approvals SET status='approved', notes=?, signed_path=?, signed_at=NOW() WHERE id=?",
      [String(notes || "").trim() || null, approval_signed_path, approvalId]
    );

    // kalau semua approver untuk contract ini sudah approved, set contract status -> active_contract
    const [pendingLeft] = await pool.query(
      "SELECT COUNT(1) AS cnt FROM approvals WHERE contract_id = ? AND status = 'pending'",
      [contractId]
    );
    if (Number(pendingLeft?.[0]?.cnt || 0) === 0) {
      await pool.query("UPDATE contracts SET status = ? WHERE id = ?", ["active_contract", contractId]);
    }

    return res.json({ message: "TTD approval berhasil ✅", approval_signed_path, approval_status: "approved" });
  } catch (err) {
    console.error("SIGN APPROVAL ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});

// 4) Reject approval (tanpa tanda tangan)
// POST /api/approvals/:approvalId/reject  { notes }
app.post("/api/approvals/:approvalId/reject", async (req, res) => {
  try {
    const approvalId = Number(req.params.approvalId);
    const notes = String(req.body?.notes || "").trim() || null;
    if (!approvalId) return res.status(400).json({ message: "Invalid approvalId" });

    const [aRows] = await pool.query(
      "SELECT id, contract_id, status FROM approvals WHERE id = ? LIMIT 1",
      [approvalId]
    );
    if (!aRows.length) return res.status(404).json({ message: "Approval tidak ditemukan." });

    await pool.query("UPDATE approvals SET status='rejected', notes=? WHERE id=?", [notes, approvalId]);
    // optional: status contract balik ke in_progress supaya bisa diperbaiki
    await pool.query("UPDATE contracts SET status = ? WHERE id = ?", ["in_progress", aRows[0].contract_id]);

    return res.json({ message: "Approval rejected ✅", approval_status: "rejected" });
  } catch (err) {
    console.error("REJECT APPROVAL ERROR:", err);
    return handleMysqlError(res, err, "Server error");
  }
});


// =========================
// FALLBACK (PALING BAWAH)
// =========================
// ✅ FIX: lebih aman daripada app.get("*") di beberapa versi express/path-to-regexp
app.get("/*", (req, res) => {
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send("Not Found");
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`Smart Contract running at http://localhost:${PORT}`);
});
