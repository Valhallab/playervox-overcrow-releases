const MAX_ORDERS_PER_SIDE = 5;
const MAX_PLATINUM = 900_000;

export function parseOrders(payload) {
  const data = payload?.data;
  if (!data || !Array.isArray(data.sell) || !Array.isArray(data.buy)
      || data.sell.length > 256 || data.buy.length > 256) {
    throw new Error('invalid orders');
  }
  const sell = parseSide(data.sell, 'sell');
  const buy = parseSide(data.buy, 'buy');
  return [...sell, ...buy];
}

export function whisperLine(order, item) {
  const intent = order.side === 'sell' ? 'WTB' : 'WTS';
  const quantity = order.perTrade > 1 ? `${order.perTrade} x ` : '';
  const variant = variantLabel(order);
  return `/w ${order.trader} Hi, ${intent} ${quantity}${item}${variant ? ` (${variant})` : ''} for ${order.platinum}p${order.perTrade > 1 ? ' total' : ''}`;
}

export function variantLabel(order) {
  const parts = [];
  if (order.rank != null) parts.push(`Rank ${order.rank}`);
  if (order.charges != null) parts.push(`${order.charges} charges`);
  if (order.amberStars != null || order.cyanStars != null) {
    parts.push(`${order.amberStars ?? 0} amber / ${order.cyanStars ?? 0} cyan stars`);
  }
  if (order.subtype) parts.push(order.subtype.replaceAll('_', ' '));
  return parts.join(', ');
}

function parseSide(rows, side) {
  if (!Array.isArray(rows)) {
    return [];
  }
  const accepted = [];
  for (const row of rows) {
    const order = parseOrder(row, side);
    if (!order) {
      continue;
    }
    accepted.push(order);
    if (accepted.length === MAX_ORDERS_PER_SIDE) {
      break;
    }
  }
  return accepted;
}

function parseOrder(row, expectedSide) {
  if (!row || typeof row !== 'object' || row.visible !== true) {
    return null;
  }
  if (row.type !== expectedSide) {
    return null;
  }
  const user = row.user;
  if (!user || user.platform !== 'pc') {
    return null;
  }
  const id = typeof row.id === 'string' ? row.id : '';
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(id)) {
    return null;
  }
  const platinum = row.platinum;
  if (!Number.isInteger(platinum) || platinum < 1 || platinum > MAX_PLATINUM) {
    return null;
  }
  const trader = sanitizeTrader(user.ingameName);
  if (!trader) {
    return null;
  }
  const perTrade = row.perTrade ?? 1;
  if (!Number.isInteger(perTrade) || perTrade < 1 || perTrade > 6) return null;
  const variant = {};
  for (const key of ['rank', 'charges', 'amberStars', 'cyanStars']) {
    if (row[key] == null) continue;
    if (!Number.isInteger(row[key]) || row[key] < 0 || row[key] > 100) return null;
    variant[key] = row[key];
  }
  if (row.subtype != null) {
    if (typeof row.subtype !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(row.subtype)) return null;
    variant.subtype = row.subtype;
  }
  return {
    id,
    side: expectedSide,
    platinum,
    trader,
    presence: presence(user.status),
    perTrade,
    ...variant,
  };
}

function sanitizeTrader(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const output = [...value]
    .filter((character) => character >= ' ' && character !== '/' && character !== '\\')
    .slice(0, 32)
    .join('')
    .trim();
  return output || null;
}

function presence(status) {
  if (status === 'ingame' || status === 'online' || status === 'offline') {
    return status;
  }
  return 'unknown';
}
