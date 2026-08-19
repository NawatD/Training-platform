/* ============================================================
   Admin console — CRUD for domains / modules / sections / quiz,
   file uploads (video & slides), users and reports.
   ============================================================ */

const LEVEL_LABEL = { foundation: 'Foundation', intermediate: 'Intermediate', advanced: 'Advanced' };
const LEVEL_PILL  = { foundation: 'green', intermediate: 'blue', advanced: 'purple' };
const KIND_LABEL  = { html: '📝 เนื้อหา HTML', video: '🎬 วิดีโอ', slide: '📊 สไลด์', pdf: '📕 PDF', embed: '🔗 Embed' };

const S = {
  user: null,
  page: 'dashboard',
  domains: [],
  activeDomain: null,
  modules: [],
  editingModule: null,
  assets: [],
};

const NAV = [
  { id: 'dashboard', icon: '📊', label: 'ภาพรวม' },
  { id: 'domains',   icon: '🗂', label: 'Domains' },
  { id: 'modules',   icon: '📚', label: 'บทเรียน' },
  { id: 'quiz',      icon: '❓', label: 'แบบทดสอบ' },
  { id: 'assets',    icon: '🎬', label: 'ไฟล์ VDO / สไลด์' },
  { id: 'users',     icon: '👥', label: 'ผู้ใช้งาน' },
  { id: 'backups',   icon: '🗄', label: 'สำรองข้อมูล' },
  { id: 'contentio', icon: '📤', label: 'นำเข้า/ส่งออก' },
];

/* ---------------- boot ---------------- */
(async function boot() {
  const { user } = await API.get('/me');
  if (!user || user.role !== 'admin') {
    document.getElementById('denied').hidden = false;
    return;
  }
  S.user = user;
  document.getElementById('adminRoot').hidden = false;
  document.getElementById('suName').textContent = user.name;
  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault(); await API.post('/logout'); location.href = '/';
  };
  S.domains = await API.get('/domains');
  S.activeDomain = S.domains[0] || null;
  renderNav();

  // ลิงก์แก้ไขหัวข้อเนื้อหาจากคอลัมน์ "เนื้อหา" ใน Excel export (เฉพาะ section kind=html) —
  // รูปแบบ #section=<id>&module=<id> เปิดตรงไปที่หน้าแก้ไขหัวข้อนั้นแทนหน้า dashboard ปกติ
  const deepLink = parseSectionDeepLink();
  if (deepLink) {
    S.page = 'modules';
    renderNav();
    try {
      await editSections(deepLink.moduleId);
      if (deepLink.sectionId) sectionForm(deepLink.sectionId);
      return;
    } catch (e) { /* บทเรียน/หัวข้อถูกลบไปแล้ว หรือเปิดไม่สำเร็จ — ตกไปหน้า dashboard ปกติ */ }
  }
  await goPage('dashboard');
})();

function parseSectionDeepLink() {
  const m = /section=([0-9a-f-]{36})&module=([0-9a-f-]{36})/i.exec(location.hash);
  if (!m) return null;
  return { sectionId: m[1], moduleId: m[2] };
}

function renderNav() {
  document.getElementById('adminNav').innerHTML = NAV.map((n) =>
    `<button class="domain-btn ${S.page === n.id ? 'active' : ''}" onclick="goPage('${n.id}')">
       <span>${n.icon}</span><span>${n.label}</span></button>`).join('');
}

async function goPage(p) {
  S.page = p;
  renderNav();
  const main = document.getElementById('adminMain');
  main.innerHTML = '<div class="loading">กำลังโหลด…</div>';
  const fn = { dashboard: pageDashboard, domains: pageDomains, modules: pageModules,
               quiz: pageQuiz, assets: pageAssets, users: pageUsers, backups: pageBackups,
               contentio: pageContentIO }[p];
  main.innerHTML = await fn();
  window.scrollTo(0, 0);
}

/* ---------------- helpers ---------------- */
function toast(msg, isErr) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function guard(fn) {
  try { await fn(); }
  catch (e) { toast(e.message, true); }
}

function openModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalBackdrop').hidden = false;
}
function closeModal() { document.getElementById('modalBackdrop').hidden = true; }
document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function checked(id) { const el = document.getElementById(id); return el ? el.checked : false; }

