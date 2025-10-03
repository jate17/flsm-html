// flsm-core.js — Funzioni FLSM IPv4 (ES Module)

/* ===========================
 *  VALIDAZIONE & CONVERSIONI
 * =========================== */

/** Converte "A.B.C.D" -> uint32 */
export function ipToInt(ip) {
  const p = ip.trim().split('.').map(x => Number(x));
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`IP non valido: ${ip}`);
  }
  return (((p[0] << 24) >>> 0) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/** Converte uint32 -> "A.B.C.D" */
export function intToIp(u32) {
  return [
    (u32 >>> 24) & 255,
    (u32 >>> 16) & 255,
    (u32 >>> 8) & 255,
    u32 & 255,
  ].join('.');
}

/** Ritorna true se stringa è IP v4 valido */
export function isValidIp(ip) {
  try { ipToInt(ip); return true; } catch { return false; }
}

/** Calcola maschera da prefisso (0..32) → uint32 */
export function maskFromPrefix(prefix) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('Prefix fuori range (0..32)');
  }
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
}

/** Conta i bit a 1 in un uint32 */
export function popcount(u32) {
  let v = u32 >>> 0, c = 0;
  while (v) { v &= v - 1; c++; }
  return c;
}

/** Prefisso da maschera "255.255.255.0" → 24 (verifica contiguità) */
export function prefixFromMask(maskIp) {
  const m = ipToInt(maskIp);
  const inv = (~m) >>> 0;
  // contiguità: inv deve essere 0...011..1
  if (((inv + 1) & inv) !== 0) throw new Error('Maschera non contigua');
  return popcount(m);
}

/* ===========================
 *     CALCOLI DI SOTTORETE
 * =========================== */

/** Network address (uint32) dato IP/PREFIX */
export function networkInt(ip, prefix) {
  return (ipToInt(ip) & maskFromPrefix(prefix)) >>> 0;
}

/** Broadcast address (uint32) dato IP/PREFIX */
export function broadcastInt(ip, prefix) {
  const m = maskFromPrefix(prefix);
  return ((ipToInt(ip) & m) | (~m >>> 0)) >>> 0;
}

/** Primo host (uint32). Nota: per /31 e /32 segue semantica classica (0 host usable) */
export function firstHostInt(netU32, prefix) {
  if (prefix >= 31) return netU32; // formalmente non c’è host usable; restituiamo netU32 per coerenza
  return (netU32 + 1) >>> 0;
}

/** Ultimo host (uint32) */
export function lastHostInt(bcastU32, prefix) {
  if (prefix >= 31) return bcastU32;
  return (bcastU32 - 1) >>> 0;
}

/** Numero di indirizzi totali nel blocco (inclusi net e bcast) */
export function totalAddresses(prefix) {
  const hb = 32 - prefix;
  if (hb < 0) throw new Error('Prefix fuori range');
  if (hb === 0) return 1;      // /32
  if (hb === 1) return 2;      // /31
  return 1 << hb;              // /0.. /30
}

/** Host usabili (classico: esclude network e broadcast; /31=0, /32=1 convenzionale=0 usable) */
export function usableHosts(prefix) {
  const hb = 32 - prefix;
  if (hb <= 1) return 0; // /31, /32
  return (1 << hb) - 2;
}

/** Info sintetiche dato IP/prefix */
export function subnetInfo(ip, prefix) {
  const net = networkInt(ip, prefix);
  const bcast = broadcastInt(ip, prefix);
  return {
    ip,
    prefix,
    mask: intToIp(maskFromPrefix(prefix)),
    network: intToIp(net),
    broadcast: intToIp(bcast),
    firstHost: intToIp(firstHostInt(net, prefix)),
    lastHost: intToIp(lastHostInt(bcast, prefix)),
    total: totalAddresses(prefix),
    usable: usableHosts(prefix),
  };
}

