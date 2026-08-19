/* ============================================================
   Content export/import — บทเรียน (modules+sections) และคำถาม (quiz) เป็น Excel
   - Export: สร้างไฟล์ .xlsx จากฐานข้อมูล (ทั้งหมด หรือเฉพาะ domain ที่เลือก)
   - Import: อัปโหลดไฟล์ -> ตรวจสอบ + คำนวณ diff (preview, ยังไม่เขียนอะไร) -> ยืนยัน -> apply จริง
   - นโยบาย sync: แถวที่หายไปจากไฟล์ (เทียบกับของเดิมใน domain ที่อยู่ในไฟล์) จะถูกลบออกจากระบบ
     ขอบเขต sync = เฉพาะ domain ที่ "ปรากฏอยู่ในไฟล์" เท่านั้น — domain อื่นที่ไม่อยู่ในไฟล์ไม่ถูกแตะต้อง
   ============================================================ */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, tx } = require('./db');

const LEVELS = ['foundation', 'intermediate', 'advanced'];
const SECTION_KINDS = ['html', 'video', 'slide', 'pdf', 'embed'];
const ASSET_REQUIRED_KINDS = ['video', 'slide', 'pdf'];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

const TMP_DIR = process.env.CONTENT_IMPORT_TMP_DIR || '/tmp/content-import';
fs.mkdirSync(TMP_DIR, { recursive: true });
const TOKEN_TTL_MS = 20 * 60 * 1000; // ไฟล์ที่รออนุมัติ import เก็บไว้ 20 นาที

const SHEETS = {
  modules: 'บทเรียน (Modules)',
  sections: 'หัวข้อเนื้อหา (Sections)',
  quiz: 'คำถาม (Quiz)',
};

// updatedAt/updatedBy เป็นคอลัมน์อ่านอย่างเดียว — แสดงไว้ให้ดูเฉยๆ ตอน import จะไม่อ่านค่าจาก 2 คอลัมน์นี้เลย
const MODULE_H = {
  id: 'ID', domain: 'Domain (slug)', code: 'รหัส', title: 'ชื่อบทเรียน*',
  summary: 'คำอธิบายสั้น', level: 'ระดับ (foundation/intermediate/advanced)',
  duration: 'เวลาโดยประมาณ', keyTerms: 'คำศัพท์สำคัญ (คั่นด้วยจุลภาค)',
  published: 'เผยแพร่ (TRUE/FALSE)', sortOrder: 'ลำดับ',
  updatedAt: 'แก้ไขล่าสุด (อ่านอย่างเดียว)', updatedBy: 'แก้ไขโดย (อ่านอย่างเดียว)',
};
const SECTION_H = {
  id: 'ID', domain: 'Domain (slug)', module: 'บทเรียน (Module title)*',
  heading: 'หัวข้อ', kind: 'ประเภท (html/video/slide/pdf/embed)*',
  body: 'เนื้อหา HTML หรือ URL (embed)', asset: 'ไฟล์แนบ (ชื่อไฟล์ที่อัปโหลดไว้แล้ว)',
  sortOrder: 'ลำดับ',
  updatedAt: 'แก้ไขล่าสุด (อ่านอย่างเดียว)', updatedBy: 'แก้ไขโดย (อ่านอย่างเดียว)',
};
const QUIZ_H = {
  id: 'ID', domain: 'Domain (slug)', module: 'บทเรียน (Module title, ไม่บังคับ)',
  level: 'ระดับ (foundation/intermediate/advanced)', category: 'หมวดหมู่',
  question: 'คำถาม*', optA: 'ตัวเลือก A', optB: 'ตัวเลือก B', optC: 'ตัวเลือก C', optD: 'ตัวเลือก D',
  correct: 'ข้อที่ถูก (A/B/C/D)*', explanation: 'คำอธิบายเฉลย',
  active: 'เปิดใช้งาน (TRUE/FALSE)', sortOrder: 'ลำดับ',
  updatedAt: 'แก้ไขล่าสุด (อ่านอย่างเดียว)', updatedBy: 'แก้ไขโดย (อ่านอย่างเดียว)',
};

/* ============================================================
   EXPORT
   ============================================================ */
async function buildWorkbook(domainSlug, baseUrl) {
  const { rows: domains } = domainSlug
    ? await query('SELECT * FROM domains WHERE slug=$1 ORDER BY sort_order, name', [domainSlug])
    : await query('SELECT * FROM domains ORDER BY sort_order, name');
  if (domainSlug && !domains.length) throw new Error('ไม่พบ domain นี้');
  const domainIds = domains.map((d) => d.id);
  const domainById = Object.fromEntries(domains.map((d) => [d.id, d]));

  const modules = domainIds.length
    ? (await query(
        `SELECT m.*, u.full_name AS updated_by_name FROM modules m
         LEFT JOIN users u ON u.id = m.updated_by
         WHERE m.domain_id = ANY($1::uuid[]) ORDER BY m.domain_id, m.sort_order, m.created_at`,
        [domainIds]
      )).rows
    : [];
  const moduleById = Object.fromEntries(modules.map((m) => [m.id, m]));
  const moduleIds = modules.map((m) => m.id);

  const sections = moduleIds.length
    ? (await query(
        `SELECT s.*, a.original_name AS asset_name, u.full_name AS updated_by_name FROM sections s
         LEFT JOIN assets a ON a.id = s.asset_id
         LEFT JOIN users u ON u.id = s.updated_by
         WHERE s.module_id = ANY($1::uuid[]) ORDER BY s.module_id, s.sort_order, s.created_at`,
        [moduleIds]
      )).rows
    : [];

  const quiz = domainIds.length
    ? (await query(
        `SELECT q.*, u.full_name AS updated_by_name FROM quiz_questions q
         LEFT JOIN users u ON u.id = q.updated_by
         WHERE q.domain_id = ANY($1::uuid[]) ORDER BY q.domain_id, q.sort_order, q.created_at`,
        [domainIds]
      )).rows
    : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Internal Training Platform';
  wb.created = new Date();

  addInstructionsSheet(wb, domains);
  addModulesSheet(wb, modules, domainById);
  addSectionsSheet(wb, sections, moduleById, domainById, baseUrl);
  addQuizSheet(wb, quiz, moduleById, domainById);

  return wb;
}

