# Bot Binance — app Android

App para el celular que muestra el mercado, permite operar a mano y ejecuta un **bot automático** en Binance Spot. Empieza en **Testnet** (dinero ficticio) y se cambia a cuenta real desde Ajustes.

## Qué hace

| Pestaña | Función |
|---|---|
| 📊 Mercado | Precio, variación 24h y gráfico de velas con EMA rápida/lenta, RSI y las entradas/salidas del bot |
| 💱 Operar | Órdenes manuales (mercado o límite), órdenes abiertas con botón cancelar, saldos |
| 🤖 Bot | Configuración de la estrategia, backtest con 1000 velas, estado en vivo, posición, historial y registro |
| ⚙️ Ajustes | Testnet / Real y claves API de cada entorno |

### Estrategia del bot
- **Compra** (a mercado, monto fijo) cuando la EMA rápida cruza por encima de la lenta en una vela **cerrada** y el RSI está por debajo del máximo configurado.
- Al comprar coloca una **orden OCO en Binance** con take-profit y stop-loss. Esa orden vive en el exchange: te protege aunque cierres la app o el celular se apague.
- **Vende** en el cruce bajista (cancela la OCO y vende a mercado) o cuando Binance ejecuta el TP/SL.
- Límites de seguridad: máximo de operaciones por día y pérdida diaria máxima (detiene el bot).
- Todos los parámetros son editables. Valores por defecto: BTCUSDT, velas 15m, EMA 9/21, RSI 14 < 70, 20 USDT por operación, SL 1.5 %, TP 3 %.

## 🧠 Plan de Claude (estrategia validada con datos reales)

Se probaron 24 combinaciones de estrategias con **datos reales de Binance Futuros** (ene 2025 – sep 2026, 8 activos,
comisiones y deslizamiento incluidos), eligiendo con los primeros 15 meses y **confirmando** con los últimos 6.
Resultados completos en [`research/results.md`](research/results.md) (se regeneran con la acción *Investigar estrategias*).

| Estrategia | Velas | Factor de ganancia (entrenamiento → validación) |
|---|---|---|
| Cruce de medias (la original) | 15m / 1h / 4h | pierde en validación en todas las variantes |
| Ruptura + trailing | 1h / 4h | 1.10–1.43 → ≈1.0 (sin ventaja clara) |
| **Rebote a la media + filtro EMA 200** | **4h** | **1.49 → 1.33** ✅ |

El plan crea 10 bots (BTC, ETH, SOL, BNB, XRP × Long/Short) con esa estrategia:
- Entra cuando el precio cierra fuera de la banda de Bollinger (20, 2σ) **a favor** de la tendencia de fondo (EMA 200).
- Sale al volver a la media, por tiempo (30 velas) o por stop-loss de 2×ATR colocado en Binance.
- Tamaño por riesgo: **1 % del saldo** si toca el stop. Máx. 6 posiciones a la vez. Se detiene si pierde 3 % en un día.
- Opera poco (varias veces por semana entre los 10 bots): es normal pasar horas sin operaciones.

## Modo Futuros: varios bots Long y Short
En **Ajustes → Mercado → Futuros** puedes tener **hasta 10 bots a la vez** sobre contratos perpetuos USDⓈ-M,
de **criptomonedas y acciones** (Tesla, NVIDIA, Apple, Meta, Google, Microsoft, Amazon… según disponibilidad en tu cuenta).

- Cada bot opera **un activo** en **una dirección**:
  - **Bot LONG** (gana si sube): abre en el cruce alcista de EMAs (si RSI < límite) y cierra en el cruce bajista.
  - **Bot SHORT** (gana si baja): abre en el cruce bajista (si RSI > límite) y cierra en el cruce alcista.
- **⚡ Crear Long + Short** crea los dos bots de un activo en un toque. **＋ Agregar bot** crea uno a medida.
- 🔍 **Selector de activos** con buscador y pestañas **Cripto / Acciones**, con precio y variación de 24 h.
- La cuenta se pone en **modo cobertura (hedge)** para que Long y Short del mismo activo convivan.
- Cada posición lleva su **stop-loss y take-profit en Binance** (Algo Orders). Cancelar la protección de un bot no toca la de su pareja.
- **Pérdida máxima del día** global: si la suma de todos los bots la alcanza, se detienen todos.
- Binance usa **un solo apalancamiento por activo**: el bot Long y el Short de un mismo activo comparten el apalancamiento.
- Claves de prueba: **Demo Trading** (`demo.binance.com` → Futuros → Gestión de API).

⚠️ El apalancamiento multiplica ganancias **y pérdidas**. Con 10 bots × 100 USDT necesitas ~1000 USDT de margen disponible.

### Importante: cuándo corre el bot
Android pausa las apps en segundo plano, así que **el bot revisa el mercado solo mientras la app está abierta**; mientras corre, la app mantiene la pantalla encendida. Lo recomendable es dejar el celular cargando con la app abierta. Si la cierras, la OCO sigue protegiendo la posición abierta, y al volver a abrir la app el bot se reanuda solo.

## 1. Obtener claves de Testnet
1. Entra a **https://testnet.binance.vision** e inicia sesión con GitHub.
2. *Generate HMAC-SHA-256 Key* → copia la API Key y la Secret Key (el Secret solo se muestra una vez).
3. En la app: **Ajustes → Testnet → pega las claves → Guardar y probar**. Testnet te da saldo ficticio (USDT, BTC, etc.).

Para la cuenta real: Binance → Perfil → **Gestión de API** → crea una clave con **solo** “Habilitar trading Spot y Margin”. **Nunca** actives retiros.

## 2. Compilar el APK

### Opción A — en la nube con GitHub (sin instalar Android Studio)
1. Crea un repositorio en GitHub y sube esta carpeta completa (incluida `.github/`).
2. Ve a la pestaña **Actions** → *Compilar APK* → **Run workflow**.
3. Cuando termine (~5 min), abre la ejecución y descarga **bot-binance-apk**. Dentro está `app-debug.apk`.
4. Pásalo al celular e instálalo (permite “instalar apps de origen desconocido”).

### Opción B — en tu PC con Android Studio
Requisitos: Node.js 20+, Android Studio (incluye el SDK y Java).
```bash
npm install
npx cap add android
npx cap sync android
npx cap open android
```
En Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. El archivo queda en `android/app/build/outputs/apk/debug/app-debug.apk`.
También puedes conectar el celular por USB (depuración USB activada) y darle ▶ Run.

Cada vez que cambies algo en `www/`, ejecuta `npx cap sync android` antes de recompilar.

### Probar la interfaz en el navegador
```bash
npx serve www
```
Nota: en el navegador algunas llamadas pueden fallar por CORS; en el APK no pasa porque las peticiones salen por HTTP nativo.

## Estructura
```
www/
  index.html        Interfaz (4 pestañas)
  css/styles.css
  js/binance.js     Cliente REST firmado (HMAC-SHA256), redondeos por filtros del par, OCO
  js/indicators.js  EMA, RSI, señal de cruce y backtest
  js/bot.js         Motor del bot, límites y persistencia
  js/chart.js       Gráfico de velas en canvas (funciona sin internet para librerías)
  js/app.js         Lógica de la interfaz
capacitor.config.json
.github/workflows/build-apk.yml
```

## Antes de usar dinero real
- Deja el bot varios días en Testnet y compara con el backtest.
- Empieza con montos pequeños. Ninguna estrategia garantiza ganancias; el cruce de medias pierde en mercados laterales.
- Las claves se guardan solo en el teléfono (almacenamiento local de la app).
