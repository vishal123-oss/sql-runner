/**
 * Database / API configuration.
 *
 * IMPORTANT: Do not put real database passwords in the frontend.
 * Your backend (Node, Python, etc.) should hold credentials and expose
 * a /query (and optionally /schema) API. This file only configures
 * the URL and optional API key to call that backend.
 */

// Base URL of your backend API that runs SQL (e.g. http://localhost:3001)
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3002'

// Optional: API key or Bearer token if your backend requires auth
export const API_KEY = import.meta.env.VITE_API_KEY ?? ''

// Set to true to use your remote database; false to use in-browser SQLite demo
export const USE_REMOTE_DB = import.meta.env.VITE_USE_REMOTE_DB === 'true'
