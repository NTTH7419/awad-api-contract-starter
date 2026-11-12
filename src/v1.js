// The /v1 API. CONTRACT.md is the complete public specification.
import { readRaw, send } from './http.js';

const PROBLEM_BASE = 'https://menu.example/problems/';
const PROBLEMS = {
  'invalid-json': [400, 'Malformed JSON'],
  validation: [400, 'Invalid request'],
  'idempotency-key-missing': [400, 'Idempotency-Key required'],
  'not-found': [404, 'Not found'],
  'idempotency-key-in-flight': [409, 'Request in progress'],
  'unknown-menu-item': [422, 'Unknown menu item'],
  'idempotency-key-reused': [422, 'Idempotency-Key reused'],
  internal: [500, 'Internal error'],
};

function problem(res, slug, detail, errors) {
  const [status, title] = PROBLEMS[slug];
  const body = { type: `${PROBLEM_BASE}${slug}`, title, status, detail };
  if (errors) body.errors = errors;
  send(res, status, body, { 'content-type': 'application/problem+json' });
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isIntegerIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

// Canonical JSON gives semantically equal bodies the same idempotency
// fingerprint without treating an array as an unordered collection.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parsePathId(value) {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function encodeCursor(lastId, tableId) {
  return Buffer.from(JSON.stringify({ id: lastId, tableId }), 'utf8').toString('base64url');
}

function decodeCursor(cursor, tableId) {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) return null;
    const parsed = JSON.parse(decoded);
    if (!isObject(parsed) || !isPositiveInteger(parsed.id)) return null;
    if (parsed.tableId !== tableId) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

function orderView(q, id) {
  const order = q.getOrder.get(id);
  if (!order) return undefined;
  return {
    id: order.id,
    tableId: order.table_id,
    items: q.getOrderItems.all(id).map((item) => ({
      menuItemId: item.menu_item_id,
      qty: item.qty,
      unitPriceVnd: item.unit_price_vnd,
    })),
    totalVnd: order.total_vnd,
    createdAt: order.created_at,
  };
}

function validateOrder(body) {
  if (!isObject(body)) return [{ pointer: '', detail: 'must be an object' }];

  const errors = [];
  if (!isIntegerIn(body.tableId, 1, 200)) {
    errors.push({ pointer: '/tableId', detail: 'must be an integer from 1 to 200' });
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    errors.push({ pointer: '/items', detail: 'must be an array with 1 to 20 items' });
    return errors;
  }
  body.items.forEach((item, index) => {
    if (!isObject(item) || !isPositiveInteger(item.menuItemId)) {
      errors.push({ pointer: `/items/${index}/menuItemId`, detail: 'must be a positive integer' });
    }
    if (!isObject(item) || !isIntegerIn(item.qty, 1, 20)) {
      errors.push({ pointer: `/items/${index}/qty`, detail: 'must be an integer from 1 to 20' });
    }
  });
  return errors;
}

