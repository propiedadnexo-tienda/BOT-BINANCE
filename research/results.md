# Investigación de estrategias con datos reales de Binance Futuros

Generado: 2026-09-30T15:53:18.922Z

Saldo de referencia 5000 USDT · riesgo 1 % por operación · tope 5x · comisión+deslizamiento 0.06% por lado.
Entrenamiento: meses anteriores a 2026-04-01 · Validación: desde esa fecha (6 meses).

Datos: BTCUSDT|1h (15288 velas, 2025-01-01→2026-09-29), BTCUSDT|4h (3822 velas, 2025-01-01→2026-09-29), ETHUSDT|1h (15288 velas, 2025-01-01→2026-09-29), ETHUSDT|4h (3822 velas, 2025-01-01→2026-09-29), SOLUSDT|1h (15288 velas, 2025-01-01→2026-09-29), SOLUSDT|4h (3822 velas, 2025-01-01→2026-09-29), BNBUSDT|1h (15288 velas, 2025-01-01→2026-09-29), BNBUSDT|4h (3822 velas, 2025-01-01→2026-09-29), XRPUSDT|1h (15288 velas, 2025-01-01→2026-09-29), XRPUSDT|4h (3822 velas, 2025-01-01→2026-09-29), DOGEUSDT|1h (15288 velas, 2025-01-01→2026-09-29), DOGEUSDT|4h (3822 velas, 2025-01-01→2026-09-29), NVDAUSDT|1h (4498 velas, 2026-03-26→2026-09-29), NVDAUSDT|4h (1125 velas, 2026-03-26→2026-09-29), TSLAUSDT|1h (5866 velas, 2026-01-28→2026-09-29), TSLAUSDT|4h (1467 velas, 2026-01-28→2026-09-29)

## Todas las variantes (suma de todos los activos, Long y Short)

| Variante | Velas | Ops entr. | PF entr. | PnL entr. | Máx. caída entr. | Ops valid. | Win % valid. | PF valid. | PnL valid. | Máx. caída valid. | PnL valid. LONG | PnL valid. SHORT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BO_20_10_trail3_f200 | 1h | 1677 | 1.10 | 3735 | 4399 | 884 | 32 | 1.01 | 221 | 2513 | 2307 | -2085 |
| BO_20_10_trail3 | 1h | 2190 | 1.07 | 3426 | 4993 | 1114 | 33 | 1.01 | 156 | 3100 | 2689 | -2533 |
| BO_20_10_trail3_f200 | 4h | 362 | 1.31 | 2719 | 1323 | 216 | 24 | 1.04 | 231 | 2209 | 607 | -376 |
| BO_55_20_trail3 | 1h | 1069 | 1.10 | 2636 | 3267 | 570 | 29 | 1.01 | 113 | 3283 | 1209 | -1096 |
| BO_55_20_trail3_f200 | 1h | 982 | 1.10 | 2317 | 2941 | 530 | 28 | 1.02 | 221 | 3235 | 1258 | -1037 |
| BO_55_20_trail3_f200 | 4h | 207 | 1.43 | 2097 | 1037 | 121 | 31 | 1.02 | 73 | 1223 | -41 | 114 |
| MR_bb20_2_f200 | 4h | 224 | 1.49 | 1816 | 512 | 117 | 64 | 1.33 | 640 | 600 | 524 | 116 |
| EMA_cruce_20_50_200 | 4h | 154 | 1.35 | 1495 | 807 | 102 | 27 | 0.74 | -890 | 1263 | 46 | -936 |
| BO_20_10_trail3 | 4h | 534 | 1.10 | 1450 | 2025 | 282 | 27 | 0.96 | -301 | 2321 | 745 | -1045 |
| BO_55_20_trail3 | 4h | 253 | 1.16 | 1065 | 1405 | 139 | 32 | 0.98 | -67 | 1188 | 20 | -87 |
| MR_bb20_2_rsi30_f200 | 4h | 22 | 1.72 | 296 | 262 | 15 | 47 | 0.74 | -103 | 340 | -39 | -64 |
| MR_bb20_2_rsi30_f200 | 1h | 96 | 0.85 | -265 | 672 | 65 | 62 | 1.47 | 289 | 112 | 85 | 204 |
| MR_bb20_25_sinfiltro | 4h | 362 | 0.81 | -1604 | 2503 | 182 | 58 | 0.93 | -276 | 1307 | -366 | 90 |
| MR_bb20_2_f200 | 1h | 825 | 0.83 | -2493 | 3266 | 489 | 52 | 0.75 | -1798 | 1818 | -672 | -1125 |
| EMA_cruce_20_50_200 | 1h | 768 | 0.83 | -3611 | 5322 | 402 | 33 | 0.93 | -616 | 1208 | -299 | -317 |
| MR_bb20_25_sinfiltro | 1h | 1358 | 0.74 | -7256 | 7397 | 768 | 57 | 0.94 | -769 | 1972 | 443 | -1213 |

