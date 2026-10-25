// Deterministic version 4 UUIDs, in the format the API accepts for X-HopReady-Install.
export function createSequentialUuids(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
  };
}
