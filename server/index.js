import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { initDb, query } from './db.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret-mvp-key';
const TOKEN_EXPIRES = '8h';

const uploadFolder = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'https://izinttakip.onrender.com'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static(uploadFolder));

const clientDistFolder = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistFolder)) {
  app.use(express.static(clientDistFolder));
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    email: row.email,
    photoUrl: row.photo_url || null,
    leaveBalance: Number(row.leave_balance || 0),
    graduation: row.graduation || '',
    startDate: row.start_date || '',
    phone: row.phone || '',
    notes: row.notes || ''
  };
}

function mapLeave(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    reportId: row.report_id,
    reportName: row.report_name,
    reportPath: row.report_path,
    status: row.status,
    createdAt: row.created_at,
    approvals: row.approvals || []
  };
}

function mapHealthReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    filename: row.filename,
    originalName: row.original_name,
    path: row.path,
    uploadedAt: row.uploaded_at
  };
}

async function getUserByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function getUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token gerekli' });
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token hatalı' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.id);
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
    }
    req.user = mapUser(user);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token doğrulanamadı' });
  }
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Yetkiniz yok' });
    }
    next();
  };
}

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const smtpTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

async function notifyManagers(leave, requester) {
  const managersResult = await query('SELECT * FROM users WHERE role = $1', ['manager']);
  const managers = managersResult.rows;
  if (!managers.length) {
    console.log('Email bildirimi: Müdür bulunamadı.');
    return;
  }

  const recipients = managers.map((manager) => manager.email).join(',');
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${port}`;
  const mailOptions = {
    from: process.env.SMTP_FROM || 'no-reply@hrfabrika.com',
    to: recipients,
    subject: `Yeni izin talebi: ${requester.name}`,
    text: `Yeni izin talebi oluşturuldu.

Kullanıcı: ${requester.name}
E-posta: ${requester.email}
Tür: ${leave.type}
Tarih: ${leave.startDate} - ${leave.endDate}
Açıklama: ${leave.reason || '-'}

Rapor: ${leave.reportName || 'Yok'}

Lütfen sisteme giriş yaparak talebi inceleyin.`
  };

  if (!smtpTransport) {
    console.log('SMTP yapılandırılmamış; e-posta gönderilemedi. Mail içeriği:');
    console.log(mailOptions);
    return;
  }

  try {
    await smtpTransport.sendMail(mailOptions);
    console.log(`Müdüre e-posta bildirimi gönderildi: ${recipients}`);
  } catch (error) {
    console.error('E-posta gönderilirken hata oluştu:', error);
  }
}

function createToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await getUserByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-posta veya parola hatalı' });
  }

  const token = createToken(user);
  res.json({ token, user: mapUser(user) });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json(req.user);
});

app.get('/api/users', authenticateToken, async (_req, res) => {
  const result = await query('SELECT * FROM users ORDER BY name');
  res.json(result.rows.map(mapUser));
});

app.post('/api/users', authenticateToken, authorizeRoles('supervisor', 'manager'), async (req, res) => {
  const { name, email, password, role, department, graduation, startDate, phone, notes } = req.body;
  if (!name || !email || !password || !role || !department) {
    return res.status(400).json({ error: 'Gerekli alanlar eksik.' });
  }
  if (req.user.role === 'supervisor' && role !== 'operator') {
    return res.status(403).json({ error: 'Sadece operatör ekleyebilirsiniz.' });
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı.' });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  await query(
    `INSERT INTO users (id, name, role, department, email, password_hash, photo_url, leave_balance, graduation, start_date, phone, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [id, name, role, department, email, passwordHash, null, 0, graduation || '', startDate || '', phone || '', notes || '']
  );

  const created = await getUserById(id);
  res.status(201).json(mapUser(created));
});

