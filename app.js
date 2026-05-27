/* =========================================================
   OrderCalc — app.js
   ========================================================= */

// ── State ──────────────────────────────────────────────────
let allProducts = [];
let filteredProducts = [];
let cart = {}; // { sku: { ...product, qty } }
let activeType = 'all';
let sheetUrl = '';
let discountPct = 0;
let shippingAmount = 0;
let categoryPrices = {}; // { normalized type/category: pricePerAv }
let usingCSVUrl = '';
let orderName = '';
let orders = [];
let activeOrderId = '';

const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1kPT4_l7zaNnqgTMbU5e_9INI22iRco6rDKvhQ6mflXs/edit?gid=0#gid=0';
const API_BASE_URL = ['file:', 'http:'].includes(window.location.protocol) &&
  !['localhost:3000', '127.0.0.1:3000'].includes(window.location.host)
  ? 'http://localhost:3000/api'
  : '/api';
const CUSTOMER_ORDERS_URL = `${API_BASE_URL}/customer-orders`;
let saveOrdersTimer = null;
let databaseAvailable = true;
let isHydratingOrders = false;

// Probe the API health endpoint once on startup to avoid noisy 404/405 requests
async function probeApi() {
  // If API_BASE_URL is clearly a relative '/api' but we're on a static host, probe to detect availability
  try {
    const url = API_BASE_URL.replace(/\/$/, '') + '/health';
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) {
      databaseAvailable = false;
      console.info('API health check failed:', res.status);
      showToast('Remote orders unavailable; using local storage only.', 'info');
      return false;
    }
    // keep databaseAvailable true
    return true;
  } catch (err) {
    databaseAvailable = false;
    console.info('API health check error:', err && err.message ? err.message : err);
    showToast('Remote orders unavailable; using local storage only.', 'info');
    return false;
  }
}
function normalizeStoredOrders(storedOrders) {
  return Array.isArray(storedOrders)
    ? storedOrders
      .filter(order => order && order.id)
      .map(order => ({ ...order, status: order.status === 'completed' ? 'completed' : 'pending' }))
    : [];
}