/* ===========================
 *            FLSM
 * =========================== */

/** Calcola il nuovo prefisso per ottenere almeno `neededSubnets` sottoreti (FLSM) */
export function prefixForSubnets(basePrefix, neededSubnets) {
  if (neededSubnets < 1) throw new Error('neededSubnets deve essere >= 1');
  const extra = Math.ceil(Math.log2(neededSubnets));
  const p = basePrefix + extra;
  if (p > 32) throw new Error('Prefix risultante > 32');
  return p;
}

/** Calcola il prefisso che garantisce almeno `hostsPerSubnet` host usabili (FLSM) */
export function prefixForHosts(hostsPerSubnet) {
  if (!Number.isInteger(hostsPerSubnet) || hostsPerSubnet < 0) {
    throw new Error('hostsPerSubnet non valido');
  }
  // host usable = 2^(32-p) - 2  >= hostsPerSubnet
  for (let p = 0; p <= 32; p++) {
    if (usableHosts(p) >= hostsPerSubnet) return p;
  }
  throw new Error('Impossibile soddisfare il requisito host');
}

/** Suddivide un blocco base (net/prefix) in FLSM a `newPrefix`. Ritorna array di sottoreti ordinate. */
export function subdivide(netIp, basePrefix, newPrefix) {
  if (newPrefix < basePrefix) {
    throw new Error('newPrefix deve essere >= basePrefix');
  }
  const baseNet = networkInt(netIp, basePrefix);
  const count = 1 << (newPrefix - basePrefix);
  const block = 1 << (32 - newPrefix);
  const res = [];
  for (let i = 0; i < count; i++) {
    const n = (baseNet + i * block) >>> 0;
    const b = (n + block - 1) >>> 0;
    res.push({
      index: i + 1,
      network: intToIp(n),
      broadcast: intToIp(b),
      prefix: newPrefix,
      mask: intToIp(maskFromPrefix(newPrefix)),
      firstHost: intToIp(firstHostInt(n, newPrefix)),
      lastHost: intToIp(lastHostInt(b, newPrefix)),
      total: totalAddresses(newPrefix),
      usable: usableHosts(newPrefix),
      gateway: intToIp((newPrefix >= 31 ? n : (n + 1)) >>> 0), // convenzione: primo host
    });
  }
  return res;
}

/** Restituisce la N-esima sottorete (1-based) della suddivisione FLSM net/basePrefix → newPrefix */
export function nthSubnet(netIp, basePrefix, newPrefix, n1) {
  const all = subdivide(netIp, basePrefix, newPrefix);
  if (n1 < 1 || n1 > all.length) throw new Error('Indice sottorete fuori range');
  return all[n1 - 1];
}

/** Restituisce l’host ordinal (1-based) all’interno della sottorete specificata */
export function nthHostInSubnet(subnetNetworkIp, prefix, ordinal1) {
  if (!Number.isInteger(ordinal1) || ordinal1 < 1) {
    throw new Error('ordinal1 deve essere >= 1');
  }
  const n = ipToInt(subnetNetworkIp);
  const b = broadcastInt(subnetNetworkIp, prefix);
  if (prefix >= 31) throw new Error('Nessun host usabile per /31 o /32 (semantica classica)');
  const first = (n + 1) >>> 0;
  const target = (first + (ordinal1 - 1)) >>> 0;
  if (target >= b) throw new Error('Ordinal eccede il range di host usabili');
  return intToIp(target);
}

/* ===========================
 *     RANGE & COPERTURE CIDR
 * =========================== */

/** Ritorna la più piccola sottorete (network/prefix) che coincide esattamente con [start,end], altrimenti null */
export function exactCidrForRange(startIp, endIp) {
  const a = ipToInt(startIp), z = ipToInt(endIp);
  if (z < a) throw new Error('Intervallo non valido');
  const size = (z - a + 1) >>> 0;
  const isPow2 = (size & (size - 1)) === 0;
  if (!isPow2) return null;
  const prefix = 32 - Math.log2(size);
  const aligned = (a & ((1 << (32 - prefix)) - 1)) === 0;
  if (!aligned) return null;
  return { network: intToIp(a), prefix, mask: intToIp(maskFromPrefix(prefix)) };
}

