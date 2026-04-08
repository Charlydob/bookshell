const OCR_LOG_PREFIX = '[finance][ticket-ocr]';

const VENDOR_PATTERNS = [
  { key: 'mercadona', label: 'Mercadona', patterns: [/mercadona/i, /mercadona\s*,?\s*s\.?a\.?/i], cif: [/a\s*46103834/i] },
  { key: 'eroski_city', label: 'Eroski City', patterns: [/eroski\s*city/i, /eroski/i], cif: [] },
  { key: 'charter', label: 'Charter', patterns: [/supermercados\s*charter/i, /\bcharter\b/i], cif: [] },
];

const PAYMENT_PATTERNS = {
  card: [/tarjeta\s+bancaria/i, /\bvisa\b/i, /master\s*card/i, /debit\s*mastercard/i, /tarj\.?\s*cr[eé]dito/i],
  cash: [/\befectivo\b/i, /\bcash\b/i, /\bcambio\b/i],
};

const ITEM_STOP_PATTERNS = [
  /\b(total|total\s+a\s+pagar|importe\s+a\s+abonar|importe:|base\s+imponible|iva|cambio|pago|tarjeta|efectivo|aut\.|aid\b|arc\b|n\.c\.|qr\s+tributario|establecimiento|gracias)\b/i,
];

