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

let pages, users, products, deposits, purchases, settings, db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db('freehost');
  pages = db.collection('pages');
  users = db.collection('users');
  products = db.collection('products');
  deposits = db.collection('deposits');
  purchases = db.collection('purchases');
  settings = db.collection('settings');
  await users.createIndex({ email: 1 }, { unique: true });
  await products.createIndex({ createdAt: -1 });
  await deposits.createIndex({ status: 1, createdAt: -1 });
  
  const existing = await settings.findOne({ _id: 'config' });
  if (!existing) {
    await settings.insertOne({
      _id: 'config',
      bkashNumber: '01631628306',
      bkashType: 'Personal',
      nagadNumber: '',
      nagadActive: false,
      minDeposit: 50,
      maxDeposit: 10000,
      supportEmail: 'support@freehost.com',
      supportWhatsapp: '',
      supportTelegram: '',
      updatedAt: new Date()
    });
  }
  
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

passport.serializeUser((user, done) => done(null, user._id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (user && user.banned) return done(null, false);
    done(null, user);
  } catch (err) { done(err, null); }
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
    if (user && user.banned) return done(new Error('Account banned'), null);
    if (!user) {
      const result = await users.insertOne({
        email,
        name: profile.displayName || email.split('@')[0],
        photo: profile.photos && profile.photos[0] ? profile.photos[0].value : null,
        googleId: profile.id,
        banned: false,
        wallet: 0,
        totalSpent: 0,
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
  } catch (err) { return done(err, null); }
}));

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (req.user.banned) return res.status(403).json({ error: 'Account banned' });
    return next();
  }
  res.redirect('/login');
}

function requireAuthAPI(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (req.user.banned) return res.status(403).json({ error: 'Account banned' });
    return next();
  }
  res.status(401).json({ error: 'Login required' });
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ============ GOOGLE AUTH ============

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=1' }),
  (req, res) => res.redirect('/dashboard')
);

app.get('/auth/logout', (req, res) => req.logout(() => res.redirect('/')));

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (req.user.banned) return res.status(403).json({ error: 'Account banned' });
    res.json({
      email: req.user.email,
      name: req.user.name,
      photo: req.user.photo,
      wallet: req.user.wallet || 0,
      totalSpent: req.user.totalSpent || 0
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
      html, password: hash,
      views: 0, userId, banned: false,
      createdAt: new Date(),
    });

    res.json({ url: BASE_URL + '/p/' + id, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function checkPassword(page, req) {
  if (!page.password) return true;
  const pass = req.query.pass;
  if (!pass) return false;
  return await bcrypt.compare(pass, page.password);
}

function passwordForm(id) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protected</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:50px;background:#0a0a0a;color:#fff"><h2>🔒 Password Protected</h2>' +
    '<form method="GET" action="/p/' + id + '"><input type="password" name="pass" placeholder="Password" style="padding:12px;font-size:16px;border-radius:8px;border:1px solid #333;background:#151515;color:#fff;margin-top:20px"/>' +
    '<br><button style="padding:12px 24px;font-size:16px;margin-top:12px;border-radius:8px;border:none;background:#fff;color:#000;font-weight:700">Enter</button></form></body></html>';
}

app.get('/p/:id', async (req, res) => {
  try {
    const page = await pages.findOne({ _id: req.params.id });
    if (!page) return res.status(404).send('<h1>404 Not Found</h1>');
    if (page.banned) return res.status(403).send('<h1>⛔ Suspended</h1>');
    if (!(await checkPassword(page, req))) return res.send(passwordForm(req.params.id));
    await pages.updateOne({ _id: req.params.id }, { $inc: { views: 1 } });
    const embedUrl = '/embed/' + req.params.id + (req.query.pass ? '?pass=' + encodeURIComponent(req.query.pass) : '');
    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + (page.title || 'Page') + '</title>' +
      '<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#fff}iframe{width:100%;height:100vh;border:none;display:block}</style></head>' +
      '<body><iframe src="' + embedUrl + '" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"></iframe></body></html>');
  } catch (err) { res.status(500).send('Server error'); }
});

app.get('/embed/:id', async (req, res) => {
  try {
    const page = await pages.findOne({ _id: req.params.id });
    if (!page) return res.status(404).send('<h1>404</h1>');
    if (page.banned) return res.status(403).send('Suspended');
    if (!(await checkPassword(page, req))) return res.status(403).send('Forbidden');
    res.send(page.html);
  } catch (err) { res.status(500).send('Server error'); }
});

// ============ USER ROUTES ============