function fmtDateTh(d) {
  return d ? new Date(d).toLocaleString('th-TH') : '';
}

function styleHeaderRow(sheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function addInstructionsSheet(wb, domains) {
  const s = wb.addWorksheet('คำแนะนำ');
  s.columns = [{ width: 100 }];
  const lines = [
    'วิธีใช้ไฟล์นี้',
    '',
    '1) แก้ไขข้อมูลใน sheet "บทเรียน (Modules)", "หัวข้อเนื้อหา (Sections)", "คำถาม (Quiz)" ได้ตามต้องการ',
    '2) คอลัมน์ ID: เว้นว่างไว้ = สร้างแถวใหม่ / มีค่าอยู่แล้ว = แก้ไขแถวเดิม — อย่าพิมพ์ ID เองถ้าไม่ได้ตั้งใจแก้แถวเดิม',
    '3) ลบทั้งแถวออกจากไฟล์ = ลบข้อมูลนั้นออกจากระบบจริงเมื่อ import (ระบบจะแสดงรายการที่จะถูกลบให้ยืนยันก่อนเสมอ)',
    '4) ห้ามลบหรือเปลี่ยนชื่อ sheet ทั้ง 3 (แม้ว่างก็ต้องมี sheet อยู่)',
    '5) sheet "หัวข้อเนื้อหา" และ "คำถาม" อ้างอิงบทเรียนด้วยคอลัมน์ Domain + บทเรียน (ชื่อ) — ต้องตรงกับที่กรอกใน sheet "บทเรียน" เป๊ะ',
    '6) ประเภท video/slide/pdf คอลัมน์ "ไฟล์แนบ" จะเป็นลิงก์คลิกเพื่อเปิดดูไฟล์เดิมได้เลย (ไม่ต้องพิมพ์อะไรถ้าไม่ได้ตั้งใจเปลี่ยนไฟล์)',
    '   ถ้าจะเปลี่ยนไปแนบไฟล์อื่นที่อัปโหลดไว้แล้ว ให้ลบลิงก์ออกแล้วพิมพ์ชื่อไฟล์ให้ตรงกับที่อัปโหลดไว้ที่หน้า Admin > ไฟล์ VDO/สไลด์ — import จะไม่อัปโหลดไฟล์ใหม่ให้',
    '7) นำเข้ากลับเข้าระบบที่เมนู Admin > นำเข้า/ส่งออก > เลือกไฟล์ > ตรวจสอบ > ยืนยัน',
    '',
    `Domain ที่รวมอยู่ในไฟล์นี้: ${domains.length ? domains.map((d) => `${d.slug} (${d.name})`).join(', ') : '(ไม่มี)'}`,
    `สร้างเมื่อ: ${new Date().toLocaleString('th-TH')}`,
  ];
  lines.forEach((l, i) => { s.getCell(i + 1, 1).value = l; });
  s.getCell(1, 1).font = { bold: true, size: 14 };
}

function addModulesSheet(wb, modules, domainById) {
  const s = wb.addWorksheet(SHEETS.modules);
  s.columns = [
    { header: MODULE_H.id, key: 'id', width: 24 },
    { header: MODULE_H.domain, key: 'domain', width: 16 },
    { header: MODULE_H.code, key: 'code', width: 10 },
    { header: MODULE_H.title, key: 'title', width: 32 },
    { header: MODULE_H.summary, key: 'summary', width: 36 },
    { header: MODULE_H.level, key: 'level', width: 14 },
    { header: MODULE_H.duration, key: 'duration', width: 14 },
    { header: MODULE_H.keyTerms, key: 'keyTerms', width: 30 },
    { header: MODULE_H.published, key: 'published', width: 12 },
    { header: MODULE_H.sortOrder, key: 'sortOrder', width: 8 },
    { header: MODULE_H.updatedAt, key: 'updatedAt', width: 22 },
    { header: MODULE_H.updatedBy, key: 'updatedBy', width: 20 },
  ];
  for (const m of modules) {
    s.addRow({
      id: m.id, domain: domainById[m.domain_id] ? domainById[m.domain_id].slug : '',
      code: m.code || '', title: m.title, summary: m.summary || '',
      level: m.level, duration: m.duration || '',
      keyTerms: (m.key_terms || []).join(', '),
      published: m.is_published ? 'TRUE' : 'FALSE', sortOrder: m.sort_order,
      updatedAt: fmtDateTh(m.updated_at), updatedBy: m.updated_at ? (m.updated_by_name || 'admin') : '',
    });
  }
  applyValidation(s, 'F', LEVELS);
  applyValidation(s, 'I', ['TRUE', 'FALSE']);
  styleHeaderRow(s);
}

function addSectionsSheet(wb, sections, moduleById, domainById, baseUrl) {
  const s = wb.addWorksheet(SHEETS.sections);
  s.columns = [
    { header: SECTION_H.id, key: 'id', width: 24 },
    { header: SECTION_H.domain, key: 'domain', width: 16 },
    { header: SECTION_H.module, key: 'module', width: 32 },
    { header: SECTION_H.heading, key: 'heading', width: 28 },
    { header: SECTION_H.kind, key: 'kind', width: 14 },
    { header: SECTION_H.body, key: 'body', width: 50 },
    { header: SECTION_H.asset, key: 'asset', width: 46 },
    { header: SECTION_H.sortOrder, key: 'sortOrder', width: 8 },
    { header: SECTION_H.updatedAt, key: 'updatedAt', width: 22 },
    { header: SECTION_H.updatedBy, key: 'updatedBy', width: 20 },
  ];
  for (const sec of sections) {
    const mod = moduleById[sec.module_id];
    const dom = mod ? domainById[mod.domain_id] : null;
    // kind=html เนื้อหาอาจยาวมาก ใส่ลิงก์ไปหน้าแก้ไขแทนตัว HTML ตรงๆ (กัน export พังเมื่อเนื้อหาเกินขีดจำกัดของ Excel cell)
    // kind อื่น (video/slide/pdf/embed) เนื้อหาเป็น URL/คำบรรยายสั้นๆ อยู่แล้ว ยังแก้ผ่าน Excel ได้ตามเดิม
    const bodyCell = (sec.kind === 'html' && baseUrl)
      ? `${sectionEditUrl(baseUrl, sec)} (${sec.heading || 'แก้ไขเนื้อหาที่นี่'})`
      : (sec.body || '');
    const row = s.addRow({
      id: sec.id, domain: dom ? dom.slug : '', module: mod ? mod.title : '',
      heading: sec.heading || '', kind: sec.kind, body: bodyCell,
      asset: sec.asset_name || '', sortOrder: sec.sort_order,
      updatedAt: fmtDateTh(sec.updated_at), updatedBy: sec.updated_at ? (sec.updated_by_name || 'admin') : '',
    });
    // ใส่ URL เต็มลงในเซลล์ตรงๆ (ไม่ใช่ hyperlink object) — เปิดในโปรแกรมไหนก็เห็น/คลิกได้เหมือนกันหมด
    // ต่อชื่อไฟล์เดิมไว้ท้าย URL ให้อ่านออกว่าเป็นไฟล์อะไรโดยไม่ต้องคลิก
    // ตอน import จะอ่าน asset id จาก URL นี้โดยตรง (แม่นกว่าการจับคู่ด้วยชื่อไฟล์เฉยๆ) — ต่อท้ายด้วยชื่อไฟล์ไม่กระทบการอ่าน
    if (sec.asset_id && baseUrl) {
      const fileUrl = `${baseUrl}/api/assets/${sec.asset_id}/file`;
      row.getCell('asset').value = sec.asset_name ? `${fileUrl} (${sec.asset_name})` : fileUrl;
    }
  }
  applyValidation(s, 'E', SECTION_KINDS);
  styleHeaderRow(s);
}

function addQuizSheet(wb, quiz, moduleById, domainById) {
  const s = wb.addWorksheet(SHEETS.quiz);
  s.columns = [
    { header: QUIZ_H.id, key: 'id', width: 24 },
    { header: QUIZ_H.domain, key: 'domain', width: 16 },
    { header: QUIZ_H.module, key: 'module', width: 28 },
    { header: QUIZ_H.level, key: 'level', width: 14 },
    { header: QUIZ_H.category, key: 'category', width: 16 },
    { header: QUIZ_H.question, key: 'question', width: 44 },
    { header: QUIZ_H.optA, key: 'optA', width: 22 },
    { header: QUIZ_H.optB, key: 'optB', width: 22 },
    { header: QUIZ_H.optC, key: 'optC', width: 22 },
    { header: QUIZ_H.optD, key: 'optD', width: 22 },
    { header: QUIZ_H.correct, key: 'correct', width: 10 },
    { header: QUIZ_H.explanation, key: 'explanation', width: 40 },
    { header: QUIZ_H.active, key: 'active', width: 12 },
    { header: QUIZ_H.sortOrder, key: 'sortOrder', width: 8 },
    { header: QUIZ_H.updatedAt, key: 'updatedAt', width: 22 },
    { header: QUIZ_H.updatedBy, key: 'updatedBy', width: 20 },
  ];
  for (const q of quiz) {
    const mod = q.module_id ? moduleById[q.module_id] : null;
    const dom = domainById[q.domain_id];
    const opts = q.options || [];
    s.addRow({
      id: q.id, domain: dom ? dom.slug : '', module: mod ? mod.title : '',
      level: q.level, category: q.category || '', question: q.question,
      optA: opts[0] || '', optB: opts[1] || '', optC: opts[2] || '', optD: opts[3] || '',
      correct: OPTION_LETTERS[q.correct_index] || '', explanation: q.explanation || '',
      active: q.is_active ? 'TRUE' : 'FALSE', sortOrder: q.sort_order,
      updatedAt: fmtDateTh(q.updated_at), updatedBy: q.updated_at ? (q.updated_by_name || 'admin') : '',
    });
  }
  applyValidation(s, 'D', LEVELS);
  applyValidation(s, 'K', OPTION_LETTERS);
  applyValidation(s, 'M', ['TRUE', 'FALSE']);
  styleHeaderRow(s);
}

function applyValidation(sheet, col, list) {
  for (let r = 2; r <= 1000; r++) {
    sheet.getCell(`${col}${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`],
    };
  }
}

