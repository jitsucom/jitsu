# Firebase

Firebase sync source supports the following collections:

- `users` - authorized users listed at Authentication section of Firebase console
- `firestore collection` - any collection from Firestore Cloud.

Firebase synchronization loads the whole collection and updates all objects at the destinations.

### Configuration

Firebase configuration example:

```yaml
sources:
  ...
  my_firebase:
    type: firebase
    destinations: [ "test_destination" ]
    collections:
      - name: known_users
        type: users
      - name: collection_name_from_firestore
        type: firestore
    config:
      project_id: "firebase_project_id"
      key: '<GOOGLE_SERVICE_ACCOUNT_KEY_JSON>'
  ...
```

Config parameters:

| Parameter | Description |
| :--- | :--- |
| `project_id` (required) | Firebase project identifier. See at Firebase console (for example, at URL: `/u/1/project/tracker-285220/overview` - `tracker-285220` is project identifier)  |
| `key` (required) | Service account key. This parameter may be a string, representing JSON or JSON object. Read more about [Google Authorization](/docs/configuration/google-authorization) and examples below. |

### Key examples

String representation:

```yaml
sources:
  firebase_driver_id:
    ...
    config:
      project_id: "firebase_project_id"
      key: '{"type":"service_account","project_id":"<PROJECT_ID>","private_key_id":"<PK_ID>","private_key":"<PRIVATE_KEY>","client_email":"<EMAIL>","client_id":"CID","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"<CERT_URL>"}'
```

JSON representation:

```yaml
sources:
  firebase_driver_id:
    ...
    config:
      project_id: "firebase_project_id"
      key: {
        "type": "service_account",
        "project_id": "<PROJECT_ID>",
        "private_key_id": "<PK_ID>",
        "private_key": "<PRIVATE_KEY>",
        "client_email": "<EMAIL>",
        "client_id": "CID",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_x509_cert_url": "<CERT_URL>"
      }
```

