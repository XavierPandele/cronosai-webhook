const twilio = require('twilio');
const logger = require('./logging');

let cachedClient = null;

function getClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID || process.env.AccountSid;
  const authToken = process.env.TWILIO_AUTH_TOKEN || process.env.AuthToken;

  if (!accountSid || !authToken) {
    logger.warn('RCS_SEND_SKIPPED_MISSING_TWILIO_CREDS');
    return null;
  }

  cachedClient = twilio(accountSid, authToken);
  return cachedClient;
}

function formatDateForLanguage(dateStr, language = 'es') {
  if (!dateStr) {
    return '';
  }

  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return dateStr;
    }

    return new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(date);
  } catch (error) {
    logger.warn('RCS_DATE_FORMAT_ERROR', { error: error.message, dateStr });
    return dateStr;
  }
}

function buildConfirmationMessage(data, language = 'es') {
  const {
    name,
    date,
    time,
    people
  } = data;

  const friendlyDate = formatDateForLanguage(date, language);
  const safeName = name || 'cliente';
  const safeTime = time || 'por confirmar';
  const safePeople = typeof people === 'number' ? people : parseInt(people || '0', 10) || 1;

  if (language === 'en') {
    return [
      `Hi ${safeName}!`,
      'Your reservation is confirmed:',
      `• Date: ${friendlyDate || date || 'Pending'}`,
      `• Time: ${safeTime}`,
      `• Guests: ${safePeople}`,
      '',
      'We look forward to seeing you soon!'
    ].join('\n');
  }

  return [
    `¡Hola ${safeName}!`,
    'Tu reserva está confirmada:',
    `• Fecha: ${friendlyDate || date || 'Por confirmar'}`,
    `• Hora: ${safeTime}`,
    `• Personas: ${safePeople}`,
    '',
    '¡Te esperamos pronto!'
  ].join('\n');
}

function formatOrderLines(items = [], language = 'es') {
  if (!items.length) {
    return language === 'en'
      ? '• Items: not available'
      : '• Productos: no disponibles';
  }

  return items.map(item => {
    const quantity = item.cantidad || item.quantity || 1;
    const name = item.nombre || item.producto || item.nombre_menu || 'producto';
    const price = typeof item.precio === 'number' ? item.precio : parseFloat(item.precio || '0');
    const subtotal = typeof item.subtotal === 'number' ? item.subtotal : parseFloat(item.subtotal || (price * quantity));
    const priceStr = Number.isFinite(subtotal) ? subtotal.toFixed(2) : '';

    return language === 'en'
      ? `• ${quantity} x ${name}${priceStr ? ` (${priceStr}€)` : ''}`
      : `• ${quantity} × ${name}${priceStr ? ` (${priceStr}€)` : ''}`;
  }).join('\n');
}

function buildOrderConfirmationMessage(data, language = 'es') {
  const {
    name,
    total,
    items = [],
    address
  } = data;

  const safeName = name || (language === 'en' ? 'customer' : 'cliente');
  const safeTotal = typeof total === 'number' ? total.toFixed(2) : parseFloat(total || '0').toFixed(2);
  const orderLines = formatOrderLines(items, language);

  if (language === 'en') {
    return [
      `Hi ${safeName}!`,
      'We confirm your delivery order:',
      orderLines,
      `• Total: ${safeTotal}€`,
      address ? `• Delivery address: ${address}` : '',
      '',
      'We are preparing everything. See you soon!'
    ].filter(Boolean).join('\n');
  }

  return [
    `¡Hola ${safeName}!`,
    'Confirmamos tu pedido a domicilio:',
    orderLines,
    `• Total: ${safeTotal}€`,
    address ? `• Dirección de entrega: ${address}` : '',
    '',
    'Estamos preparando todo. ¡Nos vemos pronto!'
  ].filter(Boolean).join('\n');
}

async function sendReservationConfirmationRcs(params = {}, contextLogger = null) {
  const messagingServiceSid = process.env.TWILIO_RCS_MESSAGING_SERVICE_SID || process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!messagingServiceSid) {
    logger.warn('RCS_SEND_SKIPPED_NO_SERVICE');
    return;
  }

  const client = getClient();
  if (!client) {
    return;
  }

  const {
    phone,
    name,
    date,
    time,
    people,
    language = 'es'
  } = params;

  if (!phone) {
    logger.warn('RCS_SEND_SKIPPED_NO_PHONE', { params });
    return;
  }

  const message = buildConfirmationMessage({ name, date, time, people }, language);

  const log = contextLogger || logger.withContext({ phone, language });

  try {
    log.info('RCS_SENDING_CONFIRMATION', { phone });

    await client.messages.create({
      to: phone,
      messagingServiceSid,
      body: message
    });

    log.info('RCS_CONFIRMATION_SENT', { phone });
  } catch (error) {
    log.error('RCS_SEND_FAILED', {
      phone,
      error: error.message
    });
  }
}

async function sendOrderConfirmationRcs(params = {}, contextLogger = null) {
  const messagingServiceSid = process.env.TWILIO_RCS_MESSAGING_SERVICE_SID || process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!messagingServiceSid) {
    logger.warn('RCS_ORDER_SEND_SKIPPED_NO_SERVICE');
    return;
  }

  const client = getClient();
  if (!client) {
    return;
  }

  const {
    phone,
    name,
    total,
    items,
    address,
    language = 'es'
  } = params;

  if (!phone) {
    logger.warn('RCS_ORDER_SEND_SKIPPED_NO_PHONE', { params });
    return;
  }

  const message = buildOrderConfirmationMessage({ name, total, items, address }, language);
  const log = contextLogger || logger.withContext({ phone, language });

  try {
    log.info('RCS_ORDER_SENDING_CONFIRMATION', { phone });

    await client.messages.create({
      to: phone,
      messagingServiceSid,
      body: message
    });

    log.info('RCS_ORDER_CONFIRMATION_SENT', { phone });
  } catch (error) {
    log.error('RCS_ORDER_SEND_FAILED', {
      phone,
      error: error.message
    });
  }
}

module.exports = {
  sendReservationConfirmationRcs,
  sendOrderConfirmationRcs
};