/* ============================================================
   PARSE + VALIDATE
   ============================================================ */
function cellText(cell) {
  if (!cell || cell.value == null) return '';
  const v = cell.value;
  if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('');
  if (typeof v === 'object' && v.text) return String(v.text);
  return String(v).trim();
}
function cellBool(cell, def) {
  const t = cellText(cell).toLowerCase();
  if (!t) return def;
  return ['true', '1', 'yes', 'ใช่'].includes(t);
}
function cellInt(cell, def) {
  const t = cellText(cell);
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : def;
}
// ถ้าเซลล์เป็น URL เต็มที่ export มาให้ (คอลัมน์ "ไฟล์แนบ") ให้ดึง asset id จาก URL ตรงๆ — แม่นกว่าจับคู่ด้วยชื่อไฟล์
const ASSET_LINK_RE = /\/api\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/file/i;
function cellAssetLinkId(cell) {
  const t = cellText(cell);
  const m = ASSET_LINK_RE.exec(t);
  return m ? m[1] : null;
}

// section เนื้อหา HTML (kind=html) อาจยาวเกินขีดจำกัด cell ของ Excel (~32,767 ตัวอักษร) จนไฟล์ export พัง
// เลยส่งออกเป็น "ลิงก์ไปหน้าแก้ไขใน Admin" แทนสำหรับ kind=html เท่านั้น (ดู addSectionsSheet)
// ฟังก์ชันนี้ใช้เช็คตอน import ว่าเซลล์ "ยังเป็นลิงก์เดิม ไม่ได้ถูกแก้เนื้อหาจริง" เพื่อไม่ให้ import ทับเนื้อหาในฐานข้อมูลด้วยตัวลิงก์เอง
const SECTION_LINK_RE = /#section=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
function cellSectionLinkId(cell) {
  const t = cellText(cell);
  const m = SECTION_LINK_RE.exec(t);
  return m ? m[1] : null;
}
function sectionEditUrl(baseUrl, sec) {
  return `${baseUrl}/admin.html#section=${sec.id}&module=${sec.module_id}`;
}

