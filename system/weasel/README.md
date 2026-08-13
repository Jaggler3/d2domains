# weasel

Cunning, quiet, and quick to pocket a domain before anyone notices it's available.

This is the domains service. It's the source of truth for orders and domains in
Postgres, and keeps the internal endpoints the rest of the family depends on.
Orders are idempotent because a weasel never takes the same egg twice.
