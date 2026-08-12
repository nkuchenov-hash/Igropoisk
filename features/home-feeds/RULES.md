# Home feeds module rules

`home-feeds` owns the runtime selection of validated Popular and Releases snapshots and their external publication contract.

- Runtime data is loaded from the versioned Yandex Object Storage manifest first.
- Repository JSON is an emergency fallback only and is not updated by scheduled automation.
- The module must not write to GitHub, change shared layout, or introduce visual components.
- Every game selected into the finalized `Popular Now` ranking must immediately trigger the game lifecycle. Missing Popular pages are mandatory lifecycle work and are not limited by the ordinary per-run page quota.
- A Popular card is public only when its real game page is already published. The UI must never expose a temporary page, disabled card, or “page is being prepared” state.
- Existing home and calendar widgets remain responsible for rendering and use the central design system, including the shared empty-state component for unavailable data.
- Object Storage URLs must be restricted to the `igropoisk-content/home-feeds` snapshot namespace.
- Publication switches the current manifest only after the complete immutable snapshot and referenced media have been uploaded and verified.