function headerMap(sheet) {
  const map = {};
  sheet.getRow(1).eachCell((cell, colNumber) => { map[cellText(cell)] = colNumber; });
  return map;
}

function getSheet(wb, name) {
  const s = wb.getWorksheet(name);
  if (!s) throw new Error(`ไม่พบ sheet "${name}" ในไฟล์ — อย่าลบหรือเปลี่ยนชื่อ sheet`);
  return s;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const moduleKey = (domainSlug, title) => `${domainSlug.toLowerCase()} ${title.trim().toLowerCase()}`;

async function parseAndValidate(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const modSheet = getSheet(wb, SHEETS.modules);
  const secSheet = getSheet(wb, SHEETS.sections);
  const quizSheet = getSheet(wb, SHEETS.quiz);

  const errors = [];
  const addErr = (sheet, row, message) => errors.push({ sheet, row, message });

  const { rows: allDomains } = await query('SELECT id, slug FROM domains');
  const domainSlugToId = Object.fromEntries(allDomains.map((d) => [d.slug.toLowerCase(), d.id]));

  const { rows: existingModules } = await query('SELECT id, domain_id FROM modules');
  const existingModuleIds = new Set(existingModules.map((m) => m.id));

  const { rows: existingQuiz } = await query('SELECT id FROM quiz_questions');
  const existingQuizIds = new Set(existingQuiz.map((q) => q.id));

  const { rows: existingSections } = await query('SELECT id, body FROM sections');
  const existingSectionIds = new Set(existingSections.map((s) => s.id));
  const existingSectionBodyById = new Map(existingSections.map((s) => [s.id, s.body]));

  const { rows: assets } = await query('SELECT id, original_name FROM assets');
  const assetsByName = {};
  for (const a of assets) {
    (assetsByName[a.original_name] = assetsByName[a.original_name] || []).push(a.id);
  }
  const existingAssetIds = new Set(assets.map((a) => a.id));

  /* ---------- Modules ---------- */
  const hm = headerMap(modSheet);
  const modules = [];
  const moduleKeyMap = new Map(); // domainSlug+title -> { id, isNew, tempIndex }
  const seenModuleIds = new Set();
  modSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = cellText(row.getCell(hm[MODULE_H.id]));
    const domain = cellText(row.getCell(hm[MODULE_H.domain]));
    const title = cellText(row.getCell(hm[MODULE_H.title]));
    if (!domain && !title && !id) return; // แถวว่างสนิท ข้ามไป

    if (!domain) { addErr(SHEETS.modules, rowNumber, 'ต้องระบุ Domain'); return; }
    if (!title) { addErr(SHEETS.modules, rowNumber, 'ต้องระบุชื่อบทเรียน'); return; }
    const domainId = domainSlugToId[domain.toLowerCase()];
    if (!domainId) { addErr(SHEETS.modules, rowNumber, `ไม่พบ domain "${domain}"`); return; }

    let isNew = true;
    if (id) {
      if (!UUID_RE.test(id)) { addErr(SHEETS.modules, rowNumber, 'ID ไม่ถูกต้อง'); return; }
      if (!existingModuleIds.has(id)) { addErr(SHEETS.modules, rowNumber, 'ไม่พบ ID นี้ในระบบ (แถวอาจถูกลบไปแล้ว)'); return; }
      if (seenModuleIds.has(id)) { addErr(SHEETS.modules, rowNumber, 'ID ซ้ำในไฟล์'); return; }
      seenModuleIds.add(id);
      isNew = false;
    }

    const level = cellText(row.getCell(hm[MODULE_H.level])) || 'foundation';
    if (!LEVELS.includes(level)) { addErr(SHEETS.modules, rowNumber, `ระดับไม่ถูกต้อง: ${level}`); return; }

    const key = moduleKey(domain, title);
    if (moduleKeyMap.has(key)) {
      addErr(SHEETS.modules, rowNumber, `ชื่อบทเรียน "${title}" ซ้ำกันใน domain นี้ในไฟล์ — ชื่อบทเรียนต้องไม่ซ้ำภายใน domain เดียวกัน`);
      return;
    }

    const rec = {
      row: rowNumber, id: id || null, isNew, domain_id: domainId, domainSlug: domain,
      code: cellText(row.getCell(hm[MODULE_H.code])) || null,
      title,
      summary: cellText(row.getCell(hm[MODULE_H.summary])) || null,
      level,
      duration: cellText(row.getCell(hm[MODULE_H.duration])) || null,
      key_terms: cellText(row.getCell(hm[MODULE_H.keyTerms])).split(',').map((x) => x.trim()).filter(Boolean),
      is_published: cellBool(row.getCell(hm[MODULE_H.published]), true),
      sort_order: cellInt(row.getCell(hm[MODULE_H.sortOrder]), rowNumber),
    };
    modules.push(rec);
    moduleKeyMap.set(key, rec);
  });

  /* ---------- Sections ---------- */
  const hs = headerMap(secSheet);
  const sections = [];
  const seenSectionIds = new Set();
  secSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = cellText(row.getCell(hs[SECTION_H.id]));
    const domain = cellText(row.getCell(hs[SECTION_H.domain]));
    const moduleTitle = cellText(row.getCell(hs[SECTION_H.module]));
    const heading = cellText(row.getCell(hs[SECTION_H.heading]));
    const kind = cellText(row.getCell(hs[SECTION_H.kind])) || 'html';
    const body = cellText(row.getCell(hs[SECTION_H.body]));
    if (!domain && !moduleTitle && !heading && !body && !id) return;

    if (!domain) { addErr(SHEETS.sections, rowNumber, 'ต้องระบุ Domain'); return; }
    if (!moduleTitle) { addErr(SHEETS.sections, rowNumber, 'ต้องระบุบทเรียน (Module)'); return; }
    if (!domainSlugToId[domain.toLowerCase()]) { addErr(SHEETS.sections, rowNumber, `ไม่พบ domain "${domain}"`); return; }
    const modRef = moduleKeyMap.get(moduleKey(domain, moduleTitle));
    if (!modRef) {
      addErr(SHEETS.sections, rowNumber, `ไม่พบบทเรียน "${moduleTitle}" ใน domain "${domain}" (ต้องมีอยู่ใน sheet บทเรียนด้วย)`);
      return;
    }
    if (!SECTION_KINDS.includes(kind)) { addErr(SHEETS.sections, rowNumber, `ประเภทไม่ถูกต้อง: ${kind}`); return; }

    let isNew = true;
    if (id) {
      if (!UUID_RE.test(id)) { addErr(SHEETS.sections, rowNumber, 'ID ไม่ถูกต้อง'); return; }
      if (!existingSectionIds.has(id)) { addErr(SHEETS.sections, rowNumber, 'ไม่พบ ID นี้ในระบบ (แถวอาจถูกลบไปแล้ว)'); return; }
      if (seenSectionIds.has(id)) { addErr(SHEETS.sections, rowNumber, 'ID ซ้ำในไฟล์'); return; }
      seenSectionIds.add(id);
      isNew = false;
    }

    // kind=html แนบไฟล์ .html ได้เหมือน video/slide/pdf แต่ไม่บังคับ (จะพิมพ์เนื้อหาในคอลัมน์ "เนื้อหา" แทนก็ได้)
    // ถ้าไม่อ่านคอลัมน์นี้ให้ kind=html ด้วย พอ import ไฟล์ที่ export มาเฉยๆ (ไม่ได้แก้อะไร) asset_id ของหัวข้อ HTML ที่แนบไฟล์ไว้จะหายไปทันที
    const assetOptionalKinds = ASSET_REQUIRED_KINDS.includes(kind) || kind === 'html';
    let assetId = null;
    if (assetOptionalKinds) {
      const assetCell = row.getCell(hs[SECTION_H.asset]);
      // export ออกมาให้เป็นลิงก์ (เก็บ asset id ไว้ใน URL) — ถ้ายังเป็นลิงก์เดิมอยู่ ใช้ id ตรงๆ แม่นกว่าจับคู่ชื่อ
      const linkedId = cellAssetLinkId(assetCell);
      if (linkedId) {
        if (!existingAssetIds.has(linkedId)) { addErr(SHEETS.sections, rowNumber, 'ไฟล์แนบ (ลิงก์) นี้ถูกลบออกจากระบบไปแล้ว กรุณาแนบไฟล์ใหม่'); return; }
        assetId = linkedId;
      } else {
        // ไม่มีลิงก์ (แถวใหม่ หรือแก้เป็นพิมพ์ชื่อไฟล์เอง) — จับคู่ด้วยชื่อไฟล์แทน
        const assetName = cellText(assetCell);
        if (!assetName) {
          if (ASSET_REQUIRED_KINDS.includes(kind)) { addErr(SHEETS.sections, rowNumber, `ประเภท ${kind} ต้องระบุไฟล์แนบ`); return; }
          // kind=html ไม่บังคับ — ไม่มีไฟล์แนบก็ใช้เนื้อหาจากคอลัมน์ "เนื้อหา" แทน
        } else {
          const matches = assetsByName[assetName];
          if (!matches) { addErr(SHEETS.sections, rowNumber, `ไม่พบไฟล์ชื่อ "${assetName}" ในระบบ (ต้องอัปโหลดไว้ก่อนที่หน้า Admin > ไฟล์ VDO/สไลด์)`); return; }
          if (matches.length > 1) { addErr(SHEETS.sections, rowNumber, `มีไฟล์ชื่อ "${assetName}" มากกว่า 1 ไฟล์ในระบบ — กรุณาเปลี่ยนชื่อให้ไม่ซ้ำก่อน หรือใช้ลิงก์แทน`); return; }
          assetId = matches[0];
        }
      }
    }

    // kind=html: export ใส่ลิงก์แก้ไขแทนเนื้อหาจริง (ดู addSectionsSheet) — ถ้าเซลล์นี้ยังเป็นลิงก์เดิมของแถวตัวเอง
    // (ไม่ได้ถูกแก้) ให้คงเนื้อหาเดิมในฐานข้อมูลไว้ ไม่ทับด้วยตัวข้อความลิงก์ ถ้าแก้เป็น HTML จริงแล้วจะไม่ตรง regex นี้ จึงบันทึกค่าที่พิมพ์ตามปกติ
    let bodyValue = body || null;
    if (!isNew && kind === 'html') {
      const linkedSecId = cellSectionLinkId(row.getCell(hs[SECTION_H.body]));
      if (linkedSecId && linkedSecId === id) {
        bodyValue = existingSectionBodyById.has(id) ? existingSectionBodyById.get(id) : null;
      }
    }

    sections.push({
      row: rowNumber, id: id || null, isNew, moduleRef: modRef,
      heading: heading || null, kind, body: bodyValue, asset_id: assetId,
      sort_order: cellInt(row.getCell(hs[SECTION_H.sortOrder]), rowNumber),
    });
  });

  /* ---------- Quiz ---------- */
  const hq = headerMap(quizSheet);
  const quiz = [];
  const seenQuizIds = new Set();
  quizSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = cellText(row.getCell(hq[QUIZ_H.id]));
    const domain = cellText(row.getCell(hq[QUIZ_H.domain]));
    const moduleTitle = cellText(row.getCell(hq[QUIZ_H.module]));
    const question = cellText(row.getCell(hq[QUIZ_H.question]));
    if (!domain && !question && !id) return;

    if (!domain) { addErr(SHEETS.quiz, rowNumber, 'ต้องระบุ Domain'); return; }
    if (!question) { addErr(SHEETS.quiz, rowNumber, 'ต้องระบุคำถาม'); return; }
    const domainId = domainSlugToId[domain.toLowerCase()];
    if (!domainId) { addErr(SHEETS.quiz, rowNumber, `ไม่พบ domain "${domain}"`); return; }

    let moduleId = null;
    if (moduleTitle) {
      const modRef = moduleKeyMap.get(moduleKey(domain, moduleTitle));
      if (!modRef) { addErr(SHEETS.quiz, rowNumber, `ไม่พบบทเรียน "${moduleTitle}" ใน domain "${domain}"`); return; }
      moduleId = modRef; // resolved to real id later
    }

    const options = [
      cellText(row.getCell(hq[QUIZ_H.optA])), cellText(row.getCell(hq[QUIZ_H.optB])),
      cellText(row.getCell(hq[QUIZ_H.optC])), cellText(row.getCell(hq[QUIZ_H.optD])),
    ].filter(Boolean);
    if (options.length < 2) { addErr(SHEETS.quiz, rowNumber, 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ'); return; }

    const correctLetter = cellText(row.getCell(hq[QUIZ_H.correct])).toUpperCase();
    const correctIndex = OPTION_LETTERS.indexOf(correctLetter);
    if (correctIndex < 0 || correctIndex >= options.length) {
      addErr(SHEETS.quiz, rowNumber, `"ข้อที่ถูก" ไม่ถูกต้อง ต้องเป็นตัวอักษรของตัวเลือกที่มีข้อความ (${OPTION_LETTERS.slice(0, options.length).join('/')})`);
      return;
    }

    const level = cellText(row.getCell(hq[QUIZ_H.level])) || 'foundation';
    if (!LEVELS.includes(level)) { addErr(SHEETS.quiz, rowNumber, `ระดับไม่ถูกต้อง: ${level}`); return; }

    let isNew = true;
    if (id) {
      if (!UUID_RE.test(id)) { addErr(SHEETS.quiz, rowNumber, 'ID ไม่ถูกต้อง'); return; }
      if (!existingQuizIds.has(id)) { addErr(SHEETS.quiz, rowNumber, 'ไม่พบ ID นี้ในระบบ (แถวอาจถูกลบไปแล้ว)'); return; }
      if (seenQuizIds.has(id)) { addErr(SHEETS.quiz, rowNumber, 'ID ซ้ำในไฟล์'); return; }
      seenQuizIds.add(id);
      isNew = false;
    }

    quiz.push({
      row: rowNumber, id: id || null, isNew, domain_id: domainId, moduleRef: moduleId,
      level, category: cellText(row.getCell(hq[QUIZ_H.category])) || null, question, options,
      correct_index: correctIndex, explanation: cellText(row.getCell(hq[QUIZ_H.explanation])) || null,
      is_active: cellBool(row.getCell(hq[QUIZ_H.active]), true),
      sort_order: cellInt(row.getCell(hq[QUIZ_H.sortOrder]), rowNumber),
    });
  });

  const scopeDomainSlugs = new Set([
    ...modules.map((m) => m.domainSlug.toLowerCase()),
    ...sections.map((s) => s.moduleRef.domainSlug.toLowerCase()),
  ]);
  for (const q of quiz) {
    const dom = allDomains.find((d) => d.id === q.domain_id);
    if (dom) scopeDomainSlugs.add(dom.slug.toLowerCase());
  }
  const scopeDomainIds = [...scopeDomainSlugs].map((s) => domainSlugToId[s]).filter(Boolean);

  return { modules, sections, quiz, errors, scopeDomainIds, moduleKeyMap };
}

