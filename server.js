const express = require('express');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server: SocketServer } = require('socket.io');
require('dotenv').config({ quiet: true });

const ROUTES = {
  calamba: { id: 'calamba', name: 'Calamba Terminal', start: [14.1925, 121.1332], terminal: [14.2046, 121.1553], driver: { name: 'Eduardo Santos', vehicle: 'Toyota Hiace Commuter', plate: 'NDO 4521' } },
  'sta-rosa': { id: 'sta-rosa', name: 'Sta. Rosa Terminal', start: [14.2847, 121.0963], terminal: [14.2939, 121.1036], driver: { name: 'Ricardo Mendoza', vehicle: 'Mitsubishi L300 FB', plate: 'DWT 8832' } },
  binan: { id: 'binan', name: 'Biñan Terminal', start: [14.3223, 121.0805], terminal: [14.3313, 121.0801], driver: { name: 'Felipe Villanueva', vehicle: 'Nissan NV350 Urvan', plate: 'NGL 1024' } },
  'san-pedro': { id: 'san-pedro', name: 'San Pedro Terminal', start: [14.3615, 121.0489], terminal: [14.3562, 121.0427], driver: { name: 'Jose Garcia', vehicle: 'Toyota Hiace Grandia', plate: 'PQS 7750' } },
  carmona: { id: 'carmona', name: 'Carmona Terminal', start: [14.3060, 121.0366], terminal: [14.3148, 121.0543], driver: { name: 'Antonio Reyes', vehicle: 'Mitsubishi L300 Exceed', plate: 'WXY 9012' } }
};
const PAYMENT_METHODS = new Set(['cash', 'ewallet', 'card']);
const MAX_LOGIN_ATTEMPTS = 1000;
const LOGIN_ATTEMPT_TTL_MS = 30_000;

