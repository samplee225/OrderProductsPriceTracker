require('dotenv').config();

const path = require('path');
const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const orderStoreSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    activeOrderId: { type: String, default: '' },
    orders: { type: Array, default: [] },
  },
  { timestamps: true }
);

const OrderStore = mongoose.model('OrderStore', orderStoreSchema);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/api/orders/:clientId', async (req, res, next) => {
  try {
    const store = await OrderStore.findOne({ clientId: req.params.clientId }).lean();
    if (!store) return res.status(404).json({ message: 'No saved orders found' });
    res.json({
      clientId: store.clientId,
      activeOrderId: store.activeOrderId,
      orders: store.orders,
      updatedAt: store.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/orders/:clientId', async (req, res, next) => {
  try {
    const orders = Array.isArray(req.body.orders) ? req.body.orders : [];
    const activeOrderId = typeof req.body.activeOrderId === 'string' ? req.body.activeOrderId : '';

    const store = await OrderStore.findOneAndUpdate(
      { clientId: req.params.clientId },
      { $set: { orders, activeOrderId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({
      saved: true,
      clientId: store.clientId,
      activeOrderId: store.activeOrderId,
      orders: store.orders,
      updatedAt: store.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});

async function start() {
  if (!MONGODB_URI) {
    console.error('Missing MONGODB_URI. Add it to .env before starting the server.');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  app.listen(PORT, () => {
    console.log(`OrderCalc running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Unable to start server:', err);
  process.exit(1);
});
