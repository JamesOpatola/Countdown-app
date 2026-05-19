const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: '*',
    credentials: true
}));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ MongoDB error:', err));

// Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  createdAt: { type: Date, default: Date.now },
  lastEmailSent: { type: Date }
});

const eventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  targetDate: { type: Date, required: true },
  category: { type: String, default: 'Custom' },
  notes: { type: String }
});

const User = mongoose.model('User', userSchema);
const Event = mongoose.model('Event', eventSchema);

// Email Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

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
    
    eventsHTML += `
      <div style="background: #f5efe6; padding: 15px; margin: 10px 0; border-radius: 16px; border-left: 4px solid #c9a96b;">
        <h3 style="margin: 0 0 8px 0;">🎯 ${event.name}</h3>
        <p style="margin: 5px 0; color: #c9a96b; font-size: 20px; font-weight: bold;">
          ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds
        </p>
        <p style="margin: 5px 0; color: #666;">📅 ${target.toLocaleDateString()}</p>
      </div>
    `;
  }
  
  await transporter.sendMail({
    from: `"Prestige Chrono" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `⏰ Daily countdown: ${events.length} event${events.length > 1 ? 's' : ''} remaining`,
    html: `
      <div style="font-family: system-ui; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #c9a96b;">Prestige Chrono</h1>
        <p>Hello ${userName || userEmail.split('@')[0]}!</p>
        <p>Here's your daily countdown update:</p>
        ${eventsHTML}
        <p style="margin-top: 30px; color: #999;">Stay tuned for your special moments ✨</p>
      </div>
    `
  });
}

// Cron Job: Daily at Midnight
cron.schedule('0 0 * * *', async () => {
  console.log('📧 Sending daily emails...');
  const users = await User.find();
  for (const user of users) {
    const events = await Event.find({ userId: user._id, targetDate: { $gt: new Date() } });
    if (events.length > 0) {
      await sendDailyEmail(user.email, user.name, events);
      console.log(`📨 Email sent to ${user.email}`);
    }
  }
});

// Auth Routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ email, password: hashed, name });
    await user.save();
    
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

// Event Routes
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
