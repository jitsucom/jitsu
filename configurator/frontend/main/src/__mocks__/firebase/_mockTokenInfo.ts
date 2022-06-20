import { IdTokenResult } from "firebase/auth"

const now = Date.now()
const plusHour = now + 3_600_000

export const mockTokenInfo = {
  token:
    "eyJhbGciOiJSUzI1NiIsImtpZCI6Ijc3MTBiMDE3ZmQ5YjcxMWUwMDljNmMzNmIwNzNiOGE2N2NiNjgyMTEiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiS2lyaWxsIFRhbGV0c2tpIiwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FBVFhBSnhDa2xXcmNEcUJBM1FjanZlV01fMTV1ajUtaGhYbVByeFo5TTA9czk2LWMiLCJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vdHJhY2tlci0yODUyMjAiLCJhdWQiOiJ0cmFja2VyLTI4NTIyMCIsImF1dGhfdGltZSI6MTYyNTM4NTQzNiwidXNlcl9pZCI6IlpNc29rVGJmb1FOODVSRzJVRWg0ZEZHNVl2cjIiLCJzdWIiOiJaTXNva1RiZm9RTjg1UkcyVUVoNGRGRzVZdnIyIiwiaWF0IjoxNjI2MDY4NDk0LCJleHAiOjE2MjYwNzIwOTQsImVtYWlsIjoidGFsZXRza2lAaml0c3UuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMDQ3OTUwNDU2NzMxNzYxMDc4MTkiXSwiZW1haWwiOlsidGFsZXRza2lAaml0c3UuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.TiNUgot_tpq0lMbUmdQgsnBkMdXqyhLj4nwdX8WMsCVtiKWsdf2RwXLHyBPQTXDUTfqnjcFDlcdaPD8X5-yaUxH4_4wjdqIxqmw_zGZXqhPkXyDJ9XRXmaXmY6hkRhLZ5xYv527tZNk7iV7RuhirOH2P_-uDDy9_wBK7a0UUMlp3pZVY9WJnU2Gva5vnQj-cMn2ggzFcgNxbN36sIXKPfTvzBH3kWlYmMhO1Xo1YC0bHDIF19ik74aSXs3Wx4IuZYnPhvcrxVP5zUh2LhDdG7NFz1XvICYCOrk64-KJ_HcwbZhbj-zMKxmHwe7i9xR9deQkPNhwNuFYAELPJZZD78w",
  expirationTime: new Date(plusHour).toUTCString(),
  authTime: new Date(now).toUTCString(),
  issuedAtTime: new Date(now).toUTCString(),
  signInProvider: "password",
  signInSecondFactor: null,
  claims: {
    name: "Kirill Taletski",
    picture: "https://lh3.googleusercontent.com/a/AATXAJxCklWrcDqBA3QcjveWM_15uj5-hhXmPrxZ9M0=s96-c",
    iss: "https://securetoken.google.com/tracker-285220",
    aud: "tracker-285220",
    auth_time: `${Date.now()}`,
    user_id: "ZMsokTbfoQN85RG2UEh4dFG5Yvr2",
    sub: "ZMsokTbfoQN85RG2UEh4dFG5Yvr2",
    iat: `${now}`,
    exp: `${plusHour}`,
    email: "taletski@jitsu.com",
    email_verified: `${true}`,
    firebase: {
      identities: {
        "google.com": ["104795045673176107819"],
        email: ["taletski@jitsu.com"],
      },
      sign_in_provider: "password",
    },
  },
} as unknown as IdTokenResult
