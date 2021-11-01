package meta

import "github.com/gomodule/redigo/redis"

var updateTwoFieldsCachedEvent = redis.NewScript(9, `
if redis.call('exists',KEYS[1]) == 1 then 
  redis.call('hmset', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]) 
elseif KEYS[1] ~= KEYS[9] then
  local orig = unpack(redis.call('hmget', KEYS[9], 'original'))
  if orig ~= nil then 
    redis.call('hmset', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], 'original', orig)
    redis.call('ZADD', KEYS[6], KEYS[7], KEYS[8])
  end
end`)

var updateThreeFieldsCachedEvent = redis.NewScript(11, `
if redis.call('exists',KEYS[1]) == 1 then 
  redis.call('hmset', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7])
elseif KEYS[1] ~= KEYS[11] then
  local orig = unpack(redis.call('hmget', KEYS[11], 'original'))
  if orig ~= nil then 
  	redis.call('hmset', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7], 'original', orig)
  	redis.call('ZADD', KEYS[8], KEYS[9], KEYS[10])
  end
end`)
