# Scaling EventNative

**EventNative** is designed to be scalable at heart. If you need redundancy or distributed load
between nodes, just add more **EventNative** nodes to the cluster and use your load balancer of choice to distribute load.

<div style={{backgroundColor: 'white'}}>
    <img alt="Scaling EventNative" src="/img/docs/scaling-en.png" />
</div>


**EventNative** has been tested with following load balancers:

* [Nginx](http://nginx.org/)
* [Cloudflare](https://cloudflare.com)
* [Elastic Load Balancer \(AWS\)](https://aws.amazon.com/elasticloadbalancing/)

However, any load balancer should be working

## Coordination

At present **EventNative** supports [etcd](https://etcd.io) as a coordination service. It used in creating/patching tables phase and for heart beating. For
using two or more **EventNative** instances please make additional configuration:

```yaml
server:
  ...
  name: #use unique name for each instance (e.g. hostname: en-node1-us.domain.com)  
  admin_token: your_admin_token #is used in cluster information requests

destinations:
...
        
coordination:
  etcd:
    endpoint: http://your_etcd_host
    connection_timeout_seconds: 60 #optional

```

Every **EventNative** instance with configured coordination sends heartbeat requests every 90 seconds.
For getting cluster information see [cluster information](/docs/other-features/admin-endpoints#apiv1cluster) section

