# 🌿 Elfis Garten

Kleine private Web-App (PWA) für Elfis Garten in Loitz:

- **Pflanze fotografieren:** Name, Stadium, Krankheiten (Bio-Mittel zuerst) und Pflegetipps
- **Fragen zum Foto:** tippen oder per Mikrofon, Antworten auch vorlesen lassen
- **Mein Garten:** Sammlung mit Foto-Verlauf pro Pflanze
- **Wetter-Hinweise:** Frost (Kübelpflanzen rein), Frühjahr (wieder raus), Sturm, Regen
- **Gartenplan:** geführter Rundgang mit der Kamera, daraus zeichnet Gemini einen Plan mit Gebäuden, Wegen, Bäumen und Pflanzen. Echte Maße und Messen sind möglich.
- **Sicherung:** per E-Mail teilen, mit Erinnerung

Alles kostenlos:
- **Bilderkennung:** Google Gemini API (Gratis-Kontingent). Der Schlüssel wird nur auf dem Gerät gespeichert und steht **nicht** in diesem Code. Eingerichtet wird er in der App unter ⚙️ oder über einen privaten Einrichtungs-Link.
- **Wetter:** Open-Meteo
- **Daten:** nur im Browser des Handys (IndexedDB)
- **Hosting:** GitHub Pages

## Lokal testen
```bash
node tools/serve.mjs
```
Dann http://localhost:8080 öffnen.

## Aufs Handy
Die Adresse in Chrome öffnen und über ⋮ „Zum Startbildschirm hinzufügen“ wählen.

## Aufbau
- `js/app.js`: Seiten, Abläufe, Sicherung
- `js/planview.js`: Rundgang und Gartenplan
- `js/plan.js`: Plan-Datenmodell, Maßstab, Zeichnen
- `js/gemini.js`: Pflanzenanalyse, Gartenplan, Rückfragen
- `js/weather.js`: Wetter, Symbole, Hinweise
- `js/config.js`: Name und Standort
