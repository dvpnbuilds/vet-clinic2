export function requestHeader(request, name) {
  const value = request.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value || request.get?.(name);
}

export function setResponseHeader(response, name, value) {
  if (typeof response.set === 'function') {
    response.set(name, value);
    return;
  }
  response.setHeader(name, value);
}
