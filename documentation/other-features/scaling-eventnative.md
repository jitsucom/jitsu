# Scaling EventNative

**Jitsu** is designed to be scalable at heart. If you need redundancy or distributed load
between nodes, just add more **Jitsu Server** nodes to the cluster and use your load balancer of choice to distribute load.

<div style={{backgroundColor: 'white'}}>
    <img alt="Scaling Jitsu" src="/img/docs/scaling-en.png" />
</div>


**Jitsu** has been tested with following load balancers:

* [Nginx](http://nginx.org/)
* [Cloudflare](https://cloudflare.com)
* [Elastic Load Balancer \(AWS\)](https://aws.amazon.com/elasticloadbalancing/)

However, any load balancer should be working

## Coordination

At present **Jitsu** supports [redis](https://redis.io/) and [etcd](https://etcd.io) as coordination services. It used in creating/patching tables phase, for heart beating and for sync tasks scheduling. For
using two or more **Jitsu Server** instances please make additional configuration:

```yaml
server:
  ...
  name: #use unique name for each instance (e.g. hostname: en-node1-us.domain.com)  
  admin_token: your_admin_token #is used in cluster information requests

destinations:
...
        
coordination:
  redis:
    host: your_redis_host
    port: 6379
    password: secret_password

```

If you use meta storage you can just write redis shortcut:
```yaml
server:
  ...
  name: #use unique name for each instance (e.g. hostname: en-node1-us.domain.com)  
  admin_token: your_admin_token #is used in cluster information requests

destinations:
...

meta.storage:
  redis:
    host: your_redis_host
    port: 6379
    password: secret_password
        
coordination:
  type: redis
```

Every **Jitsu Server** instance with configured coordination sends heartbeat requests every 90 seconds.
For getting cluster information see [cluster information](/docs/other-features/admin-endpoints#apiv1cluster) section

