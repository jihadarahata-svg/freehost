const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'farhad23';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-please';
const BASE_URL = process.env.BASE_URL || 'https://freehost-f010.onrender.com';

const WELCOME_BONUS = 20;
const REFERRAL_BONUS = 10;

let pages, users, products, deposits, purchases, settings, db;

// ===== DEFAULT CONTENT (A-Z Editable Text) =====
const DEFAULT_CONTENT = {
  wallet: {
    title: "My Wallet",
    balanceLabel: "Current Balance",
    safeText: "🔒 Safe & Secure",
    giftTitle: "🎁 Redeem Gift Code",
    giftDesc: "আপনার gift code লিখুন এবং wallet এ টাকা পান!",
    giftPlaceholder: "GIFT CODE",
    giftButton: "🎉 Claim",
    addMoneyTab: "➕ Add Money",
    historyTab: "📋 History",
    howToTitle: "💰 How to Add Money",
    howToInfo: "⚠️ bKash এ Send Money করুন → Screenshot upload করুন → Admin approve করলে Wallet এ যোগ হবে (২-৪ ঘণ্টা)",
    sendLabel: "Send Money to bKash",
    copyBtn: "📋 Copy Number",
    amountLabel: "Amount (৳)",
    amountPlaceholder: "সর্বনিম্ন 50 টাকা",
    bkashLabel: "Your bKash Number",
    bkashPlaceholder: "01XXXXXXXXX",
    trxLabel: "Transaction ID (ঐচ্ছিক)",
    trxPlaceholder: "TRX...",
    screenshotLabel: "Screenshot URL (bKash Payment এর ছবি)",
    screenshotPlaceholder: "https://photo-url.jpg",
    submitBtn: "🚀 Submit Request",
    noHistory: "এখনো কোনো history নেই",
    loadingText: "Loading..."
  },
  referral: {
    title: "Invite Friends & Earn ৳10",
    subtitle: "প্রতিটা বন্ধু sign up করলে ৳10 পাবেন + সে পাবে ৳20 bonus",
    copyBtn: "📋 Copy",
    referralsLabel: "Referrals",
    earnedLabel: "Earned",
    whatsappBtn: "💬 WhatsApp",
    telegramBtn: "📢 Telegram",
    facebookBtn: "📘 Facebook",
    whoJoinedTitle: "🎉 Who Joined",
    shareMessage: "🎁 Join FreeHost and get ৳20 bonus!"
  },
  shop: {
    logoText: "FreeHost Shop",
    searchPlaceholder: "🔍 কী খুঁজছেন?",
    walletBtn: "Wallet",
    ordersBtn: "Orders",
    cartBtn: "Cart",
    meBtn: "Me",
    heroBadge: "🔥 Limited Time",
    heroHeading: "HTML Templates Mega Pack",
    heroSubtitle: "৫০টা প্রিমিয়াম টেমপ্লেট — মাত্র ৳১০০",
    heroButton: "এখনই কিনুন →",
    featuredTitle: "⚡ Featured Products",
    allProductsTitle: "📦 All Products",
    seeAllText: "See all →",
    buyNowText: "Buy Now",
    addToCartText: "Add to Cart",
    noProductsText: "কোনো product পাওয়া যায়নি",
    tryDifferentText: "অন্য কিছু খুঁজুন",
    footerCopyright: "© 2026 FreeHost Shop",
    footerText: "All rights reserved",
    filterBtn: "⚙ Filter",
    sortNewest: "Newest",
    sortPriceLow: "Price: Low to High",
    sortPriceHigh: "Price: High to Low",
    sortPopular: "Most Popular"
  },
  product: {
    backBtn: "← Back to Shop",
    buyNowBtn: "🛒 Buy Now",
    loginToBuyBtn: "🔒 Login to Buy",
    confirmPurchaseTitle: "📦 Confirm Purchase",
    currentBalanceLabel: "Your Balance",
    afterPurchaseLabel: "After Purchase",
    confirmBtn: "✅ Confirm & Buy",
    cancelBtn: "❌ Cancel",
    purchasedTitle: "✅ Purchase Successful!",
    paidLabel: "Paid",
    newBalanceLabel: "New Balance",
    deliveryReadyText: "Your Product is Ready!",
    downloadBtn: "📥 Download Now",
    copyLinkBtn: "🔗 Copy Link",
    backToShopBtn: "🏠 Back to Shop",
    contactSupportBtn: "💬 Contact Support",
    descriptionLabel: "📝 Description",
    categoryLabel: "📦 Category",
    tagsLabel: "🏷 Tags",
    insufficientBalanceMsg: "❌ Insufficient balance",
    loginRequiredMsg: "❌ Login required"
  },
  login: {
    title: "Welcome to FreeHost",
    subtitle: "Sign in or create account to continue",
    signinTab: "Sign In",
    signupTab: "Sign Up",
    emailLabel: "Email",
    emailPlaceholder: "your@email.com",
    passwordLabel: "Password",
    passwordPlaceholder: "Your password",
    nameLabel: "Full Name",
    namePlaceholder: "Your name",
    signinButton: "Sign In",
    signupButton: "Create Account",
    backBtn: "← Back to home",
    termsText: "By signing in, you agree to our Terms of Service"
  },
  dashboard: {
    title: "My Dashboard",
    subtitle: "Manage all your hosted pages",
    pagesLabel: "Total Pages",
    viewsLabel: "Total Views",
    walletLabel: "Wallet Balance",
    hostPageBtn: "+ Host New Page",
    shopBtn: "🛍 Visit Shop",
    walletBtn: "💰 My Wallet",
    myPagesTitle: "My Pages",
    noPagesText: "No pages yet",
    hostFirstText: "Host your first HTML page"
  },
  home: {
    title: "FreeHost",
    heroBadge: "✨ New products available",
    heroHeading: "Premium Digital Products",
    heroSubtitle: "Templates, Code, Design — সব এক জায়গায়। তাৎক্ষণিক ডাউনলোড।",
    hostBtn: "🚀 Host Now",
    shopBtn: "🛍 Visit Shop",
    loginBtn: "Sign In",
    htmlPlaceholder: "<h1>Hello World</h1>",
    titleLabel: "Title",
    titlePlaceholder: "My Page",
    slugLabel: "Custom URL",
    slugPlaceholder: "my-page"
  },
  colors: {
    primary: "#8b5cf6",
    accent: "#10b981",
    buttonText: "#ffffff",
    heroGradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
  }
};

