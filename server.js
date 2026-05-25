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
const SHARED_CUSTOMER_ORDER_ID = 'all-customers';

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/api/customer-orders', async (req, res, next) => {
  try {
    const stores = await OrderStore.find({}).sort({ updatedAt: -1 }).lean();
    const sharedStore = stores.find(store => store.clientId === SHARED_CUSTOMER_ORDER_ID);
    if (sharedStore) {
      const orders = Array.isArray(sharedStore.orders) ? sharedStore.orders : [];
      const activeOrderId = orders.some(order => order && order.id === sharedStore.activeOrderId)
        ? sharedStore.activeOrderId
        : (orders[0] && orders[0].id) || '';

      return res.json({
        clientId: SHARED_CUSTOMER_ORDER_ID,
        activeOrderId,
        orders,
        updatedAt: sharedStore.updatedAt,
      });
    }

    const orderMap = new Map();

    stores.forEach(store => {
      (Array.isArray(store.orders) ? store.orders : []).forEach(order => {
        if (order && order.id && !orderMap.has(order.id)) {
          orderMap.set(order.id, order);
        }
      });
    });

    const orders = Array.from(orderMap.values()).sort((a, b) => {
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return bTime - aTime;
    });

    res.json({
      clientId: SHARED_CUSTOMER_ORDER_ID,
      activeOrderId: (orders[0] && orders[0].id) || '',
      orders,
      updatedAt: stores[0] && stores[0].updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/customer-orders', async (req, res, next) => {
  try {
    const orders = Array.isArray(req.body.orders) ? req.body.orders : [];
    const activeOrderId = typeof req.body.activeOrderId === 'string' ? req.body.activeOrderId : '';

    const store = await OrderStore.findOneAndUpdate(
      { clientId: SHARED_CUSTOMER_ORDER_ID },
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

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  app.listen(PORT, () => {
    console.log(`OrderCalc running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Unable to start server:', err);
  process.exit(1);
});
