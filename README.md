# 🌿 Garten-App

Kleine private Web-App (PWA) für einen großen Garten:

- **Pflanze fotografieren:** Name und Steckbrief (Blütezeit, Früchte, Aussaat, Ableger); Krankheits-Tipps nur, wenn wirklich etwas zu sehen ist
- **Fragen zum Foto:** tippen oder per Mikrofon, Antworten auch vorlesen lassen
- **Mein Garten:** Sammlung mit Foto-Verlauf pro Pflanze
- **Wetter-Hinweise:** Frost (Kübelpflanzen rein), Frühjahr (wieder raus), Sturm, Regen
- **Gartenplan:** geführter Rundgang mit der Kamera, daraus zeichnet Gemini einen Plan mit Gebäuden, Wegen, Bäumen und Pflanzen. Echte Maße und Messen sind möglich.
- **Sicherung:** per E-Mail teilen, mit Erinnerung

Persönliche Angaben stehen **nicht** in diesem Code: Name und Garten-Standort fragt die App beim ersten Öffnen ab und speichert sie nur auf dem Gerät. Dasselbe gilt für den Gemini-Schlüssel, der über die Einstellungen oder einen privaten Einrichtungs-Link eingetragen wird.

Alles kostenlos: Google Gemini (Gratis-Kontingent), Open-Meteo (Wetter), OpenStreetMap (Adresssuche), GitHub Pages (Hosting).

## Lokal testen
```bash
node tools/serve.mjs
```
Dann http://localhost:8080 öffnen.

## Aufbau
- `js/app.js`: Seiten, Einrichtung, Abläufe, Sicherung
- `js/planview.js`: Rundgang und Gartenplan
- `js/plan.js`: Plan-Datenmodell, Maßstab, Zeichnen
- `js/gemini.js`: Pflanzenanalyse, Gartenplan, Rückfragen
- `js/weather.js`: Wetter, Symbole, Hinweise, Adresssuche
- `css/style.css`, `css/jade.css`: Gestaltung (Jade-Glas) und Animationen
