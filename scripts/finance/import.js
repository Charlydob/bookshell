export function parseImportRaw(value = '') {
  return String(value || '').trim();
}

export const TICKET_IMPORT_SAMPLE_V1 = `{
  "schema": "TICKET_V1",
  "source": {
    "vendor": "Mercadona",
    "currency": "EUR"
  },
  "purchase": {
    "date": "2026-02-15",
    "total": 34.65,
    "payment_method": "credit_card",
    "card_last4": "1234"
  },
  "items": [
    {
      "name_raw": "YOGURT HIGIÉNICO",
      "name_norm": "yogurt higiénico",
      "qty": 2,
      "unit_price": null,
      "total_price": 3.55,
      "category_guess": "lacteos"
    },
    {
      "name_raw": "MERMELADA FRESÓN",
      "name_norm": "mermelada fresón",
      "qty": 1,
      "unit_price": 2.1,
      "total_price": 2.1,
      "category_guess": "despensa"
    },
    {
      "name_raw": "Arroz",
      "name_norm": "arroz",
      "qty": 4,
      "unit_price": 7.25,
      "total_price": 29,
      "category_guess": "despensa"
    }
  ]
}`;

export function sanitizeImportText(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\uFEFF\u200B]/g, '')
    .replace(/\u00A0/g, ' ');
}

