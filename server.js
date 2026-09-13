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

app.get('/p/:id', async (req, res) => {
  const page = await pages.findOne({ _id: req.params.id });
  if (!page) return res.status(404).send('<h1>404 Not Found</h1>');

  if (page.password) {
    const pass = req.query.pass;
    if (!pass || !(await bcrypt.compare(pass, page.password))) {
      return res.send(
        '<body style="font-family:sans-serif;text-align:center;padding:50px">' +
        '<h2>🔒 Password Protected</h2>' +
        '<form method="GET">' +
        '<input type="password" name="pass" placeholder="Password" style="padding:10px;font-size:16px"/>' +
        '<button style="padding:10px 20px;font-size:16px">Enter</button>' +
        '</form></body>'
      );
    }
  }

  await pages.updateOne({ _id: req.params.id }, { $inc: { views: 1 } });
  res.send(page.html);
});

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
