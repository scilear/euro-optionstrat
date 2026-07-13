(function (root) {
  "use strict";

  var State = {};

  State.els = {};

  State.FALLBACK_INDICES = [
    { symbol: "SX5E", name: "Euro Stoxx 50", currency: "EUR", multiplier: 10 },
    { symbol: "DAX", name: "DAX", currency: "EUR", multiplier: 5 },
    { symbol: "CAC40", name: "CAC 40", currency: "EUR", multiplier: 10 },
    { symbol: "UKX", name: "FTSE 100", currency: "GBP", multiplier: 10 },
    { symbol: "SMI", name: "Swiss Market Index", currency: "CHF", multiplier: 10 },
    { symbol: "AEX", name: "AEX", currency: "EUR", multiplier: 100 },
    { symbol: "IBEX", name: "IBEX 35", currency: "EUR", multiplier: 10 },
    { symbol: "SPX", name: "S&P 500 Index", currency: "USD", multiplier: 100 },
    { symbol: "RUT", name: "Russell 2000 Index", currency: "USD", multiplier: 100 },
  ];

  State.data = {
    indices: [],
    expiries: [],
    ticker: "",
    currency: "USD",
    multiplier: 100,
    noIb: true,
    mock: false,
    selectedExpiry: "",
    chains: new Map(),
    legs: [],
    savedTrades: [],
    savedTemplates: [],
    currentTradeId: "",
    tradeName: "",
    tradeOpeningNetCost: null,
    tradeOpenedAtUtc: "",
    tradePnlHistory: [],
    lastTradeSnapshotMs: 0,
    currentTemplateId: "",
    templateName: "",
    templateStrikeMode: "pts",
    templateUnderlyingScope: "ticker",
    rangePct: 12,
    ivShiftPct: 0,
    spotShiftPct: 0,
    volMode: "parallel",
    dateOffset: 0,
    loading: false,
    loadingCount: 0,
    loadingMessage: "",
    fallbackMock: false,
    liveError: "",
    fromCache: false,
    cacheFresh: true,
    cacheAgeSeconds: 0,
    drag: null,
    chartHoverPx: null,
    chartHoverPy: null,
    centerChainOnNextRender: true,
    recentTickers: [],
    templateHydrationToken: 0,
    activeChainControllers: new Set(),
    chainLoadTime: "",
  };

  State.DEFAULT_MULTIPLIER_BY_CURRENCY = {
    USD: 100,
    EUR: 10,
    GBP: 10,
    CHF: 10,
  };

  State.MAX_RECENT_TICKERS = 10;
  State.RECENT_TICKERS_KEY = "euro_optionstrat_recent_tickers_v1";
  State.LOADING_LOCK_CONTROL_IDS = [
    "multiplierInput",
    "tradeNameInput",
    "saveTradeButton",
    "savedTradeSelect",
    "loadTradeButton",
    "templateNameInput",
    "saveTemplateButton",
    "templateStrikeModeSelect",
    "templateScopeSelect",
    "savedTemplateSelect",
    "loadTemplateButton",
    "clearButton",
    "dateSlider",
    "rangeSlider",
    "ivSlider",
    "spotSlider",
    "volModeSelect",
  ];

  var d = new Date();
  State.today = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (typeof module !== "undefined" && module.exports) {
    module.exports = State;
  } else if (typeof window !== "undefined") {
    window.Euro = window.Euro || {};
    window.Euro.State = State;
  }
})(this);