// Helper: merge content with defaults
function mergeContent(saved) {
  const result = {};
  for (const section in DEFAULT_CONTENT) {
    result[section] = { ...DEFAULT_CONTENT[section], ...(saved?.[section] || {}) };
  }
  return result;
}

function makeIdQuery(id) {
  const queries = [{ _id: id }];
  try { queries.push({ _id: new ObjectId(id) }); } catch (e) {}
  return { $or: queries };
}

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
      welcomeBonus: 20,
      referralBonus: 10,
      supportEmail: 'support@freehost.com',
      supportWhatsapp: '',
      supportTelegram: '',
      content: {},
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

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  res.redirect('/login');
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

async function getUser(req) {
  if (!req.session || !req.session.userId) return null;
  try {
    let user = null;
    try { user = await users.findOne({ _id: new ObjectId(req.session.userId) }); } catch (e) {}
    if (!user) user = await users.findOne({ _id: req.session.userId });
    return user;
  } catch (e) { return null; }
}

// ============ AUTH ============

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be 6+ characters' });
    }
    const cleanEmail = email.toLowerCase().trim();
    
    const existing = await users.findOne({ email: cleanEmail });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    
    let referrerId = null;
    if (referralCode) {
      try {
        const referrer = await users.findOne({ _id: new ObjectId(referralCode) });
        if (referrer && !referrer.banned) referrerId = referrer._id.toString();
      } catch (e) {}
    }
    
    const config = await settings.findOne({ _id: 'config' });
    const welcomeBonus = referrerId ? (config?.welcomeBonus || WELCOME_BONUS) : 0;
    const referralBonus = config?.referralBonus || REFERRAL_BONUS;
    
    const hash = await bcrypt.hash(password, 10);
    const result = await users.insertOne({
      name: name.trim(),
      email: cleanEmail,
      password: hash,
      banned: false,
      wallet: welcomeBonus,
      totalSpent: 0,
      photo: null,
      referredBy: referrerId,
      referrals: 0,
      createdAt: new Date(),
      lastLogin: new Date()
    });
    
    if (referrerId) {
      await users.updateOne(
        { _id: new ObjectId(referrerId) },
        { $inc: { wallet: referralBonus, referrals: 1 } }
      );
    }
    
    req.session.userId = result.insertedId.toString();
    res.json({ 
      success: true, 
      userId: result.insertedId.toString(),
      welcomeBonus: welcomeBonus,
      referred: !!referrerId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const cleanEmail = email.toLowerCase().trim();
    const user = await users.findOne({ email: cleanEmail });
    
    if (!user) return res.status(401).json({ error: 'Email or password wrong' });
    if (user.banned) return res.status(403).json({ error: 'Account banned' });
    if (!user.password) return res.status(401).json({ error: 'Please sign up again' });
    
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Email or password wrong' });
    
    await users.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } });
    req.session.userId = user._id.toString();
    
    res.json({ success: true, user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      wallet: user.wallet || 0,
      totalSpent: user.totalSpent || 0
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  if (user.banned) return res.status(403).json({ error: 'Banned' });
  res.json({
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    photo: user.photo,
    wallet: user.wallet || 0,
    totalSpent: user.totalSpent || 0,
    referrals: user.referrals || 0,
    referredBy: user.referredBy || null
  });
});