export function toNumberEUR(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildJsonParseDiagnostic(error, text = '') {
  const message = error?.message || 'Error desconocido';
  const match = /position\s+(\d+)/i.exec(message);
  const pos = match ? Number(match[1]) : -1;
  if (!Number.isFinite(pos) || pos < 0) {
    return `JSON inválido: ${message}`;
  }
  const upto = text.slice(0, pos);
  const line = upto.split('\n').length;
  const col = upto.length - upto.lastIndexOf('\n');
  const snippetStart = Math.max(0, pos - 40);
  const snippetEnd = Math.min(text.length, pos + 40);
  const snippet = text.slice(snippetStart, snippetEnd).replace(/\n/g, '↵');
  const codesStart = Math.max(0, pos - 10);
  const codesEnd = Math.min(text.length, pos + 10);
  const charCodes = Array.from(text.slice(codesStart, codesEnd)).map((char) => char.charCodeAt(0)).join(', ');
  return `JSON inválido (línea ${line}, col ${col}): ${message}. Cerca de aquí: ${snippet}. CharCodes: [${charCodes}]`;
}

export function normalizeProductName(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VALID_TICKET_CATEGORIES = new Set([
  'lacteos', 'carne', 'pescado', 'fruta', 'verdura', 'panaderia',
  'bebidas', 'snacks', 'hogar', 'higiene', 'congelados', 'despensa',
  'mascotas', 'otros'
]);

export function mapTicketCategoryToApp(catGuess = '') {
  const normalized = normalizeProductName(catGuess).replace(/\s+/g, '');
  return VALID_TICKET_CATEGORIES.has(normalized) ? normalized : 'otros';
}

export function inferCategoryFromName(name = '') {
  const safe = normalizeProductName(name);
  if (!safe) return null;
  const keywordMap = [
    { category: 'hogar', pattern: /\b(papel|detergente|suavizante|lavavajillas|lejia|bolsa basura|fregasuelos|limpiador)\b/ },
    { category: 'higiene', pattern: /\b(gel|champu|desodorante|jabon manos|pasta dental|cepillo dental|higienico)\b/ },
    { category: 'lacteos', pattern: /\b(leche|queso|yogur|yogurt|kefir|mantequilla)\b/ },
    { category: 'carne', pattern: /\b(pollo|ternera|cerdo|hamburguesa|carne picada|pavo)\b/ },
    { category: 'pescado', pattern: /\b(atun|salmon|merluza|bacalao|pescado|gamba)\b/ },
    { category: 'fruta', pattern: /\b(manzana|platano|banana|pera|naranja|fruta|fresa|uvas?)\b/ },
    { category: 'verdura', pattern: /\b(lechuga|tomate|cebolla|zanahoria|pepino|brocoli|espinaca|verdura)\b/ },
    { category: 'panaderia', pattern: /\b(pan|barra|croissant|bolleria|magdalena|tostada)\b/ },
    { category: 'bebidas', pattern: /\b(agua|zumo|jugo|refresco|cola|cerveza|vino|bebida)\b/ },
    { category: 'snacks', pattern: /\b(patatas|snack|galletas?|chocolate|frutos secos)\b/ },
    { category: 'congelados', pattern: /\b(congelado|helado)\b/ },
    { category: 'despensa', pattern: /\b(arroz|pasta|legumbre|harina|aceite|sal|azucar|mermelada|conserva)\b/ },
    { category: 'mascotas', pattern: /\b(perro|gato|mascota|pienso|arena gato)\b/ }
  ];
  const hit = keywordMap.find(({ pattern }) => pattern.test(safe));
  return hit ? hit.category : null;
}

function resolveTicketItemCategory(item = {}) {
  const mappedGuess = mapTicketCategoryToApp(item.category_guess || '');
  const inferred = mappedGuess === 'otros'
    ? inferCategoryFromName(item.name_norm || item.name_raw || '')
    : null;
  return {
    category_guess: mappedGuess,
    category_app: mapTicketCategoryToApp(inferred || mappedGuess),
    category_inferred: Boolean(inferred)
  };
}

function hasMissingCategory(product = {}) {
  const healthy = String(product?.healthy ?? '').trim();
  const cuisine = String(product?.cuisine ?? '').trim();
  return !healthy && !cuisine;
}

export function parseTicketImport(text = '') {
  const sanitizedText = sanitizeImportText(text);
  let parsed;
  try {
    parsed = JSON.parse(sanitizedText);
  } catch (error) {
    return { ok: false, error: buildJsonParseDiagnostic(error, sanitizedText) };
  }
  if (!parsed || parsed.schema !== 'TICKET_V1') {
    return { ok: false, error: 'Formato no compatible (se espera TICKET_V1)' };
  }
  if (!Array.isArray(parsed.items) || !parsed.items.length) {
    return { ok: false, error: 'No hay productos' };
  }

  const warnings = [];
  const items = [];
  for (let i = 0; i < parsed.items.length; i += 1) {
    const row = parsed.items[i] || {};
    const qtyRaw = Number(row.qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    if (!(Number.isFinite(qtyRaw) && qtyRaw > 0)) warnings.push(`Item ${i + 1}: qty <= 0, se ajusta a 1`);
    const totalPrice = Number(row.total_price);
    if (!Number.isFinite(totalPrice)) return { ok: false, error: `items[${i}].total_price es obligatorio y debe ser numérico finito` };
    const unitPriceRaw = row.unit_price;
    const unitPriceParsed = unitPriceRaw == null ? null : toNumberEUR(unitPriceRaw);
    const unitPrice = Number.isFinite(unitPriceParsed) ? unitPriceParsed : (qty > 0 ? totalPrice / qty : totalPrice);
    const nameNorm = String(row.name_norm || '').trim() || String(row.name_raw || '').trim();
    const categoryInfo = resolveTicketItemCategory({ ...row, name_norm: nameNorm });
    if (categoryInfo.category_inferred) {
      warnings.push(`Item ${i + 1}: faltaba category_guess útil, inferida por nombre → ${categoryInfo.category_app}`);
    }
    items.push({
      ...row,
      qty,
      total_price: totalPrice,
      unit_price: unitPrice,
      name_norm: nameNorm,
      name_raw: String(row.name_raw || nameNorm || '').trim(),
      ...categoryInfo
    });
  }
  const vendor = String(parsed?.source?.vendor || '').trim() || 'unknown';
  const purchase = parsed?.purchase && typeof parsed.purchase === 'object' ? parsed.purchase : {};
  const cardLast4Raw = purchase.card_last4;
  const cardLast4 = typeof cardLast4Raw === 'string' ? cardLast4Raw.trim() : '';
  if (cardLast4 && !/^\d{4}$/.test(cardLast4)) {
    warnings.push('purchase.card_last4 inválido (debe ser string de 4 dígitos), se ignora');
  }
  const computedTotal = Number(items.reduce((sum, item) => sum + Number(item.total_price || 0), 0).toFixed(2));
  const parsedPurchaseTotal = toNumberEUR(purchase.total);
  const ticketTotal = Number.isFinite(parsedPurchaseTotal) ? parsedPurchaseTotal : computedTotal;
  if (!Number.isFinite(parsedPurchaseTotal)) {
    warnings.push('purchase.total ausente o inválido; se usa la suma de items.total_price');
  }
  if (Number.isFinite(parsedPurchaseTotal) && Math.abs(parsedPurchaseTotal - computedTotal) > 0.5) {
    warnings.push(`Total declarado difiere de suma de líneas (${(parsedPurchaseTotal - computedTotal).toFixed(2)}€)`);
  }

  return {
    ok: true,
    data: {
      ...parsed,
      source: { ...(parsed.source || {}), vendor },
      purchase: {
        ...purchase,
        total: ticketTotal,
        computed_total: computedTotal,
        ...(cardLast4 && /^\d{4}$/.test(cardLast4) ? { card_last4: cardLast4 } : { card_last4: undefined })
      },
      items
    },
    warnings
  };
}

export function matchExistingProduct(ticketItem = {}, products = []) {
  const byName = normalizeProductName(ticketItem.name_norm || ticketItem.name_raw || '');
  if (!byName) return null;
  return products.find((product) => {
    const productName = normalizeProductName(product?.name || '');
    if (productName === byName) return true;
    if (!Array.isArray(product?.aliases)) return false;
    const raw = normalizeProductName(ticketItem.name_raw || '');
    return product.aliases.some((alias) => normalizeProductName(alias) === raw);
  }) || null;
}

export function applyTicketImport(ticket, currentExpenseDraft = {}, products = [], accounts = []) {
  const isExtraLine = (name = '') => /bolsa|descuento|cupon|cupón|redondeo|deposito|depósito/.test(normalizeProductName(name));
  const warnings = [];
  const createdProducts = [];
  const updatedProducts = [];
  const lineItems = [];
  let amount = 0;
  for (const item of ticket.items || []) {
    const matched = matchExistingProduct(item, products);
    const linePrice = Number(item.total_price || 0);
    const appCategory = String(item.category_app || mapTicketCategoryToApp(item.category_guess || 'otros'));
    amount += linePrice;
    lineItems.push({
      productId: matched?.id || '',
      name: item.name_norm,
      qty: Number(item.qty || 1),
      price: linePrice,
      unitPrice: Number(item.unit_price || 0),
      categoryGuess: String(item.category_guess || 'otros'),
      categoryApp: appCategory,
      categoryInferred: Boolean(item.category_inferred)
    });
    const nextDefaultPrice = Number(item.unit_price || item.total_price || 0);
    if (isExtraLine(item.name_norm || item.name_raw || '')) {
      continue;
    }
    if (matched) {
      const prevPrice = Number(matched.defaultPrice || 0);
      const shouldUpdatePrice = Number.isFinite(nextDefaultPrice) && nextDefaultPrice > 0 && Math.abs(prevPrice - nextDefaultPrice) > 0.001;
      const shouldFillCategory = hasMissingCategory(matched) && appCategory;
      if (shouldUpdatePrice || shouldFillCategory) {
        updatedProducts.push({
          ...matched,
          ...(shouldUpdatePrice ? { defaultPrice: nextDefaultPrice } : {}),
          ...(shouldFillCategory ? { healthy: appCategory, cuisine: appCategory } : {})
        });
      }
    } else {
      createdProducts.push({
        name: item.name_norm,
        defaultPrice: Number.isFinite(nextDefaultPrice) && nextDefaultPrice > 0 ? nextDefaultPrice : linePrice,
        place: String(ticket?.source?.vendor || 'unknown').trim() || 'unknown',
        healthy: appCategory,
        cuisine: appCategory,
        tags: Array.isArray(item.tags) ? item.tags : []
      });
    }
  }
  const purchaseTotal = toNumberEUR(ticket?.purchase?.total);
  if (Number.isFinite(purchaseTotal) && Math.abs(purchaseTotal - amount) > 0.5) {
    warnings.push(`El total del ticket difiere de la suma de líneas (${(purchaseTotal - amount).toFixed(2)}€)`);
  }
  const cardLast4 = String(ticket?.purchase?.card_last4 || '').trim();
  const matchedAccounts = /^\d{4}$/.test(cardLast4)
    ? accounts.filter((account) => String(account?.cardLast4 || '').trim() === cardLast4)
    : [];
  const autoSelectedAccount = matchedAccounts.length === 1 ? matchedAccounts[0] : null;
  if (cardLast4 && matchedAccounts.length === 1) {
    warnings.push(`Cuenta detectada por tarjeta ****${cardLast4} → ${autoSelectedAccount?.name || 'Sin nombre'}`);
  } else if (cardLast4 && matchedAccounts.length === 0) {
    warnings.push(`Tarjeta ****${cardLast4} no coincide con ninguna cuenta`);
  } else if (cardLast4 && matchedAccounts.length > 1) {
    warnings.push(`Tarjeta ****${cardLast4} coincide con varias cuentas; selecciona manualmente`);
  }
  const updatedDraft = {
    ...currentExpenseDraft,
    type: 'expense',
    category: 'Comida',
    amount: Number(purchaseTotal) > 0 ? purchaseTotal : amount,
    dateISO: String(ticket?.purchase?.date || currentExpenseDraft.dateISO || ''),
    note: [currentExpenseDraft.note || '', ticket?.source?.vendor && ticket.source.vendor !== 'unknown' ? `Ticket ${ticket.source.vendor}` : '']
      .filter(Boolean)
      .join(' · ')
      .trim(),
    ...(autoSelectedAccount && !String(currentExpenseDraft.accountId || '').trim() ? { accountId: autoSelectedAccount.id } : {}),
    importedItems: lineItems,
    importedVendor: String(ticket?.source?.vendor || 'unknown').trim() || 'unknown'
  };
  return { updatedDraft, createdProducts, updatedProducts, warnings, accountMatch: { cardLast4, matches: matchedAccounts, selected: autoSelectedAccount } };
}
