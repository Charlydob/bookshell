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
  // 1) Si el navegador lo soporta, es lo ideal.
  if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
    try {
      const supported = Intl.supportedValuesOf("region") || [];
      const codes = supported.filter((code) => /^[A-Z]{2}$/.test(code));
      if (codes.length) return codes;
    } catch (_) {
      // algunos Chrome lanzan RangeError con "region"
    }
  }

  // 2) Fallback robusto: brute-force AA..ZZ usando Intl.DisplayNames.
  const dn = regionNamesEn || regionNamesEs;
  if (dn && typeof dn.of === "function") {
    const out = [];
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b);
        let name = null;
        try { name = dn.of(code); } catch (_) { name = null; }
        if (!name || name === code) continue;
        const low = String(name).toLowerCase();
        if (low.includes("unknown") || low.includes("desconoc")) continue;
        out.push(code);
      }
    }
    if (out.length > 150) return out;
  }

  // 3) Último recurso
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
const CONTINENT_BY_CODE = {
  ES:"Europa", FR:"Europa", DE:"Europa", IT:"Europa", PT:"Europa", GB:"Europa", IE:"Europa", NL:"Europa", BE:"Europa", CH:"Europa", AT:"Europa", PL:"Europa", CZ:"Europa", SE:"Europa", NO:"Europa", FI:"Europa", DK:"Europa", GR:"Europa", TR:"Asia",
  US:"América del Norte", CA:"América del Norte", MX:"América del Norte",
  AR:"América del Sur", CO:"América del Sur", BR:"América del Sur", CL:"América del Sur", PE:"América del Sur",
  MA:"África", EG:"África", ZA:"África", NG:"África", KE:"África", DZ:"África", TN:"África",
  JP:"Asia", CN:"Asia", KR:"Asia", IN:"Asia", IL:"Asia", SA:"Asia", AE:"Asia", ID:"Asia", TH:"Asia", PH:"Asia", VN:"Asia", SG:"Asia",
  AU:"Oceanía", NZ:"Oceanía",
};

export function getCountryContinent(code) {
  const c = String(code || "").toUpperCase();
  return CONTINENT_BY_CODE[c] || "Otros";
}
