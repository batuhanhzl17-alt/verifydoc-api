export async function inspectPdfRevisions(buffer) {
  const url = process.env.VERIFYDOC_PDF_FORENSICS_URL;
  const token = process.env.VERIFYDOC_PDF_FORENSICS_TOKEN;
  if (!url || !token) return { available: false, status: 'not-configured' };
  if (buffer.length > 16 * 1024 * 1024) return { available: false, status: 'size-limit' };

  try {
    const endpoint = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) {
      return { available: false, status: 'invalid-service-url' };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf',
      },
      body: buffer,
      redirect: 'error',
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) return { available: false, status: 'service-error' };
    const result = await response.json();
    if (typeof result?.available !== 'boolean') {
      return { available: false, status: 'invalid-service-response' };
    }
    return result;
  } catch {
    return { available: false, status: 'service-unavailable' };
  }
}
