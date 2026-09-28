(() => {
  'use strict';
  const $ = (q) => document.querySelector(q);
  const state = { role: null, account: null, token: null, routes: [], route: null, routeStatus: null, socket: null, map: null, marker: null, terminal: null, userMarker: null, watchId: null, demoTimer: null, wakeLock: null, lastPositionAt: 0, mapTouched: false, online: false, speedKmh: 0, selectedRoute: null };
  let fareReturnFocus = null;
  const screens = ['role','login','route','commuter','driver'];
  const showScreen = (name) => { screens.forEach((s) => $(`#screen-${s}`).classList.toggle('hidden', s !== name)); };
  const toast = (message) => { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200); };
  async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers };
    const response = await fetch(url, { ...options, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
    return body;
  }
  async function loadRoutes() {
    try { state.routes = await api('/api/routes'); }
    catch (error) { toast(`Routes unavailable: ${error.message}`); return; }
    const list = $('#route-list'); list.replaceChildren();
    state.routes.forEach((route) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'route-option'; button.setAttribute('aria-pressed','false');
      const dot = document.createElement('i'); dot.className = 'route-dot';
      const text = document.createElement('span'); const title = document.createElement('b'); title.textContent = route.name; const sub = document.createElement('small'); sub.textContent = `Driver ${route.driver?.name || 'Assigned'} · ${route.status || 'Status unavailable'}`; text.append(title,sub);
      const mode = document.createElement('span'); mode.className = 'route-mode'; mode.textContent = route.mode === 'demo' ? 'Demo' : 'Live'; button.append(dot,text,mode);
      button.addEventListener('click', () => { state.selectedRoute = route.id; list.querySelectorAll('.route-option').forEach((b) => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); }); $('#continue-route').disabled = false; }); list.append(button);
    });
  }
  function connectSocket() {
    if (!window.io) { $('#connection').textContent = 'Realtime unavailable'; return; }
    state.socket?.disconnect(); state.socket = io({ auth: { token: state.token }, reconnection: true });
    state.socket.on('connect', () => { $('#connection').classList.add('online'); $('#connection').innerHTML = '<i></i> Connected'; if (state.route) state.socket.emit('joinRoute', state.route.id); });
    state.socket.on('disconnect', () => { $('#connection').classList.remove('online'); $('#connection').innerHTML = '<i></i> Offline · reconnecting'; });
    state.socket.on('connect_error', () => { $('#connection').classList.remove('online'); $('#connection').innerHTML = '<i></i> Realtime unavailable'; });
    state.socket.on('updateMap', renderPosition);
    state.socket.on('updatePassengerCount', (count) => { $('#waiting-count').textContent = `${count} passenger${count === 1 ? '' : 's'}`; $('#driver-waiting').textContent = count; });
    state.socket.on('capacityUpdate', ({ capacity }) => { const el = $('#capacity'); el.textContent = capacity || 'Availability unknown'; el.classList.toggle('available', capacity === 'Available'); });
    state.socket.on('routeStatus', ({ status }) => { if (status) { state.routeStatus = status; $('#driver-status').textContent = status; $('#eta-status').textContent = status; } });
    state.socket.on('newAnnouncement', (data) => { const message = typeof data === 'string' ? data : data?.message; if (!message) return; $('#announce').textContent = message; $('#announce').classList.remove('hidden'); toast(message); });
  }
  function setupMap() {
    if (!window.L) { $('#signal').textContent = 'Map library unavailable'; return; }
    if (!state.map) {
      state.map = L.map('map', { zoomControl: false }).setView(state.route.terminal || [14.2,121.13], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(state.map);
      L.control.zoom({ position: 'bottomright' }).addTo(state.map);
      state.map.on('dragstart', () => { state.mapTouched = true; }); state.map.on('zoomstart', () => { state.mapTouched = true; });
    }
    state.map.setView(state.route.terminal, 13); state.mapTouched = false;
    const icon = (kind) => L.divIcon({ className: '', html: `<span class="${kind}-icon" aria-hidden="true"></span>`, iconSize: kind === 'shuttle' ? [30,30] : [19,19], iconAnchor: kind === 'shuttle' ? [15,15] : [9,9] });
    if (state.terminal) state.map.removeLayer(state.terminal);
    state.terminal = L.marker(state.route.terminal, { icon: icon('terminal'), title: `${state.route.name} terminal`, alt: 'Selected route terminal' }).addTo(state.map);
    setTimeout(() => state.map.invalidateSize(), 120);
  }
  function clearRouteMarkers() {
    if (state.map && state.marker) state.map.removeLayer(state.marker);
    if (state.map && state.terminal) state.map.removeLayer(state.terminal);
    if (state.map && state.userMarker) state.map.removeLayer(state.userMarker);
    state.marker = null;
    state.terminal = null;
    state.userMarker = null;
  }
  function renderPosition(data) {
    if (!state.route || (data.route && data.route !== state.route.id) || !Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lng))) return;
    if (state.map && window.L) {
      const latlng = [Number(data.lat), Number(data.lng)];
      const icon = L.divIcon({ className:'', html:'<span class="shuttle-icon" aria-hidden="true"></span>', iconSize:[30,30], iconAnchor:[15,15] });
      if (!state.marker) state.marker = L.marker(latlng, { icon, title:'Shuttle location', alt:'Latest reported shuttle position' }).addTo(state.map);
      else state.marker.setLatLng(latlng);
      if (!state.mapTouched) state.map.panTo(latlng, { animate: true, duration: .5 });
    }
    const receivedAt = Number(data.receivedAt) || Number(data.ts) || Date.now();
    const ageMs = Math.max(0, Date.now() - receivedAt);
    const stale = ageMs > 30000;
    state.lastPositionAt = receivedAt;
    const mode = data.mode || 'demo';
    $('#mode-badge').textContent = mode === 'demo' ? 'DEMO ETA' : 'LIVE ETA';
    $('#eta').textContent = data.distance <= .2 ? 'Arrived' : `~${data.eta ?? '—'} min`;
    $('#eta-status').textContent = stale ? 'Signal lost · showing last known position' : (state.routeStatus || data.status || (mode === 'demo' ? 'Demo estimate · traffic unavailable' : 'Location received'));
    $('#signal').textContent = stale ? 'Signal lost · showing last known position' : (mode === 'demo' ? 'Demo position · not live GPS' : 'Latest shuttle position');
    $('#updated').textContent = `${stale ? 'Last seen' : 'Updated'} ${new Date(receivedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}${data.accuracy ? ` · GPS ±${Math.round(data.accuracy)} m` : ''}`;
    $('#gps-freshness').textContent = stale ? 'Signal lost' : 'Just updated';
    state.speedKmh = Math.max(0, Number(data.speed || 0) * 3.6); applyMotionLock();
  }
  function applyMotionLock() { const locked = state.speedKmh > 5; $('#manual-controls').classList.toggle('hidden', locked); $('#motion-lock').classList.toggle('hidden', !locked); }
  function routeSelected() {
    const route = state.routes.find((r) => r.id === state.selectedRoute); if (!route) return;
    state.route = route; state.routeStatus = route.status || null;
    if (state.role === 'student') {
      $('#commuter-route-title').textContent = route.name; $('#terminal-name').textContent = route.name; $('#driver-name').textContent = route.driver?.name || 'Assigned driver'; $('#driver-vehicle').textContent = [route.driver?.vehicle, route.driver?.plate].filter(Boolean).join(' · ') || 'Vehicle details unavailable';
      $('#waiting-count').textContent = `${route.waiting || 0} passengers`; $('#capacity').textContent = route.capacity || 'Availability unknown'; $('#capacity').classList.toggle('available', route.capacity === 'Available'); showScreen('commuter'); setupMap(); connectSocket(); api(`/api/eta?route=${encodeURIComponent(route.id)}`).then((eta) => { if (!state.lastPositionAt && eta) { $('#eta').textContent = `~${eta.eta} min`; $('#eta-status').textContent = 'Demo estimate · traffic unavailable'; } }).catch(() => {});
    } else { $('#driver-route-title').textContent = route.name; $('#driver-status').textContent = route.status || 'Waiting for shuttle'; $('#driver-waiting').textContent = route.waiting || 0; showScreen('driver'); connectSocket(); }
  }
  async function loadTripHistory() {
    const container = $('#trip-history');
    container.textContent = 'Loading trip history…';
    try {
      const trips = await api('/api/trips');
      if (!trips.length) {
        container.textContent = 'No simulated trips yet.';
        return;
      }
      const list = document.createElement('ul');
      trips.slice(0, 10).forEach((trip) => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        const detail = document.createElement('span');
        title.textContent = trip.routeName || trip.route;
        detail.textContent = `${trip.confirmed ? `₱${trip.amount}` : 'Fare to be confirmed'} · ${trip.method} · ${new Date(trip.createdAt).toLocaleString()}`;
        item.append(title, detail);
        list.append(item);
      });
      container.replaceChildren(list);
    } catch (error) {
      container.textContent = error.message || 'Trip history is unavailable.';
    }
  }
  function closeFareDialog() {
    const dialog = $('#fare-dialog');
    if (dialog.classList.contains('hidden')) return;
    dialog.classList.add('hidden');
    fareReturnFocus?.focus(); fareReturnFocus = null;
  }
  function handleFareDialogKeydown(event) {
    const dialog = $('#fare-dialog');
    if (dialog.classList.contains('hidden')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeFareDialog(); return; }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  function stopTracking() {
    if (state.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    clearInterval(state.demoTimer);
    state.demoTimer = null;
    state.online = false;
    state.wakeLock?.release?.().catch(() => {});
    state.wakeLock = null;
    if (state.route) state.socket?.emit('driverOffline', state.route.id);
    $('#online-button').textContent = 'Go online with GPS';
    $('#demo-button').textContent = 'Start labeled demo mode';
  }
  async function requestWakeLock() { try { if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {} }
  function gpsError(error) { stopTracking(); $('#driver-state').textContent = 'Offline'; $('#driver-message').textContent = error.code === 1 ? 'Location permission was denied. Enable it in browser settings, then try again.' : 'Could not access a GPS fix. Check device location settings and try again.'; toast($('#driver-message').textContent); }
  function startGps() {
    if (!navigator.geolocation) { $('#driver-message').textContent = 'This browser does not provide location. Use labeled demo mode for class demonstration.'; return; }
    state.online = true; $('#online-button').textContent='Go offline'; $('#demo-button').textContent='Stop demo mode'; $('#driver-state').textContent = 'Waiting for GPS'; $('#driver-message').textContent = 'Waiting for a location fix…'; state.socket?.emit('driverOnline', state.route.id); requestWakeLock();
    state.watchId = navigator.geolocation.watchPosition((position) => { const c = position.coords; const data = { route:state.route.id, lat:c.latitude, lng:c.longitude, accuracy:c.accuracy, heading:c.heading, speed:c.speed, ts:position.timestamp }; state.socket?.emit('driverLocation', data); renderPosition(data); $('#driver-state').textContent = 'Online · GPS'; $('#driver-message').textContent = 'Sharing your current location with this route.'; }, gpsError, { enableHighAccuracy:true, maximumAge:2000, timeout:15000 });
  }
  function startDemo() {
    const target = state.route.terminal; let lat = target[0] + .035, lng = target[1] - .035; state.online = true; state.socket?.emit('driverOnline', state.route.id); $('#driver-state').textContent = 'Online · Demo mode'; $('#driver-message').textContent = 'Simulated route position; this is not GPS.'; $('#mode-badge').textContent = 'DEMO MODE';
    const send = () => { lat -= .00025; lng += .00025; const data = { route:state.route.id, lat,lng,accuracy:null,heading:null,speed:0,ts:Date.now(),mode:'demo',eta:4,status:'En route' }; state.socket?.emit('driverLocation', data); renderPosition(data); $('#driver-state').textContent = 'Online · Demo mode'; };
    send(); state.demoTimer = setInterval(send, 3000);
  }
  async function signout() { stopTracking(); try { await api('/api/logout',{method:'POST'}); } catch (_) {} state.socket?.disconnect(); state.token=null; state.account=null; state.route=null; state.selectedRoute=null; clearRouteMarkers(); state.mapTouched=false; showScreen('role'); }
  document.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => { state.role = b.dataset.role; $('#login-heading').textContent = state.role === 'student' ? 'Student sign in' : 'Driver sign in'; $('#login-id').value=''; $('#login-password').value=''; $('#login-error').textContent=''; showScreen('login'); $('#login-id').focus(); }));
  $('#back-role').addEventListener('click', () => showScreen('role'));
  $('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); $('#login-error').textContent=''; try { const result = await api('/api/login',{method:'POST',body:JSON.stringify({role:state.role,id:$('#login-id').value.trim(),password:$('#login-password').value})}); state.token=result.token; state.account=result; $('#login-password').value=''; await loadRoutes(); if (state.routes.length) showScreen('route'); } catch (error) { $('#login-error').textContent=error.message; } });
  $('#continue-route').addEventListener('click', routeSelected); ['signout-route','signout-commuter','signout-driver'].forEach((id) => $(`#${id}`).addEventListener('click', signout));
  $('#change-route').addEventListener('click', async () => { stopTracking(); state.socket?.disconnect(); clearRouteMarkers(); await loadRoutes(); showScreen('route'); });
  $('#recenter').addEventListener('click', () => { state.mapTouched=false; if (state.marker) state.map.setView(state.marker.getLatLng(), Math.max(state.map.getZoom(),14)); else if(state.route) state.map.setView(state.route.terminal,14); });
  $('#checkin').addEventListener('click', () => {
    if (!state.socket?.connected) return toast('Realtime connection unavailable. Try again when connected.');
    const button = $('#checkin'); button.disabled = true; button.textContent = 'Sending…';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return; settled = true; button.disabled = false; button.textContent = "I'm waiting here";
      toast('Check-in was not confirmed. Please try again.');
    }, 5000);
    state.socket.emit('commuterWaiting', { route:state.route.id }, (response) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      if (!response?.ok) { button.disabled = false; button.textContent = "I'm waiting here"; toast('Check-in failed. Please try again.'); return; }
      button.textContent = 'You are in the waiting count'; toast('Waiting status confirmed for this route.');
    });
  });
  $('#locate-me').addEventListener('click', () => { if (!navigator.geolocation) return toast('Location is unavailable in this browser.'); toast('Requesting optional location permission…'); navigator.geolocation.getCurrentPosition((p) => { const pos=[p.coords.latitude,p.coords.longitude]; if (!state.userMarker) state.userMarker=L.circleMarker(pos,{radius:8,color:'#fff',weight:3,fillColor:'#3476b8',fillOpacity:1}).addTo(state.map).bindTooltip('Your location'); else state.userMarker.setLatLng(pos); }, () => toast('Location denied or unavailable. You can continue using manual route selection.'), {enableHighAccuracy:true,maximumAge:10000,timeout:10000}); });
  $('#fare-open').addEventListener('click', async () => {
    fareReturnFocus = document.activeElement;
    $('#fare-dialog').classList.remove('hidden'); $('#fare-close').focus();
    loadTripHistory(); $('#receipt').classList.add('hidden'); $('#pay-button').disabled=false;
    try {
      const fare=await api(`/api/fare?route=${encodeURIComponent(state.route.id)}`);
      $('#fare-title').textContent=fare.display || 'Fare to be confirmed';
      $('#fare-copy').textContent=fare.confirmed ? `Confirmed fare: ${fare.display}.` : (fare.note || 'The operator has not confirmed a fare for this route.');
    } catch (_) { $('#fare-title').textContent='Fare to be confirmed'; $('#fare-copy').textContent='Fare details are currently unavailable.'; }
  });
  $('#fare-close').addEventListener('click', closeFareDialog);
  $('#fare-dialog').addEventListener('click', (event) => { if (event.target === $('#fare-dialog')) closeFareDialog(); });
  document.addEventListener('keydown', handleFareDialogKeydown);
  $('#pay-button').addEventListener('click', async () => { $('#pay-button').disabled=true; $('#pay-button').textContent='Creating demo receipt…'; try { const receipt=await api('/api/pay',{method:'POST',body:JSON.stringify({route:state.route.id,method:$('#payment-method').value})}); const amount=receipt.confirmed ? `₱${receipt.amount}` : 'Fare to be confirmed'; const el=$('#receipt'); el.textContent=`Simulated receipt · ${amount} · ${receipt.method} · Reference ${receipt.reference}. No real charge.`; el.classList.remove('hidden'); } catch(error) { toast(error.message); } finally { $('#pay-button').disabled=false; $('#pay-button').textContent='Create simulated receipt'; } });
  $('#allow-gps').addEventListener('click', () => { $('#permission-dialog').classList.add('hidden'); startGps(); }); $('#cancel-gps').addEventListener('click', () => $('#permission-dialog').classList.add('hidden'));
  $('#demo-button').addEventListener('click', () => { if(state.online){stopTracking();$('#driver-state').textContent='Offline';$('#driver-message').textContent='Location sharing stopped.';$('#online-button').textContent='Go online with GPS';$('#demo-button').textContent='Start labeled demo mode';return;} startDemo(); $('#online-button').textContent='Go offline'; $('#demo-button').textContent='Stop demo mode'; });
  $('#online-button').addEventListener('click', () => { if(state.online){stopTracking();$('#driver-state').textContent='Offline';$('#driver-message').textContent='Location sharing stopped.';return;} $('#permission-dialog').classList.remove('hidden'); });
  $('#send-announcement').addEventListener('click', () => { const msg=$('#announcement-input').value.trim(); if(!msg) return toast('Enter a short service update first.'); state.socket?.emit('sendAnnouncement',{route:state.route.id,msg}); $('#announcement-input').value=''; toast('Update sent to this route.'); });
  document.querySelectorAll('[data-capacity]').forEach((b) => b.addEventListener('click', () => { state.socket?.emit('updateCapacity',{route:state.route.id,capacity:b.dataset.capacity}); toast(`Availability set to ${b.dataset.capacity}.`); }));
  let sosTimer; const sos=$('#sos'); sos.addEventListener('pointerdown', () => { sosTimer=setTimeout(() => { if(state.online){state.socket?.emit('sosAlert',{route:state.route.id});toast('Demo SOS sent. No emergency service is connected.');}else toast('Go online before sending a demo SOS.'); },1200); }); ['pointerup','pointerleave','pointercancel'].forEach((e)=>sos.addEventListener(e,()=>clearTimeout(sosTimer)));
  document.addEventListener('visibilitychange', () => { if(document.visibilityState==='visible' && state.online && !state.demoTimer) requestWakeLock(); });
  setInterval(() => { if(state.lastPositionAt && Date.now()-state.lastPositionAt>30000){$('#signal').textContent='Signal lost · showing last known position';$('#gps-freshness').textContent='Signal lost';$('#eta-status').textContent='Signal lost · showing last known position';} },5000);
  window.addEventListener('pagehide', stopTracking);
  fetch('/api/config').then((r)=>r.json()).then((c)=>{ if(c.mode==='demo'||!c.trafficAvailable) $('#mode-badge').textContent='DEMO ETA'; }).catch(()=>{ $('#mode-badge').textContent='DEMO ETA'; });
})();
