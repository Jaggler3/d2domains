# badger

Badgers don't let go. Once one sinks its teeth into a job, that job is getting finished.

This is the purchase worker. It pulls orders off the BullMQ `purchases` queue,
bills you through wombat, registers the domain at the registry, and files it
away in weasel. Transient failures just make it dig harder; only a hard decline
gets it to let go and mark the order failed.
