const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'farhad23';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please';
const BASE_URL = process.env.BASE_URL || 'https://freehost-f010.onrender.com';

let pages;
let users;
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('freehost');
  pages = db.collection('pages');
  users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  console.log('DB connected');
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI, dbName: 'freehost' }),
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (user && user.banned) return done(null, false);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: BASE_URL + '/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
    if (!email) return done(new Error('No email found'), null);

    let user = await users.findOne({ email });

    if (user && user.banned) {
      return done(new Error('Account has been banned'), null);
    }

    if (!user) {
      const result = await users.insertOne({
        email,
        name: profile.displayName || email.split('@')[0],
        photo: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
        googleId: profile.id,
        banned: false,
        createdAt: new Date(),
        lastLogin: new Date()
      });
      user = await users.findOne({ _id: result.insertedId });
    } else {
      await users.updateOne({ _id: user._id }, {
        $set: {
          name: profile.displayName || user.name,
          photo: profile.photos && profile.photos[0] ? profile.photos[0].value : user.photo,
          lastLogin: new Date()
        }
      });
      user = await users.findOne({ _id: user._id });
    }

    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}));

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (req.user.banned) {
      return res.status(403).json({ error: 'Account banned' });
    }
    return next();
  }
  res.redirect('/login');
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ============ GOOGLE AUTH ============

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (req, res) => res.redirect('/dashboard')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (req.user.banned) return res.status(403).json({ error: 'Account banned' });
    res.json({
      email: req.user.email,
      name: req.user.name,
      photo: req.user.photo
    });
  } else {
    res.status(401).json({ error: 'Not logged in' });
  }
});

// ============ PAGE ROUTES ============

app.post('/api/create', async (req, res) => {
  try {
    const { html, slug, password, title } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML required' });

    let userId = null;
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      if (req.user.banned) return res.status(403).json({ error: 'Account banned' });
      userId = req.user._id.toString();
    }

    const id = slug ? slug.trim() : Math.random().toString(36).slice(2, 10);
    const hash = password ? await bcrypt.hash(password, 10) : null;

    await pages.insertOne({
      _id: id,
      title: title || 'Untitled',
      html,
      password: hash,
      views: 0,
      userId: userId,
      banned: false,
      createdAt: new Date(),
    });

    res.json({ url: BASE_URL + '/p/' + id, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function checkPassword(page, req) {
  if (!page.password) return true;
  const pass = req.query.pass;
  if (!pass) return false;
  return await bcrypt.compare(pass, page.password);
}

function passwordForm(id) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<title>Protected</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:50px;background:#0a0a0a;color:#fff">' +
    '<h2>🔒 Password Protected</h2>' +
    '<form method="GET" action="/p/' + id + '">' +
    '<input type="password" name="pass" placeholder="Password" ' +
    'style="padding:12px;font-size:16px;border-radius:8px;border:1px solid #333;background:#151515;color:#fff;margin-top:20px"/>' +
    '<br><button style="padding:12px 24px;font-size:16px;margin-top:12px;border-radius:8px;border:none;background:#fff;color:#000;font-weight:700;cursor:pointer">Enter</button>' +
    '</form></body></html>';
}

app.get('/p/:id', async (req, res) => {
  try {
    const page = await pages.findOne({ _id: req.params.id });
    if (!page) return res.status(404).send('<h1>404 Not Found</h1>');
    if (page.banned) return res.status(403).send('<h1>⛔ This page has been suspended</h1>');
    if (!(await checkPassword(page, req))) return res.send(passwordForm(req.params.id));

    await pages.updateOne({ _id: req.params.id }, { $inc: { views: 1 } });

    const embedUrl = '/embed/' + req.params.id + (req.query.pass ? '?pass=' + encodeURIComponent(req.query.pass) : '');

    res.send(
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>' + (page.title || 'Page') + '</title>' +
      '<style>*{margin:0;padding:0;box-sizing:border-box}' +
      'html,body{width:100%;height:100%;overflow:hidden;background:#fff}' +
      'iframe{width:100%;height:100vh;border:none;display:block}</style>' +
      '</head><body>' +
      '<iframe src="' + embedUrl + '" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"></iframe>' +
      '</body></html>'
    );
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.get('/embed/:id', async (req, res) => {
  try {
    const page = await pages.findOne({ _id: req.params.id });
    if (!page) return res.status(404).send('<h1>404 Not Found</h1>');
    if (page.banned) return res.status(403).send('Suspended');
    if (!(await checkPassword(page, req))) return res.status(403).send('Forbidden');
    res.send(page.html);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ============ USER ROUTES ============

app.get('/api/my-pages', requireAuth, async (req, res) => {
  if (req.user.banned) return res.status(403).json({ error: 'Account banned' });
  const userId = req.user._id.toString();
  const list = await pages.find(
    { userId: userId },
    { projection: { html: 0, password: 0 } }
  ).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.delete('/api/my-pages/:id', requireAuth, async (req, res) => {
  const userId = req.user._id.toString();
  const page = await pages.findOne({ _id: req.params.id });
  if (!page) return res.status(404).json({ error: 'Not found' });
  if (page.userId !== userId) return res.status(403).json({ error: 'Not yours' });
  await pages.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

// ============ ADMIN ROUTES ============

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.get('/api/admin/list-full', adminAuth, async (req, res) => {
  const list = await pages.find({}, { projection: { password: 0 } })
    .sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.get('/api/admin/list-users', adminAuth, async (req, res) => {
  const list = await users.find({}, { projection: { googleId: 0 } })
    .sort({ createdAt: -1 }).toArray();
  res.json(list);
});

// ✏️ EDIT PAGE ROUTE — এটাই নতুন
app.put('/api/admin/page/:id', adminAuth, async (req, res) => {
  try {
    const { html, title, banned, password } = req.body;
    const update = { updatedAt: new Date() };
    
    if (html !== undefined) update.html = html;
    if (title !== undefined) update.title = title;
    if (banned !== undefined) update.banned = banned;
    
    if (password !== undefined) {
      update.password = password ? await bcrypt.hash(password, 10) : null;
    }

    await pages.updateOne({ _id: req.params.id }, { $set: update });
    res.json({ success: true, updatedAt: update.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/delete/:id', adminAuth, async (req, res) => {
  await pages.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

// 🚫 BAN USER
app.put('/api/admin/user/:id/ban', adminAuth, async (req, res) => {
  try {
    const { banned } = req.body;
    const userId = req.params.id;

    await users.updateOne({ _id: new ObjectId(userId) }, { $set: { banned: !!banned } });
    await pages.updateMany({ userId: userId }, { $set: { banned: !!banned } });

    res.json({ success: true, banned: !!banned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🗑 DELETE USER
app.delete('/api/admin/user/:id', adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    await users.deleteOne({ _id: new ObjectId(userId) });
    await pages.deleteMany({ userId: userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const totalPages = await pages.countDocuments();
  const totalUsers = await users.countDocuments();
  const r = await pages.aggregate([{ $group: { _id: null, v: { $sum: '$views' } } }]).toArray();
  res.json({ totalPages, totalUsers, totalViews: r[0]?.v || 0 });
});

app.get('/login', (req, res) => res.sendFile(__dirname + '/public/login.html'));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(__dirname + '/public/dashboard.html'));

connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('Running on ' + PORT));
});
