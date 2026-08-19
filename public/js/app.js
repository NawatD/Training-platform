/* ============================================================
   Learner app — API-driven port of the original static prototype
   ============================================================ */

const LEVELS = {
  foundation:   { label: 'Foundation · Junior', cls: 'lvl-foundation' },
  intermediate: { label: 'Intermediate',        cls: 'lvl-intermediate' },
  advanced:     { label: 'Advanced · Senior',   cls: 'lvl-advanced' },
};
const levelColor = { foundation: 'var(--green)', intermediate: 'var(--blue)', advanced: 'var(--purple)' };

const state = {
  user: null,
  domains: [],
  currentDomain: null,   // domain object
  modules: [],
  view: 'home',          // home | learn | module | quiz-intro | quiz | results
  currentModule: null,
  quiz: null,            // { questions, idx, answers }
  results: null,
};

/* ---------------- boot ---------------- */
const SSO_ERROR_MESSAGES = {
  sso_config: 'ระบบยังไม่ได้ตั้งค่า Microsoft 365 login — แจ้งผู้ดูแลระบบ',
  sso_denied: 'การเข้าสู่ระบบถูกยกเลิกหรือถูกปฏิเสธจาก Microsoft',
  sso_state: 'เซสชันเข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
  sso_token: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  sso_no_email: 'ไม่พบอีเมลในบัญชี Microsoft 365 ที่ใช้เข้าสู่ระบบ',
  sso_inactive: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
};

(async function boot() {
  const { user } = await API.get('/me');
  if (!user) return showLogin();
  state.user = user;
  await startApp();
})();

function showLogin() {
  document.getElementById('loginGate').hidden = false;
  document.getElementById('appRoot').hidden = true;
  const errCode = new URLSearchParams(location.search).get('error');
  if (errCode) {
    const errEl = document.getElementById('loginErr');
    errEl.textContent = SSO_ERROR_MESSAGES[errCode] || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
    errEl.hidden = false;
    history.replaceState(null, '', location.pathname);
  }
}

document.getElementById('logoutBtn').addEventListener('click', async (e) => {
  e.preventDefault();
  await API.post('/logout');
  location.reload();
});

async function startApp() {
  document.getElementById('appRoot').hidden = false;
  document.getElementById('suName').textContent = state.user.name;
  document.getElementById('adminLink').hidden = state.user.role !== 'admin';

  state.domains = await API.get('/domains');
  const first = state.domains.find((d) => d.status === 'active') || state.domains[0];
  if (!first) {
    renderDomainNav();
    document.getElementById('mainArea').innerHTML =
      `<div class="empty-state">ยังไม่มีเนื้อหาในระบบ — ให้ผู้ดูแลเพิ่มบทเรียนที่หน้า Admin ก่อน</div>`;
    return;
  }
  await selectDomain(first.slug);
}

/* ---------------- sidebar ---------------- */
function renderDomainNav() {
  document.getElementById('domainNav').innerHTML = state.domains.map((d) => {
    if (d.status === 'soon') {
      return `<button class="domain-btn disabled" title="เร็วๆ นี้"><span>${esc(d.icon)}</span><span>${esc(d.name)}</span><span class="domain-badge">Soon</span></button>`;
    }
    const active = state.currentDomain && state.currentDomain.id === d.id ? 'active' : '';
    return `<button class="domain-btn ${active}" onclick="selectDomain('${d.slug}')"><span>${esc(d.icon)}</span><span>${esc(d.name)}</span></button>`;
  }).join('');
  updateSideProgress();
}

function updateSideProgress() {
  const total = state.modules.length;
  const done = state.modules.filter((m) => m.completed).length;
  document.getElementById('sideProgLabel').textContent =
    'ความคืบหน้า — ' + (state.currentDomain ? state.currentDomain.name : '');
  document.getElementById('sideBarFill').style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
  document.getElementById('sideBarPct').textContent = `${done} / ${total} บทเรียนเรียนจบแล้ว`;
}

async function selectDomain(slug) {
  document.getElementById('mainArea').innerHTML = '<div class="loading">กำลังโหลด…</div>';
  const data = await API.get(`/domains/${encodeURIComponent(slug)}/modules`);
  state.currentDomain = data.domain;
  state.modules = data.modules;
  state.view = 'home';
  render();
}

/* ---------------- router ---------------- */
function render() {
  renderDomainNav();
  const main = document.getElementById('mainArea');
  const views = {
    home: viewHome, learn: viewLearn, module: viewModule,
    'quiz-intro': viewQuizIntro, quiz: viewQuiz, results: viewResults,
  };
  main.innerHTML = (views[state.view] || viewHome)();
  window.scrollTo(0, 0);
}

