const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;
const orderStoreSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    activeOrderId: { type: String, default: '' },
    orders: { type: Array, default: [] },
  },
  { timestamps: true }
);

const OrderStore = mongoose.models.OrderStore || mongoose.model('OrderStore', orderStoreSchema);

let cachedConnection = global.__MONGOOSE_CONN__;

async function connect() {
  if (cachedConnection && mongoose.connection.readyState === 1) return;
  if (!MONGODB_URI) throw new Error('Missing MONGODB_URI');
  if (!cachedConnection) {
    cachedConnection = global.__MONGOOSE_CONN__ = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
  }
  await cachedConnection;
}

module.exports = { connect, OrderStore };
