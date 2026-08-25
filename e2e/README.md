# d2domains e2e

Two layers, both against the live mock compose stack (fake spaceship registry):

1. **API suite** (`api.test.ts`) — deep assertions across hog → weasel/wombat/
   badger/heron/otter/pigeon/dove/stalwart: purchase journeys, provisioning
   into Stalwart (SQL directory auth), published DNS records + registry sync,
   DNS CRUD, registrar settings, idempotent re-buy, declined payments.
2. **Browser journey** (`../client/tests/journey.spec.ts`) — Playwright through
   the real Next.js UI: register → search → checkout with email add-on → buy →
   dashboard → mailbox card on the domain page.

## Usage

```bash
./up.sh           # build + start stack; handles stalwart bootstrap restart
./test-api.sh     # API layer (~15-60s)
./test-browser.sh # browser layer (~15s)
./down.sh         # teardown; FRESH=1 ./down.sh also wipes volumes
```

## Stalwart bootstrap notes

On a fresh `stalwart_data` volume, stalwart v0.16 boots in bootstrap mode.
dove completes the setup wizard automatically (`x:Bootstrap/set`) wiring its
SQL directory to d2dove; one stalwart restart later it runs normally. `up.sh`
orchestrates that restart. dove also binds the directory as the authentication
directory and triggers a settings reload on every boot (idempotent).
