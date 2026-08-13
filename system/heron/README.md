# heron

Still as a statue, until it isn't. Herons wait forever for the right moment, then strike.

This is the registry gateway. It stands patiently in front of name.com and waits
for a web client to flutter by, then strikes with a search, a check, or a
registration. A token bucket in Redis keeps it from lunging at everything at
once — and returns 429 when it overreaches.
