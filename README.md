# email-lookup

## email verification backend

verification uses the millionverifier single api.

set your api key:

```sh
MILLIONVERIFIER_API_KEY=your-api-key
```

the app calls `https://api.millionverifier.com/api/v3` by default. set
`MILLIONVERIFIER_BASE_URL` only if you need to override the api endpoint.
