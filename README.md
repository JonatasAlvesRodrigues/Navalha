# Barbearia Vanguarda - Full Stack

## 1) Banco
1. Garanta que o PostgreSQL está rodando.
2. Execute na ordem:
   - `schema_barbearia.sql`
   - `seed_barbearia.sql`
   - `migration_auth.sql`

## 2) Ambiente
1. Copie `.env.example` para `.env`.
2. Ajuste se necessário:
   - `DATABASE_URL=postgresql://postgres@localhost:5432/barbearia`
   - `JWT_SECRET=troque-este-segredo`
   - `OWNER_EMAIL=seu-email-de-dono@exemplo.com`
   - `OWNER_PASSWORD=troque-esta-senha`

## 3) Rodar app
- `npm install`
- `npm start`
- Abra `http://localhost:3000`

## Testes
- `npm test`

## Login de demonstração
- Barbeiro (admin): `carlos@barbearia.com` / `admin123`
- Cliente: `joao@email.com` / `cliente123`

## Endpoints principais
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/services`
- `GET /api/barbers`
- `GET /api/appointments/available-slots?barberId=1&date=2026-05-04`
- `POST /api/appointments` (requer token)
- `GET /api/gallery/:clientId`
- `GET /api/dashboard/summary`
- `GET /api/admin/appointments` (somente barbeiro)
- `PATCH /api/admin/appointments/:id/status` (somente barbeiro)

## Componente React + Tailwind (mobile premium)
Arquivos:
- `frontend/components/BookingMobilePremium.jsx`
- `frontend/components/BookingMobilePremiumExample.jsx`

Uso rápido:
```jsx
import BookingMobilePremium from "./components/BookingMobilePremium";

<BookingMobilePremium token={jwtToken} onBooked={(data) => console.log(data)} />
```

Esse componente já integra diretamente com:
- `GET /api/barbers`
- `GET /api/services`
- `GET /api/appointments/available-slots`
- `POST /api/appointments` (com `Authorization: Bearer <token>`)
