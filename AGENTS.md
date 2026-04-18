# Repository Guidelines

## Project Structure & Module Organization
`rom-com` is a mixed frontend/backend repo:
- `src/`: React + TypeScript frontend (Vite).
- `public/`: static assets served by Vite.
- `backend/`: FastAPI app (`main.py`, `schemas.py`, `connection_manager.py`).
- `kineticlab/`: Python integration modules (`audio/`, `liveavatar/`, `photon/`) plus tests in `kineticlab/tests/`.
- Root Python utilities: motion/feature scripts such as `pipeline.py`, `feature_extractor.py`, and websocket test client `test_ws.py`.
- Contracts and docs: `SCHEMA.md`, `README.md`, `backend/README.md`.

## Build, Test, and Development Commands
- `npm run dev`: run frontend locally at `http://localhost:5173`.
- `npm run dev:mock`: run frontend with `VITE_MOCK_MODE=true`.
- `npm run build`: TypeScript compile + Vite production build.
- `npm run lint`: run ESLint on the frontend codebase.
- `docker compose up --build -d`: run frontend + backend together (`5173` and `8000`).
- `docker compose logs -f`: stream container logs.
- `docker compose down`: stop containers.
- `pytest`: run Python tests (configured for `kineticlab/tests` in `pytest.ini`).

## Coding Style & Naming Conventions
- Frontend: TypeScript/React with ESLint (`eslint.config.js`), prefer functional components and clear prop typing.
- Python: follow PEP 8 naming (`snake_case` for functions/files, `PascalCase` for classes).
- Keep module boundaries clear: UI logic in `src/`, API/websocket logic in `backend/`, domain processing in `kineticlab/` and root Python pipeline scripts.
- Commit style in history is Conventional Commits: `feat:`, `chore:`, plus explicit merge commits.

## Testing Guidelines
- Primary test framework is `pytest` with async support (`asyncio_mode = auto`).
- Add new Python tests under `kineticlab/tests` using `test_*.py` naming.
- For websocket/backend behavior, validate with `python test_ws.py` and `GET /health`.
- Before PRs, run at minimum: `npm run lint`, `npm run build`, `pytest`.

## Commit & Pull Request Guidelines
- Use focused commits with imperative summaries, e.g. `feat: wire photon router`.
- Keep PRs scoped to one feature/fix; include:
- what changed,
- how it was tested (commands + results),
- any schema/env updates (`SCHEMA.md`, `.env.example`).
- Attach screenshots/video for UI changes and note new endpoints or message-shape changes.

## Security & Configuration Tips
- Never commit real secrets. Use `.env.example` as the template and local `.env.development` for runtime values.
- Verify `.gitignore` coverage before committing generated artifacts, model files, or local env files.
