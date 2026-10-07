# Request state lives in Postgres, not Redis

Production runs two machines so a deploy or a lost host does not interrupt Brokers, which means no state can live inside one process. Session data and request-limiter counts, previously held in memory, move into Postgres. Redis is removed from the design, including the unused `RedisStore` and the `redis` service in `docker-compose.yml`.

Redis is the usual home for this kind of state, and a reader will expect it. We chose Postgres because session data can contain PHI: Redis would be a second store holding PHI, with its own vendor BAA, backups, encryption, and access rules. Postgres is already covered on all four. At Design Partner scale the speed difference does not matter. If load later justifies a cache, it can be added for data that is not PHI.

The startup backfill also leaves the web process and runs once per release, since two machines would otherwise both run it.