/* ============================================================
   DIFF (ไว้แสดง preview ก่อน apply จริง)
   ============================================================ */
async function computeDiff(parsed) {
  const { modules, sections, quiz, scopeDomainIds } = parsed;

  const keptModuleIds = new Set(modules.filter((m) => !m.isNew).map((m) => m.id));
  const keptSectionIds = new Set(sections.filter((s) => !s.isNew).map((s) => s.id));
  const keptQuizIds = new Set(quiz.filter((q) => !q.isNew).map((q) => q.id));

  const existingModules = scopeDomainIds.length
    ? (await query('SELECT id, title, domain_id FROM modules WHERE domain_id = ANY($1::uuid[])', [scopeDomainIds])).rows
    : [];
  const modulesToDelete = existingModules.filter((m) => !keptModuleIds.has(m.id));
  const modulesToDeleteIds = new Set(modulesToDelete.map((m) => m.id));

  const existingSections = existingModules.length
    ? (await query('SELECT s.id, s.heading, s.module_id, m.title AS module_title FROM sections s JOIN modules m ON m.id = s.module_id WHERE s.module_id = ANY($1::uuid[])', [existingModules.map((m) => m.id)])).rows
    : [];
  const sectionsToDelete = existingSections.filter((s) => !keptSectionIds.has(s.id));

  const existingQuiz = scopeDomainIds.length
    ? (await query('SELECT id, question FROM quiz_questions WHERE domain_id = ANY($1::uuid[])', [scopeDomainIds])).rows
    : [];
  const quizToDelete = existingQuiz.filter((q) => !keptQuizIds.has(q.id));

  return {
    modules: {
      insert: modules.filter((m) => m.isNew).length,
      update: modules.filter((m) => !m.isNew).length,
      delete: modulesToDelete.map((m) => ({ id: m.id, title: m.title })),
    },
    sections: {
      insert: sections.filter((s) => s.isNew).length,
      update: sections.filter((s) => !s.isNew).length,
      delete: sectionsToDelete.map((s) => ({
        id: s.id, heading: s.heading || '(ไม่มีหัวข้อ)', moduleTitle: s.module_title,
        viaModuleDelete: modulesToDeleteIds.has(s.module_id),
      })),
    },
    quiz: {
      insert: quiz.filter((q) => q.isNew).length,
      update: quiz.filter((q) => !q.isNew).length,
      delete: quizToDelete.map((q) => ({ id: q.id, question: q.question })),
    },
  };
}

