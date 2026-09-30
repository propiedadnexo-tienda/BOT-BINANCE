# Investigación de estrategias con datos reales de Binance Futuros

Generado: 2026-09-30T15:46:11.360Z

Saldo de referencia 5000 USDT · riesgo 1 % por operación · tope 5x · comisión+deslizamiento 0.06% por lado.
Entrenamiento: meses anteriores a 2026-07-01 · Validación: desde esa fecha (3 meses).

Datos: BTCUSDT|15m (26112 velas, 2026-01-01→2026-09-29), BTCUSDT|1h (6528 velas, 2026-01-01→2026-09-29), BTCUSDT|4h (1632 velas, 2026-01-01→2026-09-29), ETHUSDT|15m (26112 velas, 2026-01-01→2026-09-29), ETHUSDT|1h (6528 velas, 2026-01-01→2026-09-29), ETHUSDT|4h (1632 velas, 2026-01-01→2026-09-29), SOLUSDT|15m (26112 velas, 2026-01-01→2026-09-29), SOLUSDT|1h (6528 velas, 2026-01-01→2026-09-29), SOLUSDT|4h (1632 velas, 2026-01-01→2026-09-29), BNBUSDT|15m (26112 velas, 2026-01-01→2026-09-29), BNBUSDT|1h (6528 velas, 2026-01-01→2026-09-29), BNBUSDT|4h (1632 velas, 2026-01-01→2026-09-29), XRPUSDT|15m (26112 velas, 2026-01-01→2026-09-29), XRPUSDT|1h (6528 velas, 2026-01-01→2026-09-29), XRPUSDT|4h (1632 velas, 2026-01-01→2026-09-29), DOGEUSDT|15m (26112 velas, 2026-01-01→2026-09-29), DOGEUSDT|1h (6528 velas, 2026-01-01→2026-09-29), DOGEUSDT|4h (1632 velas, 2026-01-01→2026-09-29), NVDAUSDT|15m (17990 velas, 2026-03-26→2026-09-29), NVDAUSDT|1h (4498 velas, 2026-03-26→2026-09-29), NVDAUSDT|4h (1125 velas, 2026-03-26→2026-09-29), TSLAUSDT|15m (23462 velas, 2026-01-28→2026-09-29), TSLAUSDT|1h (5866 velas, 2026-01-28→2026-09-29), TSLAUSDT|4h (1467 velas, 2026-01-28→2026-09-29)

## Todas las variantes (suma de todos los activos, Long y Short)

| Variante | Velas | Ops entr. | PF entr. | PnL entr. | Máx. caída entr. | Ops valid. | Win % valid. | PF valid. | PnL valid. | Máx. caída valid. |
|---|---|---|---|---|---|---|---|---|---|---|
| F_cruce_20_50_200_atr2 | 1h | 341 | 1.13 | 1019 | 1457 | 205 | 31 | 0.82 | -747 | 1166 |
| B_cruce_filtro200_atr | 1h | 649 | 1.05 | 566 | 1588 | 399 | 27 | 0.66 | -2133 | 2183 |
| B_cruce_filtro200_atr | 4h | 149 | 1.08 | 298 | 966 | 112 | 28 | 0.84 | -434 | 784 |
| C_tendencia_200_atr15 | 4h | 366 | 1.03 | 260 | 2412 | 248 | 27 | 0.73 | -1818 | 2339 |
| D_tendencia_200_atr2 | 4h | 291 | 0.98 | -178 | 1917 | 210 | 25 | 0.65 | -1985 | 2616 |
| E_tend_20_50_200_atr2 | 4h | 227 | 0.97 | -201 | 1708 | 153 | 25 | 0.64 | -1850 | 2355 |
| A_cruce_basico | 4h | 332 | 0.97 | -268 | 2090 | 219 | 30 | 0.86 | -714 | 1332 |
| D_tendencia_200_atr2 | 1h | 1337 | 0.99 | -297 | 4299 | 794 | 28 | 0.83 | -2308 | 3162 |
| F_cruce_20_50_200_atr2 | 4h | 78 | 0.84 | -416 | 839 | 53 | 21 | 0.47 | -1042 | 1212 |
| A_cruce_basico | 1h | 1288 | 0.97 | -610 | 1890 | 781 | 27 | 0.91 | -1117 | 2752 |
| E_tend_20_50_200_atr2 | 1h | 1089 | 0.97 | -926 | 5231 | 618 | 29 | 0.80 | -2656 | 3772 |
| C_tendencia_200_atr15 | 1h | 1695 | 0.97 | -1029 | 4435 | 976 | 28 | 0.79 | -3196 | 3615 |
| F_cruce_20_50_200_atr2 | 15m | 1463 | 0.72 | -5458 | 5745 | 842 | 28 | 0.60 | -4071 | 4071 |
| B_cruce_filtro200_atr | 15m | 3082 | 0.69 | -9272 | 9349 | 1686 | 29 | 0.66 | -4822 | 5210 |
| E_tend_20_50_200_atr2 | 15m | 4336 | 0.79 | -13256 | 13484 | 2369 | 30 | 0.76 | -6789 | 7209 |
| D_tendencia_200_atr2 | 15m | 5832 | 0.73 | -18888 | 18976 | 3264 | 28 | 0.67 | -10844 | 10978 |
| A_cruce_basico | 15m | 5845 | 0.73 | -18933 | 19527 | 3174 | 22 | 0.66 | -10972 | 11182 |
| C_tendencia_200_atr15 | 15m | 7250 | 0.69 | -24334 | 24427 | 4009 | 29 | 0.65 | -12792 | 12955 |

