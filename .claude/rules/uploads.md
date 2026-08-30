---
paths:
  - backend/src/services/upload.service.js
  - backend/src/controllers/upload.controller.js
  - backend/src/routes/upload.routes.js
  - backend/src/middleware/upload.js
---

# Image upload / storage architecture

`POST /api/uploads/{entity}` (dashboard) → disk; read via `GET
/uploads/...`. Entity allowlist: `banners`, `films`, `categories`, `chains`,
`cinemas`, `products`.

- Entity allowlist → permission module: `banners`→Banners, `films`→Settings,
  `categories`→Categories, `chains`→Settings, `cinemas`→Settings
  (the per-cinema screensaver; `MODULES` is frozen and mirrors a DB CHECK
  constraint, so there is no "Cinemas" module to add), `products`→Products. This is
  the **only** source of directory names, so a caller can never introduce a
  folder and `..`/absolute paths can never reach `path.join`.
- multer uses **memory storage** — nothing reaches disk until the bytes are
  validated. Writing first would leave a window where an unvalidated file
  exists under a served directory.
- Accepted by **magic-number signature**: JPEG, PNG, GIF, WebP. The
  extension and browser MIME type are attacker-controlled and both
  untrusted; the stored extension is derived from the detected signature.
- **SVG is deliberately excluded** — it is XML, can carry script, and
  serving it from the application origin would be a stored-XSS vector.
- Filename = `crypto.randomBytes(16).toString('hex')` + detected extension,
  written with flag `wx` (fails rather than truncating). Carries nothing
  from the upload — kills collisions, traversal and "innocuous name, nasty
  content" in one step.
- DB stores the **application path** `/uploads/<entity>/<file>` in the
  **same VARCHAR(500) column as external URLs** — both are valid values,
  one field, no second column, no discriminator, no migration.
- `parseLocalUpload()` uses a strict regex
  `^\/uploads\/([a-z]+)\/([a-f0-9]{32}\.(?:jpg|png|gif|webp))$` so a crafted
  value can never reach the filesystem. Anything else is treated as
  external and left alone — including a URL merely *containing*
  `/uploads/`.
- Deletion never fails the surrounding request; a missing file is not an
  error (an orphan on disk is recoverable, a failed save is visible to the
  user). `cinema.service.updateCinema` is the first caller: it deletes the
  previous screensaver **after** the row saves, so a failed save can never
  orphan a cinema from artwork already removed from disk.
- `shared/` is the one shared storage location — `openapi.json` beside
  `uploads/`. `FILE_STORAGE_PATH` (default `shared/uploads`) is resolved
  once, absolutely, against the repo root. `openapi.json` is unaffected by
  it. **`FILE_STORAGE_PATH` must be outside the source tree in
  production**, or a redeploy deletes every uploaded image. The DB holds
  only the path, never the file.
