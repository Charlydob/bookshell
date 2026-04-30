export function parseImportRaw(value = '') {
  return String(value || '').trim();
}

export const TICKET_IMPORT_SAMPLE_V1 = `{
  "schema": "TICKET_V1",
  "source": {
    "vendor": "Eroski",
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
  const input = String(raw || '');
  const changes = [];
  let sanitized = input.trim();
  if (sanitized !== input) changes.push('trimmed_outer_whitespace');
  const noStartFence = sanitized.replace(/^```(?:json)?\s*/i, '');
  const noFences = noStartFence.replace(/\s*```$/, '');
  if (noFences !== sanitized) changes.push('removed_markdown_fences');
  sanitized = noFences;
  const withNormalQuotes = sanitized
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
  if (withNormalQuotes !== sanitized) changes.push('replaced_smart_quotes');
  sanitized = withNormalQuotes;
  const noInvisible = sanitized.replace(/[\uFEFF\u200B]/g, '');
  if (noInvisible !== sanitized) changes.push('removed_invisible_chars');
  sanitized = noInvisible;
  const noNbsp = sanitized.replace(/\u00A0/g, ' ');
  if (noNbsp !== sanitized) changes.push('replaced_nbsp');
  sanitized = noNbsp;
  return { sanitized, changes };
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

export function buildParseError(error, text = '') {
  const message = error?.message || 'Error desconocido';
  const match = /position\s+(\d+)/i.exec(message);
  const pos = match ? Number(match[1]) : -1;
  if (!Number.isFinite(pos) || pos < 0) {
    return { message: `JSON inválido: ${message}`, line: null, column: null, position: null, snippet: '', charCodes: [] };
  }
  const upto = text.slice(0, pos);
  const line = upto.split('\n').length;
  const col = upto.length - upto.lastIndexOf('\n');
  const snippetStart = Math.max(0, pos - 40);
  const snippetEnd = Math.min(text.length, pos + 40);
  const snippet = text.slice(snippetStart, snippetEnd).replace(/\n/g, '↵');
  const codesStart = Math.max(0, pos - 10);
  const codesEnd = Math.min(text.length, pos + 10);
  const charCodes = Array.from(text.slice(codesStart, codesEnd)).map((char, index) => ({
    offset: codesStart + index,
    char,
    code: char.charCodeAt(0)
  }));
  return {
    message: `JSON inválido (línea ${line}, col ${col}): ${message}`,
    line,
    column: col,
    position: pos,
    snippet,
    charCodes
  };
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

export function normalizeTicketKey(str = '') {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const VALID_TICKET_CATEGORIES = new Set([
  'lacteos', 'carne', 'pescado', 'fruta', 'verdura', 'panaderia',
  'bebidas', 'snacks', 'hogar', 'higiene', 'congelados', 'despensa',
  'mascotas', 'otros'
]);

const FOOD_TICKET_CATEGORIES = new Set([
  'fruta', 'verdura', 'carne', 'pescado', 'lacteos', 'despensa', 'panaderia', 'bebidas', 'congelados', 'snacks'
]);

const KNOWN_GROCERY_VENDORS = [
  'mercadona', 'eroski', 'carrefour', 'dia', 'aldi', 'lidl', 'ahorramas', 'alcampo', 'hipercor', 'el corte ingles', 'consum', 'bonpreu', 'spar'
];

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

export function computeUnitPrice(totalPriceInput, qtyInput, decimals = 2) {
  const totalPrice = Number(totalPriceInput);
  const qty = Number(qtyInput);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return 0;
  if (!Number.isFinite(qty) || qty <= 0) return Number(totalPrice.toFixed(decimals));
  const factor = 10 ** decimals;
  return Math.round((totalPrice / qty) * factor) / factor;
}

function isKnownGroceryVendor(vendor = '') {
  const normalized = normalizeProductName(vendor);
  return KNOWN_GROCERY_VENDORS.some((entry) => normalized.includes(entry));
}

export function resolveTicketMovementCategory(ticket = {}) {
  const vendor = String(ticket?.source?.vendor || '').trim();
  if (isKnownGroceryVendor(vendor)) return 'Comida';
  const items = Array.isArray(ticket?.items) ? ticket.items : [];
  if (!items.length) return 'Sin categoría';
  const foodCount = items.filter((item) => FOOD_TICKET_CATEGORIES.has(mapTicketCategoryToApp(item?.category_app || item?.category_guess || ''))).length;
  return (foodCount / items.length) > 0.6 ? 'Comida' : 'Sin categoría';
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
  const raw = String(text || '');
  const sanitize = sanitizeImportText(raw);
  let parsed;
  try {
    parsed = JSON.parse(sanitize.sanitized);
  } catch (error) {
    const parseError = buildParseError(error, sanitize.sanitized);
    return {
      ok: false,
      stage: 'parse',
      error: parseError.message,
      diagnostic: {
        stage: 'parse',
        raw_length: raw.length,
        sanitized_length: sanitize.sanitized.length,
        sanitize_changes: sanitize.changes,
        parse_error: parseError
      }
    };
  }
  if (!parsed || parsed.schema !== 'TICKET_V1') {
    return {
      ok: false,
      stage: 'validate',
      error: 'Formato no compatible (se espera TICKET_V1)',
      errors: [{ path: 'schema', code: 'invalid_schema', message: 'Formato no compatible (se espera TICKET_V1)' }],
      diagnostic: {
        stage: 'validate',
        raw_length: raw.length,
        sanitized_length: sanitize.sanitized.length,
        sanitize_changes: sanitize.changes,
        validate_errors: [{ path: 'schema', code: 'invalid_schema', message: 'Formato no compatible (se espera TICKET_V1)' }]
      }
    };
  }
  if (!Array.isArray(parsed.items) || !parsed.items.length) {
    return {
      ok: false,
      stage: 'validate',
      error: 'No hay productos',
      errors: [{ path: 'items', code: 'items_required', message: 'Debe existir un array items con al menos 1 elemento' }],
      diagnostic: {
        stage: 'validate',
        raw_length: raw.length,
        sanitized_length: sanitize.sanitized.length,
        sanitize_changes: sanitize.changes,
        validate_errors: [{ path: 'items', code: 'items_required', message: 'Debe existir un array items con al menos 1 elemento' }]
      }
    };
  }

  const warnings = [];
  const items = [];
  for (let i = 0; i < parsed.items.length; i += 1) {
    const row = parsed.items[i] || {};
    const qtyRaw = Number(row.qty);
    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
    if (!(Number.isFinite(qtyRaw) && qtyRaw > 0)) warnings.push(`Item ${i + 1}: qty <= 0, se ajusta a 1`);
    const totalPrice = toNumberEUR(row.total_price);
    if (!Number.isFinite(totalPrice)) {
      const validationErrors = [{ path: `items[${i}].total_price`, code: 'total_price_required', message: 'Debe ser numérico finito (number o string convertible EUR)' }];
      return {
        ok: false,
        stage: 'validate',
        error: `${validationErrors[0].path}: ${validationErrors[0].message}`,
        errors: validationErrors,
        diagnostic: {
          stage: 'validate',
          raw_length: raw.length,
          sanitized_length: sanitize.sanitized.length,
          sanitize_changes: sanitize.changes,
          validate_errors: validationErrors,
          warnings
        }
      };
    }
    const unitPriceRaw = row.unit_price;
    const unitPriceParsed = unitPriceRaw == null ? null : toNumberEUR(unitPriceRaw);
    const unitPrice = Number.isFinite(unitPriceParsed) ? unitPriceParsed : computeUnitPrice(totalPrice, qty);
    const nameNorm = String(row.name_norm || '').trim() || String(row.name_raw || '').trim();
    if (!nameNorm) {
      const validationErrors = [{ path: `items[${i}]`, code: 'name_required', message: 'name_raw o name_norm es obligatorio' }];
      return {
        ok: false,
        stage: 'validate',
        error: `${validationErrors[0].path}: ${validationErrors[0].message}`,
        errors: validationErrors,
        diagnostic: {
          stage: 'validate',
          raw_length: raw.length,
          sanitized_length: sanitize.sanitized.length,
          sanitize_changes: sanitize.changes,
          validate_errors: validationErrors,
          warnings
        }
      };
    }
    const categoryInfo = resolveTicketItemCategory({ ...row, name_norm: nameNorm });
    if (categoryInfo.category_inferred) {
      warnings.push(`Item ${i + 1}: faltaba category_guess útil, inferida por nombre → ${categoryInfo.category_app}`);
    }
    items.push({
      ...row,
      qty,
      unit: String(row.unit || 'ud').trim() || 'ud',
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
    stage: 'ok',
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
    warnings,
    diagnostic: {
      stage: 'ok',
      raw_length: raw.length,
      sanitized_length: sanitize.sanitized.length,
      sanitize_changes: sanitize.changes,
      warnings,
      computed_total: computedTotal,
      purchase_total: ticketTotal
    }
  };
}

export function matchExistingProduct(ticketItem = {}, products = []) {
  const rawCanonical = normalizeTicketKey(ticketItem.name_raw || ticketItem.name_norm || '');
  if (!rawCanonical) return null;
  const canonicalKey = firebaseSafeKey(rawCanonical);
  return products.find((product) => {
    const primaryCanonical = normalizeTicketKey(product?.ticketName || product?.name || '');
    if (primaryCanonical && primaryCanonical === rawCanonical) return true;
    const productKey = firebaseSafeKey(product?.key || product?.name || '');
    if (productKey && productKey === canonicalKey) return true;

    const aliases = Array.isArray(product?.aliases) ? product.aliases : [];
    if (aliases.some((alias) => normalizeTicketKey(alias) === rawCanonical)) return true;
    const vendorAliases = product?.vendorAliases && typeof product.vendorAliases === 'object'
      ? Object.values(product.vendorAliases).flatMap((list) => (Array.isArray(list) ? list : []))
      : [];
    if (vendorAliases.some((alias) => normalizeTicketKey(alias) === rawCanonical)) return true;

    const displayName = normalizeTicketKey(product?.displayName || '');
    if (displayName === rawCanonical) return true;
    return false;
  }) || null;
}

export function firebaseSafeKey(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.#$/[\]]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .trim();
}

export function applyTicketImport(ticket, currentExpenseDraft = {}, products = [], accounts = []) {
  const isExtraLine = (name = '') => /bolsa|descuento|cupon|cupón|redondeo|deposito|depósito/.test(normalizeProductName(name));
  const warnings = [];
  const createdProducts = [];
  const updatedProducts = [];
  const lineItems = [];
  let amount = 0;
  const toUniqueList = (values = []) => {
    const seen = new Set();
    const output = [];
    for (const value of values) {
      const safe = String(value || '').trim();
      if (!safe) continue;
      const canonical = normalizeTicketKey(safe);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      output.push(safe);
    }
    return output;
  };
  for (const item of ticket.items || []) {
    const matched = matchExistingProduct({ ...item, vendor: ticket?.source?.vendor || '' }, products);
    const rawName = String(item.name_raw || item.name_norm || '').trim();
    const canonicalName = normalizeTicketKey(rawName);
    const normalizedName = String(item.name_norm || rawName).trim();
    const linePrice = Number(item.total_price || 0);
    const appCategory = String(item.category_app || mapTicketCategoryToApp(item.category_guess || 'otros'));
    amount += linePrice;
    lineItems.push({
      productId: matched?.id || '',
      name: rawName || normalizedName,
      qty: Number(item.qty || 1),
      unit: String(item.unit || 'ud').trim() || 'ud',
      price: linePrice,
      totalPrice: linePrice,
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
      const nextAliases = toUniqueList([...(Array.isArray(matched.aliases) ? matched.aliases : []), rawName, normalizedName]);
      const aliasesChanged = JSON.stringify(nextAliases) !== JSON.stringify(Array.isArray(matched.aliases) ? matched.aliases : []);
      const shouldSetTicketName = !String(matched.ticketName || '').trim() && rawName;
      if (shouldUpdatePrice || shouldFillCategory || aliasesChanged || shouldSetTicketName) {
        updatedProducts.push({
          ...matched,
          ...(shouldSetTicketName ? { ticketName: rawName } : {}),
          ...(aliasesChanged ? { aliases: nextAliases } : {}),
          ...(shouldUpdatePrice ? { defaultPrice: nextDefaultPrice } : {}),
          ...(shouldFillCategory ? { healthy: appCategory, cuisine: appCategory } : {})
        });
      }
    } else {
      const initialAliases = toUniqueList([normalizedName]);
      createdProducts.push({
        name: canonicalName || normalizeTicketKey(normalizedName),
        ticketName: rawName || normalizedName,
        displayName: rawName || normalizedName,
        aliases: initialAliases,
        vendorAliases: {
          [firebaseSafeKey(ticket?.source?.vendor || 'unknown') || 'unknown']: toUniqueList([normalizedName, rawName])
        },
        createdFromVendor: String(ticket?.source?.vendor || ''),
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
    category: String(currentExpenseDraft.category || '').trim().toLowerCase() === 'sin categoría' || !String(currentExpenseDraft.category || '').trim()
      ? resolveTicketMovementCategory(ticket)
      : currentExpenseDraft.category,
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
