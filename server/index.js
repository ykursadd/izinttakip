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

// Frontend static dosyaları
const clientDistFolder = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDistFolder)) {
  app.use(express.static(clientDistFolder));
}

const users = [
  {
    id: 'u1',
    name: 'Ahmet Yılmaz',
    role: 'operator',
    department: 'Cam Kesim',
    email: 'ahmet.yilmaz@fabrikam.com',
    passwordHash: bcrypt.hashSync('Password123!', 10),
    photoUrl: null,
    leaveBalance: 14
  },
  {
    id: 'u2',
    name: 'Merve Demir',
    role: 'supervisor',
    department: 'Kalite',
    email: 'merve.demir@fabrikam.com',
    passwordHash: bcrypt.hashSync('Supervisor123!', 10),
    photoUrl: null,
    leaveBalance: 18
  },
  {
    id: 'u3',
    name: 'Emre Şahin',
    role: 'manager',
    department: 'Üretim',
    email: 'emre.sahin@fabrikam.com',
    passwordHash: bcrypt.hashSync('Manager123!', 10),
    photoUrl: null,
    leaveBalance: 21
  }
];

function createToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES });
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
  const managers = users.filter((item) => item.role === 'manager');
  if (!managers.length) {
    console.log('Email bildirimi: Müdür bulunamadı.');
    return;
  }

  const recipients = managers.map((manager) => manager.email).join(',');
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${port}`;
  const leaveUrl = `${baseUrl}/leaves`; // placeholder, actual route not implemented
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

function authenticateToken(req, res, next) {
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
    const user = users.find((item) => item.id === payload.id);
    if (!user) {
      return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
    }
    req.user = user;
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

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find((item) => item.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'E-posta veya parola hatalı' });
  }
  const token = createToken(user);
  const { passwordHash, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const { passwordHash, ...safeUser } = req.user;
  res.json(safeUser);
});

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadFolder),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const accepted = ['image/jpeg', 'image/png', 'application/pdf'];
    cb(null, accepted.includes(file.mimetype));
  }
});

const leaveRequests = [];
const attendance = [];
const healthReports = [];

app.get('/api/users', authenticateToken, (_req, res) => {
  const safeUsers = users.map(({ passwordHash, ...safeUser }) => safeUser);
  res.json(safeUsers);
});

app.post('/api/users', authenticateToken, authorizeRoles('supervisor', 'manager'), (req, res) => {
  const { name, email, password, role, department, graduation, startDate, phone, notes } = req.body;
  if (!name || !email || !password || !role || !department) {
    return res.status(400).json({ error: 'Gerekli alanlar eksik.' });
  }
  if (req.user.role === 'supervisor' && role !== 'operator') {
    return res.status(403).json({ error: 'Sadece operatör ekleyebilirsiniz.' });
  }
  if (users.some((item) => item.email === email)) {
    return res.status(400).json({ error: 'Bu e-posta zaten kayıtlı.' });
  }

  const newUser = {
    id: uuidv4(),
    name,
    role,
    department,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    photoUrl: null,
    leaveBalance: 0,
    graduation: graduation || '',
    startDate: startDate || '',
    phone: phone || '',
    notes: notes || ''
  };
  users.push(newUser);
  const { passwordHash, ...safeUser } = newUser;
  res.status(201).json(safeUser);
});

app.put('/api/users/:userId', authenticateToken, authorizeRoles('manager'), (req, res) => {
  const { userId } = req.params;
  const { name, email, role, department, graduation, startDate, phone, notes } = req.body;
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }
  if (email && users.some((item) => item.email === email && item.id !== userId)) {
    return res.status(400).json({ error: 'Bu e-posta başka bir kullanıcı tarafından kullanılıyor.' });
  }

  if (name) user.name = name;
  if (email) user.email = email;
  if (role) user.role = role;
  if (department) user.department = department;
  if (graduation !== undefined) user.graduation = graduation;
  if (startDate !== undefined) user.startDate = startDate;
  if (phone !== undefined) user.phone = phone;
  if (notes !== undefined) user.notes = notes;

  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

app.delete('/api/users/:userId', authenticateToken, authorizeRoles('manager'), (req, res) => {
  const { userId } = req.params;
  const index = users.findIndex((item) => item.id === userId);
  if (index === -1) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  }
  users.splice(index, 1);
  res.json({ message: 'Kullanıcı silindi.' });
});

app.get('/api/leaves', authenticateToken, (req, res) => {
  const { userId, status, fromDate, toDate } = req.query;
  let filtered = [...leaveRequests];
  if (userId) {
    filtered = filtered.filter((item) => item.userId === userId);
  }
  if (status) {
    filtered = filtered.filter((item) => item.status === status);
  }
  if (fromDate) {
    filtered = filtered.filter((item) => new Date(item.startDate) >= new Date(fromDate));
  }
  if (toDate) {
    filtered = filtered.filter((item) => new Date(item.endDate) <= new Date(toDate));
  }
  res.json(filtered);
});

app.get('/api/users/:userId/leaves', authenticateToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.id !== userId && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Yetkiniz yok.' });
  }
  const filtered = leaveRequests.filter((item) => item.userId === userId);
  res.json(filtered);
});

app.get('/api/health-reports', authenticateToken, (req, res) => {
  const { userId } = req.query;
  if (userId && req.user.id !== userId && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Yetkiniz yok.' });
  }
  const filtered = userId ? healthReports.filter((item) => item.userId === userId) : healthReports;
  res.json(filtered);
});

app.get('/api/dashboard', authenticateToken, (_req, res) => {
  const pending = leaveRequests.filter((item) => ['waiting-supervisor', 'waiting-manager'].includes(item.status)).length;
  const approved = leaveRequests.filter((item) => item.status === 'approved').length;
  const rejected = leaveRequests.filter((item) => item.status === 'rejected').length;
  res.json({ pending, approved, rejected, totalUsers: users.length });
});

app.post('/api/leaves', authenticateToken, (req, res) => {
  const { type, startDate, endDate, reason, reportId, reportName, reportPath } = req.body;
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Kimlik doğrulama gerekli' });
  }
  const id = uuidv4();
  const initialStatus = user.role === 'operator' ? 'waiting-supervisor' : 'waiting-manager';
  const leave = {
    id,
    userId: user.id,
    type,
    startDate,
    endDate,
    reason,
    reportId: reportId || null,
    reportName: reportName || null,
    reportPath: reportPath || null,
    status: initialStatus,
    createdAt: new Date().toISOString(),
    approvals: []
  };
  leaveRequests.push(leave);
  notifyManagers(leave, user).catch((error) => console.error('Mail bildirim hatası:', error));
  res.status(201).json(leave);
});

app.put('/api/leaves/:leaveId/approve', authenticateToken, (req, res) => {
  const { leaveId } = req.params;
  const { comment } = req.body;
  const approverId = req.user.id;
  const approverRole = req.user.role;
  const leave = leaveRequests.find((item) => item.id === leaveId);
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }
  if (!['supervisor', 'manager'].includes(approverRole)) {
    return res.status(403).json({ error: 'Yetkiniz yok' });
  }
  const requester = users.find((item) => item.id === leave.userId);
  if (!requester) {
    return res.status(404).json({ error: 'Talebi oluşturan kullanıcı bulunamadı.' });
  }
  if (approverRole === 'supervisor') {
    if (leave.userId === approverId) {
      return res.status(403).json({ error: 'Kendi izninizi onaylayamazsınız.' });
    }
    if (requester.role === 'supervisor') {
      return res.status(403).json({ error: 'Vardiya amiri izinlerini yalnızca müdür onaylayabilir.' });
    }
    if (leave.status !== 'waiting-supervisor') {
      return res.status(400).json({ error: 'Bu talep şu anda vardiya amiri onayı için uygun değil.' });
    }
    leave.approvals.push({ approverId, approverRole, comment, action: 'approved', date: new Date().toISOString() });
    leave.status = 'waiting-manager';
  } else {
    if (leave.status !== 'waiting-manager') {
      return res.status(400).json({ error: 'Bu talep şu anda müdür onayı için uygun değil.' });
    }
    if (requester.role === 'supervisor') {
      leave.approvals.push({ approverId, approverRole, comment, action: 'approved', date: new Date().toISOString() });
      leave.status = 'approved';
    } else {
      const supervisorApproval = leave.approvals.find((item) => item.approverRole === 'supervisor' && item.action === 'approved');
      if (!supervisorApproval) {
        return res.status(400).json({ error: 'Önce vardiya amiri onayı gereklidir.' });
      }
      leave.approvals.push({ approverId, approverRole, comment, action: 'approved', date: new Date().toISOString() });
      leave.status = 'approved';
    }
  }
  res.json(leave);
});

app.put('/api/leaves/:leaveId/reject', authenticateToken, (req, res) => {
  const { leaveId } = req.params;
  const { comment } = req.body;
  const approverId = req.user.id;
  const approverRole = req.user.role;
  const leave = leaveRequests.find((item) => item.id === leaveId);
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }
  if (!['supervisor', 'manager'].includes(approverRole)) {
    return res.status(403).json({ error: 'Yetkiniz yok' });
  }
  const requester = users.find((item) => item.id === leave.userId);
  if (!requester) {
    return res.status(404).json({ error: 'Talebi oluşturan kullanıcı bulunamadı.' });
  }
  if (approverRole === 'supervisor') {
    if (leave.userId === approverId) {
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
  leave.approvals.push({ approverId, approverRole, comment, action: 'rejected', date: new Date().toISOString() });
  leave.status = 'rejected';
  res.json(leave);
});

app.post('/api/users/:userId/photo', authenticateToken, upload.single('photo'), (req, res) => {
  const { userId } = req.params;
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  }
  if (req.user.id !== userId && !['supervisor', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Fotoğraf yükleme yetkiniz yok' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Fotoğraf yüklenmedi' });
  }
  user.photoUrl = `/uploads/${req.file.filename}`;
  res.json({ photoUrl: user.photoUrl });
});

app.post('/api/users/:userId/report', authenticateToken, upload.single('report'), (req, res) => {
  const { userId } = req.params;
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  }
  if (req.user.id !== userId && !['supervisor', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Rapor yükleme yetkiniz yok' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Rapor yüklenmedi' });
  }
  const report = {
    id: uuidv4(),
    userId,
    filename: req.file.filename,
    originalName: req.file.originalname,
    path: `/uploads/${req.file.filename}`,
    uploadedAt: new Date().toISOString()
  };
  healthReports.push(report);
  res.status(201).json(report);
});

app.put('/api/leaves/:leaveId', authenticateToken, (req, res) => {
  const { leaveId } = req.params;
  const { type, startDate, endDate, reason } = req.body;
  const leave = leaveRequests.find((item) => item.id === leaveId);
  if (!leave) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }
  if (leave.userId !== req.user.id) {
    return res.status(403).json({ error: 'Yalnızca kendi izin talebinizi düzenleyebilirsiniz.' });
  }
  if (!['waiting-supervisor', 'waiting-manager'].includes(leave.status)) {
    return res.status(400).json({ error: 'Sadece onay bekleyen talepler düzenlenebilir.' });
  }
  if (type) leave.type = type;
  if (startDate) leave.startDate = startDate;
  if (endDate) leave.endDate = endDate;
  if (reason !== undefined) leave.reason = reason;
  res.json(leave);
});

app.delete('/api/leaves/:leaveId', authenticateToken, (req, res) => {
  const { leaveId } = req.params;
  const index = leaveRequests.findIndex((item) => item.id === leaveId);
  if (index === -1) {
    return res.status(404).json({ error: 'İzin talebi bulunamadı' });
  }
  const leave = leaveRequests[index];
  if (leave.userId !== req.user.id) {
    return res.status(403).json({ error: 'Yalnızca kendi izin talebinizi iptal edebilirsiniz.' });
  }
  if (!['waiting-supervisor', 'waiting-manager'].includes(leave.status)) {
    return res.status(400).json({ error: 'Sadece bekleyen talepler iptal edilebilir.' });
  }
  leaveRequests.splice(index, 1);
  res.json({ message: 'İzin talebi iptal edildi.' });
});

app.post('/api/attendance', authenticateToken, (req, res) => {
  const { userId, date, status } = req.body;
  if (req.user.id !== userId && !['supervisor', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Devamsızlık kaydetme yetkiniz yok' });
  }
  attendance.push({ id: uuidv4(), userId, date, status, createdAt: new Date().toISOString() });
  res.status(201).json({ message: 'Devamsızlık kaydedildi' });
});

// SPA Fallback: Tüm API olmayan route'lar için index.html serve et
app.use((req, res) => {
  const indexPath = path.join(__dirname, '../client/dist/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Frontend build edilmedi.' });
  }
});

const server = app.listen(port, () => {
  console.log(`HR factory server listening on http://localhost:${port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} zaten kullanılıyor. Mevcut sunucuyu kapatın veya PORT değişkeniyle farklı bir port seçin.`);
    process.exit(1);
  }
  throw err;
});
