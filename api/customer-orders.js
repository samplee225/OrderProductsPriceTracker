const { connect, OrderStore } = require('./_db');

const SHARED_CUSTOMER_ORDER_ID = 'all-customers';

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

    if (req.method === 'GET') {
      const stores = await OrderStore.find({}).sort({ updatedAt: -1 }).lean();
      const sharedStore = stores.find((store) => store.clientId === SHARED_CUSTOMER_ORDER_ID);

      if (sharedStore) {
        const orders = Array.isArray(sharedStore.orders) ? sharedStore.orders : [];
        const activeOrderId = orders.some((order) => order && order.id === sharedStore.activeOrderId)
          ? sharedStore.activeOrderId
          : (orders[0] && orders[0].id) || '';

        return res.status(200).json({
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

      return res.status(200).json({
        clientId: SHARED_CUSTOMER_ORDER_ID,
        activeOrderId: (orders[0] && orders[0].id) || '',
        orders,
        updatedAt: stores[0] && stores[0].updatedAt,
      });
    }

    if (req.method === 'PUT') {
      const body = parseBody(req.body);
      const orders = Array.isArray(body?.orders) ? body.orders : [];
      const activeOrderId = typeof body?.activeOrderId === 'string' ? body.activeOrderId : '';

      const store = await OrderStore.findOneAndUpdate(
        { clientId: SHARED_CUSTOMER_ORDER_ID },
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
