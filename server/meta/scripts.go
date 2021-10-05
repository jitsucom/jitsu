package meta

import "github.com/gomodule/redigo/redis"

var updateOneFieldCachedEvent = redis.NewScript(3, `
if redis.call('exists',KEYS[1]) == 1 then 
  redis.call('hset', KEYS[1], KEYS[2], KEYS[3]) 
end`)

var updateTwoFieldsCachedEvent = redis.NewScript(5, `
if redis.call('exists',KEYS[1]) == 1 then 
  redis.call('hmset', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]) 
end`)

var updateThreeFieldsCachedEvent = redis.NewScript(7, `
if redis.call('exists',KEYS[1]) == 1 then 
  redis.call('hmset', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6], KEYS[7]) 
end`)
