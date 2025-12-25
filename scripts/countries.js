const FALLBACK_CODES = [
  "ES","US","FR","GB","DE","IT","PT","MX","AR","CO","BR","CL","PE","CA","AU","JP","CN","KR","IN","ZA","MA","EG","TR","GR","SE","NO","FI","DK","NL","BE","CH","AT","PL","CZ","IE","IL","SA","AE","NZ","ID","TH","PH","VN","SG","NG","KE","DZ","TN" 
];

const regionNamesEs = typeof Intl !== "undefined" && Intl.DisplayNames
  ? new Intl.DisplayNames(["es"], { type: "region" })
  : null;
const regionNamesEn = typeof Intl !== "undefined" && Intl.DisplayNames
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

function getCountryCodes() {
  if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
    const supported = Intl.supportedValuesOf("region") || [];
    const codes = supported.filter((code) => /^[A-Z]{2}$/.test(code));
    if (codes.length) return codes;
  }
  return FALLBACK_CODES;
}

const COUNTRY_CODES = getCountryCodes();
const COUNTRY_SET = new Set(COUNTRY_CODES);
const NAME_LOOKUP = buildNameLookup();

function normalizeKey(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function getNameFromDisplayNames(displayNames, code) {
  try {
    return displayNames?.of(code) || null;
  } catch (_) {
    return null;
  }
}

function getCountryName(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  const es = getNameFromDisplayNames(regionNamesEs, upper);
  if (es) return es;
  const en = getNameFromDisplayNames(regionNamesEn, upper);
  if (en) return en;
  return upper;
}

function getCountryEnglishName(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  const en = getNameFromDisplayNames(regionNamesEn, upper);
  if (en) return en;
  const es = getNameFromDisplayNames(regionNamesEs, upper);
  if (es) return es;
  return upper;
}

function buildNameLookup() {
  const map = new Map();
  COUNTRY_CODES.forEach((code) => {
    const es = getCountryName(code);
    const en = getCountryEnglishName(code);
    [es, en].forEach((name) => {
      const key = normalizeKey(name);
      if (key && !map.has(key)) {
        map.set(key, code);
      }
    });
  });
  return map;
}

export function normalizeCountryInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (COUNTRY_SET.has(upper)) {
    return { code: upper, name: getCountryName(upper) };
  }
  const byName = NAME_LOOKUP.get(normalizeKey(raw));
  if (byName) {
    return { code: byName, name: getCountryName(byName) };
  }
  return null;
}

export function getCountryOptions() {
  return COUNTRY_CODES
    .map((code) => ({ code, name: getCountryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

export function ensureCountryDatalist(target = "country-options") {
  const el = typeof target === "string" ? document.getElementById(target) : target;
  if (!el || el.__filled) return;
  const frag = document.createDocumentFragment();
  getCountryOptions().forEach(({ code, name }) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.label = `${name} (${code})`;
    opt.dataset.code = code;
    frag.appendChild(opt);
  });
  el.appendChild(frag);
  el.__filled = true;
}

export function getCountryNameEs(code) {
  return getCountryName(code);
}

export { getCountryEnglishName };