app.get('/api/my-pages', requireAuthAPI, async (req, res) => {
  const userId = req.user._id.toString();
  const list = await pages.find({ userId }, { projection: { html: 0, password: 0 } })
    .sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.delete('/api/my-pages/:id', requireAuthAPI, async (req, res) => {
  const userId = req.user._id.toString();
  const page = await pages.findOne({ _id: req.params.id });
  if (!page) return res.status(404).json({ error: 'Not found' });
  if (page.userId !== userId) return res.status(403).json({ error: 'Not yours' });
  await pages.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

// ============ SHOP ROUTES (PUBLIC) ============

app.get('/api/shop/products', async (req, res) => {
  try {
    const { category, search, sort } = req.query;
    const query = { active: true };
    if (category && category !== 'all') query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    let sortObj = { createdAt: -1 };
    if (sort === 'price-low') sortObj = { price: 1 };
    if (sort === 'price-high') sortObj = { price: -1 };
    if (sort === 'popular') sortObj = { sold: -1 };
    
    const list = await products.find(query, { projection: { deliveryData: 0 } }).sort(sortObj).toArray();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/product/:id', async (req, res) => {
  try {
    const product = await products.findOne(
      { _id: req.params.id, active: true },
      { projection: { deliveryData: 0 } }
    );
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/categories', async (req, res) => {
  try {
    const cats = await products.distinct('category', { active: true });
    res.json(cats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/settings', async (req, res) => {
  try {
    const s = await settings.findOne({ _id: 'config' });
    res.json({
      bkashNumber: s?.bkashNumber || '',
      bkashType: s?.bkashType || 'Personal',
      nagadNumber: s?.nagadNumber || '',
      nagadActive: s?.nagadActive || false,
      minDeposit: s?.minDeposit || 50,
      maxDeposit: s?.maxDeposit || 10000,
      supportEmail: s?.supportEmail || '',
      supportWhatsapp: s?.supportWhatsapp || '',
      supportTelegram: s?.supportTelegram || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ PURCHASE ROUTES ============

app.post('/api/shop/buy/:id', requireAuthAPI, async (req, res) => {
  try {
    const product = await products.findOne({ _id: req.params.id, active: true });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const alreadyBought = await purchases.findOne({
      userId: req.user._id.toString(),
      productId: req.params.id
    });
    if (alreadyBought) {
      return res.json({ 
        success: true, 
        alreadyOwned: true,
        deliveryType: product.deliveryType,
        deliveryData: product.deliveryData
      });
    }

    const price = product.discountPrice || product.price;
    const userWallet = req.user.wallet || 0;

    if (userWallet < price) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        needed: price - userWallet,
        current: userWallet
      });
    }

    await users.updateOne(
      { _id: req.user._id },
      { $inc: { wallet: -price, totalSpent: price } }
    );

    await purchases.insertOne({
      userId: req.user._id.toString(),
      userEmail: req.user.email,
      productId: product._id,
      productTitle: product.title,
      price: price,
      purchasedAt: new Date()
    });

    await products.updateOne({ _id: product._id }, { $inc: { sold: 1 } });

    res.json({
      success: true,
      deliveryType: product.deliveryType,
      deliveryData: product.deliveryData,
      newBalance: userWallet - price
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/access/:id', requireAuthAPI, async (req, res) => {
  try {
    const purchase = await purchases.findOne({
      userId: req.user._id.toString(),
      productId: req.params.id
    });
    if (!purchase) return res.status(403).json({ error: 'Not purchased' });

    const product = await products.findOne({ _id: req.params.id });
    if (!product) return res.status(404).json({ error: 'Product gone' });

    res.json({
      deliveryType: product.deliveryType,
      deliveryData: product.deliveryData
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/my-purchases', requireAuthAPI, async (req, res) => {
  try {
    const list = await purchases.find({ userId: req.user._id.toString() })
      .sort({ purchasedAt: -1 }).toArray();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ DEPOSIT ROUTES ============

app.post('/api/deposit/request', requireAuthAPI, async (req, res) => {
  try {
    const { amount, senderNumber, transactionId, screenshot } = req.body;
    const config = await settings.findOne({ _id: 'config' });
    const minDep = config?.minDeposit || 50;
    const maxDep = config?.maxDeposit || 10000;

    if (!amount || amount < minDep) return res.status(400).json({ error: 'Minimum ৳' + minDep });
    if (amount > maxDep) return res.status(400).json({ error: 'Maximum ৳' + maxDep });
    if (!senderNumber) return res.status(400).json({ error: 'Sender number required' });

    const result = await deposits.insertOne({
      userId: req.user._id.toString(),
      userEmail: req.user.email,
      userName: req.user.name,
      amount: Number(amount),
      method: 'bKash',
      senderNumber,
      transactionId: transactionId || '',
      screenshot: screenshot || '',
      status: 'pending',
      createdAt: new Date(),
      reviewedAt: null
    });

    res.json({ success: true, id: result.insertedId.toString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/deposit/my-list', requireAuthAPI, async (req, res) => {
  try {
    const list = await deposits.find({ userId: req.user._id.toString() })
      .sort({ createdAt: -1 }).toArray();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
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

app.put('/api/admin/page/:id', adminAuth, async (req, res) => {
  try {
    const { html, title, banned, password } = req.body;
    const update = { updatedAt: new Date() };
    if (html !== undefined) update.html = html;
    if (title !== undefined) update.title = title;
    if (banned !== undefined) update.banned = banned;
    if (password !== undefined) update.password = password ? await bcrypt.hash(password, 10) : null;
    await pages.updateOne({ _id: req.params.id }, { $set: update });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/delete/:id', adminAuth, async (req, res) => {
  await pages.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

app.put('/api/admin/user/:id/ban', adminAuth, async (req, res) => {
  try {
    const { banned } = req.body;
    const userId = req.params.id;
    await users.updateOne({ _id: new ObjectId(userId) }, { $set: { banned: !!banned } });
    await pages.updateMany({ userId }, { $set: { banned: !!banned } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/user/:id', adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    await users.deleteOne({ _id: new ObjectId(userId) });
    await pages.deleteMany({ userId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN: PRODUCTS =====

app.get('/api/admin/products', adminAuth, async (req, res) => {
  const list = await products.find({}).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.post('/api/admin/product', adminAuth, async (req, res) => {
  try {
    const { title, description, category, price, discountPrice, photo, deliveryType, deliveryData, stock } = req.body;
    if (!title || !price || !deliveryData) return res.status(400).json({ error: 'Required: title, price, deliveryData' });

    const result = await products.insertOne({
      title,
      description: description || '',
      category: category || 'Other',
      price: Number(price),
      discountPrice: discountPrice ? Number(discountPrice) : null,
      photo: photo || '',
      deliveryType: deliveryType || 'link',
      deliveryData,
      stock: stock ? Number(stock) : 999,
      sold: 0,
      active: true,
      createdAt: new Date()
    });
    res.json({ success: true, id: result.insertedId.toString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/product/:id', adminAuth, async (req, res) => {
  try {
    const update = { ...req.body, updatedAt: new Date() };
    delete update._id;
    if (update.price) update.price = Number(update.price);
    if (update.discountPrice) update.discountPrice = Number(update.discountPrice);
    if (update.stock !== undefined) update.stock = Number(update.stock);
    await products.updateOne({ _id: req.params.id }, { $set: update });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/product/:id', adminAuth, async (req, res) => {
  await products.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

// ===== ADMIN: DEPOSITS =====

app.get('/api/admin/deposits', adminAuth, async (req, res) => {
  const { status } = req.query;
  const query = status && status !== 'all' ? { status } : {};
  const list = await deposits.find(query).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.put('/api/admin/deposit/:id', adminAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const deposit = await deposits.findOne({ _id: new ObjectId(req.params.id) });
    if (!deposit) return res.status(404).json({ error: 'Not found' });
    if (deposit.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

    if (action === 'approve') {
      await users.updateOne(
        { _id: new ObjectId(deposit.userId) },
        { $inc: { wallet: deposit.amount } }
      );
      await deposits.updateOne(
        { _id: deposit._id },
        { $set: { status: 'approved', reviewedAt: new Date() } }
      );
    } else if (action === 'reject') {
      await deposits.updateOne(
        { _id: deposit._id },
        { $set: { status: 'rejected', reviewedAt: new Date() } }
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN: SETTINGS =====

app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const s = await settings.findOne({ _id: 'config' });
  res.json(s);
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const update = { ...req.body, updatedAt: new Date() };
    delete update._id;
    await settings.updateOne({ _id: 'config' }, { $set: update });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN: ORDERS =====

app.get('/api/admin/purchases', adminAuth, async (req, res) => {
  const list = await purchases.find({}).sort({ purchasedAt: -1 }).limit(100).toArray();
  res.json(list);
});

// ===== ADMIN STATS =====

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const totalPages = await pages.countDocuments();
  const totalUsers = await users.countDocuments();
  const totalProducts = await products.countDocuments();
  const pendingDeposits = await deposits.countDocuments({ status: 'pending' });
  const totalPurchases = await purchases.countDocuments();
  const revenueAgg = await purchases.aggregate([{ $group: { _id: null, t: { $sum: '$price' } } }]).toArray();
  const v = await pages.aggregate([{ $group: { _id: null, v: { $sum: '$views' } } }]).toArray();
  
  res.json({
    totalPages,
    totalUsers,
    totalProducts,
    pendingDeposits,
    totalPurchases,
    totalRevenue: revenueAgg[0]?.t || 0,
    totalViews: v[0]?.v || 0
  });
});

// ============ HTML ROUTES ============

app.get('/login', (req, res) => res.sendFile(__dirname + '/public/login.html'));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(__dirname + '/public/dashboard.html'));
app.get('/shop', (req, res) => res.sendFile(__dirname + '/public/shop.html'));
app.get('/wallet', requireAuth, (req, res) => res.sendFile(__dirname + '/public/wallet.html'));
app.get('/orders', requireAuth, (req, res) => res.sendFile(__dirname + '/public/orders.html'));
app.get('/product/:id', (req, res) => res.sendFile(__dirname + '/public/product.html'));

// ============ START ============

connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('Running on ' + PORT));
});
