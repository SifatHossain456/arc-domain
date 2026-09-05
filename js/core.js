/**
 * ArcName — core library (pure logic, no DOM).
 * Exposed on globalThis as `ArcCore` so it can be unit-tested in Node
 * (`node -e "require('./js/core.js'); ..."`) and used in the browser.
 */
(function (root) {
  'use strict';

  var CFG = (root.ARC_CONFIG || {});

  /* ───────────────────────── name validation ───────────────────────── */

  var NAME_RE = /^[a-z0-9]+$/;

  /**
   * Normalize raw user input to a candidate name.
   * @returns {string}
   */
  function normalizeName(raw) {
    return String(raw || '').trim().toLowerCase();
  }

  /**
   * Validate a name. Returns { ok:boolean, name:string, reason?:string }.
   * Rules mirror the onchain registry: a-z and 0-9 only, 3-32 chars.
   */
  function validateName(raw) {
    var name = normalizeName(raw);
    if (name.length === 0) return { ok: false, name: name, reason: 'Enter a name to check.' };
    if (name.length < CFG.minNameLength) {
      return { ok: false, name: name, reason: 'Too short — names need at least ' + CFG.minNameLength + ' characters.' };
    }
    if (name.length > CFG.maxNameLength) {
      return { ok: false, name: name, reason: 'Too long — names are capped at ' + CFG.maxNameLength + ' characters.' };
    }
    if (!NAME_RE.test(name)) {
      return { ok: false, name: name, reason: 'Letters and numbers only (a–z, 0–9). No spaces, hyphens or symbols.' };
    }
    return { ok: true, name: name };
  }

  /* ───────────────────────── hex / number utils ───────────────────────── */

  function stripHex(h) {
    return String(h || '').replace(/^0x/i, '');
  }

  function hexToBigInt(h) {
    var s = stripHex(h);
    return s === '' ? 0n : BigInt('0x' + s);
  }

  function bigIntToHex(v) {
    return '0x' + v.toString(16);
  }

  function hexToNumber(h) {
    var s = stripHex(h);
    if (s === '') return NaN;
    // safe for < 2^53
    return Number('0x' + s);
  }

  /**
   * Format a raw integer (hex or decimal string / BigInt) as a decimal
   * human amount with `decimals` places, e.g. 18-decimal USDC wei.
   * Returns { display, full } — display is grouped + trimmed to 6 dp max.
   */
  function formatUnits(valueHexOrInt, decimals) {
    var raw = typeof valueHexOrInt === 'bigint' ? valueHexOrInt : hexToBigInt(String(valueHexOrInt));
    var dec = Number(decimals || 0);
    var neg = raw < 0n;
    var abs = neg ? -raw : raw;
    var ds = abs.toString(10);
    var full;
    if (dec === 0) {
      full = ds;
    } else {
      var padded = ds.padStart(dec + 1, '0');
      var intPart = padded.slice(0, -dec);
      var fracPart = padded.slice(-dec);
      full = intPart + '.' + fracPart;
    }
    if (neg) full = '-' + full;
    // Trim trailing zeros beyond 6 dp for readability; keep at least 0.
    var display = trimToDisplay(full);
    return { display: display, full: full };
  }

  function trimToDisplay(full) {
    var neg = full.charAt(0) === '-';
    var body = neg ? full.slice(1) : full;
    var parts = body.split('.');
    var intPart = parts[0].replace(/^0+(?=\d)/, '') || '0';
    var fracPart = parts.length > 1 ? parts[1] : '';
    if (fracPart.length > 6) fracPart = fracPart.slice(0, 6);
    // drop trailing zeros
    fracPart = fracPart.replace(/0+$/, '');
    var out = fracPart ? intPart + '.' + fracPart : intPart;
    // grouping
    out = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fracPart ? '.' + fracPart : '');
    return (neg ? '-' : '') + out;
  }

  function formatGwei(hexWei) {
    var v = hexToBigInt(hexWei);
    var gwei = Number(v) / 1e9;
    return gwei.toFixed(2).replace(/\.?0+$/, '');
  }

  function shortAddress(addr, lead, trail) {
    var a = String(addr || '');
    lead = lead || 6;
    trail = trail || 4;
    if (a.length <= lead + trail + 2) return a;
    return a.slice(0, lead) + '…' + a.slice(-trail);
  }

  /* ───────────────────────── JSON-RPC transport ───────────────────────── */

  var _endpointLatency = {}; // endpoint -> last latency ms

  /**
   * POST one JSON-RPC call to the first RPC endpoint that answers.
   * @returns {Promise<{result:*, endpoint:string, latencyMs:number}>}
   */
  function rpcCall(method, params, timeoutMs) {
    var urls = (CFG.chain && CFG.chain.rpcUrls) || [];
    var to = timeoutMs || 12000;
    var payload = { jsonrpc: '2.0', method: method, params: params || [], id: Date.now() + Math.floor(Math.random() * 1000) };

    function attempt(i) {
      if (i >= urls.length) {
        var err = new Error('RPC unreachable: all ' + urls.length + ' endpoint(s) failed.');
        err.code = 'RPC_OFFLINE';
        throw err;
      }
      var url = urls[i];
      var start = Date.now();
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, to) : null;
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (json) {
        if (json.error) {
          var e = new Error(json.error.message || 'RPC error ' + json.error.code);
          e.code = 'RPC_ERROR';
          e.data = json.error;
          throw e;
        }
        _endpointLatency[url] = Date.now() - start;
        return { result: json.result, endpoint: url, latencyMs: Date.now() - start };
      }).catch(function (err) {
        if (ctrl) clearTimeout(timer);
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  /** Parallel RPC calls; resolves when all settle. */
  function rpcCalls(list, timeoutMs) {
    return Promise.all(list.map(function (job) {
      return rpcCall(job.method, job.params, timeoutMs)
        .then(function (r) { return { method: job.method, ok: true, value: r.result, endpoint: r.endpoint, latencyMs: r.latencyMs }; })
        .catch(function (err) { return { method: job.method, ok: false, error: err }; });
    }));
  }

  /* ───────────────────────── ABI encode / decode ───────────────────────── */

  var SELECTORS = {
    register: '0xf2c298be',        // register(string)
    isAvailable: '0x965306aa',     // isAvailable(string)
    ownerOf: '0x920ffa26',         // ownerOf(string)
    price: '0xa035b1fe',           // price()
    totalNames: '0xa38cb6c1',      // totalNames()
    // ── v2 · resolver layer ──
    transfer: '0xfbf58b3e',        // transfer(string,address)
    setText: '0x05378f4f',         // setText(string,string,string)
    text: '0x0513c3e9',            // text(string,string)
    setPrimaryName: '0xab66abd5',  // setPrimaryName(string)
    primaryName: '0xeba951aa',     // primaryName(address)
    namesOf: '0x84d2731c'          // namesOf(address)
  };

  function padBytes32(hex) {
    var s = stripHex(hex);
    return '0x' + s.padStart(64, '0');
  }

  /* ── v2 · ABI helpers (strings / addresses / string[] decoding) ── */

  /** UTF-8 encode a string to an unpadded lowercase hex byte string. */
  function utf8ToHex(str) {
    var s = String(str == null ? '' : str);
    var hex = '';
    for (var i = 0; i < s.length; i++) {
      var code = s.codePointAt(i);
      if (code > 0xffff) i++; // surrogate pair already consumed
      if (code < 0x80) hex += code.toString(16).padStart(2, '0');
      else if (code < 0x800) {
        hex += (0xc0 | (code >> 6)).toString(16).padStart(2, '0');
        hex += (0x80 | (code & 0x3f)).toString(16).padStart(2, '0');
      } else if (code < 0x10000) {
        hex += (0xe0 | (code >> 12)).toString(16).padStart(2, '0');
        hex += (0x80 | ((code >> 6) & 0x3f)).toString(16).padStart(2, '0');
        hex += (0x80 | (code & 0x3f)).toString(16).padStart(2, '0');
      } else {
        hex += (0xf0 | (code >> 18)).toString(16).padStart(2, '0');
        hex += (0x80 | ((code >> 12) & 0x3f)).toString(16).padStart(2, '0');
        hex += (0x80 | ((code >> 6) & 0x3f)).toString(16).padStart(2, '0');
        hex += (0x80 | (code & 0x3f)).toString(16).padStart(2, '0');
      }
    }
    return hex;
  }

  /** Decode a hex byte string to UTF-8 text ("" for empty). */
  function hexToUtf8(hex) {
    var s = stripHex(hex);
    if (s.length % 2 !== 0) s = s.slice(0, -1);
    var bytes = [];
    for (var i = 0; i < s.length; i += 2) bytes.push(parseInt(s.slice(i, i + 2), 16));
    var out = '';
    for (var j = 0; j < bytes.length; j++) {
      var b = bytes[j];
      if (b < 0x80) out += String.fromCharCode(b);
      else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++j] & 0x3f));
      else if (b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[++j] & 0x3f) << 6) | (bytes[++j] & 0x3f));
      } else {
        var cp = ((b & 0x07) << 18) | ((bytes[++j] & 0x3f) << 12) | ((bytes[++j] & 0x3f) << 6) | (bytes[++j] & 0x3f);
        out += String.fromCodePoint(cp);
      }
    }
    return out;
  }

  /** Split a hex result into 32-byte words (array of 64-char hex, no 0x). */
  function wordsOf(hexResult) {
    var s = stripHex(hexResult || '');
    if (s === '') return [];
    s = s.padEnd(Math.ceil(s.length / 64) * 64, '0');
    var out = [];
    for (var i = 0; i < s.length; i += 64) out.push(s.slice(i, i + 64));
    return out;
  }

  function wordInt(word) { // 64-hex word → BigInt
    return BigInt('0x' + word);
  }

  /**
   * Decode one ABI dynamic `string` from an eth_call result.
   * Handles the standard [offset][len][data…] encoding; "" for empty.
   */
  function decodeString(hexResult) {
    var w = wordsOf(hexResult);
    if (!w.length) return '';
    var dataStart = Number(wordInt(w[0])) / 32;
    var len = Number(wordInt(w[dataStart] || '00'));
    if (!len) return '';
    var take = Math.ceil(len / 32);
    var dataHex = w.slice(dataStart + 1, dataStart + 1 + take).join('').slice(0, len * 2);
    return hexToUtf8(dataHex);
  }

  /**
   * Decode an ABI dynamic `string[]` from an eth_call result.
   * Returns [] for empty payloads.
   */
  function decodeStringArray(hexResult) {
    var w = wordsOf(hexResult);
    if (!w.length) return [];
    var arrStart = Number(wordInt(w[0])) / 32;          // word of the length
    var len = Number(wordInt(w[arrStart] || '00'));
    if (!len) return [];
    var base = arrStart + 1;                            // first element-offset word
    var out = [];
    for (var i = 0; i < len; i++) {
      var rel = Number(wordInt(w[base + i] || '00')) / 32; // offset relative to base
      var el = base + rel;                                 // word of the element length
      var elen = Number(wordInt(w[el] || '00'));
      if (!elen) { out.push(''); continue; }
      var take = Math.ceil(elen / 32);
      var dataHex = w.slice(el + 1, el + 1 + take).join('').slice(0, elen * 2);
      out.push(hexToUtf8(dataHex));
    }
    return out;
  }

  /** ABI-encode a dynamic string arg's [len][data] region (no offset head). */
  function stringDataHex(str) {
    var data = utf8ToHex(str);
    var byteLen = data.length / 2;
    return byteLen.toString(16).padStart(64, '0') + data.padEnd(Math.ceil(byteLen / 32) * 64, '0');
  }

  /** ABI-encode an address as one 32-byte word. */
  function addressWordHex(addr) {
    var a = String(addr || '').replace(/^0x/i, '');
    return a.toLowerCase().padStart(64, '0');
  }

  /**
   * Minimal multi-arg ABI encoder for the registry's v2 surface.
   * parts: [{ type: 'string'|'address', value }] — offsets are computed per
   * the canonical head/data layout. Returns hex WITHOUT a selector.
   */
  function encodeArgs(parts) {
    var n = parts.length;
    var head = new Array(n);
    var dataChunks = [];
    var cum = 0; // bytes of dynamic data so far
    for (var i = 0; i < n; i++) {
      if (parts[i].type === 'string') {
        head[i] = (n * 32 + cum).toString(16).padStart(64, '0');
        var d = stringDataHex(parts[i].value == null ? '' : parts[i].value);
        dataChunks.push(d);
        cum += d.length / 2;
      }
    }
    var out = '';
    for (var j = 0; j < n; j++) {
      var p = parts[j];
      if (p.type === 'address') out += addressWordHex(p.value);
      else out += head[j];
    }
    return out + dataChunks.join('');
  }

  /** Selector + encoded args → full calldata. */
  function callDataArgs(selector, parts) {
    return selector + encodeArgs(parts);
  }

  /** Selector + one address argument (primaryName / namesOf). */
  function callDataAddress(selector, addr) {
    return selector + addressWordHex(addr);
  }

  /**
   * Minimal ABI encoder for dynamic `string` arguments (single or multiple),
   * sufficient for the registry's public interface. Each returned chunk is a
   * padded 32-byte word (without '0x').
   */
  function encodeStringArg(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
      else { bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
    }
    var lenHex = bytes.length.toString(16).padStart(64, '0');
    var dataHex = bytes.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    dataHex = dataHex.padEnd(64, '0'); // pad to a full word
    // Solidity encodes a single dynamic arg as: [offset=0x20][len][data…]
    return '0x' + '20'.padStart(64, '0') + lenHex + dataHex;
  }

  /** Build calldata for `selector` + one dynamic string arg. */
  function callDataString(selector, str) {
    return selector + encodeStringArg(str).slice(2);
  }

  /** Encode a uint256 (price) as a call-data value word. */
  function encodeUint(valueBigInt) {
    return padBytes32(valueBigInt.toString(16));
  }

  function decodeBool(hexResult) {
    return hexToBigInt(hexResult) > 0n;
  }

  function decodeAddress(hexResult) {
    var s = stripHex(hexResult);
    if (s.length < 40) return '0x0000000000000000000000000000000000000000';
    return '0x' + s.slice(-40);
  }

  function decodeUintBig(hexResult) {
    return hexToBigInt(hexResult);
  }

  function isZeroAddress(a) {
    return /^0x0+$/.test(String(a || ''));
  }

  /* ───────────────────────── misc ───────────────────────── */

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function truncateMiddle(str, max) {
    if (!str || str.length <= (max || 16)) return str;
    var m = max || 16;
    return str.slice(0, Math.ceil(m / 2) - 1) + '…' + str.slice(-Math.floor(m / 2) + 1);
  }

  var ArcCore = {
    normalizeName: normalizeName,
    validateName: validateName,
    NAME_RE: NAME_RE,
    stripHex: stripHex,
    hexToBigInt: hexToBigInt,
    bigIntToHex: bigIntToHex,
    hexToNumber: hexToNumber,
    formatUnits: formatUnits,
    formatGwei: formatGwei,
    shortAddress: shortAddress,
    rpcCall: rpcCall,
    rpcCalls: rpcCalls,
    SELECTORS: SELECTORS,
    encodeStringArg: encodeStringArg,
    callDataString: callDataString,
    encodeUint: encodeUint,
    decodeBool: decodeBool,
    decodeAddress: decodeAddress,
    decodeUintBig: decodeUintBig,
    isZeroAddress: isZeroAddress,
    // v2 · resolver helpers
    utf8ToHex: utf8ToHex,
    hexToUtf8: hexToUtf8,
    stringDataHex: stringDataHex,
    addressWordHex: addressWordHex,
    encodeArgs: encodeArgs,
    callDataArgs: callDataArgs,
    callDataAddress: callDataAddress,
    decodeString: decodeString,
    decodeStringArray: decodeStringArray,
    sleep: sleep,
    truncateMiddle: truncateMiddle
  };

  root.ArcCore = ArcCore;
})(typeof window !== 'undefined' ? window : globalThis);