function go(view) { state.view = view; render(); }

function topbar(sub) {
  return `<div class="topbar"><div>
      <h1>${esc(state.currentDomain.name)}</h1>
      <p>${esc(sub || state.currentDomain.description || 'เส้นทางการเรียนรู้ภายในองค์กร')}</p>
    </div></div>
    <div class="tabs">
      <button class="tab-btn ${state.view === 'home' ? 'active' : ''}" onclick="go('home')">ภาพรวม</button>
      <button class="tab-btn ${['learn', 'module'].includes(state.view) ? 'active' : ''}" onclick="go('learn')">บทเรียน</button>
      <button class="tab-btn ${state.view.startsWith('quiz') || state.view === 'results' ? 'active' : ''}" onclick="go('quiz-intro')">แบบทดสอบ</button>
    </div>`;
}

/* ---------------- views ---------------- */
function viewHome() {
  const total = state.modules.length;
  const done = state.modules.filter((m) => m.completed).length;
  const byLevel = (lv) => state.modules.filter((m) => m.level === lv).length;

  return topbar() + `
    <div class="grid-cards">
      <div class="stat-card"><div class="num">${total}</div><div class="lbl">บทเรียนทั้งหมด</div></div>
      <div class="stat-card"><div class="num">${done}</div><div class="lbl">เรียนจบแล้ว</div></div>
      <div class="stat-card"><div class="num">${total ? Math.round(done / total * 100) : 0}%</div><div class="lbl">ความคืบหน้า</div></div>
      <div class="stat-card"><div class="num">${byLevel('foundation')}/${byLevel('intermediate')}/${byLevel('advanced')}</div><div class="lbl">Foundation / Inter / Advanced</div></div>
    </div>
    <div class="section-title">🚀 เริ่มเรียนต่อ</div>
    ${nextModuleCard()}
    <div class="section-title">📋 ทั้งหมด</div>
    ${moduleGroups()}`;
}

function nextModuleCard() {
  const next = state.modules.find((m) => !m.completed);
  if (!next) return `<div class="empty-state">🎉 เรียนจบทุกบทเรียนแล้ว — ลองทำแบบทดสอบเพื่อวัดความเข้าใจ</div>`;
  return `<div class="module-list">${moduleCard(next)}</div>`;
}

function viewLearn() {
  return topbar('เลือกบทเรียนที่ต้องการอ่านหรือดูวิดีโอ') + moduleGroups();
}

function moduleGroups() {
  return ['foundation', 'intermediate', 'advanced'].map((lv) => {
    const list = state.modules.filter((m) => m.level === lv);
    if (!list.length) return '';
    const doneN = list.filter((m) => m.completed).length;
    return `<div class="level-group">
      <div class="level-head">
        <span class="level-pill ${LEVELS[lv].cls}">${LEVELS[lv].label}</span>
        <small>${doneN}/${list.length} บทเรียน</small>
      </div>
      <div class="module-list">${list.map(moduleCard).join('')}</div>
    </div>`;
  }).join('') || `<div class="empty-state">ยังไม่มีบทเรียนใน domain นี้</div>`;
}

function moduleCard(m) {
  return `<div class="module-card" onclick="openModule('${m.id}')">
    ${m.completed ? '<div class="done-check">✓</div>' : ''}
    <span class="level-pill ${LEVELS[m.level].cls}" style="font-size:10.5px">${LEVELS[m.level].label}</span>
    <h3>${esc(m.title)}</h3>
    <p>${esc(m.summary || '')}</p>
    <div class="module-meta">
      <span>⏱ ${esc(m.duration || '—')}</span>
      <span>📄 ${m.section_count} หัวข้อ</span>
    </div>
  </div>`;
}

async function openModule(id) {
  document.getElementById('mainArea').innerHTML = '<div class="loading">กำลังโหลดบทเรียน…</div>';
  state.currentModule = await API.get('/modules/' + id);
  // หัวข้อ kind=html ที่แนบเป็นไฟล์ .html (แทนการพิมพ์ตรงๆ) ต้องดึงเนื้อหาจริงจากไฟล์มาก่อน
  // ถึงจะแสดงแบบฝังในหน้าได้เหมือนเดิม (ใช้คลาสจากธีมของเว็บได้ ไม่ใช่ iframe)
  await Promise.all((state.currentModule.sections || [])
    .filter((s) => s.kind === 'html' && s.asset_id && !s.body)
    .map(async (s) => {
      try { s.body = await (await fetch('/api/assets/' + s.asset_id + '/file')).text(); }
      catch (e) { s.body = '<p class="muted">โหลดเนื้อหาไม่สำเร็จ</p>'; }
    }));
  state.view = 'module';
  render();
}

