# ShuttleSync classroom prototype

ShuttleSync is a Mapúa MCL shuttle-tracking coursework prototype built with Express, Socket.IO, and Leaflet. It demonstrates separate student and driver roles, five existing routes, server-authorized live location updates, and a simulated payment receipt flow. It is **not** a production dispatch, payment, or driver-safety system.

## Run locally

Requirements: Node.js 20+ and npm.

```sh
cd /home/hermes/Misc/TEC101_SHUTTLESYNC
npm install
cp .env.example .env
```

For the simple local demo, the copied `.env.example` credentials are Student ID `student1` / password `student123`, and Driver ID `driver1` / password `driver123`. They are intentionally easy classroom-only credentials, not safe for production; change them for any shared or deployed use. Keep `.env` private and do not upload it or commit it.

```sh
npm start
```

Open **http://localhost:3000**. To run the automated checks, use `npm test` in another terminal. The server listens on port 3000 by default; set `PORT` in `.env` to change it.

## Location and map

- The Leaflet map uses OpenStreetMap tiles and remains usable without a traffic-provider key.
- Current ETA/traffic behavior is explicitly labeled demo data; no live traffic source is enabled by default.
- Drivers must opt in to browser geolocation and allow location sharing. They can stop sharing by going offline. A location permission denial prevents real GPS updates; the classroom demo option is identified separately in the interface.
- Commuters can select a route manually and do not need to share their own location.
- Browser geolocation works on `localhost` for local development. A phone opening the app from a computer's LAN address usually needs a trusted HTTPS origin for GPS permissions; `http://<computer-LAN-IP>:3000` is not equivalent to localhost.

## Demo accounts and routes

The demo credentials are configured in `.env` and checked on the server. The five route IDs are `calamba`, `sta-rosa`, `binan`, `san-pedro`, and `carmona`. Do not add real student passwords or account records to client-side code.

## Fares and simulated payments

Fares remain provisional until confirmed by the shuttle operator or instructor. With `FARES_CONFIRMED=false` and blank `FARE_*` values, the app must present fares as unconfirmed. The mock checkout accepts a method choice only: it must not request card numbers, e-wallet credentials, or other payment secrets. Receipts and trip history are simulated and held in server memory; no real payment is taken, and records disappear when the server restarts.

## Prototype limits

- Sessions, route state, passenger counts, and trip history are in-memory and reset on restart.
- Login throttling and sessions are classroom-demo controls, not production authentication or abuse prevention.
- No production-grade identity, database, payment processing, real emergency dispatch, or operational safety assurance is provided.
- Traffic tiles and traffic-aware routing require a future verified, configured provider integration. Do not treat demo ETA as a live arrival promise.