// แสดง "แก้ไขล่าสุด" — ใช้ร่วมกันสำหรับบทเรียน/หัวข้อเนื้อหา/คำถาม
// ถ้าไม่มีชื่อผู้แก้ไขบันทึกไว้ (ข้อมูลเก่าก่อนมีฟีเจอร์นี้ หรือมาจาก seed script) ให้ขึ้น "admin" แทนการเว้นว่าง
function fmtUpdated(row) {
  if (!row.updated_at) return '<span class="muted">—</span>';
  const dt = new Date(row.updated_at);
  const when = `${dt.toLocaleDateString('th-TH')} ${dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
  return `${when}<div class="muted">โดย ${esc(row.updated_by_name || 'admin')}</div>`;
}

function domainSelect(id, selected) {
  return `<select id="${id}">${S.domains.map((d) =>
    `<option value="${d.id}" ${d.id === selected ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
}
function levelSelect(id, selected) {
  return `<select id="${id}">${Object.entries(LEVEL_LABEL).map(([k, v]) =>
    `<option value="${k}" ${k === selected ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function pageDashboard() {
  const r = await API.get('/reports/overview');
  const t = r.totals;
  return `<div class="admin-head"><div>
      <h1>ภาพรวมระบบ</h1><p>สรุปเนื้อหาและความคืบหน้าของผู้เรียน</p>
    </div></div>
    <div class="grid-cards">
      <div class="stat-card"><div class="num">${t.active_domains}</div><div class="lbl">Domain ที่เปิดใช้</div></div>
      <div class="stat-card"><div class="num">${t.published_modules}</div><div class="lbl">บทเรียนเผยแพร่แล้ว</div></div>
      <div class="stat-card"><div class="num">${t.quiz_questions}</div><div class="lbl">คำถามในคลัง</div></div>
      <div class="stat-card"><div class="num">${t.assets}</div><div class="lbl">ไฟล์ VDO/สไลด์</div></div>
      <div class="stat-card"><div class="num">${t.learners}</div><div class="lbl">ผู้เรียน</div></div>
    </div>
    <div class="section-title">👥 ความคืบหน้ารายบุคคล</div>
    <div class="panel">${r.learners.length ? `<table class="tbl">
        <tr><th>ชื่อ</th><th>อีเมล</th><th>บทเรียนที่จบ</th><th>ครั้งที่สอบ</th><th>คะแนนสูงสุด</th><th>สอบล่าสุด</th></tr>
        ${r.learners.map((l) => `<tr>
          <td><b>${esc(l.full_name)}</b></td>
          <td class="muted">${esc(l.email)}</td>
          <td>${l.modules_done}</td>
          <td>${l.attempts}</td>
          <td>${l.best_score != null ? Math.round(l.best_score) + '%' : '—'}</td>
          <td class="muted">${l.last_attempt ? new Date(l.last_attempt).toLocaleDateString('th-TH') : '—'}</td>
        </tr>`).join('')}
      </table>` : '<div class="muted">ยังไม่มีผู้เรียนในระบบ</div>'}
    </div>`;
}

/* ============================================================
   DOMAINS
   ============================================================ */
async function pageDomains() {
  S.domains = await API.get('/domains');
  return `<div class="admin-head">
      <div><h1>Domains</h1><p>กลุ่มหลักสูตรตามสายธุรกิจ</p></div>
      <button class="btn btn-primary" onclick="domainForm()">+ เพิ่ม Domain</button>
    </div>
    <div class="panel"><table class="tbl">
      <tr><th>ชื่อ</th><th>Slug</th><th>สถานะ</th><th>บทเรียน</th><th>ลำดับ</th><th></th></tr>
      ${S.domains.map((d) => `<tr>
        <td>${esc(d.icon)} <b>${esc(d.name)}</b><div class="muted">${esc(d.description || '')}</div></td>
        <td class="mono">${esc(d.slug)}</td>
        <td><span class="pill ${d.status === 'active' ? 'green' : d.status === 'soon' ? 'gold' : 'gray'}">${d.status}</span></td>
        <td>${d.module_count}</td>
        <td>${d.sort_order}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" onclick='domainForm(${JSON.stringify(d)})'>แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="delDomain('${d.id}','${esc(d.name)}')">ลบ</button>
        </div></td>
      </tr>`).join('')}
    </table></div>`;
}

function domainForm(d) {
  d = d || {};
  openModal(`<h2>${d.id ? 'แก้ไข' : 'เพิ่ม'} Domain</h2>
    <p class="msub">Domain คือกลุ่มหลักสูตร เช่น Banking, E-Commerce</p>
    <div class="form-grid">
      <div class="field"><label>ชื่อ</label><input id="dName" value="${esc(d.name || '')}"></div>
      <div class="field"><label>Slug (ใช้ใน URL)</label><input id="dSlug" value="${esc(d.slug || '')}" placeholder="banking"></div>
      <div class="field"><label>ไอคอน (emoji)</label><input id="dIcon" value="${esc(d.icon || '📘')}"></div>
      <div class="field"><label>สถานะ</label><select id="dStatus">
        ${['active', 'soon', 'archived'].map((s) => `<option ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
      <div class="field"><label>ลำดับการแสดง</label><input id="dOrder" type="number" value="${d.sort_order || 0}"></div>
      <div class="field full"><label>คำอธิบาย</label><input id="dDesc" value="${esc(d.description || '')}"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveDomain('${d.id || ''}')">บันทึก</button>
    </div>`);
}

function saveDomain(id) {
  guard(async () => {
    const body = {
      name: val('dName'), slug: val('dSlug'), icon: val('dIcon'),
      status: val('dStatus'), sort_order: parseInt(val('dOrder') || '0', 10),
      description: val('dDesc'),
    };
    if (!body.name || !body.slug) throw new Error('กรุณากรอกชื่อและ slug');
    if (id) await API.patch('/domains/' + id, body); else await API.post('/domains', body);
    closeModal(); toast('บันทึกแล้ว'); S.domains = await API.get('/domains'); goPage('domains');
  });
}

function delDomain(id, name) {
  if (!confirm(`ลบ domain "${name}" พร้อมบทเรียนและคำถามทั้งหมด?`)) return;
  guard(async () => {
    await API.del('/domains/' + id);
    toast('ลบแล้ว'); S.domains = await API.get('/domains'); goPage('domains');
  });
}

/* ============================================================
   MODULES + SECTIONS
   ============================================================ */
async function pageModules() {
  if (!S.domains.length) return `<div class="empty-state">สร้าง Domain ก่อนเพิ่มบทเรียน</div>`;
  if (!S.activeDomain) S.activeDomain = S.domains[0];
  const data = await API.get(`/domains/${S.activeDomain.slug}/modules`);
  S.modules = data.modules;

  return `<div class="admin-head">
      <div><h1>บทเรียน</h1><p>เพิ่ม ลด แก้ไขเนื้อหา — รองรับ HTML, วิดีโอ, สไลด์, PDF และ embed</p></div>
      <div style="display:flex;gap:9px;align-items:center">
        <select onchange="switchDomain(this.value)" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;font-family:inherit;font-size:13.3px">
          ${S.domains.map((d) => `<option value="${d.slug}" ${d.slug === S.activeDomain.slug ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="moduleForm()">+ เพิ่มบทเรียน</button>
      </div>
    </div>
    <div class="panel">${S.modules.length ? `<table class="tbl">
      <tr><th style="width:60px">ลำดับ</th><th>ชื่อบทเรียน</th><th>ระดับ</th><th>เวลา</th><th>หัวข้อ</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr>
      ${S.modules.map((m, i) => `<tr>
        <td><div style="display:flex;align-items:center;gap:6px"><span class="mono">${m.sort_order}</span>
          <div class="order-btns">
            <button ${i === 0 ? 'disabled' : ''} onclick="moveModule(${i},-1)">▲</button>
            <button ${i === S.modules.length - 1 ? 'disabled' : ''} onclick="moveModule(${i},1)">▼</button>
          </div></div></td>
        <td><b>${esc(m.title)}</b><div class="muted">${esc(m.summary || '')}</div></td>
        <td><span class="pill ${LEVEL_PILL[m.level]}">${LEVEL_LABEL[m.level]}</span></td>
        <td class="muted">${esc(m.duration || '—')}</td>
        <td>${m.section_count}</td>
        <td><span class="pill ${m.is_published ? 'green' : 'gray'}">${m.is_published ? 'เผยแพร่' : 'ร่าง'}</span></td>
        <td class="muted">${fmtUpdated(m)}</td>
        <td><div class="actions">
          <button class="btn btn-dark btn-sm" onclick="editSections('${m.id}')">เนื้อหา</button>
          <button class="btn btn-ghost btn-sm" onclick='moduleForm(${JSON.stringify(m).replace(/'/g, "&#39;")})'>แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="delModule('${m.id}')">ลบ</button>
        </div></td>
      </tr>`).join('')}
    </table>` : '<div class="muted">ยังไม่มีบทเรียนใน domain นี้</div>'}</div>`;
}

function switchDomain(slug) {
  S.activeDomain = S.domains.find((d) => d.slug === slug);
  goPage(S.page);
}

function moveModule(i, dir) {
  guard(async () => {
    const arr = S.modules.slice();
    const j = i + dir;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await API.post('/modules/reorder', { order: arr.map((m) => m.id) });
    goPage('modules');
  });
}

function moduleForm(m) {
  m = m || {};
  openModal(`<h2>${m.id ? 'แก้ไข' : 'เพิ่ม'}บทเรียน</h2>
    <p class="msub">ข้อมูลหลักของบทเรียน — เนื้อหาแยกจัดการที่ปุ่ม "เนื้อหา"</p>
    <div class="form-grid">
      <div class="field full"><label>ชื่อบทเรียน</label><input id="mTitle" value="${esc(m.title || '')}"></div>
      <div class="field full"><label>คำอธิบายสั้น</label><input id="mSummary" value="${esc(m.summary || '')}"></div>
      <div class="field"><label>Domain</label>${domainSelect('mDomain', m.domain_id || S.activeDomain.id)}</div>
      <div class="field"><label>ระดับ</label>${levelSelect('mLevel', m.level || 'foundation')}</div>
      <div class="field"><label>เวลาโดยประมาณ</label><input id="mDuration" value="${esc(m.duration || '')}" placeholder="15 นาที"></div>
      <div class="field"><label>รหัส (ไม่บังคับ)</label><input id="mCode" value="${esc(m.code || '')}" placeholder="m1"></div>
      <div class="field full"><label>คำศัพท์สำคัญ (คั่นด้วยจุลภาค)</label>
        <input id="mTerms" value="${esc((m.key_terms || []).join(', '))}"></div>
      <div class="field full"><label style="display:flex;gap:8px;align-items:center;font-size:13px">
        <input type="checkbox" id="mPublished" ${m.is_published === false ? '' : 'checked'} style="width:auto"> เผยแพร่ให้ผู้เรียนเห็น</label></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveModule('${m.id || ''}')">บันทึก</button>
    </div>`);
}

function saveModule(id) {
  guard(async () => {
    const body = {
      title: val('mTitle'), summary: val('mSummary'), domain_id: val('mDomain'),
      level: val('mLevel'), duration: val('mDuration'), code: val('mCode'),
      key_terms: val('mTerms').split(',').map((s) => s.trim()).filter(Boolean),
      is_published: checked('mPublished'),
    };
    if (!body.title) throw new Error('กรุณากรอกชื่อบทเรียน');
    if (id) await API.patch('/modules/' + id, body); else await API.post('/modules', body);
    closeModal(); toast('บันทึกแล้ว'); goPage('modules');
  });
}

function delModule(id) {
  if (!confirm('ลบบทเรียนนี้พร้อมเนื้อหาทั้งหมด?')) return;
  guard(async () => { await API.del('/modules/' + id); toast('ลบแล้ว'); goPage('modules'); });
}

/* ---------- section editor ---------- */
async function editSections(moduleId) {
  const m = await API.get('/modules/' + moduleId);
  S.editingModule = m;
  renderSectionEditor();
}

function renderSectionEditor() {
  const m = S.editingModule;
  document.getElementById('adminMain').innerHTML = `
    <div class="admin-head">
      <div>
        <div class="back-link" onclick="goPage('modules')">← กลับไปรายการบทเรียน</div>
        <h1>${esc(m.title)}</h1>
        <p>จัดการหัวข้อเนื้อหาในบทเรียนนี้ · <span class="muted">แก้ไขล่าสุด ${fmtUpdated(m)}</span></p>
      </div>
      <button class="btn btn-primary" onclick="sectionForm()">+ เพิ่มหัวข้อ</button>
    </div>
    <div class="panel">
      ${m.sections.length ? m.sections.map((s, i) => `
        <div class="sec-row">
          <div class="sec-row-head">
            <div class="order-btns">
              <button ${i === 0 ? 'disabled' : ''} onclick="moveSection(${i},-1)">▲</button>
              <button ${i === m.sections.length - 1 ? 'disabled' : ''} onclick="moveSection(${i},1)">▼</button>
            </div>
            <b>${esc(s.heading || '(ไม่มีหัวข้อ)')}</b>
            <span class="pill gray">${KIND_LABEL[s.kind] || s.kind}</span>
            <button class="btn btn-ghost btn-sm" onclick="sectionForm('${s.id}')">แก้ไข</button>
            <button class="btn btn-danger btn-sm" onclick="delSection('${s.id}')">ลบ</button>
          </div>
          <div class="sec-preview">${s.asset_id
            ? '📎 ' + esc(s.asset_name || '') + ' · ' + fmtSize(s.asset_size)
            : esc((s.body || '').replace(/<[^>]+>/g, ' ').slice(0, 160))}</div>
          <div class="sec-preview muted" style="margin-top:2px">แก้ไขล่าสุด ${fmtUpdated(s)}</div>
        </div>`).join('')
      : '<div class="muted">ยังไม่มีหัวข้อในบทเรียนนี้</div>'}
    </div>`;
}

async function sectionForm(sectionId) {
  const s = sectionId ? S.editingModule.sections.find((x) => x.id === sectionId) : {};
  if (!S.assets.length) S.assets = await API.get('/assets');
  const kind = s.kind || 'html';

  openModal(`<h2>${sectionId ? 'แก้ไข' : 'เพิ่ม'}หัวข้อ</h2>
    <p class="msub">เลือกประเภทเนื้อหา — วิดีโอ/สไลด์/PDF ให้เลือกไฟล์ที่อัปโหลดไว้แล้ว</p>
    <div class="form-grid">
      <div class="field full"><label>หัวข้อ</label><input id="sHeading" value="${esc(s.heading || '')}"></div>
      <div class="field"><label>ประเภท</label>
        <select id="sKind" onchange="toggleKindFields()">
          ${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      <div class="field" id="assetField">
        <label id="assetLabel">ไฟล์ที่แนบ</label>
        <select id="sAsset">
          <option value="">— ไม่แนบไฟล์ —</option>
          ${S.assets.map((a) => `<option value="${a.id}" ${a.id === s.asset_id ? 'selected' : ''}>
            ${esc(a.original_name)} (${a.kind}, ${fmtSize(a.size_bytes)})</option>`).join('')}
        </select>
        <div class="hint" id="assetHint">ยังไม่มีไฟล์? อัปโหลดที่เมนู "ไฟล์ VDO / สไลด์"</div>
      </div>
      <div class="field full"><label id="bodyLabel">เนื้อหา (HTML)</label>
        <textarea id="sBody" class="code">${esc(s.body || '')}</textarea>
        <div class="hint" id="bodyHint">ใส่ HTML ได้ เช่น &lt;p&gt;, &lt;ul&gt;, และคลาสจากธีม: callout, callout qa, term-grid, diagram-box</div>
        ${sectionId ? `<button type="button" class="btn btn-ghost btn-sm" id="convertToFileBtn" style="margin-top:8px"
            onclick="convertSectionToFile('${sectionId}')">📄 แปลงเนื้อหานี้เป็นไฟล์ HTML แนบแทน</button>` : ''}
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveSection('${sectionId || ''}')">บันทึก</button>
    </div>`);
  toggleKindFields();
}

function toggleKindFields() {
  const kind = val('sKind');
  const needsAsset = ['video', 'slide', 'pdf'].includes(kind); // ต้องมีไฟล์แนบเสมอ
  const optionalHtmlAsset = kind === 'html'; // เนื้อหายาว/ซับซ้อน แนบไฟล์ .html ที่อัปโหลดไว้แทนการพิมพ์ได้ (ไม่บังคับ)
  document.getElementById('assetField').style.display = (needsAsset || optionalHtmlAsset) ? '' : 'none';
  document.getElementById('assetLabel').textContent = optionalHtmlAsset ? 'ไฟล์ HTML ที่แนบ (ไม่บังคับ)' : 'ไฟล์ที่แนบ';
  document.getElementById('assetHint').textContent = optionalHtmlAsset
    ? 'ถ้าเนื้อหายาว/ซับซ้อน แนบไฟล์ .html ที่อัปโหลดไว้แทนได้ — จะใช้เนื้อหาจากไฟล์แทนข้อความด้านล่างทันที ยังไม่มีไฟล์? อัปโหลดที่เมนู "ไฟล์ VDO / สไลด์"'
    : 'ยังไม่มีไฟล์? อัปโหลดที่เมนู "ไฟล์ VDO / สไลด์"';
  const convertBtn = document.getElementById('convertToFileBtn');
  if (convertBtn) convertBtn.style.display = optionalHtmlAsset ? '' : 'none';
  const label = document.getElementById('bodyLabel');
  const hint = document.getElementById('bodyHint');
  if (kind === 'embed') {
    label.textContent = 'URL ที่จะฝัง';
    hint.textContent = 'เช่น ลิงก์ YouTube แบบ /embed/ หรือ Google Slides แบบ /embed';
  } else if (needsAsset) {
    label.textContent = 'คำบรรยายเพิ่มเติม (ไม่บังคับ)';
    hint.textContent = 'ข้อความสั้นๆ ที่แสดงใต้ไฟล์';
  } else if (optionalHtmlAsset) {
    label.textContent = 'เนื้อหา (HTML) — ใช้เมื่อไม่ได้แนบไฟล์ด้านบน';
    hint.textContent = 'ใส่ HTML ได้ เช่น <p>, <ul>, และคลาสจากธีม: callout, callout qa, term-grid, diagram-box — ถ้าแนบไฟล์ HTML ไว้ด้านบน ข้อความในนี้จะไม่ถูกใช้';
  } else {
    label.textContent = 'เนื้อหา (HTML)';
    hint.textContent = 'ใส่ HTML ได้ เช่น <p>, <ul>, และคลาสจากธีม: callout, callout qa, term-grid, diagram-box';
  }
}

function saveSection(id) {
  guard(async () => {
    const kind = val('sKind');
    const assetPickable = ['video', 'slide', 'pdf', 'html'].includes(kind);
    const assetId = assetPickable ? (val('sAsset') || null) : null;
    // kind=html: ถ้าแนบไฟล์ HTML ไว้ ให้ใช้ไฟล์นั้นแทน ไม่เก็บข้อความในกล่องซ้ำไว้ในฐานข้อมูล
    const bodyText = (kind === 'html' && assetId) ? null : document.getElementById('sBody').value;
    const body = { heading: val('sHeading'), kind, body: bodyText, asset_id: assetId };
    if (['video', 'slide', 'pdf'].includes(kind) && !assetId) throw new Error('กรุณาเลือกไฟล์ที่แนบ');
    if (kind === 'html' && !assetId && !bodyText.trim()) throw new Error('กรุณาใส่เนื้อหา HTML หรือแนบไฟล์ HTML');
    if (id) await API.patch('/sections/' + id, body);
    else await API.post('/sections', { ...body, module_id: S.editingModule.id });
    closeModal(); toast('บันทึกแล้ว');
    S.editingModule = await API.get('/modules/' + S.editingModule.id);
    renderSectionEditor();
  });
}

// เอาข้อความ HTML ที่พิมพ์อยู่ในกล่อง ไปสร้างเป็นไฟล์ .html แนบไว้แทน (บันทึกทันที) — ไม่ต้อง copy ไปเซฟเป็นไฟล์เองแล้วอัปโหลดกลับมา
function convertSectionToFile(id) {
  if (!id) { toast('บันทึกหัวข้อนี้ก่อน แล้วค่อยแปลงเป็นไฟล์', true); return; }
  const bodyText = document.getElementById('sBody').value;
  if (!bodyText.trim()) { toast('ไม่มีเนื้อหาในกล่องให้แปลงเป็นไฟล์', true); return; }
  if (!confirm('แปลงเนื้อหานี้เป็นไฟล์ .html แล้วแนบแทนข้อความในกล่อง? ระบบจะบันทึกทันที')) return;
  guard(async () => {
    await API.post('/sections/' + id + '/convert-to-file', { body: bodyText });
    toast('แปลงเป็นไฟล์แล้ว');
    S.assets = [];
    closeModal();
    S.editingModule = await API.get('/modules/' + S.editingModule.id);
    renderSectionEditor();
  });
}

function delSection(id) {
  if (!confirm('ลบหัวข้อนี้?')) return;
  guard(async () => {
    await API.del('/sections/' + id);
    S.editingModule = await API.get('/modules/' + S.editingModule.id);
    renderSectionEditor(); toast('ลบแล้ว');
  });
}

function moveSection(i, dir) {
  guard(async () => {
    const arr = S.editingModule.sections.slice();
    const j = i + dir;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await API.post('/sections/reorder', { order: arr.map((s) => s.id) });
    S.editingModule = await API.get('/modules/' + S.editingModule.id);
    renderSectionEditor();
  });
}

/* ============================================================
   QUIZ
   ============================================================ */
async function pageQuiz() {
  if (!S.activeDomain) return `<div class="empty-state">สร้าง Domain ก่อน</div>`;
  const data = await API.get(`/domains/${S.activeDomain.slug}/quiz`);
  const qs = data.questions;

  return `<div class="admin-head">
      <div><h1>คลังคำถาม</h1><p>คำถามแบบเลือกตอบ ตรวจคำตอบที่ฝั่งเซิร์ฟเวอร์</p></div>
      <div style="display:flex;gap:9px;align-items:center">
        <select onchange="switchDomain(this.value)" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;font-family:inherit;font-size:13.3px">
          ${S.domains.map((d) => `<option value="${d.slug}" ${d.slug === S.activeDomain.slug ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="quizForm()">+ เพิ่มคำถาม</button>
      </div>
    </div>
    <div class="panel">${qs.length ? `<table class="tbl">
      <tr><th>คำถาม</th><th>ระดับ</th><th>หมวด</th><th>คำตอบที่ถูก</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr>
      ${qs.map((q) => `<tr>
        <td style="max-width:420px"><b>${esc(q.question)}</b></td>
        <td><span class="pill ${LEVEL_PILL[q.level]}">${LEVEL_LABEL[q.level]}</span></td>
        <td class="muted">${esc(q.category || '—')}</td>
        <td class="muted">${esc(q.options[q.correct_index] || '')}</td>
        <td><span class="pill ${q.is_active ? 'green' : 'gray'}">${q.is_active ? 'ใช้งาน' : 'ปิด'}</span></td>
        <td class="muted">${fmtUpdated(q)}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" onclick='quizForm(${JSON.stringify(q).replace(/'/g, "&#39;")})'>แก้ไข</button>
          <button class="btn btn-danger btn-sm" onclick="delQuiz('${q.id}')">ลบ</button>
        </div></td>
      </tr>`).join('')}
    </table>` : '<div class="muted">ยังไม่มีคำถามใน domain นี้</div>'}</div>`;
}

function quizForm(q) {
  q = q || {};
  const opts = q.options || ['', '', '', ''];
  openModal(`<h2>${q.id ? 'แก้ไข' : 'เพิ่ม'}คำถาม</h2>
    <p class="msub">เลือกตัวเลือกที่ถูกต้องด้วยปุ่มวงกลมด้านซ้าย</p>
    <div class="form-grid">
      <div class="field full"><label>คำถาม</label><textarea id="qText" style="min-height:70px">${esc(q.question || '')}</textarea></div>
      <div class="field"><label>Domain</label>${domainSelect('qDomain', q.domain_id || S.activeDomain.id)}</div>
      <div class="field"><label>ระดับ</label>${levelSelect('qLevel', q.level || 'foundation')}</div>
      <div class="field"><label>หมวดหมู่</label><input id="qCat" value="${esc(q.category || '')}"></div>
      <div class="field full"><label>ตัวเลือก (เลือกข้อที่ถูก)</label>
        ${opts.map((o, i) => `<div style="display:flex;gap:9px;align-items:center;margin-bottom:7px">
          <input type="radio" name="qc" value="${i}" ${q.correct_index === i || (q.correct_index == null && i === 0) ? 'checked' : ''} style="width:auto">
          <input id="qOpt${i}" value="${esc(o)}" placeholder="ตัวเลือกที่ ${i + 1}" style="flex:1">
        </div>`).join('')}
      </div>
      <div class="field full"><label>คำอธิบายเฉลย</label><textarea id="qExp" style="min-height:80px">${esc(q.explanation || '')}</textarea></div>
      <div class="field full"><label style="display:flex;gap:8px;align-items:center;font-size:13px">
        <input type="checkbox" id="qActive" ${q.is_active === false ? '' : 'checked'} style="width:auto"> เปิดใช้งานคำถามนี้</label></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveQuiz('${q.id || ''}')">บันทึก</button>
    </div>`);
}

function saveQuiz(id) {
  guard(async () => {
    const options = [0, 1, 2, 3].map((i) => val('qOpt' + i)).filter((v) => v !== '');
    const picked = document.querySelector('input[name=qc]:checked');
    const correct_index = picked ? parseInt(picked.value, 10) : 0;
    if (!val('qText')) throw new Error('กรุณากรอกคำถาม');
    if (options.length < 2) throw new Error('ต้องมีตัวเลือกอย่างน้อย 2 ข้อ');
    if (correct_index >= options.length) throw new Error('ข้อที่เลือกว่าถูกต้องยังว่างอยู่');
    const body = {
      domain_id: val('qDomain'), level: val('qLevel'), category: val('qCat'),
      question: val('qText'), options, correct_index,
      explanation: val('qExp'), is_active: checked('qActive'),
    };
    if (id) await API.patch('/quiz/' + id, body); else await API.post('/quiz', body);
    closeModal(); toast('บันทึกแล้ว'); goPage('quiz');
  });
}

function delQuiz(id) {
  if (!confirm('ลบคำถามนี้?')) return;
  guard(async () => { await API.del('/quiz/' + id); toast('ลบแล้ว'); goPage('quiz'); });
}

/* ============================================================
   ASSETS (video / slides / pdf)
   ============================================================ */
async function pageAssets() {
  S.assets = await API.get('/assets');
  return `<div class="admin-head">
      <div><h1>ไฟล์ VDO / สไลด์</h1><p>อัปโหลดไฟล์แล้วนำไปแนบกับหัวข้อในบทเรียน</p></div>
    </div>
    <div class="panel">
      <h2>อัปโหลดไฟล์ใหม่</h2>
      <div class="upload-drop" id="dropZone" onclick="document.getElementById('fileInput').click()">
        คลิกเพื่อเลือกไฟล์ หรือ ลากไฟล์มาวางที่นี่<br>
        <span class="muted">รองรับ MP4/WebM/MOV, PPTX/PPT/ODP, PDF, รูปภาพ และไฟล์ HTML</span>
      </div>
      <input type="file" id="fileInput" hidden multiple>
      <div class="progress-line" id="upBar" hidden><i></i></div>
    </div>
    <div class="panel"><h2>ไฟล์ทั้งหมด (${S.assets.length})</h2>
      ${S.assets.length ? `<table class="tbl">
        <tr><th>ชื่อไฟล์</th><th>ประเภท</th><th>ขนาด</th><th>อัปโหลดโดย</th><th>วันที่</th><th></th></tr>
        ${S.assets.map((a) => `<tr>
          <td><b>${esc(a.original_name)}</b><div class="mono">${esc(a.mime_type)}</div></td>
          <td><span class="pill ${a.kind === 'video' ? 'purple' : a.kind === 'slide' ? 'blue' : a.kind === 'html' ? 'green' : 'gray'}">${a.kind}</span></td>
          <td>${fmtSize(a.size_bytes)}</td>
          <td class="muted">${esc(a.uploader || '—')}</td>
          <td class="muted">${new Date(a.created_at).toLocaleDateString('th-TH')}</td>
          <td><div class="actions">
            <a class="btn btn-ghost btn-sm" style="text-decoration:none" href="/api/assets/${a.id}/file" target="_blank">เปิด</a>
            <button class="btn btn-danger btn-sm" onclick="delAsset('${a.id}')">ลบ</button>
          </div></td>
        </tr>`).join('')}
      </table>` : '<div class="muted">ยังไม่มีไฟล์</div>'}
    </div>`;
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'fileInput') uploadFiles(e.target.files);
});
document.addEventListener('dragover', (e) => {
  const dz = document.getElementById('dropZone');
  if (dz) { e.preventDefault(); dz.classList.add('on'); }
});
document.addEventListener('dragleave', () => {
  const dz = document.getElementById('dropZone');
  if (dz) dz.classList.remove('on');
});
document.addEventListener('drop', (e) => {
  const dz = document.getElementById('dropZone');
  if (!dz) return;
  e.preventDefault(); dz.classList.remove('on');
  uploadFiles(e.dataTransfer.files);
});

function uploadFiles(files) {
  if (!files || !files.length) return;
  const bar = document.getElementById('upBar');
  const fill = bar.querySelector('i');
  bar.hidden = false;

  let done = 0;
  const list = Array.from(files);
  const next = () => {
    if (done >= list.length) {
      bar.hidden = true; fill.style.width = '0';
      toast(`อัปโหลดสำเร็จ ${list.length} ไฟล์`);
      S.assets = []; goPage('assets');
      return;
    }
    const fd = new FormData();
    fd.append('file', list[done]);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/assets');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = ((done + ev.loaded / ev.total) / list.length) * 100;
        fill.style.width = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 400) {
        let msg = 'อัปโหลดไม่สำเร็จ';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
        toast(msg, true); bar.hidden = true; return;
      }
      done++; next();
    };
    xhr.onerror = () => { toast('อัปโหลดไม่สำเร็จ', true); bar.hidden = true; };
    xhr.send(fd);
  };
  next();
}

function delAsset(id) {
  if (!confirm('ลบไฟล์นี้? หัวข้อที่แนบไฟล์นี้อยู่จะไม่มีไฟล์แสดง')) return;
  guard(async () => { await API.del('/assets/' + id); S.assets = []; toast('ลบแล้ว'); goPage('assets'); });
}

/* ============================================================
   USERS
   ============================================================ */
async function pageUsers() {
  const users = await API.get('/users');
  return `<div class="admin-head">
      <div><h1>ผู้ใช้งาน</h1><p>ทุกคนในบริษัท login ผ่าน Microsoft 365 ได้เองอยู่แล้ว (สร้างบัญชีอัตโนมัติเป็น learner ตอน login ครั้งแรก) —
        หน้านี้ใช้กำหนดว่าใครเป็น admin เท่านั้น</p></div>
      <button class="btn btn-primary" onclick="userForm()">+ จองสิทธิ์ล่วงหน้า</button>
    </div>
    <div class="panel"><table class="tbl">
      <tr><th>ชื่อ</th><th>อีเมล</th><th>สิทธิ์</th><th>สถานะ</th><th>สร้างเมื่อ</th><th></th></tr>
      ${users.map((u) => `<tr>
        <td><b>${esc(u.full_name)}</b></td>
        <td class="muted">${esc(u.email)}</td>
        <td><span class="pill ${u.role === 'admin' ? 'purple' : 'blue'}">${u.role}</span></td>
        <td><span class="pill ${u.is_active ? 'green' : 'gray'}">${u.is_active ? 'ใช้งาน' : 'ปิด'}</span></td>
        <td class="muted">${new Date(u.created_at).toLocaleDateString('th-TH')}</td>
        <td><div class="actions">
          <button class="btn btn-ghost btn-sm" onclick='userForm(${JSON.stringify(u)})'>แก้ไข</button>
          ${u.id !== S.user.id ? `<button class="btn btn-danger btn-sm" onclick="delUser('${u.id}')">ลบ</button>` : ''}
        </div></td>
      </tr>`).join('')}
    </table></div>`;
}

function userForm(u) {
  u = u || {};
  openModal(`<h2>${u.id ? 'แก้ไข' : 'จองสิทธิ์'}ผู้ใช้</h2>
    <p class="msub">${u.id ? 'ปรับสิทธิ์หรือปิดใช้งานบัญชีนี้' : 'เตรียมอีเมลนี้ไว้ล่วงหน้า (เช่นตั้งเป็น admin) — พอเจ้าของอีเมล login ผ่าน Microsoft 365 ครั้งแรก ระบบจะจับคู่ให้อัตโนมัติ'}</p>
    <div class="form-grid">
      <div class="field"><label>ชื่อ-นามสกุล</label><input id="uName" value="${esc(u.full_name || '')}"></div>
      <div class="field"><label>อีเมล (ต้องตรงกับ Microsoft 365)</label><input id="uEmail" type="email" value="${esc(u.email || '')}" ${u.id ? 'disabled' : ''}></div>
      <div class="field"><label>สิทธิ์</label><select id="uRole">
        <option value="learner" ${u.role === 'learner' ? 'selected' : ''}>learner</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
      </select></div>
      ${u.id ? `<div class="field full"><label style="display:flex;gap:8px;align-items:center;font-size:13px">
        <input type="checkbox" id="uActive" ${u.is_active ? 'checked' : ''} style="width:auto"> เปิดใช้งานบัญชี</label></div>` : ''}
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="saveUser('${u.id || ''}')">บันทึก</button>
    </div>`);
}

function saveUser(id) {
  guard(async () => {
    if (id) {
      const body = { full_name: val('uName'), role: val('uRole'), is_active: checked('uActive') };
      await API.patch('/users/' + id, body);
    } else {
      if (!val('uEmail') || !val('uName')) throw new Error('กรอกข้อมูลให้ครบ');
      await API.post('/users', { email: val('uEmail'), full_name: val('uName'), role: val('uRole') });
    }
    closeModal(); toast('บันทึกแล้ว'); goPage('users');
  });
}

function delUser(id) {
  if (!confirm('ลบผู้ใช้นี้พร้อมประวัติการเรียน?')) return;
  guard(async () => { await API.del('/users/' + id); toast('ลบแล้ว'); goPage('users'); });
}

/* ============================================================
   BACKUPS
   ============================================================ */
async function pageBackups() {
  const data = await API.get('/backups');
  const items = data.items;
  const manualCount = items.filter((b) => b.type === 'manual').length;
  const autoCount = items.filter((b) => b.type === 'auto').length;

  return `<div class="admin-head">
      <div><h1>สำรองข้อมูล</h1>
        <p>สำรองฐานข้อมูลทั้งหมด (domain, บทเรียน, คำถาม, ผู้ใช้, ความคืบหน้า) และไฟล์สื่อที่อัปโหลด —
        ระบบสำรองอัตโนมัติให้ทุกวัน เก็บย้อนหลัง ${data.retentionDays} วันล่าสุด
        ส่วน backup ที่กดเองจะไม่ถูกลบอัตโนมัติ</p></div>
      <button class="btn btn-primary" onclick="backupNow()">🗄 สำรองข้อมูลตอนนี้</button>
    </div>
    <div class="grid-cards">
      <div class="stat-card"><div class="num">${items.length}</div><div class="lbl">Backup ทั้งหมด</div></div>
      <div class="stat-card"><div class="num">${manualCount}</div><div class="lbl">กดเอง (เก็บถาวร)</div></div>
      <div class="stat-card"><div class="num">${autoCount}</div><div class="lbl">อัตโนมัติ (เก็บ ${data.retentionDays} วัน)</div></div>
    </div>
    <div class="panel">${items.length ? `<table class="tbl">
      <tr><th>วันที่-เวลา</th><th>ประเภท</th><th>ขนาด</th><th>เนื้อหา</th><th>ไฟล์สื่อ</th><th></th></tr>
      ${items.map((b) => `<tr>
        <td><b>${new Date(b.createdAt).toLocaleString('th-TH')}</b>${b.label ? `<div class="muted">${esc(b.label)}</div>` : ''}</td>
        <td><span class="pill ${b.type === 'manual' ? 'blue' : 'gray'}">${b.type === 'manual' ? 'กดเอง' : 'อัตโนมัติ'}</span></td>
        <td>${fmtSize(b.sizeBytes)}</td>
        <td class="muted">${b.tableCounts.domains} domain · ${b.tableCounts.modules} บทเรียน · ${b.tableCounts.quiz_questions} คำถาม · ${b.tableCounts.users} ผู้ใช้</td>
        <td class="muted">${b.mediaCount} ไฟล์${b.mediaMissing ? ` <span style="color:var(--danger,#c0392b)">(หาย ${b.mediaMissing})</span>` : ''}</td>
        <td><div class="actions">
          <button class="btn btn-dark btn-sm" onclick="restoreBackupNow('${b.id}')">กู้คืน</button>
          <button class="btn btn-danger btn-sm" onclick="deleteBackupNow('${b.id}')">ลบ</button>
        </div></td>
      </tr>`).join('')}
    </table>` : '<div class="muted">ยังไม่มี backup — กดปุ่ม "สำรองข้อมูลตอนนี้" เพื่อเริ่มต้น</div>'}</div>`;
}

function backupNow() {
  guard(async () => {
    toast('กำลังสำรองข้อมูล…');
    await API.post('/backups', {});
    toast('สำรองข้อมูลสำเร็จ');
    goPage('backups');
  });
}

function restoreBackupNow(id) {
  if (!confirm('กู้คืนจาก backup นี้?\n\nข้อมูลปัจจุบันทั้งหมด (domain, บทเรียน, คำถาม, ผู้ใช้, ความคืบหน้า) และไฟล์สื่อ จะถูกแทนที่ด้วยข้อมูลใน backup นี้ — ทำย้อนกลับไม่ได้ เว้นแต่จะกู้คืนจาก backup อื่นอีกครั้ง'))
    return;
  guard(async () => {
    toast('กำลังกู้คืนข้อมูล…');
    await API.post(`/backups/${id}/restore`, {});
    toast('กู้คืนข้อมูลสำเร็จ — หากเมนูใดแสดงผลผิดปกติ ลองออกจากระบบแล้วเข้าใหม่');
    S.domains = await API.get('/domains');
    S.activeDomain = S.domains[0] || null;
    goPage('backups');
  });
}

function deleteBackupNow(id) {
  if (!confirm('ลบ backup นี้ถาวร?')) return;
  guard(async () => { await API.del('/backups/' + id); toast('ลบแล้ว'); goPage('backups'); });
}

/* ============================================================
   CONTENT IMPORT / EXPORT (Excel)
   ============================================================ */
async function pageContentIO() {
  S.domains = await API.get('/domains');
  return `<div class="admin-head">
      <div><h1>นำเข้า/ส่งออก</h1><p>ส่งออกบทเรียนและคำถามเป็น Excel เพื่อแก้ไขง่ายๆ แล้วนำเข้ากลับได้</p></div>
    </div>
    <div class="panel">
      <h2>ส่งออก</h2>
      <p class="msub">ไฟล์ .xlsx จะมี 3 sheet: บทเรียน, หัวข้อเนื้อหา, คำถาม — พร้อมคำแนะนำวิธีใช้ในไฟล์</p>
      <div style="display:flex;gap:9px;align-items:center;margin-top:11px">
        <select id="ioExportDomain" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;font-family:inherit;font-size:13.3px">
          <option value="">— ทุก domain —</option>
          ${S.domains.map((d) => `<option value="${d.slug}">${esc(d.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" onclick="exportContent()">⬇️ ดาวน์โหลด Excel</button>
      </div>
    </div>
    <div class="panel">
      <h2>นำเข้า</h2>
      <p class="msub">เลือกไฟล์ที่แก้ไขแล้ว ระบบจะตรวจสอบและแสดงสรุปการเปลี่ยนแปลงให้ยืนยันก่อนบันทึกจริงเสมอ —
        แถวที่ถูกลบออกจากไฟล์จะถูกลบออกจากระบบด้วย (เฉพาะ domain ที่อยู่ในไฟล์)</p>
      <div style="display:flex;gap:9px;align-items:center;margin-top:11px">
        <input type="file" id="ioFileInput" accept=".xlsx">
        <button class="btn btn-dark" onclick="previewImportFile()">ตรวจสอบไฟล์</button>
      </div>
      <div id="ioResult" style="margin-top:14px"></div>
    </div>
    <div class="panel">
      <h2>แปลงเนื้อหา HTML เป็นไฟล์แนบทั้งหมด</h2>
      <p class="msub">หัวข้อประเภท HTML ทุกหัวข้อที่พิมพ์เนื้อหาไว้ในกล่องโดยตรง (ไม่ว่ายาวหรือสั้น) จะถูกแปลงเป็นไฟล์ .html แนบแทนให้ทีเดียวทั้งหมด —
        ระบบจะถามยืนยันจำนวนก่อนเขียนอะไรเสมอ</p>
      <div style="display:flex;gap:9px;align-items:center;margin-top:11px">
        <select id="ioConvertDomain" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:9px;font-family:inherit;font-size:13.3px">
          <option value="">— ทุก domain —</option>
          ${S.domains.map((d) => `<option value="${d.slug}">${esc(d.name)}</option>`).join('')}
        </select>
        <button class="btn btn-dark" onclick="bulkConvertHtml()">📄 แปลงทั้งหมดเป็นไฟล์</button>
      </div>
    </div>`;
}

function exportContent() {
  const domain = val('ioExportDomain');
  window.location.href = '/api/content-export/export' + (domain ? `?domain=${encodeURIComponent(domain)}` : '');
}

function bulkConvertHtml() {
  guard(async () => {
    const domain = val('ioConvertDomain');
    const qs = domain ? '?domain=' + encodeURIComponent(domain) : '';
    const prev = await API.get('/sections/bulk-convert-preview' + qs);
    if (!prev.count) { toast('ไม่มีหัวข้อ HTML ที่พิมพ์เนื้อหาไว้ในกล่องให้แปลง'); return; }
    if (!confirm(`จะแปลงเนื้อหา ${prev.count} หัวข้อเป็นไฟล์ .html แนบแทนทั้งหมด — ดำเนินการต่อ?`)) return;
    toast('กำลังแปลง…');
    const result = await API.post('/sections/bulk-convert-to-file', { domain: domain || null });
    toast(`แปลงสำเร็จ ${result.converted} หัวข้อ`);
  });
}

function previewImportFile() {
  guard(async () => {
    const input = document.getElementById('ioFileInput');
    if (!input.files.length) throw new Error('กรุณาเลือกไฟล์');
    const fd = new FormData();
    fd.append('file', input.files[0]);
    document.getElementById('ioResult').innerHTML = '<div class="loading">กำลังตรวจสอบ…</div>';
    let res;
    try {
      res = await API.upload('/content-export/import/preview', fd);
    } catch (e) {
      if (e.data && e.data.errors) { renderImportErrors(e.data.errors); return; }
      document.getElementById('ioResult').innerHTML = '';
      throw e;
    }
    renderImportDiff(res.token, res.diff);
  });
}

function renderImportErrors(errors) {
  document.getElementById('ioResult').innerHTML = `
    <div class="panel" style="border:1.5px solid var(--danger,#c0392b)">
      <h3 style="color:var(--danger,#c0392b);margin:0 0 9px">พบข้อผิดพลาด ${errors.length} จุด — ยังไม่มีการบันทึกใดๆ</h3>
      <table class="tbl"><tr><th>Sheet</th><th>แถว</th><th>ปัญหา</th></tr>
      ${errors.map((e) => `<tr><td>${esc(e.sheet)}</td><td>${e.row}</td><td>${esc(e.message)}</td></tr>`).join('')}
      </table>
    </div>`;
}

function renderImportDiff(token, diff) {
  const delList = (items, labelFn) => items.length
    ? `<ul style="margin:6px 0 0 18px">${items.slice(0, 30).map((i) => `<li>${esc(labelFn(i))}</li>`).join('')}${items.length > 30 ? `<li>…และอีก ${items.length - 30} รายการ</li>` : ''}</ul>`
    : '<div class="muted">ไม่มี</div>';
  const hasDeletes = diff.modules.delete.length || diff.sections.delete.length || diff.quiz.delete.length;

  document.getElementById('ioResult').innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">สรุปการเปลี่ยนแปลง — ยังไม่บันทึกจนกว่าจะกดยืนยัน</h3>
      <table class="tbl">
        <tr><th></th><th>เพิ่มใหม่</th><th>แก้ไข</th><th>ลบ</th></tr>
        <tr><td>บทเรียน</td><td>${diff.modules.insert}</td><td>${diff.modules.update}</td><td>${diff.modules.delete.length}</td></tr>
        <tr><td>หัวข้อเนื้อหา</td><td>${diff.sections.insert}</td><td>${diff.sections.update}</td><td>${diff.sections.delete.length}</td></tr>
        <tr><td>คำถาม</td><td>${diff.quiz.insert}</td><td>${diff.quiz.update}</td><td>${diff.quiz.delete.length}</td></tr>
      </table>
      ${hasDeletes ? `
        <div style="margin-top:14px;padding:12px;background:#fff6f6;border:1px solid #f3caca;border-radius:9px">
          <b style="color:var(--danger,#c0392b)">รายการที่จะถูกลบออกจากระบบถาวร:</b>
          ${diff.modules.delete.length ? `<div style="margin-top:8px"><b>บทเรียน (${diff.modules.delete.length})</b>${delList(diff.modules.delete, (m) => m.title)}</div>` : ''}
          ${diff.sections.delete.length ? `<div style="margin-top:8px"><b>หัวข้อเนื้อหา (${diff.sections.delete.length})</b>${delList(diff.sections.delete, (s) => `${s.moduleTitle} — ${s.heading}${s.viaModuleDelete ? ' (ลบตามบทเรียนที่ถูกลบ)' : ''}`)}</div>` : ''}
          ${diff.quiz.delete.length ? `<div style="margin-top:8px"><b>คำถาม (${diff.quiz.delete.length})</b>${delList(diff.quiz.delete, (q) => q.question)}</div>` : ''}
        </div>` : ''}
      <div class="form-actions" style="margin-top:14px">
        <button class="btn btn-ghost" onclick="discardImport('${token}')">ยกเลิก</button>
        <button class="btn ${hasDeletes ? 'btn-danger' : 'btn-primary'}" onclick="confirmImport('${token}')">ยืนยันบันทึกการเปลี่ยนแปลง</button>
      </div>
    </div>`;
}

function confirmImport(token) {
  if (!confirm('ยืนยันบันทึกการเปลี่ยนแปลงนี้? การลบจะทำถาวรและย้อนกลับไม่ได้ (เว้นแต่จะกู้คืนจาก backup)')) return;
  guard(async () => {
    await API.post('/content-export/import/commit', { token });
    document.getElementById('ioResult').innerHTML = '<div class="muted">บันทึกเรียบร้อยแล้ว</div>';
    toast('นำเข้าข้อมูลสำเร็จ');
    S.domains = await API.get('/domains');
  });
}

function discardImport(token) {
  guard(async () => {
    await API.post('/content-export/import/discard', { token });
    document.getElementById('ioResult').innerHTML = '';
    toast('ยกเลิกแล้ว');
  });
}
