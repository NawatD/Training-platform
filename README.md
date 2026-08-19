# Internal Training Platform

ระบบอบรมภายในองค์กร พัฒนาต่อยอดจากต้นแบบ `QA-BAN~1.HTM` โดยย้ายเนื้อหาทั้งหมดเข้า database
รองรับการอัปโหลดไฟล์วิดีโอ/สไลด์ และเพิ่ม-ลด-แก้ไขเนื้อหาผ่านหน้า Admin — deploy ด้วย Docker

---

## เริ่มใช้งาน

```bash
cd training-platform
cp .env.example .env        # ใส่ค่า Microsoft 365 (ดูหัวข้อด้านล่าง) และ JWT_SECRET ก่อนใช้จริง
docker compose up -d --build
```

เปิด http://localhost:8080 — ระบบ login ด้วยบัญชี Microsoft 365 ของบริษัทเท่านั้น (ไม่มีอีเมล/รหัสผ่านของระบบเองแล้ว)
ใครก็ได้ที่มีบัญชี Microsoft 365 ของ tenant ที่ตั้งค่าไว้เข้าใช้งานได้ทันที (สร้างบัญชีอัตโนมัติเป็น role `learner`)
ส่วนใครเป็น `admin` กำหนดที่หน้า Admin > ผู้ใช้งาน หรือกำหนดคนแรกผ่าน `ADMIN_EMAIL` ใน `.env`

หน้า Admin อยู่ที่ http://localhost:8080/admin (เข้าได้เฉพาะ role `admin`)

---

## ตั้งค่า Microsoft 365 Login

ต้องสร้าง App registration ใน Microsoft Entra admin center (หรือ Azure Portal) ก่อนใช้งานได้:

