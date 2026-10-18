require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "applications.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const RECEIVER_EMAIL = process.env.RECEIVER_EMAIL || "dhanifinancelimitedloans24@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } })
  : null;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ contactPhone: "" }, null, 2));
}
ensureFiles();

async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    reference TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    full_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    state TEXT,
    loan_type TEXT NOT NULL,
    loan_amount NUMERIC NOT NULL,
    employment TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'Application Received',
    admin_note TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2)); }

async function allApplications() {
  if (pool) {
    const r = await pool.query("SELECT * FROM applications ORDER BY created_at DESC");
    return r.rows.map(row => ({
      reference: row.reference, createdAt: row.created_at, fullName: row.full_name, mobile: row.mobile,
      email: row.email, state: row.state, loanType: row.loan_type, loanAmount: Number(row.loan_amount),
      employment: row.employment, message: row.message, status: row.status, adminNote: row.admin_note || ""
    }));
  }
  return readJson(DATA_FILE, []).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
}
async function findApplication(reference) {
  if (pool) {
    const r = await pool.query("SELECT * FROM applications WHERE reference = $1", [reference]);
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return { reference: row.reference, createdAt: row.created_at, fullName: row.full_name, mobile: row.mobile,
      email: row.email, state: row.state, loanType: row.loan_type, loanAmount: Number(row.loan_amount),
      employment: row.employment, message: row.message, status: row.status, adminNote: row.admin_note || "" };
  }
  return readJson(DATA_FILE, []).find(a => a.reference.toLowerCase() === String(reference).toLowerCase()) || null;
}
async function saveApplication(a) {
  if (pool) {
    await pool.query(
      `INSERT INTO applications(reference, full_name, mobile, email, state, loan_type, loan_amount, employment, message, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.reference,a.fullName,a.mobile,a.email,a.state,a.loanType,a.loanAmount,a.employment,a.message,a.status]
    );
  } else {
    const arr = readJson(DATA_FILE, []); arr.push(a); writeJson(DATA_FILE, arr);
  }
}
async function updateApplication(reference, status, adminNote) {
  if (pool) {
    const r = await pool.query("UPDATE applications SET status=$2, admin_note=$3 WHERE reference=$1 RETURNING reference", [reference,status,adminNote || ""]);
    return r.rowCount > 0;
  }
  const arr = readJson(DATA_FILE, []);
  const idx = arr.findIndex(a => a.reference.toLowerCase() === String(reference).toLowerCase());
  if (idx < 0) return false;
  arr[idx].status = status; arr[idx].adminNote = adminNote || ""; writeJson(DATA_FILE, arr); return true;
}
async function getPhone() {
  if (pool) {
    const r = await pool.query("SELECT value FROM site_settings WHERE key='contactPhone'");
    return r.rows[0]?.value || "";
  }
  return readJson(SETTINGS_FILE, {contactPhone:""}).contactPhone || "";
}
async function setPhone(phone) {
  if (pool) await pool.query("INSERT INTO site_settings(key,value) VALUES('contactPhone',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [phone]);
  else writeJson(SETTINGS_FILE, { contactPhone: phone });
}
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "Admin password is not configured. Set ADMIN_PASSWORD in your hosting environment." });
  const supplied = req.get("x-admin-password") || "";
  const a = Buffer.from(supplied), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({ error: "Incorrect admin password." });
  next();
}
function makeMailer() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
async function sendEmails(a) {
  const mailer = makeMailer();
  if (!mailer) return;
  const safe = s => String(s || "").replace(/[<>]/g, "");
  await mailer.sendMail({
    from: `"Dhani Finance Website" <${process.env.SMTP_USER}>`,
    to: RECEIVER_EMAIL,
    subject: `New loan enquiry — ${a.reference}`,
    text: `New loan enquiry received\n\nReference: ${a.reference}\nName: ${a.fullName}\nMobile: ${a.mobile}\nEmail: ${a.email || "-"}\nState: ${a.state || "-"}\nLoan type: ${a.loanType}\nLoan amount requested: ₹${a.loanAmount}\nEmployment: ${a.employment || "-"}\nMessage: ${a.message || "-"}\n\nThis is an enquiry only, not a loan approval.`
  });
  if (a.email) {
    await mailer.sendMail({
      from: `"Dhani Finance" <${process.env.SMTP_USER}>`,
      to: a.email,
      subject: `Dhani Finance enquiry received — ${a.reference}`,
      text: `Dear ${safe(a.fullName)},\n\nYour loan enquiry has been received successfully.\nReference number: ${a.reference}\nYou can check the application status on the website using this reference number.\n\nThis confirmation is not a loan approval or a guarantee of disbursement. Our team may contact you after reviewing your enquiry.\n\nDhani Finance`
    });
  }
}

app.get("/api/site-info", async (req,res) => {
  try { res.json({ contactPhone: await getPhone() }); }
  catch { res.status(500).json({error:"Unable to load website settings."}); }
});

app.post("/api/applications", async (req,res) => {
  try {
    const { fullName, mobile, email, state, loanType, loanAmount, employment, message } = req.body || {};
    if (!fullName || !mobile || !loanType || !loanAmount) return res.status(400).json({error:"Please fill in all required fields."});
    const cleanMobile = String(mobile).replace(/\D/g, "");
    if (cleanMobile.length < 10 || cleanMobile.length > 15) return res.status(400).json({error:"Please enter a valid mobile number."});
    const amount = Number(loanAmount);
    if (!Number.isFinite(amount) || amount < 1000 || amount > 100000000) return res.status(400).json({error:"Please enter a valid loan amount."});
    const reference = "DF" + new Date().toISOString().slice(2,10).replace(/-/g,"") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const a = {
      reference, createdAt: new Date().toISOString(), fullName: String(fullName).trim().slice(0,100),
      mobile: cleanMobile, email: String(email || "").trim().slice(0,150), state: String(state || "").slice(0,80),
      loanType: String(loanType).slice(0,80), loanAmount: amount, employment: String(employment || "").slice(0,80),
      message: String(message || "").slice(0,1000), status: "Application Received", adminNote: ""
    };
    await saveApplication(a);
    let emailSent = false;
    try { await sendEmails(a); emailSent = !!makeMailer(); } catch (e) { console.error("Email sending failed:", e.message); }
    res.status(201).json({ success:true, reference, status:a.status, emailSent, message:"Your enquiry has been submitted successfully." });
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Unable to submit your enquiry right now. Please try again."});
  }
});

app.get("/api/status/:reference", async (req,res) => {
  try {
    const a = await findApplication(String(req.params.reference || "").trim());
    if (!a) return res.status(404).json({error:"Reference number not found. Please check it and try again."});
    res.json({ reference:a.reference, createdAt:a.createdAt, loanType:a.loanType, loanAmount:a.loanAmount, status:a.status, adminNote:a.adminNote || "" });
  } catch { res.status(500).json({error:"Unable to check status right now."}); }
});

app.get("/api/admin/applications", requireAdmin, async (req,res) => {
  try { res.json({ applications: await allApplications(), contactPhone: await getPhone() }); }
  catch { res.status(500).json({error:"Unable to load applications."}); }
});
app.patch("/api/admin/applications/:reference", requireAdmin, async (req,res) => {
  const allowed = ["Application Received","Under Review","Documents Required","Verification in Progress","On Hold","Approved","Rejected","Closed"];
  const status = String(req.body?.status || "");
  const note = String(req.body?.adminNote || "").slice(0,1000);
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid status."});
  try {
    const ok = await updateApplication(req.params.reference, status, note);
    if (!ok) return res.status(404).json({error:"Application not found."});
    res.json({success:true});
  } catch { res.status(500).json({error:"Unable to update application."}); }
});
app.put("/api/admin/settings", requireAdmin, async (req,res) => {
  const phone = String(req.body?.contactPhone || "").trim().slice(0,30);
  if (phone && !/^[+\d\s()-]{7,30}$/.test(phone)) return res.status(400).json({error:"Please enter a valid contact number."});
  try { await setPhone(phone); res.json({success:true,contactPhone:phone}); }
  catch { res.status(500).json({error:"Unable to save contact number."}); }
});

app.get("/health", (req,res) => res.json({ok:true}));
initDb().then(() => app.listen(PORT, () => console.log(`Dhani Finance website running on port ${PORT}`)))
  .catch(err => { console.error("Database initialisation failed:", err); process.exit(1); });
