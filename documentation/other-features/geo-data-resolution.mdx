import {Hint} from "../../../components/documentationComponents";

# Geo Data resolution

**EventNative** applies geo resolution during [enrichment](/docs/how-it-works/architecture#context-enrichment-step). Geo resolution means determining
user's country, city, zip code \(and other location data\) from their IP address. Here's a full list of fields we enrich from the IP address:

* country
* region _\(two-letter state code for US\)_ 
* city
* latitude
* longitude
* zip

<Hint>
Please note, latitude and longitude are approximate. They are most likely the coordinates of the center of a city
</Hint>

```yaml
{..."eventn_ctx": {
    "location": {
        "ip": "127.0.0.1",
        "country": "US",
        "city": "New York",
        "zip": "10128",
        "region": "NY",
        "latitude": 40.7809
        "longitude": -73.9502
    }
}}
```

### MaxMind

Though **EventNative** is free, we use [MaxMind's ](https://www.maxmind.com/en/geoip2-city)database for IP resolution. Once you'll get the file from MaxMind, please add it to the configuration YAML as:

```yaml
server:
...

destinations:
...

geo.maxmind_path: path_to_file #local file
#or
geo.maxmind_path: http://resource.url/path #hosted file
```

If a file is not provided, **EventNative** will still work, but geo data will not be resolved.