1. ไปที่ [entra.microsoft.com](https://entra.microsoft.com) > **Identity > Applications > App registrations > New registration**
2. ตั้งชื่อ (เช่น "Internal Training Platform"), เลือก **Accounts in this organizational directory only (Single tenant)**
3. Redirect URI เลือกแพลตฟอร์ม **Web** ใส่ `http://localhost:8080/api/auth/microsoft/callback` (หรือ `https://<โดเมนจริง>/api/auth/microsoft/callback` ถ้า deploy ขึ้นเซิร์ฟเวอร์จริง) — ต้องตรงกับค่าใน `.env` เป๊ะ ไม่งั้น Microsoft จะปฏิเสธ
4. หลังสร้างเสร็จ หน้า **Overview** จะมี **Application (client) ID** และ **Directory (tenant) ID** — copy ไปใส่ `.env`
5. ไปที่ **Certificates & secrets > New client secret** สร้าง secret ใหม่ (จด value ทันทีเพราะเห็นได้ครั้งเดียว) → ใส่ใน `MICROSOFT_CLIENT_SECRET`
6. ไปที่ **API permissions** ตรวจว่ามี `Microsoft Graph > User.Read` (Delegated) อยู่แล้ว (ปกติมีมาให้ default) ไม่ต้องขอ admin consent เพิ่ม

ใส่ทั้ง 4 ค่าใน `.env`:

```env
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
MICROSOFT_TENANT_ID=...
MICROSOFT_REDIRECT_URI=http://localhost:8080/api/auth/microsoft/callback
```

**การกำหนด role**

- ทุกคนใน tenant ที่ตั้งค่าไว้ login เข้ามาได้ทันที ระบบสร้างบัญชีให้อัตโนมัติเป็น `learner` ตั้งแต่ login ครั้งแรก
- `ADMIN_EMAIL` ใน `.env` คือ admin คนแรกของระบบ (เปลี่ยนเป็นอีเมล Microsoft 365 จริงของคุณ)
- หลังจากนั้นกำหนด admin เพิ่มได้ที่หน้า Admin > ผู้ใช้งาน — พิมพ์อีเมลไว้ล่วงหน้าได้เลยแม้เจ้าของอีเมลยังไม่เคย login (ระบบจะจับคู่ให้อัตโนมัติตอน login ครั้งแรก) หรือจะเปลี่ยน role ของคนที่เคย login แล้วก็ได้
- ปิดใช้งานบัญชีได้จากหน้าเดียวกัน (toggle "เปิดใช้งานบัญชี") — คนที่ถูกปิดจะ login ผ่าน Microsoft 365 เข้ามาไม่ได้อีก แม้บัญชี Microsoft 365 จะยังใช้งานได้ปกติ

### เพิ่มเนื้อหา Domain "ประกันภัย"

Domain ประกันภัยมีชุดเนื้อหาสำเร็จรูปให้แล้ว (9 บทเรียน + 24 คำถาม ครอบคลุม Foundation/Intermediate/Advanced)
รันคำสั่งนี้ครั้งเดียวหลัง `docker compose up` เพื่อ import เข้าระบบและเปิดใช้งาน domain:

```bash
docker compose exec app node server/seed/seed-insurance.js
```

คำสั่งนี้รันซ้ำได้อย่างปลอดภัย — จะข้ามการ import หากมีบทเรียนอยู่แล้วใน domain นี้

หากแก้ไข `server/seed/insurance-content.json` ภายหลัง (เช่นปรับเนื้อหาหรือคำถามเพิ่มเติม) แล้วต้องการอัปเดตเนื้อหาที่ import ไปแล้วในฐานข้อมูล ให้ rebuild image แล้วรันด้วยแฟล็ก `--reset` เพื่อแทนที่บทเรียนและคำถามเดิมทั้งหมดของ domain นี้:

```bash
docker compose up -d --build
docker compose exec app node server/seed/seed-insurance.js --reset
```

`--reset` จะลบเฉพาะบทเรียน/คำถามของ domain ประกันภัย (รวมถึง progress ของผู้เรียนที่ผูกกับบทเรียนเหล่านั้น) แล้ว import ใหม่จากไฟล์ JSON — domain อื่น บัญชีผู้ใช้ และประวัติการสอบไม่ถูกกระทบ

คำสั่งที่ใช้บ่อย:

```bash
docker compose logs -f app     # ดู log
docker compose down            # หยุดระบบ (ข้อมูลยังอยู่ใน volume)
docker compose down -v         # หยุดพร้อมลบข้อมูลทั้งหมด
```

---

## สำรองและกู้คืนข้อมูล (Backup / Restore)

ระบบสำรองข้อมูลอยู่ในตัวแอปเอง — จัดการได้จากหน้า Admin เมนู **🗄 สำรองข้อมูล** ไม่ต้องรันคำสั่งเอง

แต่ละ backup ครอบคลุมทั้ง 2 ส่วน:

- ฐานข้อมูล Postgres ทั้งหมด — domain, บทเรียน, คำถาม, ผู้ใช้, ความคืบหน้า
- ไฟล์สื่อที่อัปโหลด (video/slide/pdf/image)

**อัตโนมัติ** — ระบบสำรองข้อมูลให้เองวันละครั้ง เก็บย้อนหลัง 3 วันล่าสุด (ปรับได้ด้วย `BACKUP_RETENTION_DAYS` ใน `.env`) แล้วลบของเก่าที่เกินกำหนดทิ้งอัตโนมัติ

**กดเอง** — ปุ่ม "สำรองข้อมูลตอนนี้" ที่หน้า Admin สร้าง backup ได้ทันที backup ที่กดเองจะ**ไม่ถูกลบอัตโนมัติ** ต้องลบเองจากปุ่ม "ลบ" ในรายการ

**กู้คืน** — กดปุ่ม "กู้คืน" ที่รายการ backup ที่ต้องการ ระบบจะแทนที่ข้อมูลปัจจุบันทั้งหมด (ฐานข้อมูล + ไฟล์สื่อ) ด้วยข้อมูลใน backup นั้นทันที — ทำย้อนกลับไม่ได้ เว้นแต่จะกู้คืนจาก backup อื่นซ้ำ

ไฟล์ backup เก็บอยู่ใน Docker volume `backup_data` (mount ที่ `/data/backups` ในคอนเทนเนอร์ `app`) แยกจาก volume ไฟล์สื่อ `media_data` และฐานข้อมูล `db_data`

---

## นำเข้า/ส่งออกเนื้อหาเป็น Excel

หน้า Admin เมนู **📤 นำเข้า/ส่งออก** ใช้แก้ไขบทเรียนและคำถามจำนวนมากพร้อมกันผ่าน Excel แทนการแก้ทีละแถวในหน้าเว็บ

**ส่งออก** — เลือก "ทุก domain" หรือ domain เดียว แล้วดาวน์โหลดเป็นไฟล์ `.xlsx` ที่มี 3 sheet:

- **บทเรียน (Modules)** — ชื่อ, คำอธิบาย, ระดับ, เวลา, คำศัพท์สำคัญ, สถานะเผยแพร่
- **หัวข้อเนื้อหา (Sections)** — เนื้อหาในแต่ละบทเรียน ทั้ง HTML, ไฟล์แนบ (วิดีโอ/สไลด์/PDF — คอลัมน์ "ไฟล์แนบ" เป็นลิงก์คลิกเปิดไฟล์เดิมได้เลย), หรือ embed URL
  - หัวข้อประเภท **HTML** ที่เนื้อหายาว (เกินขีดจำกัดของ Excel cell ~32,767 ตัวอักษร) คอลัมน์ "เนื้อหา" จะ export ออกมาเป็น**ลิงก์ไปหน้าแก้ไขใน Admin** แทนตัว HTML ตรงๆ กันไฟล์พัง — คลิกลิงก์เพื่อไปแก้เนื้อหาที่หน้าเว็บแทน ถ้าปล่อยลิงก์ไว้เฉยๆ ตอน import จะไม่ทับเนื้อหาเดิม แต่ถ้าลบลิงก์แล้วพิมพ์ HTML สั้นๆ ทับเอง ก็ยัง import แก้เนื้อหาผ่าน Excel ได้ตามปกติ (หัวข้อประเภทอื่นที่เนื้อหาเป็น URL สั้นๆ อยู่แล้ว เช่น embed ยังแก้ตรงในเซลล์ได้เหมือนเดิม)
- **คำถาม (Quiz)** — คำถาม ตัวเลือก A-D คำตอบที่ถูก และคำอธิบายเฉลย

ไฟล์มี sheet "คำแนะนำ" อธิบายวิธีใช้กำกับไว้ในตัวเสมอ กติกาหลัก:

- คอลัมน์ **ID**: เว้นว่าง = สร้างแถวใหม่ / มีค่า = แก้ไขแถวเดิม — ห้ามพิมพ์ ID เองถ้าไม่ได้ตั้งใจแก้แถวที่มีอยู่
- **ลบทั้งแถวออกจากไฟล์ = ลบข้อมูลนั้นออกจากระบบจริงตอน import** (ระบบแสดงรายการที่จะถูกลบให้ยืนยันก่อนเสมอ ไม่มีการเขียนอะไรจนกว่าจะกดยืนยัน)
- ขอบเขตการลบ (sync) จำกัดเฉพาะ domain ที่ปรากฏอยู่ในไฟล์เท่านั้น — domain อื่นที่ไม่ได้ export มาด้วยจะไม่ถูกแตะต้อง
- ห้ามลบหรือเปลี่ยนชื่อ sheet ทั้ง 3 แม้จะว่างก็ตาม
- sheet "หัวข้อเนื้อหา" และ "คำถาม" ผูกกับบทเรียนด้วยคอลัมน์ Domain + ชื่อบทเรียน (ต้องตรงกับ sheet "บทเรียน" เป๊ะ) — ทำให้สร้างบทเรียนใหม่พร้อมเนื้อหาและคำถามในไฟล์เดียวกันได้ในการ import ครั้งเดียว
- ไฟล์แนบสำหรับหัวข้อประเภท video/slide/pdf ต้องเป็นไฟล์ที่อัปโหลดไว้แล้วที่หน้า "ไฟล์ VDO/สไลด์" — import จะไม่อัปโหลดไฟล์ใหม่ให้ ต้องอัปโหลดผ่านหน้านั้นก่อน
  - คอลัมน์ "ไฟล์แนบ" export มาเป็นลิงก์ (คลิกเปิดไฟล์เดิมดูได้เลยว่าคือไฟล์ไหน) — ถ้าไม่ได้ตั้งใจเปลี่ยนไฟล์ ปล่อยลิงก์ไว้เฉยๆ ได้เลย ไม่ต้องแก้อะไร
  - ถ้าจะเปลี่ยนไปแนบไฟล์อื่น ให้ลบลิงก์ออกแล้วพิมพ์ชื่อไฟล์ที่อัปโหลดไว้แล้วแทน (ถ้ามีไฟล์ชื่อซ้ำกันหลายไฟล์ในระบบ ต้องเปลี่ยนชื่อให้ไม่ซ้ำก่อนหรือใช้ลิงก์แทน)

**นำเข้า** — เลือกไฟล์แล้วกด "ตรวจสอบไฟล์" ระบบจะตรวจสอบความถูกต้องและแสดงสรุปว่าจะเพิ่ม/แก้ไข/ลบอะไรบ้าง (พร้อมรายชื่อของที่จะถูกลบ) ให้ตรวจสอบก่อนกด "ยืนยันบันทึกการเปลี่ยนแปลง" หากพบปัญหาจะแจ้งเป็นรายแถวโดยไม่บันทึกอะไรเลย

แนะนำให้กด "สำรองข้อมูลตอนนี้" (เมนู 🗄 สำรองข้อมูล) ก่อน import ครั้งใหญ่ๆ เผื่อไว้ — ถ้า import พลาดสามารถกู้คืนกลับได้ทันที

หน้าเดียวกันนี้ยังมีปุ่ม **"แปลงทั้งหมดเป็นไฟล์"** — แปลงเนื้อหาของหัวข้อประเภท HTML ทุกหัวข้อที่พิมพ์ไว้ในกล่องโดยตรง (ไม่ว่ายาวหรือสั้น) ให้เป็นไฟล์ `.html` แนบแทนทีเดียวทั้งหมด (เลือกได้ว่าทุก domain หรือ domain เดียว) แทนที่จะต้องเปิดทีละหัวข้อแล้วกด "แปลงเป็นไฟล์" เอง — ระบบจะถามยืนยันจำนวนก่อนเขียนอะไรเสมอ

---

## API สำหรับระบบภายนอก (Export API)

ให้ระบบอื่นดึงรายการ "บทเรียน" ในระบบไปใช้ต่อได้ ยืนยันตัวตนด้วย **API key คงที่ค่าเดียว** (คนละกลไกกับ JWT ที่ผู้ใช้ในระบบใช้ login) — เหมาะกับการ sync ข้อมูลแบบระบบต่อระบบ ไม่ใช่ให้คนล็อกอินเข้ามาดู

### ตั้งค่าคีย์

ตั้งค่า `EXPORT_API_KEY` ใน `.env` (ดู `.env.example`) แล้ว restart แอป — ระบบภายนอกที่จะมาดึงข้อมูลต้องส่งค่านี้มาให้ตรงเป๊ะทุก request คีย์เดียวใช้ร่วมกันทุกระบบที่ได้รับสิทธิ์ ไม่มีการแยกคีย์ต่อพาร์ทเนอร์หรือ revoke เฉพาะราย — ถ้าคีย์รั่ว ให้เปลี่ยนค่านี้แล้ว restart (คีย์เก่าใช้ไม่ได้ทันที แต่กระทบทุกระบบที่ใช้คีย์เดิมอยู่พร้อมกัน)

generate ค่าใหม่ได้ด้วย:

```bash
node -e "console.log('itp_' + require('crypto').randomBytes(24).toString('base64url'))"
```

### เรียกดึงเนื้อหา (ระบบภายนอก)

ส่ง header `X-API-Key: <คีย์ที่ได้ตอนสร้าง>` มากับทุก request

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/export/content` | รายการบทเรียนทั้งหมดที่เผยแพร่แล้ว **พร้อมเนื้อหาเต็มของทุกบทเรียนในเรียกเดียว** (ไม่ต้องวนเรียกทีละอัน) รองรับ query `?domain=banking` (กรอง domain เดียว) และ `?updated_since=2026-08-01T00:00:00Z` (ดึงเฉพาะที่แก้ไขหลังวันนี้ — เหมาะกับ sync แบบ incremental) |
| GET | `/api/export/content/:id` | เนื้อหาเต็มของบทเรียนเดียว (ข้อมูลชุดเดียวกับที่อยู่ในรายการข้างบนอยู่แล้ว — เก็บ endpoint นี้ไว้เผื่อกรณีอยากดึงซ้ำทีละอันภายหลัง เช่น poll เช็คว่าบทเรียนหนึ่งอัปเดตหรือยัง) |

**หน่วยของข้อมูล**: 1 แถว = 1 บทเรียน (module) ไม่ใช่ 1 หัวข้อย่อย (section) — เพราะบทเรียนหนึ่งมักมีหลายหัวข้อย่อยปนกัน (เช่น html ปน video) `type_of_content` จึงเลือกจากหัวข้อย่อยที่ "สื่อสมบูรณ์สุด" เป็นตัวแทนทั้งบทเรียน ตามลำดับ `video > slide > pdf > embed > html`

รูปแบบ `GET /api/export/content` (1 เรียก ได้ทุกบทเรียนพร้อมเนื้อหาเต็ม):

```json
[
  {
    "id": "1b8f2e40-....-....-....-............",
    "domain": "banking",
    "article_name": "What is Loans",
    "type_of_content": "html",
    "content_link": "https://yourhost/api/export/content/1b8f2e40-....",
    "last_update_date": "2026-08-18T13:00:00.000Z",
    "summary": "...",
    "level": "foundation",
    "sections": [
      { "heading": "...", "kind": "html", "content_type": "inline", "content": "<p>...</p>" },
      { "heading": "...", "kind": "video", "content_type": "url", "content": "https://yourhost/api/assets/xxxx/file" }
    ]
  }
]
```

`content_type: "inline"` = เนื้อหาอยู่ในฟิลด์ `content` ตรงๆ (html/embed URL) ส่วน `"url"` = ต้องไปดึงไฟล์ที่ลิงก์นี้ต่อ (video/slide/pdf — ลิงก์นี้เปิด/ดาวน์โหลดได้เลยไม่ต้องใช้ API key)

หมายเหตุ: `last_update_date` เป็น ISO 8601 (UTC) แทนฟอร์แมตวันที่แบบอ่านง่าย เพื่อให้ระบบอื่นแปลงเป็น timezone/ฟอร์แมตของตัวเองได้ตรงไปตรงมาไม่กำกวม

เฉพาะบทเรียนที่ **เผยแพร่แล้ว** (`is_published = true`) และอยู่ใน domain สถานะ **active** เท่านั้นที่ export ออกไป — บทเรียนร่างหรือ domain ที่ยังไม่เปิดจะไม่ถูกดึงออกไปนอกระบบ

ตัวอย่าง curl:

```bash
curl -H "X-API-Key: itp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  "https://yourhost/api/export/content?domain=banking"
```

---

## สิ่งที่ระบบทำได้

**ฝั่งผู้เรียน**

- เลือก domain (สายธุรกิจ) → ดูบทเรียนแยกตามระดับ Foundation / Intermediate / Advanced
- อ่านเนื้อหา ดูวิดีโอในหน้าเว็บ (streaming รองรับการเลื่อนดูข้ามช่วง) เปิด PDF และดาวน์โหลดสไลด์
- กดทำเครื่องหมายว่าเรียนจบ — ความคืบหน้าเก็บรายบุคคลใน database
- ทำแบบทดสอบ ตรวจคำตอบที่ฝั่งเซิร์ฟเวอร์ พร้อมคำอธิบายเฉลยรายข้อและสรุปคะแนนแยกระดับ

**ฝั่งผู้ดูแล (`/admin`)**

- เพิ่ม/แก้ไข/ลบ Domain, บทเรียน, หัวข้อเนื้อหา และคำถาม พร้อมจัดลำดับขึ้น-ลง
- อัปโหลดไฟล์ VDO / สไลด์ / PDF / รูปภาพ / HTML (ลากวางได้ อัปโหลดหลายไฟล์พร้อมกัน)
- ตั้งสถานะบทเรียนเป็น "ร่าง" เพื่อซ่อนจากผู้เรียนระหว่างเตรียมเนื้อหา
- จัดการผู้ใช้และดูรายงานความคืบหน้าของทีม
- บทเรียน หัวข้อเนื้อหา และคำถามทุกรายการ แสดง "แก้ไขล่าสุด" (วันเวลา + ชื่อผู้แก้ไข) ให้อัตโนมัติทุกครั้งที่บันทึก

---

## ประเภทเนื้อหาในบทเรียน

หนึ่งบทเรียนประกอบด้วยหลาย "หัวข้อ" (section) เลือกประเภทได้ดังนี้:

| ประเภท | ใช้เมื่อ | หมายเหตุ |
|---|---|---|
| `html` | เนื้อหาข้อความ | ใส่ HTML ได้ ใช้คลาสของธีมได้ เช่น `callout`, `callout qa`, `term-grid`, `diagram-box` — เนื้อหายาว/ซับซ้อนแนบเป็นไฟล์ `.html` ที่อัปโหลดไว้แทนการพิมพ์ในกล่องได้ (เลือกที่ "ไฟล์ที่แนบ" ในหน้าแก้ไขหัวข้อ, ไม่บังคับ) หรือถ้ามีข้อความพิมพ์อยู่ในกล่องแล้ว กดปุ่ม "แปลงเนื้อหานี้เป็นไฟล์ HTML แนบแทน" เพื่อย้ายไปเป็นไฟล์แนบให้อัตโนมัติได้เลยโดยไม่ต้อง copy ไปเซฟเองแล้วอัปโหลดกลับมา |
| `video` | วิดีโอที่อัปโหลดเอง | เล่นในหน้าเว็บ รองรับ HTTP Range (เลื่อนดูข้ามช่วงได้) |
| `slide` | ไฟล์ PPTX / PPT / ODP | แสดงเป็นการ์ดให้ดาวน์โหลด |
| `pdf` | ไฟล์ PDF | ฝังแสดงในหน้าเว็บ |
| `embed` | ลิงก์ภายนอก | เช่น YouTube `/embed/...` หรือ Google Slides `/embed` |

ขนาดไฟล์สูงสุดตั้งที่ `MAX_UPLOAD_MB` (ค่าเริ่มต้น 2048 MB)
ไฟล์เก็บใน Docker volume `media_data` โดย database เก็บเฉพาะ metadata

---

## โครงสร้างโปรเจค

```
training-platform/
├── docker-compose.yml       # app + postgres + volumes
├── Dockerfile
├── .env.example
├── db/init.sql              # schema (รันอัตโนมัติตอน app boot, idempotent)
├── server/
│   ├── src/
│   │   ├── index.js         # entrypoint + static hosting
│   │   ├── db.js            # connection pool + retry ตอน boot
│   │   ├── auth.js          # JWT + role guards
│   │   └── routes/          # auth, content, quiz, assets, progress
│   └── seed/
│       ├── seed.js          # สร้าง admin + import เนื้อหาเริ่มต้น
│       └── legacy-content.json   # เนื้อหาที่ดึงมาจาก QA-BAN~1.HTM
└── public/                  # frontend (vanilla JS, ไม่ต้อง build)
    ├── index.html / js/app.js       # หน้าผู้เรียน
    ├── admin.html / js/admin.js     # หน้าผู้ดูแล
    └── css/base.css                 # ธีมเดิมจากต้นแบบ
```

### ตารางหลักใน database

`users` · `domains` · `modules` · `sections` · `assets` · `quiz_questions` · `module_progress` · `quiz_attempts`

การลบ domain จะ cascade ลบบทเรียน หัวข้อ และคำถามที่อยู่ใต้มันทั้งหมด

---

## API (ย่อ)

ทุกเส้นทางขึ้นต้นด้วย `/api` — ยืนยันตัวตนด้วย JWT ใน httpOnly cookie หรือ `Authorization: Bearer`

| Method | Path | สิทธิ์ |
|---|---|---|
| GET | `/auth/microsoft/login`, `/auth/microsoft/callback` | ทุกคน (SSO flow) |
| POST | `/logout` · GET `/me` | ทุกคน |
| GET | `/domains`, `/domains/:slug/modules`, `/modules/:id` | ผู้ใช้ที่ล็อกอิน |
| POST/PATCH/DELETE | `/domains`, `/modules`, `/sections`, `/quiz` | admin |
| POST | `/modules/reorder`, `/sections/reorder` | admin |
| POST/GET/DELETE | `/assets` | admin |
| GET | `/assets/:id/file` | ผู้ใช้ที่ล็อกอิน (รองรับ Range) |
| GET | `/domains/:slug/quiz` · POST `/domains/:slug/quiz/submit` | ผู้เรียน |
| POST | `/progress/:moduleId` · GET `/progress` | ผู้เรียน |
| GET | `/users`, `/reports/overview` | admin |
| GET | `/export/content`, `/export/content/:id` | API key คงที่ (header `X-API-Key`, ตั้งค่าที่ `EXPORT_API_KEY`) — ดูหัวข้อ "API สำหรับระบบภายนอก" |
| GET | `/health` | ทุกคน |

เฉลยคำตอบไม่ถูกส่งไปที่ฝั่ง client — การตรวจข้อสอบทำที่เซิร์ฟเวอร์เสมอ

---

## การนำขึ้น production

1. ตั้ง `JWT_SECRET` เป็นสตริงสุ่มยาว
2. วาง reverse proxy (nginx / Caddy) หน้า app แล้วเปิด HTTPS — cookie ควรส่งผ่าน TLS เท่านั้น
3. อัปเดต `MICROSOFT_REDIRECT_URI` ให้เป็นโดเมนจริง (https) แล้วไปเพิ่ม Redirect URI เดียวกันใน Azure Portal ด้วย
4. ตั้ง `client_max_body_size` ที่ reverse proxy ให้ไม่ต่ำกว่า `MAX_UPLOAD_MB`
5. สำรองข้อมูลทั้งสองส่วน: `docker compose exec db pg_dump -U training training > backup.sql` และ volume `media_data`

## พัฒนาแบบ local (ไม่ผ่าน Docker)

```bash
cd server && npm install
DATABASE_URL=postgres://training:training_pass@localhost:5433/training \
JWT_SECRET=dev STORAGE_DIR=../storage npm start
```

## การทดสอบที่ผ่านแล้ว

ระบบผ่านการทดสอบ end-to-end: boot + สร้าง schema + import เนื้อหา 9 บทเรียน 24 คำถาม,
login ทั้งสอง role, CRUD ครบทุกตาราง, อัปโหลดไฟล์และ Range request (206 Partial Content),
การปฏิเสธไฟล์ประเภทที่ไม่รองรับ, การกันสิทธิ์ (learner → 403, anonymous → 401),
ตรวจข้อสอบและบันทึกผล, และการ render ของหน้าผู้เรียนกับหน้า Admin ทุกหน้า