function viewModule() {
  const m = state.currentModule;
  const body = m.sections.map(renderSection).join('');
  const terms = (m.key_terms || []).map((t) => `<span>${esc(t)}</span>`).join('');

  return `<div class="reader">
    <div class="back-link" onclick="go('learn')">← กลับไปหน้าบทเรียน</div>
    <span class="level-pill ${LEVELS[m.level].cls}" style="font-size:10.5px">${LEVELS[m.level].label}</span>
    <h1>${esc(m.title)}</h1>
    <div class="sub">${esc(m.summary || '')} ${m.duration ? '· ⏱ ' + esc(m.duration) : ''}</div>
    ${body || '<div class="empty-state">บทเรียนนี้ยังไม่มีเนื้อหา</div>'}
    ${terms ? `<div class="section-title">🔑 คำศัพท์สำคัญ</div><div class="key-terms">${terms}</div>` : ''}
    <button class="mark-done-btn ${m.completed ? 'undo' : ''}" onclick="toggleDone('${m.id}')">
      ${m.completed ? '✓ เรียนจบแล้ว (กดเพื่อยกเลิก)' : 'ทำเครื่องหมายว่าเรียนจบ'}
    </button>
  </div>`;
}

function renderSection(s) {
  const head = s.heading ? `<h2>${esc(s.heading)}${kindTag(s.kind)}</h2>` : '';
  if (s.kind === 'video' && s.asset_id) {
    return head + `<div class="media-block">
      <video controls preload="metadata" src="/api/assets/${s.asset_id}/file"></video>
    </div>` + (s.body ? `<p>${s.body}</p>` : '');
  }
  if (s.kind === 'pdf' && s.asset_id) {
    return head + `<div class="media-block">
      <iframe src="/api/assets/${s.asset_id}/file#view=FitH" title="${esc(s.asset_name || 'PDF')}"></iframe>
    </div>` + (s.body ? `<p>${s.body}</p>` : '');
  }
  if (s.kind === 'slide' && s.asset_id) {
    return head + `<div class="media-block"><div class="file-card">
      <div class="fi">📊</div>
      <div class="fmeta">
        <div class="fname">${esc(s.asset_name || 'สไลด์')}</div>
        <div class="fsub">${esc(s.asset_mime || '')} · ${fmtSize(s.asset_size)}</div>
      </div>
      <a class="dl" href="/api/assets/${s.asset_id}/file?download=1">ดาวน์โหลด</a>
    </div></div>` + (s.body ? `<p>${s.body}</p>` : '');
  }
  if (s.kind === 'embed' && s.body) {
    const url = s.body.trim();
    return head + `<div class="media-block"><iframe src="${esc(url)}" allowfullscreen title="embed"></iframe></div>`;
  }
  return head + (s.body || '');
}

function kindTag(kind) {
  const map = { video: '🎬 วิดีโอ', slide: '📊 สไลด์', pdf: '📕 PDF', embed: '🔗 Embed' };
  return map[kind] ? `<span class="kind-tag">${map[kind]}</span>` : '';
}

async function toggleDone(id) {
  const now = !state.currentModule.completed;
  await API.post('/progress/' + id, { completed: now });
  state.currentModule.completed = now;
  const inList = state.modules.find((m) => m.id === id);
  if (inList) inList.completed = now;
  render();
}

/* ---------------- quiz ---------------- */
function viewQuizIntro() {
  return topbar('วัดความเข้าใจก่อนเริ่มโปรเจคจริง') + `
    <div class="quiz-intro">
      <h2>แบบทดสอบความพร้อม — ${esc(state.currentDomain.name)}</h2>
      <ul>
        <li>ข้อสอบครอบคลุมระดับ Foundation, Intermediate และ Advanced</li>
        <li>ตรวจคำตอบที่ฝั่งเซิร์ฟเวอร์ พร้อมคำอธิบายรายข้อหลังส่ง</li>
        <li>ผลการสอบถูกบันทึกในระบบเพื่อดูพัฒนาการย้อนหลัง</li>
        <li>เกณฑ์ผ่าน: 80% ขึ้นไป = พร้อมลงโปรเจค</li>
      </ul>
      <button class="start-btn" onclick="startQuiz()">เริ่มทำแบบทดสอบ</button>
    </div>`;
}

async function startQuiz() {
  document.getElementById('mainArea').innerHTML = '<div class="loading">กำลังเตรียมข้อสอบ…</div>';
  const data = await API.get(`/domains/${encodeURIComponent(state.currentDomain.slug)}/quiz`);
  if (!data.questions.length) {
    document.getElementById('mainArea').innerHTML = `<div class="empty-state">ยังไม่มีคำถามใน domain นี้</div>`;
    return;
  }
  state.quiz = { questions: data.questions, idx: 0, answers: {} };
  go('quiz');
}

