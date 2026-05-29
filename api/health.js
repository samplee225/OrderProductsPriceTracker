const mongoose = require('mongoose');
const { connect } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    await connect();
    return res.status(200).json({
      ok: true,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    });
  } catch (err) {
    return res.status(503).json({
      ok: false,
      database: 'disconnected',
      message: err.message || 'Database unavailable',
    });
  }
};
