require('dotenv').config();

const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Security and performance middleware
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Logging
const isProd = process.env.NODE_ENV === 'production';
app.use(morgan(isProd ? 'combined' : 'dev'));

// Rate limiter (basic protection)
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// CORS: allow list via CORS_ORIGIN (comma-separated) or same origin by default
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser requests (curl, server)
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed'), false);
  }
}));

app.use(express.json({ limit: '10mb' }));

// Serve static assets with caching headers for production
app.use(express.static(__dirname, { maxAge: isProd ? '7d' : 0 }));

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
  // Central error handler - avoid leaking stack traces in production
  if (isProd) console.error(err && err.stack ? err.stack : err);
  else console.error(err);
  res.status(500).json({ message: isProd ? 'Server error' : (err && err.message) || 'Server error' });
});

let server;
async function start() {
  if (!MONGODB_URI) {
    console.error('Missing MONGODB_URI. Add it to .env before starting the server.');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    server = app.listen(PORT, () => {
      console.log(`OrderCalc running at http://localhost:${PORT} (env=${process.env.NODE_ENV || 'development'})`);
    });
  } catch (err) {
    console.error('Unable to connect to database or start server:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`Received ${signal} — closing server`);
    try {
      if (server && server.close) await new Promise(resolve => server.close(resolve));
      await mongoose.disconnect();
      console.log('Shutdown complete');
      process.exit(0);
    } catch (e) {
      console.error('Error during shutdown', e);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch(err => {
  console.error('Unable to start server:', err);
  process.exit(1);
});
