// Redirect user to Google OAuth consent screen
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const redirect = url.searchParams.get("redirect") || "/";

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("access_type", "online");
  googleAuthUrl.searchParams.set("prompt", "select_account");
  googleAuthUrl.searchParams.set("state", redirect);

  return Response.redirect(googleAuthUrl.toString(), 302);
}
