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
app.use(cors());

// ========== MongoDB Connection ==========
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.log('❌ MongoDB error:', err));

// ========== Schemas ==========
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const eventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  targetDate: { type: Date, required: true },
  category: { type: String, default: 'Custom' },
  notes: { type: String },
  lastEmailSent: { type: Date, default: null } // Track when we last emailed
});

const User = mongoose.model('User', userSchema);
const Event = mongoose.model('Event', eventSchema);

// ========== Email Setup (Gmail) ==========
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS  // Gmail App Password
  }
});

// ========== Send Email Function ==========
async function sendDailyCountdownEmail(userEmail, userName, events) {
  if (events.length === 0) return;
  
  // Build HTML for all events
  let eventsHTML = '';
  for (const event of events) {
    const now = new Date();
    const target = new Date(event.targetDate);
    const diffMs = target - now;
    
    if (diffMs <= 0) continue; // Skip past events
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (86400000)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (3600000)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (60000)) / 1000);
    
    eventsHTML += `
      <div style="background: #fefce8; padding: 15px; margin: 10px 0; border-radius: 16px; border-left: 4px solid #d97706;">
        <h3 style="margin: 0 0 8px 0; color: #1e1b2e;">🎯 ${event.name}</h3>
        <p style="margin: 5px 0; color: #d97706; font-size: 20px; font-weight: bold;">
          ${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds
        </p>
        <p style="margin: 5px 0; color: #78716c;">📅 ${target.toLocaleDateString()} at ${target.toLocaleTimeString()}</p>
        ${event.notes ? `<p style="margin: 5px 0; color: #78716c;">📝 ${event.notes}</p>` : ''}
      </div>
    `;
  }
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fef9e3; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 32px; padding: 30px; }
        .header { text-align: center; margin-bottom: 30px; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #f0ead8; color: #a8a29e; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="color: #d97706;">⏰ memoir</h1>
          <p>Your daily countdown update</p>
        </div>
        <p>Good ${getTimeOfDay()}, ${userName || userEmail.split('@')[0]}! 👋</p>
        <p>Here's how much time left until your special moments:</p>
        ${eventsHTML}
        <div class="footer">
          <p>You're receiving this because you have active countdowns.</p>
          <p><a href="${process.env.APP_URL}" style="color: #d97706;">Open memoir app →</a></p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  await transporter.sendMail({
    from: `"memoir" <${process.env.EMAIL_USER}>`,
    to: userEmail,
    subject: `✨ Daily countdown: ${events.length} event${events.length > 1 ? 's' : ''} remaining`,
    html: htmlContent
  });
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

// ========== Cron Job: Send emails at 12:00 AM daily ==========
cron.schedule('0 0 * * *', async () => {
  console.log('📧 Running daily email job at midnight...');
  
  const users = await User.find();
  
  for (const user of users) {
    const events = await Event.find({
      userId: user._id,
      targetDate: { $gt: new Date() } // Only future events
    });
    
    if (events.length > 0) {
      // Check if we sent email today
      const today = new Date().toDateString();
      const lastSent = user.lastEmailSent ? new Date(user.lastEmailSent).toDateString() : null;
      
      if (lastSent !== today) {
        await sendDailyCountdownEmail(user.email, user.name, events);
        user.lastEmailSent = new Date();
        await user.save();
        console.log(`📨 Email sent to ${user.email}`);
      }
    }
  }
});

// Also send on server startup (for testing)
setTimeout(async () => {
  console.log('🔔 Checking for midnight emails on startup...');
  const now = new Date();
  if (now.getHours() === 0) {
    // Trigger the cron manually
    const users = await User.find();
    for (const user of users) {
      const events = await Event.find({ userId: user._id, targetDate: { $gt: new Date() } });
      if (events.length > 0) await sendDailyCountdownEmail(user.email, user.name, events);
    }
  }
}, 5000);

// ========== AUTH ROUTES ==========
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