app.put('/api/users/:userId', authenticateToken, authorizeRoles('manager'), async (req, res) => {
  const { userId } = req.params;
  const { name, email, role, department, graduation, startDate, phone, notes } = req.body;
  const user = await getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }

  if (email) {
    const existing = await getUserByEmail(email);
    if (existing && existing.id !== userId) {
      return res.status(400).json({ error: 'Bu e-posta başka bir kullanıcı tarafından kullanılıyor.' });
    }
  }

  const fields = [];
  const params = [];

  if (name !== undefined) {
    params.push(name);
    fields.push(`name = $${params.length}`);
  }
  if (email !== undefined) {
    params.push(email);
    fields.push(`email = $${params.length}`);
  }
  if (role !== undefined) {
    params.push(role);
    fields.push(`role = $${params.length}`);
  }
  if (department !== undefined) {
    params.push(department);
    fields.push(`department = $${params.length}`);
  }
  if (graduation !== undefined) {
    params.push(graduation);
    fields.push(`graduation = $${params.length}`);
  }
  if (startDate !== undefined) {
    params.push(startDate);
    fields.push(`start_date = $${params.length}`);
  }
  if (phone !== undefined) {
    params.push(phone);
    fields.push(`phone = $${params.length}`);
  }
  if (notes !== undefined) {
    params.push(notes);
    fields.push(`notes = $${params.length}`);
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'Güncellenecek alan yok.' });
  }

  params.push(userId);
  await query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
  const updated = await getUserById(userId);
  res.json(mapUser(updated));
});

app.delete('/api/users/:userId', authenticateToken, authorizeRoles('manager'), async (req, res) => {
  const { userId } = req.params;
  const result = await query('DELETE FROM users WHERE id = $1', [userId]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }
  res.json({ message: 'Kullanıcı silindi.' });
});

app.get('/api/leaves', authenticateToken, async (req, res) => {
  const { userId, status, fromDate, toDate } = req.query;
  const conditions = [];
  const params = [];

  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (fromDate) {
    params.push(fromDate);
    conditions.push(`start_date >= $${params.length}`);
  }
  if (toDate) {
    params.push(toDate);
    conditions.push(`end_date <= $${params.length}`);
  }

  const sql = `SELECT * FROM leaves${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC`;
  const result = await query(sql, params);
  res.json(result.rows.map(mapLeave));
});

app.get('/api/users/:userId/leaves', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  if (req.user.id !== userId && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Yetkiniz yok.' });
  }

  const result = await query('SELECT * FROM leaves WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  res.json(result.rows.map(mapLeave));
});

app.get('/api/health-reports', authenticateToken, async (req, res) => {
  const { userId } = req.query;
  if (userId && req.user.id !== userId && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Yetkiniz yok.' });
  }

  const result = userId
    ? await query('SELECT * FROM health_reports WHERE user_id = $1 ORDER BY uploaded_at DESC', [userId])
    : await query('SELECT * FROM health_reports ORDER BY uploaded_at DESC');
  res.json(result.rows.map(mapHealthReport));
});

app.get('/api/dashboard', authenticateToken, async (_req, res) => {
  const pendingResult = await query("SELECT count(*) FROM leaves WHERE status IN ('waiting-supervisor', 'waiting-manager')");
  const approvedResult = await query("SELECT count(*) FROM leaves WHERE status = 'approved'");
  const rejectedResult = await query("SELECT count(*) FROM leaves WHERE status = 'rejected'");
  const usersResult = await query('SELECT count(*) FROM users');

  res.json({
    pending: Number(pendingResult.rows[0].count),
    approved: Number(approvedResult.rows[0].count),
    rejected: Number(rejectedResult.rows[0].count),
    totalUsers: Number(usersResult.rows[0].count)
  });
});