/** Copertura CIDR minimale (lista di blocchi) che ricopre [start,end] */
export function cidrCover(startIp, endIp) {
  let start = ipToInt(startIp), end = ipToInt(endIp);
  if (end < start) throw new Error('Intervallo non valido');
  const blocks = [];
  while (start <= end) {
    let maxSize = start & -start;              // massima potenza di due allineabile
    let remain = (end - start + 1) >>> 0;
    while (maxSize > remain) maxSize >>= 1;
    const prefix = 32 - Math.log2(maxSize);
    blocks.push({ network: intToIp(start), prefix, mask: intToIp(maskFromPrefix(prefix)) });
    start = (start + maxSize) >>> 0;
  }
  return blocks;
}

/* ===========================
 *    UTIL PER “PIANI” FLSM
 * =========================== */

/**
 * Genera un piano FLSM uniforme a partire da una rete assegnata.
 * - assignedNetIp/prefix: es. "130.100.0.0", 16
 * - targetPrefix: prefisso FLSM risultante per tutte le sottoreti (es. 22)
 * Ritorna tutte le sottoreti disponibili con NET-ID, BROADCAST, GATEWAY, usable.
 */
export function flsmPlan(assignedNetIp, assignedPrefix, targetPrefix) {
  if (targetPrefix < assignedPrefix) throw new Error('targetPrefix deve essere ≥ assignedPrefix');
  return subdivide(assignedNetIp, assignedPrefix, targetPrefix);
}

/**
 * Calcola sprechi (host usabili non utilizzati) per una sottorete FLSM
 * dati gli host reali previsti (escludendo gateway).
 */
export function wastedHosts(usablePerSubnet, realHosts, { countGateway = true } = {}) {
  const needed = realHosts + (countGateway ? 1 : 0);
  const w = usablePerSubnet - needed;
  return w >= 0 ? w : 0;
}

/* ===========================
 *         HELPERS VARI
 * =========================== */

/** Ritorna true se ip appartiene a network/prefix */
export function ipInSubnet(ip, netIp, prefix) {
  const ipU = ipToInt(ip);
  const netU = networkInt(netIp, prefix);
  const m = maskFromPrefix(prefix);
  return (ipU & m) >>> 0 === netU;
}

/** Trova la sottorete (tra una lista) che contiene un certo IP */
export function findContainingSubnet(ip, subnets /* array {network,prefix} */) {
  const u = ipToInt(ip);
  for (const s of subnets) {
    const n = ipToInt(s.network);
    const m = maskFromPrefix(s.prefix);
    if (((u & m) >>> 0) === n) return s;
  }
  return null;
}

/** Merge (supernetting) di due blocchi adiacenti se possibile, altrimenti null */
export function tryMergeAdjacent(a /* {network,prefix} */, b /* {network,prefix} */) {
  if (a.prefix !== b.prefix) return null;
  const p = a.prefix;
  if (p === 0) return null;
  const size = 1 << (32 - p);
  const na = ipToInt(a.network), nb = ipToInt(b.network);
  const first = Math.min(na, nb), second = Math.max(na, nb);
  if (second !== (first + size)) return null; // non adiacenti
  const parentNet = first & (~(size - 1) << 1); // azzera bit p-esimo
  const parentPrefix = p - 1;
  const aligned = (parentNet & ((1 << (32 - parentPrefix)) - 1)) === 0;
  if (!aligned) return null;
  return { network: intToIp(parentNet >>> 0), prefix: parentPrefix, mask: intToIp(maskFromPrefix(parentPrefix)) };
}


