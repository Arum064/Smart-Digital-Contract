# Contract Digital – Backend (Express + MySQL)

Backend ini dipakai untuk:
- **Sign Up / Sign In** (user baru wajib **signup dulu**, baru bisa signin)
- **My Contract (CRUD)** + upload PDF
- **Tanda tangan PDF** (owner contract) → file hasilnya tersimpan di folder `storage/`
- **Approval flow** (request approval, list approval, approver ttd di PDF, reject)

## 1) Prasyarat
- Node.js 18+
- MySQL / MariaDB (bisa lewat XAMPP)

## 2) Setup Database
1. Buat database:
   ```sql
   CREATE DATABASE contract_digital;
   USE contract_digital;
   ```
2. Jalankan file `schema.sql` (copy-paste ke phpMyAdmin / MySQL CLI).

## 3) Konfigurasi ENV
Buat/ubah `.env`:
```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=contract_digital

# Opsional
MAX_FILE_SIZE_MB=25
UPLOADS_DIR=uploads
STORAGE_DIR=storage
DB_POOL_LIMIT=10
```

## 4) Jalankan
```bash
npm install
npm run start
```
Cek koneksi DB:
- `GET http://localhost:5000/api/db-test`

## 5) Endpoint Utama
### Auth
- `POST /api/auth/signup` `{ full_name, email, password }`
- `POST /api/auth/signin` `{ email, password }` (atau `{ full_name, password }`)

### My Contract
- `GET /api/contracts?owner_id=1`
- `POST /api/contracts` (JSON atau FormData `.none()`)
  - `owner_id, title, vendor, contractId, status`
- `PUT /api/contracts/:id`
- `DELETE /api/contracts/:id`

### File PDF untuk contract
- `POST /api/contracts/:id/upload` (multipart `pdf`)
- `POST /api/contracts/:id/sign` (JSON)
  - `{ pageIndex, x, y, width, height, imageDataUrl }`
  - hasil: `signed_path` (tersimpan di `storage/`)

### Approval
- `POST /api/contracts/:id/request-approval` `{ approver_id }`
- `GET /api/approvals?approver_id=2`
- `POST /api/approvals/:approvalId/sign` (JSON)
  - `{ pageIndex, x, y, width, height, imageDataUrl, notes }`
  - hasil: `approval_signed_path` (tersimpan di `storage/`)
- `POST /api/approvals/:approvalId/reject` `{ notes }`

## 6) Catatan Penting Integrasi Frontend
- Simpan `user.id` dari response **signin** (misal: LocalStorage), lalu kirim sebagai `owner_id` pada create/list contract.
- Untuk halaman Approval: pakai `approver_id` sesuai user approver.

