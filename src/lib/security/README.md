# Security utilities

`checkRateLimit` fails closed when Upstash is missing or unavailable. Callers should return a 429 response when `allowed` is false and include the request ID in the response.

`logEvent` validates structured event data and writes through the Supabase service role. It never accepts raw audio or unvalidated request bodies.