## Detalle por bot: BO_20_10_trail3_f200 1h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 143 | 0.67 | -851 | 56 | 1.42 | 323 |
| BTCUSDT | SHORT | 142 | 0.93 | -190 | 54 | 0.60 | -355 |
| ETHUSDT | LONG | 128 | 1.14 | 435 | 54 | 1.42 | 474 |
| ETHUSDT | SHORT | 136 | 1.07 | 247 | 49 | 0.49 | -538 |
| SOLUSDT | LONG | 133 | 0.96 | -142 | 54 | 1.72 | 801 |
| SOLUSDT | SHORT | 153 | 1.08 | 297 | 52 | 0.64 | -380 |
| BNBUSDT | LONG | 134 | 1.37 | 765 | 59 | 1.27 | 229 |
| BNBUSDT | SHORT | 144 | 0.80 | -713 | 47 | 0.86 | -108 |
| XRPUSDT | LONG | 101 | 1.75 | 1676 | 49 | 1.70 | 668 |
| XRPUSDT | SHORT | 153 | 1.05 | 184 | 57 | 0.80 | -202 |
| DOGEUSDT | LONG | 112 | 1.50 | 1522 | 54 | 0.80 | -279 |
| DOGEUSDT | SHORT | 162 | 1.15 | 560 | 61 | 0.56 | -621 |
| NVDAUSDT | LONG | 0 | 0.00 | 0 | 70 | 1.18 | 143 |
| NVDAUSDT | SHORT | 0 | 0.00 | 0 | 42 | 0.82 | -114 |
| TSLAUSDT | LONG | 12 | 0.35 | -122 | 68 | 0.95 | -53 |
| TSLAUSDT | SHORT | 24 | 1.27 | 66 | 58 | 1.28 | 231 |

## Detalle por bot: BO_20_10_trail3 1h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 188 | 0.67 | -1121 | 65 | 1.45 | 384 |
| BTCUSDT | SHORT | 181 | 0.92 | -249 | 71 | 0.52 | -549 |
| ETHUSDT | LONG | 174 | 1.09 | 380 | 64 | 1.34 | 448 |
| ETHUSDT | SHORT | 164 | 1.15 | 604 | 65 | 0.51 | -630 |
| SOLUSDT | LONG | 182 | 1.00 | -19 | 63 | 1.88 | 969 |
| SOLUSDT | SHORT | 189 | 1.10 | 465 | 65 | 0.65 | -454 |
| BNBUSDT | LONG | 182 | 1.09 | 290 | 68 | 1.40 | 370 |
| BNBUSDT | SHORT | 186 | 0.74 | -1147 | 64 | 0.75 | -258 |
| XRPUSDT | LONG | 158 | 1.31 | 1108 | 64 | 1.73 | 827 |
| XRPUSDT | SHORT | 174 | 1.10 | 407 | 68 | 0.82 | -197 |
| DOGEUSDT | LONG | 169 | 1.42 | 1740 | 65 | 0.92 | -139 |
| DOGEUSDT | SHORT | 183 | 1.26 | 1084 | 67 | 0.70 | -412 |
| NVDAUSDT | LONG | 1 | 0.00 | -2 | 87 | 0.97 | -29 |
| NVDAUSDT | SHORT | 3 | 1.35 | 15 | 67 | 0.72 | -276 |
| TSLAUSDT | LONG | 24 | 0.57 | -157 | 91 | 0.89 | -142 |
| TSLAUSDT | SHORT | 32 | 1.06 | 27 | 80 | 1.20 | 241 |

