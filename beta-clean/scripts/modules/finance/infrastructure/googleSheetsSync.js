const GOOGLE_SHEETS_WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbxqyaxc9OfULInEGT-U8qFuIW3QXe6yiULLP97FLb7nOi6H9S9ULplFU136vHM_Q8k67Q/exec";

const GOOGLE_SHEETS_TOKEN = "MiTokenSuperSecreto123456";

async function postToGoogleSheets(entity, action, data) {
  try {
    const response = await fetch(GOOGLE_SHEETS_WEBAPP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        token: GOOGLE_SHEETS_TOKEN,
        entity,
        action,
        data,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Google Sheets sync failed: ${response.status} ${text}`);
    }

    if (!text) return;

    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      console.warn("[finance] Google Sheets sync response was not JSON:", text);
      return;
    }

    if (!json?.ok) {
      throw new Error(json?.error || "Google Sheets sync returned ok=false");
    }
  } catch (err) {
    console.warn("[finance] Google Sheets sync failed", { entity, action, data, err });
  }
}

export function syncMovementCreateToGoogleSheets(movement) {
  return postToGoogleSheets("movement", "create", movement);
}

export function syncMovementUpdateToGoogleSheets(movement) {
  return postToGoogleSheets("movement", "update", movement);
}

export function syncMovementDeleteToGoogleSheets(movementId) {
  return postToGoogleSheets("movement", "delete", {
    id: String(movementId || "").trim(),
  });
}

export function syncProductUpsertToGoogleSheets(product) {
  return postToGoogleSheets("product", "update", product);
}

export function syncProductDeleteToGoogleSheets(productId) {
  return postToGoogleSheets("product", "delete", {
    id: String(productId || "").trim(),
  });
}

export function syncAccountCreateToGoogleSheets(account) {
  return postToGoogleSheets("account", "create", account);
}

export function syncProductSummaryUpsertToGoogleSheets(summary) {
  return postToGoogleSheets("productSummary", "update", summary);
}

export function syncProductSummaryDeleteToGoogleSheets(summary) {
  return postToGoogleSheets("productSummary", "delete", {
    product: String(summary?.product || "").trim(),
    supermarketName: String(summary?.supermarketName || "").trim(),
  });
}
