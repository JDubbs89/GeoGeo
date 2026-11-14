"""Serve GeoGeo with: python -m uvicorn server:app --reload."""

from pathlib import Path

from starlette.applications import Starlette
from starlette.responses import FileResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parent


async def index(request):
    return FileResponse(ROOT / "index.html")


app = Starlette(
    routes=[
        Route("/", index),
        Route("/index.html", index),
        *[
            Mount(f"/{directory}", StaticFiles(directory=ROOT / directory))
            for directory in ("js", "styles", "data")
        ],
    ]
)
