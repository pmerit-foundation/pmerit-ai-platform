export async function onRequest(context) {
  // Get the response from the next middleware or page
  const response = await context.next();
  
  // Create new headers, copying everything except CSP
  const newHeaders = new Headers();
  
  for (const [key, value] of response.headers.entries()) {
    // Skip ALL CSP-related headers
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'content-security-policy' ||
      lowerKey === 'content-security-policy-report-only' ||
      lowerKey === 'x-content-security-policy'
    ) {
      continue; // Skip this header
    }
    newHeaders.set(key, value);
  }
  
  // Add our custom CSP
  newHeaders.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
    "connect-src 'self' https://api.pmerit.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
    "img-src 'self' data: https:; " +
    "frame-src 'self';"
  );
  
  // Return new response with modified headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}