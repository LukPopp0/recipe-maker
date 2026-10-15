// The caller as resolved by the server's auth middleware (deployment spec
// section 2). Returned by GET /api/me so the UI can show the username and
// decide which owner/admin actions to offer.
export type CurrentUser = {
  username: string
  isAdmin: boolean
}
