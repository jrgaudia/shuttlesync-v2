# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are student commuters at Mapúa Malayan Colleges Laguna choosing a shuttle terminal and checking shuttle status before boarding. A secondary user is an authorized shuttle driver who starts location sharing and needs to interact with the console as little as possible while operating the vehicle.

## Product Purpose

ShuttleSync is a coursework prototype for real-time shuttle arrival information. It lets commuters select one of five terminals and view the shuttle's reported position, arrival estimate, status, and passenger availability. Success for the class demonstration is a clear, usable indication of what is live versus simulated.

## Positioning

The prototype connects driver-phone location sharing to a commuter-facing shuttle map and status, rather than asking drivers to manually type routine arrival updates.

## Operating Context

The prototype is presented for a technopreneurship subject and runs as a mobile-friendly web app. It uses a driver or demo-driver position, Socket.IO updates, and a map view. Driver location requires browser permission and a secure context on phones; local classroom presentation can use the explicitly labeled demo-driver mode.

## Capabilities and Constraints

- Preserve student and driver roles and route IDs `calamba`, `sta-rosa`, `binan`, `san-pedro`, and `carmona`.
- Existing project stack is Node.js, Express, Socket.IO, and Leaflet.
- Access is limited to configured demo accounts; exact student password is chosen by the team and must remain server-side.
- Driver location is required for real GPS sharing. Student location is optional.
- Traffic-aware ETA depends on optional provider configuration and may fall back to a labeled demo estimate.
- Payment is simulation only. Fare values and any student discount are undecided pending confirmation by the instructor or shuttle operator.
- No database, production authentication, real dispatch/SOS escalation, or real payment integration is part of this prototype.

## Brand Commitments

The name Mapúa MCL ShuttleSync and the Mapúa navy/red identity are retained. The requested product category is a professional transportation app, with familiar map-first tracking and a compact trip-details sheet; the interface must not imitate a specific competitor's logo or copy.

## Evidence on Hand

The existing prototype source is in `index.html` and `server.js`; four provided screenshots show its role selection, route selection, commuter map, and driver console. They document current functions but are not approved design references. No confirmed fare schedule, live traffic provider key, driver photo assets, or public deployment origin has been supplied. Do not invent final prices or imply real traffic, payment, or emergency escalation when those are not configured.

## Product Principles

- Show location freshness and distinguish live data from simulation.
- Let commuters continue with manual route selection if they decline location access.
- Minimize driver interaction while the vehicle is moving.
- Make fares transparent and provisional until the operator confirms them.
- Keep all demo-only and unavailable states understandable during a live presentation.

## Accessibility & Inclusion

The coursework prototype should remain readable and operable on phone-sized screens, with accessible labels, visible keyboard focus, high-contrast text, and touch controls of at least 44 px. Location permission must be explained before requesting it and must not be mandatory for commuter use.
