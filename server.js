const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'farhad23';

let pages;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('freehost');
  pages = db.collection('pages');
  console.log('DB connected');
}

function adminAuth(req, res, next) {
  if (req.headers['x-admin-token'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// নতুন page বানানো
app.post('/api/create', async (req, res) => {
  try {
    const { html, slug, password, title } = req.body;
    if (!html) return res.status(400).json({ error: 'HTML required' });

    const id = slug ? slug.trim() : Math.random().toString(36).slice(2, 10);
    const hash = password ? await bcrypt.hash(password, 10) : null;

    await pages.insertOne({
      _id: id,
      title: title || 'Untitled',
      html,
      password: hash,
      views: 0,
      createdAt: new Date(),
    });

    res.json({ url: req.protocol + '://' + req.get('host') + '/p/' + id, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Password check helper =====
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

// ===== Main view - শুধু iframe পাঠায় =====
app.get('/p/:id', async (req, res) => {
  try {
    const page = await pages.findOne({ _id: req.params.id });
    if (!page) return res.status(404).send('<h1>404 Not Found</h1>');

    if (!(await checkPassword(page, req))) {
      return res.send(passwordForm(req.params.id));
    }

    await pages.updateOne({ _id: req.params.id }, { $inc: { views: 1 } });

    const embedUrl = '/embed/' + req.params.id + (req.query.pass ? '?pass=' + encodeURIComponent(req.query.pass) : '');

    res.send(
      '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
        '<meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>' + (page.title || 'Page') + '</title>' +
        '<style>' +
          '*{margin:0;padding:0;box-sizing:border-box}' +
          'html,body{width:100%;height:100%;overflow:hidden;background:#fff}' +
          'iframe{width:100%;height:100vh;border:none;display:block}' +
        '</style>' +
      '</head>' +
      '<body>' +
        '<iframe src="' + embedUrl + '" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"></iframe>' +
      '</body>' +
      '</html>'
    );
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ===== Embed route - আসল HTML এখানে =====
app.get('/embed/:id', async (req, res) => {
  try {
    const page = await pages.findOne({ _id: req.params.id });
    if (!page) return res.status(404).send('<h1>404 Not Found</h1>');

    if (!(await checkPassword(page, req))) {
      return res.status(403).send('Forbidden');
    }

    res.send(page.html);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

// ===== Admin routes =====

app.post('/api/admin/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_PASSWORD });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.get('/api/admin/list', adminAuth, async (req, res) => {
  const list = await pages
    .find({}, { projection: { html: 0, password: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(list);
});

app.get('/api/admin/list-full', adminAuth, async (req, res) => {
  const list = await pages
    .find({}, { projection: { password: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(list);
});

app.delete('/api/admin/delete/:id', adminAuth, async (req, res) => {
  await pages.deleteOne({ _id: req.params.id });
  res.json({ success: true });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const totalPages = await pages.countDocuments();
  const r = await pages
    .aggregate([{ $group: { _id: null, v: { $sum: '$views' } } }])
    .toArray();
  res.json({ totalPages, totalViews: r[0]?.v || 0 });
});

connectDB().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log('Running on ' + PORT));
});
