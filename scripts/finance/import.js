export function parseImportRaw(value = '') {
  return String(value || '').trim();
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

export function parseTicketImport(text = '') {
  let parsed;
  try {
    parsed = JSON.parse(String(text || '').trim());
  } catch {
    return { ok: false, error: 'JSON inválido' };
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
    if (!Number.isFinite(totalPrice)) return { ok: false, error: `Precio inválido en item ${i + 1}` };
    const unitPriceRaw = Number(row.unit_price);
    const unitPrice = Number.isFinite(unitPriceRaw) ? unitPriceRaw : (qty > 0 ? totalPrice / qty : totalPrice);
    const nameNorm = String(row.name_norm || '').trim() || String(row.name_raw || '').trim();
    items.push({
      ...row,
      qty,
      total_price: totalPrice,
      unit_price: unitPrice,
      name_norm: nameNorm,
      name_raw: String(row.name_raw || nameNorm || '').trim()
    });
  }
  const vendor = String(parsed?.source?.vendor || '').trim() || 'unknown';
  return {
    ok: true,
    data: {
      ...parsed,
      source: { ...(parsed.source || {}), vendor },
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

export function applyTicketImport(ticket, currentExpenseDraft = {}, products = []) {
  const isExtraLine = (name = '') => /bolsa|descuento|cupon|cupón|redondeo|deposito|depósito/.test(normalizeProductName(name));
  const warnings = [];
  const createdProducts = [];
  const updatedProducts = [];
  const lineItems = [];
  let amount = 0;
  for (const item of ticket.items || []) {
    const matched = matchExistingProduct(item, products);
    const linePrice = Number(item.total_price || 0);
    amount += linePrice;
    lineItems.push({
      productId: matched?.id || '',
      name: item.name_norm,
      qty: Number(item.qty || 1),
      price: linePrice,
      unitPrice: Number(item.unit_price || 0),
      categoryGuess: String(item.category_guess || 'otros')
    });
    const nextDefaultPrice = Number(item.unit_price || item.total_price || 0);
    if (isExtraLine(item.name_norm || item.name_raw || '')) {
      continue;
    }
    if (matched) {
      const prevPrice = Number(matched.defaultPrice || 0);
      if (Number.isFinite(nextDefaultPrice) && nextDefaultPrice > 0 && Math.abs(prevPrice - nextDefaultPrice) > 0.001) {
        updatedProducts.push({ ...matched, defaultPrice: nextDefaultPrice });
      }
    } else {
      createdProducts.push({
        name: item.name_norm,
        defaultPrice: Number.isFinite(nextDefaultPrice) && nextDefaultPrice > 0 ? nextDefaultPrice : linePrice,
        place: String(ticket?.source?.vendor || 'unknown').trim() || 'unknown',
        healthy: String(item.category_guess || 'otros')
      });
    }
  }
  const purchaseTotal = Number(ticket?.purchase?.total);
  if (Number.isFinite(purchaseTotal) && Math.abs(purchaseTotal - amount) > 0.5) {
    warnings.push(`El total del ticket difiere de la suma de líneas (${(purchaseTotal - amount).toFixed(2)}€)`);
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
    importedItems: lineItems,
    importedVendor: String(ticket?.source?.vendor || 'unknown').trim() || 'unknown'
  };
  return { updatedDraft, createdProducts, updatedProducts, warnings };
}
