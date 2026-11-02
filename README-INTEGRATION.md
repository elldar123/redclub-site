# REDX × API LX inteqrasiyası

## Hazır olanlar

- `server.js` — frontend-i və API route-ları birlikdə işə salır.
- `GET /api/health` — token konfiqurasiyasını yoxlayır.
- `GET /api/providers` — provider siyahısı.
- `POST /api/launch` — server tərəfdən oyun launch sorğusu.
- `POST /api/callback/apilx` — API LX callback qəbul edən endpoint.
- `.env.example` — gizli konfiqurasiya şablonu.

## API LX-dən alınmalı məlumatlar

1. İnteqrasiya tokeni.
2. Dəqiq `base URL`, launch və games endpoint-ləri.
3. Callback imza/validasiya qaydası.
4. Tələb olunan valyuta (məsələn `USD`).
5. Operator ID və player/wallet API formatı.
6. Ölkə məhdudiyyətləri və production icazəsi.

## İşə salmaq

1. `.env.example` faylını `.env` adı ilə kopyala.
2. API LX-dən alınan tokeni yalnız `.env` daxilində yaz.
3. `APILX_LAUNCH_PATH` və digər endpoint-ləri sənəddəki real route-larla əvəz et.
4. Terminalda `node server.js` işə sal.
5. `http://localhost:5500/api/health` ünvanında statusu yoxla.

## Render-də canlı deploy

1. `https://render.com` hesabı yarat və GitHub repository-ni qoş.
2. `New Blueprint` seçib `render.yaml` faylını istifadə et.
3. `sync: false` olan 12 secret sahəsini Render Environment bölməsinə əlavə et.
4. Deploy tamamlandıqdan sonra Render-in verdiyi custom domain bölməsində `redplayco.com` əlavə et.
5. Cloudflare-də GitHub Pages A record-larını Render-in verdiyi CNAME ilə əvəz et.
6. Deploy-dan sonra `https://redplayco.com/api/health` ünvanında `configured: true` yoxla.

Tokeni HTML/JavaScript faylına yazmaq olmaz. Callback-də signature yoxlanmadan balans artırmaq olmaz. Production-dan əvvəl KYC, yaş yoxlaması, restricted territories, responsible gaming və yerli lisenziya tələbləri ayrıca təsdiqlənməlidir.