export function parseSpanishMoney(value = '') {
  const cleaned = String(value || '').replace(/€/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTicketDate(value = '') {
  const m = String(value || '').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!day || !month || !year || month > 12 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function normalizeVendor(text = '') {
  const hay = String(text || '');
  for (const vendor of VENDOR_PATTERNS) {
    let score = 0;
    if (vendor.patterns.some((pattern) => pattern.test(hay))) score += 0.7;
    if (vendor.cif.some((pattern) => pattern.test(hay))) score += 0.2;
    if (score > 0) return { vendor: vendor.label, confidence: Math.min(0.99, score) };
  }
  return { vendor: 'unknown', confidence: 0.1 };
}

export function normalizeItemName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferUnit(text = '') {
  const v = normalizeItemName(text);
  if (/\bkg\b/.test(v)) return 'kg';
  if (/\bg\b/.test(v)) return 'g';
  if (/\bml\b/.test(v)) return 'ml';
  if (/\bl\b/.test(v)) return 'l';
  if (/\bpack\b/.test(v)) return 'pack';
  if (/\b\d+\s*u\b|\bud\b/.test(v)) return 'ud';
  return 'unknown';
}

export function inferCategory(text = '') {
  const v = normalizeItemName(text);
  const rules = [
    ['lacteos', /leche|queso|yogur|kefir|mantequilla/],
    ['bebidas', /agua|zumo|refresco|rockstar|cerveza|vino/],
    ['snacks', /donut|galleta|chocolate|cacahuete|patata/],
    ['fruta', /aguacate|freson|platano|manzana|pera|naranja|fruta|boniato|batata/],
    ['verdura', /lechuga|tomate|cebolla|zanahoria|brocoli|espinaca|verdura/],
    ['carne', /pollo|pechuga|ternera|cerdo|pavo/],
    ['panaderia', /pan|barra|croissant|bolleria/],
    ['congelados', /congelad|helado|pizza/],
    ['higiene', /champu|gel|jabon|higienico|desodorante/],
    ['limpieza', /detergente|lejia|lavavajillas|fregasuelos/],
    ['despensa', /arroz|pasta|sal|azucar|aceite|legumbre|avena|tortita/],
  ];
  const found = rules.find(([, pattern]) => pattern.test(v));
  return found ? found[0] : 'otros';
}

export function inferPaymentMethod(text = '') {
  if (PAYMENT_PATTERNS.card.some((p) => p.test(text))) return 'card';
  if (PAYMENT_PATTERNS.cash.some((p) => p.test(text))) return 'cash';
  return 'unknown';
}

export function extractCardLast4(text = '') {
  const patterns = [
    /\*{2,}\s*\*{2,}\s*\*{2,}\s*(\d{4})/i,
    /n\.?\s*tarj\s*:?\s*\*+(\d{4})/i,
    /(\d{4})\s*$/m,
  ];
  for (const pattern of patterns) {
    const m = String(text || '').match(pattern);
    if (m?.[1]) return m[1];
  }
  return '';
}

export function mergeMultilineItemRows(lines = []) {
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '').trim();
    if (!line) continue;
    const next = String(lines[index + 1] || '').trim();
    if (/\d+[\.,]\d+\s*kg/i.test(next) || /\/[k]?g/i.test(next) || /eu\/kg/i.test(next)) {
      out.push(`${line} ${next}`);
      index += 1;
      continue;
    }
    out.push(line);
  }
  return out;
}

function pickPurchaseDateTime(text = '') {
  const m = String(text).match(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\s+(\d{1,2}:\d{2})/);
  return {
    date: normalizeTicketDate(m?.[1] || ''),
    time: m?.[2] || '',
  };
}

function pickTotal(text = '') {
  const patterns = [
    /total\s*(?:\(€\))?\s*([\d.,]+)/i,
    /total\s+a\s+pagar\s*([\d.,]+)/i,
    /importe\s+a\s+abonar\s*([\d.,]+)/i,
    /importe:\s*([\d.,]+)\s*€/i,
  ];
  for (const p of patterns) {
    const m = String(text).match(p);
    if (m?.[1]) {
      const parsed = parseSpanishMoney(m[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function shouldSkipItemLine(line = '') {
  return ITEM_STOP_PATTERNS.some((pattern) => pattern.test(line));
}

function parseItemLine(line = '') {
  const row = String(line || '').trim();
  if (!row || shouldSkipItemLine(row)) return null;

  const weightMatch = row.match(/([\d.,]+)\s*kg\s+([\d.,]+)\s*(?:€|eu)?\/?kg\s+([\d.,]+)$/i);
  if (weightMatch) {
    const qty = parseSpanishMoney(weightMatch[1]) || 1;
    const unitPrice = parseSpanishMoney(weightMatch[2]);
    const totalPrice = parseSpanishMoney(weightMatch[3]) || 0;
    const nameRaw = row.replace(weightMatch[0], '').trim();
    return buildItem(nameRaw, { qty, unit: 'kg', unitPrice, totalPrice, tags: ['granel', 'peso_variable'] });
  }

  let m = row.match(/^(\d+)\s+(.+?)\s+([\d.,]+)\s+([\d.,]+)$/);
  if (m) {
    return buildItem(m[2], {
      qty: Number(m[1]) || 1,
      unitPrice: parseSpanishMoney(m[3]),
      totalPrice: parseSpanishMoney(m[4]) || 0,
    });
  }

  m = row.match(/^(\d+)\s+(.+?)\s+([\d.,]+)$/);
  if (m) {
    const qty = Number(m[1]) || 1;
    const totalPrice = parseSpanishMoney(m[3]) || 0;
    return buildItem(m[2], { qty, totalPrice, unitPrice: qty > 0 ? Number((totalPrice / qty).toFixed(2)) : null });
  }

  m = row.match(/^(.+?)\s+([\d.,]+)$/);
  if (m) {
    return buildItem(m[1], { qty: 1, totalPrice: parseSpanishMoney(m[2]) || 0 });
  }

  return null;
}

function buildItem(nameRaw = '', { qty = 1, unit = '', unitPrice = null, totalPrice = 0, tags = [] } = {}) {
  const cleanRaw = String(nameRaw || '').replace(/\s+/g, ' ').trim();
  const unitResolved = unit || inferUnit(cleanRaw) || 'unknown';
  const norm = normalizeItemName(cleanRaw);
  const resolvedTags = [...new Set([
    ...tags,
    /sin\s*lact/i.test(cleanRaw) ? 'sin_lactosa' : '',
    /protein/i.test(cleanRaw) ? 'protein' : '',
  ].filter(Boolean))];
  return {
    name_raw: cleanRaw,
    name_norm: norm,
    brand: null,
    qty: Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : 1,
    unit: ['ud', 'kg', 'g', 'l', 'ml', 'pack', 'unknown'].includes(unitResolved) ? unitResolved : 'unknown',
    unit_price: Number.isFinite(Number(unitPrice)) ? Number(unitPrice) : null,
    total_price: Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : 0,
    category_guess: inferCategory(cleanRaw),
    tags: resolvedTags,
  };
}

function parseItemsFromText(text = '') {
  const rawLines = String(text || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const merged = mergeMultilineItemRows(rawLines);
  const items = [];
  for (const row of merged) {
    const parsed = parseItemLine(row);
    if (parsed && parsed.name_raw && parsed.total_price >= 0) items.push(parsed);
  }
  return items.filter((item) => item.name_raw.length > 1);
}

export function parseMercadonaTicket(text = '', meta = {}) {
  const source = normalizeVendor(text);
  const purchaseDt = pickPurchaseDateTime(text);
  const items = parseItemsFromText(text);
  return {
    schema: 'TICKET_V1',
    currency: 'EUR',
    locale: 'es-ES',
    source,
    purchase: {
      date: purchaseDt.date || '',
      time: purchaseDt.time || '',
      total: pickTotal(text),
      payment_method: inferPaymentMethod(text),
      card_last4: extractCardLast4(text),
    },
    items,
    notes: meta?.notes || '',
  };
}

export function parseEroskiTicket(text = '', meta = {}) {
  return parseMercadonaTicket(text, meta);
}

export function parseCharterTicket(text = '', meta = {}) {
  return parseMercadonaTicket(text, meta);
}

export function parseGenericSpanishReceipt(text = '', meta = {}) {
  return parseMercadonaTicket(text, meta);
}

export function parseTicketToTICKET_V1(text = '', ocrMeta = {}) {
  const vendor = normalizeVendor(text);
  const byVendor = {
    Mercadona: parseMercadonaTicket,
    'Eroski City': parseEroskiTicket,
    Charter: parseCharterTicket,
  };
  const parser = byVendor[vendor.vendor] || parseGenericSpanishReceipt;
  const parsed = parser(text, ocrMeta);
  parsed.source = { ...parsed.source, vendor: vendor.vendor, confidence: vendor.confidence };
  if (!parsed.purchase.total && parsed.items.length) {
    parsed.purchase.total = Number(parsed.items.reduce((sum, item) => sum + Number(item.total_price || 0), 0).toFixed(2));
  }
  return parsed;
}

function imageBitmapToCanvas(bitmap) {
  const canvas = document.createElement('canvas');
  const targetWidth = Math.min(1800, bitmap.width);
  const scale = targetWidth / bitmap.width;
  canvas.width = targetWidth;
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function applyImageVariant(sourceCanvas, variant = 'base') {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (variant === 'contrast') ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.08)';
  else if (variant === 'bw') ctx.filter = 'grayscale(1) contrast(2)';
  else ctx.filter = 'contrast(1.15)';
  ctx.drawImage(sourceCanvas, 0, 0);
  if (variant === 'bw') {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const v = avg > 150 ? 255 : Math.max(0, avg - 20);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas;
}

let tesseractModPromise = null;
async function loadTesseract() {
  if (!tesseractModPromise) {
    console.log(`${OCR_LOG_PREFIX} loading OCR engine (lazy)`);
    tesseractModPromise = import('https://esm.sh/tesseract.js@5.1.1');
  }
  return tesseractModPromise;
}

export async function runTicketOcrPipeline(file, options = {}) {
  const onStage = typeof options.onStage === 'function' ? options.onStage : () => {};
  if (!file) throw new Error('No hay imagen');

  onStage('preprocessing');
  const bitmap = await createImageBitmap(file);
  const baseCanvas = imageBitmapToCanvas(bitmap);
  const variants = [
    applyImageVariant(baseCanvas, 'base'),
    applyImageVariant(baseCanvas, 'contrast'),
    applyImageVariant(baseCanvas, 'bw'),
  ];

  onStage('ocr-running');
  const { createWorker } = await loadTesseract();
  const worker = await createWorker('spa');

  let best = { text: '', confidence: -1 };
  for (let index = 0; index < variants.length; index += 1) {
    const v = variants[index];
    // eslint-disable-next-line no-await-in-loop
    const result = await worker.recognize(v);
    const confidence = Number(result?.data?.confidence || 0);
    const text = String(result?.data?.text || '');
    if (confidence > best.confidence && text.trim().length > 10) best = { text, confidence };
  }
  await worker.terminate();

  onStage('parsing');
  const ticket = parseTicketToTICKET_V1(best.text, { ocrConfidence: best.confidence });
  return {
    ticket,
    rawText: best.text,
    ocrConfidence: best.confidence,
    variantsTried: variants.length,
  };
}