## Detalle por bot: BO_20_10_trail3_f200 4h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 28 | 1.19 | 139 | 15 | 1.45 | 183 |
| BTCUSDT | SHORT | 33 | 1.21 | 162 | 9 | 1.81 | 198 |
| ETHUSDT | LONG | 24 | 3.19 | 1214 | 19 | 1.12 | 78 |
| ETHUSDT | SHORT | 29 | 1.34 | 229 | 9 | 1.87 | 249 |
| SOLUSDT | LONG | 25 | 1.13 | 75 | 19 | 1.18 | 110 |
| SOLUSDT | SHORT | 38 | 0.87 | -130 | 11 | 0.90 | -34 |
| BNBUSDT | LONG | 30 | 1.35 | 226 | 17 | 1.16 | 75 |
| BNBUSDT | SHORT | 28 | 0.93 | -46 | 10 | 0.45 | -175 |
| XRPUSDT | LONG | 25 | 1.54 | 413 | 15 | 1.35 | 195 |
| XRPUSDT | SHORT | 38 | 1.04 | 37 | 15 | 0.64 | -141 |
| DOGEUSDT | LONG | 23 | 1.49 | 347 | 12 | 1.37 | 138 |
| DOGEUSDT | SHORT | 37 | 0.99 | -10 | 10 | 1.10 | 30 |
| NVDAUSDT | LONG | 0 | 0.00 | 0 | 11 | 2.08 | 180 |
| NVDAUSDT | SHORT | 0 | 0.00 | 0 | 11 | 0.53 | -174 |
| TSLAUSDT | LONG | 0 | 0.00 | 0 | 16 | 0.36 | -352 |
| TSLAUSDT | SHORT | 4 | 2.60 | 63 | 17 | 0.40 | -330 |

## Detalle por bot: BO_55_20_trail3 1h

| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |
|---|---|---|---|---|---|---|---|
| BTCUSDT | LONG | 93 | 0.66 | -634 | 38 | 0.98 | -17 |
| BTCUSDT | SHORT | 90 | 0.89 | -230 | 31 | 1.06 | 32 |
| ETHUSDT | LONG | 85 | 1.14 | 308 | 35 | 1.23 | 193 |
| ETHUSDT | SHORT | 82 | 1.32 | 703 | 27 | 1.05 | 32 |
| SOLUSDT | LONG | 87 | 0.86 | -302 | 36 | 1.20 | 185 |
| SOLUSDT | SHORT | 91 | 1.39 | 846 | 35 | 0.84 | -155 |
| BNBUSDT | LONG | 90 | 0.91 | -152 | 38 | 1.32 | 208 |
| BNBUSDT | SHORT | 88 | 0.72 | -630 | 27 | 0.96 | -21 |
| XRPUSDT | LONG | 70 | 1.78 | 1332 | 28 | 2.00 | 624 |
| XRPUSDT | SHORT | 91 | 1.00 | 8 | 37 | 0.68 | -306 |
| DOGEUSDT | LONG | 80 | 1.37 | 868 | 30 | 1.00 | -4 |
| DOGEUSDT | SHORT | 93 | 1.29 | 596 | 33 | 0.63 | -318 |
| NVDAUSDT | LONG | 1 | 0.00 | -18 | 50 | 0.97 | -20 |
| NVDAUSDT | SHORT | 2 | 0.00 | -58 | 42 | 0.47 | -468 |
| TSLAUSDT | LONG | 8 | 0.44 | -59 | 44 | 1.05 | 40 |
| TSLAUSDT | SHORT | 18 | 1.21 | 60 | 39 | 1.17 | 108 |