// ============ REFERRAL ============
app.get('/api/referral/info', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    
    const config = await settings.findOne({ _id: 'config' });
    const referralBonus = config?.referralBonus || REFERRAL_BONUS;
    const welcomeBonus = config?.welcomeBonus || WELCOME_BONUS;
    
    const referred = await users.find(
      { referredBy: user._id.toString() },
      { projection: { email: 1, name: 1, createdAt: 1 } }
    ).sort({ createdAt: -1 }).limit(20).toArray();
    
    res.json({
      link: BASE_URL + '/login?ref=' + user._id.toString(),
      code: user._id.toString(),
      referrals: user.referrals || 0,
      totalEarned: (user.referrals || 0) * referralBonus,
      referralBonus,
      welcomeBonus,
      referredUsers: referred
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ PAGES ============
app.post('/api/create', async (req, res) => {
  try {
    const { html, slug, password, title } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML required' });
    
    const user = await getUser(req);
    let userId = null;
    if (user) {
      if (user.banned) return res.status(403).json({ error: 'Banned' });
      userId = user._id.toString();
    }
    
    const id = slug ? slug.trim() : Math.random().toString(36).slice(2, 10);
    const hash = password ? await bcrypt.hash(password, 10) : null;
    
    await pages.insertOne({
      _id: id,
      title: title || 'Untitled',
      html, password: hash,
      views: 0, userId, banned: false,
      createdAt: new Date()
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
  } catch (err) { res.status(500).send('Error'); }
});

// ============ USER PAGES ============
app.get('/api/my-pages', requireAuth, async (req, res) => {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const userId = user._id.toString();
  const list = await pages.find({ userId }, { projection: { html: 0, password: 0 } })
    .sort({ createdAt: -1 }).toArray();
  res.json(list);
});

// ============ CONTENT (PUBLIC) ============
app.get('/api/content', async (req, res) => {
  try {
    const s = await settings.findOne({ _id: 'config' });
    res.json(mergeContent(s?.content));
  } catch (err) {
    res.json(mergeContent({}));
  }
});

// ============ SHOP (PUBLIC) ============
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
    const q = makeIdQuery(req.params.id);
    q.active = true;
    const product = await products.findOne(q, { projection: { deliveryData: 0 } });
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
      welcomeBonus: s?.welcomeBonus || 20,
      referralBonus: s?.referralBonus || 10,
      supportEmail: s?.supportEmail || '',
      supportWhatsapp: s?.supportWhatsapp || '',
      supportTelegram: s?.supportTelegram || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ PURCHASE ============
app.post('/api/shop/buy/:id', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Login required' });
    
    const q = makeIdQuery(req.params.id);
    q.active = true;
    const product = await products.findOne(q);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const alreadyBought = await purchases.findOne({
      userId: user._id.toString(),
      productId: req.params.id
    });
    if (alreadyBought) {
      return res.json({
        success: true, alreadyOwned: true,
        deliveryType: product.deliveryType,
        deliveryData: product.deliveryData
      });
    }

    const price = product.discountPrice || product.price;
    const userWallet = user.wallet || 0;

    if (userWallet < price) {
      return res.status(400).json({
        error: 'Insufficient balance',
        needed: price - userWallet,
        current: userWallet
      });
    }

    await users.updateOne(
      { _id: user._id },
      { $inc: { wallet: -price, totalSpent: price } }
    );

    await purchases.insertOne({
      userId: user._id.toString(),
      userEmail: user.email,
      productId: req.params.id,
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

app.get('/api/shop/access/:id', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req);
    const purchase = await purchases.findOne({
      userId: user._id.toString(),
      productId: req.params.id
    });
    if (!purchase) return res.status(403).json({ error: 'Not purchased' });
    const q = makeIdQuery(req.params.id);
    const product = await products.findOne(q);
    if (!product) return res.status(404).json({ error: 'Product gone' });
    res.json({
      deliveryType: product.deliveryType,
      deliveryData: product.deliveryData
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/my-purchases', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req);
    const list = await purchases.find({ userId: user._id.toString() })
      .sort({ purchasedAt: -1 }).toArray();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ DEPOSIT ============
app.post('/api/deposit/request', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req);
    const { amount, senderNumber, transactionId, screenshot } = req.body;
    const config = await settings.findOne({ _id: 'config' });
    const minDep = config?.minDeposit || 50;
    const maxDep = config?.maxDeposit || 10000;

    if (!amount || amount < minDep) return res.status(400).json({ error: 'Minimum ৳' + minDep });
    if (amount > maxDep) return res.status(400).json({ error: 'Maximum ৳' + maxDep });
    if (!senderNumber) return res.status(400).json({ error: 'Sender number required' });

    const result = await deposits.insertOne({
      userId: user._id.toString(),
      userEmail: user.email,
      userName: user.name,
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

app.get('/api/deposit/my-list', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req);
    const list = await deposits.find({ userId: user._id.toString() })
      .sort({ createdAt: -1 }).toArray();
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ ADMIN ============
app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Wrong' });
  }
});

app.get('/api/admin/list-full', adminAuth, async (req, res) => {
  const list = await pages.find({}, { projection: { password: 0 } })
    .sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.get('/api/admin/list-users', adminAuth, async (req, res) => {
  const list = await users.find({}, { projection: { password: 0 } })
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
    const result = await pages.updateOne({ _id: req.params.id }, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/delete/:id', adminAuth, async (req, res) => {
  try {
    const result = await pages.deleteOne({ _id: req.params.id });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/user/:id/ban', adminAuth, async (req, res) => {
  try {
    const { banned } = req.body;
    const userId = req.params.id;
    const q = makeIdQuery(userId);
    await users.updateOne(q, { $set: { banned: !!banned } });
    await pages.updateMany({ userId }, { $set: { banned: !!banned } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/user/:id', adminAuth, async (req, res) => {
  try {
    const userId = req.params.id;
    const q = makeIdQuery(userId);
    await users.deleteOne(q);
    await pages.deleteMany({ userId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN PRODUCTS =====
app.get('/api/admin/products', adminAuth, async (req, res) => {
  const list = await products.find({}).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.post('/api/admin/product', adminAuth, async (req, res) => {
  try {
    const { title, description, category, price, discountPrice, photo, deliveryType, deliveryData, stock } = req.body;
    if (!title || !price || !deliveryData) {
      return res.status(400).json({ error: 'Required: title, price, deliveryData' });
    }
    const result = await products.insertOne({
      title: String(title),
      description: String(description || ''),
      category: String(category || 'Other'),
      price: Number(price),
      discountPrice: discountPrice ? Number(discountPrice) : null,
      photo: String(photo || ''),
      deliveryType: String(deliveryType || 'link'),
      deliveryData: String(deliveryData),
      stock: stock ? Number(stock) : 999,
      sold: 0, active: true,
      createdAt: new Date()
    });
    res.json({ success: true, id: result.insertedId.toString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/product/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, category, price, discountPrice, photo, deliveryType, deliveryData, stock, active } = req.body;
    const update = { updatedAt: new Date() };
    if (title !== undefined) update.title = String(title);
    if (description !== undefined) update.description = String(description);
    if (category !== undefined) update.category = String(category);
    if (price !== undefined) update.price = Number(price);
    if (discountPrice !== undefined) update.discountPrice = discountPrice ? Number(discountPrice) : null;
    if (photo !== undefined) update.photo = String(photo);
    if (deliveryType !== undefined) update.deliveryType = String(deliveryType);
    if (deliveryData !== undefined) update.deliveryData = String(deliveryData);
    if (stock !== undefined) update.stock = Number(stock);
    if (active !== undefined) update.active = !!active;

    const q = makeIdQuery(req.params.id);
    const result = await products.updateOne(q, { $set: update });
    if (result.matchedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, modified: result.modifiedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/product/:id', adminAuth, async (req, res) => {
  try {
    const q = makeIdQuery(req.params.id);
    const result = await products.deleteOne(q);
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN DEPOSITS =====
app.get('/api/admin/deposits', adminAuth, async (req, res) => {
  const { status } = req.query;
  const query = status && status !== 'all' ? { status } : {};
  const list = await deposits.find(query).sort({ createdAt: -1 }).toArray();
  res.json(list);
});

app.put('/api/admin/deposit/:id', adminAuth, async (req, res) => {
  try {
    const { action } = req.body;
    const q = makeIdQuery(req.params.id);
    const deposit = await deposits.findOne(q);
    if (!deposit) return res.status(404).json({ error: 'Not found' });
    if (deposit.status !== 'pending') return res.status(400).json({ error: 'Already reviewed' });

    if (action === 'approve') {
      const userQ = makeIdQuery(deposit.userId);
      await users.updateOne(userQ, { $inc: { wallet: deposit.amount } });
      await deposits.updateOne(q, { $set: { status: 'approved', reviewedAt: new Date() } });
    } else if (action === 'reject') {
      await deposits.updateOne(q, { $set: { status: 'rejected', reviewedAt: new Date() } });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN SETTINGS =====
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const s = await settings.findOne({ _id: 'config' });
  res.json(s || {});
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  try {
    const update = { ...req.body, updatedAt: new Date() };
    delete update._id;
    await settings.updateOne({ _id: 'config' }, { $set: update }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN CONTENT =====
app.get('/api/admin/content', adminAuth, async (req, res) => {
  try {
    const s = await settings.findOne({ _id: 'config' });
    res.json(mergeContent(s?.content));
  } catch (err) {
    res.json(mergeContent({}));
  }
});

app.put('/api/admin/content', adminAuth, async (req, res) => {
  try {
    const { section, data } = req.body;
    if (!section || !data) return res.status(400).json({ error: 'Section and data required' });
    if (!DEFAULT_CONTENT[section]) return res.status(400).json({ error: 'Invalid section' });
    
    const s = await settings.findOne({ _id: 'config' });
    const currentContent = (s && s.content) || {};
    
    currentContent[section] = { ...(currentContent[section] || {}), ...data };
    
    await settings.updateOne(
      { _id: 'config' },
      { $set: { content: currentContent, updatedAt: new Date() } },
      { upsert: true }
    );
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/content/reset/:section', adminAuth, async (req, res) => {
  try {
    const section = req.params.section;
    const s = await settings.findOne({ _id: 'config' });
    const currentContent = (s && s.content) || {};
    delete currentContent[section];
    
    await settings.updateOne(
      { _id: 'config' },
      { $set: { content: currentContent, updatedAt: new Date() } }
    );
    
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN PURCHASES =====
app.get('/api/admin/purchases', adminAuth, async (req, res) => {
  const list = await purchases.find({}).sort({ purchasedAt: -1 }).limit(200).toArray();
  res.json(list);
});

// ===== ADMIN REFERRALS =====
app.get('/api/admin/referrals', adminAuth, async (req, res) => {
  try {
    const list = await users.find(
      { referredBy: { $ne: null } },
      { projection: { email: 1, name: 1, referredBy: 1, createdAt: 1, wallet: 1 } }
    ).sort({ createdAt: -1 }).limit(200).toArray();
    
    for (let i = 0; i < list.length; i++) {
      try {
        const ref = await users.findOne(
          { _id: new ObjectId(list[i].referredBy) },
          { projection: { email: 1, name: 1 } }
        );
        if (ref) {
          list[i].referrerEmail = ref.email;
          list[i].referrerName = ref.name;
        }
      } catch (e) {}
    }
    
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== ADMIN STATS =====
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const totalPages = await pages.countDocuments();
  const totalUsers = await users.countDocuments();
  const totalProducts = await products.countDocuments();
  const pendingDeposits = await deposits.countDocuments({ status: 'pending' });
  const totalPurchases = await purchases.countDocuments();
  const totalReferrals = await users.countDocuments({ referredBy: { $ne: null } });
  const revenueAgg = await purchases.aggregate([{ $group: { _id: null, t: { $sum: '$price' } } }]).toArray();
  const v = await pages.aggregate([{ $group: { _id: null, v: { $sum: '$views' } } }]).toArray();
  res.json({
    totalPages, totalUsers, totalProducts,
    pendingDeposits, totalPurchases, totalReferrals,
    totalRevenue: revenueAgg[0]?.t || 0,
    totalViews: v[0]?.v || 0
  });
});

// ============ HTML ROUTES ============
app.get('/login', (req, res) => res.sendFile(__dirname + '/public/login.html'));
app.get('/dashboard', requireAuth, (req, res) => res.sendFile(__dirname + '/public/dashboard.html'));
app.get('/shop', (req, res) => res.sendFile(__dirname + '/public/shop.html'));
app.get('/wallet', requireAuth, (req, res) => res.sendFile(__dirname + '/public/wallet.html'));
app.get('/product/:id', (req, res) => res.sendFile(__dirname + '/public/product.html'));

connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('Running on ' + PORT));
});
