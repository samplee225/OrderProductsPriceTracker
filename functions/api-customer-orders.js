const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

// Netlify Functions handler (no express listen)
const app = express();
app.use(express.json({ limit: '10mb' }));

const MONGODB_URI = process.env.MONGODB_URI;

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

app.get('/api/customer-orders', async (req, res, next) => {
  try {
    const stores = await OrderStore.find({}).sort({ updatedAt: -1 }).lean();
    const sharedStore = stores.find((store) => store.clientId === SHARED_CUSTOMER_ORDER_ID);

    if (sharedStore) {
      const orders = Array.isArray(sharedStore.orders) ? sharedStore.orders : [];
      const activeOrderId = orders.some((order) => order && order.id === sharedStore.activeOrderId)
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
    stores.forEach((store) => {
      (Array.isArray(store.orders) ? store.orders : []).forEach((order) => {
        if (order && order.id && !orderMap.has(order.id)) orderMap.set(order.id, order);
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
    if (!MONGODB_URI) return res.status(500).json({ message: 'Missing MONGODB_URI' });
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

// Global mongoose connection cache for Lambda reuse
let cached = global.__MONGOOSE_CONN__;
async function connect() {
  if (cached && mongoose.connection.readyState === 1) return;
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
  if (!cached) {
    cached = global.__MONGOOSE_CONN__ = mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  }
  await cached;
}

exports.handler = async (event, context) => {
  try {
    await connect();

    // Express request emulation
    const req = {
      method: event.httpMethod,
      url: event.path,
      headers: event.headers || {},
      body: event.body ? JSON.parse(event.body) : undefined,
      params: {},
    };

    const res = {};

    return await new Promise((resolve, reject) => {
      const _res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(obj) {
          resolve({
            statusCode: this.statusCode || 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(obj),
          });
        },
        set() {},
      };

      app.handle(req, _res, (err) => {
        if (err) {
          reject(err);
        }
      });
    });
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: err.message || 'Server error' }),
    };
  }
};

