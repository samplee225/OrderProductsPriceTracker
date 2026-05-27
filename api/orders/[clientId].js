const { connect, OrderStore } = require('../_db');

function parseBody(body) {
  if (!body) return undefined;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (error) {
      return undefined;
    }
  }
  return body;
}

module.exports = async (req, res) => {
  try {
    await connect();
    const clientId = req.query.clientId;

    if (!clientId) {
      return res.status(400).json({ message: 'Missing clientId' });
    }

    if (req.method === 'GET') {
      const store = await OrderStore.findOne({ clientId }).lean();
      if (!store) return res.status(404).json({ message: 'No saved orders found' });
      return res.status(200).json({
        clientId: store.clientId,
        activeOrderId: store.activeOrderId,
        orders: store.orders,
        updatedAt: store.updatedAt,
      });
    }

    if (req.method === 'PUT') {
      const body = parseBody(req.body);
      const orders = Array.isArray(body?.orders) ? body.orders : [];
      const activeOrderId = typeof body?.activeOrderId === 'string' ? body.activeOrderId : '';

      const store = await OrderStore.findOneAndUpdate(
        { clientId },
        { $set: { orders, activeOrderId } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();

      return res.status(200).json({
        saved: true,
        clientId: store.clientId,
        activeOrderId: store.activeOrderId,
        orders: store.orders,
        updatedAt: store.updatedAt,
      });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ message: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};
