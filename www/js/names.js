// Nombres legibles y destacados del selector de activos.

export const NAMES = {
  // Cripto
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana', XRP: 'XRP', DOGE: 'Dogecoin', ADA: 'Cardano',
  TRX: 'TRON', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', TON: 'Toncoin', SUI: 'Sui',
  // Acciones (Binance TradFi)
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Google', GOOG: 'Google',
  AMZN: 'Amazon', META: 'Meta', TSLA: 'Tesla', NFLX: 'Netflix', AMD: 'AMD', INTC: 'Intel',
  PLTR: 'Palantir', COIN: 'Coinbase', PAYP: 'PayPal', PYPL: 'PayPal', HOOD: 'Robinhood', MSTR: 'Strategy (MicroStrategy)',
  CRCL: 'Circle', ORCL: 'Oracle', TSM: 'TSMC', BABA: 'Alibaba', AVGO: 'Broadcom',
  EWJ: 'ETF Japón', EWY: 'ETF Corea del Sur', SPY: 'ETF S&P 500', QQQ: 'ETF Nasdaq 100',
  // Materias primas
  XAU: 'Oro', XAG: 'Plata', XPT: 'Platino', XPD: 'Paladio', CL: 'Petróleo WTI', BZ: 'Petróleo Brent',
  NATGAS: 'Gas natural', COPPER: 'Cobre',
};

export const COMMODITIES = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'CL', 'BZ', 'NATGAS', 'COPPER']);

// Destacados: las más grandes y conocidas primero. Solo se muestran las que existan en tu cuenta.
export const FEATURED = {
  stock: ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'TSM', 'NFLX', 'PLTR', 'COIN'],
  crypto: ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'],
  commodity: ['XAU', 'XAG', 'CL'],
};

export const CATEGORY_LABEL = { crypto: 'CRIPTO', stock: 'ACCIÓN', commodity: 'MATERIA PRIMA' };
export const nameOf = base => NAMES[base] || base;