function distanceKm(a, b) {
  const rad = (v) => v * Math.PI / 180;
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const lat1 = rad(a[0]);
  const lat2 = rad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    const pad = Buffer.alloc(Math.max(1, left.length));
    crypto.timingSafeEqual(pad, pad);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function createAppServer(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const clock = options.clock || Date.now;
  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server);
  const sessions = new Map();
  const loginAttempts = new Map();
  const routeIds = Object.keys(ROUTES);
  const fares = Object.fromEntries(routeIds.map((route) => {
    const envKey = `FARE_${route.toUpperCase().replace('-', '_')}`;
    const value = env[envKey];
    const amount = value === undefined || value === '' ? null : Number(value);
    return [route, Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null];
  }));
  const fareConfirmed = String(env.FARES_CONFIRMED || '').toLowerCase() === 'true';
  const state = {
    waitingPassengers: Object.fromEntries(routeIds.map((id) => [id, 0])),
    lastPosition: Object.fromEntries(routeIds.map((id) => [id, null])),
    status: Object.fromEntries(routeIds.map((id) => [id, 'Waiting for shuttle'])),
    hasArrived: Object.fromEntries(routeIds.map((id) => [id, false])),
    capacity: Object.fromEntries(routeIds.map((id) => [id, 'Available'])),
    lastAnnouncement: Object.fromEntries(routeIds.map((id) => [id, null])),
    etaCache: new Map(),
    trips: [],
    lastSOS: Object.fromEntries(routeIds.map((id) => [id, null]))
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { index: false, dotfiles: 'deny' }));
  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

  function getAccount(role) {
    if (role === 'student') return { id: env.DEMO_STUDENT_ID || '2023150505', password: env.DEMO_STUDENT_PASSWORD || '' };
    if (role === 'driver') return { id: env.DEMO_DRIVER_ID || 'STAFF01', password: env.DEMO_DRIVER_PASSWORD || '' };
    return null;
  }
  function attemptKey(req, role, id) {
    const address = req.ip || req.socket?.remoteAddress || 'unknown';
    return `${address}|${String(role || '').toLowerCase()}|${String(id || '').trim().toLowerCase()}`;
  }
  function pruneLoginAttempts(now, newKey) {
    for (const [key, attempt] of loginAttempts) {
      if (attempt.expiresAt <= now) loginAttempts.delete(key);
    }
    if (!loginAttempts.has(newKey)) {
      while (loginAttempts.size >= MAX_LOGIN_ATTEMPTS) loginAttempts.delete(loginAttempts.keys().next().value);
    }
  }
  function authToken(req) {
    return String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  }

  app.post('/api/login', (req, res) => {
    const role = req.body?.role;
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = attemptKey(req, role, id);
    const now = clock();
    pruneLoginAttempts(now, key);
    let attempt = loginAttempts.get(key);
    if (attempt?.lockedUntil > now) return res.status(429).json({ error: 'Too many attempts. Please wait 30 seconds and try again.' });
    if (attempt?.lockedUntil && attempt.lockedUntil <= now) { loginAttempts.delete(key); attempt = null; }
    const account = getAccount(role);
    const valid = account && account.password && safeEqual(id, account.id) && safeEqual(password, account.password);
    if (!valid) {
      attempt = attempt || { failures: 0, lockedUntil: 0, expiresAt: 0 };
      attempt.failures += 1;
      attempt.expiresAt = now + LOGIN_ATTEMPT_TTL_MS;
      if (attempt.failures >= 3) attempt.lockedUntil = now + LOGIN_ATTEMPT_TTL_MS;
      loginAttempts.set(key, attempt);
      const locked = attempt.lockedUntil > now;
      return res.status(401).json({ error: locked ? 'Access denied. Too many attempts. Please wait 30 seconds before trying again.' : 'Access denied. This ID and password are not registered for the ShuttleSync demo.' });
    }
    loginAttempts.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { id: account.id, role, expiresAt: now + (Number(env.SESSION_TTL_MS) || 8 * 60 * 60 * 1000) });
    return res.json({ token, role, id: account.id });
  });

  function requireSession(req, res, next) {
    const token = authToken(req);
    const session = sessions.get(token);
    if (!session || session.expiresAt <= clock()) {
      if (token) sessions.delete(token);
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    req.session = session;
    next();
  }

  app.post('/api/logout', requireSession, (req, res) => {
    const token = authToken(req);
    sessions.delete(token);
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionToken === token) socket.disconnect(true);
    }
    res.status(204).end();
  });
  app.get('/api/config', (_req, res) => res.json({ mode: 'demo', trafficAvailable: false, trafficProvider: null, locationRequiresHttps: true, fareConfirmed }));
  app.get('/api/routes', (_req, res) => res.json(Object.values(ROUTES).map((route) => ({
    id: route.id, name: route.name, terminal: route.terminal, driver: route.driver,
    status: state.status[route.id], waiting: state.waitingPassengers[route.id], capacity: state.capacity[route.id], mode: 'demo'
  }))));
  app.get('/api/fare', (req, res) => {
    const route = ROUTES[req.query.route];
    if (!route) return res.status(404).json({ error: 'Unknown route.' });
    const amount = fares[route.id];
    const confirmed = fareConfirmed && amount !== null;
    return res.json({ route: route.id, amount: confirmed ? amount : null, confirmed, display: confirmed ? `₱${amount}` : 'Fare to be confirmed', note: confirmed ? null : 'Prototype fare not set or confirmed by the shuttle operator.' });
  });
  app.get('/api/trips', requireSession, (req, res) => res.json(state.trips.filter((trip) => trip.userId === req.session.id).map(({ userId, ...trip }) => trip)));
  app.post('/api/pay', requireSession, async (req, res) => {
    const route = ROUTES[req.body?.route];
    const method = req.body?.method;
    if (!route) return res.status(404).json({ error: 'Unknown route.' });
    if (!PAYMENT_METHODS.has(method)) return res.status(400).json({ error: 'Choose a supported prototype payment method.' });
    const delay = Math.max(0, Math.min(2000, Number(env.PAYMENT_DELAY_MS ?? 1500)));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const amount = fareConfirmed ? fares[route.id] : null;
    const receipt = {
      reference: `DEMO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
      route: route.id, routeName: route.name, method, amount,
      confirmed: fareConfirmed && amount !== null, simulated: true, createdAt: new Date(clock()).toISOString()
    };
    state.trips.unshift({ ...receipt, userId: req.session.id });
    state.trips.length = Math.min(state.trips.length, 100);
    return res.status(201).json(receipt);
  });
  app.get('/api/eta', (req, res) => {
    const route = ROUTES[req.query.route];
    if (!route) return res.status(404).json({ error: 'Unknown route.' });
    const cached = state.etaCache.get(route.id);
    if (cached && cached.expiresAt > clock()) return res.json(cached.value);
    const position = state.lastPosition[route.id];
    const distance = distanceKm(position ? [position.lat, position.lng] : route.start, route.terminal);
    const value = {
      route: route.id, eta: Math.max(1, Math.ceil(distance / 25 * 60)), distance: Number(distance.toFixed(2)),
      polyline: [], traffic: 'Traffic data unavailable in demo mode', updatedAt: new Date(clock()).toISOString(), mode: 'demo'
    };
    state.etaCache.set(route.id, { value, expiresAt: clock() + 25_000 });
    return res.json(value);
  });

  function validRoute(route) { return typeof route === 'string' && Object.hasOwn(ROUTES, route); }
  function announce(route, message) {
    const clean = String(message || '').trim().slice(0, 180);
    if (!clean) return;
    state.lastAnnouncement[route] = { message: clean, at: clock() };
    io.to(route).emit('newAnnouncement', state.lastAnnouncement[route]);
  }
  function setStatus(route, status, message) {
    if (state.status[route] === status) return;
    state.status[route] = status;
    io.to(route).emit('routeStatus', { route, status, at: clock() });
    if (message) announce(route, message);
  }

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const session = sessions.get(token);
    if (!session || session.expiresAt <= clock()) {
      if (token) sessions.delete(token);
      return next(new Error('unauthorized'));
    }
    socket.data.session = Object.freeze({ id: session.id, role: session.role });
    socket.data.sessionToken = token;
    socket.data.activeRoute = null;
    socket.data.checkedInRoutes = new Set();
    const expiryTimer = setTimeout(() => {
      sessions.delete(token);
      socket.disconnect(true);
    }, Math.max(0, session.expiresAt - clock()));
    expiryTimer.unref?.();
    socket.once('disconnect', () => clearTimeout(expiryTimer));
    socket.use((_packet, next) => {
      const current = sessions.get(token);
      if (!current || current.expiresAt <= clock()) {
        sessions.delete(token);
        socket.disconnect(true);
        return;
      }
      next();
    });
    return next();
  });

  io.on('connection', (socket) => {
    socket.on('joinRoute', (routeId) => {
      if (!validRoute(routeId)) return;
      for (const room of socket.rooms) if (room !== socket.id) socket.leave(room);
      socket.join(routeId);
      socket.data.activeRoute = routeId;
      socket.emit('updatePassengerCount', state.waitingPassengers[routeId]);
      socket.emit('routeStatus', { route: routeId, status: state.status[routeId], at: clock() });
      socket.emit('capacityUpdate', { route: routeId, capacity: state.capacity[routeId] });
      if (state.lastAnnouncement[routeId]) socket.emit('newAnnouncement', state.lastAnnouncement[routeId]);
      if (state.lastPosition[routeId]) socket.emit('updateMap', state.lastPosition[routeId]);
    });
    socket.on('driverOnline', (routeId) => {
      if (socket.data.session.role === 'driver' && validRoute(routeId) && socket.data.activeRoute === routeId) setStatus(routeId, 'Shuttle online', 'Driver is online and sharing location.');
    });
    socket.on('driverOffline', (routeId) => {
      if (socket.data.session.role === 'driver' && validRoute(routeId) && socket.data.activeRoute === routeId) setStatus(routeId, 'Driver offline', 'Shuttle location sharing has stopped.');
    });
    socket.on('commuterWaiting', (payload, acknowledge) => {
      const ack = typeof acknowledge === 'function' ? acknowledge : () => {};
      if (socket.data.session.role !== 'student') return ack({ ok: false, error: 'unauthorized' });
      const routeId = typeof payload === 'string' ? payload : payload?.route;
      if (!validRoute(routeId) || socket.data.activeRoute !== routeId) return ack({ ok: false, error: 'invalid_route' });
      if (socket.data.checkedInRoutes.has(routeId)) return ack({ ok: true, count: state.waitingPassengers[routeId] });
      socket.data.checkedInRoutes.add(routeId);
      state.waitingPassengers[routeId] += 1;
      io.to(routeId).emit('updatePassengerCount', state.waitingPassengers[routeId]);
      return ack({ ok: true, count: state.waitingPassengers[routeId] });
    });
    socket.on('driverLocation', (payload) => {
      if (socket.data.session.role !== 'driver' || !validRoute(payload?.route) || socket.data.activeRoute !== payload.route) return;
      const routeId = payload.route;
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return;
      const clamp = (v, max) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Number(v))) : null;
      const pos = {
        route: routeId, lat, lng, accuracy: clamp(payload.accuracy, 10000),
        heading: Number.isFinite(Number(payload.heading)) ? ((Number(payload.heading) % 360) + 360) % 360 : null,
        speed: clamp(payload.speed, 100), ts: Number.isFinite(Number(payload.ts)) ? Number(payload.ts) : clock(), receivedAt: clock()
      };
      const route = ROUTES[routeId];
      const distance = distanceKm([lat, lng], route.terminal);
      pos.distance = Number(distance.toFixed(2));
      if (distance <= 0.2 && !state.hasArrived[routeId]) {
        state.hasArrived[routeId] = true;
        state.waitingPassengers[routeId] = 0;
        io.to(routeId).emit('updatePassengerCount', 0);
        setStatus(routeId, 'Arrived', 'The shuttle has arrived at the terminal.');
      } else if (state.hasArrived[routeId] && distance > 0.25) {
        state.hasArrived[routeId] = false;
        setStatus(routeId, 'Departed', 'The shuttle has departed the terminal.');
      } else if (!state.hasArrived[routeId] && distance <= 1) {
        setStatus(routeId, 'Approaching', 'The shuttle is approaching the terminal.');
      } else if (!state.hasArrived[routeId] && state.status[routeId] !== 'En route') {
        setStatus(routeId, 'En route');
      }
      const eta = Math.max(1, Math.ceil(distance / 25 * 60));
      const mapValue = { ...pos, eta, mode: 'demo', traffic: 'Traffic data unavailable in demo mode', status: state.status[routeId] };
      state.lastPosition[routeId] = mapValue;
      state.etaCache.delete(routeId);
      io.to(routeId).emit('updateMap', mapValue);
    });
    socket.on('driverArrived', (payload) => {
      if (socket.data.session.role !== 'driver') return;
      const routeId = typeof payload === 'string' ? payload : payload?.route;
      if (!validRoute(routeId) || socket.data.activeRoute !== routeId) return;
      state.hasArrived[routeId] = true;
      state.waitingPassengers[routeId] = 0;
      io.to(routeId).emit('updatePassengerCount', 0);
      setStatus(routeId, 'Arrived', 'The shuttle has arrived at the terminal.');
    });
    socket.on('sendAnnouncement', (payload) => {
      if (socket.data.session.role !== 'driver') return;
      const routeId = payload?.route;
      if (validRoute(routeId) && socket.data.activeRoute === routeId) announce(routeId, payload.msg);
    });
    socket.on('updateCapacity', (payload) => {
      if (socket.data.session.role !== 'driver' || !['Available', 'Filling', 'Full'].includes(payload?.capacity)) return;
      const routeId = payload.route;
      if (!validRoute(routeId) || socket.data.activeRoute !== routeId) return;
      state.capacity[routeId] = payload.capacity;
      io.to(routeId).emit('capacityUpdate', { route: routeId, capacity: payload.capacity });
    });
    socket.on('sosAlert', (payload) => {
      if (socket.data.session.role !== 'driver') return;
      const routeId = payload?.route;
      if (!validRoute(routeId) || socket.data.activeRoute !== routeId) return;
      state.lastSOS[routeId] = { at: clock(), position: state.lastPosition[routeId] };
      io.to(routeId).emit('sosAlert', { route: routeId, at: clock(), position: state.lastPosition[routeId], demoOnly: true });
    });
  });

  async function close() {
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  return { app, server, io, state, sessions, loginAttempts, close };
}

if (require.main === module) {
  const { server } = createAppServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`ShuttleSync running at http://localhost:${port}`));
}
module.exports = { createAppServer, ROUTES, distanceKm };
