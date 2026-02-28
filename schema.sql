-- ==============================
-- Contract Digital (Smart Digital Contract) - MySQL Schema
-- ==============================
-- Cara pakai (contoh):
--   CREATE DATABASE contract_digital;
--   USE contract_digital;
--   (lalu jalankan seluruh isi file ini)

SET NAMES utf8mb4;

-- ----------
-- USERS
-- ----------
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin','approver') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------
-- CONTRACTS
-- ----------
CREATE TABLE IF NOT EXISTS contracts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_id INT UNSIGNED NOT NULL,
  contract_code VARCHAR(60) NOT NULL,
  title VARCHAR(160) NOT NULL,
  vendor VARCHAR(160) NOT NULL,
  status ENUM('draft','pending_approval','in_progress','expiring_soon','active_contract') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contracts_owner (owner_id),
  KEY idx_contracts_code (contract_code),
  CONSTRAINT fk_contracts_owner
    FOREIGN KEY (owner_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------
-- CONTRACT FILES (upload PDF + hasil signed)
-- ----------
CREATE TABLE IF NOT EXISTS contract_files (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id INT UNSIGNED NOT NULL,
  upload_path VARCHAR(255) NULL,
  signed_path VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contract_files_contract (contract_id),
  CONSTRAINT fk_contract_files_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------
-- APPROVALS
-- Satu contract bisa punya beberapa approver.
-- signed_path = PDF setelah approver menandatangani (atau approve tanpa tanda tangan jika mau)
-- ----------
CREATE TABLE IF NOT EXISTS approvals (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id INT UNSIGNED NOT NULL,
  approver_id INT UNSIGNED NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  signed_path VARCHAR(255) NULL,
  signed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_approvals_contract (contract_id),
  KEY idx_approvals_approver (approver_id),
  CONSTRAINT fk_approvals_contract
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_approvals_approver
    FOREIGN KEY (approver_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
