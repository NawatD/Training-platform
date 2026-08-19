/* ============================================================
   Microsoft 365 (Entra ID) SSO — ConfidentialClientApplication
   authority ผูกกับ tenant เดียว (ไม่ใช่ /common หรือ /organizations)
   ทำให้ login ได้เฉพาะบัญชีในองค์กรนี้เท่านั้น ตามที่ต้องการ (single-tenant)
   ============================================================ */
const { ConfidentialClientApplication } = require('@azure/msal-node');

const TENANT_ID = process.env.MICROSOFT_TENANT_ID;
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;

const isConfigured = !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

const msalClient = isConfigured
  ? new ConfidentialClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET,
      },
    })
  : null;

if (!isConfigured) {
  console.warn('[msal] ยังไม่ได้ตั้งค่า MICROSOFT_CLIENT_ID/CLIENT_SECRET/TENANT_ID/REDIRECT_URI — login ผ่าน Microsoft 365 จะใช้งานไม่ได้');
}

// user.read พอสำหรับดึงอีเมล/ชื่อผู้ใช้ — ไม่ต้องขอสิทธิ์เพิ่ม ไม่ต้องรอ admin consent พิเศษ
const SCOPES = ['user.read'];

module.exports = { msalClient, SCOPES, REDIRECT_URI, isConfigured };
