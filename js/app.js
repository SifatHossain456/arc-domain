/**
 * ArcName — application glue.
 * Wire-up for telemetry, wallet (EIP-1193) and the registry console.
 * No fake data: every number is fetched live or shown as an explicit
 * loading / error / offline state.
 */
(function () {
  'use strict';

  var CFG = window.ARC_CONFIG;
  var C = window.ArcCore;
  var CHAIN = CFG.chain;

  /* ───────────────────────── tiny DOM helpers ───────────────────────── */

  function $(id) { return document.getElementById(id); }

  function setText(id, txt) {
    var el = $(id);
    if (el) el.textContent = txt == null ? '' : txt;
  }

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  var ICONS = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
  };

  /* ───────────────────────── state ───────────────────────── */

  var state = {
    telemetry: { ok: false, lastGood: null },
    stats: { ok: false, lastGood: null, data: null },
    wallet: { address: null, chainId: null, balanceRaw: null, busy: false },
    reg: { priceRaw: 0n, priceLoaded: false, totalNames: null },
    inFlight: { telemetry: false, search: false, stats: false },
    session: [] // { name, txHash, ts } — real, confirmed transactions only
  };

  /* ───────────────────────── formatting helpers ───────────────────────── */

  function fmtBlock(hex) {
    var n = C.hexToNumber(hex);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US');
  }

  function fmtCompact(hex) {
    var n = C.hexToNumber(hex);
    if (!isFinite(n)) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.?0+$/, '') + 'k';
    return String(n);
  }

  function usdcPerGas(hexGas) {
    var g = C.hexToBigInt(hexGas);
    // gas price is already 18-dec USDC-denominated wei per gas unit
    var f = C.formatUnits(g, 18);
    return f.display; // e.g. 0.000000025
  }

  function setLiveDot(dotEl, on) {
    if (!dotEl) return;
    dotEl.classList.toggle('dot--live', !!on);
    dotEl.classList.toggle('dot--off', !on);
  }

  function explorerUrl() { return CHAIN.blockExplorerUrl; }

  /* ═══════════════════════════════════════════════════════════════════
     1 · LIVE TELEMETRY (block / chain / gas, ~10 s loop)
     ═══════════════════════════════════════════════════════════════════ */

  function tickTelemetry(manual) {
    if (state.inFlight.telemetry) return Promise.resolve();
    state.inFlight.telemetry = true;
    if (manual) {
      var ic = $('netRefreshIcon');
      if (ic) ic.classList.add('spinning');
    }
    return C.rpcCalls([
      { method: 'eth_blockNumber', params: [] },
      { method: 'eth_chainId', params: [] },
      { method: 'eth_gasPrice', params: [] }
    ]).then(function (res) {
      var by = {};
      res.forEach(function (r) { by[r.method] = r; });
      var okCount = res.filter(function (r) { return r.ok; }).length;
      var live = okCount === res.length;
      state.telemetry.ok = live;
      state.telemetry.lastGood = live ? Date.now() : state.telemetry.lastGood;

      var block = by.eth_blockNumber;
      var chain = by.eth_chainId;
      var gas = by.eth_gasPrice;

      // block
      setText('netBlock', block && block.ok ? fmtBlock(block.value) : '—');
      setText('heroBlock', block && block.ok ? fmtCompact(block.value) : '—');
      setText('ringBlock', block && block.ok ? fmtCompact(block.value) : '—');
      setText('navBlock', block && block.ok ? fmtCompact(block.value) : '—');

      // chain
      var chainDec = chain && chain.ok ? String(C.hexToNumber(chain.value)) : '—';
      setText('netChain', chainDec);
      setText('heroChain', chainDec);
      setText('ringChain', chainDec);
      setText('netChainHex', chain && chain.ok ? 'hex 0x' + C.stripHex(chain.value).toUpperCase() : 'hex —');

      // gas
      if (gas && gas.ok) {
        setText('netGas', C.formatGwei(gas.value));
        setText('heroGas', C.formatGwei(gas.value));
        setText('ringGas', C.formatGwei(gas.value));
        setText('netGasUsdc', '≈ ' + usdcPerGas(gas.value) + ' USDC per gas unit');
      } else {
        setText('netGas', '—');
        setText('heroGas', '—');
        setText('ringGas', '—');
        setText('netGasUsdc', 'unavailable');
      }

      // latency + endpoint (from whichever succeeded)
      var okRes = res.filter(function (r) { return r.ok; });
      var lat = okRes.length ? Math.round(okRes.reduce(function (a, r) { return a + r.latencyMs; }, 0) / okRes.length) : null;
      var ep = block && block.ok ? block.endpoint : (okRes.length ? okRes[0].endpoint : null);
      if (ep) {
        ep = ep.replace(/^https?:\/\//, '').replace(/\/$/, '');
        setText('netEndpoint', 'via ' + ep);
      } else {
        setText('netEndpoint', 'no endpoint reachable');
      }

      setText('netUpdated', 'updated ' + new Date().toLocaleTimeString());
      setText('netLatencyLat', lat == null ? '—' : lat + ' ms');

      // status line + dots
      var line = $('netStatusLine');
      var dots = [document.getElementById('netDot'), document.getElementById('heroDot'), document.getElementById('navDot')];
      if (live) {
        setText('netStateText', 'Live');
        setText('netStatusLine', 'Live — Arc testnet RPC responding' + (lat != null ? ' (' + lat + ' ms)' : ''));
        setText('netRefreshHint', 'auto-refreshes every ' + (CFG.telemetryMs / 1000) + ' s · ' + new Date().toLocaleTimeString());
        hide($('offlineBanner'));
        dots.forEach(function (d) { setLiveDot(d, true); });
      } else if (okCount === 0) {
        setText('netStateText', 'Offline');
        if (line) line.innerHTML = '<b style="color:var(--err)">Offline</b> — Arc testnet RPC unreachable. Retrying automatically…';
        setText('netRefreshHint', '');
        show($('offlineBanner'));
        dots.forEach(function (d) { setLiveDot(d, false); });
      } else {
        setText('netStateText', 'Degraded');
        if (line) line.innerHTML = '<b style="color:var(--warn)">Degraded</b> — ' + (res.length - okCount) + ' of ' + res.length + ' RPC calls failed. Retrying…';
        setText('netRefreshHint', '');
        dots.forEach(function (d) { setLiveDot(d, false); });
      }
      return state.telemetry;
    }).finally(function () {
      state.inFlight.telemetry = false;
      if (manual) {
        var ic2 = $('netRefreshIcon');
        if (ic2) ic2.classList.remove('spinning');
      }
    });
  }

  function startTelemetry() {
    tickTelemetry();
    setInterval(function () { tickTelemetry(); }, CFG.telemetryMs);
  }

  /* ═══════════════════════════════════════════════════════════════════
     2 · WALLET (EIP-1193 + addEthereumChain)
     ═══════════════════════════════════════════════════════════════════ */

  function provider() {
    if (window.ethereum) return window.ethereum;
    return null;
  }

  function renderWallet() {
    var p = provider();
    var w = state.wallet;

    // My Names dashboard mirrors the wallet + registry state
    renderMyNames();

    // nav button
    if (w.address) {
      setText('connectBtnLabel', C.shortAddress(w.address));
    } else {
      setText('connectBtnLabel', 'Connect');
    }

    if (!p) {
      show($('walletUnsupported'));
      hide($('walletConnectView'));
      hide($('walletConnectedView'));
      setText('walletBadgeText', 'No wallet');
      setLiveDot($('walletDot'), false);
      return;
    }

    hide($('walletUnsupported'));
    if (w.address) {
      hide($('walletConnectView'));
      show($('walletConnectedView'));
      setText('walletBadgeText', 'Connected');
      setLiveDot($('walletDot'), true);
      setText('walletAddr', w.address);
      setText('walletChainId', w.chainId ? 'Arc Testnet · ' + w.chainId : '—');

      var correct = w.chainId === CHAIN.chainId;
      var chip = $('walletNetworkChip');
      if (chip) {
        chip.textContent = correct ? '✓ on Arc testnet' : 'wrong network';
        chip.style.borderColor = correct ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.4)';
        chip.style.color = correct ? '#6ee7b7' : '#fde68a';
      }
      if ($('walletChainWarn')) $('walletChainWarn').classList.toggle('show', !correct);

      // explorer link
      var accLink = $('walletExplorerLink');
      if (accLink) {
        accLink.href = explorerUrl() + '/address/' + w.address;
        accLink.target = '_blank';
      }

      if (correct) {
        refreshBalance();
      } else {
        setText('walletBalance', '—');
      }
    } else {
      hide($('walletConnectedView'));
      show($('walletConnectView'));
      setText('walletBadgeText', 'Awaiting wallet');
      setLiveDot($('walletDot'), false);
    }
  }

  function ensureArcChain() {
    var p = provider();
    if (!p) return Promise.reject(new Error('no-provider'));
    var params = [{ chainId: CHAIN.chainIdHex }];
    return p.request({ method: 'wallet_switchEthereumChain', params: params }).then(function () {
      return CHAIN.chainId;
    }).catch(function (err) {
      // 4902 = chain not added yet; also some wallets use -32603 / "Unrecognized chain"
      var needAdd = (err && (err.code === 4902 || err.code === -32603)) ||
        /unrecognized|not.*added|does not exist/i.test((err && err.message) || '');
      if (!needAdd) throw err;
      return p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: CHAIN.chainIdHex,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: CHAIN.rpcUrls,
          blockExplorerUrls: [CHAIN.blockExplorerUrl]
        }]
      }).then(function () {
        return p.request({ method: 'wallet_switchEthereumChain', params: params });
      }).then(function () { return CHAIN.chainId; });
    });
  }

  function showWalletError(msg) {
    var box = $('walletError');
    if (!box) return;
    box.textContent = msg;
    box.classList.add('show');
    setTimeout(function () { box.classList.remove('show'); }, 8000);
  }

  function refreshBalance() {
    var w = state.wallet;
    if (!w.address || w.chainId !== CHAIN.chainId) return Promise.resolve();
    return C.rpcCall('eth_getBalance', [w.address, 'latest'])
      .then(function (r) {
        w.balanceRaw = r.result;
        var fmt = C.formatUnits(r.result, CHAIN.nativeCurrency.decimals);
        setText('walletBalance', fmt.display + ' USDC');
        var el = $('walletBalance');
        if (el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
        return r;
      })
      .catch(function () {
        setText('walletBalance', 'unavailable — RPC offline');
      });
  }

  function walletConnect() {
    var w = state.wallet;
    var p = provider();
    if (!p) {
      renderWallet();
      return Promise.resolve();
    }
    if (w.busy) return Promise.resolve();
    w.busy = true;
    var lbl = $('connectWalletLabel');
    if (lbl) lbl.textContent = 'Connecting…';
    var navLbl = $('connectBtnLabel');
    var oldNav = navLbl ? navLbl.textContent : '';
    if (navLbl) navLbl.textContent = 'Connecting…';
    hide($('walletError'));

    var finalize = function (address, chainId) {
      w.address = address;
      w.chainId = chainId;
      renderWallet();
      return { address: address, chainId: chainId };
    };

    return p.request({ method: 'eth_requestAccounts' })
      .then(function (accs) {
        if (!accs || !accs.length) throw { code: 4001, message: 'No account returned.' };
        return ensureArcChain().then(function (chainId) {
          return finalize(accs[0], chainId);
        });
      })
      .catch(function (err) {
        if (err && err.code === 4001) {
          showWalletError('Request rejected in your wallet — nothing happened.');
        } else if (err && err.code === -32002) {
          showWalletError('A connection request is already pending — check your wallet.');
        } else if (err && /no-provider/.test(err.message || '')) {
          renderWallet();
        } else {
          var msg = (err && err.message) || 'Connection failed.';
          if (/switch|addEthereumChain|network/i.test(msg)) {
            showWalletError('Could not switch to Arc Testnet: ' + msg);
          } else {
            showWalletError('Connection failed: ' + msg);
          }
        }
        throw err;
      })
      .finally(function () {
        w.busy = false;
        if (lbl) lbl.textContent = 'Connect wallet';
        if (navLbl) navLbl.textContent = w.address ? C.shortAddress(w.address) : oldNav;
      });
  }

  function walletDisconnect() {
    state.wallet.address = null;
    state.wallet.chainId = null;
    state.wallet.balanceRaw = null;
    hide($('walletChainWarn'));
    renderWallet();
  }

  /* ═══════════════════════════════════════════════════════════════════
     3 · REGISTRY CONSOLE (search → availability → register TX)
     ═══════════════════════════════════════════════════════════════════ */

  var REG_ADDR = String(CFG.registryAddress || '').trim().toLowerCase();
  var hasRegistry = /^0x[0-9a-f]{40}$/.test(REG_ADDR);

  // Arc gas rules (verified): EIP-1559 type-2 only, maxFeePerGas >= 20 gwei
  // floor, priority tip 0–1 gwei. Native gas = USDC (18 decimals).
  var GWEI = 1000000000n;
  var TX_FEE_FLOOR = BigInt((CFG.txFees && CFG.txFees.maxFeeFloorGwei) || 20) * GWEI;
  var TX_TIP = BigInt((CFG.txFees && CFG.txFees.tipGwei) || 1) * GWEI;
  var STATS_CFG = CFG.stats || {};
  var SIMPLE_TX_GAS = Number(STATS_CFG.simpleTransferGas || 21000);

  function suffix() { return CFG.displaySuffix || ''; }

  function registryCall(data) {
    return C.rpcCall('eth_call', [{ to: REG_ADDR, data: data }, 'latest']);
  }

  function renderRegistryUI() {
    var live = hasRegistry;
    // gate vs live bar
    var gate = $('regGate');
    var bar = $('regLivebar');
    if (gate) gate.classList.toggle('show', !live);
    if (bar) bar.hidden = !live;

    var badge = $('consoleBadge');
    var badgeTxt = $('consoleBadgeText');
    var dot = $('consoleDot');
    if (!live) {
      if (badge) badge.classList.remove('live');
      if (badgeTxt) badgeTxt.textContent = 'Needs deployment';
      if (dot) setLiveDot(dot, false);
      if ($('regConsoleSub')) $('regConsoleSub').textContent = 'ArcName Registry — awaiting deployment';
    } else {
      if (badge) badge.classList.add('live');
      if (badgeTxt) badgeTxt.textContent = 'Registry live';
      if (dot) setLiveDot(dot, true);
      if ($('regConsoleSub')) $('regConsoleSub').textContent = 'ArcName Registry · ' + REG_ADDR.slice(0, 8) + '…' + REG_ADDR.slice(-6);
      if ($('regAddr')) { $('regAddr').textContent = REG_ADDR.slice(0, 8) + '…' + REG_ADDR.slice(-6); $('regAddr').title = REG_ADDR; }
      loadRegistryMeta();
    }

    // Resolver console mirrors the same deploy gate
    var rGate = $('resolveGate');
    var rBadge = $('resolveBadge');
    var rBadgeTxt = $('resolveBadgeText');
    var rDot = $('resolveDot');
    if (rGate) rGate.classList.toggle('show', !live);
    if (!live) {
      if (rBadge) rBadge.classList.remove('live');
      if (rBadgeTxt) rBadgeTxt.textContent = 'Needs deployment';
      if (rDot) setLiveDot(rDot, false);
    } else {
      if (rBadge) rBadge.classList.add('live');
      if (rBadgeTxt) rBadgeTxt.textContent = 'Registry live';
      if (rDot) setLiveDot(rDot, true);
    }

    // My Names dashboard state (wallet + registry gating)
    renderMyNames();
  }

  function loadRegistryMeta() {
    if (!hasRegistry) return;
    // totalNames() + price() in parallel
    Promise.all([
      C.rpcCall('eth_call', [{ to: REG_ADDR, data: C.SELECTORS.totalNames }, 'latest'])
        .then(function (r) { state.reg.totalNames = C.hexToNumber(r.result); })
        .catch(function () { state.reg.totalNames = null; }),
      C.rpcCall('eth_call', [{ to: REG_ADDR, data: C.SELECTORS.price }, 'latest'])
        .then(function (r) {
          state.reg.priceRaw = C.decodeUintBig(r.result);
          state.reg.priceLoaded = true;
        })
        .catch(function () { state.reg.priceLoaded = false; })
    ]).then(function () {
      var names = state.reg.totalNames;
      setText('regNames', names == null ? '—' : String(names));
      if (state.reg.priceLoaded) {
        var zero = state.reg.priceRaw === 0n;
        setText('regPrice', zero ? 'Free' : C.formatUnits(state.reg.priceRaw, CHAIN.nativeCurrency.decimals).display + ' USDC');
      } else {
        setText('regPrice', '—');
      }
    });
  }

  function showPanel(name) {
    var map = { loading: 'panelLoading', available: 'panelAvailable', taken: 'panelTaken', error: 'panelRegError', tx: 'panelTx' };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (el) el.classList.toggle('show', k === name);
    });
  }

  function hint(msg, kind) {
    var el = $('nameHint');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hint--err', kind === 'err');
    el.classList.toggle('hint--ok', kind === 'ok');
  }

  function priceCopy() {
    if (!state.reg.priceLoaded) return '';
    if (state.reg.priceRaw === 0n) {
      return 'this registry charges no fee — you only pay Arc gas in USDC.';
    }
    return 'registry fee ' + C.formatUnits(state.reg.priceRaw, CHAIN.nativeCurrency.decimals).display + ' USDC + Arc gas (USDC).';
  }

  function registerValueHex() {
    return state.reg.priceLoaded && state.reg.priceRaw > 0n ? C.bigIntToHex(state.reg.priceRaw) : '0x0';
  }

  function handleSearch() {
    var v = C.validateName($('nameInput').value);
    hint('', null);
    if (!v.ok) {
      hint(v.reason, 'err');
      showPanel('');
      return;
    }
    if (!hasRegistry) {
      hint('Registration engine not deployed — deploy the registry first (panel above).', 'err');
      var gate = $('regGate');
      if (gate) { gate.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      showPanel('');
      return;
    }
    if (state.inFlight.search) return;
    state.inFlight.search = true;
    showPanel('loading');
    setText('availName', v.name + suffix());
    setText('takenName', v.name + suffix());

    registryCall(C.callDataString(C.SELECTORS.isAvailable, v.name))
      .then(function (r) {
        var raw = String(r.result || '0x');
        if (raw === '0x' || raw === '') throw { code: 'NO_CODE', message: 'No contract found at the configured registry address (' + REG_ADDR + '). Check REGISTRY_ADDRESS in js/config.js.' };
        if (C.decodeBool(raw)) {
          // available
          showPanel('available');
          var meta = 'Checked onchain — nobody owns it yet. ' + (priceCopy() ? 'To register: ' + priceCopy() : '');
          setText('availMeta', meta);
          setText('registerBtnLabel', 'Register ' + v.name + suffix());
          var connected = !!(state.wallet.address && state.wallet.chainId === CHAIN.chainId);
          var rb = $('registerBtn');
          var rc = $('registerCtaWallet');
          if (rb) rb.hidden = connected;
          if (rc) rc.hidden = connected;
          if (connected) {
            hint(v.name + suffix() + ' is available and ready to register.', 'ok');
          } else {
            hint('Connect your wallet on Arc testnet to register.', 'err');
          }
          // Fee-aware estimate before you confirm (EIP-1559, 20 gwei floor).
          setText('availHint', '');
          if (connected) {
            quoteForRegister(v.name, registerValueHex()).then(function (q) {
              setText('availHint', q.text ? 'Fee estimate: ' + q.text : '');
            }).catch(function () {});
          }
        } else {
          // taken → fetch owner
          registryCall(C.callDataString(C.SELECTORS.ownerOf, v.name))
            .then(function (r2) {
              var owner = C.decodeAddress(r2.result);
              setText('takenOwner', owner);
              var link = $('takenOwnerLink');
              if (link) link.href = explorerUrl() + '/address/' + owner;
              showPanel('taken');
              hint(v.name + suffix() + ' is already registered.', 'err');
            })
            .catch(function () {
              showPanel('taken');
              setText('takenOwner', 'unknown (read failed)');
              hint(v.name + suffix() + ' appears registered, but the owner lookup failed.', 'err');
            });
        }
      })
      .catch(function (err) {
        showPanel('error');
        setText('panelRegErrorMsg', err && err.code === 'NO_CODE' ? err.message : 'Availability check failed: ' + ((err && err.message) || 'RPC error') + ' — is the RPC reachable?');
      })
      .finally(function () { state.inFlight.search = false; });
  }

  function setSteps(sign, pend, done) {
    function apply(el, st) {
      if (!el) return;
      el.classList.remove('active', 'done');
      if (st === 1) el.classList.add('active');
      if (st === 2) el.classList.add('done');
    }
    apply($('stepSign'), sign);
    apply($('stepPending'), pend);
    apply($('stepDone'), done);
  }

  function doRegister() {
    var v = C.validateName($('nameInput').value);
    if (!v.ok || !hasRegistry) return;
    if (!state.wallet.address) {
      var rc = $('registerCtaWallet');
      if (rc) { rc.hidden = false; }
      hint('Connect your wallet first.', 'err');
      $('wallet').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (state.wallet.chainId !== CHAIN.chainId) {
      $('walletChainWarn').classList.add('show');
      hint('Your wallet is on the wrong network — switch to Arc Testnet.', 'err');
      $('wallet').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    var p = provider();
    if (!p) return;

    var name = v.name;
    var valueHex = registerValueHex();
    var data = C.callDataString(C.SELECTORS.register, name);

    hide($('registerBtn'));
    showPanel('tx');
    setSteps(1, 0, 0);
    setText('stepSignTitle', 'Confirm registration of ' + name + suffix());
    var feeWrap = $('feeEstWrap');
    if (feeWrap) feeWrap.hidden = false;
    setText('feeEstText', 'Estimating gas on Arc…');
    $('txAnotherBtn').hidden = true;
    $('panelTx').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Fee-aware tx: quote EIP-1559 fees (maxFeePerGas >= 20 gwei, tip 1 gwei)
    // and estimate gas, show the USDC fee before the wallet prompt, then send
    // with explicit fee caps. Never blocks on the quote — if it fails, the
    // wallet estimates and the UI says so honestly.
    quoteForRegister(name, valueHex).then(function (q) {
      setText('feeEstText', q.text || 'Fee estimate unavailable — your wallet will price the gas.');
      var params = { from: state.wallet.address, to: REG_ADDR, value: valueHex, data: data };
      if (q.params.maxFeePerGas) {
        params.maxFeePerGas = q.params.maxFeePerGas;
        params.maxPriorityFeePerGas = q.params.maxPriorityFeePerGas;
      }
      return p.request({ method: 'eth_sendTransaction', params: [params] });
    }).then(function (txHash) {
      // signed & broadcast
      setSteps(2, 1, 0);
      setText('txHash', txHash);
      var link = $('txExplorer');
      if (link) { link.href = explorerUrl() + '/tx/' + txHash; link.target = '_blank'; }
      return pollReceipt(txHash, name);
    }).then(function (receipt) {
      var status = String(receipt.status || '0x0');
      if (status !== '0x1') {
        throw { code: 'REVERTED', message: 'The transaction was included but reverted onchain. Check the registry contract.' };
      }
      // success
      setSteps(2, 2, 1);
      setText('stepDoneTitle', name + suffix() + ' is now yours on Arc');
      setText('stepDoneSub', 'Registration confirmed in block ' + fmtBlock(receipt.blockNumber) + ' · ' + new Date().toLocaleTimeString());
      addSession(name, receipt.transactionHash);
      loadRegistryMeta();
      $('txAnotherBtn').hidden = false;
    }).catch(function (err) {
      var code = err && err.code;
      var msg = (err && err.message) || '';
      showPanel('error');
      if (code === 4001) {
        setText('panelRegErrorMsg', 'You rejected the transaction in your wallet — nothing was sent. You can try again anytime.');
      } else if (code === 'REVERTED') {
        setText('panelRegErrorMsg', msg);
      } else if (/insufficient funds/i.test(msg)) {
        setText('panelRegErrorMsg', 'Insufficient USDC balance for the registry fee + gas. Grab test USDC from the faucet and retry.');
      } else {
        setText('panelRegErrorMsg', 'Registration failed: ' + msg);
      }
    });
  }

  function pollReceipt(txHash, name) {
    var waited = 0;
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        if (Date.now() - start > CFG.receiptTimeoutMs) {
          reject(new Error('Transaction ' + txHash + ' was broadcast but not confirmed within ' + (CFG.receiptTimeoutMs / 1000) + 's. Check it on ArcScan — nothing is assumed.'));
          return;
        }
        C.rpcCall('eth_getTransactionReceipt', [txHash])
          .then(function (r) {
            if (r.result && r.result.blockNumber) { resolve(r.result); return; }
            waited += CFG.receiptPollMs;
            setTimeout(poll, CFG.receiptPollMs);
          })
          .catch(function () {
            setTimeout(poll, CFG.receiptPollMs);
          });
      })();
    });
  }

  function addSession(name, txHash) {
    state.session.unshift({ name: name, txHash: txHash, ts: new Date() });
    var wrap = $('sessWrap');
    var list = $('sessionList');
    if (!wrap || !list) return;
    show(wrap);
    var item = document.createElement('div');
    item.className = 'sess-item';
    item.innerHTML =
      '<span class="ok-dot">' + ICONS.check + '</span>' +
      '<span class="nm mono">' + name + suffix() + '</span>' +
      '<span class="when">' + new Date().toLocaleTimeString() + '</span>' +
      '<a class="link lnk mono" href="' + explorerUrl() + '/tx/' + txHash + '" target="_blank" rel="noopener noreferrer">' + C.shortAddress(txHash, 8, 6) + '</a>';
    list.insertBefore(item, list.firstChild);
  }

  function resetConsole() {
    hint('', null);
    showPanel('');
  }

  /* ═══════════════════════════════════════════════════════════════════
     3.5 · FEE-AWARE TX (EIP-1559 on Arc) + NETWORK STATS (Blockscout)
     ═══════════════════════════════════════════════════════════════════ */

  function fmtGweiNum(weiBig) {
    return (Number(weiBig) / 1e9).toFixed(2).replace(/\.?0+$/, '');
  }

  /**
   * Quote current Arc gas from eth_feeHistory (base fee of the newest sampled
   * block). Falls back to eth_gasPrice when feeHistory is unavailable. Returns
   * null only when the RPC itself is unreachable — callers then let the wallet
   * decide the fees (never blocking the user on an estimate).
   */
  function fetchFeeQuote() {
    function fromGasPrice() {
      return C.rpcCall('eth_gasPrice', [])
        .then(function (r) {
          return { baseFee: C.hexToBigInt(r.result), tip: TX_TIP, floor: TX_FEE_FLOOR };
        })
        .catch(function () { return null; });
    }
    return C.rpcCall('eth_feeHistory', ['0x5', 'latest', []])
      .then(function (r) {
        var bf = (r && r.result && r.result.baseFeePerGas) || [];
        if (!bf.length) throw new Error('no baseFeePerGas in feeHistory');
        return { baseFee: C.hexToBigInt(bf[bf.length - 1]), tip: TX_TIP, floor: TX_FEE_FLOOR };
      })
      .catch(fromGasPrice);
  }

  /** EIP-1559 type-2 params honouring Arc: maxFeePerGas >= 20 gwei, tip 1 gwei. */
  function feeParamsFromQuote(q) {
    if (!q) return null;
    var cap = q.baseFee * 2n + q.tip;
    if (cap < q.floor) cap = q.floor; // Arc's hard floor
    return {
      maxFeePerGas: cap,
      maxPriorityFeePerGas: q.tip,
      effectivePerGas: q.baseFee + q.tip, // realistically paid per gas unit
      baseFee: q.baseFee
    };
  }

  /** eth_estimateGas for the exact register call (null when it cannot be simulated). */
  function estimateRegisterGas(name, valueHex) {
    if (!state.wallet.address) return Promise.resolve(null);
    var data = C.callDataString(C.SELECTORS.register, name);
    return C.rpcCall('eth_estimateGas', [{
      from: state.wallet.address,
      to: REG_ADDR,
      value: valueHex || '0x0',
      data: data
    }]).then(function (r) {
      var g = C.hexToBigInt(r.result);
      return g > 0n ? g : null;
    }).catch(function () { return null; });
  }

  /** "≈ $0.000041 USDC total gas · 68,000 gas @ 0.6 gwei + 1 tip (cap 20)" */
  function feeLineText(fp, gasUnits) {
    if (!fp || gasUnits == null) return null;
    var totalWei = gasUnits * fp.effectivePerGas;
    var usdc = C.formatUnits(totalWei, 18).display;
    return '≈ $' + usdc + ' USDC total gas · ' + gasUnits.toString() + ' gas @ ' +
      fmtGweiNum(fp.effectivePerGas) + ' gwei + 1 tip (cap ' + fmtGweiNum(fp.maxFeePerGas) + ' gwei)';
  }

  /**
   * Full fee-aware prep for a register tx: resolves to { text, params }.
   * params carries hex maxFeePerGas/maxPriorityFeePerGas when a quote exists.
   */
  function quoteForRegister(name, valueHex) {
    var quote = Promise.all([fetchFeeQuote(), estimateRegisterGas(name, valueHex)])
      .then(function (pair) {
        var fp = feeParamsFromQuote(pair[0]);
        var gasUnits = pair[1];
        var out = { text: feeLineText(fp, gasUnits), params: {} };
        if (fp) {
          out.params.maxFeePerGas = C.bigIntToHex(fp.maxFeePerGas);
          out.params.maxPriorityFeePerGas = C.bigIntToHex(fp.maxPriorityFeePerGas);
        }
        return out;
      });
    // Never stall the wallet prompt on slow RPCs: after 6 s proceed fee-less.
    var bail = new Promise(function (resolve) {
      setTimeout(function () { resolve({ text: null, params: {} }); }, 6000);
    });
    return Promise.race([quote, bail]);
  }

  /* ── Network stats panel (Blockscout REST API, ~15 s cadence) ── */

  function fmtIntStat(v) {
    var n = Number(v);
    return isFinite(n) ? n.toLocaleString('en-US') : '—';
  }

  /** Cost of a 21,000-gas transfer at gwei price, in USDC (~$1). */
  function fmtUsdPerTransfer(gweiNum) {
    var n = Number(gweiNum);
    if (!isFinite(n)) return '—';
    var usd = (n * SIMPLE_TX_GAS) / 1e9; // gwei·1e9 wei/gas · 21000 gas / 1e18
    var s = usd.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    return '$' + (s === '-0' ? '0' : s);
  }

  function fmtPctStat(v) {
    var n = Number(v);
    return isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : '—';
  }

  function fmtAvgBlockTime(ms) {
    var n = Number(ms);
    if (!isFinite(n)) return '—';
    var s = n / 1000;
    return s.toFixed(s < 10 ? 2 : 1).replace(/\.?0+$/, '') + ' s';
  }

  var STAT_IDS = ['statsGasSlow', 'statsGasAvg', 'statsGasFast', 'statsTxToday',
    'statsAddr', 'statsTotalTx', 'statsUtil', 'statsAvgBlock'];
  var STAT_USD_IDS = ['statsGasSlowUsd', 'statsGasAvgUsd', 'statsGasFastUsd'];

  function renderStats(s) {
    var gp = s.gas_prices || {};
    function setGas(id, usdId, v) {
      if (v == null) { setText(id, '—'); setText(usdId, '—'); return; }
      setText(id, Number(v).toFixed(2).replace(/\.?0+$/, ''));
      setText(usdId, '≈ ' + fmtUsdPerTransfer(v) + ' per transfer');
    }
    setGas('statsGasSlow', 'statsGasSlowUsd', gp.slow);
    setGas('statsGasAvg', 'statsGasAvgUsd', gp.average);
    setGas('statsGasFast', 'statsGasFastUsd', gp.fast);
    setText('statsTxToday', fmtIntStat(s.transactions_today));
    setText('statsAddr', fmtIntStat(s.total_addresses));
    setText('statsTotalTx', fmtIntStat(s.total_transactions));
    setText('statsUtil', fmtPctStat(s.network_utilization_percentage));
    setText('statsAvgBlock', fmtAvgBlockTime(s.average_block_time));
  }

  function statsOffline(msg) {
    setLiveDot($('statsDot'), false);
    var line = $('statsStatusLine');
    if (line) line.innerHTML = msg;
    setText('statsRefreshHint', 'retrying every ' + ((STATS_CFG.refreshMs || 15000) / 1000) + ' s');
    setText('statsEndpoint', 'stats API unreachable');
    STAT_IDS.forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = '—';
    });
    STAT_USD_IDS.forEach(function (id) { setText(id, '—'); });
  }

  function tickStats() {
    if (state.inFlight.stats) return Promise.resolve(state.stats);
    state.inFlight.stats = true;
    var url = STATS_CFG.url;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;

    if (!url) {
      statsOffline('<b style="color:var(--err)">Stats offline</b> — no stats API configured in js/config.js.');
      state.inFlight.stats = false;
      return Promise.resolve(state.stats);
    }

    return fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (s) {
      if (!s || typeof s !== 'object' || !s.gas_prices || s.gas_prices.average == null) {
        throw new Error('unexpected stats payload');
      }
      state.stats.data = s;
      state.stats.ok = true;
      state.stats.lastGood = Date.now();
      renderStats(s);
      setLiveDot($('statsDot'), true);
      var line = $('statsStatusLine');
      if (line) line.innerHTML = '<b style="color:var(--ok)">Live</b> — Blockscout stats API responding';
      setText('statsRefreshHint', 'auto-refreshes every ' + ((STATS_CFG.refreshMs || 15000) / 1000) + ' s · ' + new Date().toLocaleTimeString());
      setText('statsEndpoint', 'via ' + String(url).replace(/^https?:\/\//, ''));
      return state.stats;
    }).catch(function () {
      state.stats.ok = false;
      statsOffline('<b style="color:var(--err)">Stats offline</b> — Blockscout API unreachable. The RPC telemetry above stays live.');
      return state.stats;
    }).finally(function () {
      state.inFlight.stats = false;
      if (ctrl) clearTimeout(timer);
    });
  }

  function startStats() {
    tickStats();
    setInterval(function () { tickStats(); }, STATS_CFG.refreshMs || 15000);
  }

  /* ═══════════════════════════════════════════════════════════════════
     3.6 · RESOLVER — name → owner + text records · address → reverse
     ═══════════════════════════════════════════════════════════════════ */

  var TEXT_RECORD_KEYS = ['avatar', 'url', 'twitter', 'description'];
  var TEXT_RECORD_LABELS = { avatar: 'Avatar', url: 'Website', twitter: 'Twitter', description: 'About' };
  var resolveCtx = { name: null, address: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseResolveInput(raw) {
    var s = String(raw || '').trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: 'address', value: s.toLowerCase() };
    var v = C.validateName(s);
    if (v.ok) return { kind: 'name', value: v.name };
    return { kind: 'invalid', value: s };
  }

  function resolveHint(msg, kind) {
    var el = $('resolveHint');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hint--err', kind === 'err');
    el.classList.toggle('hint--ok', kind === 'ok');
  }

  function showResolvePanel(name) {
    var map = { loading: 'resolveLoading', name: 'resolveNameView', address: 'resolveAddrView', error: 'resolveError' };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (el) el.classList.toggle('show', k === name);
    });
  }

  function copyToClipboard(text, btnEl) {
    var done = function () {
      if (!btnEl) return;
      btnEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
      setTimeout(function () { btnEl.innerHTML = ICONS.copy; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }

  /** Append one text-record row to a `.rec-list` element. Returns false when the value is empty. */
  function addRecordRow(listEl, key, val) {
    if (val === '' || val == null) return false;
    var row = document.createElement('div');
    row.className = 'rec-row';
    var k = document.createElement('span');
    k.className = 'rec-k';
    k.textContent = TEXT_RECORD_LABELS[key] || key;
    var v = document.createElement('span');
    v.className = 'rec-v';

    function httpLink(href, label) {
      var a = document.createElement('a');
      a.className = 'link';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label == null ? href : label;
      v.appendChild(a);
    }

    if (key === 'avatar' && /^https?:\/\//i.test(val)) {
      var img = document.createElement('img');
      img.className = 'rec-avatar-img';
      img.loading = 'lazy';
      img.alt = 'avatar';
      img.src = val;
      img.addEventListener('error', function () { img.remove(); });
      v.appendChild(img);
      httpLink(val, val.replace(/^https?:\/\//i, '').split('/')[0] + ' · open');
    } else if (/^https?:\/\//i.test(val)) {
      httpLink(val, val.replace(/^https?:\/\//i, '').slice(0, 48));
    } else if (key === 'twitter' && /^@?[A-Za-z0-9_]{1,32}$/.test(val)) {
      var handle = val.charAt(0) === '@' ? val.slice(1) : val;
      httpLink('https://twitter.com/' + handle, '@' + handle);
    } else {
      v.textContent = val;
      v.title = val;
    }
    row.appendChild(k);
    row.appendChild(v);
    listEl.appendChild(row);
    return true;
  }

  function renderTextRecords(listEl, records) {
    listEl.innerHTML = '';
    var any = false;
    TEXT_RECORD_KEYS.forEach(function (key) {
      if (addRecordRow(listEl, key, (records || {})[key] || '')) any = true;
    });
    return any;
  }

  function handleResolve() {
    if (!hasRegistry) {
      resolveHint('The resolver needs a deployed registry — activate it first (panel above).', 'err');
      showResolvePanel('');
      var gate = $('resolveGate');
      if (gate) gate.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (state.inFlight.resolve) return;
    var parsed = parseResolveInput($('resolveInput').value);
    resolveHint('', null);
    if (parsed.kind === 'invalid') {
      resolveHint('Enter a name (a–z, 0–9, 3–32 chars) or a full 0x address.', 'err');
      showResolvePanel('');
      return;
    }
    state.inFlight.resolve = true;
    showResolvePanel('loading');
    var done = function () { state.inFlight.resolve = false; };
    if (parsed.kind === 'name') {
      resolveName(parsed.value).then(done, done);
    } else {
      resolveAddress(parsed.value).then(done, done);
    }
  }

  function resolveName(name) {
    resolveCtx.name = name;
    var jobs = [{ method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataString(C.SELECTORS.ownerOf, name) }, 'latest'] }];
    TEXT_RECORD_KEYS.forEach(function (key) {
      jobs.push({ method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataArgs(C.SELECTORS.text, [{ type: 'string', value: name }, { type: 'string', value: key }]) }, 'latest'] });
    });
    return C.rpcCalls(jobs).then(function (res) {
      if (!res[0].ok) {
        var err = new Error((res[0].error && res[0].error.message) || 'RPC error');
        err.code = 'RPC_ERROR';
        throw err;
      }
      var records = {};
      for (var i = 0; i < TEXT_RECORD_KEYS.length; i++) {
        var rr = res[i + 1];
        records[TEXT_RECORD_KEYS[i]] = rr && rr.ok ? C.decodeString(rr.value) : '';
      }
      var owner = C.decodeAddress(res[0].value);
      setText('rsName', name + suffix());
      var primBadge = $('rsPrimaryBadge');
      var regCta = $('rsRegisterCta');
      var ownerRow = $('rsOwnerRow');
      var recordsEl = $('rsRecords');
      var noRecs = $('rsNoRecords');
      var profLink = $('rsProfileLink');

      if (C.isZeroAddress(owner)) {
        // free → honest "claim it" state
        if (primBadge) primBadge.hidden = true;
        if (ownerRow) ownerRow.hidden = true;
        if (recordsEl) recordsEl.innerHTML = '';
        if (noRecs) noRecs.hidden = true;
        if (profLink) profLink.hidden = true;
        if (regCta) regCta.hidden = false;
        var rb = $('rsRegisterBtn');
        if (rb) rb.textContent = 'Register ' + name + suffix();
        showResolvePanel('name');
        resolveHint(name + suffix() + ' is free — not registered on the ledger.', 'ok');
        return;
      }
      if (regCta) regCta.hidden = true;
      if (ownerRow) ownerRow.hidden = false;
      setText('rsOwner', owner);
      var oEl = $('rsOwner');
      if (oEl) oEl.title = owner;
      var oLink = $('rsOwnerLink');
      if (oLink) { oLink.href = explorerUrl() + '/address/' + owner; oLink.target = '_blank'; }
      if (profLink) { profLink.href = '#/name/' + name; }
      var had = renderTextRecords(recordsEl, records);
      if (noRecs) noRecs.hidden = had;
      // primary badge — is this the owner's chosen primary handle?
      if (primBadge) {
        primBadge.hidden = true;
        C.rpcCall('eth_call', [{ to: REG_ADDR, data: C.callDataAddress(C.SELECTORS.primaryName, owner) }, 'latest'])
          .then(function (r) {
            if (C.decodeString(r.result) === name) primBadge.hidden = false;
          }).catch(function () {});
      }
      showResolvePanel('name');
      resolveHint(had ? 'Live records from the Arc registry.' : 'Resolved from the Arc registry — this name has no text records yet.', had ? 'ok' : null);
    }).catch(function (err) {
      showResolvePanel('error');
      var msg = (err && err.message) || 'RPC error';
      if (/RPC unreachable|offline/i.test(msg)) msg = 'Arc RPC unreachable — resolution paused. Retry when the network is back.';
      setText('resolveErrorMsg', 'Resolution failed: ' + msg);
    });
  }

  function resolveAddress(addr) {
    resolveCtx.address = addr;
    setText('rsAddr', addr);
    var aEl = $('rsAddr');
    if (aEl) aEl.title = addr;
    return C.rpcCalls([
      { method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataAddress(C.SELECTORS.primaryName, addr) }, 'latest'] },
      { method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataAddress(C.SELECTORS.namesOf, addr) }, 'latest'] }
    ]).then(function (res) {
      if (!res[0].ok || !res[1].ok) {
        var err = new Error('RPC error resolving the address');
        err.code = 'RPC_ERROR';
        throw err;
      }
      var primary = C.decodeString(res[0].value);
      var names = C.decodeStringArray(res[1].value);
      var chip = $('rsAddrPrimaryChip');
      var primDot = chip ? chip.querySelector('.dot') : null;
      if (primDot) setLiveDot(primDot, !!primary);
      setText('rsAddrPrimary', primary || 'none');
      var listEl = $('rsNamesList');
      listEl.innerHTML = '';
      setText('rsNamesCount', String(names.length));
      var emptyEl = $('rsNamesEmpty');
      if (emptyEl) emptyEl.hidden = names.length > 0;
      var hintEl = $('rsAddrHint');
      if (hintEl) hintEl.textContent = names.length
        ? 'Click a name to resolve its records.'
        : 'Primary name and portfolio come straight from the registry reverse index.';
      names.forEach(function (nm) {
        var row = document.createElement('div');
        row.className = 'rec-row';
        var k = document.createElement('span');
        k.className = 'rec-k';
        k.textContent = 'name';
        var v = document.createElement('span');
        v.className = 'rec-v';
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'link mono';
        b.textContent = nm + suffix();
        b.addEventListener('click', function () {
          $('resolveInput').value = nm;
          handleResolve();
        });
        v.appendChild(b);
        row.appendChild(k);
        row.appendChild(v);
        listEl.appendChild(row);
      });
      showResolvePanel('address');
      resolveHint(primary ? 'This address presents itself as ' + primary + suffix() + ' on Arc.' : 'This address has no primary name yet.', primary ? 'ok' : null);
    }).catch(function (err) {
      showResolvePanel('error');
      var msg = (err && err.message) || 'RPC error';
      if (/RPC unreachable|offline/i.test(msg)) msg = 'Arc RPC unreachable — resolution paused. Retry when the network is back.';
      setText('resolveErrorMsg', 'Resolution failed: ' + msg);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     3.7 · MY NAMES — namesOf dashboard (primary / transfer / records)
     ═══════════════════════════════════════════════════════════════════ */

  function setMnStatus(msg, kind) {
    var el = $('mnStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'hint mn-status' + (kind ? ' ' + kind : '');
  }

  function addMnSession(name, txHash, label) {
    var wrap = $('mnSessWrap');
    var list = $('mnSessionList');
    if (!wrap || !list) return;
    show(wrap);
    var item = document.createElement('div');
    item.className = 'sess-item';
    item.innerHTML =
      '<span class="ok-dot">' + ICONS.check + '</span>' +
      '<span class="nm mono">' + esc(name) + suffix() + '</span>' +
      '<span class="when">' + esc(label) + ' · ' + new Date().toLocaleTimeString() + '</span>' +
      '<a class="link lnk mono" href="' + explorerUrl() + '/tx/' + txHash + '" target="_blank" rel="noopener noreferrer">' + C.shortAddress(txHash, 8, 6) + '</a>';
    list.insertBefore(item, list.firstChild);
  }

  /** EIP-1559 quote for an arbitrary registry write (20 gwei floor on Arc). */
  function estimateTxGas(data, valueHex) {
    if (!state.wallet.address) return Promise.resolve(null);
    return C.rpcCall('eth_estimateGas', [{
      from: state.wallet.address,
      to: REG_ADDR,
      value: valueHex || '0x0',
      data: data
    }]).then(function (r) {
      var g = C.hexToBigInt(r.result);
      return g > 0n ? g : null;
    }).catch(function () { return null; });
  }

  function quoteAnyTx(data, valueHex) {
    var quote = Promise.all([fetchFeeQuote(), estimateTxGas(data, valueHex)])
      .then(function (pair) {
        var fp = feeParamsFromQuote(pair[0]);
        var gasUnits = pair[1];
        var out = { text: feeLineText(fp, gasUnits), params: {} };
        if (fp) {
          out.params.maxFeePerGas = C.bigIntToHex(fp.maxFeePerGas);
          out.params.maxPriorityFeePerGas = C.bigIntToHex(fp.maxPriorityFeePerGas);
        }
        return out;
      });
    var bail = new Promise(function (resolve) {
      setTimeout(function () { resolve({ text: null, params: {} }); }, 6000);
    });
    return Promise.race([quote, bail]);
  }

  /**
   * Send one registry write through the wallet with fee-aware params and
   * receipt polling. `say` receives phase updates ({text,cls}).
   * Resolves with the receipt; rejects on user rejection / revert.
   */
  function sendRegistryTx(data, valueHex, say) {
    function st(msg, cls) { if (say) say({ text: msg, cls: cls }); }
    if (!state.wallet.address) return Promise.reject({ code: 'NO_WALLET', message: 'Connect your wallet first.' });
    if (state.wallet.chainId !== CHAIN.chainId) return Promise.reject({ code: 'WRONG_CHAIN', message: 'Switch your wallet to Arc Testnet first.' });
    var p = provider();
    if (!p) return Promise.reject({ code: 'NO_PROVIDER', message: 'No injected wallet found.' });
    st('Estimating gas on Arc…', 'pend');
    return quoteAnyTx(data, valueHex || '0x0').then(function (q) {
      var params = { from: state.wallet.address, to: REG_ADDR, value: valueHex || '0x0', data: data };
      if (q.params.maxFeePerGas) {
        params.maxFeePerGas = q.params.maxFeePerGas;
        params.maxPriorityFeePerGas = q.params.maxPriorityFeePerGas;
      }
      st((q.text ? 'Fee estimate: ' + q.text + '. ' : '') + 'Confirm in your wallet…', 'pend');
      return p.request({ method: 'eth_sendTransaction', params: [params] });
    }).then(function (txHash) {
      st('Broadcast ' + C.shortAddress(txHash, 8, 6) + ' — waiting for finality…', 'pend');
      return pollReceipt(txHash).then(function (receipt) {
        if (String(receipt.status || '0x0') !== '0x1') {
          var e = new Error('The transaction was included but reverted onchain.');
          e.code = 'REVERTED';
          throw e;
        }
        st('Confirmed in block ' + fmtBlock(receipt.blockNumber) + ' — ' + new Date().toLocaleTimeString() + ' ✓', 'ok');
        return receipt;
      });
    });
  }

  function fetchRecordsFor(name) {
    var jobs = TEXT_RECORD_KEYS.map(function (key) {
      return { method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataArgs(C.SELECTORS.text, [{ type: 'string', value: name }, { type: 'string', value: key }]) }, 'latest'] };
    });
    return C.rpcCalls(jobs).then(function (res) {
      var rec = {};
      for (var i = 0; i < TEXT_RECORD_KEYS.length; i++) {
        var r = res[i];
        rec[TEXT_RECORD_KEYS[i]] = r && r.ok ? C.decodeString(r.value) : '';
      }
      return rec;
    }).catch(function () {
      var rec = {};
      TEXT_RECORD_KEYS.forEach(function (key) { rec[key] = ''; });
      return rec;
    });
  }

  function renderMyNames() {
    var p = provider();
    var w = state.wallet;
    var connect = $('mynamesConnect');
    var gate = $('mynamesGate');
    var live = $('mynamesLive');
    var badge = $('mynamesBadge');
    var badgeTxt = $('mynamesBadgeText');
    var dot = $('mynamesDot');
    if (connect) hide(connect);
    if (gate) hide(gate);
    if (live) hide(live);

    if (!p || !w.address) {
      if (connect) show(connect);
      if (badge) badge.classList.remove('live');
      if (badgeTxt) badgeTxt.textContent = 'Wallet disconnected';
      if (dot) setLiveDot(dot, false);
      return;
    }
    if (!hasRegistry) {
      if (gate) show(gate);
      if (badge) badge.classList.remove('live');
      if (badgeTxt) badgeTxt.textContent = 'Needs deployment';
      if (dot) setLiveDot(dot, false);
      return;
    }
    if (live) show(live);
    if (badge) badge.classList.add('live');
    if (badgeTxt) badgeTxt.textContent = 'Registry live';
    if (dot) setLiveDot(dot, true);

    if (w.chainId !== CHAIN.chainId) {
      setText('mnCount', '–');
      setText('mnPrimaryName', '—');
      var listEl = $('mnList');
      if (listEl) listEl.innerHTML = '';
      var emptyEl = $('mnEmpty');
      if (emptyEl) hide(emptyEl);
      setMnStatus('Wrong network — switch your wallet to Arc Testnet to load your names.', 'err');
      return;
    }
    loadMyNames(false);
  }

  function loadMyNames(force) {
    if (!state.wallet.address || !hasRegistry) return;
    if (state.wallet.chainId !== CHAIN.chainId) return;
    if (state.inFlight.mynames) return;
    if (state.mynames.loaded && !force) {
      renderMyNamesList();
      return;
    }
    state.inFlight.mynames = true;
    var addr = state.wallet.address;
    setMnStatus('Reading namesOf(' + C.shortAddress(addr) + ')…', 'pend');
    C.rpcCalls([
      { method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataAddress(C.SELECTORS.namesOf, addr) }, 'latest'] },
      { method: 'eth_call', params: [{ to: REG_ADDR, data: C.callDataAddress(C.SELECTORS.primaryName, addr) }, 'latest'] }
    ]).then(function (res) {
      if (!res[0].ok || !res[1].ok) {
        var err = new Error((res[0].error && res[0].error.message) || 'RPC error');
        err.code = 'RPC_ERROR';
        throw err;
      }
      state.mynames.names = C.decodeStringArray(res[0].value);
      state.mynames.primary = C.decodeString(res[1].value);
      // pre-fetch text records for every owned name (parallel, tolerant)
      var fetches = state.mynames.names.map(fetchRecordsFor);
      return Promise.all(fetches).then(function (allRecs) {
        state.mynames.names.forEach(function (nm, i) { state.mynames.records[nm] = allRecs[i]; });
      });
    }).then(function () {
      state.mynames.loaded = true;
      renderMyNamesList();
    }).catch(function (err) {
      var msg = (err && err.message) || 'read failed';
      if (/RPC unreachable|offline/i.test(msg)) msg = 'Arc RPC unreachable — your names will load when the network is back.';
      setMnStatus('Could not read your names: ' + msg, 'err');
    }).finally(function () { state.inFlight.mynames = false; });
  }

  function initialsOf(name) {
    return String(name || '').slice(0, 2).toUpperCase();
  }

  function mnSay(el, msg, cls) {
    if (!el) return;
    el.textContent = msg;
    el.className = 'mn-status' + (cls ? ' ' + cls : '');
    show(el);
  }

  function buildNameCard(name, idx) {
    var rec = state.mynames.records[name] || {};
    var isPrimary = state.mynames.primary === name;
    var card = document.createElement('article');
    card.className = 'glass mn-card';
    card.dataset.name = name;

    var avatarInner = '';
    if (/^https?:\/\//i.test(rec.avatar || '')) {
      avatarInner = '<img src="' + esc(rec.avatar) + '" alt="" loading="lazy" />';
    } else {
      avatarInner = '<span>' + esc(initialsOf(name)) + '</span>';
    }

    card.innerHTML =
      '<div class="mn-top">' +
        '<div class="mn-avatar">' + avatarInner + '</div>' +
        '<div class="mn-meta">' +
          '<div class="mn-name"><span class="mono">' + esc(name) + suffix() + '</span>' +
            (isPrimary ? '<span class="res-badge ok">primary</span>' : '') +
          '</div>' +
          '<div class="mn-sub">' + (isPrimary ? 'your primary handle on Arc' : 'owned by your wallet · on the Arc registry') + '</div>' +
        '</div>' +
        '<div class="mn-top-actions">' +
          (isPrimary ? '' : '<button class="btn btn-soft btn-sm" data-act="primary">Set as primary</button>') +
          '<button class="btn btn-ghost btn-sm" data-act="expand" type="button">Transfer &amp; records</button>' +
        '</div>' +
        '<div class="mn-txline" data-role="line"></div>' +
      '</div>' +
      '<details class="mn-manage" data-role="manage">' +
        '<summary>Manage name<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>' +
        '<div class="mn-manage-body">' +
          '<div class="mn-sec">Transfer ownership</div>' +
          '<div class="mn-row">' +
            '<div class="field-wrap">' +
              '<input class="field mono" data-role="to" placeholder="0x… new owner" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="New owner address" />' +
            '</div>' +
            '<button class="btn btn-danger btn-sm" data-act="transfer" type="button">Transfer</button>' +
            '<button class="btn btn-ghost btn-sm" data-act="transfer-cancel" type="button" hidden>Cancel</button>' +
          '</div>' +
          '<div class="mn-sec" style="margin-top:16px">Text records — what others see when they resolve you</div>' +
          '<div class="mn-fields">' +
            '<label class="rec-field"><span>Avatar URL</span><div class="field-wrap"><input class="field" data-role="rec-avatar" placeholder="https://…" spellcheck="false" autocomplete="off" value="' + esc(rec.avatar || '') + '" /></div></label>' +
            '<label class="rec-field"><span>Website</span><div class="field-wrap"><input class="field" data-role="rec-url" placeholder="https://…" spellcheck="false" autocomplete="off" value="' + esc(rec.url || '') + '" /></div></label>' +
            '<label class="rec-field"><span>Twitter</span><div class="field-wrap"><input class="field" data-role="rec-twitter" placeholder="@handle" spellcheck="false" autocomplete="off" value="' + esc(rec.twitter || '') + '" /></div></label>' +
            '<label class="rec-field"><span>About</span><div class="field-wrap"><input class="field" data-role="rec-description" placeholder="One line about you" autocomplete="off" maxlength="300" value="' + esc(rec.description || '') + '" /></div></label>' +
          '</div>' +
          '<div class="mn-status" data-role="status" hidden></div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
            '<button class="btn btn-primary btn-sm" data-act="save">Save records</button>' +
            '<button class="btn btn-ghost btn-sm" data-act="share" type="button">Share profile</button>' +
          '</div>' +
        '</div>' +
      '</details>';

    // avatar image load failure → initials fallback
    var av = card.querySelector('.mn-avatar img');
    if (av) {
      av.addEventListener('error', function () {
        av.outerHTML = '<span>' + esc(initialsOf(name)) + '</span>';
      });
    }

    var line = card.querySelector('[data-role="line"]');
    var statusEl = card.querySelector('[data-role="status"]');
    var manage = card.querySelector('[data-role="manage"]');
    var toInput = card.querySelector('[data-role="to"]');
    var transferBtn = card.querySelector('[data-act="transfer"]');
    var cancelBtn = card.querySelector('[data-act="transfer-cancel"]');
    var pendingTransfer = null;

    card.querySelector('[data-act="primary"]').addEventListener('click', function (e) {
      e.preventDefault();
      var btn = e.currentTarget;
      btn.disabled = true;
      mnSay(line, 'Preparing to set ' + name + suffix() + ' as your primary…', 'pend');
      sendRegistryTx(C.callDataString(C.SELECTORS.setPrimaryName, name), '0x0', function (u) { mnSay(line, u.text, u.cls); })
        .then(function (receipt) {
          state.mynames.primary = name;
          addMnSession(name, receipt.transactionHash, 'set as primary');
          setText('mnPrimaryName', name);
          setText('mnPrimaryName' , name);
          loadMyNames(true);
        })
        .catch(function (err) {
          if (err && err.code === 4001) mnSay(line, 'Rejected in your wallet — nothing was sent.', 'err');
          else if (err && err.code === 'REVERTED') mnSay(line, err.message || 'The transaction reverted onchain.', 'err');
          else mnSay(line, 'Failed: ' + ((err && err.message) || 'unknown error'), 'err');
          if (btn) btn.disabled = false;
        });
    });

    transferBtn.addEventListener('click', function () {
      var to = String(toInput.value || '').trim().toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(to)) {
        mnSay(statusEl, 'Enter a valid 0x address to transfer to.', 'err');
        return;
      }
      if (!pendingTransfer) {
        pendingTransfer = to;
        transferBtn.textContent = 'Confirm transfer';
        show(cancelBtn);
        mnSay(statusEl, 'Transfer ' + name + suffix() + ' to ' + to + '? This moves ownership onchain.', 'pend');
        return;
      }
      if (pendingTransfer !== to) { pendingTransfer = null; transferBtn.textContent = 'Transfer'; hide(cancelBtn); return; }
      transferBtn.disabled = true;
      mnSay(statusEl, 'Sending the transfer transaction…', 'pend');
      sendRegistryTx(C.callDataArgs(C.SELECTORS.transfer, [{ type: 'string', value: name }, { type: 'address', value: to }]), '0x0', function (u) { mnSay(statusEl, u.text, u.cls); })
        .then(function (receipt) {
          addMnSession(name, receipt.transactionHash, 'transferred to ' + to);
          mnSay(statusEl, name + suffix() + ' now belongs to ' + to + '. Reloading your portfolio…', 'ok');
          state.mynames.loaded = false;
          setTimeout(function () { loadMyNames(true); }, 900);
        })
        .catch(function (err) {
          if (err && err.code === 4001) mnSay(statusEl, 'Rejected in your wallet — nothing was sent.', 'err');
          else if (err && err.code === 'REVERTED') mnSay(statusEl, err.message || 'The transaction reverted onchain.', 'err');
          else mnSay(statusEl, 'Failed: ' + ((err && err.message) || 'unknown error'), 'err');
          transferBtn.disabled = false;
          pendingTransfer = null;
          transferBtn.textContent = 'Transfer';
          hide(cancelBtn);
        });
    });

    cancelBtn.addEventListener('click', function () {
      pendingTransfer = null;
      transferBtn.textContent = 'Transfer';
      transferBtn.disabled = false;
      hide(cancelBtn);
      hide(statusEl);
    });

    card.querySelector('[data-act="save"]').addEventListener('click', function () {
      var dirty = [];
      var vals = {};
      var errMsg = null;
      TEXT_RECORD_KEYS.forEach(function (key) {
        var input = card.querySelector('[data-role="rec-' + key + '"]');
        var val = input ? String(input.value || '').trim() : '';
        vals[key] = val;
        if (key === 'avatar' || key === 'url') {
          if (val !== '' && !/^(https?|ipfs):\/\//i.test(val)) errMsg = key === 'avatar' ? 'Avatar must be an http(s) URL.' : 'Website must be an http(s) URL.';
        } else if (key === 'twitter') {
          if (val !== '' && !/^@?[A-Za-z0-9_]{1,32}$/.test(val)) errMsg = 'Twitter should be a handle like @alice.';
        }
        if (val !== ((state.mynames.records[name] || {})[key] || '')) dirty.push(key);
      });
      if (errMsg) { mnSay(statusEl, errMsg, 'err'); return; }
      if (!dirty.length) { mnSay(statusEl, 'No changes to save.', 'ok'); return; }
      var btn = card.querySelector('[data-act="save"]');
      btn.disabled = true;
      mnSay(statusEl, 'Saving ' + dirty.length + ' record(s) — one tx each…', 'pend');

      function next(i) {
        if (i >= dirty.length) {
          state.mynames.records[name] = vals;
          addMnSession(name, '—', dirty.length + ' text record(s) updated');
          mnSay(statusEl, 'Records saved onchain.', 'ok');
          // re-render keeps everything in sync with what was written
          loadMyNames(true);
          return;
        }
        var key = dirty[i];
        sendRegistryTx(
          C.callDataArgs(C.SELECTORS.setText, [{ type: 'string', value: name }, { type: 'string', value: key }, { type: 'string', value: vals[key] }]),
          '0x0',
          function (u) { mnSay(statusEl, 'Record ' + (i + 1) + '/' + dirty.length + ' (' + key + '): ' + u.text, u.cls); }
        ).then(function (receipt) {
          addMnSession(name, receipt.transactionHash, 'set ' + key + ' record');
          next(i + 1);
        }).catch(function (err) {
          if (err && err.code === 4001) mnSay(statusEl, 'Rejected in your wallet — records not saved.', 'err');
          else if (err && err.code === 'REVERTED') mnSay(statusEl, err.message || 'The transaction reverted onchain.', 'err');
          else mnSay(statusEl, 'Failed: ' + ((err && err.message) || 'unknown error'), 'err');
          if (btn) btn.disabled = false;
        });
      }
      next(0);
    });

    card.querySelector('[data-act="expand"]').addEventListener('click', function () {
      manage.open = !manage.open;
    });

    card.querySelector('[data-act="share"]').addEventListener('click', function (e) {
      e.preventDefault();
      location.hash = '#/name/' + encodeURIComponent(name);
    });

    return card;
  }

  function renderMyNamesList() {
    var listEl = $('mnList');
    if (!listEl) return;
    listEl.innerHTML = '';
    var names = state.mynames.names;
    var emptyEl = $('mnEmpty');
    setText('mnCount', String(names.length));
    setText('mnPrimaryName', state.mynames.primary || 'none');
    if (!names.length) {
      if (emptyEl) show(emptyEl);
      setMnStatus('You do not own any names yet. Names are one transaction away.', null);
      return;
    }
    if (emptyEl) hide(emptyEl);
    names.forEach(function (nm, i) {
      listEl.appendChild(buildNameCard(nm, i));
    });
    setMnStatus('Loaded ' + names.length + ' name(s) from the registry · ' + new Date().toLocaleTimeString(), 'ok');
  }

  /* ═══════════════════════════════════════════════════════════════════
     4 · INIT / EVENTS
     ═══════════════════════════════════════════════════════════════════ */

  function bindEvents() {
    var $n = function (id) { return $(id); };

    // nav
    $n('navBurger').addEventListener('click', function () {
      var m = $n('navMobile');
      var open = m.classList.toggle('open');
      $n('navBurger').setAttribute('aria-expanded', String(open));
    });
    Array.prototype.forEach.call(document.querySelectorAll('.nav-mobile a'), function (a) {
      a.addEventListener('click', function () { $n('navMobile').classList.remove('open'); });
    });

    // nav connect / wallet connect / disconnect
    $n('connectBtn').addEventListener('click', function () {
      if (state.wallet.address) {
        $('wallet').scrollIntoView({ behavior: 'smooth' });
      } else {
        walletConnect();
      }
    });
    $n('connectWalletBtn').addEventListener('click', function () { walletConnect(); });
    $n('disconnectBtn').addEventListener('click', walletDisconnect);
    $n('switchChainBtn').addEventListener('click', function () {
      ensureArcChain()
        .then(function (chainId) { state.wallet.chainId = chainId; renderWallet(); })
        .catch(function (err) { showWalletError('Switch failed: ' + ((err && err.message) || 'unknown error')); });
    });
    $n('refreshBalanceBtn').addEventListener('click', refreshBalance);

    // copy address
    $n('walletCopyBtn').addEventListener('click', function () {
      var addr = state.wallet.address;
      if (!addr) return;
      var done = function () {
        var b = $('walletCopyBtn');
        b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
        setTimeout(function () { b.innerHTML = ICONS.copy; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr).then(done).catch(function () { fallbackCopy(addr); done(); });
      } else { fallbackCopy(addr); done(); }
    });
    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }

    // hero search + quick chips
    $n('heroSearch').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = C.validateName($n('heroNameInput').value);
      $n('nameInput').value = v.name;
      $('register').scrollIntoView({ behavior: 'smooth' });
      hint(v.ok ? '' : v.reason, v.ok ? null : 'err');
      if (v.ok) { hint(v.name + suffix() + ' — checking…', null); handleSearch(); }
      $n('nameInput').focus();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.chip-name'), function (chip) {
      chip.addEventListener('click', function () {
        $n('heroNameInput').value = chip.getAttribute('data-name');
        $('register').scrollIntoView({ behavior: 'smooth' });
        $n('nameInput').value = chip.getAttribute('data-name');
        hint('', null);
        $n('nameInput').focus();
      });
    });

    // name input live echo + validation
    ['heroNameInput', 'nameInput'].forEach(function (id) {
      var el = $(id);
      el.addEventListener('input', function () {
        var v = C.validateName(el.value);
        var rn = $('ringName');
        if (rn) rn.textContent = (v.name || 'yourname') + suffix();
        if (id === 'nameInput') {
          hint(v.ok ? '' : (el.value ? v.reason : ''), null);
          if (el.value && !state.inFlight.search) showPanel('');
        }
      });
    });

    // registry console
    $n('regSearchForm').addEventListener('submit', function (e) { e.preventDefault(); handleSearch(); });
    $n('registerBtn').addEventListener('click', doRegister);
    $n('registerCtaWallet').addEventListener('click', function () {
      $('wallet').scrollIntoView({ behavior: 'smooth' });
      walletConnect();
    });
    $n('txAnotherBtn').addEventListener('click', function () {
      resetConsole();
      $n('nameInput').value = '';
      $n('nameInput').focus();
    });

    // gate helper
    $n('gateConfigHint').addEventListener('click', function () {
      var p = document.querySelector('#regGate .gate-top p');
      if (!p) return;
      var orig = p.textContent;
      p.innerHTML = '📁 Where: open <b>js/config.js</b> (repo root) and set <code>REGISTRY_ADDRESS = \'0x…\'</code>, then save and refresh this page. Keep the quotes and the leading <code>0x</code>.';
      setTimeout(function () { p.textContent = orig; }, 6000);
    });

    // telemetry refresh
    $n('netRefreshBtn').addEventListener('click', function () { tickTelemetry(true); });
    $n('offlineRetry').addEventListener('click', function () { tickTelemetry(true); });

    // reveal animations
    var els = document.querySelectorAll('[data-reveal]');
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12 });
      Array.prototype.forEach.call(els, function (el) { io.observe(el); });
    } else {
      Array.prototype.forEach.call(els, function (el) { el.classList.add('is-in'); });
    }

    // scroll nav styling
    var nav = $('nav');
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function bindProviderEvents() {
    var p = provider();
    if (!p || typeof p.on !== 'function') return;
    p.on('accountsChanged', function (accs) {
      if (accs && accs.length) {
        state.wallet.address = accs[0];
        p.request({ method: 'eth_chainId' }).then(function (hex) {
          state.wallet.chainId = C.hexToNumber(hex);
          renderWallet();
        });
      } else {
        walletDisconnect();
      }
    });
    p.on('chainChanged', function (hex) {
      state.wallet.chainId = C.hexToNumber(hex);
      if (state.wallet.chainId !== CHAIN.chainId) setText('walletBalance', '—');
      renderWallet();
    });
    if (typeof p.removeListener === 'function') {
      window.addEventListener('pagehide', function () {
        try { p.removeListener('accountsChanged'); p.removeListener('chainChanged'); } catch (e) {}
      });
    }
  }

  function tryRestoreSession() {
    var p = provider();
    if (!p || typeof p.request !== 'function') return;
    p.request({ method: 'eth_accounts' }).then(function (accs) {
      if (!accs || !accs.length) return;
      state.wallet.address = accs[0];
      return p.request({ method: 'eth_chainId' }).then(function (hex) {
        state.wallet.chainId = C.hexToNumber(hex);
        renderWallet();
      });
    }).catch(function () {});
  }

  function init() {
    setText('year', String(new Date().getFullYear()));
    setText('regAddr', '');
    renderRegistryUI();
    bindEvents();
    bindProviderEvents();
    renderWallet();
    startTelemetry();
    startStats();
    // wallets may inject late
    window.addEventListener('ethereum#initialized', function () {
      renderWallet(); bindProviderEvents(); tryRestoreSession();
    });
    setTimeout(tryRestoreSession, 400);
    setTimeout(function () { renderWallet(); tryRestoreSession(); }, 1500);
    // initial ring label
    var rn = $('ringName');
    if (rn) rn.textContent = 'yourname' + suffix();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