function createBlankOrder(name = '') {
  const timestamp = Date.now();
  return {
    id: `order-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    cart: {},
    categoryPrices: {},
    discountPct: 0,
    shippingAmount: 0,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function getActiveOrder() {
  return orders.find(order => order.id === activeOrderId) || orders[0] || null;
}

function resetOrderState() {
  orders = [];
  activeOrderId = '';
  orderName = '';
  cart = {};
  categoryPrices = {};
  discountPct = 0;
  shippingAmount = 0;
  [cartOrderNameInput, orderNameInput].forEach(input => {
    if (input) input.value = '';
  });
}

function ensureActiveOrder() {
  if (getActiveOrder()) return;
  const firstOrder = createBlankOrder(`Customer Order ${orders.length + 1 || 1}`);
  orders.push(firstOrder);
  activeOrderId = firstOrder.id;
  hydrateActiveOrder();
}

function captureActiveOrder() {
  const order = getActiveOrder();
  if (!order) return;
  order.name = orderName;
  order.cart = cart;
  order.categoryPrices = categoryPrices;
  order.discountPct = discountPct;
  order.shippingAmount = shippingAmount;
  order.status = order.status === 'completed' ? 'completed' : 'pending';
  order.updatedAt = Date.now();
}

function hydrateActiveOrder() {
  const order = getActiveOrder();
  if (!order) {
    resetOrderState();
    return;
  }
  activeOrderId = order.id;
  orderName = order.name || '';
  cart = order.cart || {};
  categoryPrices = order.categoryPrices || {};
  discountPct = parseFloat(order.discountPct) || 0;
  shippingAmount = parseFloat(order.shippingAmount) || 0;
  [cartOrderNameInput, orderNameInput].forEach(input => {
    if (input) input.value = orderName;
  });
}

function saveOrdersState() {
  if (isHydratingOrders) return;
  if (!orders.length) return;
  captureActiveOrder();
  scheduleDatabaseSave();
}

function loadOrdersState() {
  resetOrderState();
}

async function loadOrdersFromDatabase() {
  if (!databaseAvailable) return;
  try {
    isHydratingOrders = true;
    const res = await fetch(CUSTOMER_ORDERS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const dbOrders = normalizeStoredOrders(data.orders);

    orders = dbOrders;
    activeOrderId = dbOrders.length && data.activeOrderId && dbOrders.some(order => order.id === data.activeOrderId)
      ? data.activeOrderId
      : (dbOrders[0] && dbOrders[0].id) || '';
    hydrateActiveOrder();
    renderOrderSwitcher();
    updateCartUI();
    refreshVisibleProductControls();
    if (orderScreen.classList.contains('active')) renderOrderPage();
  } catch (err) {
    databaseAvailable = false;
    resetOrderState();
    renderOrderSwitcher();
    updateCartUI();
    refreshVisibleProductControls();
    showToast('Server orders unavailable. Start the backend and refresh.', 'error');
    console.info('Order database unavailable.', err.message);
  } finally {
    isHydratingOrders = false;
  }
}

function scheduleDatabaseSave() {
  if (!databaseAvailable || !orders.length) return;
  clearTimeout(saveOrdersTimer);
  saveOrdersTimer = setTimeout(saveOrdersToDatabase, 450);
}

async function saveOrdersToDatabase() {
  if (!databaseAvailable || !orders.length) return;
  try {
    const res = await fetch(CUSTOMER_ORDERS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, activeOrderId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    databaseAvailable = false;
    showToast('Could not save to server', 'error');
    console.info('Unable to save orders to database.', err.message);
  }
}

function getOrderDisplayName(order, index) {
  const totalQty = Object.values(order.cart || {}).reduce((sum, item) => sum + (parseInt(item.qty, 10) || 0), 0);
  const name = (order.name || '').trim() || `Customer Order ${index + 1}`;
  return `${name} (${totalQty})`;
}

function getOrderStatus(order) {
  return order && order.status === 'completed' ? 'completed' : 'pending';
}

function getOrderStatusLabel(order) {
  return getOrderStatus(order) === 'completed' ? 'Completed' : 'Pending';
}

function formatOrderDate(value) {
  const date = new Date(value || Date.now());
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getOrderCategories(order) {
  const categories = Object.values(order.cart || {}).map(item => getCategoryLabel(item));
  return [...new Set(categories)].filter(Boolean);
}

function getOrderSummary(order) {
  const items = Object.values(order.cart || {});
  const itemCount = items.reduce((sum, item) => sum + (parseInt(item.qty, 10) || 0), 0);
  const prices = order.categoryPrices || {};
  const subtotal = items.reduce((sum, item) => {
    const label = getCategoryLabel(item);
    const price = parseFloat(prices[getCategoryKey(label)]) || 0;
    return sum + (price * getItemAv(item) * (parseInt(item.qty, 10) || 0));
  }, 0);
  const discount = subtotal * ((parseFloat(order.discountPct) || 0) / 100);
  const shipping = parseFloat(order.shippingAmount) || 0;
  return {
    itemCount,
    total: subtotal - discount + shipping,
  };
}

function renderCustomerOrderList() {
  if (!customerOrderCount || !customerOrderList) return;
  customerOrderCount.textContent = orders.length;

  if (!orders.length) {
    customerOrderList.innerHTML = '<span class="cart-name-empty">No customer orders saved</span>';
    return;
  }

  customerOrderList.innerHTML = orders.map((order, index) => {
    const { itemCount, total } = getOrderSummary(order);
    const name = (order.name || '').trim() || `Customer Order ${index + 1}`;
    const categories = getOrderCategories(order);
    const categoryText = categories.length ? categories.join(', ') : 'No category';
    const activeClass = order.id === activeOrderId ? ' active' : '';
    const status = getOrderStatus(order);
    return `
      <button class="customer-order-item${activeClass}" type="button" data-order-id="${escapeHtml(order.id)}">
        <span class="customer-order-name">${escapeHtml(name)}</span>
        <span class="customer-order-status ${status}">${getOrderStatusLabel(order)}</span>
        <span class="customer-order-meta">${itemCount} item${itemCount !== 1 ? 's' : ''} • Created ${formatOrderDate(order.createdAt)}</span>
        <span class="customer-order-categories">${escapeHtml(categoryText)}</span>
        <strong class="customer-order-total">${fmt(total)}</strong>
      </button>
    `;
  }).join('');

  customerOrderList.querySelectorAll('.customer-order-item').forEach(item => {
    item.addEventListener('click', () => {
      switchOrder(item.dataset.orderId);
      closeCustomerOrdersPopup();
    });
  });
}

function renderActiveOrderMeta() {
  if (!activeOrderMeta) return;
  const order = getActiveOrder();
  if (!order) {
    activeOrderMeta.innerHTML = '';
    return;
  }
  const categories = getOrderCategories(order);
  activeOrderMeta.innerHTML = `
    <span class="order-status-dot ${getOrderStatus(order)}">${getOrderStatusLabel(order)}</span>
    <span>Created ${formatOrderDate(order.createdAt)}</span>
    <span>${escapeHtml(categories.length ? categories.join(', ') : 'No category')}</span>
  `;
}

function updateOrderStatusUI() {
  const order = getActiveOrder();
  const status = getOrderStatus(order);
  if (orderStatusPill) {
    orderStatusPill.textContent = getOrderStatusLabel(order);
    orderStatusPill.classList.toggle('completed', status === 'completed');
  }
  if (confirmOrderBtn) {
    confirmOrderBtn.textContent = status === 'completed' ? 'Order Completed' : 'Confirm Order';
    confirmOrderBtn.disabled = !order || status === 'completed';
  }
  renderActiveOrderMeta();
}

function renderOrderSwitcher() {
  [cartOrderSelect, orderPageOrderSelect].forEach(select => {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = orders.map((order, index) => (
      `<option value="${escapeHtml(order.id)}">${escapeHtml(getOrderDisplayName(order, index))}</option>`
    )).join('');
    select.value = orders.some(order => order.id === activeOrderId) ? activeOrderId : previous;
  });
  const disableDelete = orders.length <= 1;
  [cartDeleteOrderBtn, orderPageDeleteOrderBtn].forEach(btn => {
    if (btn) btn.disabled = disableDelete;
  });
  renderCustomerOrderList();
  updateOrderStatusUI();
}

function refreshVisibleProductControls() {
  filteredProducts.forEach(product => {
    refreshProductCard(product.SKU);
    refreshQuickAddItem(product.SKU);
  });
}

function syncActiveOrderViews() {
  hydrateActiveOrder();
  renderOrderSwitcher();
  updateCartUI();
  refreshVisibleProductControls();
  if (orderScreen.classList.contains('active')) renderOrderPage();
}

function switchOrder(orderId) {
  if (orderId === activeOrderId || !orders.some(order => order.id === orderId)) return;
  captureActiveOrder();
  activeOrderId = orderId;
  syncActiveOrderViews();
}

function createNewOrder() {
  captureActiveOrder();
  const nextOrder = createBlankOrder(`Customer Order ${orders.length + 1}`);
  orders.push(nextOrder);
  activeOrderId = nextOrder.id;
  syncActiveOrderViews();
  showToast('New customer order created', 'success');
}

function completeActiveOrder() {
  const order = getActiveOrder();
  if (!order) return;
  if (getOrderStatus(order) === 'completed') return;
  captureActiveOrder();
  order.status = 'completed';
  order.completedAt = Date.now();
  order.updatedAt = Date.now();
  syncActiveOrderViews();
  saveOrdersState();
  showToast('Order completed', 'success');
}

function deleteActiveOrder() {
  if (orders.length <= 1) {
    showToast('Keep at least one order', 'error');
    return;
  }
  captureActiveOrder();
  const deletedIndex = Math.max(0, orders.findIndex(order => order.id === activeOrderId));
  orders = orders.filter(order => order.id !== activeOrderId);
  activeOrderId = (orders[deletedIndex] || orders[deletedIndex - 1] || orders[0]).id;
  syncActiveOrderViews();
  showToast('Order deleted', 'info');
}

// ── Sample Data ────────────────────────────────────────────
const SAMPLE_PRODUCTS = [
  { Name: 'iPhone 15 Pro', Category: 'Phones', Price: '134900', Stock: '12', 'Image URL': 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400', SKU: 'PHN-001' },
  { Name: 'Samsung Galaxy S24', Category: 'Phones', Price: '79999', Stock: '8', 'Image URL': 'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=400', SKU: 'PHN-002' },
  { Name: 'Sony WH-1000XM5', Category: 'Audio', Price: '29990', Stock: '5', 'Image URL': 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400', SKU: 'AUD-001' },
  { Name: 'Apple AirPods Pro', Category: 'Audio', Price: '24900', Stock: '0', 'Image URL': 'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=400', SKU: 'AUD-002' },
  { Name: 'iPad Air M2', Category: 'Tablets', Price: '59900', Stock: '6', 'Image URL': 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=400', SKU: 'TAB-001' },
  { Name: 'MacBook Air M3', Category: 'Laptops', Price: '114900', Stock: '3', 'Image URL': 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400', SKU: 'LAP-001' },
  { Name: 'Dell XPS 15', Category: 'Laptops', Price: '189990', Stock: '2', 'Image URL': 'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?w=400', SKU: 'LAP-002' },
  { Name: 'Logitech MX Master 3', Category: 'Accessories', Price: '9995', Stock: '20', 'Image URL': 'https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?w=400', SKU: 'ACC-001' },
  { Name: 'Samsung 4K Monitor', Category: 'Monitors', Price: '34999', Stock: '7', 'Image URL': 'https://images.unsplash.com/photo-1586210579191-33b45e38fa2c?w=400', SKU: 'MON-001' },
  { Name: 'Keychron K2 Keyboard', Category: 'Accessories', Price: '8999', Stock: '15', 'Image URL': 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400', SKU: 'ACC-002' },
];

// ── DOM Refs ───────────────────────────────────────────────
const setupScreen    = document.getElementById('setup-screen');
const appScreen      = document.getElementById('app-screen');
const orderScreen    = document.getElementById('order-screen');
const sheetUrlInput  = document.getElementById('sheet-url');
const loadBtn        = document.getElementById('load-sheet-btn');
const loadBtnText    = document.getElementById('load-btn-text');
const loadSpinner    = document.getElementById('load-spinner');
const useSampleBtn   = document.getElementById('use-sample-btn');
const searchInput    = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const categoryScroll = document.getElementById('category-scroll');
const quickAddPanel  = document.getElementById('quick-add-panel');
const quickAddList   = document.getElementById('quick-add-list');
const quickAddViewCart = document.getElementById('quick-add-view-cart');
const productsArea   = document.getElementById('products-area');
const productsGrid   = document.getElementById('products-grid');
const emptyState     = document.getElementById('empty-state');
const customerOrdersBtn = document.getElementById('customer-orders-btn');
const customerOrdersModal = document.getElementById('customer-orders-modal');
const closeCustomerOrdersModal = document.getElementById('close-customer-orders-modal');
const cartSheet      = document.getElementById('cart-sheet');
const cartOverlay    = document.getElementById('cart-overlay');
const cartToggleBtn  = document.getElementById('cart-toggle-btn');
const cartBadge      = document.getElementById('cart-badge');
const customerOrderCount = document.getElementById('customer-order-count');
const customerOrderList = document.getElementById('customer-order-list');
const cartNameCount  = document.getElementById('cart-name-count');
const cartNameList   = document.getElementById('cart-name-list');
const activeOrderMeta = document.getElementById('active-order-meta');
const cartItemsList  = document.getElementById('cart-items-list');
const cartEmpty      = document.getElementById('cart-empty');
const clearCartBtn   = document.getElementById('clear-cart-btn');
const viewOrderBtn     = document.getElementById('view-order-btn');
const orderBackBtn     = document.getElementById('order-back-btn');
const cartOrderNameInput = document.getElementById('cart-order-name-input');
const orderNameInput   = document.getElementById('order-name-input');
const cartOrderSelect = document.getElementById('cart-order-select');
const orderPageOrderSelect = document.getElementById('order-page-order-select');
const cartNewOrderBtn = document.getElementById('cart-new-order-btn');
const orderPageNewOrderBtn = document.getElementById('order-page-new-order-btn');
const cartDeleteOrderBtn = document.getElementById('cart-delete-order-btn');
const orderPageDeleteOrderBtn = document.getElementById('order-page-delete-order-btn');
const orderPageItemsList = document.getElementById('order-page-items-list');
const orderPageSummaryItems = document.getElementById('order-page-summary-items');
const orderPageSummarySubtotal = document.getElementById('order-page-summary-subtotal');
const orderPageSummaryDiscount = document.getElementById('order-page-summary-discount');
const orderPageSummaryShipping = document.getElementById('order-page-summary-shipping');
const orderPageSummaryTotalAv = document.getElementById('order-page-summary-total-av');
const orderPageSummaryTotal = document.getElementById('order-page-summary-total');
const orderDiscountInput = document.getElementById('order-discount-input');
const orderShippingInput = document.getElementById('order-shipping-input');
const orderPagePriceList = document.getElementById('order-page-price-list');
const orderStatusPill = document.getElementById('order-status-pill');
const confirmOrderBtn = document.getElementById('confirm-order-btn');
const downloadOrderPdfBtn = document.getElementById('download-order-pdf-btn');
const shareOrderPageBtn = document.getElementById('share-order-page-btn');
const backBtn          = document.getElementById('back-btn');
const refreshBtn       = document.getElementById('refresh-btn');
const productCountBadge= document.getElementById('product-count-badge');
const shareModalOverlay= document.getElementById('share-modal-overlay');
const shareModalBody   = document.getElementById('share-modal-body');
const closeShareModal  = document.getElementById('close-share-modal');
const copyOrderBtn     = document.getElementById('copy-order-btn');
const whatsappOrderBtn = document.getElementById('whatsapp-order-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

// ── Helpers ────────────────────────────────────────────────
const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAv = (n) => 'Av. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getCategoryLabel(item) {
  return (item.Category || 'Uncategorized').toString().trim() || 'Uncategorized';
}

function getCategoryKey(label) {
  return label.toLocaleLowerCase().replace(/\s+/g, ' ');
}

function getTypeLabel(item) {
  return (getProductType(item) || item.Category || 'Uncategorized').toString().trim() || 'Uncategorized';
}

function getItemAv(item) {
  return parseFloat(item['Av.'] != null ? item['Av.'] : item.Price) || 0;
}

function getCategoryPrice(itemOrLabel) {
  const label = typeof itemOrLabel === 'string' ? itemOrLabel : getCategoryLabel(itemOrLabel);
  return parseFloat(categoryPrices[getCategoryKey(label)]) || 0;
}

function getItemTotal(item) {
  return getCategoryPrice(item) * getItemAv(item) * item.qty;
}

function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.textContent = (icons[type] || '') + ' ' + msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Build multiple URL strategies. Google Sheets CSV endpoints do not reliably
// send browser CORS headers, so the app first uses Google's Visualization
// script response, then falls back to read-only CSV proxies.
function buildSheetUrls(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const id = match[1];
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  const gvizUrl   = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&gid=${gid}`;
  const pubUrl    = `https://docs.google.com/spreadsheets/d/${id}/pub?gid=${gid}&single=true&output=csv`;
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  const proxyUrl  = `https://corsproxy.io/?url=${encodeURIComponent(exportUrl)}`;
  const proxy2Url = `https://api.allorigins.win/raw?url=${encodeURIComponent(exportUrl)}`;
  const pubProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(pubUrl)}`;

  return { gvizUrl, pubUrl, exportUrl, proxyUrl, proxy2Url, pubProxyUrl };
}

async function tryFetch(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseGvizTable(response) {
  if (response.status === 'error') {
    const firstError = response.errors && response.errors[0];
    throw new Error((firstError && (firstError.detailed_message || firstError.message)) || 'Google Sheets returned an error');
  }

  const table = response.table;
  if (!table || !table.cols || !table.cols.length || !table.rows || !table.rows.length) return [];

  const headers = table.cols.map((col, index) => {
    const firstRow = table.rows[0];
    const firstRowCell = firstRow && firstRow.c && firstRow.c[index];
    return (col.label || (firstRowCell && firstRowCell.v) || '').toString().trim();
  });

  const dataRows = table.cols.some(col => col.label) ? table.rows : table.rows.slice(1);
  return dataRows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      const cell = row.c && row.c[index];
      obj[header] = ((cell && (cell.f != null ? cell.f : cell.v)) || '').toString().trim();
    });
    return obj;
  }).filter(row => row.Name && row.Name.trim());
}

function fetchViaGviz(url) {
  return new Promise((resolve, reject) => {
    const previousGoogle = window.google;
    const hadGoogle = Object.prototype.hasOwnProperty.call(window, 'google');
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      script.remove();
      if (hadGoogle) window.google = previousGoogle;
      else delete window.google;
    };

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };

    window.google = {
      visualization: {
        Query: {
          setResponse: response => {
            try {
              finish(resolve, parseGvizTable(response));
            } catch (err) {
              finish(reject, err);
            }
          },
        },
      },
    };

    script.src = url;
    script.async = true;
    script.onerror = () => finish(reject, new Error('Google Visualization request failed'));
    document.head.appendChild(script);

    setTimeout(() => finish(reject, new Error('Google Visualization request timed out')), 12000);
  });
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = [];
    let inQ = false, cur = '';
    for (let c of line) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    values.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').replace(/^"|"$/g, '').trim(); });
    return obj;
  }).filter(row => row.Name && row.Name.trim());
}

// ── Fetch from Google Sheets ───────────────────────────────
async function fetchFromSheet(url) {
  const urls = buildSheetUrls(url);
  if (!urls) throw new Error('Invalid Google Sheets URL. Please paste the full sheet link.');

  const strategies = [
    { label: 'Google Visualization', fn: () => fetchViaGviz(urls.gvizUrl) },
    { label: 'AllOrigins export',    fn: async () => parseCSV(await tryFetch(urls.proxy2Url)) },
    { label: 'AllOrigins publish',   fn: async () => parseCSV(await tryFetch(urls.pubProxyUrl)) },
    { label: 'CORS proxy export',    fn: async () => parseCSV(await tryFetch(urls.proxyUrl)) },
  ];

  let lastErr;
  for (const { label, fn } of strategies) {
    try {
      console.log(`[OrderCalc] Trying: ${label}`);
      const products = await fn();
      if (products.length === 0) throw new Error('Parsed 0 products');
      console.log(`[OrderCalc] Success via: ${label}`);
      return products;
    } catch (e) {
      console.debug(`[OrderCalc] ${label} failed:`, e.message);
      lastErr = e;
    }
  }

  console.warn('[OrderCalc] Sheet fetch failed:', (lastErr && lastErr.message) || lastErr);
  throw new Error(
    'Could not load sheet. Make sure:\n' +
    '1. Sheet is published: File → Share → Publish to web → CSV\n' +
    '2. Or shared as "Anyone with the link" viewer'
  );
}

// ── Screen Switching ───────────────────────────────────────
function showApp(products) {
  loadOrdersState();
  allProducts = products;
  activeType = 'all';
  setupScreen.classList.remove('active');
  orderScreen.classList.remove('active');
  appScreen.classList.add('active');
  setProductsVisible(false);
  buildCategories();
  filterAndRender();
  productCountBadge.textContent = `${products.length} product${products.length !== 1 ? 's' : ''}`;
  updateCartUI();
  // Probe API availability first to avoid noisy errors on static hosts
  probeApi().then(ok => {
    if (ok) loadOrdersFromDatabase();
  });
}

function showSetup() {
  appScreen.classList.remove('active');
  orderScreen.classList.remove('active');
  setupScreen.classList.add('active');
  activeType = 'all';
}

function showAppLoading() {
  setupScreen.classList.remove('active');
  orderScreen.classList.remove('active');
  appScreen.classList.add('active');
  setProductsVisible(false);
  productCountBadge.textContent = 'Loading products...';
  categoryScroll.innerHTML = '<button class="cat-chip active" data-category="all">All</button>';
  quickAddPanel.classList.add('hidden');
  quickAddList.innerHTML = '';
  emptyState.classList.add('hidden');
  productsGrid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton skeleton-card"></div>').join('');
}

// ── Type Filters ───────────────────────────────────────────
function getProductType(product) {
  return (product.Type || '').toString().trim();
}

function buildCategories() {
  const typeSet = new Set(allProducts.map(getProductType).filter(Boolean));
  const types = ['all', ...typeSet];
  if (activeType !== 'all' && !typeSet.has(activeType)) activeType = 'all';

  categoryScroll.innerHTML = '';
  types.forEach(type => {
    const btn = document.createElement('button');
    btn.className = 'cat-chip' + (type === activeType ? ' active' : '');
    btn.textContent = type === 'all' ? 'All' : type;
    btn.dataset.type = type;
    btn.addEventListener('click', () => {
      activeType = type;
      document.querySelectorAll('.cat-chip').forEach(b => b.classList.toggle('active', b.dataset.type === type));
      setProductsVisible(true);
      filterAndRender();
    });
    categoryScroll.appendChild(btn);
  });
}

function setProductsVisible(visible) {
  productsArea.classList.toggle('hidden', !visible);
  shopContent.classList.toggle('products-hidden', !visible);
}

// ── Filter & Render ────────────────────────────────────────
function filterAndRender() {
  const q = searchInput.value.toLowerCase();
  filteredProducts = allProducts.filter(p => {
    const productType = getProductType(p);
    const matchType = activeType === 'all' || productType === activeType;
    const matchQ = !q ||
      (p.Name && p.Name.toLowerCase().includes(q)) ||
      (p.SKU && p.SKU.toLowerCase().includes(q)) ||
      (p.Category && p.Category.toLowerCase().includes(q)) ||
      productType.toLowerCase().includes(q);
    return matchType && matchQ;
  });
  renderProducts();
  renderQuickAdd();
}

function renderProducts() {
  productsGrid.innerHTML = '';
  if (filteredProducts.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');
  filteredProducts.forEach(p => productsGrid.appendChild(createProductCard(p)));
}

function getStockNum(p) { return parseInt(p.Stock) || 0; }

function productQtyControlsHtml(sku, qty, stock) {
  return `<div class="product-qty-controls">
    <button class="qty-btn" data-action="dec" data-sku="${sku}">−</button>
    <input class="qty-input" type="number" min="0" max="${stock}" value="${qty}" data-sku="${sku}" aria-label="Quantity">
    <button class="qty-btn" data-action="inc" data-sku="${sku}">+</button>
  </div>`;
}

function bindProductCardControls(card, product) {
  card.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleQtyChange(product.SKU, btn.dataset.action);
    });
  });

  const qtyInput = card.querySelector('.qty-input');
  if (qtyInput) {
    qtyInput.addEventListener('click', e => e.stopPropagation());
    qtyInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') qtyInput.blur();
    });
    qtyInput.addEventListener('change', e => {
      e.stopPropagation();
      setCartQty(product.SKU, qtyInput.value);
    });
  }

  const addBtn = card.querySelector('.product-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      addToCart(product);
    });
  }
}

function bindQtyControls(container, product, openAfterAdd = false) {
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleQtyChange(product.SKU, btn.dataset.action);
    });
  });

  const qtyInput = container.querySelector('.qty-input');
  if (qtyInput) {
    qtyInput.addEventListener('click', e => e.stopPropagation());
    qtyInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') qtyInput.blur();
    });
    qtyInput.addEventListener('change', e => {
      e.stopPropagation();
      setCartQty(product.SKU, qtyInput.value);
    });
  }

  const addBtn = container.querySelector('.quick-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      addToCart(product);
      if (openAfterAdd) openCart();
    });
  }
}

function quickAddActionHtml(product) {
  const stock = getStockNum(product);
  const inCart = cart[product.SKU];
  return inCart
    ? productQtyControlsHtml(product.SKU, inCart.qty, stock)
    : `<button class="quick-add-btn" data-sku="${product.SKU}" ${stock === 0 ? 'disabled' : ''}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add
      </button>`;
}

function createQuickAddItem(product) {
  const stock = getStockNum(product);
  const item = document.createElement('div');
  item.className = 'quick-add-item' + (stock === 0 ? ' out-of-stock' : '');
  item.dataset.sku = product.SKU;

  const imgHtml = product['Image URL']
    ? `<img class="quick-add-img" src="${product['Image URL']}" alt="${product.Name}" loading="lazy" onerror="this.outerHTML='<div class=\\'quick-add-img-placeholder\\'></div>'">`
    : `<div class="quick-add-img-placeholder"></div>`;

  const stockText = stock === 0 ? 'Out of stock' : `${stock} in stock`;
  item.innerHTML = `
    ${imgHtml}
    <div class="quick-add-info">
      <span class="quick-add-name">${product.Name}</span>
      <span class="quick-add-meta">${fmtAv(getItemAv(product))} · ${stockText}</span>
    </div>
    <div class="quick-add-action">${quickAddActionHtml(product)}</div>`;

  bindQtyControls(item, product);
  return item;
}

function renderQuickAdd() {
  const hasSearch = searchInput.value.trim().length > 0;
  if (!hasSearch || filteredProducts.length === 0) {
    quickAddPanel.classList.add('hidden');
    quickAddList.innerHTML = '';
    return;
  }

  quickAddPanel.classList.remove('hidden');
  quickAddList.innerHTML = '';
  filteredProducts.slice(0, 8).forEach(product => quickAddList.appendChild(createQuickAddItem(product)));
}

function createProductCard(product) {
  const stock = getStockNum(product);
  const inCart = cart[product.SKU];
  const card = document.createElement('div');
  card.className = 'product-card' + (stock === 0 ? ' out-of-stock' : '');
  card.dataset.sku = product.SKU;

  const imgHtml = product['Image URL']
    ? `<img class="product-img" src="${product['Image URL']}" alt="${product.Name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'product-img-placeholder\\'>📦</div>'">`
    : `<div class="product-img-placeholder">📦</div>`;

  let stockBadge = '';
  if (stock === 0) stockBadge = `<span class="stock-badge out">Out of Stock</span>`;
  else if (stock <= 5) stockBadge = `<span class="stock-badge low-stock">${stock} left</span>`;
  else stockBadge = `<span class="stock-badge in-stock">In Stock</span>`;

  const qtyControls = inCart
    ? productQtyControlsHtml(product.SKU, inCart.qty, stock)
    : `<button class="product-add-btn" data-sku="${product.SKU}" ${stock === 0 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add
      </button>`;

  card.innerHTML = `
    <div class="product-img-wrap">${imgHtml}${stockBadge}</div>
    <div class="product-info">
      <span class="product-category">${getProductType(product) || product.Category || ''}</span>
      <span class="product-name">${product.Name}</span>
      <span class="product-sku">${product.SKU || ''}</span>
      <span class="product-price">${fmtAv(getItemAv(product))}</span>
    </div>
    ${qtyControls}`;

  bindProductCardControls(card, product);

  return card;
}

// ── Cart Logic ─────────────────────────────────────────────
function addToCart(product) {
  ensureActiveOrder();
  const stock = getStockNum(product);
  if (stock === 0) return;
  if (cart[product.SKU]) {
    if (cart[product.SKU].qty >= stock) { showToast('Max stock reached', 'error'); return; }
    cart[product.SKU].qty++;
  } else {
    cart[product.SKU] = { ...product, qty: 1 };
  }
  updateCartUI();
  refreshProductCard(product.SKU);
  refreshQuickAddItem(product.SKU);
  showToast(`${product.Name} added`, 'success');
}

function handleQtyChange(sku, action) {
  if (!cart[sku]) return;
  const stock = getStockNum(cart[sku]);
  if (action === 'inc') {
    if (cart[sku].qty >= stock) { showToast('Max stock reached', 'error'); return; }
    cart[sku].qty++;
  } else {
    cart[sku].qty--;
    if (cart[sku].qty <= 0) delete cart[sku];
  }
  updateCartUI();
  refreshProductCard(sku);
  refreshQuickAddItem(sku);
}

function setCartQty(sku, rawValue) {
  if (!cart[sku]) return;
  const stock = getStockNum(cart[sku]);
  const nextQty = Math.max(0, Math.min(stock, parseInt(rawValue, 10) || 0));
  if (nextQty === 0) {
    delete cart[sku];
  } else {
    cart[sku].qty = nextQty;
  }
  if (parseInt(rawValue, 10) > stock) showToast('Max stock reached', 'error');
  updateCartUI();
  refreshProductCard(sku);
  refreshQuickAddItem(sku);
}

function refreshProductCard(sku) {
  const card = productsGrid.querySelector(`[data-sku="${sku}"]`);
  if (!card) return;
  const product = allProducts.find(p => p.SKU === sku);
  if (!product) return;
  const inCart = cart[sku];
  const stock = getStockNum(product);
  const ctaArea = card.querySelector('.product-qty-controls, .product-add-btn');
  if (ctaArea) {
    if (inCart) {
      ctaArea.outerHTML = productQtyControlsHtml(sku, inCart.qty, stock);
    } else {
      ctaArea.outerHTML = `<button class="product-add-btn" data-sku="${sku}" ${stock === 0 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add</button>`;
    }
    bindProductCardControls(card, product);
  }
}

function refreshQuickAddItem(sku) {
  const item = quickAddList.querySelector(`[data-sku="${sku}"]`);
  if (!item) return;
  const product = allProducts.find(p => p.SKU === sku);
  if (!product) return;
  const action = item.querySelector('.quick-add-action');
  if (!action) return;
  action.innerHTML = quickAddActionHtml(product);
  bindQtyControls(item, product);
}

function groupCartItemsByCategory(items) {
  return items.reduce((groups, item) => {
    const label = getCategoryLabel(item);
    const key = getCategoryKey(label);
    if (!groups[key]) groups[key] = { label, items: [] };
    groups[key].items.push(item);
    return groups;
  }, {});
}

function groupCartItemsByType(items) {
  return items.reduce((groups, item) => {
    const label = getTypeLabel(item);
    const key = getCategoryKey(label);
    if (!groups[key]) groups[key] = { label, items: [] };
    groups[key].items.push(item);
    return groups;
  }, {});
}

function renderCartItem(item) {
  const imgHtml = item['Image URL']
    ? `<img class="cart-item-img" src="${item['Image URL']}" alt="${item.Name}" onerror="this.outerHTML='<div class=\\'cart-item-img-placeholder\\'>📦</div>'">`
    : `<div class="cart-item-img-placeholder">📦</div>`;

  return `<div class="cart-item">
    ${imgHtml}
    <div class="cart-item-info">
      <div class="cart-item-name">${item.Name}</div>
      <div class="cart-item-price">${fmtAv(getItemAv(item))}</div>
    </div>
    <div class="cart-item-total">${fmt(getItemTotal(item))}</div>
    <div class="cart-item-controls">
      <button class="cart-qty-btn" data-action="dec" data-sku="${item.SKU}">−</button>
      <input class="cart-qty-input" type="number" min="0" max="${getStockNum(item)}" value="${item.qty}" data-sku="${item.SKU}" aria-label="Quantity">
      <button class="cart-qty-btn" data-action="inc" data-sku="${item.SKU}">+</button>
    </div>
  </div>`;
}

function updateCartUI() {
  const items = Object.values(cart);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  saveOrdersState();
  renderOrderSwitcher();

  // Badge
  cartBadge.textContent = totalQty;
  cartBadge.classList.toggle('visible', totalQty > 0);

  cartNameCount.textContent = totalQty;
  cartNameList.innerHTML = items.length
    ? items.map(item => {
      const image = item['Image URL']
        ? `<img class="cart-name-img" src="${escapeHtml(item['Image URL'])}" alt="${escapeHtml(item.Name)}" onerror="this.outerHTML='<div class=\\'cart-name-img-placeholder\\'></div>'">`
        : '<div class="cart-name-img-placeholder"></div>';
      return `
      <div class="cart-name-item" title="${escapeHtml(item.Name)}">
        ${image}
        <span class="cart-name-item-name">${escapeHtml(item.Name)}</span>
        <span class="cart-name-item-qty">x${item.qty}</span>
      </div>`;
    }).join('')
    : '<span class="cart-name-empty">No products added</span>';

  // Cart items
  if (items.length === 0) {
    cartEmpty.classList.remove('hidden');
    cartItemsList.innerHTML = '';
  } else {
    cartEmpty.classList.add('hidden');
    const groupedItems = groupCartItemsByCategory(items);
    cartItemsList.innerHTML = Object.values(groupedItems).map(({ label: category, items: categoryItems }) => {
      const categoryQty = categoryItems.reduce((sum, item) => sum + item.qty, 0);
      const categoryTotal = categoryItems.reduce((sum, item) => sum + getItemTotal(item), 0);

      return `<section class="cart-category-group">
        <div class="cart-category-header">
          <span class="cart-category-name">${category}</span>
          <span class="cart-category-total">${fmt(categoryTotal)}</span>
          <span class="cart-category-meta">${categoryQty} product${categoryQty !== 1 ? 's' : ''}</span>
        </div>
        ${categoryItems.map(renderCartItem).join('')}
      </section>`;
    }).join('');
    cartItemsList.querySelectorAll('.cart-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => handleQtyChange(btn.dataset.sku, btn.dataset.action));
    });
    cartItemsList.querySelectorAll('.cart-qty-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('change', () => setCartQty(input.dataset.sku, input.value));
    });
  }
}

// ── Order Screen ────────────────────────────────────────────
function getBunchInfo(item) {
  const source = (item.Name || item.SKU || 'Product').toString().trim();
  const match = source.match(/^([A-Za-z]+)\s*0*(\d+)/);
  if (!match) return null;

  const prefix = match[1].toUpperCase();
  const number = parseInt(match[2], 10);
  const start = Math.floor((number - 1) / 100) * 100 + 1;
  const end = start + 99;

  return {
    key: `${prefix}-${start}`,
    start,
    end,
    label: `${prefix} ${formatBunchNo(start)} TO ${prefix} ${formatBunchNo(end)}`,
  };
}

function formatBunchNo(value) {
  return String(value).padStart(3, '0');
}

function getOrderPdfBunchRows(items) {
  const groups = items.reduce((acc, item) => {
    const info = getBunchInfo(item);
    const key = info ? info.key : 'other';
    if (!acc[key]) {
      acc[key] = {
        label: info ? info.label : 'Other',
        cellLabel: info ? String(info.end) : 'Other',
        start: info ? info.start : Number.MAX_SAFE_INTEGER,
        items: [],
      };
    }
    acc[key].items.push(item);
    return acc;
  }, {});

  return Object.values(groups)
    .sort((a, b) => a.start - b.start || a.label.localeCompare(b.label))
    .map(group => ({
      label: group.cellLabel,
      products: group.items.map(item => `${item.Name || item.SKU || 'Product'} X ${item.qty}`),
    }));
}

function getOrderTotals() {
  const items = Object.values(cart);
  const totalAv = items.reduce((sum, item) => sum + (getItemAv(item) * item.qty), 0);
  const subtotal = items.reduce((sum, item) => sum + getItemTotal(item), 0);
  const discount = subtotal * (discountPct / 100);
  const shipping = shippingAmount;
  const total = subtotal - discount + shipping;
  return { items, totalAv, subtotal, discount, shipping, total };
}

function getOrderName() {
  return orderName.trim();
}

function syncOrderNameInputs(sourceInput) {
  ensureActiveOrder();
  orderName = sourceInput.value.trim();
  [cartOrderNameInput, orderNameInput].forEach(input => {
    if (input !== sourceInput) input.value = orderName;
  });
  saveOrdersState();
  renderOrderSwitcher();
}

function renderOrderPage() {
  const { items } = getOrderTotals();
  const groupedItems = groupCartItemsByCategory(items);
  updateOrderStatusUI();

  if (!items.length) {
    orderPagePriceList.innerHTML = '';
  } else {
    orderPagePriceList.innerHTML = Object.values(groupedItems).map(({ label: category, items: categoryItems }) => {
      const categoryKey = getCategoryKey(category);
      const categoryPrice = categoryPrices[categoryKey] || '';
      const avTotal = categoryItems.reduce((sum, item) => sum + (getItemAv(item) * item.qty), 0);
      const categoryTotal = avTotal * (parseFloat(categoryPrice) || 0);
      return `<label class="order-price-row">
        <span class="order-price-category">${category}</span>
        <span class="order-price-av">Av. ${avTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <input class="category-price-input" type="number" min="0" step="0.01" value="${categoryPrice}" data-category-key="${categoryKey}" aria-label="${category} price">
        <strong class="order-price-total">${fmt(categoryTotal)}</strong>
      </label>`;
    }).join('');

    orderPagePriceList.querySelectorAll('.category-price-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('change', () => {
        const value = input.value.trim();
        if (value === '') delete categoryPrices[input.dataset.categoryKey];
        else categoryPrices[input.dataset.categoryKey] = Math.max(0, parseFloat(value) || 0);
        renderOrderPage();
        updateCartUI();
      });
    });
  }

  if (!items.length) {
    orderPageItemsList.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><p>Your order is empty</p><span>Add products to the catalog to review them here.</span></div>';
  } else {
    orderPageItemsList.innerHTML = items.map(item => {
      const image = item['Image URL']
        ? `<img class="order-item-img" src="${item['Image URL']}" alt="${item.Name}" onerror="this.outerHTML='<div class=\\'product-img-placeholder\\'>📦</div>'">`
        : '<div class="product-img-placeholder">📦</div>';
      return `<article class="order-item">
        ${image}
        <div class="order-item-info">
          <span class="order-item-name">${item.Name}</span>
          <span class="order-item-meta">SKU: ${item.SKU || '-'} • Type: ${getCategoryLabel(item)}</span>
          <span class="order-item-meta">Qty: ${item.qty} • ${fmtAv(getItemAv(item))} • Price: ${fmt(getCategoryPrice(item))}</span>
        </div>
        <div class="order-item-total-block">
          <span class="order-item-total-label">Line total</span>
          <strong>${fmt(getItemTotal(item))}</strong>
        </div>
      </article>`;
    }).join('');
  }

  updateOrderSummaryTotals();
}

function updateOrderSummaryTotals() {
  const { items, totalAv, subtotal, discount, shipping, total } = getOrderTotals();
  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);

  orderPageSummaryItems.textContent = totalQty;
  orderPageSummarySubtotal.textContent = fmt(subtotal);
  orderPageSummaryDiscount.textContent = `-${fmt(discount)}`;
  orderPageSummaryShipping.textContent = fmt(shipping);
  orderPageSummaryTotalAv.textContent = fmtAv(totalAv);
  orderPageSummaryTotal.textContent = fmt(total);
  if (document.activeElement !== orderDiscountInput) orderDiscountInput.value = discountPct;
  if (document.activeElement !== orderShippingInput) orderShippingInput.value = shippingAmount;
}

function showOrderPage() {
  closeCart();
  renderOrderPage();
  setupScreen.classList.remove('active');
  appScreen.classList.remove('active');
  orderScreen.classList.add('active');
  orderScreen.scrollTop = 0;
}

function showShopPage() {
  orderScreen.classList.remove('active');
  appScreen.classList.add('active');
  setProductsVisible(false);
  updateCartUI();
}

// ── Cart Panel ─────────────────────────────────────────────
function openCart() {
  cartSheet.classList.add('open');
  cartOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeCart() {
  cartSheet.classList.remove('open');
  cartOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

function openCustomerOrdersPopup() {
  renderCustomerOrderList();
  customerOrdersModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeCustomerOrdersPopup() {
  customerOrdersModal.classList.add('hidden');
  document.body.style.overflow = '';
}

cartToggleBtn.addEventListener('click', () => {
  cartSheet.classList.contains('open') ? closeCart() : openCart();
});
quickAddViewCart.addEventListener('click', openCart);
cartOverlay.addEventListener('click', closeCart);
customerOrdersBtn.addEventListener('click', openCustomerOrdersPopup);
closeCustomerOrdersModal.addEventListener('click', closeCustomerOrdersPopup);
customerOrdersModal.addEventListener('click', e => {
  if (e.target === customerOrdersModal) closeCustomerOrdersPopup();
});

// ── Shop Layout ────────────────────────────────────────────
const shopContent = document.querySelector('.shop-content');

// ── Fullscreen ─────────────────────────────────────────────
fullscreenBtn.addEventListener('click', () => {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
});

viewOrderBtn.addEventListener('click', showOrderPage);
orderBackBtn.addEventListener('click', showShopPage);
[cartOrderNameInput, orderNameInput].forEach(input => {
  input.addEventListener('input', () => syncOrderNameInputs(input));
});
[orderDiscountInput, orderShippingInput].forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
  });
});
orderDiscountInput.addEventListener('input', () => {
  ensureActiveOrder();
  discountPct = Math.min(100, Math.max(0, parseFloat(orderDiscountInput.value) || 0));
  updateOrderSummaryTotals();
  saveOrdersState();
});
orderShippingInput.addEventListener('input', () => {
  ensureActiveOrder();
  shippingAmount = Math.max(0, parseFloat(orderShippingInput.value) || 0);
  updateOrderSummaryTotals();
  saveOrdersState();
});
[cartOrderSelect, orderPageOrderSelect].forEach(select => {
  select.addEventListener('change', () => switchOrder(select.value));
});
[cartNewOrderBtn, orderPageNewOrderBtn].forEach(btn => {
  btn.addEventListener('click', createNewOrder);
});
[cartDeleteOrderBtn, orderPageDeleteOrderBtn].forEach(btn => {
  btn.addEventListener('click', deleteActiveOrder);
});

// Swipe down to close
let touchStartY = 0;
cartSheet.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
cartSheet.addEventListener('touchend', e => {
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (dy > 80) closeCart();
});

// ── Clear Cart ─────────────────────────────────────────────
clearCartBtn.addEventListener('click', () => {
  cart = {};
  categoryPrices = {};
  discountPct = 0;
  shippingAmount = 0;
  orderName = '';
  [cartOrderNameInput, orderNameInput].forEach(input => { input.value = ''; });
  updateCartUI();
  // Refresh all product cards
  filteredProducts.forEach(p => {
    refreshProductCard(p.SKU);
    refreshQuickAddItem(p.SKU);
  });
  showToast('Order cleared', 'info');
});

// ── Filtered Products PDF ─────────────────────────────────
function pdfEscape(value) {
  return String(value == null ? '' : value)
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapPdfText(text, maxChars) {
  const words = pdfEscape(text).split(' ');
  const lines = [];
  let line = '';
  words.forEach(word => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function buildFilteredProductsPdf(products) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const bottom = 44;
  const lineHeight = 14;
  const pages = [];
  let lines = [];
  let y = pageHeight - margin;

  const addLine = (text, size = 10, gap = lineHeight) => {
    if (y < bottom) {
      pages.push(lines);
      lines = [];
      y = pageHeight - margin;
    }
    lines.push({ text: pdfEscape(text), size, x: margin, y });
    y -= gap;
  };

  const activeFilter = activeType === 'all' ? 'All products' : activeType;
  addLine('OrderCalc Filtered Products', 18, 24);
  addLine(`Filter: ${activeFilter}`, 10);
  addLine(`Search: ${searchInput.value.trim() || 'None'}`, 10);
  addLine(`Products: ${products.length}`, 10);
  addLine(`Generated: ${new Date().toLocaleString('en-IN')}`, 10, 22);

  products.forEach((product, index) => {
    const type = getProductType(product) || product.Category || 'Uncategorized';
    const av = Number(getItemAv(product)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const stock = getStockNum(product);
    const heading = `${index + 1}. ${product.Name || 'Unnamed product'}`;
    wrapPdfText(heading, 78).forEach((line, lineIndex) => addLine(line, lineIndex === 0 ? 11 : 10));
    addLine(`SKU: ${product.SKU || '-'}   Type: ${type}   Av.: ${av}   Stock: ${stock}`, 9, 18);
  });

  if (!products.length) addLine('No products match the current filter.', 11);
  if (lines.length) pages.push(lines);

  const objects = [];
  const addObject = body => {
    objects.push(body);
    return objects.length;
  };

  const fontObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs = [];

  pages.forEach(pageLines => {
    const streamLines = pageLines.map(line => `BT /F1 ${line.size} Tf ${line.x} ${line.y.toFixed(2)} Td (${line.text}) Tj ET`);
    const stream = streamLines.join('\n');
    const contentObj = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObj = addObject(`<< /Type /Page /Parent PAGES_REF 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    pageRefs.push(pageObj);
  });

  const pagesObj = addObject(`<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`);
  const catalogObj = addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  const renderedObjects = objects.map(body => body.replace(/PAGES_REF/g, String(pagesObj)));
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  renderedObjects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${renderedObjects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${renderedObjects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function downloadFilteredProductsPdf() {
  const products = filteredProducts.length ? filteredProducts : [];
  const pdf = buildFilteredProductsPdf(products);
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `filtered-products-${stamp}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${products.length} filtered product${products.length !== 1 ? 's' : ''}`, 'success');
}

function buildOrderPdf() {
  const { items } = getOrderTotals();
  const orderName = getOrderName();
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const right = pageWidth - margin;
  const bottom = 42;
  const rowHeight = 20;
  const today = new Date().toLocaleDateString('en-IN');
  const pages = [];
  let ops = [];
  let y = pageHeight - margin;

  const addText = (text, x, textY, size = 10, font = 'F1') => {
    ops.push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${textY.toFixed(2)} Td (${pdfEscape(text)}) Tj ET`);
  };
  const addLineShape = (x1, y1, x2, y2, width = 0.7) => {
    ops.push(`${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };
  const addRect = (x, rectY, w, h, width = 0.7) => {
    ops.push(`${width} w ${x.toFixed(2)} ${rectY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
  };
  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = pageHeight - margin;
    drawHeader();
  };
  const ensureSpace = (neededHeight) => {
    if (y - neededHeight < bottom) newPage();
  };

  function drawHeader() {
    addText(orderName || 'Order Summary', margin, y, 13, 'F2');
    addText(`DATE : ${today}`, 292, y, 10);
    addText('Prepaid by : ____________', 410, y, 10);
    y -= 18;
    addLineShape(margin, y, right, y);
    y -= 24;
  };

  drawHeader();

  if (!items.length) {
    addText('Your order is empty.', margin, y, 12);
  } else {
    const groupedItems = groupCartItemsByType(items);
    Object.values(groupedItems).forEach(({ label: type, items: typeItems }) => {
      const bunchRows = getOrderPdfBunchRows(typeItems);
      const columns = 3;
      const bunchLabelWidth = 58;
      const headerHeight = 24;
      const bodyTopPadding = 10;
      const bodyBottomPadding = 8;
      const rowGap = 2;
      const rowHeights = bunchRows.map(row => Math.max(rowHeight + 8, Math.ceil(row.products.length / columns) * rowHeight + bodyTopPadding + bodyBottomPadding));
      const bodyHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.length - 1) * rowGap;
      const blockHeight = headerHeight + Math.max(rowHeight + 12, bodyHeight);
      ensureSpace(blockHeight + 18);

      const boxTop = y;
      const boxBottom = y - blockHeight;
      addRect(margin, boxBottom, right - margin, blockHeight);
      addText(type, margin + 10, boxTop - 16, 13, 'F2');
      addLineShape(margin, boxTop - headerHeight, right, boxTop - headerHeight);

      const productLeft = margin + bunchLabelWidth;
      const productColWidth = (right - productLeft - 18) / columns;
      let rowTop = boxTop - headerHeight;
      bunchRows.forEach((bunchRow, rowIndex) => {
        const currentRowHeight = rowHeights[rowIndex];
        const rowBottom = rowTop - currentRowHeight;
        addLineShape(productLeft, rowTop, productLeft, rowBottom);
        addText(bunchRow.label, margin + 12, rowTop - 18, 11, 'F2');
        bunchRow.products.forEach((line, index) => {
          const col = index % columns;
          const productRow = Math.floor(index / columns);
          addText(line, productLeft + 12 + col * productColWidth, rowTop - 18 - productRow * rowHeight, 11);
        });
        if (rowIndex < bunchRows.length - 1) addLineShape(margin, rowBottom, right, rowBottom);
        rowTop = rowBottom - rowGap;
      });
      y -= blockHeight + 16;
    });
  }

  const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
  if (items.length) {
    const footerY = Math.max(26, bottom - 20);
    addText(`TOTAL PRODUCTS : ${totalQty}`, right - 150, footerY, 10, 'F2');
  }
  if (ops.length) pages.push(ops);

  const objects = [];
  const addObject = body => {
    objects.push(body);
    return objects.length;
  };
  const fontObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const boldFontObj = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageRefs = [];

  pages.forEach(pageOps => {
    const stream = pageOps.join('\n');
    const contentObj = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageObj = addObject(`<< /Type /Page /Parent PAGES_REF 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObj} 0 R /F2 ${boldFontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`);
    pageRefs.push(pageObj);
  });

  const pagesObj = addObject(`<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`);
  const catalogObj = addObject(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  const renderedObjects = objects.map(body => body.replace(/PAGES_REF/g, String(pagesObj)));
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  renderedObjects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${renderedObjects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${renderedObjects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function downloadOrderPdf() {
  const pdf = buildOrderPdf();
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `order-summary-${stamp}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('Downloaded order summary', 'success');
}

confirmOrderBtn.addEventListener('click', completeActiveOrder);
downloadOrderPdfBtn.addEventListener('click', downloadOrderPdf);

// ── Share Order ────────────────────────────────────────────
function openShareOrderModal() {
  const { items, subtotal, discount, shipping, total } = getOrderTotals();
  if (items.length === 0) { showToast('Add items first', 'error'); return; }
  const orderName = getOrderName();
  const lines = [
    ...(orderName ? [`*${orderName}*`] : []),
    '🛒 *ORDER SUMMARY*',
    '─────────────────',
    ...items.map(i => `• ${i.Name} × ${i.qty} × ${fmtAv(getItemAv(i))} × ${fmt(getCategoryPrice(i))}  →  ${fmt(getItemTotal(i))}`),
    '─────────────────',
    `Subtotal: ${fmt(subtotal)}`,
    ...(discountPct > 0 ? [`Discount (${discountPct}%): -${fmt(discount)}`] : []),
    ...(shipping > 0 ? [`Shipping: ${fmt(shipping)}`] : []),
    `*TOTAL: ${fmt(total)}*`,
    '',
    `Generated by OrderCalc — ${new Date().toLocaleString('en-IN')}`,
  ];
  const text = lines.join('\n');
  shareModalBody.textContent = text;
  shareModalOverlay.classList.remove('hidden');

  copyOrderBtn.onclick = () => {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success')).catch(() => {});
  };
  whatsappOrderBtn.onclick = () => {
    window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
  };
}
shareOrderPageBtn.addEventListener('click', openShareOrderModal);
closeShareModal.addEventListener('click', () => shareModalOverlay.classList.add('hidden'));
shareModalOverlay.addEventListener('click', e => { if (e.target === shareModalOverlay) shareModalOverlay.classList.add('hidden'); });

// ── Search ─────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  clearSearchBtn.classList.toggle('hidden', !searchInput.value);
  filterAndRender();
});
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  clearSearchBtn.classList.add('hidden');
  filterAndRender();
});

// ── Load Sheet ─────────────────────────────────────────────
async function loadProductsFromUrl(url, options = {}) {
  const { useButtonLoader = false, silent = false } = options;
  if (!url) { showToast('Please enter a Google Sheets URL', 'error'); return; }

  if (useButtonLoader) {
    loadBtnText.classList.add('hidden');
    loadSpinner.classList.remove('hidden');
    loadBtn.disabled = true;
  }

  try {
    const products = await fetchFromSheet(url);
    if (products.length === 0) throw new Error('No products found. Check your sheet has data and correct column names.');
    sheetUrl = url;
    showApp(products);
    if (!silent) showToast(`Loaded ${products.length} products`, 'success');
  } finally {
    if (useButtonLoader) {
      loadBtnText.classList.remove('hidden');
      loadSpinner.classList.add('hidden');
      loadBtn.disabled = false;
    }
  }
}

loadBtn.addEventListener('click', async () => {
  const url = sheetUrlInput.value.trim();
  if (!url) { showToast('Please enter a Google Sheets URL', 'error'); return; }
  loadBtnText.classList.add('hidden');
  loadSpinner.classList.remove('hidden');
  loadBtn.disabled = true;
  try {
    await loadProductsFromUrl(url, { silent: false });
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    loadBtnText.classList.remove('hidden');
    loadSpinner.classList.add('hidden');
    loadBtn.disabled = false;
  }
});

useSampleBtn.addEventListener('click', () => {
  sheetUrl = 'sample';
  showApp(SAMPLE_PRODUCTS);
  showToast('Sample data loaded', 'success');
});

// ── Back & Refresh ─────────────────────────────────────────
backBtn.addEventListener('click', showSetup);

refreshBtn.addEventListener('click', async () => {
  if (sheetUrl === 'sample') { showToast('Using sample data', 'info'); return; }
  refreshBtn.classList.add('spin-anim');
  try {
    const products = await fetchFromSheet(sheetUrl);
    allProducts = products;
    productCountBadge.textContent = `${products.length} product${products.length !== 1 ? 's' : ''}`;
    buildCategories();
    filterAndRender();
    showToast('Products refreshed', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setTimeout(() => refreshBtn.classList.remove('spin-anim'), 600);
  }
});

// ── Init ───────────────────────────────────────────────────
sheetUrlInput.value = DEFAULT_SHEET_URL;
updateCartUI();

(async function initDefaultSheet() {
  showAppLoading();
  try {
    await loadProductsFromUrl(DEFAULT_SHEET_URL, { silent: true });
  } catch (err) {
    showSetup();
    showToast(err.message, 'error');
  }
})();
