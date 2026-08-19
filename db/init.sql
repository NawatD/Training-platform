-- ============================================================
--  Internal Training Platform — PostgreSQL schema
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- Users ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  password_hash TEXT,                                  -- login เป็น Microsoft 365 SSO ล้วน — ไม่ใช้รหัสผ่านของระบบเองแล้ว
  role          TEXT NOT NULL DEFAULT 'learner' CHECK (role IN ('admin','learner')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Domains (business domain / course track) ----------
CREATE TABLE IF NOT EXISTS domains (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  icon        TEXT DEFAULT '📘',
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','soon','archived')),
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Modules (lessons) ----------
CREATE TABLE IF NOT EXISTS modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id   UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  code        TEXT,                                  -- e.g. m1
  title       TEXT NOT NULL,
  summary     TEXT,
  level       TEXT NOT NULL DEFAULT 'foundation'
              CHECK (level IN ('foundation','intermediate','advanced')),
  duration    TEXT,
  key_terms   JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_modules_domain ON modules(domain_id);

-- ---------- Sections (content blocks inside a module) ----------
-- kind: html | video | slide | pdf | embed
CREATE TABLE IF NOT EXISTS sections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id   UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  heading     TEXT,
  kind        TEXT NOT NULL DEFAULT 'html'
              CHECK (kind IN ('html','video','slide','pdf','embed')),
  body        TEXT,                                  -- html content, or embed URL
  asset_id    UUID,                                  -- FK set below
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_module ON sections(module_id);

-- ---------- Assets (uploaded VDO / slide / pdf files) ----------
CREATE TABLE IF NOT EXISTS assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      TEXT NOT NULL,                       -- stored filename on disk
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN ('video','slide','pdf','image','html','other')),
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sections
  DROP CONSTRAINT IF EXISTS sections_asset_fk;
ALTER TABLE sections
  ADD CONSTRAINT sections_asset_fk
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL;

-- ---------- Quiz questions ----------
CREATE TABLE IF NOT EXISTS quiz_questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id   UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  module_id   UUID REFERENCES modules(id) ON DELETE SET NULL,
  level       TEXT NOT NULL DEFAULT 'foundation'
              CHECK (level IN ('foundation','intermediate','advanced')),
  category    TEXT,
  question    TEXT NOT NULL,
  options     JSONB NOT NULL,                        -- ["a","b","c","d"]
  correct_index INT NOT NULL,
  explanation TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_quiz_domain ON quiz_questions(domain_id);

-- ---------- Learner progress ----------
CREATE TABLE IF NOT EXISTS module_progress (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id    UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  completed    BOOLEAN NOT NULL DEFAULT TRUE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_id)
);

-- ---------- Quiz attempts ----------
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain_id    UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  score        INT NOT NULL,
  total        INT NOT NULL,
  percent      NUMERIC(5,2) NOT NULL,
  breakdown    JSONB NOT NULL DEFAULT '{}'::jsonb,
  answers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON quiz_attempts(user_id);

-- migration: เพิ่มคอลัมน์ updated_by ให้ deployment เดิมที่มีตารางอยู่แล้ว (CREATE TABLE IF NOT EXISTS ข้างบนจะไม่ทำอะไรถ้ามีตารางแล้ว)
-- ต้องอยู่หลังจากสร้างตารางทั้งหมดแล้วเท่านั้น (deployment ใหม่ยังไม่มี quiz_questions ตอนต้นไฟล์)
ALTER TABLE modules ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- migration: เพิ่ม 'html' เป็น asset kind ที่ยอมรับได้ ให้ deployment เดิม (รองรับอัปโหลดไฟล์ .html แนบกับหัวข้อ kind=html)
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('video','slide','pdf','image','html','other'));

-- migration: เปลี่ยนไปใช้ Microsoft 365 SSO ล้วน — deployment เดิมที่คอลัมน์นี้ยังเป็น NOT NULL ต้องเปิดให้ว่างได้
-- (รันซ้ำได้ตลอด — ถ้า nullable อยู่แล้วจะไม่ทำอะไร)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- ---------- updated_at trigger ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['domains','modules','sections','quiz_questions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s
                    FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;
