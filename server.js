const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', credentials: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ MongoDB error:', err));

// ========== Schemas ==========
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  createdAt: { type: Date, default: Date.now },
  lastEmailSent: { type: Date },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date }
});

const eventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  targetDate: { type: Date, required: true },
  category: { type: String, default: 'Event' },
  notes: { type: String }
});

const User = mongoose.model('User', userSchema);
const Event = mongoose.model('Event', eventSchema);

// ========== Email Setup ==========
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ========== Send Welcome Email (General) ==========
async function sendWelcomeEmail(userEmail, userName) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><style>body{font-family:system-ui;max-width:600px;margin:0 auto;padding:20px;}</style></head>
    <body style="background:#f5f3ff;padding:30px;">
      <div style="background:white;border-radius:24px;padding:30px;text-align:center;">
        <h1 style="color:#7c3aed;">✨ PRESTIGE CHRONO</h1>
        <h2>Welcome ${userName || userEmail.split('@')[0]}! 🎉</h2>
        <p>Your journey of tracking special moments begins now.</p>
        <div style="background:#f5f3ff;border-radius:16px;padding:20px;margin:20px 0;text-align:left;">
          <h3 style="color:#7c3aed;">📅 Getting Started:</h3>
          <ul>
            <li>Add your important events (birthdays, exams, weddings, vacations)</li>
            <li>Get daily countdown emails at 12 AM</li>
            <li>Track your progress from any device</li>
          </ul>
        </div>
        <p>Start counting down to your special moments! ✨</p>
        <p style="color:#6b7280;font-size:12px;">You're receiving this because you signed up for Prestige Chrono.</p>
      </div>
    </body>
    </html>
  `;
  
  await transporter.sendMail({
    from: `"Prestige Chrono" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: '✨ Welcome to Prestige Chrono! Start tracking your special moments',
    html: htmlContent
  });
  console.log(`📧 Welcome email sent to ${userEmail}`);
}

// ========== Send Daily Countdown Email (General) ==========
async function sendDailyEmail(userEmail, userName, events) {
  if (events.length === 0) return;
  
  let eventsHTML = '';
  for (const event of events) {
    const now = new Date();
    const target = new Date(event.targetDate);
    const diffMs = target - now;
    
    if (diffMs <= 0) continue;
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (86400000)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (3600000)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (60000)) / 1000);
    
    const categoryEmoji = {
      'Birthday': '🎂', 'Work': '💼', 'Family': '👨‍👩‍👧', 
      'Vacation': '✈️', 'Wedding': '💍', 'Exam': '📚',
      'Event': '📅', 'Custom': '✨'
    }[event.category] || '📅';
    
    eventsHTML += `
      <div style="background:#f5f3ff; padding:15px; margin:10px 0; border-radius:16px; border-left:4px solid #7c3aed;">
        <h3 style="margin:0 0 8px 0; color:#4c1d95;">${categoryEmoji} ${event.name}</h3>
        <p style="margin:5px 0; color:#7c3aed; font-size:20px; font-weight:bold;">
          ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds
        </p>
        <p style="margin:5px 0; color:#6b7280;">📅 ${target.toLocaleDateString()} at ${target.toLocaleTimeString()}</p>
        ${event.notes ? `<p style="margin:5px 0; color:#6b7280;">📝 ${event.notes}</p>` : ''}
      </div>
    `;
  }
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><style>body{font-family:system-ui;max-width:600px;margin:0 auto;}</style></head>
    <body style="background:#f5f3ff;padding:30px;">
      <div style="background:white;border-radius:24px;padding:30px;">
        <h1 style="color:#7c3aed; text-align:center;">⏰ PRESTIGE CHRONO</h1>
        <p>Hello ${userName || userEmail.split('@')[0]}!</p>
        <h3>📊 Your Daily Countdown Update:</h3>
        ${eventsHTML}
        <p style="margin-top:30px; color:#6b7280; text-align:center;">Every moment counts. Make it special! ✨</p>
      </div>
    </body>
    </html>
  `;
  
  await transporter.sendMail({
    from: `"Prestige Chrono" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `⏰ Daily countdown: ${events.length} event${events.length > 1 ? 's' : ''} remaining`,
    html: htmlContent
  });
  console.log(`📧 Daily email sent to ${userEmail}`);
}

// ========== Send Password Reset Email ==========
async function sendPasswordResetEmail(userEmail, resetToken) {
  const resetUrl = `${process.env.APP_URL || 'https://your-app.vercel.app'}/reset-password?token=${resetToken}`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><style>body{font-family:system-ui;max-width:600px;margin:0 auto;}</style></head>
    <body style="background:#f5f3ff;padding:30px;">
      <div style="background:white;border-radius:24px;padding:30px;text-align:center;">
        <h1 style="color:#7c3aed;">🔐 Reset Your Password</h1>
        <p>You requested to reset your password for Prestige Chrono.</p>
        <a href="${resetUrl}" style="display:inline-block;background:#7c3aed;color:white;padding:12px 24px;border-radius:40px;text-decoration:none;margin:20px 0;">Reset Password</a>
        <p>This link expires in 1 hour.</p>
        <p style="color:#6b7280;font-size:12px;">If you didn't request this, ignore this email.</p>
      </div>
    </body>
    </html>
  `;
  
  await transporter.sendMail({
    from: `"Prestige Chrono" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: '🔐 Reset your Prestige Chrono password',
    html: htmlContent
  });
  console.log(`📧 Password reset email sent to ${userEmail}`);
}

// ========== Cron Job: Daily at Midnight ==========
cron.schedule('0 0 * * *', async () => {
  console.log('📧 Sending daily emails...');
  const users = await User.find();
  for (const user of users) {
    const events = await Event.find({ userId: user._id, targetDate: { $gt: new Date() } });
    if (events.length > 0) {
      await sendDailyEmail(user.email, user.name, events);
      user.lastEmailSent = new Date();
      await user.save();
    }
  }
});

// ========== AUTH ROUTES ==========
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashed, name });
    await user.save();
    
    await sendWelcomeEmail(email, name);
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, email, name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, email, name: user.name } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== PASSWORD RESET ROUTES ==========
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account with that email' });
    
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();
    
    await sendPasswordResetEmail(email, resetToken);
    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    
    if (!user) return res.status(400).json({ error: 'Invalid or expired token' });
    
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== EVENT ROUTES ==========
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/api/events', authMiddleware, async (req, res) => {
  const events = await Event.find({ userId: req.userId });
  res.json(events);
});

app.post('/api/events', authMiddleware, async (req, res) => {
  const event = new Event({ ...req.body, userId: req.userId });
  await event.save();
  res.json(event);
});

app.put('/api/events/:id', authMiddleware, async (req, res) => {
  const event = await Event.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  res.json(event);
});

app.delete('/api/events/:id', authMiddleware, async (req, res) => {
  await Event.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ success: true });
});
// ========== TEST EMAIL ENDPOINT (Remove after testing) ==========
app.get('/api/test-email', async (req, res) => {
    try {
        const testEmail = req.query.email;
        if (!testEmail) {
            return res.json({ message: 'Use /api/test-email?email=your@email.com' });
        }
        await sendWelcomeEmail(testEmail, 'Test User');
        res.json({ message: `✅ Test email sent to ${testEmail}. Check your inbox (and spam folder).` });
    } catch(error) {
        res.status(500).json({ error: error.message });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
