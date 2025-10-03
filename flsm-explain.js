// flsm-explain.js — IPv4 + FLSM con output dei RISULTATI e della PROCEDURA (ESM)

/* ========== CONVERSIONI E CHECK ========== */
export function ipToInt(ip) {
  const p = ip.trim().split('.').map(x => Number(x));
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`IP non valido: ${ip}`);
  }
  return (((p[0] << 24) >>> 0) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
export function intToIp(u32) {
  return [(u32>>>24)&255,(u32>>>16)&255,(u32>>>8)&255,u32&255].join('.');
}
export function popcount(u32){ let v=u32>>>0,c=0; while(v){v&=v-1;c++;} return c; }
export function maskFromPrefix(prefix){
  if(!Number.isInteger(prefix)||prefix<0||prefix>32) throw new Error('Prefix fuori range');
  return prefix===0?0:(~0 << (32-prefix))>>>0;
}
export function prefixFromMask(maskIp){
  const m=ipToInt(maskIp), inv=(~m)>>>0;
  if(((inv+1)&inv)!==0) throw new Error('Maschera non contigua');
  return popcount(m);
}

/* ========== PRIMITIVE DI SOTTORETE ========== */
export function networkInt(ip,prefix){ return (ipToInt(ip)&maskFromPrefix(prefix))>>>0; }
export function broadcastInt(ip,prefix){
  const m=maskFromPrefix(prefix);
  return ((ipToInt(ip)&m)|((~m)>>>0))>>>0;
}
export function firstHostInt(n,p){ return p>=31?n:((n+1)>>>0); }
export function lastHostInt(b,p){ return p>=31?b:((b-1)>>>0); }
export function totalAddresses(prefix){
  const hb=32-prefix;
  if(hb===0) return 1;
  if(hb===1) return 2;
  return 1<<hb;
}
export function usableHosts(prefix){
  const hb=32-prefix;
  if(hb<=1) return 0;
  return (1<<hb)-2;
}

/* ========== PACCHETTI “CON PROCEDURA” ========== */

/** 1) Info base subnet + procedura */
export function explainSubnetInfo(ip, prefix){
  const steps=[];
  steps.push(`Input: IP=${ip}, Prefix=/${prefix}`);
  const mask = maskFromPrefix(prefix);
  steps.push(`1) Calcolo maschera da prefisso: mask = ${intToIp(mask)} (bin contigua da ${prefix} bit a 1)`);
  const net = networkInt(ip,prefix);
  steps.push(`2) Network = IP & mask → ${intToIp(net)}`);
  const bcast = broadcastInt(ip,prefix);
  steps.push(`3) Broadcast = Network | ~mask → ${intToIp(bcast)}`);
  const first = firstHostInt(net,prefix), last = lastHostInt(bcast,prefix);
  steps.push(`4) Host range (se /0…/30): ${intToIp(first)} – ${intToIp(last)}`);
  const total = totalAddresses(prefix), usable = usableHosts(prefix);
  steps.push(`5) Indirizzi totali = 2^(32-${prefix}) = ${total}, host usabili = ${usable}`);
  return {
    result:{
      ip, prefix,
      mask: intToIp(mask),
      network: intToIp(net),
      broadcast: intToIp(bcast),
      firstHost: intToIp(first),
      lastHost: intToIp(last),
      total, usable
    },
    steps
  };
}

/** 2) Determinare /new per ottenere almeno N sottoreti, con procedura */
export function explainPrefixForSubnets(basePrefix, neededSubnets){
  const steps=[];
  steps.push(`Input: basePrefix=/${basePrefix}, neededSubnets=${neededSubnets}`);
  const extraBits = Math.ceil(Math.log2(neededSubnets));
  steps.push(`1) Bit extra = ceil(log2(${neededSubnets})) = ${extraBits}`);
  const newPrefix = basePrefix + extraBits;
  steps.push(`2) Nuovo prefisso = ${basePrefix} + ${extraBits} = /${newPrefix}`);
  const subnets = 1<<extraBits;
  const blockSize = 1<<(32-newPrefix);
  steps.push(`3) Sottoreti prodotte = 2^${extraBits} = ${subnets}`);
  steps.push(`4) Dimensione blocco = 2^(32-${newPrefix}) = ${blockSize} indirizzi`);
  return { result:{ newPrefix, subnets, blockSize }, steps };
}

/** 3) Determinare prefisso per avere almeno H host usabili per sottorete, con procedura */
export function explainPrefixForHosts(hostsPerSubnet){
  const steps=[];
  steps.push(`Input: hostsPerSubnet(usabili) = ${hostsPerSubnet}`);
  steps.push(`Formula: 2^(32-p) - 2 ≥ ${hostsPerSubnet}`);
  let p;
  for(p=0;p<=32;p++){
    if(usableHosts(p)>=hostsPerSubnet) break;
  }
  steps.push(`Ricerca minima p: trovato p=${p} → host usabili = ${usableHosts(p)}`);
  return { result:{ prefix:p, mask:intToIp(maskFromPrefix(p)) }, steps };
}

/** 4) Suddividere una rete base in FLSM /newPrefix (lista) + procedura */
export function explainSubdivide(baseNetIp, basePrefix, newPrefix){
  const steps=[];
  steps.push(`Input: baseNet=${baseNetIp}/${basePrefix}, newPrefix=/${newPrefix}`);
  if(newPrefix<basePrefix) throw new Error('newPrefix deve essere ≥ basePrefix');
  const baseNetInt = networkInt(baseNetIp, basePrefix);
  steps.push(`1) Normalizzo network di partenza: ${intToIp(baseNetInt)}/${basePrefix}`);
  const count = 1<<(newPrefix-basePrefix);
  const block = 1<<(32-newPrefix);
  steps.push(`2) Numero sottoreti = 2^(${newPrefix}-${basePrefix}) = ${count}`);
  steps.push(`3) Ampiezza blocco = 2^(32-${newPrefix}) = ${block} indirizzi`);
  const res=[];
  for(let i=0;i<count;i++){
    const n=(baseNetInt + i*block)>>>0, b=(n+block-1)>>>0;
    res.push({
      index:i+1,
      network:intToIp(n),
      broadcast:intToIp(b),
      prefix:newPrefix,
      mask:intToIp(maskFromPrefix(newPrefix)),
      firstHost:intToIp(firstHostInt(n,newPrefix)),
      lastHost:intToIp(lastHostInt(b,newPrefix)),
      total:totalAddresses(newPrefix),
      usable:usableHosts(newPrefix)
    });
  }
  steps.push(`4) Calcolo per ciascuna sottorete: network, broadcast, first/last host, mask, conteggi`);
  return { result: res, steps };
}

/** 5) N-esima sottorete + procedura */
export function explainNthSubnet(baseNetIp, basePrefix, newPrefix, n1){
  const {result:list, steps:pre} = explainSubdivide(baseNetIp, basePrefix, newPrefix);
  const steps=[...pre];
  if(n1<1 || n1>list.length) throw new Error('Indice sottorete fuori range');
  steps.push(`5) Seleziono sottorete #${n1} (1-based)`);
  return { result: list[n1-1], steps };
}

/** 6) N-esimo host in una sottorete + procedura */
export function explainNthHostInSubnet(subnetNetworkIp, prefix, ordinal1){
  const steps=[];
  steps.push(`Input: subnet=${subnetNetworkIp}/${prefix}, host ordinal(1-based)=${ordinal1}`);
  if(prefix>=31) throw new Error('Nessun host usabile per /31 o /32 (semantica classica)');
  const n=ipToInt(subnetNetworkIp), b=broadcastInt(subnetNetworkIp,prefix);
  const first=(n+1)>>>0, last=(b-1)>>>0;
  steps.push(`1) firstHost=${intToIp(first)}, lastHost=${intToIp(last)}`);
  const target=(first + (ordinal1-1))>>>0;
  if(target>last) throw new Error('Ordinal oltre il range di host usabili');
  steps.push(`2) target = first + (${ordinal1}-1) = ${intToIp(target)}`);
  return { result:{ host:intToIp(target) }, steps };
}

/** 7) Sottorete esatta che coincide con un intervallo (se esiste) + procedura */
export function explainExactCidrForRange(startIp, endIp){
  const steps=[];
  steps.push(`Input intervallo: ${startIp} – ${endIp}`);
  const a=ipToInt(startIp), z=ipToInt(endIp);
  if(z<a) throw new Error('Intervallo non valido');
  const size=(z-a+1)>>>0;
  steps.push(`1) size = end-start+1 = ${size}`);
  const isPow2=(size&(size-1))===0;
  steps.push(`2) size è potenza di due? ${isPow2}`);
  if(!isPow2) return { result:null, steps:[...steps, '→ Non rappresentabile con un singolo blocco CIDR'] };
  const prefix=32-Math.log2(size);
  const aligned=(a & ((1<<(32-prefix))-1))===0;
  steps.push(`3) prefix = 32 - log2(size) = /${prefix}`);
  steps.push(`4) allineamento: network deve avere gli ultimi (32-${prefix}) bit a 0 → ${aligned}`);
  if(!aligned) return { result:null, steps:[...steps, '→ Non allineato al confine di blocco'] };
  const net=intToIp(a), mask=intToIp(maskFromPrefix(prefix));
  steps.push(`5) Risultato: ${net}/${prefix} (mask ${mask})`);
  return { result:{ network:net, prefix, mask }, steps };
}

/** 8) Copertura CIDR minima (lista di blocchi) + procedura */
export function explainCidrCover(startIp, endIp){
  const steps=[];
  steps.push(`Input intervallo: ${startIp} – ${endIp}`);
  let start=ipToInt(startIp), end=ipToInt(endIp);
  if(end<start) throw new Error('Intervallo non valido');
  const blocks=[];
  let i=1;
  while(start<=end){
    let maxSize = start & -start;         // massima potenza di due allineabile
    let remain = (end - start + 1)>>>0;
    while(maxSize>remain) maxSize>>=1;
    const prefix = 32 - Math.log2(maxSize);
    const net = intToIp(start), mask = intToIp(maskFromPrefix(prefix));
    blocks.push({ network:net, prefix, mask });
    steps.push(`${i}) blocco: ${net}/${prefix} (mask ${mask}), size=${maxSize}`);
    start = (start + maxSize)>>>0;
    i++;
  }
  return { result:blocks, steps };
}

/** 9) Piano FLSM uniforme a targetPrefix + procedura (NET-ID, BROADCAST, GATEWAY, conteggi) */
export function explainFlsmPlan(assignedNetIp, assignedPrefix, targetPrefix){
  const steps=[];
  steps.push(`Input: rete assegnata ${assignedNetIp}/${assignedPrefix}, targetPrefix=/${targetPrefix}`);
  if(targetPrefix<assignedPrefix) throw new Error('targetPrefix deve essere ≥ assignedPrefix');
  const baseNet = networkInt(assignedNetIp, assignedPrefix);
  const count = 1<<(targetPrefix-assignedPrefix);
  const block = 1<<(32-targetPrefix);
  const usable = usableHosts(targetPrefix);
  steps.push(`1) Normalizzo base: ${intToIp(baseNet)}/${assignedPrefix}`);
  steps.push(`2) #sottoreti = 2^(${targetPrefix}-${assignedPrefix}) = ${count}`);
  steps.push(`3) ampiezza blocco = 2^(32-${targetPrefix}) = ${block}, host usabili/subnet = ${usable}`);
  const list=[];
  for(let i=0;i<count;i++){
    const n=(baseNet+i*block)>>>0, b=(n+block-1)>>>0;
    list.push({
      index:i+1,
      network:intToIp(n),
      broadcast:intToIp(b),
      gateway:intToIp((targetPrefix>=31?n:(n+1))>>>0),
      prefix:targetPrefix,
      mask:intToIp(maskFromPrefix(targetPrefix)),
      total:totalAddresses(targetPrefix),
      usable
    });
  }
  steps.push(`4) Genero l’elenco completo delle sottoreti (NET-ID, BROADCAST, GATEWAY, total/usable)`);
  return { result:{ subnets:list, totalSubnets:count, usablePerSubnet:usable }, steps };
}

