/* Ligação do jogo ao Android: anúncios AdMob (premiados + entre jogos),
   consentimento RGPD (formulário da Google) e a compra "Sem anúncios" na Google Play.
   No navegador nada disto corre e o jogo usa os anúncios simulados. */
(function () {
  "use strict";

  /* ====== CONFIGURAÇÃO ======
     Com TESTING = true o plugin pede sempre anúncios de TESTE da Google (ignora os IDs
     abaixo), para não arriscar a conta durante os testes. Na versão para publicar,
     muda TESTING para false e passam a aparecer anúncios verdadeiros (que pagam). */
  const CFG = {
    TESTING: true,
    // Substitui pelos IDs dos blocos criados no AdMob para a app "Seed Stack":
    REWARDED_ID: "ca-app-pub-4831894609560613/7150060728",     // bloco "Premiado"
    INTERSTITIAL_ID: "ca-app-pub-4831894609560613/8670366813", // bloco "Entre jogos"
    NO_ADS_PRODUCT: "sem_anuncios"                              // ID do produto na Play Console
  };

  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  const N = { native: isNative, price: null, onNoAds: null, onPrice: null };
  window.NATIVE = N;
  if (!isNative) return;
  document.documentElement.classList.add("native");

  const AdMob = (window.capacitorStripe || {}).AdMob; // nome global do build UMD do plugin
  let rewardReady = false, interReady = false, adsReady = false;

  async function loadReward() {
    if (!AdMob) return;
    try { await AdMob.prepareRewardVideoAd({ adId: CFG.REWARDED_ID, isTesting: CFG.TESTING, immersiveMode: true }); rewardReady = true; }
    catch (e) { rewardReady = false; }
  }
  async function loadInter() {
    if (!AdMob) return;
    try { await AdMob.prepareInterstitial({ adId: CFG.INTERSTITIAL_ID, isTesting: CFG.TESTING, immersiveMode: true }); interReady = true; }
    catch (e) { interReady = false; }
  }

  async function initAds() {
    if (!AdMob) return;
    try {
      await AdMob.initialize({ initializeForTesting: CFG.TESTING });
      const info = await AdMob.requestConsentInfo();
      if (info && info.isConsentFormAvailable && info.status === "REQUIRED") await AdMob.showConsentForm();
    } catch (e) { /* sem consentimento ou sem rede: o jogo continua */ }
    adsReady = true;
    loadReward(); loadInter();
  }

  /* Resolve "ok" (viu até ao fim), "skipped" (fechou antes) ou "unavailable" (sem anúncio).
     Quando não há anúncio, o jogo dá o prémio na mesma, para não castigar o jogador. */
  N.rewarded = function () {
    return new Promise(async (resolve) => {
      if (!AdMob || !adsReady) return resolve("unavailable");
      if (!rewardReady) await loadReward();
      if (!rewardReady) return resolve("unavailable");
      let got = false, settled = false;
      const hs = [];
      const finish = (why) => {
        if (settled) return; settled = true;
        hs.forEach((h) => h && h.remove && h.remove());
        rewardReady = false; loadReward();
        resolve(got ? "ok" : why);
      };
      hs.push(await AdMob.addListener("onRewardedVideoAdReward", () => { got = true; }));
      hs.push(await AdMob.addListener("onRewardedVideoAdDismissed", () => finish("skipped")));
      hs.push(await AdMob.addListener("onRewardedVideoAdFailedToShow", () => finish("unavailable")));
      try { await AdMob.showRewardVideoAd(); } catch (e) { finish("unavailable"); }
    });
  };

  N.interstitial = function () {
    return new Promise(async (resolve) => {
      if (!AdMob || !adsReady || !interReady) { loadInter(); return resolve(); }
      let settled = false;
      const hs = [];
      const finish = () => {
        if (settled) return; settled = true;
        hs.forEach((h) => h && h.remove && h.remove());
        interReady = false; loadInter(); resolve();
      };
      hs.push(await AdMob.addListener("interstitialAdDismissed", finish));
      hs.push(await AdMob.addListener("interstitialAdFailedToShow", finish));
      try { await AdMob.showInterstitial(); } catch (e) { finish(); }
    });
  };

  /* ====== Compra "Sem anúncios" (Google Play Billing, via cordova-plugin-purchase) ====== */
  N.buyNoAds = function () { return false; };
  N.restore = function () {};
  document.addEventListener("deviceready", function () {
    initAds();
    const C = window.CdvPurchase;
    if (!C) return;
    const store = C.store;
    store.register([{ id: CFG.NO_ADS_PRODUCT, type: C.ProductType.NON_CONSUMABLE, platform: C.Platform.GOOGLE_PLAY }]);
    const check = () => {
      const p = store.get(CFG.NO_ADS_PRODUCT);
      if (!p) return;
      const price = p.pricing && p.pricing.price;
      if (price && price !== N.price) { N.price = price; if (N.onPrice) N.onPrice(price); }
      if (p.owned && N.onNoAds) N.onNoAds();
    };
    store.when()
      .approved((t) => t.verify())
      .verified((r) => r.finish())
      .finished(check)
      .productUpdated(check);
    store.initialize([C.Platform.GOOGLE_PLAY]).then(check);
    N.buyNoAds = function () {
      const p = store.get(CFG.NO_ADS_PRODUCT);
      const offer = p && p.getOffer();
      if (offer) { offer.order(); return true; }
      return false;
    };
    N.restore = function () { store.restorePurchases(); };
  }, false);
})();