app.post('/api/leaves', authenticateToken, async (req, res) => {
  const { type, startDate, endDate, reason, reportId, reportName, reportPath } = req.body;
  const user = req.user;
  const id = uuidv4();
  const initialStatus = user.role === 'operator' ? 'waiting-supervisor' : 'waiting-manager';
  const approvals = [];

  await query(
    `INSERT INTO leaves (id, user_id, type, start_date, end_date, reason, report_id, report_name, report_path, status, approvals)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, user.id, type, startDate, endDate, reason || null, reportId || null, reportName || null, reportPath || null, initialStatus, JSON.stringify(approvals)]
  );

  const leave = mapLeave({
    id,
    user_id: user.id,
    type,
    start_date: startDate,
    end_date: endDate,
    reason: reason || null,
    report_id: reportId || null,
    report_name: reportName || null,
    report_path: reportPath || null,
    status: initialStatus,
    created_at: new Date().toISOString(),
    approvals
  });

  notifyManagers(leave, user).catch((error) => console.error('Mail bildirim hatası:', error));
  res.status(201).json(leave);
});

app.put('/api/leaves/:leaveId/approve', authenticateToken, async (req, res) => {
  const { leaveId } = req.params;
  const { comment } = req.body;
  const approverId = req.user.id;
  const approverRole = req.user.role;

  const leaveResult = await query('SELECT * FROM leaves WHERE id = $1', [leaveId]);
  const leave = leaveResult.rows[0];
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }

  const requesterResult = await query('SELECT * FROM users WHERE id = $1', [leave.user_id]);
  const requester = requesterResult.rows[0];
  if (!requester) {
    return res.status(404).json({ error: 'Talebi oluşturan kullanıcı bulunamadı.' });
  }

  const approvals = leave.approvals || [];
  let newStatus = leave.status;

  if (approverRole === 'supervisor') {
    if (leave.user_id === approverId) {
      return res.status(403).json({ error: 'Kendi izninizi onaylayamazsınız.' });
    }
    if (requester.role === 'supervisor') {
      return res.status(403).json({ error: 'Vardiya amiri izinlerini yalnızca müdür onaylayabilir.' });
    }
    if (leave.status !== 'waiting-supervisor') {
      return res.status(400).json({ error: 'Bu talep şu anda vardiya amiri onayı için uygun değil.' });
    }
    approvals.push({ approverId, approverRole, comment, action: 'approved', date: new Date().toISOString() });
    newStatus = 'waiting-manager';
  } else {
    if (leave.status !== 'waiting-manager') {
      return res.status(400).json({ error: 'Bu talep şu anda müdür onayı için uygun değil.' });
    }
    if (requester.role === 'supervisor') {
      approvals.push({ approverId, approverRole, comment, action: 'approved', date: new Date().toISOString() });
      newStatus = 'approved';
    } else {
      const supervisorApproval = approvals.find((item) => item.approverRole === 'supervisor' && item.action === 'approved');
      if (!supervisorApproval) {
        return res.status(400).json({ error: 'Önce vardiya amiri onayı gereklidir.' });
      }
      approvals.push({ approverId, approverRole, comment, action: 'approved', date: new Date().toISOString() });
      newStatus = 'approved';
    }
  }

  await query('UPDATE leaves SET status = $1, approvals = $2 WHERE id = $3', [newStatus, JSON.stringify(approvals), leaveId]);
  const updatedLeave = mapLeave({ ...leave, status: newStatus, approvals });
  res.json(updatedLeave);
});

app.put('/api/leaves/:leaveId/reject', authenticateToken, async (req, res) => {
  const { leaveId } = req.params;
  const { comment } = req.body;
  const approverId = req.user.id;
  const approverRole = req.user.role;

  const leaveResult = await query('SELECT * FROM leaves WHERE id = $1', [leaveId]);
  const leave = leaveResult.rows[0];
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }

  const requesterResult = await query('SELECT * FROM users WHERE id = $1', [leave.user_id]);
  const requester = requesterResult.rows[0];
  if (!requester) {
    return res.status(404).json({ error: 'Talebi oluşturan kullanıcı bulunamadı.' });
  }

  if (!['supervisor', 'manager'].includes(approverRole)) {
    return res.status(403).json({ error: 'Yetkiniz yok' });
  }
  if (approverRole === 'supervisor') {
    if (leave.user_id === approverId) {
      return res.status(403).json({ error: 'Kendi izninizi reddedemezsiniz.' });
    }
    if (requester.role === 'supervisor') {
      return res.status(403).json({ error: 'Vardiya amiri izinlerini yalnızca müdür reddedebilir.' });
    }
    if (leave.status !== 'waiting-supervisor') {
      return res.status(400).json({ error: 'Bu talep şu anda vardiya amiri tarafından reddedilemez.' });
    }
  }
  if (approverRole === 'manager' && leave.status !== 'waiting-manager') {
    return res.status(400).json({ error: 'Bu talep şu anda müdür tarafından reddedilemez.' });
  }

  const approvals = leave.approvals || [];
  approvals.push({ approverId, approverRole, comment, action: 'rejected', date: new Date().toISOString() });
  const newStatus = 'rejected';

  await query('UPDATE leaves SET status = $1, approvals = $2 WHERE id = $3', [newStatus, JSON.stringify(approvals), leaveId]);
  const updatedLeave = mapLeave({ ...leave, status: newStatus, approvals });
  res.json(updatedLeave);
});

app.post('/api/users/:userId/photo', authenticateToken, multer({ storage: multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadFolder),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
}) }).single('photo'), async (req, res) => {
  const { userId } = req.params;
  const user = await getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  }
  if (req.user.id !== userId && !['supervisor', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Fotoğraf yükleme yetkiniz yok' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Fotoğraf yüklenmedi' });
  }

  const photoUrl = `/uploads/${req.file.filename}`;
  await query('UPDATE users SET photo_url = $1 WHERE id = $2', [photoUrl, userId]);
  res.json({ photoUrl });
});

const reportUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadFolder),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const accepted = ['image/jpeg', 'image/png', 'application/pdf'];
    cb(null, accepted.includes(file.mimetype));
  }
});

app.post('/api/users/:userId/report', authenticateToken, reportUpload.single('report'), async (req, res) => {
  const { userId } = req.params;
  const user = await getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  }
  if (req.user.id !== userId && !['supervisor', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Rapor yükleme yetkiniz yok' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Rapor yüklenmedi' });
  }

  const id = uuidv4();
  const report = {
    id,
    user_id: userId,
    filename: req.file.filename,
    original_name: req.file.originalname,
    path: `/uploads/${req.file.filename}`
  };

  await query(
    'INSERT INTO health_reports (id, user_id, filename, original_name, path) VALUES ($1, $2, $3, $4, $5)',
    [report.id, report.user_id, report.filename, report.original_name, report.path]
  );

  res.status(201).json(mapHealthReport(report));
});

app.put('/api/leaves/:leaveId', authenticateToken, async (req, res) => {
  const { leaveId } = req.params;
  const { type, startDate, endDate, reason } = req.body;

  const leaveResult = await query('SELECT * FROM leaves WHERE id = $1', [leaveId]);
  const leave = leaveResult.rows[0];
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }
  if (leave.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Yalnızca kendi izin talebinizi düzenleyebilirsiniz.' });
  }
  if (!['waiting-supervisor', 'waiting-manager'].includes(leave.status)) {
    return res.status(400).json({ error: 'Sadece onay bekleyen talepler düzenlenebilir.' });
  }

  const fields = [];
  const params = [];
  if (type !== undefined) {
    params.push(type);
    fields.push(`type = $${params.length}`);
  }
  if (startDate !== undefined) {
    params.push(startDate);
    fields.push(`start_date = $${params.length}`);
  }
  if (endDate !== undefined) {
    params.push(endDate);
    fields.push(`end_date = $${params.length}`);
  }
  if (reason !== undefined) {
    params.push(reason);
    fields.push(`reason = $${params.length}`);
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'Güncellenecek alan yok.' });
  }

  params.push(leaveId);
  await query(`UPDATE leaves SET ${fields.join(', ')} WHERE id = $${params.length}`, params);

  const updatedResult = await query('SELECT * FROM leaves WHERE id = $1', [leaveId]);
  res.json(mapLeave(updatedResult.rows[0]));
});

app.delete('/api/leaves/:leaveId', authenticateToken, async (req, res) => {
  const { leaveId } = req.params;
  const leaveResult = await query('SELECT * FROM leaves WHERE id = $1', [leaveId]);
  const leave = leaveResult.rows[0];
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }
  if (leave.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Yalnızca kendi izin talebinizi iptal edebilirsiniz.' });
  }
  if (!['waiting-supervisor', 'waiting-manager'].includes(leave.status)) {
    return res.status(400).json({ error: 'Sadece bekleyen talepler iptal edilebilir.' });
  }

  await query('DELETE FROM leaves WHERE id = $1', [leaveId]);
  res.json({ message: 'İzin talebi iptal edildi.' });
});

app.post('/api/attendance', authenticateToken, async (req, res) => {
  const { userId, date, status } = req.body;
  if (!userId || !date || !status) {
    return res.status(400).json({ error: 'userId, date ve status gereklidir.' });
  }

  const id = uuidv4();
  await query(
    'INSERT INTO attendance (id, user_id, date, status) VALUES ($1, $2, $3, $4)',
    [id, userId, date, status]
  );
  res.status(201).json({ id, userId, date, status, createdAt: new Date().toISOString() });
});

app.use((req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend build edilmedi.' });
  }
});

async function startServer() {
  await initDb();
  const server = app.listen(port, () => {
    console.log(`HR factory server listening on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} zaten kullanımda.`);
    } else {
      console.error(err);
    }
  });
}

startServer().catch((error) => {
  console.error('Sunucu başlatılamadı:', error);
  process.exit(1);
});
