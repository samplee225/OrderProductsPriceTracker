const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

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

let cached = global.__MONGOOSE_CONN__;
async function connect() {
  if (cached && mongoose.connection.readyState === 1) return;
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
  if (!cached) {
    cached = global.__MONGOOSE_CONN__ = mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  }
  await cached;
}

exports.handler = async (event) => {
  try {
    await connect();

    // Determine which route we should use
    const clientId = (event.pathParameters && (event.pathParameters.clientId || event.pathParameters['*'])) || undefined;

    const req = {
      method: event.httpMethod,
      url: event.path,
      headers: event.headers || {},
      body: event.body ? JSON.parse(event.body) : undefined,
      params: {},
    };

    if (!req.params && clientId) req.params = { clientId };

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
        if (err) reject(err);
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

