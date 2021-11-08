jest.unmock("firebase/auth")
import { User } from "firebase/auth"
import { mockUserInfo } from "./_mockUserInfo"

export type UserFields = Omit<
  User,
  | "delete"
  | "getIdToken"
  | "getIdTokenResult"
  | "linkAndRetrieveDataWithCredential"
  | "linkWithCredential"
  | "linkWithPhoneNumber"
  | "linkWithPopup"
  | "linkWithRedirect"
  | "reauthenticateAndRetrieveDataWithCredential"
  | "reauthenticateWithCredential"
  | "reauthenticateWithPhoneNumber"
  | "reauthenticateWithPopup"
  | "reauthenticateWithRedirect"
  | "reload"
  | "sendEmailVerification"
  | "toJSON"
  | "unlink"
  | "updateEmail"
  | "updatePassword"
  | "updatePhoneNumber"
  | "updateProfile"
  | "verifyBeforeUpdateEmail"
>

export const mockUserFields: UserFields = {
  ...mockUserInfo,
  emailVerified: true,
  isAnonymous: false,
  tenantId: null,
  providerData: [
    {
      uid: "104795045673176107819",
      displayName: "Kirill Taletski",
      photoURL: "https://lh3.googleusercontent.com/a/AATXAJxCklWrcDqBA3QcjveWM_15uj5-hhXmPrxZ9M0=s96-c",
      email: "taletski@jitsu.com",
      phoneNumber: null,
      providerId: "google.com",
    },
    {
      uid: "taletski@jitsu.com",
      displayName: "Kirill Taletski",
      photoURL: "https://lh3.googleusercontent.com/a/AATXAJxCklWrcDqBA3QcjveWM_15uj5-hhXmPrxZ9M0=s96-c",
      email: "taletski@jitsu.com",
      phoneNumber: null,
      providerId: "password",
    },
  ],
  refreshToken:
    "AGEhc0AmE-D3WHwzxo8ZHtoPE1l-LMA2lDDXmLAccxpxWDFpCS99oOKtPO4ihiv27RoihDcGOCLi1s8_koBGuJ3hUEHJrVF0-qUXXB-qBCJYvfhOAcZLgUrghRRTBuFJ2R-1pIRIEG3d3qfdTC4bZqLTgNAVEH-AIv71uaqYTACEZ3OFGBAWIHQudIbK8ONxjHvxEsjcj9QvGc2SPFp_FYZ76TnHE8h4GaK70TUMY7D3sQ_L6g4oTP4",
  metadata: {
    lastSignInTime: "Sun, 04 Jul 2021 07:57:16 GMT",
    creationTime: "Tue, 15 Jun 2021 11:56:24 GMT",
  },
}

const internalFields = {
  apiKey: "AIzaSyDBm2HqvxleuJyD9xo8rh0vo1TQGp8Vohg",
  appName: "[DEFAULT]",
  authDomain: "backbase.jitsu.com",
  stsTokenManager: {
    apiKey: "AIzaSyDBm2HqvxleuJyD9xo8rh0vo1TQGp8Vohg",
    refreshToken:
      "AGEhc0AmE-D3WHwzxo8ZHtoPE1l-LMA2lDDXmLAccxpxWDFpCS99oOKtPO4ihiv27RoihDcGOCLi1s8_koBGuJ3hUEHJrVF0-qUXXB-qBCJYvfhOAcZLgUrghRRTBuFJ2R-1pIRIEG3d3qfdTC4bZqLTgNAVEH-AIv71uaqYTACEZ3OFGBAWIHQudIbK8ONxjHvxEsjcj9QvGc2SPFp_FYZ76TnHE8h4GaK70TUMY7D3sQ_L6g4oTP4",
    accessToken:
      "eyJhbGciOiJSUzI1NiIsImtpZCI6Ijc3MTBiMDE3ZmQ5YjcxMWUwMDljNmMzNmIwNzNiOGE2N2NiNjgyMTEiLCJ0eXAiOiJKV1QifQ.eyJuYW1lIjoiS2lyaWxsIFRhbGV0c2tpIiwicGljdHVyZSI6Imh0dHBzOi8vbGgzLmdvb2dsZXVzZXJjb250ZW50LmNvbS9hL0FBVFhBSnhDa2xXcmNEcUJBM1FjanZlV01fMTV1ajUtaGhYbVByeFo5TTA9czk2LWMiLCJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vdHJhY2tlci0yODUyMjAiLCJhdWQiOiJ0cmFja2VyLTI4NTIyMCIsImF1dGhfdGltZSI6MTYyNTM4NTQzNiwidXNlcl9pZCI6IlpNc29rVGJmb1FOODVSRzJVRWg0ZEZHNVl2cjIiLCJzdWIiOiJaTXNva1RiZm9RTjg1UkcyVUVoNGRGRzVZdnIyIiwiaWF0IjoxNjI2MDY4NDk0LCJleHAiOjE2MjYwNzIwOTQsImVtYWlsIjoidGFsZXRza2lAaml0c3UuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsImZpcmViYXNlIjp7ImlkZW50aXRpZXMiOnsiZ29vZ2xlLmNvbSI6WyIxMDQ3OTUwNDU2NzMxNzYxMDc4MTkiXSwiZW1haWwiOlsidGFsZXRza2lAaml0c3UuY29tIl19LCJzaWduX2luX3Byb3ZpZGVyIjoicGFzc3dvcmQifX0.TiNUgot_tpq0lMbUmdQgsnBkMdXqyhLj4nwdX8WMsCVtiKWsdf2RwXLHyBPQTXDUTfqnjcFDlcdaPD8X5-yaUxH4_4wjdqIxqmw_zGZXqhPkXyDJ9XRXmaXmY6hkRhLZ5xYv527tZNk7iV7RuhirOH2P_-uDDy9_wBK7a0UUMlp3pZVY9WJnU2Gva5vnQj-cMn2ggzFcgNxbN36sIXKPfTvzBH3kWlYmMhO1Xo1YC0bHDIF19ik74aSXs3Wx4IuZYnPhvcrxVP5zUh2LhDdG7NFz1XvICYCOrk64-KJ_HcwbZhbj-zMKxmHwe7i9xR9deQkPNhwNuFYAELPJZZD78w",
    expirationTime: 1626072094629,
  },
  redirectEventId: null,
  lastLoginAt: "1625385436715",
  createdAt: "1623758184314",
}