export function createV1(db) {
  const q = {
    getMenu: db.prepare('SELECT id, name, price_vnd FROM menu_items WHERE id = ?'),
    getOrder: db.prepare('SELECT id, table_id, total_vnd, created_at FROM orders WHERE id = ?'),
    getOrderItems: db.prepare('SELECT menu_item_id, qty, unit_price_vnd FROM order_items WHERE order_id = ? ORDER BY line'),
    getMenuPrice: db.prepare('SELECT id, price_vnd FROM menu_items WHERE id = ?'),
    insertOrder: db.prepare('INSERT INTO orders (table_id, total_vnd, created_at) VALUES (?, ?, ?)'),
    insertOrderItem: db.prepare('INSERT INTO order_items (order_id, line, menu_item_id, qty, unit_price_vnd) VALUES (?, ?, ?, ?, ?)'),
    getIdempotency: db.prepare('SELECT fingerprint, response_body, location FROM idempotency_keys WHERE key = ?'),
    insertIdempotency: db.prepare('INSERT INTO idempotency_keys (key, fingerprint, response_body, location, created_at) VALUES (?, ?, ?, ?, ?)'),
    listOrders: db.prepare('SELECT id FROM orders WHERE id < ? ORDER BY id DESC LIMIT ?'),
    listOrdersForTable: db.prepare('SELECT id FROM orders WHERE table_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
  };
  const inFlight = new Set();

  function menu(id) {
    const row = q.getMenu.get(id);
    return row && { id: row.id, name: row.name, priceVnd: row.price_vnd };
  }

  function listOrders(url, res) {
    const tableRaw = url.searchParams.get('tableId');
    const limitRaw = url.searchParams.get('limit');
    const cursorRaw = url.searchParams.get('cursor');
    const errors = [];
    let tableId = null;
    let limit = 20;
    if (tableRaw !== null) {
      const parsed = Number(tableRaw);
      if (!/^[1-9]\d*$/.test(tableRaw) || !isIntegerIn(parsed, 1, 200)) errors.push({ parameter: 'tableId', detail: 'must be an integer from 1 to 200' });
      else tableId = parsed;
    }
    if (limitRaw !== null) {
      const parsed = Number(limitRaw);
      if (!/^[1-9]\d*$/.test(limitRaw) || !isIntegerIn(parsed, 1, 100)) errors.push({ parameter: 'limit', detail: 'must be an integer from 1 to 100' });
      else limit = parsed;
    }
    let beforeId = Number.MAX_SAFE_INTEGER;
    if (cursorRaw !== null) {
      const parsed = decodeCursor(cursorRaw, tableId);
      if (parsed === null) errors.push({ parameter: 'cursor', detail: 'must be a cursor returned by this endpoint' });
      else beforeId = parsed;
    }
    if (errors.length) return problem(res, 'validation', `${errors.length} query parameter${errors.length === 1 ? ' is' : 's are'} invalid`, errors);

    const rows = tableId === null
      ? q.listOrders.all(beforeId, limit + 1)
      : q.listOrdersForTable.all(tableId, beforeId, limit + 1);
    const page = rows.slice(0, limit);
    const items = page.map((row) => orderView(q, row.id));
    const nextCursor = rows.length > limit ? encodeCursor(page.at(-1).id, tableId) : null;
    send(res, 200, { items, nextCursor });
  }

  async function createOrder(req, res) {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 1 || key.length > 255) {
      return problem(res, 'idempotency-key-missing', 'An Idempotency-Key header with 1 to 255 characters is required.');
    }

    let body;
    try {
      body = JSON.parse(await readRaw(req));
    } catch {
      return problem(res, 'invalid-json', 'The request body is not valid JSON.');
    }
    const fingerprint = canonicalJson(body);
    const existing = q.getIdempotency.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return problem(res, 'idempotency-key-reused', 'This Idempotency-Key was already used with a different request body.');
      return send(res, 201, JSON.parse(existing.response_body), {
        Location: existing.location,
        'Idempotent-Replayed': 'true',
      });
    }
    if (inFlight.has(key)) return problem(res, 'idempotency-key-in-flight', 'A request with this Idempotency-Key is still being processed.');

    inFlight.add(key);
    try {
      const errors = validateOrder(body);
      if (errors.length) return problem(res, 'validation', `${errors.length} field${errors.length === 1 ? ' is' : 's are'} invalid`, errors);

      const pricedItems = [];
      const unknown = [];
      body.items.forEach((item, index) => {
        const menuItem = q.getMenuPrice.get(item.menuItemId);
        if (!menuItem) unknown.push({ pointer: `/items/${index}/menuItemId`, detail: 'does not name an existing menu item' });
        else pricedItems.push({ menuItemId: menuItem.id, qty: item.qty, unitPriceVnd: menuItem.price_vnd });
      });
      if (unknown.length) return problem(res, 'unknown-menu-item', `${unknown.length} menu item${unknown.length === 1 ? ' does' : 's do'} not exist`, unknown);

      const totalVnd = pricedItems.reduce((total, item) => total + item.qty * item.unitPriceVnd, 0);
      const createdAt = new Date().toISOString();
      let created;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = q.insertOrder.run(body.tableId, totalVnd, createdAt);
        const orderId = Number(result.lastInsertRowid);
        pricedItems.forEach((item, line) => q.insertOrderItem.run(orderId, line, item.menuItemId, item.qty, item.unitPriceVnd));
        created = { id: orderId, tableId: body.tableId, items: pricedItems, totalVnd, createdAt };
        const location = `/v1/orders/${orderId}`;
        q.insertIdempotency.run(key, fingerprint, JSON.stringify(created), location, createdAt);
        db.exec('COMMIT');
        return send(res, 201, created, { Location: location });
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* no transaction was opened */ }
        throw error;
      }
    } finally {
      inFlight.delete(key);
    }
  }

  return async function handleV1(req, res, url) {
    try {
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && parts.length === 3 && parts[1] === 'menu') {
        const id = parsePathId(parts[2]);
        const item = id === null ? undefined : menu(id);
        if (!item) problem(res, 'not-found', 'No menu item exists with that id.');
        else send(res, 200, item);
        return true;
      }
      if (parts.length === 2 && parts[1] === 'orders') {
        if (req.method === 'POST') await createOrder(req, res);
        else if (req.method === 'GET') listOrders(url, res);
        else problem(res, 'not-found', 'No resource exists at this path.');
        return true;
      }
      if (req.method === 'GET' && parts.length === 3 && parts[1] === 'orders') {
        const id = parsePathId(parts[2]);
        const order = id === null ? undefined : orderView(q, id);
        if (!order) problem(res, 'not-found', 'No order exists with that id.');
        else send(res, 200, order);
        return true;
      }
      problem(res, 'not-found', 'No resource exists at this path.');
      return true;
    } catch {
      if (!res.headersSent) problem(res, 'internal', 'An unexpected error occurred.');
      return true;
    }
  };
}