/* ============================================================
   APPLY
   ============================================================ */
async function applyImport(parsed, actorUserId) {
  const { modules, sections, quiz, scopeDomainIds } = parsed;
  const summary = { modulesInserted: 0, modulesUpdated: 0, modulesDeleted: 0,
    sectionsInserted: 0, sectionsUpdated: 0, sectionsDeleted: 0,
    quizInserted: 0, quizUpdated: 0, quizDeleted: 0 };

  await tx(async (c) => {
    // 1) upsert modules, resolve real IDs for new ones
    for (const m of modules) {
      if (m.isNew) {
        const { rows } = await c.query(
          `INSERT INTO modules (domain_id, code, title, summary, level, duration, key_terms, is_published, sort_order, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING id`,
          [m.domain_id, m.code, m.title, m.summary, m.level, m.duration, JSON.stringify(m.key_terms), m.is_published, m.sort_order, actorUserId]
        );
        m.resolvedId = rows[0].id;
        summary.modulesInserted++;
      } else {
        await c.query(
          `UPDATE modules SET domain_id=$1, code=$2, title=$3, summary=$4, level=$5, duration=$6,
             key_terms=$7::jsonb, is_published=$8, sort_order=$9, updated_by=$10 WHERE id=$11`,
          [m.domain_id, m.code, m.title, m.summary, m.level, m.duration, JSON.stringify(m.key_terms), m.is_published, m.sort_order, actorUserId, m.id]
        );
        m.resolvedId = m.id;
        summary.modulesUpdated++;
      }
    }

    // 2) delete modules no longer present (scoped)
    // ต้องใช้ resolvedId (ครอบคลุมทั้งแถวเดิมและแถวใหม่ที่เพิ่ง insert ไปในขั้นตอนที่ 1)
    // ไม่ใช่แค่ id ของแถวเดิม ไม่งั้นโมดูลที่เพิ่งสร้างใหม่จะถูกลบทิ้งทันทีเพราะ "ไม่อยู่ในชุดที่เก็บไว้"
    const keptModuleIds = modules.map((m) => m.resolvedId);
    if (scopeDomainIds.length) {
      const { rows: toDelete } = await c.query(
        `SELECT id FROM modules WHERE domain_id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))`,
        [scopeDomainIds, keptModuleIds.length ? keptModuleIds : ['00000000-0000-0000-0000-000000000000']]
      );
      if (toDelete.length) {
        await c.query('DELETE FROM modules WHERE id = ANY($1::uuid[])', [toDelete.map((r) => r.id)]);
        summary.modulesDeleted = toDelete.length;
      }
    }

    // 3) upsert sections, using resolved module ids
    for (const s of sections) {
      const moduleId = s.moduleRef.resolvedId;
      if (s.isNew) {
        const { rows } = await c.query(
          `INSERT INTO sections (module_id, heading, kind, body, asset_id, sort_order, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [moduleId, s.heading, s.kind, s.body, s.asset_id, s.sort_order, actorUserId]
        );
        s.resolvedId = rows[0].id;
        summary.sectionsInserted++;
      } else {
        await c.query(
          `UPDATE sections SET module_id=$1, heading=$2, kind=$3, body=$4, asset_id=$5, sort_order=$6, updated_by=$7 WHERE id=$8`,
          [moduleId, s.heading, s.kind, s.body, s.asset_id, s.sort_order, actorUserId, s.id]
        );
        s.resolvedId = s.id;
        summary.sectionsUpdated++;
      }
    }

    // 4) delete sections no longer present, scoped to modules that still exist
    //    (sections of deleted modules are already gone via ON DELETE CASCADE)
    // keptSectionIds ต้องใช้ resolvedId เช่นกัน — ครอบคลุมแถวใหม่ที่เพิ่ง insert ไปข้างบนด้วย
    const stillExistingModuleIds = modules.map((m) => m.resolvedId);
    const keptSectionIds = sections.map((s) => s.resolvedId);
    if (stillExistingModuleIds.length) {
      const { rows: toDelete } = await c.query(
        `SELECT id FROM sections WHERE module_id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))`,
        [stillExistingModuleIds, keptSectionIds.length ? keptSectionIds : ['00000000-0000-0000-0000-000000000000']]
      );
      if (toDelete.length) {
        await c.query('DELETE FROM sections WHERE id = ANY($1::uuid[])', [toDelete.map((r) => r.id)]);
        summary.sectionsDeleted = toDelete.length;
      }
    }

    // 5) upsert quiz
    for (const q of quiz) {
      const moduleId = q.moduleRef ? q.moduleRef.resolvedId : null;
      if (q.isNew) {
        const { rows } = await c.query(
          `INSERT INTO quiz_questions (domain_id, module_id, level, category, question, options, correct_index, explanation, is_active, sort_order, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING id`,
          [q.domain_id, moduleId, q.level, q.category, q.question, JSON.stringify(q.options), q.correct_index, q.explanation, q.is_active, q.sort_order, actorUserId]
        );
        q.resolvedId = rows[0].id;
        summary.quizInserted++;
      } else {
        await c.query(
          `UPDATE quiz_questions SET domain_id=$1, module_id=$2, level=$3, category=$4, question=$5,
             options=$6::jsonb, correct_index=$7, explanation=$8, is_active=$9, sort_order=$10, updated_by=$11 WHERE id=$12`,
          [q.domain_id, moduleId, q.level, q.category, q.question, JSON.stringify(q.options), q.correct_index, q.explanation, q.is_active, q.sort_order, actorUserId, q.id]
        );
        q.resolvedId = q.id;
        summary.quizUpdated++;
      }
    }

    // 6) delete quiz no longer present (scoped) — resolvedId ครอบคลุมแถวใหม่ที่เพิ่ง insert ไปด้วย
    const keptQuizIds = quiz.map((q) => q.resolvedId);
    if (scopeDomainIds.length) {
      const { rows: toDelete } = await c.query(
        `SELECT id FROM quiz_questions WHERE domain_id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))`,
        [scopeDomainIds, keptQuizIds.length ? keptQuizIds : ['00000000-0000-0000-0000-000000000000']]
      );
      if (toDelete.length) {
        await c.query('DELETE FROM quiz_questions WHERE id = ANY($1::uuid[])', [toDelete.map((r) => r.id)]);
        summary.quizDeleted = toDelete.length;
      }
    }
  });

  return summary;
}

/* ============================================================
   Preview token cache (เก็บไฟล์ที่รอ commit ชั่วคราว)
   ============================================================ */
function cleanupExpiredTokens() {
  let files;
  try { files = fs.readdirSync(TMP_DIR); } catch (_) { return; }
  const now = Date.now();
  for (const f of files) {
    if (!f.endsWith('.xlsx')) continue;
    const p = path.join(TMP_DIR, f);
    try {
      if (now - fs.statSync(p).mtimeMs > TOKEN_TTL_MS) fs.rmSync(p, { force: true });
    } catch (_) { /* ignore */ }
  }
}

function saveTokenFile(buffer) {
  cleanupExpiredTokens();
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(TMP_DIR, `${token}.xlsx`), buffer);
  return token;
}

function readTokenFile(token) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new Error('token ไม่ถูกต้อง');
  const p = path.join(TMP_DIR, `${token}.xlsx`);
  if (!fs.existsSync(p)) throw new Error('ไม่พบไฟล์ที่รอ import — อาจหมดอายุแล้ว กรุณาอัปโหลดใหม่');
  return fs.readFileSync(p);
}

function discardTokenFile(token) {
  if (!/^[0-9a-f]{32}$/.test(token)) return;
  fs.rmSync(path.join(TMP_DIR, `${token}.xlsx`), { force: true });
}

/* ---------- high-level flows used by routes ---------- */
async function previewImport(buffer) {
  const parsed = await parseAndValidate(buffer);
  if (parsed.errors.length) return { errors: parsed.errors };
  const diff = await computeDiff(parsed);
  const token = saveTokenFile(buffer);
  return { token, diff };
}

async function commitImport(token, actorUserId) {
  const buffer = readTokenFile(token);
  const parsed = await parseAndValidate(buffer);
  if (parsed.errors.length) {
    discardTokenFile(token);
    throw Object.assign(new Error('ข้อมูลมีปัญหา (อาจเปลี่ยนไปตั้งแต่ตอน preview) กรุณาอัปโหลดใหม่'), { errors: parsed.errors });
  }
  const summary = await applyImport(parsed, actorUserId);
  discardTokenFile(token);
  return summary;
}

module.exports = { buildWorkbook, previewImport, commitImport, discardTokenFile };
