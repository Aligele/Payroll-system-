require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const payrollRoutes = require('./routes/payroll');
const leaveRoutes = require('./routes/leave');
const attendanceRoutes = require('./routes/attendance');
const performanceRoutes = require('./routes/performance');
const documentRoutes = require('./routes/documents');
const userRoutes = require('./routes/users');
const overtimeRoutes = require('./routes/overtime');
const wibaRoutes = require('./routes/wiba');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/employees/:employeeId/documents', documentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/overtime', overtimeRoutes);
app.use('/api/wiba', wibaRoutes);

// Serve the frontend (static files) — lives in backend/public so it deploys
// alongside the API on platforms (like Vercel) that only upload this directory.
// Cache-Control is set explicitly to always revalidate: without it, browsers
// and Vercel's edge cache can keep serving an old cached copy of app.js/style.css
// indefinitely after a deploy, which is exactly what happened here — one
// device kept running yesterday's JavaScript long after a fix shipped.
const frontendPath = path.join(__dirname, '../public');
app.use(express.static(frontendPath, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
