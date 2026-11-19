// =====================================================================
// http.js: Response envelope, errors and the route-handler wrapper
// Responses keep the original API shape: { success, data, message }
// =====================================================================

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, name = 'Error', details = null) {
    super(message);
    this.status = status;
    this.name = name;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, 'Bad Request', details);
export const notFound = (msg) => new HttpError(404, msg, 'NotFound');

export function ok(data, message = 'OK', status = 200) {
  return NextResponse.json({ success: true, data, message }, { status });
}

function fail(status, error, message, details) {
  return NextResponse.json(
    { success: false, error, message, ...(details ? { details } : {}) },
    { status }
  );
}

// Maps PostgreSQL error codes to HTTP responses
function fromPostgres(err) {
  switch (err.code) {
    case '23505':
      return fail(409, 'Duplicate Entry', 'A record with the specified unique values (e.g. username, email, code) already exists.');
    case '23503':
      return err.message.includes('still referenced')
        ? fail(409, 'Dependency Constraint', 'Cannot delete or modify record because other records depend on it.')
        : fail(400, 'Foreign Key Constraint Failed', 'Referenced entity does not exist in the database.');
    case '23514':
      return fail(400, 'Check Constraint Violated', err.message);
    case 'P0001':
      // RAISE EXCEPTION from a trigger or function
      return fail(400, 'Database Trigger Integrity Check Failed', err.message);
    case '22P02':
    case '22007':
    case '22008':
    case '22003':
      return fail(400, 'Invalid Value', err.message);
    default:
      return null;
  }
}

export function handleError(err) {
  if (err instanceof HttpError) {
    return fail(err.status, err.name, err.message, err.details);
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return fail(400, 'Validation Error', details[0]?.message || 'Invalid input', details);
  }
  if (err?.code && typeof err.code === 'string') {
    const mapped = fromPostgres(err);
    if (mapped) return mapped;
  }
  console.error('[API Error]', err);
  return fail(
    500,
    'InternalServerError',
    process.env.NODE_ENV === 'development' ? err.message : 'An unexpected internal server error occurred'
  );
}

// Wraps a route handler: awaits dynamic params and converts thrown errors
export function route(fn) {
  return async (request, context) => {
    try {
      const params = context?.params ? await context.params : {};
      return await fn(request, params);
    } catch (err) {
      return handleError(err);
    }
  };
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

export function parseId(value, label = 'ID') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw badRequest(`${label} must be an integer`);
  }
  return n;
}

// Accepts ISO 8601 (with or without zone) and "YYYY-MM-DD HH:mm[:ss]"
export function parseDate(value, label = 'datetime', { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`${label} is required`);
    return null;
  }
  const raw = value instanceof Date ? value : String(value).trim().replace(' ', 'T');
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw badRequest(`Invalid datetime value for ${label}: ${value}`);
  }
  return d;
}
