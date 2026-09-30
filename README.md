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