function viewQuiz() {
  const q = state.quiz.questions[state.quiz.idx];
  const picked = state.quiz.answers[q.id];
  const pct = Math.round((state.quiz.idx / state.quiz.questions.length) * 100);
  const isLast = state.quiz.idx === state.quiz.questions.length - 1;

  return `<div class="qcard">
    <div class="qprogress">ข้อ ${state.quiz.idx + 1} จาก ${state.quiz.questions.length}</div>
    <div class="qtrack"><div class="qtrack-fill" style="width:${pct}%"></div></div>
    <span class="qtag" style="background:${levelColor[q.level]}">${LEVELS[q.level].label}</span>
    ${q.category ? `<span class="qtag" style="background:var(--muted)">${esc(q.category)}</span>` : ''}
    <div class="qtext">${esc(q.question)}</div>
    ${q.options.map((o, i) => `<button class="opt ${picked === i ? 'selected' : ''}" onclick="pick(${i})">${esc(o)}</button>`).join('')}
    <div class="qnav">
      ${state.quiz.idx > 0 ? '<button class="retry-btn" onclick="prevQ()">ย้อนกลับ</button>' : ''}
      <button class="start-btn" style="margin-top:0" ${picked === undefined ? 'disabled' : ''} onclick="${isLast ? 'submitQuiz()' : 'nextQ()'}">
        ${isLast ? 'ส่งคำตอบ' : 'ข้อถัดไป'}
      </button>
    </div>
  </div>`;
}

function pick(i) {
  const q = state.quiz.questions[state.quiz.idx];
  state.quiz.answers[q.id] = i;
  render();
}
function nextQ() { state.quiz.idx++; render(); }
function prevQ() { state.quiz.idx--; render(); }

async function submitQuiz() {
  document.getElementById('mainArea').innerHTML = '<div class="loading">กำลังตรวจคำตอบ…</div>';
  state.results = await API.post(
    `/domains/${encodeURIComponent(state.currentDomain.slug)}/quiz/submit`,
    { answers: state.quiz.answers }
  );
  go('results');
}

function viewResults() {
  const r = state.results;
  const pct = Math.round(r.percent);
  const verdict = pct >= 80 ? ['ready', '🎉 พร้อมลงโปรเจคจริง']
    : pct >= 60 ? ['almost', '📚 เกือบพร้อม — ทบทวนเพิ่มอีกนิด']
    : ['notready', '🔁 ควรทบทวนเนื้อหาอีกครั้ง'];

  const bd = ['foundation', 'intermediate', 'advanced'].map((lv) => {
    const b = r.breakdown[lv];
    if (!b) return '';
    const p = Math.round((b.correct / b.total) * 100);
    return `<div class="bd-card">
      <div class="pct" style="color:${levelColor[lv]}">${p}%</div>
      <div style="font-size:12.5px;color:var(--muted)">${LEVELS[lv].label}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${b.correct}/${b.total} ข้อ</div>
    </div>`;
  }).join('');

  const review = r.detail.filter((d) => !d.correct).map((d) => `
    <div class="review-item">
      <div class="qh"><span class="badge-tiny" style="background:${levelColor[d.level]}">${LEVELS[d.level].label}</span>${esc(d.question)}</div>
      <div style="font-size:13px;color:var(--danger);margin:4px 0">คำตอบของคุณ: ${d.picked != null ? esc(d.options[d.picked]) : 'ไม่ได้ตอบ'}</div>
      <div style="font-size:13px;color:var(--green)">คำตอบที่ถูก: ${esc(d.options[d.correct_index])}</div>
      ${d.explanation ? `<div class="explain">${esc(d.explanation)}</div>` : ''}
    </div>`).join('');

  return `<div class="result-hero">
      <div class="score-num">${r.score} / ${r.total}</div>
      <div style="color:var(--muted);font-size:13.5px">คะแนน ${pct}%</div>
      <div class="verdict ${verdict[0]}">${verdict[1]}</div>
      <div><button class="retry-btn" onclick="startQuiz()">ทำแบบทดสอบอีกครั้ง</button>
      <button class="retry-btn" style="background:var(--blue)" onclick="go('learn')">กลับไปทบทวนบทเรียน</button></div>
    </div>
    <div class="breakdown">${bd}</div>
    ${review ? `<div class="section-title">📝 ข้อที่ตอบผิด</div><div class="review-list">${review}</div>`
             : `<div class="section-title">✨ ตอบถูกทุกข้อ</div>`}`;
}
