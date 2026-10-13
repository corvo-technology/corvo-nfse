export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const CACHE_PORT = Symbol('CACHE_PORT');
export const LOCK_PORT = Symbol('LOCK_PORT');

export const REDIS_LOCK_RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end

return 0
`;

export const REDIS_LOCK_EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end

return 0
`;
