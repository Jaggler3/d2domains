# beaver

Busy little worker. Beavers build dams; this one builds search_logs.

Consumes BullMQ jobs off the domains-jobs queue and files each one
into its own sqlite pond. When the queue floods, the beaver just
keeps building. One job at a time, no plans to stop.
