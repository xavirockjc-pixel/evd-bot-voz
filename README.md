# Voz para el bot de Telegram · Él Va Delante

Convierte **texto → nota de voz** (OGG/Opus) con voz neuronal **gratis** (edge-tts) y
publica la **Palabra del día en texto + voz** a tu canal de Telegram **sin n8n**.
Sin API key externa, sin costo por carácter, sin gasto de API de Claude en el día a día.

Voz por defecto: **es-CL-LorenzoNeural** (chileno, masculino).
Femenina: `es-CL-CatalinaNeural`. Otras: `es-MX-JorgeNeural`, `es-US-AlonsoNeural`.

---

## Qué hace
- `GET  /health` → `ok`
- `POST /tts` `{text, voice?, rate?, pitch?, format?}` → devuelve audio (OGG o MP3).
- `POST /publish` `{text?}` → genera voz y **publica texto + voz** al canal.
  Si no mandas `text`, toma el **siguiente** devocional de `devocionales.json` (rota solo).

---

## 1) Desplegar en EasyPanel (195.200.5.103)
1. Sube esta carpeta `tts-bot-voz/` a un repo (o subcarpeta del repo del sitio).
2. EasyPanel → **Create → App** → fuente = ese repo/carpeta. Build = **Dockerfile**. Puerto **8080**.
3. **Variables de entorno:**
   - `TELEGRAM_TOKEN` = el token de tu bot (de @BotFather)
   - `TELEGRAM_CHAT`  = `@tu_canal` (o el id numérico)
   - `TTS_VOICE`      = `es-CL-LorenzoNeural`  (opcional)
   - `TTS_KEY`        = una clave inventada (opcional, protege /publish y /tts)
   - `DATA_DIR`       = `/data` si montas un volumen (para recordar qué devocional sigue)
4. Deploy. Prueba: abre `https://TU-SERVICIO/health` → `ok`.

> El token vive **solo** como variable en EasyPanel; nunca en el código ni en el chat.

---

## 2) Probar que publica (una vez desplegado)
```bash
curl -X POST https://TU-SERVICIO/publish \
  -H "content-type: application/json" \
  -H "x-api-key: TU_TTS_KEY" \
  -d '{"text":"Prueba: Dios va delante de ti. Descansa en Él."}'
```
Debe aparecer en el canal un mensaje con **texto + nota de voz**. La respuesta JSON
dirá `"sendVoice": 200` si salió bien.

---

## 3) Que se publique solo cada día (gratis, sin n8n)
Usa un cron gratuito externo (p. ej. **cron-job.org**):
1. Crea una cuenta gratis en cron-job.org.
2. Nuevo cronjob → URL `https://TU-SERVICIO/publish` → método **POST**.
3. Header `x-api-key: TU_TTS_KEY`. Body: `{}` (así toma el siguiente devocional).
4. Horario: la hora que quieras (ej. 08:00). ¡Listo! Cada día publica el siguiente.

> ¿Quieres 3 al día (como antes)? Crea 3 cronjobs a distintas horas.

---

## 4) El contenido diario (Claude = motor)
`devocionales.json` es la lista que rota. Viene con 8 de arranque. Cuando se acaben o
quieras renovarlos, Claude te genera un lote nuevo (cristocéntrico, tu voz, variados) y
se reemplaza el archivo. Así **no se gasta API en el día a día**: el contenido se produce
por lotes y el servicio solo publica.

---

## Alternativa: si algún día reactivas n8n
En tu flujo *Tema → Claude → Telegram*, tras generar el texto añade un **HTTP Request**
a `https://TU-SERVICIO/tts` (body `{"text":"={{ $json.devocional }}"}`, respuesta binaria)
y pásalo a un nodo **sendVoice** con `caption` = el texto. Pero con el modo del punto 3
**ya no necesitas n8n**.

---

## Ajustes
- Velocidad/tono: en el body, `"rate":"-8%"` (más lento) o `"pitch":"-2Hz"`.
- Cambiar voz para siempre: variable `TTS_VOICE` (sin tocar nada más).
- Textos muy largos (>1000): manda texto completo como mensaje y la voz aparte (el
  servicio ya lo hace automáticamente).