## Detalle por bot: F_cruce_20_50_200_atr2 1h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 17 | 1.40 | 124 | 13 | 0.90 | -21 |
| BTCUSDT | SHORT | 23 | 1.21 | 99 | 8 | 1.56 | 67 |
| ETHUSDT | LONG | 16 | 1.70 | 219 | 18 | 0.50 | -208 |
| ETHUSDT | SHORT | 31 | 0.93 | -47 | 13 | 0.60 | -126 |
| SOLUSDT | LONG | 18 | 1.07 | 31 | 17 | 1.00 | -2 |
| SOLUSDT | SHORT | 25 | 0.93 | -54 | 8 | 1.24 | 40 |
| BNBUSDT | LONG | 19 | 2.04 | 276 | 20 | 0.79 | -73 |
| BNBUSDT | SHORT | 20 | 1.33 | 123 | 11 | 0.21 | -200 |
| XRPUSDT | LONG | 26 | 0.75 | -174 | 12 | 0.46 | -199 |
| XRPUSDT | SHORT | 30 | 0.81 | -159 | 15 | 1.61 | 137 |
| DOGEUSDT | LONG | 25 | 1.14 | 98 | 14 | 0.62 | -125 |
| DOGEUSDT | SHORT | 40 | 1.27 | 265 | 16 | 0.70 | -122 |
| NVDAUSDT | LONG | 9 | 1.27 | 40 | 11 | 1.23 | 45 |
| NVDAUSDT | SHORT | 9 | 0.64 | -71 | 14 | 1.15 | 31 |
| TSLAUSDT | LONG | 12 | 0.85 | -45 | 7 | 1.28 | 27 |
| TSLAUSDT | SHORT | 21 | 2.21 | 295 | 8 | 0.87 | -18 |

## Detalle por bot: B_cruce_filtro200_atr 1h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 39 | 1.27 | 153 | 30 | 0.56 | -184 |
| BTCUSDT | SHORT | 63 | 0.71 | -318 | 16 | 0.94 | -11 |
| ETHUSDT | LONG | 29 | 1.01 | 6 | 40 | 0.73 | -164 |
| ETHUSDT | SHORT | 56 | 1.02 | 19 | 16 | 0.00 | -320 |
| SOLUSDT | LONG | 36 | 1.20 | 137 | 26 | 0.86 | -69 |
| SOLUSDT | SHORT | 43 | 1.13 | 114 | 21 | 1.32 | 87 |
| BNBUSDT | LONG | 43 | 1.53 | 275 | 34 | 0.72 | -138 |
| BNBUSDT | SHORT | 45 | 1.01 | 10 | 20 | 0.24 | -251 |
| XRPUSDT | LONG | 30 | 0.58 | -241 | 22 | 0.58 | -240 |
| XRPUSDT | SHORT | 66 | 1.01 | 14 | 32 | 0.50 | -258 |
| DOGEUSDT | LONG | 32 | 1.70 | 354 | 27 | 0.34 | -412 |
| DOGEUSDT | SHORT | 54 | 1.23 | 270 | 32 | 0.90 | -49 |
| NVDAUSDT | LONG | 30 | 1.06 | 20 | 24 | 1.25 | 60 |
| NVDAUSDT | SHORT | 15 | 0.30 | -176 | 18 | 0.44 | -134 |
| TSLAUSDT | LONG | 25 | 0.92 | -27 | 17 | 1.25 | 40 |
| TSLAUSDT | SHORT | 43 | 0.90 | -46 | 24 | 0.66 | -90 |

## Detalle por bot: B_cruce_filtro200_atr 4h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 7 | 1.93 | 123 | 8 | 0.62 | -89 |
| BTCUSDT | SHORT | 15 | 1.43 | 131 | 6 | 0.27 | -132 |
| ETHUSDT | LONG | 7 | 0.83 | -40 | 16 | 0.92 | -33 |
| ETHUSDT | SHORT | 16 | 0.74 | -137 | 1 | 0.00 | -52 |
| SOLUSDT | LONG | 5 | 0.00 | -227 | 8 | 1.19 | 39 |
| SOLUSDT | SHORT | 19 | 0.92 | -40 | 4 | 1.30 | 22 |
| BNBUSDT | LONG | 5 | 0.68 | -38 | 10 | 2.57 | 204 |
| BNBUSDT | SHORT | 14 | 0.79 | -76 | 9 | 0.61 | -81 |
| XRPUSDT | LONG | 6 | 3.07 | 190 | 4 | 2.54 | 119 |
| XRPUSDT | SHORT | 11 | 0.83 | -60 | 8 | 1.65 | 99 |
| DOGEUSDT | LONG | 6 | 1.86 | 135 | 2 | 4.84 | 78 |
| DOGEUSDT | SHORT | 15 | 0.96 | -17 | 11 | 0.43 | -148 |
| NVDAUSDT | LONG | 4 | 2.16 | 88 | 11 | 0.42 | -160 |
| NVDAUSDT | SHORT | 3 | 0.89 | -7 | 3 | 0.00 | -84 |
| TSLAUSDT | LONG | 4 | 1.70 | 67 | 6 | 0.42 | -98 |
| TSLAUSDT | SHORT | 12 | 1.97 | 204 | 5 | 0.34 | -117 |
