# Quick Aid SG Fix Report - 2026-05-20

Repo: `CODEEXP`

Production alias: https://quick-aid-sg.vercel.app

Latest production deployment: https://quick-aid-ja0w0q3ia-xiangyao888-8041s-projects.vercel.app

## Verification

- `npm run lint` passed.
- `npm run build` passed. Vite still warns that the main JS chunk is large.
- Built preview smoke passed on a 390 x 844 viewport:
  citizen SOS, citizen AI drawer, citizen report, responder accept flow, ops report queue, ops dispatch fit scoring, and activity logs.
- Host AI route smoke passed locally with safe `not_configured` fallback.
- Vercel production deploy completed and aliased to `https://quick-aid-sg.vercel.app`.
- Live responder smoke passed on `https://quick-aid-sg.vercel.app`: Responder demo -> Mission Board renders Operational panel, Current mission, Assignments, and Joinable missions with no page errors.
- Local responder flow smoke passed: Citizen SOS -> switch to responder -> Mission Board -> Accept SOS opens the assignment path.
- Live `/api/host/ask` returned `state: live` for a citizen fire-guidance prompt with supplied location/alert context. Host AI is configured on the current production deployment.

## Fixes By Item

1. Mobile header/demo chip overlap: hid the demo role chip on narrow screens, tightened header spacing, and made the tracking pill/action dock mobile-safe.
2. Map label controls: replaced the static legend with clickable filters for disaster, hospital, AED, traffic, MRT, SOS, units, plus a label on/off toggle.
3. Citizen AI missing: added a Citizen AI workspace and bottom-dock AI entry. It calls `/api/host/ask` only when the user asks.
4. Login page: rebuilt the entry screen as a real sign-in page with separate labelled demo account cards for citizen, responder, and ops.
5. Report chain: citizen reports now route to ops only. Ops claim/verify/dismiss creates audit logs, reporter notifications, and only verified incidents publish to responders/citizens. SOS remains visible to both ops and responders.
6. Responder polygons: removed responder verification/drawing paths. Responders can only request ops to form a case around an existing verified incident.
7. Incident guidance: guidance is now incident-type specific. Traffic/crash guidance no longer tells users to walk through water. AI guidance loads only on button click.
8. Status clarity/endpoints: status pipeline now uses visible check icons and horizontal overflow. SOS completion requires responder and citizen acknowledgement before resolution.
9. SOS category + fit metrics: responder join and ops dispatch now show suggested fit percentages and reasons for each responder/mission.
10. Accept/respond flow: responder Accept SOS now assigns the SOS, moves the responder into assignment detail, sets en-route state, and writes logs/notifications.
11. Event unregister/source: volunteer events show who posted them and allow unregistering from a registered event.
12. Confusing hashtags: collapsed responder room rail now uses short labels (`MB`, `GR`, `CS`, `OF`) and removed the duplicate join-group row.
13. Open SOS vs case room: joinable missions now explains the difference, and restricted official cases are monitor-only.
14. Demo roster: added more demo roster entries and labelled SCDF/SPF/SAF professional units as demo/special.
15. Polygon drawing session: ops drawing controls now appear only inside Declare/Broadcast sessions. Undo/clear only affect the current draft.
16. Accountability logs: added role-visible action logs. Ops sees ops/responder logs; responders see responder-visible logs.
17. Notifications: added role-scoped, tiered notifications with acknowledge buttons plus an optional browser permission prompt that clearly says push delivery still needs a backend worker.
18. Professional movements: added demo SCDF/SPF/SAF professional units, official-only restricted cases, and covert/unit labels to reduce volunteer interference.
19. Host AI enabled: added `/api/host/ask` OpenRouter route and wired case/citizen Host AI calls. It does not invent data when provider env is missing.

## Responder Template Follow-Up

- Replaced the responder Mission Board drawer with a template-style Operational panel.
- The panel now has three explicit sections: Current mission, Assignments, and Joinable missions.
- Current mission uses actual app state: assigned SOS first, otherwise joined active case. If there is no assignment, it shows "No current mission" instead of inventing one.
- Current mission exposes ETA, location, live updates from logs/chat, responder action buttons, case room entry, and a Message civilian control.
- Message civilian now writes an audit log and creates a citizen notification. For case rooms, it also mirrors the message into case chat as a citizen update.
- Joinable missions show open SOS and ops-formed case rooms with fit percentages and reasons.
- Official/restricted professional cases are monitor-only; volunteers can open the case room for deconfliction but cannot join.
- The responder left rail now uses clearer template-style labels: My Status, Mission Board, My Assignments, Signal Checks, Groups, Events, Logs.
- The Mission Board drawer title now says Operational panel instead of Bulletin.
- Accept SOS, responder status changes, join case, and leave case now make best-effort backend calls while still updating local UI/log state when the backend is unavailable.
- Live tracking is automatically requested when a citizen has an active SOS, when a responder is assigned to an SOS, or when a responder is in an active case. If the browser denies location permission, the app does not fabricate coordinates.

## Known Configuration State

- Vercel production currently has OpenRouter Host AI configured; the live smoke test returned `state: live`.
- I did not commit any `.env*` files or secrets.
