"""Run with: venv/bin/python -m uvicorn server:app --reload."""

import sqlite3
from pathlib import Path
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from backend import query_slider
from generator import generate_sound

ROOT = Path(__file__).resolve().parent


def points(request):
    try:
        return JSONResponse(query_slider(request.query_params.get('slider', '50,50,50')))
    except ValueError:
        return JSONResponse({'error': 'Each slider must be between 0 and 100.'}, status_code=400)
    except sqlite3.Error:
        return JSONResponse({'error': 'Run venv/bin/python import_opendap.py to install the aligned database.'}, status_code=503)


def index(request):
    return FileResponse(ROOT / 'index.html')


def game(request):
    return FileResponse(ROOT / 'game.html')


def play(request):
    return FileResponse(ROOT / 'play.html')


app = Starlette(routes=[
    Route('/api/points', points), Route('/', index), Route('/index.html', index),
    Route('/game.html', game),
    Route('/play.html', play),
    *[Mount(f'/{name}', StaticFiles(directory=ROOT/name)) for name in ('js', 'styles')],
    Route('/api/generate_sound', generate_sound),
])
