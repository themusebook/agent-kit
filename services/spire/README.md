# spire

SPIRE server and agent config, ported from SolanaBot with trust domain `musebook.local`. The supervisor registers each Bot computer as `spiffe://musebook.local/bot/<id>` when `SPIRE_SOCKET` is set; without SPIRE, computers still run, they just cannot prove which Bot they are. Join tokens are issued at runtime and are never committed.
